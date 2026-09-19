import { env } from 'cloudflare:workers';

export type CloudflareServiceId = 'd1' | 'r2';
export type CloudflareServiceHealth = 'ok' | 'degraded' | 'unreachable';

export interface CloudflareServiceStatus {
	id: CloudflareServiceId;
	health: CloudflareServiceHealth;
	detail?: string;
}

/**
 * Convert the canonical D1 SELECT 1 result into a public-safe status.
 * Raw rows and binding errors never cross this boundary.
 */
export function d1RowToStatus(row: unknown): CloudflareServiceStatus {
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

export async function safeProbe(
	id: CloudflareServiceId,
	probe: () => Promise<unknown>,
	map: (result: unknown) => CloudflareServiceStatus,
	logLabel: string,
): Promise<CloudflareServiceStatus> {
	try {
		return map(await probe());
	} catch (err) {
		console.error(`[cloudflare] ${logLabel} probe failed`, err);
		return { id, health: 'unreachable' };
	}
}

function probeD1(): Promise<CloudflareServiceStatus> {
	return safeProbe(
		'd1',
		() => env.DB.prepare('SELECT 1 AS one').first<{ one: number }>(),
		d1RowToStatus,
		'd1',
	);
}

async function probeR2(): Promise<CloudflareServiceStatus> {
	try {
		const object = await env.MEDIA.head('probe');
		if (object) {
			return { id: 'r2', health: 'ok', detail: 'probe key present' };
		}
		return { id: 'r2', health: 'ok', detail: 'bucket reachable, probe key absent' };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/404|not[_ ]?found/i.test(message)) {
			return { id: 'r2', health: 'ok', detail: 'bucket reachable, probe key absent' };
		}
		console.error('[cloudflare] r2 probe failed', err);
		return { id: 'r2', health: 'unreachable' };
	}
}

/**
 * Cloudflare owns the health of its bindings. Consumers receive only
 * the stable, public-safe health contract.
 */
export async function probeCloudflareHealth(): Promise<readonly CloudflareServiceStatus[]> {
	return Promise.all([probeD1(), probeR2()]);
}
