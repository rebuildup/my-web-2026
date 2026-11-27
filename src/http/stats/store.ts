import type { GitHubStatsSnapshotValue } from './schema';

/**
 * GitHub stats — D1 store (Issues #1244 / #1245).
 *
 * Single-row upsert into `github_stats_snapshot` (migration 0013),
 * mirroring `src/http/activity/store.ts`. The stored `payload` is
 * the already-validated wire document serialised verbatim;
 * `received_at` is the server receipt instant. The table name is
 * written literally — the D1 binding gate
 * (`scripts/check-d1-sql-binding.mjs`) refuses interpolated SQL.
 */

export async function upsertGitHubStatsSnapshot(
	db: D1Database,
	snapshot: GitHubStatsSnapshotValue,
	receivedAt: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO github_stats_snapshot (id, payload, received_at)
			 VALUES (1, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   payload = excluded.payload,
			   received_at = excluded.received_at`,
		)
		.bind(JSON.stringify(snapshot), receivedAt)
		.run();
}
