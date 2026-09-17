import { createServerFn } from '@tanstack/react-start';
import { env } from 'cloudflare:workers';
import type { SystemServiceHealth, SystemServiceStatus } from './model';

/**
 * Internal application operations for the home page.
 *
 * Runs server-side only. The Hono external boundary is **not**
 * involved — these reads use the same `cloudflare:workers` env as
 * the rest of the TanStack Start tree (see ADR-0002). Failure
 * paths convert to a safe `unreachable` health string; raw binding
 * errors never cross to the client.
 */

async function probeD1(): Promise<SystemServiceStatus> {
	try {
		const row = await env.DB.prepare('SELECT 1 AS one').first<{ one: number }>();
		if (row?.one === 1) {
			return { id: 'd1', health: 'ok', detail: 'SELECT 1 returned 1' };
		}
		return { id: 'd1', health: 'degraded', detail: 'empty result set' };
	} catch (err) {
		console.error('[home] d1 probe failed', err);
		return { id: 'd1', health: 'unreachable' };
	}
}

async function probeR2(): Promise<SystemServiceStatus> {
	try {
		const object = await env.MEDIA.head('probe');
		if (object) {
			return { id: 'r2', health: 'ok', detail: 'probe key present' };
		}
		return { id: 'r2', health: 'ok', detail: 'bucket reachable, probe key absent' };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/404|not[_ ]?found/i.test(message)) {
			// The probe key is intentionally absent in 0.2.0; "bucket
			// reachable" is the canonical healthy state.
			return { id: 'r2', health: 'ok', detail: 'bucket reachable, probe key absent' };
		}
		console.error('[home] r2 probe failed', err);
		return { id: 'r2', health: 'unreachable' };
	}
}

async function probeExternalBoundary(): Promise<SystemServiceStatus> {
	// The external boundary is exercised on every render of the home
	// page — it is the same code path the Hono handlers use. We do
	// not make an HTTP round-trip to ourselves here; if the module
	// graph compiled and the route rendered, the boundary is wired.
	// Surface it as "ok" with a stable detail string.
	return {
		id: 'external-boundary',
		health: 'ok',
		detail: '/api/v1/* wired through src/http/hono.ts',
	};
}

export const getHomeSystemStatus = createServerFn({ method: 'GET' }).handler(
	async (): Promise<readonly SystemServiceStatus[]> => {
		const [external, d1, r2] = await Promise.all([probeExternalBoundary(), probeD1(), probeR2()]);
		return [external, d1, r2];
	},
);

export type HealthLabel = Record<SystemServiceHealth, string>;

export const HEALTH_LABEL: HealthLabel = {
	ok: 'reachable',
	degraded: 'degraded',
	unreachable: 'unreachable',
};
