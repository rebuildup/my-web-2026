/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { describe, expect, it } from 'vitest';
import { ACTOR_COOKIE_MAX_AGE_SECONDS } from '../home/reactions/cookie';
import { DEDUP_WINDOW_MS } from '../http/access-counter/schema';
import type { DataLifecycleEntry } from './data-lifecycle';
import {
	DATA_LIFECYCLE_ENTRIES,
	DELETION_REQUEST_CHANNEL,
	UNSUPPORTED_PUBLIC_CLAIMS,
	filterPublishedEntries,
	findSendScopeViolations,
	findUnsupportedClaims,
	getPublishedDataLifecycle,
	publishedClaimSurface,
} from './data-lifecycle';

/**
 * The registry is the public wording's only source (Issue #496), so the
 * two ways it can rot are checked here:
 *
 *   1. **Restated numbers drift.** The registry is a leaf and cannot
 *      import the module that owns a constant, so it restates retention
 *      figures as prose. These assertions tie the prose back to
 *      `ACTOR_COOKIE_MAX_AGE_SECONDS` and `DEDUP_WINDOW_MS`; changing
 *      either without republishing fails here.
 *   2. **The wording says more than the code supports.** Every
 *      published sentence is scanned for the claims
 *      `UNSUPPORTED_PUBLIC_CLAIMS` refuses — anonymity, a deletion
 *      request channel, an unqualified "nothing leaves", automatic
 *      deletion.
 *
 * The published-HTML half (the same claim scan plus "the registry's
 * facts really are in the served document") lives in
 * `test/integration/data-lifecycle.test.ts`, because only the Worker
 * can render a real document.
 */

/** The registry entry with this id. Throws when the id is unknown. */
const entry = (id: string) => {
	const found = DATA_LIFECYCLE_ENTRIES.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`[privacy] no entry named ${id}`);
	return found;
};

/**
 * A registry entry built from the shape, for the fixtures the shipped
 * registry does not contain (a `pending` entry, an entry with a
 * different id).
 */
function fixtureEntry(id: string, status: 'approved' | 'pending'): DataLifecycleEntry {
	return {
		id,
		label: { ja: `ラベル ${id}`, en: `Label ${id}` },
		stores: { ja: `保存項目 ${id}`, en: `Stores ${id}` },
		retention: { kind: 'not-applicable', statement: { ja: `保持 ${id}`, en: `Retention ${id}` } },
		deletion: { channel: 'not-applicable', statement: { ja: `削除 ${id}`, en: `Deletion ${id}` } },
		transfer: {
			target: 'none',
			statement: { ja: `送信 ${id}`, en: `Transfer ${id}` },
			senders: [],
		},
		visibility: { ja: `公開 ${id}`, en: `Visibility ${id}` },
		evidence: ['src/privacy/data-lifecycle.ts'],
		publication: { status, note: { ja: `備考 ${id}`, en: `Note ${id}` } },
	};
}

/**
 * A fixture entry that claims an outward transfer, with the senders
 * the caller supplies. The sender list is what the Issue #662 rule
 * judges, so the fixture has to be able to break it.
 */
function fixtureWithSenders(
	id: string,
	senders: DataLifecycleEntry['transfer']['senders'],
): DataLifecycleEntry {
	const base = fixtureEntry(id, 'approved');
	return {
		...base,
		transfer: {
			target: 'google-analytics-4',
			statement: base.transfer.statement,
			senders,
		},
	};
}

/** One sender scope, in the shape the registry carries. */
function scope(
	sender: 'platform-code' | 'third-party-automatic',
	label: string,
): DataLifecycleEntry['transfer']['senders'][number] {
	return {
		sender,
		label: { ja: label, en: label },
		statement: { ja: `${label} の送信`, en: `Sent by ${label}` },
	};
}

describe('retention prose is tied to the constants the code owns', () => {
	it('the cookie lifetime sentence is the shipped cookie Max-Age', () => {
		// 60*60*24*365 seconds == one year == `Max-Age=31536000`.
		expect(ACTOR_COOKIE_MAX_AGE_SECONDS).toBe(31_536_000);
		expect(entry('actor-cookie').retention.statement.ja).toContain('1 年');
		expect(entry('actor-cookie').retention.statement.en).toContain('One year');
		expect(entry('actor-cookie').stores.ja).toContain(`Max-Age=${ACTOR_COOKIE_MAX_AGE_SECONDS}`);
		expect(entry('actor-cookie').stores.en).toContain(`Max-Age=${ACTOR_COOKIE_MAX_AGE_SECONDS}`);
	});

	it('the dedup window sentence is the shipped dedup window', () => {
		expect(DEDUP_WINDOW_MS).toBe(60 * 60 * 1000);
		expect(entry('access-counter').retention.statement.ja).toContain('60 分');
		expect(entry('access-counter').retention.statement.en).toContain('60 minutes');
		expect(entry('access-counter').retention.kind).toBe('windowed');
	});

	it('a store with no purge job is never described as expiring on its own', () => {
		// `reactions` has no expiry column and this platform ships no
		// Cron trigger, so the wording must stay in `until-deleted` /
		// `windowed` and must not claim the row disappears by itself.
		expect(entry('reaction-rows').retention.kind).toBe('until-deleted');
		expect(entry('reaction-rows').retention.statement.ja).toContain('自動失効はありません');
		expect(entry('reaction-rows').retention.statement.en).toMatch(/No automatic expiry/);
		expect(findUnsupportedClaims(publishedClaimSurface())).toEqual([]);
	});
});

describe('the deletion window', () => {
	it('says no channel is published, and claims none', () => {
		expect(DELETION_REQUEST_CHANNEL.status).toBe('not-published');
		expect(DELETION_REQUEST_CHANNEL.statement.ja).toContain('窓口を公開していません');
		expect(DELETION_REQUEST_CHANNEL.statement.en).toMatch(/publishes no channel/);
	});

	it('no entry offers a request channel that does not exist', () => {
		// Every entry answers with the deletion path that really
		// exists: a visitor toggle, an operator action, the third
		// party, or "not applicable" for a page that stores nothing.
		const allowed = new Set(['visitor-action', 'operator-action', 'third-party', 'not-applicable']);
		for (const item of getPublishedDataLifecycle()) {
			expect(allowed.has(item.deletion.channel)).toBe(true);
		}
	});
});

describe('publication is fail-closed', () => {
	it('every entry is either approved or pending, and ids are unique', () => {
		const ids = new Set<string>();
		for (const item of DATA_LIFECYCLE_ENTRIES) {
			expect(['approved', 'pending']).toContain(item.publication.status);
			expect(ids.has(item.id)).toBe(false);
			ids.add(item.id);
		}
	});

	it('a pending entry is filtered out of a set that really contains one', () => {
		// The shipped registry publishes everything it declares, so
		// the fail-closed rule is proved against a fixture that holds
		// a `pending` entry. Without this, "a pending entry renders
		// nowhere" could not fail.
		const approved = fixtureEntry('approved-entry', 'approved');
		const pending = fixtureEntry('pending-entry', 'pending');
		expect(filterPublishedEntries([approved, pending]).map((entry) => entry.id)).toEqual([
			'approved-entry',
		]);
	});

	it('an approved entry always carries repository evidence', () => {
		for (const item of getPublishedDataLifecycle()) {
			expect(item.evidence.length).toBeGreaterThan(0);
		}
	});

	it('the published set covers every store the Issue named', () => {
		// Access counter / reactions / forms / analytics events — the
		// four the Issue lists. `admin-auth` and `contact-surface` are
		// the form answer; dropping one silently would leave a store
		// undocumented, so the list is asserted rather than derived.
		const published = getPublishedDataLifecycle().map((item) => item.id);
		expect(published).toEqual([
			'actor-cookie',
			'reaction-rows',
			'access-counter',
			'analytics-events',
			'admin-auth',
			'contact-surface',
		]);
	});

	it('both locales are complete for every published sentence', () => {
		for (const item of getPublishedDataLifecycle()) {
			for (const text of [
				item.label,
				item.stores,
				item.retention.statement,
				item.deletion.statement,
				item.transfer.statement,
				item.visibility,
			]) {
				expect(text.ja.trim().length).toBeGreaterThan(0);
				expect(text.en.trim().length).toBeGreaterThan(0);
			}
			// The per-sender statements are published sentences too
			// (Issue #662): a scope with no text in one locale is a
			// scope the reader only half sees.
			for (const sender of item.transfer.senders) {
				expect(sender.label.ja.trim().length).toBeGreaterThan(0);
				expect(sender.label.en.trim().length).toBeGreaterThan(0);
				expect(sender.statement.ja.trim().length).toBeGreaterThan(0);
				expect(sender.statement.en.trim().length).toBeGreaterThan(0);
			}
		}
	});
});

describe('the wording is scoped to what the code does', () => {
	it('the analytics sentence names the page_view the query strip reaches', () => {
		// `stripAnalyticsQuery` only reaches the SPA route-change
		// page_view. The first page_view is recorded by
		// `gtag('config', …)`, where GA reads `document.location`
		// itself — the limit this repository documents in
		// `docs/security/log-redaction.md` ("Known limits"). The
		// published sentence must carry that limit, because the
		// platform's own threat model puts `?token=`, `?email=` and
		// `?q=` in a URL.
		//
		// Issue #662: the detail belongs to the sender it describes —
		// it is this platform's own code that strips the query string,
		// so the sentence sits in the `platform-code` scope.
		const code = entry('analytics-events').transfer.senders.find(
			(sender) => sender.sender === 'platform-code',
		);
		expect(code).toBeDefined();
		expect(code?.statement.ja).toContain('アプリ内の画面遷移');
		expect(code?.statement.en).toMatch(/in-app route change/);
		expect(code?.statement.ja).toContain('最初の読み込み');
		expect(code?.statement.en).toMatch(/first page load/);
		// The unqualified claim the previous wording made is gone.
		expect(code?.statement.ja).not.toContain('クエリ文字列は送信前に除去され');
		expect(code?.statement.en).not.toContain('Query strings are stripped before sending');
	});

	it('the analytics sentence names the off switch', () => {
		// The measurement-id secret is the only off switch: with it
		// unset, `GoogleAnalytics` renders no tag at all.
		const transfer = entry('analytics-events').transfer;
		expect(transfer.statement.ja).toContain('測定 ID');
		expect(transfer.statement.en).toMatch(/measurement-id secret/);
	});

	it('the cookie transfer sentence is scoped to the identifier', () => {
		// The subject must be the identifier, not "a page load": a
		// page load also sends a page_view to GA4, so a load-scoped
		// sentence reads as a claim about the whole request.
		const transfer = entry('actor-cookie').transfer;
		expect(transfer.statement.ja).toContain('この識別子');
		expect(transfer.statement.en).toMatch(/^This identifier/);
		expect(transfer.statement.ja).not.toContain('ホームの読み込みは');
		expect(transfer.statement.en).not.toContain('The home loader');
	});

	it('the admin-auth visibility names the surface the invited email reaches', () => {
		// `/admin/invitations/accept?token=…` is unauthenticated: its
		// loader only probes the token, and the view prints the probed
		// email. "Never reaches a public surface" is therefore not a
		// fact about the stored email address.
		const visibility = entry('admin-auth').visibility;
		expect(visibility.ja).toContain('/admin/invitations/accept');
		expect(visibility.en).toContain('/admin/invitations/accept');
		expect(visibility.ja).not.toContain('認証境界の内側なので公開面には現れません');
		expect(visibility.en).not.toContain(
			'It sits behind the authentication boundary and never reaches a public surface',
		);
	});

	it('the session row names the IP address and the user agent it stores', () => {
		// `migrations/0001_better_auth.sql` declares
		// `session.ipAddress` and `session.userAgent`, and Better Auth
		// writes both when it creates a session.
		const stores = entry('admin-auth').stores;
		expect(stores.ja).toContain('IP アドレス');
		expect(stores.ja).toContain('ユーザーエージェント');
		expect(stores.en).toContain('client IP address');
		expect(stores.en).toContain('user-agent');
	});
});

describe('a send scope always names its sender', () => {
	// Issue #662: the registry and the consent banner describe the
	// same data. A registry sentence that claims what "is sent" without
	// saying who sends it reads as excluding GA4's own automatic
	// collection, and the two public surfaces then contradict each
	// other. The rule is structural, so it is asserted structurally.

	it('the shipped registry names a sender for every outward transfer', () => {
		// Non-vacuity: the shipped registry has entries that transfer
		// outward, so an empty violation list means the rule was
		// applied, not that there was nothing to apply it to.
		const outward = DATA_LIFECYCLE_ENTRIES.filter((item) => item.transfer.target !== 'none');
		expect(outward.length).toBeGreaterThan(0);
		expect(findSendScopeViolations(DATA_LIFECYCLE_ENTRIES)).toEqual([]);
	});

	it('the GA4 entry separates the code payload from GA4’s own collection', () => {
		const senders = entry('analytics-events').transfer.senders;
		expect(senders.map((sender) => sender.sender)).toEqual([
			'platform-code',
			'third-party-automatic',
		]);
		// The reader can tell the two senders apart, and each scope
		// says what that sender sends.
		expect(senders[0]?.label.ja).toContain('このプラットフォームのコード');
		expect(senders[1]?.label.ja).toContain('GA4');
		expect(senders[1]?.statement.ja).toContain('参照元');
		expect(senders[1]?.statement.en).toMatch(/referrer/);
	});

	it('an outward transfer without a named sender is an error', () => {
		// The fixture really claims an outward transfer, so the
		// assertion can fail: without a sender the scope of the claim
		// is undefined, and the "only X and Y are sent" misreading
		// gets through.
		const unscoped = fixtureWithSenders('unscoped-transfer', []);
		const violations = findSendScopeViolations([unscoped]);
		expect(violations.map((violation) => violation.id)).toEqual(['unscoped-transfer']);
		expect(violations[0]?.reason).toMatch(/sender/);
	});

	it('a GA4 transfer that does not separate the automatic collection is an error', () => {
		// The code payload alone is what the previous wording published,
		// and it is the shape that contradicts the consent banner.
		const codeOnly = fixtureWithSenders('code-only-transfer', [scope('platform-code', 'コード')]);
		const violations = findSendScopeViolations([codeOnly]);
		expect(violations.map((violation) => violation.id)).toEqual(['code-only-transfer']);
		expect(violations[0]?.reason).toMatch(/automatic collection/);
	});

	it('an entry that sends nothing outward may not name a sender', () => {
		const contradictory = {
			...fixtureEntry('no-transfer-entry', 'approved'),
			transfer: {
				target: 'none' as const,
				statement: { ja: '送信なし', en: 'No transfer' },
				senders: [scope('platform-code', 'コード')],
			},
		};
		const violations = findSendScopeViolations([contradictory]);
		expect(violations.map((violation) => violation.id)).toEqual(['no-transfer-entry']);
	});

	it('a scope with no text in one locale is an error', () => {
		const halfWritten = fixtureWithSenders('half-written-transfer', [
			{
				sender: 'platform-code',
				label: { ja: 'コード', en: 'Code' },
				statement: { ja: '', en: 'Sent by the code' },
			},
		]);
		const violations = findSendScopeViolations([halfWritten]);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations[0]?.reason).toMatch(/locales/);
	});

	it('the published wording no longer claims what is sent in the singular', () => {
		// The sentence the Issue opened about: "送信するのは測定 ID と、
		// パス情報…です" reads as excluding GA4's own collection. The
		// refusal list refuses it, and the registry no longer says it.
		const surface = publishedClaimSurface();
		expect(surface).not.toContain('送信するのは測定 ID と');
		expect(surface).not.toContain('What leaves the deployment: the measurement id');
		expect(findUnsupportedClaims(surface)).toEqual([]);
	});
});

describe('the refusal list is load-bearing', () => {
	it('flags each refused claim when it is written', () => {
		// Non-vacuity: a detector that never fires would let the old
		// wording back in. Each claim is fed its own example.
		const samples: Record<string, string> = {
			anonymity: 'このサイトは匿名の Cookie を使用します。',
			'deletion-window': '削除依頼を受け付けます。',
			'no-third-party': '閲覧データは外部に送信しません。',
			'auto-expiry': '記録は自動的に削除されます。',
			'unqualified-send-scope': '送信するのは測定 ID と、パス情報（page_path）です。',
		};
		for (const claim of UNSUPPORTED_PUBLIC_CLAIMS) {
			const sample = samples[claim.id];
			expect(sample, `no sample for refusal ${claim.id}`).toBeTruthy();
			expect(findUnsupportedClaims(sample).map((hit) => hit.id)).toContain(claim.id);
			expect(claim.why.length).toBeGreaterThan(0);
		}
	});

	it('does not flag the honest wording that replaced them', () => {
		expect(findUnsupportedClaims(publishedClaimSurface())).toEqual([]);
	});
});
