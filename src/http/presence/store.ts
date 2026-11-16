import type { PresenceSnapshotValue } from './schema';

/**
 * Discord presence — D1 store (Issue #320).
 *
 * Single-row upsert into `discord_presence_snapshot` (migration
 * 0011). The stored `payload` is the already-validated wire document
 * serialised verbatim; `received_at` is the server receipt instant.
 */

const TABLE = 'discord_presence_snapshot';

export async function upsertDiscordPresence(
	db: D1Database,
	snapshot: PresenceSnapshotValue,
	receivedAt: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO ${TABLE} (id, payload, received_at)
			 VALUES (1, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   payload = excluded.payload,
			   received_at = excluded.received_at`,
		)
		.bind(JSON.stringify(snapshot), receivedAt)
		.run();
}
