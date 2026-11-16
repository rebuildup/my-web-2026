/**
 * Discord Presence — home route loader.
 *
 * Loads the Discord presence card from the committed snapshot.
 * The snapshot is read from the Worker's self-origin (ASSETS binding).
 * Degrades cleanly when no snapshot exists.
 */

import {
	type DiscordPresenceCard,
	createFetchSnapshotSource,
	loadDiscordPresenceCardFromSource,
} from './reader';

const SNAPSHOT_URL = '/src/home/presence/discord-presence.json';
const EXPECTED_USER_ID = '123456789012345678'; // Owner's Discord user ID (snowflake)
const MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Loads the Discord presence card for the home page.
 * Returns a DiscordPresenceCard (available=true or false).
 * Never throws — failures are encoded in the card's available=false.
 */
export async function getDiscordPresence(): Promise<DiscordPresenceCard> {
	const source = createFetchSnapshotSource(SNAPSHOT_URL);
	return loadDiscordPresenceCardFromSource(source, {
		expectedUserId: EXPECTED_USER_ID,
		maxAgeMs: MAX_AGE_MS,
	});
}
