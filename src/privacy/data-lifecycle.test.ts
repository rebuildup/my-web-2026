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
		transfer: { target: 'none', statement: { ja: `送信 ${id}`, en: `Transfer ${id}` } },
		visibility: { ja: `公開 ${id}`, en: `Visibility ${id}` },
		evidence: ['src/privacy/data-lifecycle.ts'],
		publication: { status, note: { ja: `備考 ${id}`, en: `Note ${id}` } },
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
		const stores = entry('analytics-events').stores;
		expect(stores.ja).toContain('アプリ内の画面遷移');
		expect(stores.en).toMatch(/in-app route change/);
		expect(stores.ja).toContain('最初の読み込み');
		expect(stores.en).toMatch(/first page load/);
		// The unqualified claim the previous wording made is gone.
		expect(stores.ja).not.toContain('クエリ文字列は送信前に除去され');
		expect(stores.en).not.toContain('Query strings are stripped before sending');
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

describe('the refusal list is load-bearing', () => {
	it('flags each refused claim when it is written', () => {
		// Non-vacuity: a detector that never fires would let the old
		// wording back in. Each claim is fed its own example.
		const samples: Record<string, string> = {
			anonymity: 'このサイトは匿名の Cookie を使用します。',
			'deletion-window': '削除依頼を受け付けます。',
			'no-third-party': '閲覧データは外部に送信しません。',
			'auto-expiry': '記録は自動的に削除されます。',
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
