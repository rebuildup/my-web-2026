import { beforeEach, describe, expect, it } from 'vitest';
import { AccessCounterDedupeCache, LRU_TTL_MS, dedupeCache, isBot, isPrefetch } from './filter';

/**
 * Access counter — pre-D1 ingress filter tests (Issue #170).
 *
 * These tests cover the pure filter functions (`isBot`, `isPrefetch`)
 * and the `AccessCounterDedupeCache` LRU directly. The router-
 * integration path is covered by `counter.test.ts`; this file proves
 * the gates that run *before* `recordHit`.
 *
 * No workerd bindings are required — the filter module has no D1 /
 * R2 / env coupling. The tests still run in the workerd pool because
 * `vitest.config.ts` matches every `src/**\/*.{test,spec}.{ts,tsx}`,
 * which is fine (the pool just provides a V8 isolate).
 */

class HeaderMap {
	private readonly map = new Map<string, string>();
	public get(name: string): string | null {
		return this.map.get(name.toLowerCase()) ?? null;
	}
	public set(name: string, value: string): void {
		this.map.set(name.toLowerCase(), value);
	}
}

function makeHeader(values: Record<string, string>): HeaderMap {
	const h = new HeaderMap();
	for (const [k, v] of Object.entries(values)) h.set(k, v);
	return h;
}

describe('isBot', () => {
	it('flags canonical bot UAs', () => {
		expect(isBot('Googlebot/2.1')).toBe(true);
		expect(isBot('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(true);
		expect(isBot('facebookexternalhit/1.1')).toBe(true);
		expect(isBot('curl/7.88.1 (a crawler)')).toBe(true);
		expect(isBot('Mozilla/5.0 HeadlessChrome/120.0.6099.224')).toBe(true);
	});

	it('flags the substring forms (case-insensitive)', () => {
		expect(isBot('SlUrP/3.0')).toBe(true);
		expect(isBot('BingPreview/2.0')).toBe(true);
		expect(isBot('SiteMonitor/1.0')).toBe(true);
		expect(isBot('preview-renderer')).toBe(true);
	});

	it('admits ordinary browser UAs', () => {
		expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15')).toBe(false);
		expect(isBot('Mozilla/5.0 (X11; Linux x86_64) Firefox/124.0')).toBe(false);
	});

	it('admits a missing UA (programmatic clients are not bot-flagged here)', () => {
		// The home's server-to-server self-call (ADR-0011) does not
		// attach a User-Agent. Rejecting missing UAs would zero the
		// counter; this filter is intentionally narrow on the
		// absent-UA branch.
		expect(isBot(undefined)).toBe(false);
		expect(isBot(null)).toBe(false);
		expect(isBot('')).toBe(false);
	});
});

describe('isPrefetch', () => {
	it('detects Sec-Purpose: prefetch', () => {
		const h = makeHeader({ 'Sec-Purpose': 'prefetch' });
		expect(isPrefetch(h)).toBe(true);
	});

	it('detects Purpose / X-Purpose legacy variants', () => {
		expect(isPrefetch(makeHeader({ Purpose: 'prefetch' }))).toBe(true);
		expect(isPrefetch(makeHeader({ 'X-Purpose': 'prefetch' }))).toBe(true);
	});

	it('accepts other Sec-Purpose values', () => {
		const h = makeHeader({ 'Sec-Purpose': 'prefetch; keys=*' });
		// The substring needle is broad enough for structured prefetch
		// declarations — see filter.ts comment.
		expect(isPrefetch(h)).toBe(true);
		const h2 = makeHeader({ 'Sec-Purpose': 'analytics' });
		expect(isPrefetch(h2)).toBe(false);
	});

	it('returns false when no prefetch headers are set', () => {
		const h = makeHeader({ 'User-Agent': 'Mozilla/5.0' });
		expect(isPrefetch(h)).toBe(false);
	});
});

describe('AccessCounterDedupeCache', () => {
	let cache: AccessCounterDedupeCache;
	beforeEach(() => {
		cache = new AccessCounterDedupeCache();
	});

	it('admits the first triple and rejects the second inside the TTL', () => {
		const ctx = { ip: '1.1.1.1', ua: 'Mozilla/5.0', path: 'home-page' };
		expect(cache.shouldRecord(1_000, ctx)).toBe(true);
		expect(cache.shouldRecord(1_000 + 1, ctx)).toBe(false);
		expect(cache.shouldRecord(1_000 + 60_000, ctx)).toBe(false);
	});

	it('admits the same triple again after the TTL expires', () => {
		const ctx = { ip: '1.1.1.1', ua: 'Mozilla/5.0', path: 'home-page' };
		expect(cache.shouldRecord(1_000, ctx)).toBe(true);
		expect(cache.shouldRecord(1_000 + LRU_TTL_MS + 1, ctx)).toBe(true);
	});

	it('treats ip / ua / path as part of the key', () => {
		const base = { ip: '1.1.1.1', ua: 'Mozilla/5.0', path: 'home-page' };
		expect(cache.shouldRecord(1_000, base)).toBe(true);
		// Same UA + path but a different IP -> fresh slot.
		expect(cache.shouldRecord(1_000, { ...base, ip: '2.2.2.2' })).toBe(true);
		// Same IP + path but a different UA -> fresh slot.
		expect(cache.shouldRecord(1_000, { ...base, ua: 'curl/8.0' })).toBe(true);
		// Same IP + UA but a different path -> fresh slot.
		expect(cache.shouldRecord(1_000, { ...base, path: 'about-page' })).toBe(true);
		// Original triple still rejects.
		expect(cache.shouldRecord(1_000, base)).toBe(false);
	});

	it('is a no-op when UA is missing (no fingerprint -> cannot dedupe)', () => {
		// The home's server-to-server self-call (ADR-0011) does not
		// attach a User-Agent. The LRU cannot fingerprint these
		// callers reliably, so every call is admitted and the D1
		// session_id dedup remains the source of truth.
		const ctx = { ip: '1.1.1.1', ua: undefined, path: 'home-page' };
		expect(cache.shouldRecord(1_000, ctx)).toBe(true);
		expect(cache.shouldRecord(1_000 + 1, ctx)).toBe(true);
		expect(cache.shouldRecord(1_000 + 60_000, ctx)).toBe(true);
	});

	it('expires stale entries lazily on the next write', () => {
		const ctx = { ip: '1.1.1.1', ua: 'Mozilla/5.0', path: 'home-page' };
		expect(cache.shouldRecord(1_000, ctx)).toBe(true);
		// Jump forward past the window — old triple should be accepted again
		// because `sweepExpired` dropped it before the lookup.
		expect(cache.shouldRecord(1_000 + LRU_TTL_MS + 1, ctx)).toBe(true);
	});
});

describe('dedupeCache singleton (router-facing)', () => {
	beforeEach(() => {
		dedupeCache._reset();
	});

	it('rejects a repeat hit from the same ip/ua/path within 5 minutes', () => {
		const ctx = { ip: '9.9.9.9', ua: 'Mozilla/5.0', path: 'home-page' };
		expect(dedupeCache.shouldRecord(5_000, ctx)).toBe(true);
		expect(dedupeCache.shouldRecord(5_000 + 60_000, ctx)).toBe(false);
		expect(dedupeCache.shouldRecord(5_000 + LRU_TTL_MS + 1, ctx)).toBe(true);
	});
});
