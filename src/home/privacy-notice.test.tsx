/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DataLifecycleEntry } from '../privacy/data-lifecycle';
import {
	PUBLIC_DELETION_REQUEST_CHANNEL,
	findUnsupportedClaims,
	getPublishedPublicDataLifecycle,
	toPublicDataLifecycleEntry,
} from '../privacy/data-lifecycle';
import { PrivacyNotice } from './privacy-notice';
import type { PrivacyNoticeData } from './privacy/load';

/**
 * The notice that reaches a visitor (Issue #496).
 *
 * `renderToStaticMarkup` is the shipped rendering path — the same call
 * the SSR document is built from — so what is asserted here is the
 * markup a browser receives, not an internal string. The served
 * document (`test/integration/data-lifecycle.test.ts`) is the other
 * half of the same contract.
 */
const NOTICE_DATA: PrivacyNoticeData = {
	entries: getPublishedPublicDataLifecycle(),
	deletionRequestChannel: PUBLIC_DELETION_REQUEST_CHANNEL,
};

function renderNotice(data: PrivacyNoticeData = NOTICE_DATA): string {
	return renderToStaticMarkup(<PrivacyNotice {...data} />);
}

/**
 * A `pending` entry — the state the shipped registry happens not to
 * contain. It is the fixture the fail-closed assertion needs: without
 * a set that really holds one, "a pending entry renders nowhere"
 * cannot fail.
 */
const PENDING_ENTRY: DataLifecycleEntry = {
	id: 'pending-entry',
	label: { ja: '保留中のエントリ', en: 'Pending entry' },
	stores: { ja: '保留中の保存項目', en: 'Pending stores' },
	retention: {
		kind: 'not-applicable',
		statement: { ja: '保留中の保持期間', en: 'Pending retention' },
	},
	deletion: {
		channel: 'not-applicable',
		statement: { ja: '保留中の削除', en: 'Pending deletion' },
	},
	transfer: {
		target: 'none',
		statement: { ja: '保留中の外部送信', en: 'Pending transfer' },
		senders: [],
	},
	visibility: { ja: '保留中の公開範囲', en: 'Pending visibility' },
	evidence: ['src/privacy/data-lifecycle.ts'],
	publication: { status: 'pending', note: { ja: '保留中の備考', en: 'Pending note' } },
};

describe('PrivacyNotice', () => {
	it('renders every published entry, keyed by its registry id', () => {
		const html = renderNotice();
		for (const entry of NOTICE_DATA.entries) {
			expect(html).toContain(`data-lifecycle-id="${entry.id}"`);
			expect(html).toContain(entry.label.ja);
			expect(html).toContain(entry.label.en);
		}
		expect(html).toContain(PUBLIC_DELETION_REQUEST_CHANNEL.statement.ja);
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

	it('shows who sends what, so the scope is visible to the reader', () => {
		// Issue #662: the sender distinction has to reach the rendered
		// notice, not only the registry source. The reader has to be
		// able to tell this platform's code from GA4's own automatic
		// collection — the split the consent banner relies on.
		const html = renderNotice();
		expect(html).toContain('送信者:');
		expect(html).toContain('このプラットフォームのコード');
		expect(html).toContain('GA4 自身の自動収集');
		for (const entry of NOTICE_DATA.entries) {
			for (const sender of entry.transfer.senders) {
				expect(html).toContain(sender.label.ja);
				expect(html).toContain(sender.statement.ja);
			}
		}
	});

	it('makes no claim the registry refuses', () => {
		expect(findUnsupportedClaims(renderNotice())).toEqual([]);
	});

	it('the public projection carries rendered fields only (Issue #1009)', () => {
		// The component no longer filters — publication is decided at
		// the boundary (`getPublishedPublicDataLifecycle`, which runs
		// `filterPublishedEntries`; its pending-fixture coverage lives
		// in `data-lifecycle.test.ts`). What the component contract
		// now guarantees is that nothing beyond the projected shape
		// can reach the markup: no `evidence`, no `publication`, no
		// classification fields.
		for (const entry of NOTICE_DATA.entries) {
			expect(Object.keys(entry).sort()).toEqual(
				['deletion', 'id', 'label', 'retention', 'stores', 'transfer', 'visibility'].sort(),
			);
		}
	});

	it('renders exactly the entries it is given', () => {
		// Boundary contract: whatever the loader projects is what a
		// visitor sees. A pending entry cannot arrive here because the
		// projection never emits one — asserted on the projection in
		// `data-lifecycle.test.ts`.
		const projected = toPublicDataLifecycleEntry(PENDING_ENTRY);
		const html = renderNotice({
			entries: [...NOTICE_DATA.entries, projected],
			deletionRequestChannel: NOTICE_DATA.deletionRequestChannel,
		});
		expect(html).toContain('data-lifecycle-id="pending-entry"');
		expect(html).toContain('actor-cookie');
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
		// (label + 5 statements = 6) + per sender (label + statement
		// = 2, Issue #662).
		const senderCount = NOTICE_DATA.entries.reduce(
			(total, entry) => total + entry.transfer.senders.length,
			0,
		);
		expect(englishTags).toHaveLength(2 + NOTICE_DATA.entries.length * 6 + senderCount * 2);
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
