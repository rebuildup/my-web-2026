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
 *     `<iframe>` / arbitrary attributes. The React wrapper escapes
 *     every text node, so a `<script>` in the source reaches the
 *     DOM as visible text (`&lt;script&gt;`), never as markup.
 *     Notion-derived HTML has no such guarantee, so it never
 *     reaches this lexer unfiltered: `markdown.notion.ts` is the
 *     adapter that converts it to Markdown first (Issue #451).
 *   - Tables, images, footnotes, HTML-entity decoding beyond
 *     `&amp; / &lt; / &gt; / &quot; / &#39;`, definition lists,
 *     task lists, math, etc. — not part of Portfolio bodies today.
 *     Adding them is a follow-up; do not pre-implement.
 *   - No CommonMark line-compatibility edge cases (e.g. setext
 *     headings, reference links).
 *
 * External link policy (decided at render time, Issue #451):
 *   - Anchors that target the same origin are rendered as
 *     `<a href="…" target="_self" rel="">`.
 *   - Anchors that target a different origin are rendered with
 *     `target="_blank" rel="noopener noreferrer"`.
 *   - Schemes limited to `http:` / `https:` / relative.
 *     `javascript:`, `data:`, `file:`, `vbscript:` and anything
 *     that only *looks* relative (entity-encoded or control-char
 *     obfuscated schemes) are **blocked**, not rewritten to `#`.
 *     The renderer turns a blocked href into a visible, inert
 *     marker so the author can see the rejection instead of
 *     clicking a dead `#`. `classifyHref` is the single oracle;
 *     `safeHref` / `isExternalHref` are thin wrappers kept for
 *     callers that only need the old boolean/string shape.
 *
 * Cross-references:
 *   - `docs/portfolio/decisions.md` Decision 5 — markdown is part
 *     of the foundation obligation.
 *   - `docs/security.md` §"Markdown / Notion-derived HTML input
 *     boundary" — the input contract this module implements.
 *   - `src/portfolio/markdown.xss-fixtures.ts` — the accepted /
 *     rejected corpus both test layers assert against.
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

/**
 * Why an href was refused. Every reason is a *visible* outcome in the
 * renderer (`components/Markdown.tsx`), so an operator reviewing the
 * page can tell "the author linked a blocked URL" apart from "the
 * renderer dropped something silently".
 */
export const BLOCKED_HREF_REASONS = [
	/** The href was empty / whitespace only. */
	'empty',
	/** The href carried C0/DEL controls or Unicode line separators. */
	'control-character',
	/** The href carries a scheme other than `http:` / `https:`. */
	'scheme-not-allowed',
	/** The href only *looked* schemeless; its decoded form has one. */
	'encoded-scheme',
	/** `new URL()` refused the value. */
	'unparsable',
] as const;

export type BlockedHrefReason = (typeof BLOCKED_HREF_REASONS)[number];

/**
 * Class the renderer puts on every refused link.
 *
 * Declared here (not in the renderer, and not in the test corpus) so
 * the render contract, the documentation, and the assertions all
 * name the same string.
 */
export const BLOCKED_LINK_CLASS = 'portfolio-md-link-blocked';

/**
 * Result of classifying a Markdown link target.
 *
 * `blocked` deliberately keeps the ORIGINAL string: the renderer shows
 * it to the author (escaped, as text) so the rejection is explainable,
 * and it never becomes an attribute value.
 */
export type MarkdownHrefVerdict =
	| {
			readonly outcome: 'allowed';
			/** Normalised href: relative paths stay relative, absolute ones are URL-serialised. */
			readonly href: string;
			readonly external: boolean;
			readonly target: '_self' | '_blank';
			readonly rel: '' | 'noopener noreferrer';
	  }
	| {
			readonly outcome: 'blocked';
			readonly reason: BlockedHrefReason;
			readonly raw: string;
	  };

/**
 * ASCII C0 controls + DEL + the Unicode line / paragraph separators.
 *
 * A browser strips TAB / LF / CR out of a URL *before* the scheme
 * parser runs, so `java\tscript:alert(1)` navigates as
 * `javascript:alert(1)`. Refusing the whole value is both safer and
 * more honest than relying on the browser to normalise it.
 *
 * U+0020 (space) is deliberately NOT in this set: browsers percent-
 * encode it rather than dropping it, so it is not an obfuscation
 * vector and blocking it would refuse legitimate hrefs.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point — the pattern is the deny-list.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

/** `scheme:` per RFC 3986 §3.1, restricted to what a link may carry. */
const EXPLICIT_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Numeric character references plus the handful of named references
 * that can spell a scheme or a control character (`&#58;`, `&colon;`,
 * `&Tab;`, …).
 *
 * React escapes `&` when it writes an attribute, so the DOM value the
 * browser sees is the RAW string. This decoder is therefore a
 * defence-in-depth check, not the primary defence: it catches the
 * value *before* it is written, and it also covers the non-React
 * consumers of this module (migration tooling, exports). Unknown
 * entities are left literal — a literal `&foo;` in a URL is an
 * ordinary path character.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	apos: "'",
	colon: ':',
	gt: '>',
	lt: '<',
	nbsp: ' ',
	NewLine: '\n',
	quot: '"',
	semi: ';',
	sol: '/',
	Tab: '\t',
};

// The body MUST stay a capturing group: the replacer receives it as
// `p1`, and a non-capturing alternative would hand the callback the
// match OFFSET instead of the entity body.
const ENTITY_PATTERN = /&((?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31}));?/g;

/**
 * Decode HTML character references. Used for CLASSIFICATION ONLY —
 * the emitted href is derived from the decoded value because that is
 * what a browser would navigate to.
 */
export function decodeHtmlEntities(value: string): string {
	return value.replace(ENTITY_PATTERN, (match, body: string) => {
		if (body.startsWith('#')) {
			const codePoint =
				body[1] === 'x' || body[1] === 'X'
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
			try {
				return String.fromCodePoint(codePoint);
			} catch {
				return match;
			}
		}
		const decoded = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
		return decoded ?? match;
	});
}

/**
 * The single oracle for "may this href become an anchor target?".
 *
 * Order matters: emptiness, then control characters (both on the raw
 * value and after entity decoding), then the same-origin fast path,
 * then `new URL()` resolution against the site origin.
 *
 * Protocol-relative hrefs (`//host/path`) are resolved rather than
 * passed through: they leave the site origin, so they must inherit
 * the external-link policy (`target=_blank rel=noopener noreferrer`)
 * instead of masquerading as an internal path.
 */
export function classifyHref(raw: string, siteOrigin: string): MarkdownHrefVerdict {
	const original = typeof raw === 'string' ? raw : '';
	const trimmed = original.trim();
	if (trimmed === '') return { outcome: 'blocked', reason: 'empty', raw: original };
	if (CONTROL_CHARACTERS.test(trimmed)) {
		return { outcome: 'blocked', reason: 'control-character', raw: original };
	}

	const value = decodeHtmlEntities(trimmed);
	if (CONTROL_CHARACTERS.test(value)) {
		return { outcome: 'blocked', reason: 'control-character', raw: original };
	}

	if (value.startsWith('#')) return allowed(value, siteOrigin, false);
	if (value.startsWith('/') && !value.startsWith('//')) return allowed(value, siteOrigin, false);

	const resolved = resolveAbsolute(value, siteOrigin);
	if (resolved.outcome === 'blocked') {
		// A schemeless-looking raw value that decodes into a scheme is
		// the entity-encoding bypass (`javascript&#58;…`); report it as
		// its own reason so the visible error names the real cause.
		if (resolved.reason === 'scheme-not-allowed' && !EXPLICIT_SCHEME.test(trimmed)) {
			return { outcome: 'blocked', reason: 'encoded-scheme', raw: original };
		}
		// `resolveAbsolute` classifies the DECODED value, so its `raw` is
		// the decoded text; the contract above is the ORIGINAL string the
		// author wrote, which is what an operator needs to see in order to
		// fix the link.
		return { ...resolved, raw: original };
	}
	return resolved;
}

function allowed(href: string, siteOrigin: string, external: boolean): MarkdownHrefVerdict {
	return {
		outcome: 'allowed',
		href,
		external,
		target: external ? '_blank' : '_self',
		rel: external ? 'noopener noreferrer' : '',
	};
}

function resolveAbsolute(value: string, siteOrigin: string): MarkdownHrefVerdict {
	let url: URL;
	try {
		url = new URL(value, siteOrigin);
	} catch {
		return { outcome: 'blocked', reason: 'unparsable', raw: value };
	}
	if (!ALLOWED_SCHEMES.has(url.protocol)) {
		return { outcome: 'blocked', reason: 'scheme-not-allowed', raw: value };
	}
	return allowed(url.toString(), siteOrigin, url.origin !== siteOrigin);
}

/**
 * `true` when the href leaves the site origin.
 *
 * A blocked href counts as external: it is definitely not something
 * this site should own. An EMPTY href does not — it is a malformed
 * link, not an off-site one.
 */
export function isExternalHref(href: string, siteOrigin: string): boolean {
	const verdict = classifyHref(href, siteOrigin);
	if (verdict.outcome === 'allowed') return verdict.external;
	return verdict.reason !== 'empty';
}

/**
 * Normalise href so it only carries http/https/relative.
 *
 * Blocked hrefs collapse to `#` so no caller can smuggle a dangerous
 * value into an attribute. The renderer does NOT use this for
 * rendering — it renders the blocked marker from `classifyHref`
 * instead, so the rejection stays visible.
 */
export function safeHref(href: string, siteOrigin: string): string {
	const verdict = classifyHref(href, siteOrigin);
	return verdict.outcome === 'blocked' ? '#' : verdict.href;
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

		// Fenced code block. The opening run is 3+ backticks (CommonMark),
		// and only a run at least as long closes it, so a 4-backtick fence
		// can hold a body that itself contains ```.
		const fenceOpen = /^(`{3,})([^`]*)$/.exec(line);
		if (fenceOpen) {
			flushParagraph();
			flushList();
			const marker = fenceOpen[1];
			const lang = fenceOpen[2].trim();
			const closeRe = new RegExp(`^\`{${marker.length},}\\s*$`);
			const buf: string[] = [];
			i++;
			while (i < lines.length && !closeRe.test(lines[i])) {
				buf.push(lines[i]);
				i++;
			}
			// Skip closing fence if present.
			if (i < lines.length && closeRe.test(lines[i])) i++;
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

/**
 * Close an inline code span opened by a run of `runLength` backticks.
 *
 * CommonMark rule: the span ends at the next run of AT LEAST that many
 * backticks, and a backslash does not escape one. Returning the end of
 * the closing run (not its first backtick) is what keeps the scan
 * aligned for the rest of the line.
 */
function findCodeSpanClose(
	input: string,
	from: number,
	runLength: number,
): { value: string; end: number } | null {
	let i = from;
	while (i < input.length) {
		if (input[i] !== '`') {
			i++;
			continue;
		}
		let j = i;
		while (j < input.length && input[j] === '`') j++;
		if (j - i >= runLength) return { value: input.slice(from, i), end: j };
		i = j;
	}
	return null;
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

		// Inline code. The opening run is 1+ backticks and only a run at
		// least as long closes it, so a span can carry a backtick of its
		// own when the writer uses a longer delimiter.
		if (ch === '`') {
			let runEnd = i;
			while (runEnd < input.length && input[runEnd] === '`') runEnd++;
			const close = findCodeSpanClose(input, runEnd, runEnd - i);
			if (close) {
				flushText();
				out.push({ kind: 'code', value: close.value });
				i = close.end;
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
