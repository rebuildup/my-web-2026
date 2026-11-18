import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSnapshot } from './sync-discord-presence.mjs';

const USER_ID = '123456789012345678';
const NOW = new Date('2026-11-16T12:00:00.000Z');

function fakePresence(overrides = {}) {
	return {
		status: 'online',
		userId: USER_ID,
		clientStatus: { desktop: 'online' },
		activities: [],
		...overrides,
	};
}

describe('buildSnapshot', () => {
	it('maps a plain online presence', () => {
		const snap = buildSnapshot(fakePresence(), { userId: USER_ID, now: NOW });
		assert.equal(snap.status, 'online');
		assert.equal(snap.userId, USER_ID);
		assert.equal(snap.generatedAt, NOW.toISOString());
		assert.equal(snap.isLive, true);
		assert.equal(snap.client, 'desktop');
		assert.deepEqual(snap.activities, []);
		assert.equal(snap.customStatusText, undefined);
	});

	it('maps invisible to offline and unknown statuses through', () => {
		assert.equal(
			buildSnapshot(fakePresence({ status: 'invisible' }), { userId: USER_ID, now: NOW }).status,
			'offline',
		);
		assert.equal(
			buildSnapshot(fakePresence({ status: 'dnd' }), { userId: USER_ID, now: NOW }).status,
			'dnd',
		);
		assert.equal(
			buildSnapshot(fakePresence({ status: 'weird' }), { userId: USER_ID, now: NOW }).status,
			'unknown',
		);
	});

	it('extracts custom status (type 4) out of activities', () => {
		const snap = buildSnapshot(
			fakePresence({
				activities: [
					{
						type: 4,
						name: 'Custom Status',
						state: 'Building my-web-2026',
						emoji: { name: '🛠️' },
					},
				],
			}),
			{ userId: USER_ID, now: NOW },
		);
		assert.equal(snap.customStatusText, 'Building my-web-2026');
		assert.equal(snap.customStatusEmoji, '🛠️');
		// The custom-status pseudo-activity must not leak into activities[].
		assert.deepEqual(snap.activities, []);
	});

	it('formats custom emoji ids as discord emoji markup', () => {
		const snap = buildSnapshot(
			fakePresence({
				activities: [
					{
						type: 4,
						name: 'Custom Status',
						state: 'hi',
						emoji: { id: '999', name: 'party', animated: true },
					},
				],
			}),
			{ userId: USER_ID, now: NOW },
		);
		assert.equal(snap.customStatusEmoji, '<a:party:999>');
	});

	it('maps activities with allowlisted fields only and marks the first primary', () => {
		const snap = buildSnapshot(
			fakePresence({
				activities: [
					{
						type: 0,
						name: 'Visual Studio Code',
						details: 'Editing src/home/presence/load.ts',
						state: 'Debugging',
						timestamps: { start: 1763289600 },
						assets: { large_image: 'vscode', large_text: 'VS Code', small_image: 'x' },
						applicationId: '383226320970055681',
						url: 'https://example.com/stream',
						party: { id: 'p1', size: [3, 10] },
						flags: 2,
						// Fields that must NOT survive the mapping:
						secret: 'leak-me',
						message: { content: 'private' },
					},
					{ type: 2, name: 'Spotify', details: 'Song' },
				],
			}),
			{ userId: USER_ID, now: NOW },
		);
		assert.equal(snap.activities.length, 2);
		const [first, second] = snap.activities;
		assert.equal(first.isPrimary, true);
		assert.equal(first.name, 'Visual Studio Code');
		assert.equal(first.assets.largeImage, 'vscode');
		assert.equal(first.assets.smallText, undefined);
		assert.equal(first.timestamps.start, '2025-11-16T10:40:00.000Z');
		assert.deepEqual(first.party, { id: 'p1', size: [3, 10] });
		assert.equal(second.isPrimary, undefined);
		const serialized = JSON.stringify(snap);
		assert.equal(serialized.includes('leak-me'), false);
		assert.equal(serialized.includes('private'), false);
	});

	it('produces the offline document for a null presence', () => {
		const snap = buildSnapshot(null, { userId: USER_ID, now: NOW, isLive: false });
		assert.equal(snap.status, 'unknown');
		assert.equal(snap.isLive, false);
		assert.deepEqual(snap.activities, []);
	});
});
