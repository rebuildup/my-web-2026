/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PUBLIC_COMPACT_DATA_NOTICE } from '../privacy/data-lifecycle';
import { PrivacyNoticeCompact } from './privacy-notice-compact';

/**
 * The compact pointer the non-home reaction surfaces render
 * (Issue #370). `renderToStaticMarkup` is the same call the SSR
 * document is built from, so what is asserted here is the markup a
 * browser receives.
 */
function renderCompact() {
	return renderToStaticMarkup(<PrivacyNoticeCompact {...PUBLIC_COMPACT_DATA_NOTICE} />);
}

describe('PrivacyNoticeCompact', () => {
	it('renders the projected statement and the link to the full notice', () => {
		const html = renderCompact();
		expect(html).toContain(PUBLIC_COMPACT_DATA_NOTICE.statement.ja);
		expect(html).toContain(PUBLIC_COMPACT_DATA_NOTICE.statement.en);
		expect(html).toContain(PUBLIC_COMPACT_DATA_NOTICE.linkLabel.ja);
		expect(html).toContain(PUBLIC_COMPACT_DATA_NOTICE.linkLabel.en);
		expect(html).toContain('href="/#data-notice"');
	});

	it('tags every English passage and no Japanese one', () => {
		// SC 3.1.2 — same contract `privacy-notice.test.tsx` pins for
		// the full notice: `lang="en"` on the English halves only.
		const html = renderCompact();
		expect(html).not.toContain('lang="ja"');
		expect(html.match(/<span lang="en">/g) ?? []).toHaveLength(2);
	});

	it('makes no claim the registry refuses', () => {
		// The sentence is projected verbatim from
		// `src/privacy/data-lifecycle.ts`; the contract test there
		// (`findUnsupportedClaims`) is what fails when the wording
		// drifts ahead of the code. This assertion pins that the
		// component adds no wording of its own.
		const html = renderCompact();
		expect(html).not.toContain('匿名');
		expect(html).not.toContain('<script');
	});
});
