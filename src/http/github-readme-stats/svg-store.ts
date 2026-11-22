/**
 * Persistent SVG store for the GitHub Readme Stats cards (Issue #1164).
 *
 * The in-memory `svgCache`/`microCache` layers only survive inside one
 * isolate, so an upstream GitHub API outage used to surface as a 503
 * error card — and because the boundary default is `no-store`, camo /
 * CDN layers could not hold the last good card either. This module
 * keeps the last successfully rendered SVG in the Workers Cache API
 * (per-colo, durable across isolate restarts) so a request can always
 * be answered with the most recent good card while a refresh runs in
 * the background.
 *
 * The store key is deliberately decoupled from the request URL: the
 * cards are personal-fixed (Issue #1164), so one key per card variant
 * is the whole keyspace.
 */

// The Cache API keys on absolute URLs; the synthetic path under the
// canonical origin keeps the keyspace inside hosts the publication
// surface already records (no new outbound dependency — the URL is a
// dictionary key, never fetched).
const STORE_ORIGIN = 'https://rebuildup.dev';
const STORE_PATH_PREFIX = '/__readme-stats-svg-store/';

/**
 * The stored copy is immutable by construction — it is only replaced
 * by a newer render — so it carries the longest lifetime the Cache API
 * accepts. Freshness is governed by `x-svg-rendered-at`, not by this
 * header.
 */
const STORE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const RENDERED_AT_HEADER = 'x-svg-rendered-at';

export interface StoredSvg {
	svg: string;
	/** Epoch milliseconds of the render that produced `svg`. */
	renderedAt: number;
}

function storeRequest(name: string): Request {
	return new Request(`${STORE_ORIGIN}${STORE_PATH_PREFIX}${name}`);
}

function cachesApi(): Cache | null {
	try {
		// `caches` is a Workers global; the DOM `CacheStorage` type does
		// not declare `.default`, and non-worker pools may lack it.
		if (typeof caches === 'undefined') return null;
		return (caches as unknown as { default: Cache }).default;
	} catch {
		return null;
	}
}

/** Last rendered SVG for `name`, or null when nothing was ever stored. */
export async function svgStoreMatch(name: string): Promise<StoredSvg | null> {
	const store = cachesApi();
	if (!store) return null;
	try {
		const res = await store.match(storeRequest(name));
		if (!res) return null;
		const svg = await res.text();
		const renderedAt = Number.parseInt(res.headers.get(RENDERED_AT_HEADER) ?? '', 10);
		return { svg, renderedAt: Number.isFinite(renderedAt) ? renderedAt : 0 };
	} catch {
		return null;
	}
}

/** Persist a freshly rendered SVG. Never throws — a store failure must
 * not turn a good render into a failed response. */
export async function svgStorePut(
	name: string,
	svg: string,
	renderedAt: number = Date.now(),
): Promise<void> {
	const store = cachesApi();
	if (!store) return;
	trackedNames.add(name);
	try {
		await store.put(
			storeRequest(name),
			new Response(svg, {
				headers: {
					'content-type': 'image/svg+xml',
					'cache-control': STORE_CACHE_CONTROL,
					[RENDERED_AT_HEADER]: String(renderedAt),
				},
			}),
		);
	} catch {
		// Cache API eviction / quota failures are non-fatal.
	}
}

const trackedNames = new Set<string>();

/** Test hook: drop every SVG this isolate stored. */
export async function svgStoreClear(): Promise<void> {
	const store = cachesApi();
	if (!store) return;
	for (const name of trackedNames) {
		try {
			await store.delete(storeRequest(name));
		} catch {
			// best effort
		}
	}
	trackedNames.clear();
}
