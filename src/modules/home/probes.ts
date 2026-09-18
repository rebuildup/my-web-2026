import type { SystemServiceStatus } from './model';

/**
 * Pure transform helpers for the home capability probes.
 *
 * Lives in its own module (no `cloudflare:workers` import) so unit
 * tests can verify the safe failure contract without bringing the
 * Cloudflare virtual module into the client bundle. The server
 * function file (`server.ts`) imports from here and re-exports
 * nothing from this surface.
 *
 * Issue #19 contract: every failure path collapses to
 * `health: 'unreachable'` and never carries a raw row payload, an
 * error message, or a binding identifier across the boundary.
 */

/**
 * Pure mapper: D1 probe result → safe SystemServiceStatus.
 *
 * The canonical happy input `{ one: 1 }` resolves to
 * `{ id: 'd1', health: 'ok', detail: 'SELECT 1 returned 1' }`. Any
 * other input (empty result, wrong value, garbage type) collapses
 * to `{ id: 'd1', health: 'unreachable' }`. The function never
 * throws and never includes the original row, an error message,
 * or a binding identifier in the returned status.
 */
export function d1RowToStatus(row: unknown): SystemServiceStatus {
	if (isCanonicalD1Row(row)) {
		return { id: 'd1', health: 'ok', detail: 'SELECT 1 returned 1' };
	}
	return { id: 'd1', health: 'unreachable' };
}

function isCanonicalD1Row(value: unknown): value is { one: 1 } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'one' in value &&
		(value as { one: unknown }).one === 1
	);
}

/**
 * Pure wrapper: probe + mapper, with safe failure transform.
 *
 * On rejection, the original error is logged via `console.error`
 * for operator visibility but is never attached to the returned
 * status — only `id` and `health` cross the boundary. The probe
 * function is injected so unit tests can simulate every failure
 * path (rejection, null result, garbage result, canonical result)
 * without a real binding.
 */
export async function safeProbe(
	id: SystemServiceStatus['id'],
	probe: () => Promise<unknown>,
	map: (result: unknown) => SystemServiceStatus,
	logLabel: string,
): Promise<SystemServiceStatus> {
	try {
		const result = await probe();
		return map(result);
	} catch (err) {
		console.error(`[home] ${logLabel} probe failed`, err);
		return { id, health: 'unreachable' };
	}
}
