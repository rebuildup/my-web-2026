import { describe, expect, it } from 'vitest';
import { HOME_LOCALES, createHomeFormat } from './format';
import {
	LOCALE_COMPARISON_INSTANT,
	LOCALE_COMPARISON_NOW,
	LOCALE_COMPARISON_ROWS,
} from './format.compare';

/**
 * Locale comparison fixture — contract (Issue #430).
 *
 * The fixture is what the Storybook preview and the static
 * verification report both render, so it has to be *correct*, not
 * merely present: a fixture that silently stopped differentiating the
 * locales would make both surfaces lie.
 *
 * The assertions are therefore about the fixture's behaviour:
 *
 *   - every row renders a non-empty value in every locale,
 *   - the instant rows differ per locale (the fixture proves the
 *     difference it exists to show),
 *   - the time-zone row differs from the UTC row (the zone moves the
 *     clock reading, not the instant),
 *   - the count row is identical across locales (the recorded
 *     observation that `en` / `ja` / `ko` group digits the same way).
 */

const NOW = LOCALE_COMPARISON_NOW;

function render(rowIndex: number, locale: (typeof HOME_LOCALES)[number]): string {
	const row = LOCALE_COMPARISON_ROWS[rowIndex];
	return row.render(createHomeFormat({ locale, timeZone: row.timeZone, now: () => NOW }));
}

describe('locale comparison fixture', () => {
	it('renders a non-empty value for every row in every locale', () => {
		for (const [index] of LOCALE_COMPARISON_ROWS.entries()) {
			for (const locale of HOME_LOCALES) {
				expect(render(index, locale).length).toBeGreaterThan(0);
			}
		}
	});

	it("shows the instant in each locale's own reading", () => {
		const en = render(0, 'en');
		const ja = render(0, 'ja');
		const ko = render(0, 'ko');
		expect(en).not.toBe(ja);
		expect(ja).not.toBe(ko);
		expect(en).toContain('Jan 5, 2026');
		expect(ja).toContain('2026/01/05');
		expect(ko).toContain('2026. 1. 5.');
	});

	it('moves the clock reading with the time zone, not the instant', () => {
		const utc = render(0, 'en');
		const tokyo = render(1, 'en');
		expect(tokyo).not.toBe(utc);
		// Same instant, so the date part is the same day in both.
		expect(tokyo).toContain('Jan 5, 2026');
	});

	it('records that digit grouping does not differ across the locales', () => {
		const en = render(3, 'en');
		expect(render(3, 'ja')).toBe(en);
		expect(render(3, 'ko')).toBe(en);
		expect(en).toBe('1,234,567');
	});

	it('words the relative span per locale', () => {
		expect(render(4, 'en')).toBe('5 minutes ago');
		expect(render(4, 'ja')).toMatch(/^5[\s　]分前$/);
		expect(render(4, 'ko')).toMatch(/^5분\s전$/);
	});

	it('keeps the fixed instant and clock the fixture documents', () => {
		expect(LOCALE_COMPARISON_INSTANT).toBe('2026-01-05T09:00:00.000Z');
		expect(LOCALE_COMPARISON_NOW).toBe(Date.UTC(2026, 0, 5, 9, 0, 0));
	});
});
