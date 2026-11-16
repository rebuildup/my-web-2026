import type { PresenceSnapshotValue } from './schema';

/**
 * Discord presence — D1 store (Issue #320).
 *
 * Single-row upsert into `discord_presence_snapshot` (migration
 * 0011). The stored `payload` is the already-validated wire document
 * serialised verbatim; `received_at` is the server receipt instant.
 * The table name is written literally — the D1 binding gate
 * (`scripts/check-d1-sql-binding.mjs`) refuses interpolated SQL.
 */

export async function upsertDiscordPresence(
	db: D1Database,
	snapshot: PresenceSnapshotValue,
	receivedAt: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO discord_presence_snapshot (id, payload, received_at)
			 VALUES (1, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   payload = excluded.payload,
			   received_at = excluded.received_at`,
		)
		.bind(JSON.stringify(snapshot), receivedAt)
		.run();
}
