import type { GitHubActivitySnapshotValue } from './schema';

/**
 * GitHub activity — D1 store (Issues #316 / #319 / #932).
 *
 * Single-row upsert into `github_activity_snapshot` (migration
 * 0012). The stored `payload` is the already-validated wire document
 * serialised verbatim; `received_at` is the server receipt instant.
 * The table name is written literally — the D1 binding gate
 * (`scripts/check-d1-sql-binding.mjs`) refuses interpolated SQL.
 */

export async function upsertGitHubActivitySnapshot(
	db: D1Database,
	snapshot: GitHubActivitySnapshotValue,
	receivedAt: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO github_activity_snapshot (id, payload, received_at)
			 VALUES (1, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   payload = excluded.payload,
			   received_at = excluded.received_at`,
		)
		.bind(JSON.stringify(snapshot), receivedAt)
		.run();
}
