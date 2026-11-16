/**
 * Micro cache for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/common/microCache.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 *
 * In-memory cache per isolate. TTL: 5 seconds.
 */

interface CacheEntry<T> {
	data?: T;
	timestamp?: number;
	promise?: Promise<T>;
}

const cache = new Map<string, CacheEntry<unknown>>();
const INTERNAL_TTL = 500_000; // 5 seconds internal cache ONLY

export async function microCache<T>(
	key: string,
	fetchFn: () => Promise<T>,
): Promise<T> {
	const now = Date.now();
	const cached = cache.get(key);

	// Return fresh cached data
	if (cached && cached.data && now - (cached.timestamp ?? 0) < INTERNAL_TTL) {
		return cached.data as T;
	}

	// Dedupe: If a promise already exists, wait for it
	if (cached && cached.promise) {
		return (await cached.promise) as T;
	}

	// Create a new fetch request
	const promise = fetchFn()
		.then((data) => {
			cache.set(key, { data, timestamp: Date.now() });
			return data;
		})
		.finally(() => {
			const entry = cache.get(key);
			if (entry) entry.promise = undefined;
		});

	cache.set(key, { promise });

	return (await promise) as T;
}

// Exported so tests can reset between cases
export { cache as microCacheStore };