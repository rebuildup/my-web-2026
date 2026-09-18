export interface ExternalBoundaryHealth {
	id: 'external-boundary';
	health: 'ok';
	detail: string;
}

/**
 * Describes the external HTTP boundary that is wired by src/server.ts.
 *
 * This is intentionally not a loopback network probe. It reports the
 * configured boundary contract; endpoint-level reachability remains
 * covered by integration tests.
 */
export function getExternalBoundaryHealth(): ExternalBoundaryHealth {
	return {
		id: 'external-boundary',
		health: 'ok',
		detail: '/api/v1/* wired through src/http/hono.ts',
	};
}
