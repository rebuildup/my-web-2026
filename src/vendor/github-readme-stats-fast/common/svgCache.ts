/**
 * SVG cache for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/common/svgCache.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 *
 * In-memory cache per isolate. TTL: 5 minutes.
 */

interface SvgCacheEntry {
	promise: Promise<string>;
	time: number;
}

const SVG_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const svgCache = new Map<string, SvgCacheEntry>();

export async function svgCacheGetOrSet(
	key: string,
	renderFn: () => Promise<string>,
): Promise<string> {
	const now = Date.now();
	const cached = svgCache.get(key);

	if (cached && now - cached.time < SVG_TTL) {
		return cached.promise;
	}

	// Cache the in-flight promise, not the rendered SVG, so concurrent
	// callers for the same key share one render instead of each starting its own.
	const promise = Promise.resolve().then(renderFn);
	promise.catch(() => svgCache.delete(key)); // never cache a failure

	svgCache.set(key, {
		promise,
		time: now,
	});

	// Optional: Clean up old entries to prevent memory leaks
	if (svgCache.size > 1000) {
		const cutoff = now - SVG_TTL;
		for (const k of svgCache.keys()) {
			const v = svgCache.get(k);
			if (v && v.time < cutoff) {
				svgCache.delete(k);
			}
		}
	}

	return promise;
}

export { svgCache, SVG_TTL };