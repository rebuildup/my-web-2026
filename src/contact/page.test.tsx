/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContactPage } from './page';
import { RAW_CHANNELS, getVisibleChannels } from './public';
import type { PublicContactChannel } from './public';

/**
 * The states a visitor can receive from `/contact` (Issues #832, #833).
 *
 * `renderToStaticMarkup` is the shipped rendering path, so what is
 * asserted here is the markup a browser receives. The deployment is
 * observed by `e2e/contact.spec.ts`; this file pins the copy defect
 * that spec could not see: the empty state used to print the
 * repository path an operator would edit, which is internal
 * instruction text on a public surface.
 *
 * Issue #833 adds the audit contract: display validity (`active` +
 * confirmable `verified_at`) decides listing; audit freshness
 * (`fresh` / `due`) decides the note. A `due` channel stays listed
 * with a re-verification note, and the empty state distinguishes
 * "no channels exist" from "channels exist but none are confirmable".
 */

const CHANNEL: PublicContactChannel = {
	id: 'example',
	label: 'Example',
	labelEn: 'Example',
	purpose: 'technical',
	url: 'https://example.com/',
	verifiedDaysAgo: 0,
	audit: 'fresh',
};

const DUE_CHANNEL: PublicContactChannel = {
	...CHANNEL,
	id: 'due-example',
	verifiedDaysAgo: 45,
	audit: 'due',
};

/** Internal identifiers that must never reach a visitor. */
const INTERNAL_FRAGMENTS = ['src/contact', 'channels.json', 'verified_at', 'active: true'];

describe('/contact empty state', () => {
	const html = renderToStaticMarkup(<ContactPage channels={[]} empty unverifiableCount={0} />);

	it('renders the empty marker', () => {
		expect(html).toContain('data-testid="contact-empty"');
		expect(html).toContain('data-empty-reason="none"');
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

describe('/contact empty state — channels exist but none are confirmable', () => {
	const html = renderToStaticMarkup(<ContactPage channels={[]} empty unverifiableCount={2} />);

	it('marks the reason as unverifiable, distinct from "no channels"', () => {
		expect(html).toContain('data-empty-reason="unverifiable"');
		expect(html).toContain('要再検証');
	});
});

describe('/contact populated state', () => {
	const html = renderToStaticMarkup(
		<ContactPage channels={[CHANNEL]} empty={false} unverifiableCount={0} />,
	);

	it('renders the channel row with a safe external link', () => {
		expect(html).toContain('data-channel-id="example"');
		expect(html).toContain('https://example.com/');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain('target="_blank"');
	});

	it('renders the purpose label', () => {
		expect(html).toContain('技術的な議論');
	});

	it('renders no empty state and no audit-due notice for a fresh channel', () => {
		expect(html).not.toContain('data-testid="contact-empty"');
		expect(html).not.toContain('data-testid="contact-audit-due"');
		// The row itself must not carry the re-verification note (the
		// SectionHeading description legitimately names the feature).
		const row = html.slice(html.indexOf('data-channel-id="example"'));
		expect(row).not.toContain('要再検証');
	});
});

describe('/contact audit-due state (Issue #833)', () => {
	const html = renderToStaticMarkup(
		<ContactPage channels={[DUE_CHANNEL]} empty={false} unverifiableCount={0} />,
	);

	it('keeps the due channel listed — age alone never removes a verified route', () => {
		expect(html).toContain('data-channel-id="due-example"');
		expect(html).toContain('https://example.com/');
	});

	it('labels the row as re-verification due instead of freshly verified', () => {
		expect(html).toContain('要再検証');
		expect(html).toContain('re-verification due');
		expect(html).not.toContain('verified 45 days ago<');
	});

	it('renders the audit-due notice', () => {
		expect(html).toContain('data-testid="contact-audit-due"');
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

	it('has at least one channel that passes the display-validity gate', () => {
		expect(visible.length).toBeGreaterThan(0);
	});

	it('never surfaces an inactive channel', () => {
		const visibleIds = new Set(visible.map((entry) => entry.channel.id));
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
