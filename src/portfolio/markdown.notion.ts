/**
 * Notion-derived HTML → sanitised Markdown adapter (Issue #451).
 *
 * Why this module exists
 * ----------------------
 * Portfolio bodies are stored as Markdown and the lexer never parses
 * raw HTML, so the *Markdown* path already had a safe-by-construction
 * answer (see `markdown.lexer.ts`). The HTML path does not: a Notion
 * export carries `<script>`, `on*` handlers, `javascript:` hrefs and
 * inline `<svg>` markup that React would happily render if it were
 * handed the string verbatim.
 *
 * This adapter is the ONLY sanctioned way to turn Notion-derived HTML
 * into something the article renderer can consume. It is an ALLOW
 * list: an element that is not named below is unwrapped (its text
 * survives, its markup does not), and an element on the active list
 * is dropped together with its subtree.
 *
 * Wiring status
 * -------------
 * **Not yet wired to an ingest path.** The portfolio migration
 * (`scripts/migrate-portfolio-from-2025.mjs`) writes plain Markdown
 * today and never produces HTML, so nothing calls this module in
 * production yet. It lands first, with tests, so that whichever
 * ingest path introduces Notion HTML inherits the sanitiser instead
 * of inventing a second one. This is the "adapter first" case the
 * Issue allows for surfaces that do not exist yet.
 *
 * Cross-references:
 *   - `src/portfolio/markdown.lexer.ts` — `classifyHref` is the URL
 *     oracle; this module does not re-implement scheme filtering.
 *   - `test/fixtures/markdown-xss-fixtures.ts` — `executableMarkupFindings`,
 *     the oracle the round-trip test asserts against.
 *   - `docs/security.md` §"Markdown / Notion-derived HTML input boundary".
 */

import { classifyHref } from './markdown.lexer';

/** Why a fragment of the source did not survive. */
export const NOTION_DROP_REASONS = [
	/** `script` / `style` / `iframe` / `svg` / `form` … — dropped with content. */
	'active-element',
	/** `on*` event-handler attribute. */
	'event-handler-attribute',
	/** `href` / `src` / `action` / `data` with a non-`http(s)` scheme. */
	'unsafe-url',
	/** Attribute outside the allow list (class, style, id, data-*, …). */
	'dropped-attribute',
	/** Element outside the allow list — markup dropped, text kept. */
	'unknown-element',
	/** `<!-- … -->`, `<!doctype …>`, `<?…?>`. */
	'non-element-node',
] as const;

export type NotionDropReason = (typeof NOTION_DROP_REASONS)[number];

export interface NotionDroppedFragment {
	readonly reason: NotionDropReason;
	/** Short, escaped sample so a caller can show what was refused. */
	readonly sample: string;
}

export interface NotionSanitizeResult {
	/** Sanitised Markdown, ready for `parseMarkdown` / `PortfolioMarkdown`. */
	readonly markdown: string;
	/** Every refusal, in document order. Empty when nothing was dropped. */
	readonly dropped: readonly NotionDroppedFragment[];
}

export interface NotionSanitizeOptions {
	/** Origin used to classify links. Defaults to the canonical domain (ADR-0014). */
	readonly siteOrigin?: string;
}

const DEFAULT_SITE_ORIGIN = 'https://rebuildup.dev';

/** Element names whose CONTENT is executable or presentation-bearing. */
const ACTIVE_ELEMENTS = new Set([
	'base',
	'button',
	'embed',
	'form',
	'frame',
	'frameset',
	'iframe',
	'input',
	'link',
	'meta',
	'noscript',
	'object',
	'script',
	'select',
	'style',
	'svg',
	'template',
	'textarea',
]);

/** Attributes that carry a URL. Each one goes through `classifyHref`. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'data', 'poster']);

/** Attributes allowed to survive, keyed by element. */
const ALLOWED_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
	a: new Set(['href']),
	code: new Set(['class']),
	pre: new Set(['class']),
};

/**
 * Elements rendered as inline Markdown rather than as a block.
 *
 * A `<a>` (or `<strong>`) that appears at the top level of a fragment
 * must still render as a link, not be unwrapped into bare text — the
 * element knows its own inline form.
 */
const INLINE_ELEMENTS = new Set(['a', 'b', 'br', 'code', 'em', 'i', 'span', 'strong']);

/** Elements converted to a block-level Markdown construct. */
const BLOCK_ELEMENTS = new Set([
	'p',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'ul',
	'ol',
	'li',
	'blockquote',
	'pre',
	'hr',
]);

/**
 * Depth / size ceilings.
 *
 * This adapter runs over externally-sourced HTML, so it has to be
 * safe against a hostile document as well as a Notion one. Past the
 * depth cap an element is unwrapped rather than nested (an attacker
 * gains no depth), and the output is truncated at `MAX_OUTPUT`
 * characters with a marker line rather than being allowed to grow
 * without bound.
 */
const MAX_DEPTH = 32;
const MAX_OUTPUT = 200_000;

const TRUNCATION_MARKER = '\n\n<!-- input truncated by the Notion HTML adapter -->';

interface ElementNode {
	readonly type: 'element';
	readonly name: string;
	readonly attributes: ReadonlyMap<string, string>;
	readonly children: Node[];
}

interface TextNode {
	readonly type: 'text';
	readonly value: string;
}

type Node = ElementNode | TextNode;

/**
 * Convert Notion-derived HTML into Markdown that the article renderer
 * can render without an HTML path.
 *
 * Never throws: malformed markup degrades to text. The returned
 * `dropped` list is the operator-facing record of what was refused —
 * a sanitiser that fails silently is a sanitiser nobody can audit.
 */
export function sanitizeNotionHtml(
	html: string,
	options: NotionSanitizeOptions = {},
): NotionSanitizeResult {
	const siteOrigin = options.siteOrigin ?? DEFAULT_SITE_ORIGIN;
	const dropped: NotionDroppedFragment[] = [];
	const source = typeof html === 'string' ? html : '';
	const tree = parseFragment(source, dropped);
	const markdown = renderBlocks(tree, 0, siteOrigin, dropped);
	return {
		markdown:
			markdown.length > MAX_OUTPUT ? markdown.slice(0, MAX_OUTPUT) + TRUNCATION_MARKER : markdown,
		dropped,
	};
}

/* ------------------------------------------------------------------ *
 * Tokenizer
 * ------------------------------------------------------------------ */

function parseFragment(source: string, dropped: NotionDroppedFragment[]): Node[] {
	const root: Node[] = [];
	/** Open elements, innermost last. */
	const stack: ElementNode[] = [];
	let index = 0;

	const current = (): Node[] => (stack.length > 0 ? stack[stack.length - 1].children : root);

	while (index < source.length) {
		const lt = source.indexOf('<', index);
		if (lt === -1) {
			pushText(current(), source.slice(index));
			break;
		}
		if (lt > index) pushText(current(), source.slice(index, lt));

		const next = source[lt + 1];
		if (next === undefined) {
			pushText(current(), source.slice(lt));
			break;
		}

		// Comment / doctype / CDATA / processing instruction.
		if (next === '!' || next === '?') {
			if (source.startsWith('<!--', lt)) {
				// A comment's body can contain `>` (and this adapter
				// exists precisely to see hostile input), so it is
				// skipped to `-->` rather than to the next tag end.
				const close = source.indexOf('-->', lt + 4);
				index = close === -1 ? source.length : close + 3;
				continue;
			}
			const close = findTagEnd(source, lt + 1);
			dropped.push({ reason: 'non-element-node', sample: preview(source.slice(lt, close)) });
			index = close;
			continue;
		}

		// Stray `<` that does not open a tag.
		if (!/[a-zA-Z/]/.test(next)) {
			pushText(current(), '<');
			index = lt + 1;
			continue;
		}

		const closing = next === '/';
		const nameStart = lt + (closing ? 2 : 1);
		const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(source.slice(nameStart));
		if (!nameMatch) {
			pushText(current(), '<');
			index = lt + 1;
			continue;
		}
		const name = nameMatch[0].toLowerCase();
		const tagEnd = findTagEnd(source, lt + 1);
		const selfClosing = source[tagEnd - 1] === '/';
		const rawTag = source.slice(lt, tagEnd);

		if (closing) {
			closeElement(stack, name);
			index = tagEnd;
			continue;
		}

		const attributes = closing
			? new Map()
			: parseAttributes(source, nameStart + name.length, tagEnd);

		if (ACTIVE_ELEMENTS.has(name)) {
			dropped.push({ reason: 'active-element', sample: `<${name}>` });
			index = selfClosing ? tagEnd : skipSubtree(source, name, tagEnd);
			continue;
		}

		const node: ElementNode = {
			type: 'element',
			name,
			attributes: filterAttributes(name, attributes, dropped),
			children: [],
		};
		current().push(node);

		if (selfClosing || VOID_ELEMENTS.has(name)) {
			index = tagEnd;
			continue;
		}

		if (stack.length >= MAX_DEPTH) {
			// Past the cap the element is unwrapped: its children still
			// flow into the parent, but no deeper structure is created.
			dropped.push({ reason: 'unknown-element', sample: `<${name}> (depth cap)` });
			index = tagEnd;
			continue;
		}
		stack.push(node);
		index = tagEnd;
	}

	// Unclosed elements at EOF simply end; the tree is already complete.
	return root;
}

const VOID_ELEMENTS = new Set([
	'area',
	'br',
	'col',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'source',
	'track',
	'wbr',
]);

function pushText(target: Node[], value: string): void {
	if (!value) return;
	const last = target[target.length - 1];
	if (last && last.type === 'text') {
		// Merge adjacent text so whitespace collapsing happens once.
		(last as { value: string }).value += value;
		return;
	}
	target.push({ type: 'text', value });
}

/** Index just past the `>` that closes the tag opened at/after `from`. */
function findTagEnd(source: string, from: number): number {
	let quote: string | null = null;
	for (let i = from; i < source.length; i++) {
		const ch = source[i];
		if (quote) {
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === '>') return i + 1;
	}
	return source.length;
}

/**
 * Skip an active element's subtree.
 *
 * The active list is small and known, so a bounded depth counter over
 * the same tag names is enough — and unlike a generic "skip until the
 * matching close tag" scan it cannot be defeated by a malformed
 * document (it terminates at EOF).
 */
function skipSubtree(source: string, name: string, from: number): number {
	let depth = 1;
	let index = from;
	const open = new RegExp(`<${name}(?=[\\s/>])`, 'gi');
	const close = new RegExp(`</${name}\\s*>`, 'gi');
	while (index < source.length && depth > 0) {
		open.lastIndex = index;
		close.lastIndex = index;
		const nextOpen = open.exec(source);
		const nextClose = close.exec(source);
		if (!nextClose) return source.length;
		if (nextOpen && nextOpen.index < nextClose.index) {
			if (source[nextOpen.index + nextOpen[0].length - 1] !== '/') depth++;
			index = nextOpen.index + nextOpen[0].length;
			continue;
		}
		depth--;
		index = nextClose.index + nextClose[0].length;
	}
	return index;
}

function parseAttributes(source: string, from: number, to: number): Map<string, string> {
	const attributes = new Map<string, string>();
	const raw = source.slice(from, Math.max(from, to - 1));
	const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
	for (const match of raw.matchAll(pattern)) {
		const name = match[1].toLowerCase();
		if (!name) continue;
		const value = match[2] ?? match[3] ?? match[4] ?? '';
		if (!attributes.has(name)) attributes.set(name, value);
	}
	return attributes;
}

function filterAttributes(
	element: string,
	attributes: ReadonlyMap<string, string>,
	dropped: NotionDroppedFragment[],
): Map<string, string> {
	const allowed = ALLOWED_ATTRIBUTES[element];
	const kept = new Map<string, string>();
	for (const [name, value] of attributes) {
		if (name.startsWith('on')) {
			dropped.push({ reason: 'event-handler-attribute', sample: `${element}[${name}]` });
			continue;
		}
		if (URL_ATTRIBUTES.has(name) && !ALLOWED_URL_ATTRIBUTES_FOR[element]?.has(name)) {
			dropped.push({ reason: 'dropped-attribute', sample: `${element}[${name}]` });
			continue;
		}
		if (allowed?.has(name)) {
			kept.set(name, value);
			continue;
		}
		dropped.push({ reason: 'dropped-attribute', sample: `${element}[${name}]` });
	}
	return kept;
}

/** URL-bearing attributes that are allowed to reach `classifyHref`. */
const ALLOWED_URL_ATTRIBUTES_FOR: Readonly<Record<string, ReadonlySet<string>>> = {
	a: new Set(['href']),
};

function closeElement(stack: ElementNode[], name: string): void {
	for (let i = stack.length - 1; i >= 0; i--) {
		if (stack[i].name === name) {
			stack.length = i;
			return;
		}
	}
	// A close tag with no open counterpart is ignored, not fatal.
}

/* ------------------------------------------------------------------ *
 * Markdown serialisation
 * ------------------------------------------------------------------ */

function renderBlocks(
	nodes: readonly Node[],
	depth: number,
	siteOrigin: string,
	dropped: NotionDroppedFragment[],
): string {
	const parts: string[] = [];
	for (const node of nodes) {
		if (node.type === 'text') {
			const text = collapseWhitespace(node.value);
			if (text) parts.push(text);
			continue;
		}
		if (ACTIVE_ELEMENTS.has(node.name)) {
			dropped.push({ reason: 'active-element', sample: `<${node.name}>` });
			continue;
		}
		const block = renderElement(node, depth, siteOrigin, dropped);
		if (block) parts.push(block);
	}
	return parts.filter(Boolean).join('\n\n');
}

function renderElement(
	node: ElementNode,
	depth: number,
	siteOrigin: string,
	dropped: NotionDroppedFragment[],
): string {
	switch (node.name) {
		case 'h1':
		case 'h2':
		case 'h3':
		case 'h4':
		case 'h5':
		case 'h6': {
			// The renderer maps `#` / `##` / `###` to sub-headings and
			// the page reserves h1/h2 for itself, so anything deeper is
			// clamped to `###` rather than silently losing its level.
			const level = Number(node.name.slice(1));
			const hashes = '#'.repeat(Math.min(Math.max(level, 1), 3));
			return `${hashes} ${renderInline(node.children, siteOrigin, dropped)}`.trimEnd();
		}
		case 'p':
			return renderInline(node.children, siteOrigin, dropped);
		case 'hr':
			return '---';
		case 'pre':
			return renderFencedCode(node, dropped);
		case 'blockquote': {
			const body = renderBlocks(node.children, depth + 1, siteOrigin, dropped);
			return body
				.split('\n')
				.map((line) => (line ? `> ${line}` : '>'))
				.join('\n');
		}
		case 'ul':
		case 'ol':
			return renderList(node, depth, siteOrigin, dropped);
		case 'li':
			// A bare `<li>` outside a list still has to render as text.
			return renderListItem(node, siteOrigin, dropped);
		default:
			if (INLINE_ELEMENTS.has(node.name)) {
				return renderInline([node], siteOrigin, dropped);
			}
			break;
	}

	// Unknown element: unwrap. Text survives, markup does not.
	if (!BLOCK_ELEMENTS.has(node.name)) {
		dropped.push({ reason: 'unknown-element', sample: `<${node.name}>` });
	}
	return renderBlocks(node.children, depth + 1, siteOrigin, dropped);
}

function renderList(
	node: ElementNode,
	depth: number,
	siteOrigin: string,
	dropped: NotionDroppedFragment[],
): string {
	const ordered = node.name === 'ol';
	const lines: string[] = [];
	let counter = 0;
	for (const child of node.children) {
		if (child.type === 'text') {
			const loose = collapseWhitespace(child.value);
			if (loose) lines.push(loose);
			continue;
		}
		if (child.type !== 'element') continue;
		if (child.name === 'ul' || child.name === 'ol') {
			// Nested lists become indented continuation lines under the
			// previous item, which is what the lexer expects.
			const nested = renderList(child, depth + 1, siteOrigin, dropped);
			if (nested) lines.push(nested);
			continue;
		}
		if (child.name === 'li') {
			counter += 1;
			const marker = ordered ? `${counter}. ` : '- ';
			const indent = '  '.repeat(depth);
			lines.push(`${indent}${marker}${renderListItem(child, siteOrigin, dropped)}`);
			continue;
		}
		const inline = renderElement(child, depth, siteOrigin, dropped);
		if (inline) lines.push(inline);
	}
	return lines.join('\n');
}

/**
 * Render one `<li>`: its inline run on the marker line, then any
 * nested list indented underneath it.
 */
function renderListItem(
	node: ElementNode,
	siteOrigin: string,
	dropped: NotionDroppedFragment[],
): string {
	const inlineChildren = node.children.filter(
		(child) => !(child.type === 'element' && (child.name === 'ul' || child.name === 'ol')),
	);
	const text = renderInline(inlineChildren, siteOrigin, dropped);
	const nested: string[] = [];
	for (const child of node.children) {
		if (child.type !== 'element') continue;
		if (child.name !== 'ul' && child.name !== 'ol') continue;
		const rendered = renderList(child, 1, siteOrigin, dropped);
		if (rendered) nested.push(rendered);
	}
	return [text.trimEnd(), ...nested].filter(Boolean).join('\n');
}

function renderFencedCode(node: ElementNode, dropped: NotionDroppedFragment[]): string {
	const codeChild = node.children.find(
		(child): child is ElementNode => child.type === 'element' && child.name === 'code',
	);
	const source = codeChild ?? node;
	const raw = source.children
		.filter((child): child is TextNode => child.type === 'text')
		.map((child) => child.value)
		.join('');
	if (!raw.trim()) {
		dropped.push({ reason: 'unknown-element', sample: '<pre> (empty)' });
		return '';
	}
	const lang = languageFromClass(source.attributes.get('class'));
	// A fence one backtick longer than the longest run inside the body
	// (and never shorter than three) keeps a payload that contains ```
	// from closing the block early. The lexer reads the opening run and
	// only closes on an equal or longer one, so the round-trip survives.
	const fence = '`'.repeat(Math.max(3, longestBacktickRun(raw) + 1));
	return `${fence}${lang}\n${raw.replace(/\n+$/, '')}\n${fence}`;
}

const LANGUAGE_PATTERN = /^[a-z0-9+#.-]{1,24}$/i;

function languageFromClass(value: string | undefined): string {
	if (!value) return '';
	const match = /(?:^|\s)(?:language-|lang-)([a-z0-9+#.-]{1,24})(?:\s|$)/i.exec(value);
	if (!match) return '';
	const lang = match[1];
	return LANGUAGE_PATTERN.test(lang) ? lang : '';
}

function renderInline(
	nodes: readonly Node[],
	siteOrigin: string,
	dropped: NotionDroppedFragment[],
): string {
	let out = '';
	for (const node of nodes) {
		if (node.type === 'text') {
			out += escapeInlineMarkdown(collapseWhitespace(node.value));
			continue;
		}
		if (ACTIVE_ELEMENTS.has(node.name)) {
			dropped.push({ reason: 'active-element', sample: `<${node.name}>` });
			continue;
		}
		switch (node.name) {
			case 'strong':
			case 'b': {
				const inner = renderInline(node.children, siteOrigin, dropped);
				if (inner.trim()) out += `**${inner}**`;
				continue;
			}
			case 'em':
			case 'i': {
				const inner = renderInline(node.children, siteOrigin, dropped);
				if (inner.trim()) out += `*${inner}*`;
				continue;
			}
			case 'code': {
				const raw = textContent(node.children);
				if (raw.trim()) {
					// Code spans close at the NEXT backtick run, and a
					// backslash does not escape one (CommonMark). So the
					// delimiter is one backtick longer than the longest run
					// in the content; `\`-escaping would leak as literal
					// text and truncate the span.
					const ticks = '`'.repeat(longestBacktickRun(raw) + 1);
					out += `${ticks}${raw}${ticks}`;
				}
				continue;
			}
			case 'br':
				out += '  \n';
				continue;
			case 'a': {
				const label = renderInline(node.children, siteOrigin, dropped);
				const href = node.attributes.get('href') ?? '';
				const verdict = classifyHref(href, siteOrigin);
				if (verdict.outcome === 'blocked') {
					// Same rule the renderer applies: a refused target is
					// recorded and rendered without a destination, so the
					// Markdown it produces cannot become a live link.
					dropped.push({ reason: 'unsafe-url', sample: verdict.raw });
					out += label;
					continue;
				}
				if (!label.trim()) continue;
				out += `[${label}](${verdict.href.replace(/\)/g, '%29')})`;
				continue;
			}
			default:
				// Unknown inline element: keep the text, refuse the tag.
				dropped.push({ reason: 'unknown-element', sample: `<${node.name}>` });
				out += renderInline(node.children, siteOrigin, dropped);
		}
	}
	return out.replace(/[ \t]+\n/g, '\n');
}

function textContent(nodes: readonly Node[]): string {
	let out = '';
	for (const node of nodes) {
		if (node.type === 'text') out += node.value;
		else out += textContent(node.children);
	}
	return out;
}

/** HTML collapses runs of whitespace; so does Markdown rendering. */
function collapseWhitespace(value: string): string {
	return value.replace(/[\t\n\r ]+/g, ' ');
}

/**
 * Escape the inline characters the lexer treats as structure, so text
 * that came from HTML cannot invent a link or emphasis of its own.
 *
 * `<` and `>` are deliberately NOT escaped: the lexer does not parse
 * raw HTML and React escapes every text node, so they already reach
 * the page as inert text.
 */
function escapeInlineMarkdown(value: string): string {
	return value.replace(/[\\`*_[\]]/g, (ch) => `\\${ch}`);
}

/**
 * Length of the longest backtick run in `value` (0 when there is none).
 *
 * Both delimiters the adapter emits — a fence and an inline code span —
 * must be one backtick longer than that run, because the lexer closes
 * them at the next run of equal or greater length (and a backslash does
 * not escape a backtick inside a code span).
 */
function longestBacktickRun(value: string): number {
	let longest = 0;
	for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
	return longest;
}

function preview(raw: string): string {
	const flattened = raw.replace(/\s+/g, ' ').trim();
	return flattened.length > 80 ? `${flattened.slice(0, 77)}…` : flattened;
}
