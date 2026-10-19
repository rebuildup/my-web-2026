/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
	DELETION_REQUEST_CHANNEL,
	findUnsupportedClaims,
	getPublishedDataLifecycle,
} from '../privacy/data-lifecycle';
import { PrivacyNotice } from './privacy-notice';

/**
 * The notice that reaches a visitor (Issue #496).
 *
 * `renderToStaticMarkup` is the shipped rendering path — the same call
 * the SSR document is built from — so what is asserted here is the
 * markup a browser receives, not an internal string. The served
 * document (`test/integration/data-lifecycle.test.ts`) is the other
 * half of the same contract.
 */
function renderNotice(): string {
	return renderToStaticMarkup(<PrivacyNotice />);
}

describe('PrivacyNotice', () => {
	it('renders every published entry, keyed by its registry id', () => {
		const html = renderNotice();
		for (const entry of getPublishedDataLifecycle()) {
			expect(html).toContain(`data-lifecycle-id="${entry.id}"`);
			expect(html).toContain(entry.label.ja);
			expect(html).toContain(entry.label.en);
		}
		expect(html).toContain(DELETION_REQUEST_CHANNEL.statement.ja);
	});

	it('names stored fields, retention, deletion, transfer and visibility per entry', () => {
		const html = renderNotice();
		// The five questions the Issue asks the wording to answer, per
		// store: 保存項目 / 保持期間 / 削除 / 外部送信 / 公開範囲.
		for (const label of ['保存項目:', '保持期間:', '削除:', '外部送信:', '公開範囲:']) {
			expect(html).toContain(label);
		}
		// …and the facts themselves are present, not just the labels.
		expect(html).toContain('31536000');
		expect(html).toContain('60 minutes');
		expect(html).toContain('Google Analytics 4');
	});

	it('makes no claim the registry refuses', () => {
		expect(findUnsupportedClaims(renderNotice())).toEqual([]);
	});

	it('renders a pending entry nowhere', () => {
		// Fail-closed publication, observed on the rendered surface.
		const html = renderNotice();
		for (const item of getPublishedDataLifecycle()) {
			expect(item.publication.status).toBe('approved');
		}
		// The registry currently publishes everything it declares; the
		// assertion above is what keeps a future `pending` entry from
		// being rendered by accident.
		expect(html).not.toContain('data-lifecycle-id="pending"');
	});

	it('tags every English passage and no Japanese one', () => {
		// SC 3.1.2 (`src/i18n/language-of-parts.ts`): `lang` is written
		// on a passage whose language differs from the document
		// language (`ja`) and on nothing else. The English halves of
		// the sentences are tagged; no Japanese passage is.
		const html = renderNotice();
		expect(html).not.toContain('lang="ja"');
		const englishTags = html.match(/<span lang="en">/g) ?? [];
		// summary (1) + deletion-window statement (1) + per entry
		// (label + 5 statements = 6).
		expect(englishTags).toHaveLength(2 + getPublishedDataLifecycle().length * 6);
	});

	it('is a native disclosure: no script and no custom control', () => {
		// `<details>`/`<summary>` is the whole interaction. A control
		// that needs JavaScript would break the no-JS reading of the
		// notice and would have to be announced as such.
		const html = renderNotice();
		expect(html.startsWith('<details')).toBe(true);
		expect(html).toContain('<summary');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('aria-expanded');
	});
});
