export type SystemServiceId = 'd1' | 'r2' | 'external-boundary';

export interface SystemService {
	id: SystemServiceId;
	label: string;
	binding: string;
	description: string;
}

/**
 * The health vocabulary of the status surface.
 *
 * `unobserved` (Issue #502) is NOT a failure state. It is the state
 * of a service for which no reading exists at all — the probe
 * returned nothing, or the snapshot carried no entry for it. Before
 * this state existed, a missing entry fell back to `unreachable`, so
 * "we have no reading" and "the read failed" rendered the same word
 * and the same silhouette, and a visitor had no way to tell a
 * measurement gap apart from a fault.
 *
 * The four states are therefore four DISTINCT facts, and each one
 * owns its own label and its own `StateMark` silhouette:
 *
 *   - `ok`          — the read succeeded;
 *   - `degraded`    — the read succeeded and reported a problem;
 *   - `unreachable` — the read FAILED (the service could not be
 *                     reached);
 *   - `unobserved`  — there was NO read (nothing was observed).
 */
export type SystemServiceHealth = 'ok' | 'degraded' | 'unreachable' | 'unobserved';

export interface SystemServiceStatus {
	id: SystemServiceId;
	health: SystemServiceHealth;
	detail?: string;
}

export const HEALTH_LABEL: Record<SystemServiceHealth, string> = {
	ok: 'reachable',
	degraded: 'degraded',
	unreachable: 'unreachable',
	unobserved: 'not observed',
};

/**
 * The detail a service row shows when NO reading exists.
 *
 * The wording states the absence, not a fault: an unobserved service
 * is not a broken one, and the copy must not imply that it is.
 */
export const UNOBSERVED_DETAIL = 'No reading was returned for this service.';

export interface ExternalBoundaryHealth {
	id: 'external-boundary';
	health: 'ok';
	detail: string;
}

/**
 * Reports the configured external HTTP boundary. Lives in the home
 * status owner because it is only consumed by the home status tiles
 * — the HTTP boundary itself has no use for it. The shape is
 * intentionally not a loopback network probe; reachability is
 * covered by integration tests at `/api/v1/health`.
 */
export function getExternalBoundaryHealth(): ExternalBoundaryHealth {
	return {
		id: 'external-boundary',
		health: 'ok',
		detail: '/api/v1/* wired through src/http/hono.ts',
	};
}
