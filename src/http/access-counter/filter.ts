/**
 * Access counter — pre-D1 ingress filters (Issue #170).
 *
 * Three independent gates that run before the existing
 * `(counter_key, principal, session_id)` D1 dedup so obvious
 * non-human / repeat traffic never reaches SQLite:
 *
 *   1. Bot UA filter       — reject when `User-Agent` matches the
 *                            `BOT_UA_RE` regex below.
 *   2. Prefetch detection  — reject when any of `Sec-Purpose`,
 *                            `Purpose`, or `X-Purpose` contains the
 *                            case-insensitive substring `prefetch`.
 *   3. In-memory LRU dedupe — reject when an entry for the same
 *                            `${ip}|${ua}|${path}` triple was seen
 *                            inside `LRU_TTL_MS` (5 minutes).
 *
 * The LRU is **Worker-isolate-local** — best-effort only. Cross-
 * replica dedupe would need KV / Durable Object and is explicitly
 * out of scope for this ticket. The D1 dedup that already exists in
 * `counter.ts` remains the durable source of truth.
 *
 * These gates are exposed as plain pure functions (no Hono / D1
 * coupling) so unit tests can drive them directly without workerd.
 */

const BOT_UA_RE =
	/bot|crawler|spider|slurp|bingpreview|facebookexternalhit|preview|monitor|headlesschrome/i;

const PREFETCH_HEADER_KEYS = ['sec-purpose', 'purpose', 'x-purpose'] as const;
const PREFETCH_NEEDLE = 'prefetch';

export const LRU_TTL_MS = 5 * 60 * 1000;
/** Hard cap on LRU size — protects worker isolate memory. */
export const LRU_MAX_ENTRIES = 10_000;

export interface AccessCounterHitContext {
	/** Caller IP. Cloudflare's `cf-connecting-ip` or a test fallback. */
	ip: string;
	/** Caller `User-Agent` header verbatim (undefined when absent). */
	ua: string | undefined;
	/** The counter key from the parsed POST body (e.g. `home-page`). */
	path: string;
}

/**
 * Bot UA filter. The regex is intentionally permissive — false
 * positives (legitimate UAs matching) are cheaper than false
 * negatives (counting synthetic traffic).
 *
 * A missing / empty UA is **not** treated as a bot. The home's
 * server-to-server self-call (ADR-0011) doesn't attach a
 * `User-Agent`, and rejecting it would zero the counter. Real bots
 * virtually always set a UA; the absence of one is most often a
 * programmatic client, not a crawler.
 */
export function isBot(ua: string | undefined | null): boolean {
	if (!ua) return false;
	return BOT_UA_RE.test(ua);
}

/**
 * Prefetch detection. Browsers send `Sec-Purpose: prefetch` (the
 * spec name) plus legacy `Purpose` / `X-Purpose` variants used by
 * some proxies. Any hit on the `prefetch` substring rejects the
 * request — Chromium also sends `prefetch; …` so a substring match
 * covers both bare and structured values.
 */
export function isPrefetch(headers: {
	get(name: string): string | null;
}): boolean {
	for (const key of PREFETCH_HEADER_KEYS) {
		const value = headers.get(key);
		if (value?.toLowerCase().includes(PREFETCH_NEEDLE)) return true;
	}
	return false;
}

/**
 * Bounded in-memory LRU keyed by `${ip}|${ua}|${path}`. Entries
 * expire after `LRU_TTL_MS`; a separate `sweepExpired(now)` runs on
 * every write to keep the table small under sustained traffic.
 *
 * JavaScript inside a single Worker isolate is single-threaded, so
 * no locking is required. The cache is module-scoped (singleton) —
 * see `dedupeCache` below.
 *
 * When `ua` is missing the LRU is a no-op — we cannot fingerprint
 * the caller reliably without a UA, so dedupe would either be a
 * no-op (good) or incorrectly swallow repeated same-triple hits
 * from legitimate callers (bad). The D1 `(key, principal,
 * session_id)` dedup already covers the generic repeat-hit case.
 */
export class AccessCounterDedupeCache {
	private readonly entries = new Map<string, number>();
	/** Test seam — exported so specs can reset state between cases. */
	public _reset(): void {
		this.entries.clear();
	}

	/**
	 * Returns `true` when the triple was **not** seen inside the
	 * current TTL window (i.e. the caller should record the hit).
	 * Returns `false` when the triple is still cached (the caller
	 * should reject the hit).
	 *
	 * Also records `now` for the current triple so the next call
	 * inside the window is rejected.
	 */
	public shouldRecord(now: number, ctx: AccessCounterHitContext): boolean {
		if (!ctx.ua) return true; // no fingerprint -> don't dedupe
		this.sweepExpired(now);
		const key = `${ctx.ip}|${ctx.ua}|${ctx.path}`;
		const prev = this.entries.get(key);
		if (prev !== undefined && now - prev < LRU_TTL_MS) {
			// Refresh the entry's recency — Map iteration is insertion-
			// ordered, so delete + set moves the key to the tail and
			// keeps the LRU invariant under sustained traffic.
			this.entries.delete(key);
			this.entries.set(key, prev);
			return false;
		}
		this.entries.set(key, now);
		this.evictIfOverLimit();
		return true;
	}

	private sweepExpired(now: number): void {
		for (const [key, ts] of this.entries) {
			if (now - ts >= LRU_TTL_MS) this.entries.delete(key);
			else break; // oldest entries are at the head; stop on first live
		}
	}

	private evictIfOverLimit(): void {
		if (this.entries.size <= LRU_MAX_ENTRIES) return;
		const overflow = this.entries.size - LRU_MAX_ENTRIES;
		const it = this.entries.keys();
		for (let i = 0; i < overflow; i++) {
			const k = it.next().value;
			if (k === undefined) break;
			this.entries.delete(k);
		}
	}
}

/** Module-scoped singleton — Worker isolates share this instance. */
export const dedupeCache = new AccessCounterDedupeCache();
