import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PortfolioMarkdown } from './components/Markdown';
import { BLOCKED_LINK_CLASS, parseMarkdown } from './markdown.lexer';
import { sanitizeNotionHtml } from './markdown.notion';
import { executableMarkupFindings } from './markdown.xss-fixtures';

/**
 * Notion-derived HTML sanitiser (Issue #451).
 *
 * The payloads below are attack simulations committed on purpose so
 * the adapter can be reviewed. They contain no credentials and no
 * live third-party origin (`example.com` / `example.invalid` are
 * reserved for documentation by RFC 2606 / RFC 6761).
 *
 * The assertions that matter are the round-trip ones: sanitised HTML
 * is rendered through the REAL article renderer and the output is
 * checked with the same `executableMarkupFindings` oracle the
 * Markdown corpus uses. A sanitiser that "looks right" but emits
 * Markdown the lexer renders into live markup would fail there.
 */

const ORIGIN = 'https://rebuildup.dev';

function renderMarkdown(markdown: string): string {
	return renderToStaticMarkup(
		createElement(PortfolioMarkdown, { source: markdown, siteOrigin: ORIGIN }),
	);
}

function reasonsFor(html: string): string[] {
	return sanitizeNotionHtml(html).dropped.map((entry) => entry.reason);
}

describe('notion html: active content is dropped with its subtree', () => {
	it('drops <script> and its body', () => {
		const result = sanitizeNotionHtml(
			'<p>before</p><script>window.__xssFired=1</script><p>after</p>',
		);
		expect(result.markdown).toBe('before\n\nafter');
		expect(result.markdown).not.toContain('__xssFired');
		expect(result.dropped.map((d) => d.reason)).toContain('active-element');
	});

	it('drops <style>, <iframe>, <svg>, <object>, <embed>, <form>', () => {
		const result = sanitizeNotionHtml(
			[
				'<style>body{display:none}</style>',
				'<iframe src="https://example.invalid/frame"></iframe>',
				'<svg onload="window.__xssFired=1"></svg>',
				'<object data="https://example.invalid/o"></object>',
				'<embed src="https://example.invalid/e">',
				'<form action="https://example.invalid/post"><input name="a"></form>',
			].join('\n'),
		);
		expect(result.markdown).not.toContain('iframe');
		expect(result.markdown).not.toContain('svg');
		expect(result.markdown).not.toContain('__xssFired');
		expect(result.markdown).not.toContain('display:none');
	});

	it('drops a nested active element hidden inside a kept element', () => {
		const result = sanitizeNotionHtml(
			'<div><p>keep me<script>window.__xssFired=1</script></p></div>',
		);
		expect(result.markdown).toContain('keep me');
		expect(result.markdown).not.toContain('__xssFired');
	});
});

describe('notion html: attributes are allow-listed', () => {
	it('drops every on* handler and records it', () => {
		const result = sanitizeNotionHtml('<p onclick="window.__xssFired=1" onmouseover="x">text</p>');
		expect(result.markdown).toBe('text');
		expect(reasonsFor('<img src=x onerror="window.__xssFired=1">')).toContain(
			'event-handler-attribute',
		);
	});

	it('drops style / class / id / data-* attributes', () => {
		const result = sanitizeNotionHtml(
			'<p style="position:fixed;inset:0" class="x" id="y" data-evil="1">text</p>',
		);
		expect(result.markdown).toBe('text');
		expect(result.dropped.map((d) => d.reason)).toContain('dropped-attribute');
	});

	it('keeps a safe href and refuses an unsafe one', () => {
		const safe = sanitizeNotionHtml('<a href="https://example.com/docs">docs</a>');
		expect(safe.markdown).toBe('[docs](https://example.com/docs)');
		expect(safe.dropped).toHaveLength(0);

		const unsafe = sanitizeNotionHtml('<a href="javascript:window.__xssFired=1">click</a>');
		expect(unsafe.markdown).toBe('click');
		expect(unsafe.markdown).not.toContain('javascript:');
		expect(unsafe.dropped.map((d) => d.reason)).toContain('unsafe-url');
	});

	it('refuses entity-encoded and control-char obfuscated hrefs too', () => {
		for (const href of [
			'javascript&#58;window.__xssFired=1',
			'javascript&colon;window.__xssFired=1',
			'data:text/html,<script>window.__xssFired=1</script>',
			'vbscript:msgbox(1)',
		]) {
			const result = sanitizeNotionHtml(`<a href="${href}">click</a>`);
			expect(result.markdown, href).not.toContain('](');
			expect(
				result.dropped.map((d) => d.reason),
				href,
			).toContain('unsafe-url');
		}
	});
});

describe('notion html: allowed structure becomes Markdown', () => {
	it('maps headings, paragraphs and emphasis', () => {
		const result = sanitizeNotionHtml(
			'<h2>Title</h2><p>Some <strong>bold</strong> and <em>italic</em> and <code>code</code>.</p>',
		);
		expect(result.markdown).toBe('## Title\n\nSome **bold** and *italic* and `code`.');
	});

	it('clamps deep headings to the depth the renderer supports', () => {
		expect(sanitizeNotionHtml('<h5>deep</h5>').markdown).toBe('### deep');
	});

	it('maps lists, nested lists and blockquotes', () => {
		expect(sanitizeNotionHtml('<ul><li>one</li><li>two</li></ul>').markdown).toBe('- one\n- two');
		expect(sanitizeNotionHtml('<ol><li>one</li><li>two</li></ol>').markdown).toBe('1. one\n2. two');
		expect(sanitizeNotionHtml('<ul><li>outer<ul><li>inner</li></ul></li></ul>').markdown).toBe(
			'- outer\n  - inner',
		);
		expect(sanitizeNotionHtml('<blockquote><p>quoted</p></blockquote>').markdown).toBe('> quoted');
	});

	it('maps <pre><code> to a fenced block and keeps the language', () => {
		const result = sanitizeNotionHtml('<pre><code class="language-ts">const a = 1;</code></pre>');
		expect(result.markdown).toBe('```ts\nconst a = 1;\n```');
	});

	it('lengthens the fence so a body containing ``` stays inside the code block', () => {
		const body = '<pre><code>a\n```\nwindow.__xssFired=1\n```\nb</code></pre>';
		const result = sanitizeNotionHtml(body);
		expect(result.markdown).toBe('````\na\n```\nwindow.__xssFired=1\n```\nb\n````');

		// Round-trip through the REAL renderer: the fence must survive
		// as ONE code node, or the payload leaks into the article text.
		const ast = parseMarkdown(result.markdown);
		expect(ast).toHaveLength(1);
		expect(ast[0].kind).toBe('code');
		if (ast[0].kind === 'code') expect(ast[0].value).toBe('a\n```\nwindow.__xssFired=1\n```\nb');
	});

	it('lengthens the inline code delimiter so <code> carrying a backtick round-trips', () => {
		const result = sanitizeNotionHtml('<p>a <code>x`y</code> b</p>');
		expect(result.markdown).toBe('a ``x`y`` b');

		const ast = parseMarkdown(result.markdown);
		expect(ast).toHaveLength(1);
		if (ast[0].kind === 'paragraph') {
			expect(ast[0].children).toEqual([
				{ kind: 'text', value: 'a ' },
				{ kind: 'code', value: 'x`y' },
				{ kind: 'text', value: ' b' },
			]);
		}
	});

	it('drops comments and doctypes', () => {
		const result = sanitizeNotionHtml(
			'<!doctype html><!-- <script>window.__xssFired=1</script> --><p>text</p>',
		);
		expect(result.markdown).toBe('text');
		expect(result.markdown).not.toContain('__xssFired');
	});

	it('unwraps unknown elements but keeps their text', () => {
		const result = sanitizeNotionHtml('<section><custom-tag>kept</custom-tag></section>');
		expect(result.markdown).toContain('kept');
		expect(result.dropped.map((d) => d.reason)).toContain('unknown-element');
	});

	it('escapes text that would otherwise invent Markdown structure', () => {
		const result = sanitizeNotionHtml('<p>[x](javascript:alert(1)) and *stars*</p>');
		expect(result.markdown).toContain('\\*stars\\*');
		expect(parseMarkdown(result.markdown).length).toBeGreaterThan(0);
	});
});

describe('notion html: malformed input degrades instead of throwing', () => {
	it.each([
		['unclosed tag', '<p>text'],
		['stray close tag', 'text</div>'],
		['unclosed active element', '<p>keep</p><script>window.__xssFired=1'],
		['lone angle bracket', '5 < 7 and 9 > 2'],
		['bare ampersand', 'a & b &notanentity; c'],
		['empty input', ''],
		['not a string', null as unknown as string],
	])('handles %s', (_label, html) => {
		const result = sanitizeNotionHtml(html);
		expect(typeof result.markdown).toBe('string');
		expect(result.markdown).not.toContain('__xssFired');
		expect(executableMarkupFindings(renderMarkdown(result.markdown))).toEqual([]);
	});

	it('bounds deeply nested input', () => {
		const deep = `${'<div>'.repeat(500)}x${'</div>'.repeat(500)}`;
		const result = sanitizeNotionHtml(deep);
		expect(result.markdown).toBe('x');
	});
});

describe('notion html: round-trip through the article renderer is inert', () => {
	const PAYLOADS = [
		'<script>window.__xssFired=1</script>',
		'<img src=x onerror="window.__xssFired=1">',
		'<svg onload="window.__xssFired=1"><circle r="10"/></svg>',
		'<iframe src="https://example.invalid"></iframe>',
		'<a href="javascript:window.__xssFired=1">click</a>',
		'<a href="javascript&#58;window.__xssFired=1">click</a>',
		'<a href="data:text/html,<script>window.__xssFired=1</script>">click</a>',
		'<div onmouseover="window.__xssFired=1"><p style="x:expression(alert(1))">text</p></div>',
		'<p>normal <strong>content</strong> with a <a href="https://example.com">link</a></p>',
	];

	it.each(PAYLOADS.map((payload) => [payload.slice(0, 48), payload] as const))(
		'%s renders no executable markup',
		(_label, payload) => {
			const { markdown } = sanitizeNotionHtml(payload);
			const html = renderMarkdown(markdown);
			expect(executableMarkupFindings(html), html).toEqual([]);
			expect(html).not.toMatch(/(?:^|[\s<])href="\s*javascript:/i);
		},
	);

	it('keeps legitimate content while dropping the payload around it', () => {
		const { markdown } = sanitizeNotionHtml(
			'<p>Legit <a href="https://example.com/x">link</a> stays</p><script>window.__xssFired=1</script>',
		);
		const html = renderMarkdown(markdown);
		expect(html).toContain('https://example.com/x');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain('stays');
		expect(html).not.toContain('__xssFired');
	});

	it('a refused Notion href never becomes a live anchor downstream', () => {
		// The adapter already stripped the target, so the renderer has
		// nothing to refuse: no marker, no anchor. That is the contract.
		const { markdown } = sanitizeNotionHtml('<a href="javascript:alert(1)">click</a>');
		const html = renderMarkdown(markdown);
		expect(html).not.toContain('<a ');
		expect(html).not.toContain(BLOCKED_LINK_CLASS);
		expect(html).toContain('click');
	});
});
