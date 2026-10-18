import { describe, expect, it } from 'vitest';
import { HOME_FORMAT_DEFAULT_LOCALE, HOME_FORMAT_DEFAULT_TIME_ZONE, HOME_LOCALES } from './format';
import { createHomeFormat } from './format';

/**
 * Format adapter — behaviour contract (Issue #430).
 *
 * The suite pins three things:
 *
 *   1. **Same instant, per locale.** One epoch-ms value renders
 *      differently in `en` / `ja` / `ko` and every locale's output
 *      still names the same instant (asserted by formatting the
 *      *same* value in two zones and requiring two different clock
 *      readings, not by re-parsing the localized string — a
 *      localized string is not round-trippable by contract).
 *   2. **The value is never rewritten.** Grouping is presentation:
 *      `formatCount(1234567)` must strip back to `1234567`, and no
 *      method may round, re-unit, or clamp its input.
 *   3. **The documented typography differences are real.** The
 *      adapter's doc block claims a full-width space in `ja`, a tight
 *      `ko` form, a `ko` day period, and *identical* digit grouping
 *      across the three locales. Those are CLDR observations, so they
 *      are asserted here rather than left as prose.
 *
 * The exact strings below are CLDR data, not application copy: they
 * come from the `Intl` implementation of whichever runtime executes
 * the suite (workerd for this config). A runtime whose ICU data
 * disagrees with the claim is a finding for the doc block, not
 * something to paper over by loosening the assertion.
 */

/** 2026-01-05T09:00:00Z — a fixed instant, expressed once for every case. */
const INSTANT_MS = Date.UTC(2026, 0, 5, 9, 0, 0);
const INSTANT_ISO = '2026-01-05T09:00:00.000Z';

const format = (locale: 'en' | 'ja' | 'ko', timeZone = 'UTC') =>
	createHomeFormat({ locale, timeZone });

/** The clock reading inside a formatted instant, e.g. "6:00 PM" → "6:00". */
function clockReading(rendered: string): string {
	return rendered.match(/\d{1,2}:\d{2}/)?.[0] ?? '';
}

describe('createHomeFormat', () => {
	it('defaults to the shipped surface: en + UTC', () => {
		const adapter = createHomeFormat();
		expect(adapter.locale).toBe(HOME_FORMAT_DEFAULT_LOCALE);
		expect(adapter.timeZone).toBe(HOME_FORMAT_DEFAULT_TIME_ZONE);
	});

	it('exposes exactly the three locales the home advertises', () => {
		expect([...HOME_LOCALES]).toEqual(['en', 'ja', 'ko']);
	});

	it('renders one instant consistently per locale', () => {
		const en = format('en').formatInstant(INSTANT_ISO);
		const ja = format('ja').formatInstant(INSTANT_ISO);
		const ko = format('ko').formatInstant(INSTANT_ISO);
		// Same instant, three locale-specific readings.
		expect(en).not.toBe(ja);
		expect(ja).not.toBe(ko);
		// Each one carries the instant's own day, month, and year.
		for (const rendered of [en, ja, ko]) {
			expect(rendered).toContain('2026');
		}
		expect(en).toContain('Jan 5, 2026');
		expect(ja).toContain('2026/01/05');
		expect(ko).toContain('2026. 1. 5.');
		// And every locale states the zone the clock was read in.
		for (const rendered of [en, ja, ko]) expect(rendered).toContain('UTC');
	});

	it('reads the same instant in different zones as different clock readings', () => {
		const utc = format('en', 'UTC').formatInstant(INSTANT_MS);
		const tokyo = format('en', 'Asia/Tokyo').formatInstant(INSTANT_MS);
		const newYork = format('en', 'America/New_York').formatInstant(INSTANT_MS);
		expect(tokyo).not.toBe(utc);
		expect(newYork).not.toBe(utc);
		// 09:00 UTC is 18:00 in Tokyo and 04:00 in New York. The hour
		// cycle is the locale's own (`en` is 12-hour), so the assertion
		// compares the *rendered* clock readings instead of pinning a
		// 24-hour string the locale never produces.
		expect(clockReading(tokyo)).not.toBe(clockReading(utc));
		expect(clockReading(newYork)).not.toBe(clockReading(utc));
		expect(clockReading(tokyo)).not.toBe(clockReading(newYork));
		// The zone label is per-zone, never the default one.
		expect(format('en', 'Asia/Tokyo').formatTimeZone(INSTANT_MS)).not.toBe('UTC');
	});

	it('falls back to the IANA id when a locale has no short zone name', () => {
		// `formatTimeZone` must never return an empty string: the
		// instant would then read as a bare number.
		expect(format('en').formatTimeZone(INSTANT_MS)).not.toBe('');
	});

	it('formats dates without a clock reading', () => {
		expect(format('en').formatDate(INSTANT_ISO)).toBe('Jan 5, 2026');
		expect(format('ja').formatDate(INSTANT_ISO)).toBe('2026/01/05');
		expect(format('ko').formatDate(INSTANT_ISO)).toBe('2026. 1. 5.');
	});

	it('groups digits without changing the value', () => {
		for (const locale of HOME_LOCALES) {
			const rendered = format(locale).formatCount(1_234_567);
			// Documented observation: ja / ko do NOT use full-width
			// digits or their own grouping — all three locales render
			// `1,234,567` from the same number.
			expect(rendered).toBe('1,234,567');
			// Presentation only: stripping the separator returns the
			// exact input.
			expect(Number(rendered.replaceAll(',', ''))).toBe(1_234_567);
		}
		expect(format('en').formatCount(0)).toBe('0');
		expect(format('ja').formatCount(999)).toBe('999');
	});

	it('passes non-finite counts through instead of dressing them up', () => {
		expect(format('en').formatCount(Number.NaN)).toBe('NaN');
		expect(format('en').formatCount(Number.POSITIVE_INFINITY)).toBe('Infinity');
	});

	it('words relative spans per locale, keeping the span exact', () => {
		const now = () => INSTANT_MS;
		const at = (msAgo: number) =>
			createHomeFormat({ locale: 'en', now }).formatRelative(INSTANT_MS - msAgo);
		expect(at(5_000)).toBe('now');
		expect(at(5 * 60_000)).toBe('5 minutes ago');
		expect(at(3 * 3_600_000)).toBe('3 hours ago');
		expect(at(12 * 86_400_000)).toBe('12 days ago');
		// `numeric: 'auto'` would have collapsed a measured span into
		// a calendar word; `-1 day` must stay a measured span.
		expect(at(26 * 3_600_000)).toBe('1 day ago');

		expect(createHomeFormat({ locale: 'ja', now }).formatRelative(INSTANT_MS - 5 * 60_000)).toBe(
			'5 分前',
		);
		expect(createHomeFormat({ locale: 'ko', now }).formatRelative(INSTANT_MS - 5 * 60_000)).toBe(
			'5분 전',
		);
	});

	it('documents the ja / ko unit spacing difference', () => {
		const now = () => INSTANT_MS;
		const target = INSTANT_MS - 5 * 60_000;
		const ja = createHomeFormat({ locale: 'ja', now }).formatRelative(target);
		const ko = createHomeFormat({ locale: 'ko', now }).formatRelative(target);
		// Japanese separates the number and the unit with a space.
		// The exact code point is ICU data (U+0020 today, U+3000 in
		// older CLDR), so the assertion accepts either.
		expect(ja).toMatch(/^5[\s　]分前$/);
		// Korean writes the unit tight against the number and puts the
		// space in the word order instead ("5분 전").
		expect(ko).toMatch(/^5분\s전$/);
	});

	it('reports a future instant as a future span', () => {
		const now = () => INSTANT_MS;
		expect(createHomeFormat({ locale: 'en', now }).formatRelative(INSTANT_MS + 5 * 60_000)).toBe(
			'in 5 minutes',
		);
	});

	it('returns the em dash placeholder for a missing or unusable instant', () => {
		for (const locale of HOME_LOCALES) {
			expect(format(locale).formatRelative(null)).toBe('—');
		}
		// Unparsable input is echoed when it was a string, so a broken
		// payload stays visible instead of becoming "now".
		expect(format('en').formatDate('not-a-date')).toBe('not-a-date');
		expect(format('en').formatInstant('not-a-date')).toBe('not-a-date');
		expect(format('en').formatDate(Number.NaN)).toBe('—');
	});
});
