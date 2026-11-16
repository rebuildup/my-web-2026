/**
 * Visit trail — "このブラウザでこのサイトのどこを見たか" (Issue #936,
 * Epic #928).
 *
 * What it is
 * ----------
 * A bounded, most-recent-first list of site-internal paths this
 * browser has visited, kept in `localStorage` under one key. The home
 * guide renders it as "続きから見られる場所" chips so a returning
 * visitor can jump back to where they were — exploration help, not
 * analytics.
 *
 * What it is NOT
 * ---------------
 *   - No identifier, timestamp, query string, referrer, UA or any
 *     cross-session profile. Paths only, capped at {@link
 *     VISIT_TRAIL_MAX}, overwritten in place.
 *   - Never sent anywhere: read and write happen entirely in the
 *     visitor's browser (same contract as the current-projects
 *     signature store, `src/privacy/data-lifecycle.ts`).
 *   - `/admin*` and `/api*` are never recorded — the trail is a
 *     public-surface memory.
 *   - Storage failure (private mode, quota, blocked) degrades to
 *     "no trail": the page renders exactly the same guide.
 */

/** The one key this feature stores. Versioned like its siblings. */
export const VISIT_TRAIL_STORAGE_KEY = 'mw_home_visit_trail_v1';

/** How many destinations the trail remembers. */
export const VISIT_TRAIL_MAX = 5;

/** Path prefixes that must never enter the trail. */
const EXCLUDED_PREFIXES = ['/admin', '/api'] as const;

/**
 * Normalize a candidate path for storage, or return `null` when it
 * must not be recorded.
 *
 * Accepts pathnames only — callers pass `location.pathname`, never a
 * full URL or a query string, so nothing parameter-bearing can be
 * stored. A leading `/` is required; `//` (protocol-relative), empty
 * strings and the excluded namespaces are refused.
 */
export function normalizeVisitPath(path: unknown): string | null {
	if (typeof path !== 'string' || path.length === 0) return null;
	if (!path.startsWith('/') || path.startsWith('//')) return null;
	// Pathnames only: a query or fragment could carry parameters, and
	// the trail stores destinations, not requests.
	if (path.includes('?') || path.includes('#')) return null;
	for (const prefix of EXCLUDED_PREFIXES) {
		if (path === prefix || path.startsWith(`${prefix}/`)) return null;
	}
	return path;
}

/** Minimal storage surface — `window.localStorage` or a test fake. */
export interface VisitTrailStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** Parse a stored value into a clean trail, or `[]` when unusable. */
export function parseVisitTrail(raw: string | null): string[] {
	if (raw === null) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const trail: string[] = [];
		for (const entry of parsed) {
			const path = normalizeVisitPath(entry);
			if (path !== null && !trail.includes(path)) trail.push(path);
			if (trail.length >= VISIT_TRAIL_MAX) break;
		}
		return trail;
	} catch {
		return [];
	}
}

/** Read the stored trail. Storage errors mean "no trail". */
export function readVisitTrail(storage: VisitTrailStorage): string[] {
	try {
		return parseVisitTrail(storage.getItem(VISIT_TRAIL_STORAGE_KEY));
	} catch {
		return [];
	}
}

/**
 * Record a visit and return the new trail (most-recent-first,
 * deduplicated, capped). Pure: the caller persists the result.
 */
export function pushVisit(trail: readonly string[], path: string): string[] {
	const normalized = normalizeVisitPath(path);
	if (normalized === null) return [...trail];
	return [normalized, ...trail.filter((p) => p !== normalized)].slice(0, VISIT_TRAIL_MAX);
}

/** Persist a trail. Write failures are swallowed by contract. */
export function writeVisitTrail(storage: VisitTrailStorage, trail: readonly string[]): void {
	try {
		storage.setItem(VISIT_TRAIL_STORAGE_KEY, JSON.stringify(trail));
	} catch {
		// Private mode / quota / blocked storage: the page keeps
		// rendering; only the next visit loses its memory.
	}
}

/** Record one navigation: read → push → write, all failure-safe. */
export function recordVisit(storage: VisitTrailStorage, path: string): void {
	writeVisitTrail(storage, pushVisit(readVisitTrail(storage), path));
}
