/**
 * Discord Presence — home route loader.
 *
 * Reads the latest owner-presence snapshot from D1
 * (`discord_presence_snapshot`, migration 0011). The snapshot is
 * written by `PUT /api/v1/presence/discord`, which is fed by the
 * operator-side Gateway script `scripts/sync-discord-presence.mjs`
 * (Issue #320). A Cloudflare Worker cannot hold a Gateway
 * WebSocket, so the Worker never talks to Discord — it only reads
 * the last accepted document and lets the reader's freshness check
 * (`generatedAt` vs `MAX_AGE_MS`) degrade a stopped feed to the
 * unavailable state instead of showing a stale "online".
 *
 * `env.DISCORD_PRESENCE_USER_ID` (runtime secret binding, Infisical
 * managed like the GA measurement ID) pins the expected owner
 * snowflake; while it is unset the card stays unavailable — fail
 * closed, never guess.
 */

import { createServerFn } from '@tanstack/react-start';
import type { DiscordPresenceCard } from './reader';
import { loadDiscordPresenceCardFromSource } from './reader';

const MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

interface PresenceEnv {
	DB?: D1Database;
	DISCORD_PRESENCE_USER_ID?: string;
}

function unavailableCard(): Promise<DiscordPresenceCard> {
	// An unreadable source projects to the same unavailable card the
	// reader returns for every failure mode — one code path, no
	// invented state.
	return loadDiscordPresenceCardFromSource(
		{ read: async () => null },
		{ expectedUserId: 'unconfigured', maxAgeMs: MAX_AGE_MS },
	);
}

/**
 * Loads the Discord presence card for the home page.
 * Returns a DiscordPresenceCard (available=true or false).
 * Never throws — failures are encoded in the card's available=false.
 *
 * `createServerFn` is load-bearing, not decoration (Issue #951
 * audit): a plain exported async function is reachable from the
 * client bundle through the `home/public.ts` barrel, which shipped
 * the reader + snapshot JSON to every route. The server-fn wrapper
 * keeps the whole read path server-side.
 */
export const getDiscordPresence = createServerFn({ method: 'GET' }).handler(
	async (): Promise<DiscordPresenceCard> => {
		try {
			const { env } = await import('cloudflare:workers');
			const envLike = env as unknown as PresenceEnv;
			const expectedUserId = envLike.DISCORD_PRESENCE_USER_ID;
			if (!envLike.DB || !expectedUserId) {
				return unavailableCard();
			}
			const row = await envLike.DB.prepare(
				'SELECT payload FROM discord_presence_snapshot WHERE id = 1',
			).first<{ payload: string }>();
			if (!row?.payload) {
				return unavailableCard();
			}
			const payload = row.payload;
			return loadDiscordPresenceCardFromSource(
				{ read: async () => payload },
				{ expectedUserId, maxAgeMs: MAX_AGE_MS },
			);
		} catch {
			return unavailableCard();
		}
	},
);
