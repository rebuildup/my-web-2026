/**
 * Discord Presence — test fixtures for the four canonical states.
 *
 * These fixtures are used by unit tests, Storybook stories, and the
 * verification gallery. They represent:
 *   - ok: valid snapshot with presence data
 *   - unconfigured: snapshot file missing or empty
 *   - stale: snapshot exists but exceeds maxAgeMs
 *   - failed: snapshot exists but fails validation (parse/schema/mismatch)
 */

import {
	type SnapshotSource,
	createTestSnapshotSource,
	loadDiscordPresenceCardFromSource,
	projectToCard,
} from './reader';
import type { DiscordPresenceCard, DiscordPresenceSnapshot } from './types';

export const TEST_USER_ID = '123456789012345678';
export const TEST_GENERATED_AT = new Date().toISOString(); // current time
export const TEST_ACTIVITY_START = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 minutes ago
export const TEST_ACTIVITY_START_2 = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 minutes ago
export const STALE_GENERATED_AT = '2020-01-01T00:00:00.000Z'; // far in the past, definitely stale
export const MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Valid snapshot with online status, custom status, and activities.
 */
export const fixtureOkSnapshot: DiscordPresenceSnapshot = {
	generatedAt: TEST_GENERATED_AT,
	userId: TEST_USER_ID,
	status: 'online',
	customStatusText: 'Building my-web-2026',
	customStatusEmoji: '🛠️',
	customStatusExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), // 6 hours from now
	activities: [
		{
			type: 0, // Playing
			name: 'Visual Studio Code',
			details: 'Editing src/home/presence/types.ts',
			state: 'Debugging TypeScript',
			timestamps: {
				start: TEST_ACTIVITY_START,
			},
			assets: {
				largeImage: 'vscode',
				largeText: 'Visual Studio Code',
				smallImage: 'debug',
				smallText: 'Debugging',
			},
			applicationId: '383226320970055681',
			isPrimary: true,
		},
		{
			type: 2, // Listening
			name: 'Spotify',
			details: 'Lofi Girl',
			state: 'chillhop essentials',
			timestamps: {
				start: TEST_ACTIVITY_START_2,
			},
			assets: {
				largeImage: 'spotify',
				largeText: 'Spotify',
				smallImage: 'play',
				smallText: 'Playing',
			},
			applicationId: '385250720397393920',
			isPrimary: false,
		},
	],
	client: 'desktop',
	isLive: true,
};

/**
 * Valid snapshot with idle status and no activities.
 */
export const fixtureIdleSnapshot: DiscordPresenceSnapshot = {
	generatedAt: TEST_GENERATED_AT,
	userId: TEST_USER_ID,
	status: 'idle',
	customStatusText: 'AFK',
	customStatusEmoji: '🌙',
	activities: [],
	client: 'mobile',
	isLive: true,
};

/**
 * Valid snapshot with dnd status and streaming activity.
 */
export const fixtureDndSnapshot: DiscordPresenceSnapshot = {
	generatedAt: TEST_GENERATED_AT,
	userId: TEST_USER_ID,
	status: 'dnd',
	customStatusText: 'Focus mode',
	activities: [
		{
			type: 1, // Streaming
			name: 'Twitch',
			details: 'Live coding session',
			state: 'Building a Discord presence widget',
			timestamps: {
				start: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
			},
			assets: {
				largeImage: 'twitch',
				largeText: 'Twitch Stream',
			},
			applicationId: '385250720397393920',
			url: 'https://twitch.tv/example',
			isPrimary: true,
		},
	],
	client: 'desktop',
	isLive: true,
};

/**
 * Valid snapshot with offline status.
 */
export const fixtureOfflineSnapshot: DiscordPresenceSnapshot = {
	generatedAt: TEST_GENERATED_AT,
	userId: TEST_USER_ID,
	status: 'offline',
	activities: [],
	client: 'desktop',
	isLive: false,
};

/**
 * Snapshot with unknown status (fallback).
 */
export const fixtureUnknownSnapshot: DiscordPresenceSnapshot = {
	generatedAt: TEST_GENERATED_AT,
	userId: TEST_USER_ID,
	status: 'unknown',
	activities: [],
	isLive: false,
};

/**
 * Stale snapshot (generatedAt older than maxAgeMs).
 */
export const fixtureStaleSnapshot: DiscordPresenceSnapshot = {
	...fixtureOkSnapshot,
	generatedAt: STALE_GENERATED_AT,
};

/**
 * Snapshot with mismatched userId.
 */
export const fixtureMismatchSnapshot: DiscordPresenceSnapshot = {
	...fixtureOkSnapshot,
	userId: '999999999999999999',
};

/**
 * Invalid JSON content for parse failure.
 */
export const fixtureInvalidJson = '{ not valid json }';

/**
 * Empty content for missing/empty failure.
 */
export const fixtureEmptyContent = '';

/**
 * Snapshot missing required fields (schema failure).
 */
export const fixtureSchemaFailureSnapshot = {
	generatedAt: TEST_GENERATED_AT,
	// missing userId
	status: 'online',
	activities: [],
};

/**
 * Expected card for fixtureOkSnapshot.
 */
export const fixtureOkCard: DiscordPresenceCard = projectToCard(fixtureOkSnapshot, MAX_AGE_MS);

/**
 * Expected card for fixtureIdleSnapshot.
 */
export const fixtureIdleCard: DiscordPresenceCard = projectToCard(fixtureIdleSnapshot, MAX_AGE_MS);

/**
 * Expected card for fixtureDndSnapshot.
 */
export const fixtureDndCard: DiscordPresenceCard = projectToCard(fixtureDndSnapshot, MAX_AGE_MS);

/**
 * Expected card for fixtureOfflineSnapshot.
 */
export const fixtureOfflineCard: DiscordPresenceCard = projectToCard(
	fixtureOfflineSnapshot,
	MAX_AGE_MS,
);

/**
 * Expected card for fixtureUnknownSnapshot.
 */
export const fixtureUnknownCard: DiscordPresenceCard = projectToCard(
	fixtureUnknownSnapshot,
	MAX_AGE_MS,
);

/**
 * Expected unavailable card (for missing/stale/failed).
 */
export const fixtureUnavailableCard: DiscordPresenceCard = {
	statusLabel: 'Unknown',
	statusTone: 'neutral',
	customStatus: null,
	primaryActivity: null,
	additionalActivities: [],
	freshness: {
		generatedAt: '', // placeholder, actual value set at call time
		isStale: true,
		isLive: false,
	},
	available: false,
};

/**
 * Helper to create an unavailable card with current timestamp.
 */
export function createUnavailableCard(): DiscordPresenceCard {
	return {
		statusLabel: 'Unknown',
		statusTone: 'neutral',
		customStatus: null,
		primaryActivity: null,
		additionalActivities: [],
		freshness: {
			generatedAt: new Date().toISOString(),
			isStale: true,
			isLive: false,
		},
		available: false,
	};
}

/**
 * Creates a test source for the ok fixture.
 */
export function createOkSource(): SnapshotSource {
	return createTestSnapshotSource(JSON.stringify(fixtureOkSnapshot));
}

/**
 * Creates a test source for the idle fixture.
 */
export function createIdleSource(): SnapshotSource {
	return createTestSnapshotSource(JSON.stringify(fixtureIdleSnapshot));
}

/**
 * Creates a test source for the dnd fixture.
 */
export function createDndSource(): SnapshotSource {
	return createTestSnapshotSource(JSON.stringify(fixtureDndSnapshot));
}

/**
 * Creates a test source for the offline fixture.
 */
export function createOfflineSource(): SnapshotSource {
	return createTestSnapshotSource(JSON.stringify(fixtureOfflineSnapshot));
}

/**
 * Creates a test source for the unknown fixture.
 */
export function createUnknownSource(): SnapshotSource {
	return createTestSnapshotSource(JSON.stringify(fixtureUnknownSnapshot));
}

/**
 * Creates a test source for the stale fixture.
 */
export function createStaleSource(): SnapshotSource {
	return createTestSnapshotSource(JSON.stringify(fixtureStaleSnapshot));
}

/**
 * Creates a test source for the mismatch fixture.
 */
export function createMismatchSource(): SnapshotSource {
	return createTestSnapshotSource(JSON.stringify(fixtureMismatchSnapshot));
}

/**
 * Creates a test source for parse failure.
 */
export function createParseFailureSource(): SnapshotSource {
	return createTestSnapshotSource(fixtureInvalidJson);
}

/**
 * Creates a test source for missing/empty failure.
 */
export function createMissingSource(): SnapshotSource {
	return createTestSnapshotSource(fixtureEmptyContent);
}

/**
 * Creates a test source for schema failure.
 */
export function createSchemaFailureSource(): SnapshotSource {
	return createTestSnapshotSource(JSON.stringify(fixtureSchemaFailureSnapshot));
}

/**
 * Loads a card from a test source with standard config.
 */
export async function loadCardFromSource(source: SnapshotSource): Promise<DiscordPresenceCard> {
	return loadDiscordPresenceCardFromSource(source, {
		expectedUserId: TEST_USER_ID,
		maxAgeMs: MAX_AGE_MS,
	});
}
