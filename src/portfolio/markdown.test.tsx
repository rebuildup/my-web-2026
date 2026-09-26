import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { escapeInline, isExternalHref, parseMarkdown, safeHref } from './markdown.lexer';
import { PortfolioMarkdown, renderInline } from './components/Markdown';

/**
 * Tests for the minimal Markdown renderer (Issue #77).
 *
 * Scope per Decision 5: `parseMarkdown` returns the AST; the
 * React rendering layer in `components/Markdown.tsx` renders it.
 * Both layers are exercised here with structural assertions
 * against React's static markup output.
 */

describe('markdown: helpers', () => {
	it('escapeInline escapes HTML-active characters', () => {
		expect(escapeInline('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
	});

	it('isExternalHref classifies origin', () => {
		const origin = 'https://rebuildup.dev';
		expect(isExternalHref('/portfolio/foo', origin)).toBe(false);
		expect(isExternalHref('#section', origin)).toBe(false);
		expect(isExternalHref('https://rebuildup.dev/foo', origin)).toBe(false);
		expect(isExternalHref('https://example.com/x', origin)).toBe(true);
		expect(isExternalHref('javascript:alert(1)', origin)).toBe(true);
	});

	it('safeHref strips javascript: scheme', () => {
		const origin = 'https://rebuildup.dev';
		expect(safeHref('javascript:alert(1)', origin)).toBe('#');
		expect(safeHref('vbscript:foo', origin)).toBe('#');
		expect(safeHref('data:text/html,<script>', origin)).toBe('#');
		expect(safeHref('https://example.com', origin)).toBe('https://example.com/');
		expect(safeHref('/x', origin)).toBe('/x');
	});
});

describe('markdown: parseMarkdown AST', () => {
	it('parses headings and paragraphs', () => {
		const ast = parseMarkdown('# Title\n\nA paragraph');
		expect(ast).toHaveLength(2);
		expect(ast[0].kind).toBe('heading');
		if (ast[0].kind === 'heading') expect(ast[0].level).toBe(1);
		expect(ast[1].kind).toBe('paragraph');
	});

	it('parses ## and ### headings with the right level', () => {
		const ast = parseMarkdown('## H2\n\n### H3\n');
		expect(ast.map((b) => (b.kind === 'heading' ? b.level : null))).toEqual([2, 3]);
	});

	it('parses fenced code blocks', () => {
		const ast = parseMarkdown('```ts\nconst a = 1;\n```');
		expect(ast).toHaveLength(1);
		expect(ast[0].kind).toBe('code');
		if (ast[0].kind === 'code') {
			expect(ast[0].lang).toBe('ts');
			expect(ast[0].value).toBe('const a = 1;');
		}
	});

	it('parses inline code and bold', () => {
		const ast = parseMarkdown('A `code` and **strong** here.');
		expect(ast).toHaveLength(1);
		if (ast[0].kind === 'paragraph') {
			const kinds = ast[0].children.map((c) => c.kind);
			expect(kinds).toContain('code');
			expect(kinds).toContain('strong');
			expect(kinds).toContain('text');
		}
	});

	it('parses links with the raw href exposed', () => {
		const ast = parseMarkdown('[text](https://example.com/x)');
		if (ast[0].kind === 'paragraph') {
			const link = ast[0].children.find((c) => c.kind === 'link');
			expect(link).toBeDefined();
			if (link?.kind === 'link') expect(link.href).toBe('https://example.com/x');
		}
	});

	it('parses ordered and unordered lists', () => {
		const ulAst = parseMarkdown('- one\n- two\n');
		expect(ulAst[0].kind).toBe('list');
		if (ulAst[0].kind === 'list') {
			expect(ulAst[0].ordered).toBe(false);
			expect(ulAst[0].items).toHaveLength(2);
		}
		const olAst = parseMarkdown('1. one\n2. two\n');
		expect(olAst[0].kind).toBe('list');
		if (olAst[0].kind === 'list') {
			expect(olAst[0].ordered).toBe(true);
			expect(olAst[0].items).toHaveLength(2);
		}
	});

	it('parses horizontal rules', () => {
		const ast = parseMarkdown('---\n');
		expect(ast[0].kind).toBe('hr');
	});

	it('parseMarkdown returns empty array for empty input', () => {
		expect(parseMarkdown('')).toEqual([]);
	});
});

describe('markdown: rendering (React)', () => {
	const ORIGIN = 'https://rebuildup.dev';

	function render(input: string): string {
		return renderToStaticMarkup(
			createElement(PortfolioMarkdown, { source: input, siteOrigin: ORIGIN }),
		);
	}

	it('renders external link with target=_blank and rel=noopener noreferrer', () => {
		const html = render('See [docs](https://example.com/).');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	it('renders internal link without target=_blank', () => {
		const html = render('See [portfolio](/portfolio).');
		expect(html).toContain('href="/portfolio"');
		expect(html).not.toContain('target="_blank"');
	});

	it('strips javascript: links to a # anchor', () => {
		const html = render('[click](javascript:alert(1))');
		expect(html).not.toContain('javascript:');
		expect(html).toMatch(/href="#"/);
	});

	it('hides empty source (renders nothing)', () => {
		expect(render('')).toBe('');
		expect(render('   \n\n  ')).toBe('');
	});

	it('omits code / strong / em nodes only when present', () => {
		const html = render('Plain text only.');
		expect(html).toContain('Plain text only.');
		expect(html).toContain('<p');
	});

	it('renders fenced code inside <pre><code>', () => {
		const html = render('```\nconst a = 1;\n```');
		expect(html).toContain('<pre');
		expect(html).toContain('<code>const a = 1;</code>');
	});

	it('renders headings through the wrapper', () => {
		const html = render('### Sub\n');
		// Sub-heading uses <h5> via the wrapper (h1/h2 are reserved for the page).
		expect(html).toContain('<h5');
	});

	it('escapes raw HTML in input', () => {
		const html = render('<script>alert(1)</script>');
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('inline code does not parse surrounding markdown inside the code', () => {
		const ast = parseMarkdown('Run `npm run dev` today.');
		if (ast[0].kind === 'paragraph') {
			const code = ast[0].children.find((c) => c.kind === 'code');
			expect(code?.kind === 'code' && code.value).toBe('npm run dev');
		}
	});

	it('renderInline emits the expected DOM for hand-built inline tree', () => {
		const html = renderToStaticMarkup(
			<div>
				{renderInline(
					[
						{ kind: 'text', value: 'hi ' },
						{
							kind: 'link',
							href: 'https://example.com',
							external: false,
							children: [{ kind: 'text', value: 'ext' }],
						},
					] as const,
					{ siteOrigin: ORIGIN },
					'k',
				)}
			</div>,
		);
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com\//);
		expect(html).toContain('ext');
	});
});
