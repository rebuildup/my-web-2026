/**
 * Portfolio Markdown lexer + AST (Issue #77).
 *
 * Scope — **minimal**, not a general-purpose blog engine:
 *
 *   - Block: paragraphs, `#` / `##` / `###` headings, `-` / `*` and
 *     `1.` lists, fenced code blocks (```), blockquotes (`>`),
 *     horizontal rules (`---`).
 *   - Inline: `**bold**`, `*italic*` / `_italic_`, `` `code` ``,
 *     `[text](url)` links.
 *
 * Intentional omissions:
 *
 *   - Raw HTML is **not** parsed — the renderer never reads HTML.
 *     Markdown bodies in seed data cannot carry `<script>` /
 *     `<iframe>` / arbitrary attributes.
 *   - Tables, images, footnotes, HTML-entity decoding beyond
 *     `&amp; / &lt; / &gt; / &quot; / &#39;`, definition lists,
 *     task lists, math, etc. — not part of Portfolio bodies today.
 *     Adding them is a follow-up; do not pre-implement.
 *   - No CommonMark line-compatibility edge cases (e.g. setext
 *     headings, reference links).
 *
 * External link policy (decided at render time):
 *   - Anchors that target the same origin are rendered as
 *     `<a href="…" target="_self" rel="">`.
 *   - Anchors that target a different origin (or use a non-`http(s)`
 *     scheme) are rendered with
 *     `target="_blank" rel="noopener noreferrer"`.
 *   - Schemes limited to `http:` / `https:` / relative.
 *     `javascript:`, `data:`, `file:`, `vbscript:` are stripped
 *     to `#` (no XSS path through `[click](javascript:...)`).
 *
 * Cross-references:
 *   - `docs/portfolio/decisions.md` Decision 5 — markdown is part
 *     of the foundation obligation.
 *   - `src/portfolio/components/Markdown.tsx` — the React wrapper
 *     that walks this AST and renders to JSX.
 */

export interface MarkdownLinkContext {
	/** The site origin used to decide whether a link is "external". */
	siteOrigin: string;
}

/** A parsed Markdown block. */
export type MarkdownBlock =
	| { kind: 'heading'; level: 1 | 2 | 3; children: MarkdownInline[] }
	| { kind: 'paragraph'; children: MarkdownInline[] }
	| { kind: 'list'; ordered: boolean; items: MarkdownInline[][] }
	| { kind: 'code'; lang: string; value: string }
	| { kind: 'blockquote'; children: MarkdownInline[] }
	| { kind: 'hr' };

/** A parsed inline chunk — text | strong | em | code | link. */
export type MarkdownInline =
	| { kind: 'text'; value: string }
	| { kind: 'strong'; children: MarkdownInline[] }
	| { kind: 'em'; children: MarkdownInline[] }
	| { kind: 'code'; value: string }
	| { kind: 'link'; href: string; external: boolean; children: MarkdownInline[] };

/**
 * Render markdown to a flat React tree. The caller is the React
 * wrapper in `components/Markdown.tsx`. This pure function does
 * NO React work itself; it just walks the parsed AST.
 *
 * `ctx.siteOrigin` is the production site origin used to classify
 * links.
 */
export function parseMarkdown(input: string): MarkdownBlock[] {
	const trimmed = input ?? '';
	return parseBlocks(trimmed);
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const SAFE_INLINE_ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

export function escapeInline(s: string): string {
	return s.replace(/[&<>"']/g, (ch) => SAFE_INLINE_ESCAPES[ch] ?? ch);
}

export function isExternalHref(href: string, siteOrigin: string): boolean {
	if (!href) return false;
	if (href.startsWith('/') || href.startsWith('#')) return false;
	try {
		const u = new URL(href, siteOrigin);
		if (!ALLOWED_SCHEMES.has(u.protocol)) return true;
		return u.origin !== siteOrigin;
	} catch {
		return true;
	}
}

/** Normalise href so it only carries http/https/relative. */
export function safeHref(href: string, siteOrigin: string): string {
	const trimmed = href.trim();
	if (!trimmed) return '#';
	if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
	try {
		const u = new URL(trimmed, siteOrigin);
		if (ALLOWED_SCHEMES.has(u.protocol)) return u.toString();
	} catch {
		// fall through
	}
	return '#';
}

function parseBlocks(input: string): MarkdownBlock[] {
	const lines = input.replace(/\r\n?/g, '\n').split('\n');
	const blocks: MarkdownBlock[] = [];
	let i = 0;
	let paragraphBuffer: string[] = [];
	let listBuffer: { ordered: boolean; items: string[] } | null = null;

	const flushParagraph = () => {
		if (paragraphBuffer.length === 0) return;
		const text = paragraphBuffer.join('\n');
		blocks.push({ kind: 'paragraph', children: parseInlines(text) });
		paragraphBuffer = [];
	};
	const flushList = () => {
		if (!listBuffer) return;
		const items = listBuffer.items.map(parseInlines);
		blocks.push({
			kind: 'list',
			ordered: listBuffer.ordered,
			items,
		});
		listBuffer = null;
	};

	while (i < lines.length) {
		const raw = lines[i];
		const line = raw.trimEnd();

		// Blank line — terminates a paragraph or list.
		if (line === '') {
			flushParagraph();
			flushList();
			i++;
			continue;
		}

		// Heading.
		const headingMatch = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
		if (headingMatch) {
			flushParagraph();
			flushList();
			const level = headingMatch[1].length as 1 | 2 | 3;
			blocks.push({
				kind: 'heading',
				level,
				children: parseInlines(headingMatch[2]),
			});
			i++;
			continue;
		}

		// Horizontal rule.
		if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
			flushParagraph();
			flushList();
			blocks.push({ kind: 'hr' });
			i++;
			continue;
		}

		// Fenced code block.
		if (/^```/.test(line)) {
			flushParagraph();
			flushList();
			const lang = line.slice(3).trim();
			const buf: string[] = [];
			i++;
			while (i < lines.length && !/^```\s*$/.test(lines[i])) {
				buf.push(lines[i]);
				i++;
			}
			// Skip closing fence if present.
			if (i < lines.length && /^```\s*$/.test(lines[i])) i++;
			blocks.push({ kind: 'code', lang, value: buf.join('\n') });
			continue;
		}

		// Blockquote (single-line or simple prefix).
		if (/^>\s?/.test(line)) {
			flushParagraph();
			flushList();
			const buf: string[] = [];
			while (i < lines.length && /^>\s?/.test(lines[i])) {
				buf.push(lines[i].replace(/^>\s?/, ''));
				i++;
			}
			blocks.push({
				kind: 'blockquote',
				children: parseInlines(buf.join(' ')),
			});
			continue;
		}

		// List item.
		const ulMatch = /^[-*]\s+(.+)$/.exec(line);
		if (ulMatch) {
			flushParagraph();
			if (!listBuffer || listBuffer.ordered) {
				flushList();
				listBuffer = { ordered: false, items: [] };
			}
			listBuffer.items.push(ulMatch[1]);
			i++;
			continue;
		}
		const olMatch = /^\d+\.\s+(.+)$/.exec(line);
		if (olMatch) {
			flushParagraph();
			if (!listBuffer || !listBuffer.ordered) {
				flushList();
				listBuffer = { ordered: true, items: [] };
			}
			listBuffer.items.push(olMatch[1]);
			i++;
			continue;
		}

		// Default — paragraph accumulation.
		if (listBuffer) flushList();
		paragraphBuffer.push(line);
		i++;
	}

	flushParagraph();
	flushList();
	return blocks;
}

function parseInlines(input: string): MarkdownInline[] {
	const out: MarkdownInline[] = [];
	let i = 0;
	let buf = '';
	const flushText = () => {
		if (buf) {
			out.push({ kind: 'text', value: buf });
			buf = '';
		}
	};

	while (i < input.length) {
		const ch = input[i];

		// Inline code.
		if (ch === '`') {
			const close = input.indexOf('`', i + 1);
			if (close !== -1) {
				flushText();
				out.push({ kind: 'code', value: input.slice(i + 1, close) });
				i = close + 1;
				continue;
			}
		}

		// Strong (**) — single-level only.
		if (ch === '*' && input[i + 1] === '*') {
			const end = input.indexOf('**', i + 2);
			if (end !== -1) {
				flushText();
				out.push({
					kind: 'strong',
					children: parseInlines(input.slice(i + 2, end)),
				});
				i = end + 2;
				continue;
			}
		}

		// Single * or _ for em.
		if (ch === '*' || ch === '_') {
			const marker = ch;
			const end = findUnmatchedMarker(input, i + 1, marker);
			if (end !== -1) {
				flushText();
				out.push({
					kind: 'em',
					children: parseInlines(input.slice(i + 1, end)),
				});
				i = end + 1;
				continue;
			}
		}

		// Link [text](href).
		if (ch === '[') {
			const closeText = input.indexOf(']', i + 1);
			if (closeText !== -1 && input[closeText + 1] === '(') {
				const closeHref = findLinkCloseParen(input, closeText + 1);
				if (closeHref !== -1) {
					const text = input.slice(i + 1, closeText);
					const href = input.slice(closeText + 2, closeHref).trim();
					flushText();
					out.push({
						kind: 'link',
						href,
						external: false, // filled in at render time
						children: parseInlines(text),
					});
					i = closeHref + 1;
					continue;
				}
			}
		}

		// Escape sequences — backslash before an inline marker.
		if (ch === '\\' && i + 1 < input.length && /[*_`[\\]/.test(input[i + 1])) {
			buf += input[i + 1];
			i += 2;
			continue;
		}

		buf += ch;
		i++;
	}

	flushText();
	return out;
}

function findMatchingParen(input: string, start: number): number {
	let depth = 0;
	for (let i = start; i < input.length; i++) {
		const ch = input[i];
		if (ch === '(') depth++;
		else if (ch === ')') {
			if (depth === 0) return i;
			depth--;
		}
	}
	return -1;
}

/**
 * Locate the closing parenthesis of a Markdown link. The first
 * `)` at depth 0 is the close — parens inside the href are NOT
 * balanced (CommonMark allows balanced parens, but the
 * Portfolio surface does not need to support them and the
 * simpler rule avoids the `[click](javascript:alert(1))`
 * false-negative).
 */
function findLinkCloseParen(input: string, start: number): number {
	for (let i = start; i < input.length; i++) {
		if (input[i] === ')') return i;
	}
	return -1;
}

function findUnmatchedMarker(input: string, start: number, marker: string): number {
	for (let i = start; i < input.length; i++) {
		if (input[i] === marker) {
			// Avoid matching a double marker as a single.
			if (input[i + 1] === marker) return -1;
			return i;
		}
	}
	return -1;
}

/**
 * Render an inline node to a React tree.
 *
 * Implemented in `src/portfolio/components/Markdown.tsx` because
 * the project separates pure `.ts` (parser / AST) from `.tsx`
 * (JSX rendering). This lexer module is the source of the AST and
 * helpers; the React wrapper walks the AST and renders it.
 */
