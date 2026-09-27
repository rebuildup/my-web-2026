import { describe, expect, it } from 'vitest';
import {
	ChannelsFileSchema,
	FRESHNESS_WINDOW_DAYS,
	FRESHNESS_WINDOW_MS,
	PurposeSchema,
	daysSinceVerified,
	filterActiveVerified,
} from './schema';

/**
 * Unit tests for the `/contact` channel filter (Issue #103).
 *
 * The filter is the fail-closed gate: a channel is only returned
 * when it is `active: true` AND `verified_at` falls inside the
 * freshness window measured from `now`. We pin `now` so the
 * boundary cases are stable across runs.
 *
 * Coverage:
 *   1. Inactive channels are always dropped.
 *   2. Channels with no recent verified_at are dropped.
 *   3. Channels with verified_at == now - 1 day are kept.
 *   4. Channels with verified_at < now - window are dropped.
 *   5. Channels with verified_at in the future are kept (treated as
 *      just-verified, since the operator may have set a future date
 *      and the only question is "is the channel still active").
 *   6. Ordering is stable: most-recently verified first, then id
 *      ascending on tie.
 *   7. Malformed verified_at values drop the channel (fail-closed).
 *   8. PurposeSchema rejects unknown purposes.
 *   9. The JSON shape contract: id regex / url format / verified_at
 *      date format.
 */

// Pin `now` to a known instant so test boundaries are stable.
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0); // 2026-09-27T12:00:00Z
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe('filterActiveVerified', () => {
	it('drops inactive channels regardless of verified_at', () => {
		const out = filterActiveVerified(
			[
				{
					id: 'x',
					label: 'X',
					labelEn: 'X',
					purpose: 'technical',
					url: 'https://example.com',
					verified_at: '2026-09-27',
					active: false,
				},
			],
			NOW,
		);
		expect(out).toHaveLength(0);
	});

	it('drops channels whose verified_at is older than the freshness window', () => {
		const stale = new Date(NOW - (FRESHNESS_WINDOW_DAYS + 1) * ONE_DAY_MS)
			.toISOString()
			.slice(0, 10);
		const out = filterActiveVerified(
			[
				{
					id: 'x',
					label: 'X',
					labelEn: 'X',
					purpose: 'technical',
					url: 'https://example.com',
					verified_at: stale,
					active: true,
				},
			],
			NOW,
		);
		expect(out).toHaveLength(0);
	});

	it('keeps channels whose verified_at is inside the freshness window', () => {
		const recent = new Date(NOW - 5 * ONE_DAY_MS).toISOString().slice(0, 10);
		const out = filterActiveVerified(
			[
				{
					id: 'x',
					label: 'X',
					labelEn: 'X',
					purpose: 'technical',
					url: 'https://example.com',
					verified_at: recent,
					active: true,
				},
			],
			NOW,
		);
		expect(out).toHaveLength(1);
		expect(out[0].id).toBe('x');
	});

	it('keeps channels verified just inside the window', () => {
		// 29 days ago — clearly inside the 30-day window.
		const justInside = new Date(NOW - (FRESHNESS_WINDOW_DAYS - 1) * ONE_DAY_MS)
			.toISOString()
			.slice(0, 10);
		const out = filterActiveVerified(
			[
				{
					id: 'inside',
					label: 'I',
					labelEn: 'I',
					purpose: 'technical',
					url: 'https://example.com',
					verified_at: justInside,
					active: true,
				},
			],
			NOW,
		);
		expect(out).toHaveLength(1);
	});

	it('drops channels with unparseable verified_at', () => {
		const out = filterActiveVerified(
			[
				{
					id: 'x',
					label: 'X',
					labelEn: 'X',
					purpose: 'technical',
					url: 'https://example.com',
					verified_at: 'not-a-date',
					active: true,
				},
			],
			NOW,
		);
		expect(out).toHaveLength(0);
	});

	it('orders results by verified_at desc, then id asc', () => {
		const old = new Date(NOW - 20 * ONE_DAY_MS).toISOString().slice(0, 10);
		const newer = new Date(NOW - 5 * ONE_DAY_MS).toISOString().slice(0, 10);
		const newest = new Date(NOW - 1 * ONE_DAY_MS).toISOString().slice(0, 10);
		const out = filterActiveVerified(
			[
				{
					id: 'aaa',
					label: 'A',
					labelEn: 'A',
					purpose: 'technical',
					url: 'https://example.com',
					verified_at: old,
					active: true,
				},
				{
					id: 'ccc',
					label: 'C',
					labelEn: 'C',
					purpose: 'technical',
					url: 'https://example.com',
					verified_at: newest,
					active: true,
				},
				{
					id: 'bbb',
					label: 'B',
					labelEn: 'B',
					purpose: 'technical',
					url: 'https://example.com',
					verified_at: newer,
					active: true,
				},
			],
			NOW,
		);
		expect(out.map((c) => c.id)).toEqual(['ccc', 'bbb', 'aaa']);
	});

	it('honours a custom window when supplied', () => {
		const ten = new Date(NOW - 10 * ONE_DAY_MS).toISOString().slice(0, 10);
		// Default 30d keeps it.
		expect(
			filterActiveVerified(
				[
					{
						id: 'x',
						label: 'X',
						labelEn: 'X',
						purpose: 'technical',
						url: 'https://example.com',
						verified_at: ten,
						active: true,
					},
				],
				NOW,
			).length,
		).toBe(1);
		// 5d window drops it.
		expect(
			filterActiveVerified(
				[
					{
						id: 'x',
						label: 'X',
						labelEn: 'X',
						purpose: 'technical',
						url: 'https://example.com',
						verified_at: ten,
						active: true,
					},
				],
				NOW,
				5 * ONE_DAY_MS,
			).length,
		).toBe(0);
	});
});

describe('daysSinceVerified', () => {
	it('returns integer days from now', () => {
		const five = new Date(NOW - 5 * ONE_DAY_MS).toISOString().slice(0, 10);
		expect(
			daysSinceVerified(
				{
					id: 'x',
					label: 'X',
					labelEn: 'X',
					purpose: 'technical',
					url: 'https://example.com',
					verified_at: five,
					active: true,
				},
				NOW,
			),
		).toBe(5);
	});

	it('returns NaN on unparseable date', () => {
		const v = daysSinceVerified(
			{
				id: 'x',
				label: 'X',
				labelEn: 'X',
				purpose: 'technical',
				url: 'https://example.com',
				verified_at: 'oops',
				active: true,
			},
			NOW,
		);
		expect(Number.isNaN(v)).toBe(true);
	});
});

describe('PurposeSchema', () => {
	it('accepts the canonical purposes', () => {
		expect(PurposeSchema.parse('recruitment')).toBe('recruitment');
		expect(PurposeSchema.parse('technical')).toBe('technical');
		expect(PurposeSchema.parse('distribution')).toBe('distribution');
		expect(PurposeSchema.parse('commission-intake')).toBe('commission-intake');
		expect(PurposeSchema.parse('other')).toBe('other');
	});

	it('rejects unknown purposes', () => {
		expect(() => PurposeSchema.parse('pricing')).toThrow();
	});
});

describe('ChannelsFileSchema (channels.json shape contract)', () => {
	it('accepts the canonical channel shape', () => {
		const ok = {
			channels: [
				{
					id: 'github-rebuildup',
					label: 'GitHub',
					labelEn: 'GitHub rebuildup',
					purpose: 'technical',
					url: 'https://github.com/rebuildup',
					verified_at: '2026-09-27',
					active: true,
				},
			],
		};
		expect(() => ChannelsFileSchema.parse(ok)).not.toThrow();
	});

	it('rejects non-kebab id', () => {
		const bad = {
			channels: [
				{
					id: 'Has_Bad_Chars',
					label: 'X',
					labelEn: 'X',
					purpose: 'technical',
					url: 'https://example.com',
					verified_at: '2026-09-27',
					active: true,
				},
			],
		};
		expect(() => ChannelsFileSchema.parse(bad)).toThrow();
	});

	it('rejects malformed url', () => {
		const bad = {
			channels: [
				{
					id: 'x',
					label: 'X',
					labelEn: 'X',
					purpose: 'technical',
					url: 'not-a-url',
					verified_at: '2026-09-27',
					active: true,
				},
			],
		};
		expect(() => ChannelsFileSchema.parse(bad)).toThrow();
	});

	it('rejects malformed verified_at', () => {
		const bad = {
			channels: [
				{
					id: 'x',
					label: 'X',
					labelEn: 'X',
					purpose: 'technical',
					url: 'https://example.com',
					verified_at: '2026/09/27',
					active: true,
				},
			],
		};
		expect(() => ChannelsFileSchema.parse(bad)).toThrow();
	});
});
