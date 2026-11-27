/**
 * GitHub-profile surface contract for the production smoke
 * (Issue #1254).
 *
 * The profile README (rebuildup/rebuildup) embeds independent SVG
 * surfaces served by `/api/v1/github-profile/*` (ADR-0027). This
 * module is the pure classifier half — `e2e/prod-smoke.spec.ts` is a
 * thin adapter that fetches each surface read-only and hands the
 * observation here, and `scripts/prod-smoke-github-profile.test.mjs`
 * feeds fabricated observations offline so the pass/fail logic cannot
 * silently degrade into "always green".
 *
 * What is asserted per surface:
 *   - HTTP 200 (the surfaces answer 200 in EVERY data state by
 *     contract — a 5xx means the boundary itself broke).
 *   - `Content-Type: image/svg+xml`.
 *   - A real SVG document (`<svg` present) above a byte floor, so an
 *     empty or truncated body cannot pass as "served".
 *
 * What is NOT asserted: pixel content, theme colours, or data
 * correctness — those are render-contract concerns covered by the
 * vitest suites. This smoke answers "is the delivery path alive and
 * is the snapshot pipeline fresh", which is what camo readers
 * experience when a surface silently rots.
 *
 * Snapshot freshness is asserted through
 * `GET /api/v1/github-profile/snapshot-health` (added by this issue):
 * per-source `fresh|stale|absent` states derived from D1
 * `received_at`. Only `smokeCritical` sources may fail the run —
 * `discord-presence` rides a laptop daemon that legitimately sleeps,
 * so its staleness is reported but never red.
 */

/**
 * Every profile surface the public README or the site STATUS surfaces
 * depend on, with the query variants the README's `<picture>` swap
 * actually requests. `variants` lists the `?theme=&layout=` pairs the
 * smoke fetches; the default (no query) is always fetched too.
 *
 * @type {ReadonlyArray<{path: string, label: string, variants: ReadonlyArray<string>}>}
 */
export const GITHUB_PROFILE_SURFACES = Object.freeze([
	// The five split surfaces the public README embeds (ADR-0027).
	Object.freeze({
		path: '/api/v1/github-profile/identity',
		label: 'Profile identity band',
		variants: Object.freeze(['?theme=light&layout=mobile', '?theme=dark&layout=mobile']),
	}),
	Object.freeze({
		path: '/api/v1/github-profile/vitals',
		label: 'Profile vitals surface',
		variants: Object.freeze(['?theme=light&layout=mobile', '?theme=dark&layout=mobile']),
	}),
	Object.freeze({
		path: '/api/v1/github-profile/top-languages',
		label: 'Profile top-languages surface',
		variants: Object.freeze(['?theme=light&layout=mobile', '?theme=dark&layout=mobile']),
	}),
	Object.freeze({
		path: '/api/v1/github-profile/activity-map',
		label: 'Profile activity-map surface',
		variants: Object.freeze(['?theme=light&layout=mobile', '?theme=dark&layout=mobile']),
	}),
	Object.freeze({
		path: '/api/v1/github-profile/stack',
		label: 'Profile stack band',
		variants: Object.freeze(['?theme=light&layout=mobile', '?theme=dark&layout=mobile']),
	}),
	// Compatibility + adjacent surfaces still referenced by the site
	// and older README sections.
	Object.freeze({
		path: '/api/v1/github-profile/profile',
		label: 'Composed profile (compat)',
		variants: Object.freeze([]),
	}),
	Object.freeze({
		path: '/api/v1/github-profile/status',
		label: 'Profile status strip',
		variants: Object.freeze([]),
	}),
	Object.freeze({
		path: '/api/v1/github-profile/now',
		label: 'Profile now strip',
		variants: Object.freeze([]),
	}),
	Object.freeze({
		path: '/api/v1/github-profile/activity',
		label: 'Profile activity card',
		variants: Object.freeze(['?layout=mobile']),
	}),
	Object.freeze({
		path: '/api/v1/github-profile/presence',
		label: 'Profile presence chip',
		variants: Object.freeze([]),
	}),
	Object.freeze({
		path: '/api/v1/github-profile/current',
		label: 'Profile current-projects card',
		variants: Object.freeze([]),
	}),
]);

/**
 * Floor for "a real SVG arrived". The honest `—` variants are still
 * full documents (several KB); anything under ~400 bytes is a
 * truncated or empty body, not a degraded-but-honest render.
 */
export const MIN_SVG_BYTES = 400;

/**
 * @typedef {object} SurfaceObservation
 * @property {number} status HTTP status of the response.
 * @property {string} contentType `Content-Type` response header.
 * @property {string} bodyText Response body as text (SVG source).
 */

/**
 * Classify one surface observation. Returns a problem list; empty
 * means healthy.
 *
 * @param {string} label Human label for the failure report.
 * @param {string} url The exact URL fetched (path + variant).
 * @param {SurfaceObservation} observation
 * @returns {ReadonlyArray<string>}
 */
export function auditProfileImageSurface(label, url, observation) {
	/** @type {string[]} */
	const problems = [];
	if (observation.status !== 200) {
		problems.push(`${label} ${url}: expected status 200, got ${observation.status}`);
	}
	if (!observation.contentType.toLowerCase().startsWith('image/svg')) {
		problems.push(
			`${label} ${url}: expected Content-Type starting with "image/svg", got "${observation.contentType}"`,
		);
	}
	if (!observation.bodyText.includes('<svg')) {
		problems.push(`${label} ${url}: body does not contain an <svg> element`);
	}
	if (Buffer.byteLength(observation.bodyText, 'utf8') < MIN_SVG_BYTES) {
		problems.push(
			`${label} ${url}: body is under ${MIN_SVG_BYTES} bytes — truncated or empty, not an honest variant`,
		);
	}
	return problems;
}

/** Sources the snapshot-health contract is expected to report. */
export const SNAPSHOT_HEALTH_SOURCES = Object.freeze([
	'github-activity',
	'github-stats',
	'discord-presence',
]);

/**
 * @typedef {object} SnapshotHealthObservation
 * @property {unknown} json Parsed JSON body of /snapshot-health.
 */

/**
 * Classify the `/snapshot-health` payload. `smokeCritical` sources
 * must be `fresh`; every reported source must carry a documented
 * state. Non-critical sources (`discord-presence`) may be stale or
 * absent — reported, never red.
 *
 * @param {SnapshotHealthObservation} observation
 * @returns {ReadonlyArray<string>}
 */
export function auditSnapshotHealth(observation) {
	/** @type {string[]} */
	const problems = [];
	const json = observation.json;
	const sources =
		json !== null && typeof json === 'object' ? /** @type {any} */ (json).sources : undefined;
	if (!Array.isArray(sources)) {
		return ['/api/v1/github-profile/snapshot-health: response has no sources array'];
	}
	const byId = new Map(
		sources
			.filter((s) => s !== null && typeof s === 'object')
			.map((s) => [/** @type {any} */ (s).source, /** @type {any} */ (s)]),
	);
	for (const id of SNAPSHOT_HEALTH_SOURCES) {
		const entry = byId.get(id);
		if (entry === undefined) {
			problems.push(`snapshot-health: source "${id}" is missing from the report`);
			continue;
		}
		const state = /** @type {any} */ (entry).state;
		if (!['fresh', 'stale', 'absent'].includes(state)) {
			problems.push(`snapshot-health: source "${id}" reports undocumented state "${state}"`);
			continue;
		}
		const critical = /** @type {any} */ (entry).smokeCritical === true;
		if (critical && state !== 'fresh') {
			problems.push(
				`snapshot-health: critical source "${id}" is ${state}${
					state === 'stale'
						? ` (received_at age ${/** @type {any} */ (entry).ageSeconds}s exceeds the freshness budget — the daily sync likely failed)`
						: ' (no snapshot row exists — the sync has never landed)'
				}`,
			);
		}
	}
	return problems;
}
