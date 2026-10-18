import type { ComponentType } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PortfolioMarkdown } from './components/Markdown';
import { FIXTURE_SITE_ORIGIN, HOSTILE_MD, TECHNICAL_ARTICLE_MD } from './fixtures/markdown';
import { parseMarkdown } from './markdown.lexer';

/**
 * Markdown safety regression suite (Issue #435).
 *
 * Issue #77 shipped the renderer; this suite pins the contract that makes
 * it safe to put an operator-authored technical article behind it. The two
 * fixtures under `fixtures/markdown/` are the whole input surface:
 *
 *   - `technical-article.md` — every supported construct plus every
 *     UNSUPPORTED construct written into the article itself, so the
 *     "keep the meaning, keep the numbers, keep the negation" claims are
 *     checked against text the repository itself can verify.
 *   - `hostile.md` — script / event-handler / dangerous-scheme payloads.
 *
 * Three claims are separated here on purpose, because they are commonly
 * conflated and only one of them is a rendering concern:
 *
 *   1. SAFETY — dangerous input is inert. Asserted structurally below:
 *      no element the fixture names, no event-handler attribute, no
 *      scheme outside http(s)/relative.
 *   2. TYPOGRAPHY — the renderer maps Markdown to markup deterministically.
 *      Same source in, same markup out, byte for byte. No smart quotes, no
 *      ellipsis folding, no dash substitution, no locale inference.
 *   3. TEXT QUALITY — whether the prose is accurate, non-speculative and
 *      review-ready. NOT a renderer property. Nothing here can certify it;
 *      the fixture only proves the renderer does not alter what a human
 *      wrote. See `docs/portfolio/markdown-format.md`.
 *
 * `markdown.test.tsx` remains the unit-level AST/render suite; this file
 * is the fixture-level regression suite the Issue asks for.
 */

/** Render a source through the real component and return static markup. */
function render(source: string, siteOrigin: string = FIXTURE_SITE_ORIGIN): string {
	return renderToStaticMarkup(createElement(PortfolioMarkdown, { source, siteOrigin }));
}

/** Every tag in a markup string, for attribute-level assertions. */
function tagsIn(html: string): string[] {
	return html.match(/<[^>]*>/g) ?? [];
}

/** Every `href` value in a markup string, in document order. */
function hrefsIn(html: string): string[] {
	return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

/** Every anchor in a markup string, with the two link-policy attributes. */
function anchorsIn(html: string): { href: string; target: string; rel: string }[] {
	return tagsIn(html)
		.filter((tag) => tag.startsWith('<a '))
		.map((tag) => ({
			href: /href="([^"]*)"/.exec(tag)?.[1] ?? '',
			target: /target="([^"]*)"/.exec(tag)?.[1] ?? '',
			rel: /rel="([^"]*)"/.exec(tag)?.[1] ?? '',
		}));
}

/**
 * Text a reader sees. Block-level tags contribute a line break the way a
 * browser gives them; inline tags contribute nothing, so adjacent inline
 * elements join exactly as they render on screen. Entities are decoded
 * last so `<script>` in the source reads back as the characters shown.
 */
function visibleText(html: string): string {
	const withBlockBreaks = html.replace(
		/<\/?(?:p|h[1-6]|li|ul|ol|pre|blockquote|div|br|hr|table|tr|td|th|section|article)\b[^>]*>/g,
		'\n',
	);
	return decodeEntities(withBlockBreaks.replace(/<[^>]*>/g, ''))
		.replace(/\s+/g, ' ')
		.trim();
}

/** Undo the entity escaping React applies to text nodes and attributes. */
function decodeEntities(value: string): string {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&');
}

/**
 * The text a reader must still see for one source line: the line with its
 * Markdown markers removed and nothing else. Anything this function has to
 * "correct" is a place where the renderer is allowed to change meaning.
 */
function withoutMarkdownMarkers(line: string): string {
	return line
		.trim()
		.replace(/^`{3,}[^`]*$/, '')
		.replace(/^#{1,6}\s+/, '')
		.replace(/^[-*]\s+/, '')
		.replace(/^\d+\.\s+/, '')
		.replace(/^>\s?/, '')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/^(-{3,}|\*{3,}|_{3,})$/, '')
		.trim();
}

const ARTICLE_LINES = TECHNICAL_ARTICLE_MD.split('\n').map(withoutMarkdownMarkers).filter(Boolean);

describe('markdown safety: dangerous input never becomes executable', () => {
	const html = render(HOSTILE_MD);

	it('renders no element the hostile fixture tries to inject', () => {
		for (const injected of ['script', 'iframe', 'img', 'svg', 'a href="javascript']) {
			expect(html.toLowerCase()).not.toContain(`<${injected}`);
		}
	});

	it('attaches no event-handler attribute to any tag', () => {
		const handlers = tagsIn(html).filter((tag) => /\son[a-z]+\s*=/i.test(tag));
		expect(handlers).toEqual([]);
	});

	it('keeps the payloads visible as inert text instead of dropping them', () => {
		const text = visibleText(html);
		expect(text).toContain('<script>alert(1)</script>');
		expect(text).toContain('<img src=x onerror="alert(1)">');
		expect(text).toContain('<svg/onload=alert(1)>');
		expect(text).toContain('<iframe src="https://example.com/frame"></iframe>');
		expect(text).toContain('<a href="javascript:alert(1)">raw anchor</a>');
		expect(text).toContain('引用の中の <script>alert(2)</script> も inert。');
	});

	it('resolves every anchor to http(s), relative, or the inert fallback', () => {
		const anchors = anchorsIn(html);
		expect(anchors.length).toBeGreaterThan(0);
		const stripped = anchors.filter((anchor) => anchor.href === '#');
		// javascript:, JaVaScRiPt:, whitespace-padded javascript:, data: and
		// vbscript: payloads all collapse onto the same inert fallback.
		expect(stripped.length).toBeGreaterThanOrEqual(5);
		for (const anchor of anchors) {
			expect(
				anchor.href === '#' ||
					anchor.href.startsWith('/') ||
					/^https:\/\/example\.com\//.test(anchor.href),
			).toBe(true);
		}
	});

	it('classifies the surviving links by origin', () => {
		const anchors = anchorsIn(html);
		const external = anchors.filter((anchor) => anchor.href.startsWith('https://example.com/'));
		// The quote-breakout payload resolves to an https URL on the same
		// host, so classification is by ORIGIN, not by intent.
		expect(external).toHaveLength(2);
		for (const anchor of external) {
			expect(anchor.target).toBe('_blank');
			expect(anchor.rel).toBe('noopener noreferrer');
		}
		const internal = anchors.filter((anchor) => anchor.href === '/portfolio');
		expect(internal).toHaveLength(1);
		expect(internal[0].target).toBe('_self');
		expect(internal[0].rel).toBe('');
	});

	it('keeps the external target on a stripped link — a known limitation', () => {
		// `isExternalHref` classifies by origin, so a link whose scheme was
		// stripped still inherits `target="_blank"` next to its `href="#"`.
		// Documented in docs/portfolio/markdown-format.md § Known
		// limitations; pinned here so the follow-up fix is a visible change.
		const stripped = anchorsIn(html).filter((anchor) => anchor.href === '#');
		expect(stripped.every((anchor) => anchor.target === '_blank')).toBe(true);
	});

	it('escapes markup inside a fenced code block instead of parsing it', () => {
		expect(html).toContain('<pre');
		expect(decodeEntities(html)).toContain('alert(3)');
		expect(tagsIn(html).some((tag) => /^<script/i.test(tag))).toBe(false);
	});
});

describe('markdown safety: the sample article keeps its claim', () => {
	const html = render(TECHNICAL_ARTICLE_MD);
	const text = visibleText(html);

	it('renders without dropping a single source line', () => {
		expect(ARTICLE_LINES.length).toBeGreaterThan(20);
		for (const line of ARTICLE_LINES) {
			expect(text).toContain(line);
		}
	});

	it('keeps the numbers, the negation and the authority statement verbatim', () => {
		for (const claim of [
			'block は 6 種類',
			'inline は 5 種類',
			'数値 `3` は `3` のまま',
			'これはレビュー済みの結論ではない',
			'権限は owner ではなく obligation で記述される',
			'Markdown 文法の実装は lexer の 1 ファイルに限られる',
		]) {
			expect(text).toContain(withoutMarkdownMarkers(claim));
		}
	});

	it('does not publish anything the article did not already contain', () => {
		// No summariser, no auto-title, no teaser: the rendered text is a
		// subset of the source characters plus Markdown markers, so a
		// speculative sentence cannot be introduced by the renderer.
		const sourceCharacters = new Set(`${TECHNICAL_ARTICLE_MD}${'"\'`*-_#>'}`);
		for (const character of new Set(text)) {
			expect(sourceCharacters.has(character)).toBe(true);
		}
	});

	it('maps heading depth onto the page-owned h3/h4/h5 slots', () => {
		expect(tagsIn(html).some((tag) => /^<h1[\s>]/.test(tag))).toBe(false);
		expect(tagsIn(html).some((tag) => /^<h2[\s>]/.test(tag))).toBe(false);
		expect(tagsIn(html).filter((tag) => /^<h3[\s>]/.test(tag))).toHaveLength(1);
		expect(tagsIn(html).filter((tag) => /^<h4[\s>]/.test(tag))).toHaveLength(4);
	});

	it('renders the supported structures the article exercises', () => {
		for (const pattern of [
			/<p[\s>]/,
			/<ul[\s>]/,
			/<ol[\s>]/,
			/<li[\s>]/,
			/<pre[\s>]/,
			/<code[\s>]/,
			/<blockquote[\s>]/,
			/<hr[\s>]/,
			/<a[\s>]/,
		]) {
			expect(tagsIn(html).some((found) => pattern.test(found))).toBe(true);
		}
	});

	it('reuses the same blockquote and code content the author wrote', () => {
		expect(text).toContain('引用は連続する行を 1 段落に結合する。');
		expect(text).toContain(
			"const BLOCK_KINDS = ['heading', 'paragraph', 'list', 'code', 'blockquote', 'hr'] as const;",
		);
	});
});

describe('markdown safety: unsupported syntax degrades to literal text', () => {
	it('leaves every unrecognised construct in the paragraph as written', () => {
		const text = visibleText(render(TECHNICAL_ARTICLE_MD));
		for (const literal of [
			'[^1]',
			'[^1]: 定義',
			'| 構文 | 判定 |',
			'| --- | --- |',
			'$E = mc^2$',
			'$$\\sum_{i=1}^{n} i$$',
			'~~未確定~~',
			'- [ ] 読書中',
		]) {
			expect(text).toContain(literal);
		}
	});

	it('parses those constructs as plain paragraphs, not as new block kinds', () => {
		const kinds = new Set(parseMarkdown(TECHNICAL_ARTICLE_MD).map((block) => block.kind));
		expect([...kinds].sort()).toEqual(['blockquote', 'code', 'heading', 'hr', 'list', 'paragraph']);
	});

	it('does not treat a fourth heading level as a heading', () => {
		const [block] = parseMarkdown('#### 4 段目は未対応');
		expect(block.kind).toBe('paragraph');
		expect(visibleText(render('#### 4 段目は未対応'))).toBe('#### 4 段目は未対応');
	});

	it('keeps footnote markers as text on both the reference and the definition line', () => {
		const text = visibleText(render('本文[^1]\n\n[^1]: 定義'));
		expect(text).toContain('本文[^1]');
		expect(text).toContain('[^1]: 定義');
		expect(hrefsIn(render('本文[^1]\n\n[^1]: 定義'))).toEqual([]);
	});
});

describe('markdown safety: typography is deterministic and locale-free', () => {
	it('produces identical markup for identical input', () => {
		expect(render(TECHNICAL_ARTICLE_MD)).toBe(render(TECHNICAL_ARTICLE_MD));
	});

	it('substitutes no typographic character the source did not contain', () => {
		const text = visibleText(render('引用符 "quoted" と 省略 ... と ダッシュ -- と wave ~ です。'));
		expect(text).toContain('"quoted"');
		expect(text).toContain('...');
		expect(text).toContain('--');
		for (const substituted of ['“', '”', '‘', '’', '…', '—', ' ', '−']) {
			expect(text).not.toContain(substituted);
		}
	});

	it('infers no locale: the renderer neither accepts nor emits one', () => {
		const html = render(TECHNICAL_ARTICLE_MD);
		expect(html).not.toMatch(/\slang=/i);
		expect(html).not.toMatch(/\sdir=/i);
		expect(html).not.toContain('data-locale');

		// A caller that speculatively passes locale props must not see them
		// reach the DOM — locale stays an opt-in of the consuming surface.
		const Undeclared = PortfolioMarkdown as unknown as ComponentType<Record<string, unknown>>;
		const speculative = renderToStaticMarkup(
			createElement(Undeclared, {
				source: '# 見出し\n\n本文',
				lang: 'ja',
				dir: 'rtl',
				'data-locale': 'ja-JP',
			}),
		);
		expect(speculative).not.toContain('lang=');
		expect(speculative).not.toContain('dir=');
		expect(speculative).not.toContain('data-locale');
	});

	it('preserves CJK text character for character', () => {
		const sentence = '日本語と English が混ざる行、句読点は「、」と「。」のまま。';
		expect(visibleText(render(sentence))).toBe(sentence);
	});
});

describe('markdown safety: code expressions are byte-exact', () => {
	it('renders a fenced block without touching a single character', () => {
		const source = '```ts\nconst a = 1 < 2 && "x" !== \'y\';\n```';
		const html = render(source);
		const block = html.match(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/);
		expect(block).not.toBeNull();
		expect(decodeEntities(block?.[1] ?? '')).toBe('const a = 1 < 2 && "x" !== \'y\';');
	});

	it('keeps inline code literal, including its markup characters', () => {
		const source = '演算子 `a < b && c > d` と記号 `[^1]` は inline でも解釈されない。';
		const spans = [
			...render(source).matchAll(/<code class="portfolio-md-code-inline">([\s\S]*?)<\/code>/g),
		].map((match) => decodeEntities(match[1]));
		expect(spans).toEqual(['a < b && c > d', '[^1]']);
	});

	it('never parses Markdown inside an inline code span', () => {
		const source = '`[not a link](https://example.com/)` と `**not bold**`';
		const html = render(source);
		expect(hrefsIn(html)).toEqual([]);
		expect(html).not.toContain('<strong');
	});

	it('keeps an identifier safe when it is written as a code expression', () => {
		// Recommended usage, asserted byte-exact: an identifier inside a
		// code span keeps its underscores, which is where it belongs.
		const source = '上限は `MAX_RETRY_COUNT` で設定する';
		const spans = [
			...render(source).matchAll(/<code class="portfolio-md-code-inline">([\s\S]*?)<\/code>/g),
		].map((match) => decodeEntities(match[1]));
		expect(spans).toEqual(['MAX_RETRY_COUNT']);
		expect(visibleText(render(source))).toBe('上限は MAX_RETRY_COUNT で設定する');
	});

	it('documents the known limitation: intraword underscores become emphasis', () => {
		// Known limitation, documented in docs/portfolio/markdown-format.md:
		// CommonMark does not allow intraword `_` emphasis, but this lexer
		// does, so a bare identifier loses its underscores on screen. The
		// source characters are not restored — which is why the contract
		// tells authors to wrap identifiers in a code span instead. Pinned
		// so a future fix shows up as a deliberate change to this test.
		const source = 'MAX_RETRY_COUNT を設定する';
		const ast = parseMarkdown(source);
		if (ast[0].kind === 'paragraph') {
			expect(ast[0].children.map((child) => child.kind)).toEqual(['text', 'em', 'text']);
		}
		expect(visibleText(render(source))).toBe('MAXRETRYCOUNT を設定する');
	});
});
