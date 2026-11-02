/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContactPage } from './page';
import { RAW_CHANNELS, getVisibleChannels } from './public';
import type { Channel } from './schema';

/**
 * The two states a visitor can receive from `/contact` (Issue #832).
 *
 * `renderToStaticMarkup` is the shipped rendering path, so what is
 * asserted here is the markup a browser receives. The deployment is
 * observed by `e2e/contact.spec.ts`; this file pins the copy defect
 * that spec could not see: the empty state used to print the
 * repository path an operator would edit, which is internal
 * instruction text on a public surface.
 */

const NOW = Date.UTC(2026, 10, 3, 0, 0, 0);

const CHANNEL: Channel = {
	id: 'example',
	label: 'Example',
	labelEn: 'Example',
	purpose: 'technical',
	url: 'https://example.com/',
	verified_at: '2026-11-03',
	active: true,
};

/** Internal identifiers that must never reach a visitor. */
const INTERNAL_FRAGMENTS = ['src/contact', 'channels.json', 'verified_at', 'active: true'];

describe('/contact empty state', () => {
	const html = renderToStaticMarkup(<ContactPage channels={[]} now={NOW} empty />);

	it('renders the empty marker', () => {
		expect(html).toContain('data-testid="contact-empty"');
	});

	it('does not print a repository path or a schema field name', () => {
		for (const fragment of INTERNAL_FRAGMENTS) {
			expect(html, `empty state leaked ${fragment}`).not.toContain(fragment);
		}
	});

	it('does not render a channel row', () => {
		expect(html).not.toContain('data-channel-id');
	});
});

describe('/contact populated state', () => {
	const html = renderToStaticMarkup(<ContactPage channels={[CHANNEL]} now={NOW} empty={false} />);

	it('renders the channel row with a safe external link', () => {
		expect(html).toContain('data-channel-id="example"');
		expect(html).toContain('https://example.com/');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain('target="_blank"');
	});

	it('renders the purpose label', () => {
		expect(html).toContain('技術的な議論');
	});

	it('renders no empty state', () => {
		expect(html).not.toContain('data-testid="contact-empty"');
	});
});

/**
 * The shipped list as of the verification date (Issue #832).
 *
 * The clock is pinned to the day every channel was measured, so this
 * does not become a time bomb; what it pins is that the file shipped
 * with at least one *verified* channel — the state whose absence made
 * production render the internal empty state — and that a retired
 * channel stays retired until someone re-verifies it.
 */
describe('shipped channels.json', () => {
	const VERIFIED_AT = Date.UTC(2026, 10, 3, 12, 0, 0);
	const visible = getVisibleChannels(VERIFIED_AT);

	it('has at least one channel that passes the freshness gate', () => {
		expect(visible.length).toBeGreaterThan(0);
	});

	it('never surfaces an inactive channel', () => {
		const visibleIds = new Set(visible.map((channel) => channel.id));
		for (const channel of RAW_CHANNELS.filter((entry) => !entry.active)) {
			expect(visibleIds.has(channel.id), `${channel.id} is inactive but visible`).toBe(false);
		}
	});

	it('dates every channel at or before the verification day', () => {
		for (const channel of RAW_CHANNELS) {
			expect(
				Date.parse(`${channel.verified_at}T00:00:00Z`),
				`${channel.id} claims a future verification`,
			).toBeLessThanOrEqual(VERIFIED_AT);
		}
	});
});
