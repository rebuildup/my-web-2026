/**
 * Snapshot freshness contract (Issue #1254).
 *
 * `GET /api/v1/github-profile/snapshot-health` is the EXTERNAL
 * observation point for the D1 snapshot pipeline (ADR-0027): the
 * production smoke and any operator probe can ask "is each data
 * source fresh" without D1 credentials, and get an honest per-source
 * state instead of one blended verdict.
 *
 * States are deliberately three-valued:
 *
 *   - `absent` — no snapshot row exists at all (first sync never
 *     landed, or the table was reset). Distinct from `stale`: an
 *     absent source has NO Last Known Good to serve, so surfaces
 *     render the honest `—` variant rather than yesterday's numbers.
 *   - `stale`  — a row exists but `received_at` is older than the
 *     source's freshness budget. The surface keeps serving the Last
 *     Known Good; `stale` says that good is old.
 *   - `fresh`  — `received_at` inside the budget.
 *
 * `smokeCritical` marks the sources the daily production smoke may
 * fail on. `discord-presence` is NOT critical: its daemon lives on an
 * operator laptop that legitimately sleeps, so staleness there is
 * routine and already rendered honestly inside the presence chip —
 * failing the smoke on it would train everyone to ignore reds.
 *
 * No payload content is exposed: `received_at` and a best-effort
 * payload observation stamp are timestamps only.
 */

export type SnapshotHealthState = 'fresh' | 'stale' | 'absent';

export interface SnapshotSourceSpec {
	/** Stable id reported in the response and asserted by the smoke. */
	readonly id: string;
	/** D1 snapshot table this source's row lives in (router literals). */
	readonly table: string;
	/** `received_at` older than this means `stale`. */
	readonly staleAfterMs: number;
	/** Whether the daily prod-smoke fails when this source is not fresh. */
	readonly smokeCritical: boolean;
	/** Best-effort payload observation stamp; null when the payload lacks one. */
	readonly payloadObservedAt: (payload: unknown) => string | null;
}

const HOUR_MS = 60 * 60 * 1000;

function stringField(payload: unknown, key: string): string | null {
	if (payload === null || typeof payload !== 'object') return null;
	const value = (payload as Record<string, unknown>)[key];
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Daily launchd jobs (09:00 / 09:30 JST) + the prod-smoke cadence
 * (03:17 JST): a healthy pipeline's oldest possible `received_at` at
 * smoke time is ~18h, a single missed run pushes it past ~42h. 36h
 * sits between the two with margin for a delayed-but-successful push.
 */
const DAILY_STALE_AFTER_MS = 36 * HOUR_MS;

/** Presence re-pushes every PRESENCE_REFRESH_MS (default 5 min). */
const PRESENCE_STALE_AFTER_MS = 30 * 60 * 1000;

export const SNAPSHOT_SOURCE_SPECS: readonly SnapshotSourceSpec[] = Object.freeze([
	Object.freeze({
		id: 'github-activity',
		table: 'github_activity_snapshot',
		staleAfterMs: DAILY_STALE_AFTER_MS,
		smokeCritical: true,
		// Activity payloads stamp `observedAt` (RFC3339, optional) and
		// `generatedOn` (ISO date); prefer the instant.
		payloadObservedAt: (payload: unknown) =>
			stringField(payload, 'observedAt') ?? stringField(payload, 'generatedOn'),
	}),
	Object.freeze({
		id: 'github-stats',
		table: 'github_stats_snapshot',
		staleAfterMs: DAILY_STALE_AFTER_MS,
		smokeCritical: true,
		payloadObservedAt: (payload: unknown) => stringField(payload, 'observedAt'),
	}),
	Object.freeze({
		id: 'discord-presence',
		table: 'discord_presence_snapshot',
		staleAfterMs: PRESENCE_STALE_AFTER_MS,
		smokeCritical: false,
		// Presence freshness IS the receipt instant — the payload
		// describes a point observation with no upstream "observedAt".
		payloadObservedAt: () => null,
	}),
]);

export interface SnapshotRow {
	readonly source: string;
	readonly receivedAt: string | null;
	readonly payload: unknown;
}

export interface SnapshotSourceHealth {
	readonly source: string;
	readonly state: SnapshotHealthState;
	readonly receivedAt: string | null;
	readonly ageSeconds: number | null;
	readonly payloadObservedAt: string | null;
	readonly smokeCritical: boolean;
}

export interface SnapshotHealthReport {
	readonly observedAt: string;
	readonly sources: readonly SnapshotSourceHealth[];
}

function classify(
	receivedAt: string | null,
	staleAfterMs: number,
	nowMs: number,
): {
	state: SnapshotHealthState;
	ageSeconds: number | null;
} {
	if (receivedAt === null) return { state: 'absent', ageSeconds: null };
	const receivedMs = Date.parse(receivedAt);
	if (Number.isNaN(receivedMs)) return { state: 'absent', ageSeconds: null };
	const ageMs = Math.max(0, nowMs - receivedMs);
	return {
		state: ageMs > staleAfterMs ? 'stale' : 'fresh',
		ageSeconds: Math.floor(ageMs / 1000),
	};
}

/**
 * Build the report from one row per spec. A source with NO row reports
 * `absent`; a row whose `received_at` is unparseable also reports
 * `absent` rather than guessing (the ingest always writes an ISO
 * instant, so an unparseable value means the row is not what the
 * contract says it is).
 */
export function buildSnapshotHealth(
	rows: readonly SnapshotRow[],
	nowMs: number,
): SnapshotHealthReport {
	const bySource = new Map(rows.map((row) => [row.source, row]));
	const sources = SNAPSHOT_SOURCE_SPECS.map((spec) => {
		const row = bySource.get(spec.id);
		const { state, ageSeconds } = classify(row?.receivedAt ?? null, spec.staleAfterMs, nowMs);
		return Object.freeze({
			source: spec.id,
			state,
			receivedAt: row?.receivedAt ?? null,
			ageSeconds,
			payloadObservedAt: spec.payloadObservedAt(row?.payload ?? null),
			smokeCritical: spec.smokeCritical,
		});
	});
	return Object.freeze({
		observedAt: new Date(nowMs).toISOString(),
		sources: Object.freeze(sources),
	});
}
