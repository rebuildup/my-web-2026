import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolConsentNotice } from './embed-consent-notice';

/**
 * Consent notice markup contract (Issue #498).
 *
 * The notice is the surface a visitor reads before an embed reaches a
 * third party, so what it must NOT contain matters as much as what it
 * does: the pre-activation document may not reference a third-party
 * origin through ANY attribute, not just through the frame src the
 * component does not even take.
 *
 * These assertions run against the real component through
 * `renderToStaticMarkup` — the same SSR path the route uses — with no
 * browser and no Worker. The Storybook story
 * (`embed-consent-notice.stories.tsx`) previews the same component for
 * a human; the e2e spec drives the activated state in a real browser.
 */

/** Attribute values that would make the document issue a request. */
const REQUEST_BEARING = /(?:src|href|srcset|data|poster)\s*=\s*"([^"]*)"/gi;

function render(props: Partial<Parameters<typeof ToolConsentNotice>[0]> = {}): string {
	return renderToStaticMarkup(
		createElement(ToolConsentNotice, {
			displayName: 'Fixture Tool',
			contacts: ['https://embed.example.invalid', 'https://fonts.example.invalid'],
			purpose: { ja: 'テスト用の目的。', en: 'Fixture purpose.' },
			frameIsThirdParty: false,
			onActivate: () => {},
			...props,
		}),
	);
}

/** Every URL-ish value the markup names, whatever attribute carries it. */
function referencedUrls(html: string): string[] {
	return [...html.matchAll(REQUEST_BEARING)].map((match) => match[1] ?? '');
}

describe('ToolConsentNotice', () => {
	it('renders no iframe before activation', () => {
		expect(render()).not.toMatch(/<iframe/i);
	});

	it('names every declared origin exactly once, in a list item', () => {
		const html = render();
		for (const origin of ['https://embed.example.invalid', 'https://fonts.example.invalid']) {
			expect(html).toContain(`data-contact-origin="${origin}"`);
		}
	});

	it('references no third-party URL through any request-bearing attribute', () => {
		// The origin list is plain text inside <li><code>, so the only
		// URLs in the document are the two the visitor must see. A
		// thumbnail, a preconnect or a hidden iframe pointing at a
		// declared origin would each reintroduce the request this notice
		// exists to prevent.
		expect(referencedUrls(render())).toEqual([]);
	});

	it('offers one explicit activation control', () => {
		const html = render();
		const buttons = html.match(/<button[^>]*>/g) ?? [];
		expect(buttons).toHaveLength(1);
		expect(buttons[0]).toContain('type="button"');
		expect(html).toContain('読み込みを開始する / Load the tool');
	});

	it('states that no consent record is stored', () => {
		// A gate that silently remembered the answer would publish a new
		// data surface; the copy says so instead of implying one.
		expect(render()).toContain('同意の記録は保存されません。');
		expect(render()).toContain('No consent record is stored');
	});

	it('says whether the embedded document itself is third-party', () => {
		expect(render({ frameIsThirdParty: true })).toContain(
			'data-tool-consent-frame-origin="third-party"',
		);
		expect(render({ frameIsThirdParty: false })).toContain('data-tool-consent-frame-origin="host"');
	});

	it('renders the declared purpose in both locales', () => {
		const html = render({ purpose: { ja: '日本語の目的。', en: 'English purpose.' } });
		expect(html).toContain('日本語の目的。');
		expect(html).toContain('English purpose.');
	});

	it('omits the purpose block when the declaration has none', () => {
		expect(render({ purpose: undefined })).not.toContain('data-tool-consent-purpose');
	});

	it('marks the notice state for the e2e contract', () => {
		const html = render();
		expect(html).toContain('data-tool-consent="pending"');
		expect(html).toContain('data-tool-state="consent-pending"');
	});
});
