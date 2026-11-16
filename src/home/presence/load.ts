/**
 * Discord Presence — home route loader.
 *
 * Loads the Discord presence card from the committed snapshot.
 * The snapshot JSON is imported INSIDE the function so it never
 * enters the client bundle (same rule as `activity/load.ts`).
 * Degrades cleanly when no snapshot exists or it fails validation.
 *
 * Issue #320 note: `discord-presence.json` is currently a PLACEHOLDER
 * (generatedAt is the epoch, so the reader's staleness check always
 * fails closed and the card renders its unavailable state). A real
 * snapshot requires an operator-run acquisition mechanism and the
 * owner's Discord user ID — an owner decision tracked outside this
 * ticket. `EXPECTED_USER_ID` must be updated to the real snowflake
 * at the same time, or every genuine snapshot will mismatch and
 * degrade to unavailable.
 */

import type { DiscordPresenceCard } from './reader';
import { loadDiscordPresenceCardFromSource } from './reader';

const EXPECTED_USER_ID = '123456789012345678'; // PLACEHOLDER — owner decision pending
const MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Loads the Discord presence card for the home page.
 * Returns a DiscordPresenceCard (available=true or false).
 * Never throws — failures are encoded in the card's available=false.
 */
export async function getDiscordPresence(): Promise<DiscordPresenceCard> {
	const { default: json } = await import('./discord-presence.json', {
		with: { type: 'json' },
	});
	const source = { read: async () => JSON.stringify(json) };
	return loadDiscordPresenceCardFromSource(source, {
		expectedUserId: EXPECTED_USER_ID,
		maxAgeMs: MAX_AGE_MS,
	});
}
