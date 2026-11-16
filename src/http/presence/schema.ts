import { z } from 'zod';

/**
 * Discord presence ingest — wire schema (Issue #320).
 *
 * This is the HTTP boundary's contract for
 * `PUT /api/v1/presence/discord`: the exact JSON document the
 * operator-side Gateway script (`scripts/sync-discord-presence.mjs`)
 * pushes and the only shape that may be stored in D1.
 *
 * The schema is deliberately STRICT and allowlisted: `.strict()`
 * rejects unknown keys, every field is bounded, and the parsed
 * result is rebuilt field-by-field so nothing the sender included
 * outside the contract can reach `discord_presence_snapshot.payload`.
 * The public read path (`src/home/presence/reader.ts`) re-validates
 * the stored document independently — this schema guards the WRITE,
 * the reader guards the READ.
 */

const SNOWFLAKE = /^\d{5,25}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const PresenceActivity = z
	.object({
		type: z.number().int().min(0).max(5),
		name: z.string().min(1).max(128),
		details: z.string().max(512).optional(),
		state: z.string().max(512).optional(),
		timestamps: z
			.object({
				start: z.string().max(64).optional(),
				end: z.string().max(64).optional(),
			})
			.strict()
			.optional(),
		assets: z
			.object({
				largeImage: z.string().max(256).optional(),
				largeText: z.string().max(256).optional(),
				smallImage: z.string().max(256).optional(),
				smallText: z.string().max(256).optional(),
			})
			.strict()
			.optional(),
		applicationId: z.string().max(32).optional(),
		isPrimary: z.boolean().optional(),
		url: z.string().url().max(512).optional(),
		sessionId: z.string().max(128).optional(),
		party: z
			.object({
				id: z.string().max(128).optional(),
				size: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
			})
			.strict()
			.optional(),
		flags: z.number().int().min(0).optional(),
	})
	.strict();

export const PresenceSnapshotBody = z
	.object({
		generatedAt: z.string().regex(ISO_INSTANT),
		userId: z.string().regex(SNOWFLAKE),
		status: z.enum(['online', 'idle', 'dnd', 'offline', 'unknown']),
		customStatusText: z.string().max(128).optional(),
		customStatusEmoji: z.string().max(128).optional(),
		customStatusExpiresAt: z.string().max(64).optional(),
		activities: z.array(PresenceActivity).max(8),
		client: z.string().max(32).optional(),
		isLive: z.boolean(),
	})
	.strict();

/** Parsed and validated `PUT /api/v1/presence/discord` body. */
export type PresenceSnapshotValue = z.infer<typeof PresenceSnapshotBody>;
