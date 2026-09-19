export type SystemServiceId = 'd1' | 'r2' | 'external-boundary';

export interface SystemService {
	id: SystemServiceId;
	label: string;
	binding: string;
	description: string;
}

export type SystemServiceHealth = 'ok' | 'degraded' | 'unreachable';

export interface SystemServiceStatus {
	id: SystemServiceId;
	health: SystemServiceHealth;
	detail?: string;
}

export const HEALTH_LABEL: Record<SystemServiceHealth, string> = {
	ok: 'reachable',
	degraded: 'degraded',
	unreachable: 'unreachable',
};

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
