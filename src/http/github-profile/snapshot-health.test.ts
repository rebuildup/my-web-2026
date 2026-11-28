import { describe, expect, it } from 'vitest';
import { SNAPSHOT_SOURCE_SPECS, type SnapshotRow, buildSnapshotHealth } from './snapshot-health';

const NOW = Date.parse('2026-11-27T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function row(source: string, receivedAt: string | null, payload: unknown = null): SnapshotRow {
	return { source, receivedAt, payload };
}

describe('buildSnapshotHealth', () => {
	it('classifies a recent receipt as fresh', () => {
		const report = buildSnapshotHealth(
			[
				row('github-activity', iso(60_000)),
				row('github-stats', iso(3_600_000)),
				row('discord-presence', iso(60_000)),
			],
			NOW,
		);
		expect(report.observedAt).toBe(new Date(NOW).toISOString());
		expect(report.sources.map((s) => s.state)).toEqual(['fresh', 'fresh', 'fresh']);
		expect(report.sources[0]?.ageSeconds).toBe(60);
	});

	it('distinguishes stale (old row) from absent (no row)', () => {
		const report = buildSnapshotHealth(
			[
				// 48h old daily source → stale (LKG still served).
				row('github-activity', iso(48 * 3_600_000)),
				// No stats row at all → absent (no LKG exists).
				// Presence inside its 30-minute budget → fresh.
				row('discord-presence', iso(10 * 60_000)),
			],
			NOW,
		);
		const byId = new Map(report.sources.map((s) => [s.source, s]));
		expect(byId.get('github-activity')?.state).toBe('stale');
		expect(byId.get('github-stats')?.state).toBe('absent');
		expect(byId.get('github-stats')?.receivedAt).toBeNull();
		expect(byId.get('discord-presence')?.state).toBe('fresh');
	});

	it('treats an unparseable received_at as absent, never fresh', () => {
		const report = buildSnapshotHealth(
			[row('github-stats', 'not-a-date'), row('github-activity', null)],
			NOW,
		);
		const byId = new Map(report.sources.map((s) => [s.source, s]));
		expect(byId.get('github-stats')?.state).toBe('absent');
		expect(byId.get('github-activity')?.state).toBe('absent');
	});

	it('reports payloadObservedAt best-effort per source', () => {
		const report = buildSnapshotHealth(
			[
				row('github-activity', iso(60_000), { generatedOn: '2026-11-26' }),
				row('github-stats', iso(60_000), { observedAt: '2026-11-27T10:00:00Z' }),
				row('discord-presence', iso(60_000), {}),
			],
			NOW,
		);
		const byId = new Map(report.sources.map((s) => [s.source, s]));
		expect(byId.get('github-activity')?.payloadObservedAt).toBe('2026-11-26');
		expect(byId.get('github-stats')?.payloadObservedAt).toBe('2026-11-27T10:00:00Z');
		expect(byId.get('discord-presence')?.payloadObservedAt).toBeNull();
	});

	it('marks only the daily sync sources smoke-critical', () => {
		const critical = SNAPSHOT_SOURCE_SPECS.filter((s) => s.smokeCritical).map((s) => s.id);
		expect(critical).toEqual(['github-activity', 'github-stats']);
	});
});
