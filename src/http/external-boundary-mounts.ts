/**
 * External boundary mount record (Issue #841, decision O-13).
 *
 * `EXTERNAL_BOUNDARY_PREFIXES` in `src/server.ts` declares which path
 * prefixes the Worker entry hands to the Hono boundary. Declaring a
 * prefix is NOT the same as mounting a handler under it: `/webhooks`,
 * `/oauth` and `/integrations` are declared so their writes get the
 * boundary's JSON contract (and so a future handler lands inside the
 * reviewed boundary), but today no router answers under them — every
 * request falls through to `externalBoundary.notFound`.
 *
 * This module is the machine-readable record of that distinction:
 * for every declared prefix, whether a real handler is mounted
 * (`mounted`) or the prefix exists only as a declaration
 * (`declared-only`), plus the probe that proves it. The contract test
 * (`external-boundary-mounts.test.ts`) drives the live boundary and
 * fails when the record and the runtime disagree — a record edited
 * without a matching mount change is a red test, not silent drift.
 *
 * The prefix list itself stays owned by `src/server.ts` /
 * `scripts/_index-boundary.mjs`; this record is keyed by it and the
 * test asserts exact coverage, so a new declared prefix cannot ship
 * without a mount decision.
 */

export type BoundaryMountStatus = 'mounted' | 'declared-only';

export interface BoundaryMountProbe {
	/**
	 * GET path on the external boundary that proves the entry's claim.
	 * For `mounted` entries this must be answered by a real handler —
	 * never by `externalBoundary.notFound`. For `declared-only` entries
	 * it must produce the boundary's JSON 404.
	 */
	readonly path: string;
	/**
	 * Exact status to pin when the handler's answer is deterministic.
	 * Omit when the meaningful contract is "a real handler answered"
	 * (e.g. `/.well-known/security.txt`, whose status depends on the
	 * published policy manifest).
	 */
	readonly status?: number;
}

export interface BoundaryMountEntry {
	readonly status: BoundaryMountStatus;
	readonly probe: BoundaryMountProbe;
}

/**
 * The boundary's own 404 shape (`externalBoundary.notFound` in
 * `src/http/hono.ts`): `{ error: 'not_found', path: <request path> }`
 * with status 404 and a JSON content type. A `declared-only` prefix
 * answers exactly this for every path under it — that IS its explicit
 * contract (Issue #841 acceptance), pinned by the contract test.
 */
export const BOUNDARY_NOT_FOUND_CONTRACT = Object.freeze({
	status: 404,
	error: 'not_found',
} as const);

export const EXTERNAL_BOUNDARY_MOUNTS: Readonly<Record<string, BoundaryMountEntry>> = Object.freeze(
	{
		// The whole /api/v1 surface: health, db/media pings, access,
		// reactions, reaction-images, github-readme-stats, presence,
		// activity — all mounted in src/http/hono.ts.
		'/api/v1': {
			status: 'mounted',
			probe: { path: '/api/v1/health', status: 200 },
		},
		// Declared for the boundary contract only — no webhook handler
		// is mounted (the signature/replay obligations in
		// src/http/webhooks/ are contracts without a live route, tracked
		// under Issue #840's obligation audit).
		'/webhooks': {
			status: 'declared-only',
			probe: { path: '/webhooks/__mount_probe__' },
		},
		// Same: the OAuth surface is declared, nothing is mounted.
		'/oauth': {
			status: 'declared-only',
			probe: { path: '/oauth/__mount_probe__' },
		},
		// Same: the integrations surface is declared, nothing is mounted.
		'/integrations': {
			status: 'declared-only',
			probe: { path: '/integrations/__mount_probe__' },
		},
		// /media/<key> streams gated R2 objects (Issue #634). Its own
		// notFound is a bare 404 with no JSON body, which is exactly
		// what distinguishes "mounted but absent" from "declared-only".
		'/media': {
			status: 'mounted',
			probe: { path: '/media/__mount_probe__', status: 404 },
		},
		// Exact-match SEO documents rendered by src/http/seo/router.ts.
		'/sitemap.xml': {
			status: 'mounted',
			probe: { path: '/sitemap.xml', status: 200 },
		},
		'/robots.txt': {
			status: 'mounted',
			probe: { path: '/robots.txt', status: 200 },
		},
		// RFC 9116 security.txt (Issue #468). 200 or 404 depending on
		// the published policy manifest — the contract is the
		// text/plain content type, not the status.
		'/.well-known': {
			status: 'mounted',
			probe: { path: '/.well-known/security.txt' },
		},
	},
);

/** What one probe observation looked like, reduced to the two facts the record cares about. */
export interface BoundaryProbeObservation {
	readonly status: number;
	readonly contentType: string;
	/** Parsed JSON body when the response was JSON, else null. */
	readonly jsonBody: unknown;
}

/**
 * True when the response IS the boundary's own notFound answer —
 * status 404, JSON content type, `{ error: 'not_found' }` body. This
 * is the signal that no real handler claimed the path.
 */
export function isBoundaryNotFound(observation: BoundaryProbeObservation): boolean {
	if (observation.status !== BOUNDARY_NOT_FOUND_CONTRACT.status) return false;
	if (!observation.contentType.includes('application/json')) return false;
	const body = observation.jsonBody;
	return (
		typeof body === 'object' &&
		body !== null &&
		(body as { error?: unknown }).error === BOUNDARY_NOT_FOUND_CONTRACT.error
	);
}

/** The runtime classification a probe implies for its prefix. */
export type BoundaryMountActual = 'mounted' | 'declared-only';

/**
 * Classify one probe observation against its record entry. Returns the
 * runtime status the observation proves, or a violation string when
 * the observation cannot prove the recorded claim.
 */
export function classifyProbe(
	prefix: string,
	entry: BoundaryMountEntry,
	observation: BoundaryProbeObservation,
): { actual: BoundaryMountActual } | { violation: string } {
	const boundary404 = isBoundaryNotFound(observation);
	if (entry.status === 'declared-only') {
		if (!boundary404) {
			return {
				violation: `${prefix} is recorded declared-only but its probe answered status ${observation.status} content-type ${observation.contentType} — a handler may be mounted without a record update`,
			};
		}
		return { actual: 'declared-only' };
	}
	if (boundary404) {
		return {
			violation: `${prefix} is recorded mounted but its probe fell through to the boundary JSON 404 — the mount claim is stale`,
		};
	}
	if (entry.probe.status !== undefined && observation.status !== entry.probe.status) {
		return {
			violation: `${prefix} probe ${entry.probe.path} answered ${observation.status}, record expects ${entry.probe.status}`,
		};
	}
	return { actual: 'mounted' };
}

/**
 * Whole-record consistency check, separated from the live probes so
 * the negative controls can drive it with fabricated observations.
 * `declaredPrefixes` is the authoritative prefix list
 * (`EXTERNAL_BOUNDARY_PREFIXES`); `actual` maps each probed prefix to
 * the runtime classification its observation implied.
 */
export function evaluateBoundaryMounts(
	declaredPrefixes: readonly string[],
	mounts: Readonly<Record<string, BoundaryMountEntry>>,
	actual: Readonly<Record<string, BoundaryMountActual>>,
): string[] {
	const violations: string[] = [];
	for (const prefix of declaredPrefixes) {
		const entry = mounts[prefix];
		if (!entry) {
			violations.push(
				`${prefix} is a declared external boundary prefix with no mount record — declare mounted or declared-only`,
			);
			continue;
		}
		const observed = actual[prefix];
		if (observed === undefined) {
			violations.push(`${prefix} has a mount record but was never probed`);
			continue;
		}
		if (observed !== entry.status) {
			violations.push(
				`${prefix} is recorded ${entry.status} but the boundary answers as ${observed}`,
			);
		}
	}
	for (const prefix of Object.keys(mounts)) {
		if (!declaredPrefixes.includes(prefix)) {
			violations.push(
				`${prefix} has a mount record but is not a declared external boundary prefix — the record is stale`,
			);
		}
	}
	return violations;
}
