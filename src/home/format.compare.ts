import { HOME_LOCALES, type HomeFormat, createHomeFormat } from './format';

/**
 * Locale comparison fixture (Issue #430).
 *
 * The canonical "one instant, three locales" table. It is the single
 * source for every surface that shows the adapter's behaviour:
 *
 *   - `src/home/format.stories.tsx` renders it as the Storybook
 *     preview.
 *   - `src/home/format.report.test.ts` renders it as the static
 *     verification report the committed screenshot is taken from, and
 *     asserts its content as a CI fixture.
 *
 * It is a *fixture*, not production behaviour: nothing on the shipped
 * page reads it. It exists so a reviewer can see the locale
 * differences without a running Worker and without waiting for any
 * other issue — the acceptance criterion "the same instant reads
 * consistently per locale" has to be checkable from this repository
 * alone.
 *
 * Every row formats the **same** instants in every locale. Only the
 * locale (and, where the row says so, the time zone) changes, so any
 * difference in the rendered table is the locale's own convention.
 */

/** The fixed instant every row formats. */
export const LOCALE_COMPARISON_INSTANT = '2026-01-05T09:00:00.000Z';

/** The fixed clock the relative rows measure from. */
export const LOCALE_COMPARISON_NOW = Date.UTC(2026, 0, 5, 9, 0, 0);

export interface LocaleComparisonRow {
	/** Row label — what the value is. */
	label: string;
	/** Why the row exists (rendered as a quiet note). */
	note?: string;
	/** Time zone the row is read in. Defaults to UTC. */
	timeZone?: string;
	/** The value, rendered in the row's locale. */
	render: (format: HomeFormat) => string;
}

export const LOCALE_COMPARISON_ROWS: readonly LocaleComparisonRow[] = [
	{
		label: 'Instant — 2026-01-05T09:00:00Z',
		note: 'the same instant, read in UTC',
		render: (format) => format.formatInstant(LOCALE_COMPARISON_INSTANT),
	},
	{
		label: 'Instant — same moment in Asia/Tokyo',
		note: 'the zone moves the clock reading, not the instant',
		timeZone: 'Asia/Tokyo',
		render: (format) => format.formatInstant(LOCALE_COMPARISON_INSTANT),
	},
	{
		label: 'Date only — UTC',
		note: 'date order and separators are locale data',
		render: (format) => format.formatDate(LOCALE_COMPARISON_INSTANT),
	},
	{
		label: 'Count — 1,234,567 page views',
		note: 'grouping is identical in en / ja / ko today',
		render: (format) => format.formatCount(1_234_567),
	},
	{
		label: 'Relative — 5 minutes ago',
		note: 'the unit is worded by the locale',
		render: (format) => format.formatRelative(LOCALE_COMPARISON_NOW - 5 * 60_000),
	},
	{
		label: 'Relative — 3 hours ago',
		note: 'the unit is worded by the locale',
		render: (format) => format.formatRelative(LOCALE_COMPARISON_NOW - 3 * 3_600_000),
	},
	{
		label: 'Relative — 12 days ago',
		note: 'measured spans stay measured (no "yesterday")',
		render: (format) => format.formatRelative(LOCALE_COMPARISON_NOW - 12 * 86_400_000),
	},
	{
		label: 'Unit reference — 12 hours',
		note: 'preview only: no home surface renders a CLDR unit yet',
		render: (format) =>
			new Intl.NumberFormat(format.locale, { style: 'unit', unit: 'hour' }).format(12),
	},
];

/** One column of the locale comparison table (Issue #430 / #407). */
export interface LocaleComparisonColumn {
	key: string;
	label: string;
}

/** One row of the locale comparison table. `cells` is keyed by column. */
export interface LocaleComparisonTableRow {
	key: string;
	label: string;
	cells: Record<string, string>;
}

export interface LocaleComparisonTable {
	columns: readonly LocaleComparisonColumn[];
	rows: readonly LocaleComparisonTableRow[];
}

/**
 * The comparison rows as the table-shaped projection `DataTable` takes.
 *
 * It lives HERE rather than in `format.stories.tsx` for one mechanical
 * reason: Panda reads an object literal in a module that imports `css`
 * as a style candidate, so `{ id: 'value', header: 'Value' }` written
 * inside the story would ship `#id_value { id: value }` and fail
 * `pnpm run css:check` (Issue #407). This module imports no style
 * function, so the row data stays data.
 */
export function localeComparisonTable(now: () => number): LocaleComparisonTable {
	return {
		columns: [
			{ key: 'value', label: 'Value' },
			...HOME_LOCALES.map((locale) => ({ key: locale, label: locale })),
		],
		rows: LOCALE_COMPARISON_ROWS.map((row) => ({
			key: row.label,
			label: row.note ? `${row.label} (${row.note})` : row.label,
			cells: Object.fromEntries(
				HOME_LOCALES.map((locale) => [
					locale,
					row.render(createHomeFormat({ locale, timeZone: row.timeZone, now })),
				]),
			),
		})),
	};
}
