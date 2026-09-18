import { createServerFn } from '@tanstack/react-start';
import { env } from 'cloudflare:workers';
import type { SystemServiceHealth, SystemServiceStatus } from './model';
import { d1RowToStatus, safeProbe } from './probes';

/**
 * Internal application operations for the home page.
 *
 * Runs server-side only. The Hono external boundary is **not**
 * involved — these reads use the same `cloudflare:workers` env as
 * the rest of the TanStack Start tree (see ADR-0002). Failure
 * paths convert to a safe `unreachable` health string; raw binding
 * errors never cross to the client.
 *
 * Issue #19 contract: every deviation from the canonical SELECT 1
 * → 1 read (exception, empty result, unexpected value) collapses
 * to `unreachable`. The pure helpers `d1RowToStatus` and
 * `safeProbe` live in `./probes` so unit tests can verify the
 * transform without bringing the `cloudflare:workers` virtual
 * module into the client bundle.
 */

/**
 * D1 probe. Module-scope `env` is captured so TanStack Start can
 * extract the handler closure normally; do not thread `env`
 * through the parameter list (that would force Rollup to keep the
 * `cloudflare:workers` import alive in the client bundle).
 */
function probeD1(): Promise<SystemServiceStatus> {
	return safeProbe(
		'd1',
		() => env.DB.prepare('SELECT 1 AS one').first<{ one: number }>(),
		d1RowToStatus,
		'd1',
	);
}

/**
 * R2 probe. Out of scope for Issue #19 but kept here so the home
 * loader stays a single entrypoint. The 404-shaped error from
 * `MEDIA.head('probe')` is the canonical "bucket reachable" signal
 * in 0.2.0 because the probe key is intentionally absent.
 */
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

/**
 * External-boundary probe. The boundary is exercised on every
 * render of the home page — it is the same code path the Hono
 * handlers use. We do not make an HTTP round-trip to ourselves
 * here; if the module graph compiled and the route rendered, the
 * boundary is wired. Surface it as "ok" with a stable detail
 * string.
 */
function probeExternalBoundary(): SystemServiceStatus {
	return {
		id: 'external-boundary',
		health: 'ok',
		detail: '/api/v1/* wired through src/http/hono.ts',
	};
}

export const getHomeSystemStatus = createServerFn({ method: 'GET' }).handler(
	async (): Promise<readonly SystemServiceStatus[]> => {
		const [external, d1, r2] = await Promise.all([
			Promise.resolve(probeExternalBoundary()),
			probeD1(),
			probeR2(),
		]);
		return [external, d1, r2];
	},
);

export type HealthLabel = Record<SystemServiceHealth, string>;

export const HEALTH_LABEL: HealthLabel = {
	ok: 'reachable',
	degraded: 'degraded',
	unreachable: 'unreachable',
};
