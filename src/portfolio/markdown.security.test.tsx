import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PortfolioMarkdown } from './components/Markdown';
import { BLOCKED_LINK_CLASS, classifyHref, decodeHtmlEntities, safeHref } from './markdown.lexer';
import {
	BLOCKED_FIXTURE_IDS,
	MARKDOWN_XSS_FIXTURES,
	blockedLinkFixtures,
	blockedRawHtmlFixtures,
	composeMarkdownFixtureBody,
	executableMarkupFindings,
} from '../../test/fixtures/markdown-xss-fixtures';

/**
 * XSS boundary of the article renderer (Issue #451).
 *
 * `markdown.test.tsx` covers the Markdown grammar. This file covers
 * the INPUT boundary: for every fixture — accepted and rejected —
 * the rendered HTML must contain no executable markup, and every
 * refused link must be visible rather than silently rewritten to `#`.
 *
 * The corpus lives in `test/fixtures/markdown-xss-fixtures.ts` because
 * the same bytes drive the Worker-level SSR test
 * (`test/integration/markdown-xss-ssr.test.ts`) and the screenshot
 * in `docs/verification/security/markdown-xss-fixture.webp`. A corpus
 * copied into a test file is a corpus that drifts.
 */

const ORIGIN = 'https://rebuildup.dev';

function render(input: string): string {
	return renderToStaticMarkup(
		createElement(PortfolioMarkdown, { source: input, siteOrigin: ORIGIN }),
	);
}

describe('markdown: XSS corpus is inert when rendered', () => {
	it.each(MARKDOWN_XSS_FIXTURES.map((fixture) => [fixture.id, fixture] as const))(
		'%s renders no executable markup',
		(_id, fixture) => {
			const html = render(fixture.input);
			expect(
				executableMarkupFindings(html),
				`fixture "${fixture.id}" (${fixture.label}) rendered live markup: ${html}`,
			).toEqual([]);
		},
	);

	it('the composed fixture body renders no executable markup', () => {
		// The whole body at once is what the fixture page and the
		// screenshot show, so it gets its own assertion: per-fixture
		// assertions cannot catch an interaction BETWEEN fixtures.
		const html = render(composeMarkdownFixtureBody());
		expect(executableMarkupFindings(html)).toEqual([]);
	});

	it('no accepted fixture loses its content to the sanitizer', () => {
		// A sanitizer that renders nothing would pass every "nothing
		// executes" assertion above. Accepted fixtures must still
		// produce real elements.
		const html = render(composeMarkdownFixtureBody());
		expect(html).toContain('<strong>');
		expect(html).toContain('<em>');
		expect(html).toContain('<h5'); // `### label` → sub-heading
		expect(html).toMatch(/<a [^>]*href="\/portfolio"/);
		expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com\/docs"/);
		expect(html).toContain('rel="noopener noreferrer"');
	});
});

describe('markdown: refused links are visible, not silently rewritten', () => {
	it('every blocked link fixture renders the blocked marker', () => {
		for (const fixture of blockedLinkFixtures()) {
			const html = render(fixture.input);
			expect(html, `fixture "${fixture.id}" did not render a visible rejection`).toContain(
				BLOCKED_LINK_CLASS,
			);
			// The dangerous scheme must not survive as an attribute.
			// `data-blocked-href` is inert text, so the attribute name needs a
			// boundary or the pattern reads the `href=` inside it.
			expect(html).not.toMatch(/(?:^|[\s<])(?:href|src)="\s*(?:javascript|data|vbscript):/i);
		}
	});

	it('the blocked marker is an inert span, never an anchor', () => {
		const html = render('[click me](javascript:alert(1))');
		expect(html).not.toContain('<a ');
		expect(html).toContain(`class="${BLOCKED_LINK_CLASS}`);
		expect(html).toContain('data-blocked-reason="scheme-not-allowed"');
		expect(html).toContain('blocked link (scheme-not-allowed)');
	});

	it('keeps the refused href visible as escaped data for the author', () => {
		const html = render('[click me](javascript:alert(1))');
		// React escapes the attribute value, so the value stays text.
		// The link lexer stops at the FIRST `)` (see
		// `findLinkCloseParen`), so the recorded href is
		// `javascript:alert(1` and the trailing `)` stays page text —
		// asserted as a prefix so the assertion does not encode that
		// lexer rule.
		expect(html).toContain('data-blocked-href="javascript:alert(1');
		expect(html).not.toContain('<a href="javascript:');
	});

	it('every raw-HTML fixture degrades to escaped text, with no marker', () => {
		for (const fixture of blockedRawHtmlFixtures()) {
			const html = render(fixture.input);
			// There is no link to refuse, so no marker is expected —
			// but the payload must still be visible AS TEXT, otherwise
			// "dropped silently" would pass as "sanitised".
			expect(html, `fixture "${fixture.id}" rendered nothing visible`).not.toBe('');
			expect(html).not.toContain(BLOCKED_LINK_CLASS);
			expect(html).toMatch(/&lt;[a-z]/i);
		}
	});

	it('reports the entity-encoded scheme as its own reason', () => {
		const html = render('[click me](javascript&#58;alert(1))');
		expect(html).toContain('data-blocked-reason="encoded-scheme"');
	});

	it('reports control-character obfuscation as its own reason', () => {
		const html = render('[click me](java\tscript:alert(1))');
		expect(html).toContain('data-blocked-reason="control-character"');
	});

	it('does not reuse the data-blocked class for accepted links', () => {
		const html = render('[ok](https://example.com/docs)');
		expect(html).not.toContain(BLOCKED_LINK_CLASS);
	});
});

describe('markdown: classifyHref oracle', () => {
	it('classifies same-origin absolute hrefs as internal', () => {
		const verdict = classifyHref('https://rebuildup.dev/portfolio', ORIGIN);
		expect(verdict).toMatchObject({
			outcome: 'allowed',
			href: 'https://rebuildup.dev/portfolio',
			external: false,
			target: '_self',
			rel: '',
		});
	});

	it('classifies off-origin hrefs as external with noopener', () => {
		const verdict = classifyHref('https://example.com/x', ORIGIN);
		expect(verdict).toMatchObject({
			outcome: 'allowed',
			external: true,
			target: '_blank',
			rel: 'noopener noreferrer',
		});
	});

	it('resolves protocol-relative hrefs and treats them as external', () => {
		const verdict = classifyHref('//example.com/x', ORIGIN);
		expect(verdict).toMatchObject({
			outcome: 'allowed',
			href: 'https://example.com/x',
			external: true,
			target: '_blank',
		});
	});

	it.each([
		['javascript:alert(1)', 'scheme-not-allowed'],
		['JaVaScRiPt:alert(1)', 'scheme-not-allowed'],
		['vbscript:msgbox(1)', 'scheme-not-allowed'],
		['data:text/html,<b>', 'scheme-not-allowed'],
		['file:///etc/passwd', 'scheme-not-allowed'],
		['blob:https://example.com/x', 'scheme-not-allowed'],
		['java\tscript:alert(1)', 'control-character'],
		['java\nscript:alert(1)', 'control-character'],
		['java\u0000script:alert(1)', 'control-character'],
		['javascript&#58;alert(1)', 'encoded-scheme'],
		['javascript&colon;alert(1)', 'encoded-scheme'],
		['&#106;avascript:alert(1)', 'encoded-scheme'],
		['   ', 'empty'],
	])('blocks %s as %s', (href, reason) => {
		const verdict = classifyHref(href, ORIGIN);
		expect(verdict.outcome).toBe('blocked');
		if (verdict.outcome === 'blocked') expect(verdict.reason).toBe(reason);
	});

	it('treats a space-obfuscated scheme as an ordinary relative path', () => {
		// `java script:` is NOT a scheme to any URL parser — a browser
		// percent-encodes the space and resolves it against the site
		// origin. Asserting the real outcome keeps the oracle from
		// claiming a rejection it does not actually make.
		const verdict = classifyHref('java script:alert(1)', ORIGIN);
		expect(verdict).toMatchObject({ outcome: 'allowed', external: false });
	});

	it('keeps fragment and root-relative hrefs untouched', () => {
		expect(classifyHref('#section', ORIGIN)).toMatchObject({
			outcome: 'allowed',
			href: '#section',
			external: false,
		});
		expect(classifyHref('/portfolio/foo', ORIGIN)).toMatchObject({
			outcome: 'allowed',
			href: '/portfolio/foo',
			external: false,
		});
	});

	it('decodes an HTML-escaped ampersand in a legitimate query', () => {
		// `&amp;` is how a real href reaches the DOM; the decoded value
		// is what a browser would navigate to, and it is still safe.
		const verdict = classifyHref('https://example.com/s?a=1&amp;b=2', ORIGIN);
		expect(verdict).toMatchObject({ outcome: 'allowed' });
		if (verdict.outcome === 'allowed') expect(verdict.href).toContain('b=2');
	});

	it('safeHref collapses every blocked href to #', () => {
		for (const href of ['javascript:alert(1)', 'data:x', 'vbscript:x']) {
			expect(safeHref(href, ORIGIN)).toBe('#');
		}
		expect(safeHref('https://example.com', ORIGIN)).toBe('https://example.com/');
	});

	it('decodeHtmlEntities leaves unknown references literal', () => {
		expect(decodeHtmlEntities('&nosuchentity;')).toBe('&nosuchentity;');
		expect(decodeHtmlEntities('a&b')).toBe('a&b');
	});
});

describe('markdown: corpus integrity', () => {
	it('every fixture id is unique', () => {
		const ids = MARKDOWN_XSS_FIXTURES.map((fixture) => fixture.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('covers the payload families the Issue names', () => {
		// A fixture set that quietly loses a whole family is the
		// failure mode this file exists to prevent.
		for (const id of BLOCKED_FIXTURE_IDS) {
			expect(MARKDOWN_XSS_FIXTURES.some((fixture) => fixture.id === id)).toBe(true);
		}
	});
});
