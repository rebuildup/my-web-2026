/**
 * Discord Presence — reader tests.
 *
 * Tests the fail-closed snapshot reader and projection logic.
 */

import { describe, expect, it } from 'vitest';
import {
	MAX_AGE_MS,
	TEST_USER_ID,
	createDndSource,
	createIdleSource,
	createMismatchSource,
	createMissingSource,
	createOfflineSource,
	createOkSource,
	createParseFailureSource,
	createSchemaFailureSource,
	createStaleSource,
	createUnavailableCard,
	createUnknownSource,
	fixtureDndCard,
	fixtureDndSnapshot,
	fixtureEmptyContent,
	fixtureIdleCard,
	fixtureIdleSnapshot,
	fixtureInvalidJson,
	fixtureMismatchSnapshot,
	fixtureOfflineCard,
	fixtureOfflineSnapshot,
	fixtureOkCard,
	fixtureOkSnapshot,
	fixtureSchemaFailureSnapshot,
	fixtureStaleSnapshot,
	fixtureUnknownCard,
	fixtureUnknownSnapshot,
	loadCardFromSource,
} from './fixtures';
import {
	type SnapshotSource,
	createFetchSnapshotSource,
	createTestSnapshotSource,
	loadDiscordPresenceCardFromSource,
	projectToCard,
	readDiscordPresenceSnapshotFromSource,
} from './reader';

describe('projectToCard', () => {
	it('projects online snapshot with custom status and activities', () => {
		const card = projectToCard(fixtureOkSnapshot, MAX_AGE_MS);
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBe('Online');
		expect(card.statusTone).toBe('accent');
		expect(card.customStatus).not.toBeNull();
		expect(card.customStatus?.text).toBe('Building my-web-2026');
		expect(card.customStatus?.emoji).toBe('🛠️');
		expect(card.primaryActivity).not.toBeNull();
		expect(card.primaryActivity?.name).toBe('Visual Studio Code');
		expect(card.primaryActivity?.typeLabel).toBe('Playing');
		expect(card.additionalActivities).toHaveLength(1);
		expect(card.additionalActivities[0].name).toBe('Spotify');
		expect(card.freshness.isStale).toBe(false);
		expect(card.freshness.isLive).toBe(true);
	});

	it('projects idle snapshot with no activities', () => {
		const card = projectToCard(fixtureIdleSnapshot, MAX_AGE_MS);
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBe('Idle');
		expect(card.statusTone).toBe('accent');
		expect(card.customStatus?.text).toBe('AFK');
		expect(card.customStatus?.emoji).toBe('🌙');
		expect(card.primaryActivity).toBeNull();
		expect(card.additionalActivities).toHaveLength(0);
		expect(card.freshness.isStale).toBe(false);
		expect(card.freshness.isLive).toBe(true);
	});

	it('projects dnd snapshot with streaming activity', () => {
		const card = projectToCard(fixtureDndSnapshot, MAX_AGE_MS);
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBe('Do Not Disturb');
		expect(card.statusTone).toBe('accent');
		expect(card.customStatus?.text).toBe('Focus mode');
		expect(card.primaryActivity).not.toBeNull();
		expect(card.primaryActivity?.name).toBe('Twitch');
		expect(card.primaryActivity?.typeLabel).toBe('Streaming');
		expect(card.primaryActivity?.url).toBe('https://twitch.tv/example');
		expect(card.freshness.isStale).toBe(false);
		expect(card.freshness.isLive).toBe(true);
	});

	it('projects offline snapshot', () => {
		const card = projectToCard(fixtureOfflineSnapshot, MAX_AGE_MS);
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBe('Offline');
		expect(card.statusTone).toBe('neutral');
		expect(card.customStatus).toBeNull();
		expect(card.primaryActivity).toBeNull();
		expect(card.freshness.isStale).toBe(false);
		expect(card.freshness.isLive).toBe(false);
	});

	it('projects unknown status snapshot', () => {
		const card = projectToCard(fixtureUnknownSnapshot, MAX_AGE_MS);
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBe('Unknown');
		expect(card.statusTone).toBe('neutral');
		expect(card.freshness.isStale).toBe(false);
		expect(card.freshness.isLive).toBe(false);
	});

	it('marks stale snapshot as stale', () => {
		const card = projectToCard(fixtureStaleSnapshot, MAX_AGE_MS);
		expect(card.available).toBe(true);
		expect(card.freshness.isStale).toBe(true);
	});

	it('selects primary activity by isPrimary flag', () => {
		const snapshot = {
			...fixtureOkSnapshot,
			activities: [
				{ ...fixtureOkSnapshot.activities[0], isPrimary: false },
				{ ...fixtureOkSnapshot.activities[1], isPrimary: true },
			],
		};
		const card = projectToCard(snapshot, MAX_AGE_MS);
		expect(card.primaryActivity?.name).toBe('Spotify');
	});

	it('falls back to first non-custom activity when no isPrimary', () => {
		const snapshot = {
			...fixtureOkSnapshot,
			activities: [
				{ ...fixtureOkSnapshot.activities[0], isPrimary: false, type: 4 }, // custom status
				{ ...fixtureOkSnapshot.activities[1], isPrimary: false, type: 2 }, // listening
			],
		};
		const card = projectToCard(snapshot, MAX_AGE_MS);
		expect(card.primaryActivity?.name).toBe('Spotify');
	});

	it('falls back to first activity when all are custom', () => {
		const snapshot = {
			...fixtureOkSnapshot,
			activities: [
				{ ...fixtureOkSnapshot.activities[0], isPrimary: false, type: 4, name: 'Custom 1' },
				{ ...fixtureOkSnapshot.activities[1], isPrimary: false, type: 4, name: 'Custom 2' },
			],
		};
		const card = projectToCard(snapshot, MAX_AGE_MS);
		expect(card.primaryActivity?.name).toBe('Custom 1');
	});
});

describe('readDiscordPresenceSnapshotFromSource', () => {
	it('returns ok for valid snapshot', async () => {
		const source = createOkSource();
		const result = await readDiscordPresenceSnapshotFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.snapshot.userId).toBe(TEST_USER_ID);
			expect(result.snapshot.status).toBe('online');
		}
	});

	it('returns missing for null source', async () => {
		const source = createTestSnapshotSource(null);
		const result = await readDiscordPresenceSnapshotFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('missing');
		}
	});

	it('returns missing for empty content', async () => {
		const source = createMissingSource();
		const result = await readDiscordPresenceSnapshotFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('missing');
		}
	});

	it('returns parse for invalid JSON', async () => {
		const source = createParseFailureSource();
		const result = await readDiscordPresenceSnapshotFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('parse');
		}
	});

	it('returns schema for missing required fields', async () => {
		const source = createSchemaFailureSource();
		const result = await readDiscordPresenceSnapshotFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('schema');
		}
	});

	it('returns mismatch for different userId', async () => {
		const source = createMismatchSource();
		const result = await readDiscordPresenceSnapshotFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('mismatch');
		}
	});

	it('returns stale for old snapshot', async () => {
		const source = createStaleSource();
		const result = await readDiscordPresenceSnapshotFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('stale');
		}
	});

	it('fails when expectedUserId is not configured', async () => {
		const source = createOkSource();
		const result = await readDiscordPresenceSnapshotFromSource(source, {
			expectedUserId: '',
			maxAgeMs: MAX_AGE_MS,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('schema');
		}
	});
});

describe('loadDiscordPresenceCardFromSource', () => {
	it('returns available card for valid snapshot', async () => {
		const source = createOkSource();
		const card = await loadDiscordPresenceCardFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBe('Online');
	});

	it('returns unavailable card for missing snapshot', async () => {
		const source = createMissingSource();
		const card = await loadDiscordPresenceCardFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(card.available).toBe(false);
		expect(card.statusLabel).toBe('Unknown');
		expect(card.statusTone).toBe('neutral');
	});

	it('returns unavailable card for stale snapshot', async () => {
		const source = createStaleSource();
		const card = await loadDiscordPresenceCardFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(card.available).toBe(false);
	});

	it('returns unavailable card for parse failure', async () => {
		const source = createParseFailureSource();
		const card = await loadDiscordPresenceCardFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(card.available).toBe(false);
	});

	it('returns unavailable card for schema failure', async () => {
		const source = createSchemaFailureSource();
		const card = await loadDiscordPresenceCardFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(card.available).toBe(false);
	});

	it('returns unavailable card for mismatch', async () => {
		const source = createMismatchSource();
		const card = await loadDiscordPresenceCardFromSource(source, {
			expectedUserId: TEST_USER_ID,
			maxAgeMs: MAX_AGE_MS,
		});
		expect(card.available).toBe(false);
	});
});

describe('fixtures loadCardFromSource', () => {
	it('loads ok card from ok source', async () => {
		const card = await loadCardFromSource(createOkSource());
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBe('Online');
	});

	it('loads idle card from idle source', async () => {
		const card = await loadCardFromSource(createIdleSource());
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBe('Idle');
	});

	it('loads dnd card from dnd source', async () => {
		const card = await loadCardFromSource(createDndSource());
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBe('Do Not Disturb');
	});

	it('loads offline card from offline source', async () => {
		const card = await loadCardFromSource(createOfflineSource());
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBe('Offline');
	});

	it('loads unknown card from unknown source', async () => {
		const card = await loadCardFromSource(createUnknownSource());
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBe('Unknown');
	});

	it('loads unavailable card from stale source', async () => {
		const card = await loadCardFromSource(createStaleSource());
		expect(card.available).toBe(false);
	});

	it('loads unavailable card from mismatch source', async () => {
		const card = await loadCardFromSource(createMismatchSource());
		expect(card.available).toBe(false);
	});

	it('loads unavailable card from parse failure source', async () => {
		const card = await loadCardFromSource(createParseFailureSource());
		expect(card.available).toBe(false);
	});

	it('loads unavailable card from missing source', async () => {
		const card = await loadCardFromSource(createMissingSource());
		expect(card.available).toBe(false);
	});

	it('loads unavailable card from schema failure source', async () => {
		const card = await loadCardFromSource(createSchemaFailureSource());
		expect(card.available).toBe(false);
	});
});

describe('createFetchSnapshotSource', () => {
	it('returns a source with read method', () => {
		const source = createFetchSnapshotSource('https://example.com/snapshot.json');
		expect(typeof source.read).toBe('function');
	});
});
