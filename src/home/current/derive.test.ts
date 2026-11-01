import { describe, expect, it } from 'vitest';
import {
	compareIsoDates,
	daysBetween,
	formatCount,
	formatDuration,
	formatRelativeDay,
	isValidIsoDate,
	parseIsoDate,
} from './derive';

/**
 * The arithmetic behind the section's derived values (Issue #316).
 *
 * These are the values that change when the calendar moves rather than when
 * a record does, so they are asserted directly: a wrong duration is a wrong
 * claim about how long the project has been going.
 */
describe('parseIsoDate', () => {
	it('accepts a real calendar day', () => {
		expect(parseIsoDate('2026-11-01')?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
	});

	it('refuses a day the month does not have', () => {
		// `new Date('2026-02-30')` rolls over to March; a typo must not
		// become a plausible-looking date.
		expect(parseIsoDate('2026-02-30')).toBeNull();
		expect(parseIsoDate('2026-04-31')).toBeNull();
	});

	it('refuses a month outside 1–12 and a non-padded shape', () => {
		expect(parseIsoDate('2026-13-01')).toBeNull();
		expect(parseIsoDate('2026-00-10')).toBeNull();
		expect(parseIsoDate('2026-1-1')).toBeNull();
		expect(parseIsoDate('2026-11-01T00:00:00Z')).toBeNull();
	});

	it('accepts a leap day in a leap year and refuses it otherwise', () => {
		expect(isValidIsoDate('2028-02-29')).toBe(true);
		expect(isValidIsoDate('2026-02-29')).toBe(false);
	});
});

describe('daysBetween', () => {
	it('counts whole days forward and backward', () => {
		expect(daysBetween('2026-10-30', '2026-11-01')).toBe(2);
		expect(daysBetween('2026-11-01', '2026-10-30')).toBe(-2);
		expect(daysBetween('2026-11-01', '2026-11-01')).toBe(0);
	});

	it('is not affected by a daylight-saving boundary', () => {
		// UTC arithmetic: the answer is the same in every time zone.
		expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
	});
});

describe('compareIsoDates', () => {
	it('orders dates and reports equality', () => {
		expect(compareIsoDates('2026-01-01', '2026-01-02')).toBe(-1);
		expect(compareIsoDates('2026-01-02', '2026-01-01')).toBe(1);
		expect(compareIsoDates('2026-01-01', '2026-01-01')).toBe(0);
	});
});

describe('formatDuration', () => {
	const today = '2026-11-01';

	it('says 当日 for the same day', () => {
		expect(formatDuration('2026-11-01', today)).toBe('当日');
	});

	it('counts days inside the first month', () => {
		expect(formatDuration('2026-10-20', today)).toBe('12 日');
	});

	it('counts whole calendar months', () => {
		expect(formatDuration('2026-09-11', today)).toBe('1 か月');
		expect(formatDuration('2026-08-01', today)).toBe('3 か月');
	});

	it('counts years and the months on top', () => {
		expect(formatDuration('2025-04-01', today)).toBe('1 年 7 か月');
		expect(formatDuration('2025-11-01', today)).toBe('1 年');
	});

	it('returns null for a future or unusable start', () => {
		expect(formatDuration('2026-12-01', today)).toBeNull();
		expect(formatDuration('2026-02-30', today)).toBeNull();
	});
});

describe('formatRelativeDay', () => {
	const today = '2026-11-01';

	it('names today and yesterday', () => {
		expect(formatRelativeDay('2026-11-01', today)).toBe('今日');
		expect(formatRelativeDay('2026-10-31', today)).toBe('昨日');
	});

	it('counts the days before that', () => {
		expect(formatRelativeDay('2026-10-20', today)).toBe('12 日前');
	});

	it('returns null for a future or unusable date', () => {
		expect(formatRelativeDay('2026-11-02', today)).toBeNull();
		expect(formatRelativeDay('not-a-date', today)).toBeNull();
	});
});

describe('formatCount', () => {
	it('groups the integer part with commas', () => {
		expect(formatCount(0)).toBe('0');
		expect(formatCount(999)).toBe('999');
		expect(formatCount(2424)).toBe('2,424');
		expect(formatCount(2915)).toBe('2,915');
		expect(formatCount(1234567)).toBe('1,234,567');
	});

	it('truncates a non-integer and refuses a non-finite number', () => {
		expect(formatCount(12.7)).toBe('12');
		expect(formatCount(Number.NaN)).toBe('');
	});
});
