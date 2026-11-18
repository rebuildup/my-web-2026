import { describe, expect, it } from 'vitest';
import {
	AUDIT_WINDOW_DAYS,
	ChannelsFileSchema,
	PurposeSchema,
	auditChannelState,
	countUnauditableChannels,
	daysSinceVerified,
	selectDisplayableChannels,
} from './schema';
import type { Channel } from './schema';

/**
 * Unit tests for the `/contact` channel selection (Issues #103, #833).
 *
 * Issue #833 split the old single freshness gate into two contracts:
 *
 *   - DISPLAY validity — `active: true` plus a parseable, non-future
 *     `verified_at`. Only this decides whether a channel is listed.
 *   - AUDIT freshness — `auditChannelState` classifies the record as
 *     `fresh` / `due` / `unknown`. `due` stays listed with a
 *     re-verification note; `unknown` cannot confirm the channel was
 *     ever verified and is dropped (fail-closed).
 *
 * We pin `now` so the boundary cases are stable across runs.
 *
 * Coverage:
 *   1. Inactive channels are always dropped.
 *   2. Channels past the audit window STAY listed as `due` — date
 *      age alone must not remove a verified route (Issue #833).
 *   3. Channels inside the audit window are `fresh`.
 *   4. `verified_at` == now - 1 day is `fresh`.
 *   5. A `verified_at` dated in the future is `unknown` → dropped.
 *   5a. The day is read as JST, so a channel verified "today" in JST
 *      is still `fresh` during the 9 hours when UTC is on the
 *      previous day.
 *   6. Ordering is stable: most-recently verified first, then id
 *      ascending on tie.
 *   7. Malformed verified_at → `unknown` → dropped (fail-closed).
 *   8. countUnauditableChannels counts only ACTIVE unknown records.
 *   9. PurposeSchema rejects unknown purposes.
 *  10. The JSON shape contract: id regex / url format / verified_at
 *      date format.
 */

// Pin `now` to a known instant so test boundaries are stable.
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0); // 2026-09-27T12:00:00Z
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function channel(overrides: Partial<Channel> = {}): Channel {
	return {
		id: 'x',
		label: 'X',
		labelEn: 'X',
		purpose: 'technical',
		url: 'https://example.com',
		verified_at: '2026-09-27',
		active: true,
		...overrides,
	};
}

function daysAgo(n: number): string {
	return new Date(NOW - n * ONE_DAY_MS).toISOString().slice(0, 10);
}

describe('selectDisplayableChannels', () => {
	it('drops inactive channels regardless of verified_at', () => {
		const out = selectDisplayableChannels([channel({ active: false })], NOW);
		expect(out).toHaveLength(0);
	});

	it('keeps channels past the audit window as `due` — age alone never removes a verified route', () => {
		const out = selectDisplayableChannels(
			[channel({ verified_at: daysAgo(AUDIT_WINDOW_DAYS + 1) })],
			NOW,
		);
		expect(out).toHaveLength(1);
		expect(out[0].audit).toBe('due');
	});

	it('keeps channels whose verified_at is inside the audit window as `fresh`', () => {
		const out = selectDisplayableChannels([channel({ verified_at: daysAgo(5) })], NOW);
		expect(out).toHaveLength(1);
		expect(out[0].audit).toBe('fresh');
		expect(out[0].channel.id).toBe('x');
	});

	it('keeps channels verified just inside the window', () => {
		const out = selectDisplayableChannels(
			[channel({ verified_at: daysAgo(AUDIT_WINDOW_DAYS - 1) })],
			NOW,
		);
		expect(out).toHaveLength(1);
		expect(out[0].audit).toBe('fresh');
	});

	it('keeps a same-day JST verification while UTC is still on the previous day', () => {
		// 2026-09-28T00:30+09:00 == 2026-09-27T15:30Z. The record says
		// 2026-09-28; a UTC-anchored parse would place it 8.5 hours AHEAD
		// of `now` and the row would read `unknown` instead of "today".
		const now = Date.UTC(2026, 8, 27, 15, 30, 0);
		const out = selectDisplayableChannels([channel({ verified_at: '2026-09-28' })], now);
		expect(out).toHaveLength(1);
		expect(out[0].audit).toBe('fresh');
		expect(out[0].verifiedDaysAgo).toBe(0);
	});

	it('drops a channel dated in the future — the record cannot confirm verification', () => {
		const out = selectDisplayableChannels([channel({ verified_at: '2026-12-31' })], NOW);
		expect(out).toHaveLength(0);
	});

	it('drops channels with unparseable verified_at', () => {
		const out = selectDisplayableChannels([channel({ verified_at: 'not-a-date' })], NOW);
		expect(out).toHaveLength(0);
	});

	it('orders results by verified_at desc, then id asc', () => {
		const out = selectDisplayableChannels(
			[
				channel({ id: 'aaa', verified_at: daysAgo(20) }),
				channel({ id: 'ccc', verified_at: daysAgo(1) }),
				channel({ id: 'bbb', verified_at: daysAgo(5) }),
			],
			NOW,
		);
		expect(out.map((c) => c.channel.id)).toEqual(['ccc', 'bbb', 'aaa']);
	});

	it('honours a custom audit window when supplied', () => {
		const ten = daysAgo(10);
		// Default 30d window: `fresh`.
		expect(selectDisplayableChannels([channel({ verified_at: ten })], NOW)[0].audit).toBe('fresh');
		// 5d window: still LISTED, now `due` — the window moved the
		// audit verdict, not the visibility.
		const out = selectDisplayableChannels([channel({ verified_at: ten })], NOW, 5 * ONE_DAY_MS);
		expect(out).toHaveLength(1);
		expect(out[0].audit).toBe('due');
	});
});

describe('auditChannelState', () => {
	it('classifies fresh / due / unknown independently of display', () => {
		expect(auditChannelState(channel({ verified_at: daysAgo(1) }), NOW)).toBe('fresh');
		expect(auditChannelState(channel({ verified_at: daysAgo(45) }), NOW)).toBe('due');
		expect(auditChannelState(channel({ verified_at: 'garbage' }), NOW)).toBe('unknown');
		expect(auditChannelState(channel({ verified_at: '2027-01-01' }), NOW)).toBe('unknown');
	});
});

describe('countUnauditableChannels', () => {
	it('counts only ACTIVE channels whose audit state is unknown', () => {
		const input = [
			channel({ id: 'bad-active', verified_at: 'garbage' }),
			channel({ id: 'future-active', verified_at: '2027-01-01' }),
			channel({ id: 'bad-inactive', verified_at: 'garbage', active: false }),
			channel({ id: 'ok', verified_at: daysAgo(3) }),
			channel({ id: 'due-ok', verified_at: daysAgo(60) }),
		];
		expect(countUnauditableChannels(input, NOW)).toBe(2);
	});
});

describe('daysSinceVerified', () => {
	it('returns integer days from now', () => {
		expect(daysSinceVerified(channel({ verified_at: daysAgo(5) }), NOW)).toBe(5);
	});

	it('returns NaN on unparseable date', () => {
		expect(Number.isNaN(daysSinceVerified(channel({ verified_at: 'oops' }), NOW))).toBe(true);
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
