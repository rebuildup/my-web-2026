import type { DataTableState, TableColumn, TableRow } from './table-code';

/**
 * table-code fixture data (Issue #407).
 *
 * Why the fixture data is shaped the way it is
 * ---------------------------------------------
 * Panda's scanner reads an object literal as a style candidate when its
 * keys look like CSS properties or HTML attributes. A data row written
 * as `{ id: 'level', header: 'Level' }` inside a module that imports
 * `css` therefore ships a rule the browser drops — `.md:id_level
 * { id: level }` — and `pnpm run css:check` fails on exactly that,
 * because the gate's vocabulary is CSS properties and neither `id` nor
 * `header` is one.
 *
 * Two rules follow, and both are why this file exists:
 *
 *   1. The WORDS live in a module that imports no style function, the
 *      same separation `src/home/format.compare.ts` uses for the locale
 *      comparison rows. `table-code.tsx` keeps the components and the
 *      style vocabulary.
 *   2. The component API spells a column's identity `key` and its
 *      header `label`, so a row cannot be written in a way that
 *      silently becomes CSS in the first place.
 */

export interface TableCodeCase {
	/** `data-case` the fixture renders; asserted as an exact set. */
	id: TableCodeCaseId;
	title: string;
	/** The line under the scroll box explaining what this state shows. */
	note: string;
	state: DataTableState;
	compact: boolean;
}

/**
 * The four states the Issue names, in render order: `正常` / `空` /
 * `失敗` / `縮小表示`.
 *
 * The ids are asserted (by the tests, by `scripts/check-table-code-a11y.mjs`
 * and by the capture) as an exact set, so a fixture that quietly stopped
 * rendering one of them fails instead of "verifying" three of four.
 */
export const TABLE_CODE_CASE_IDS = ['01-normal', '02-empty', '03-failure', '04-compact'] as const;

export type TableCodeCaseId = (typeof TABLE_CODE_CASE_IDS)[number];

/**
 * The columns are the WCAG 2.2 success criteria this component is
 * measured against, and the rows are what the component provides for
 * each of them.
 */
export const TABLE_CODE_COLUMNS: readonly TableColumn[] = [
	{ key: 'sc', label: 'Success criterion' },
	{ key: 'level', label: 'Level' },
	{ key: 'provided', label: 'What the component provides' },
];

export const TABLE_CODE_ROWS: readonly TableRow[] = [
	{
		key: 'reflow',
		label: '1.4.10 Reflow',
		cells: {
			level: 'AA',
			provided: 'The scroll box is the widest element; the document stays viewport-wide.',
		},
	},
	{
		key: 'info-relationships',
		label: '1.3.1 Info and Relationships',
		cells: {
			level: 'A',
			provided: 'A caption plus scope on the column and row headers of every table.',
		},
	},
	{
		key: 'keyboard',
		label: '2.1.1 Keyboard',
		cells: {
			level: 'A',
			provided: 'Each scroll box is focusable, so arrow keys move it.',
		},
	},
	{
		key: 'headings-labels',
		label: '2.4.6 Headings and Labels',
		cells: {
			level: 'AA',
			provided: 'The caption and the code label name their own regions.',
		},
	},
];

export const TABLE_CODE_CASES: readonly TableCodeCase[] = [
	{
		id: '01-normal',
		title: 'Normal',
		note: 'Four criteria rows, one row header column, four columns.',
		state: 'ok',
		compact: false,
	},
	{
		id: '02-empty',
		title: 'Empty',
		note: 'No rows: the header row and the caption stay, so the structure is still announced.',
		state: 'empty',
		compact: false,
	},
	{
		id: '03-failure',
		title: 'Failure',
		note: 'The read failed: one full-width message row replaces the data rows.',
		state: 'error',
		compact: false,
	},
	{
		id: '04-compact',
		title: 'Compact',
		note: 'Same data at the reduced density used at narrow widths.',
		state: 'ok',
		compact: true,
	},
];

/**
 * Column and row fixtures for the component's own contract tests
 * (`table-code.test.tsx`).
 *
 * They live here for the same mechanical reason as the rest of this
 * module: the test file imports `./table-code`, which imports `css`, so
 * a row literal written in the test would ship `#id_level { id: level }`
 * and fail `pnpm run css:check`.
 */
export const TABLE_CODE_TEST_COLUMNS: readonly TableColumn[] = [
	{ key: 'sc', label: 'Success criterion' },
	{ key: 'level', label: 'Level' },
	{ key: 'provided', label: 'What it provides' },
];

export const TABLE_CODE_TEST_ROWS: readonly TableRow[] = [
	{
		key: 'reflow',
		label: '1.4.10 Reflow',
		cells: { level: 'AA', provided: 'The scroll box is the widest element.' },
	},
	{
		key: 'keyboard',
		label: '2.1.1 Keyboard',
		cells: { level: 'A', provided: 'Each scroll box is a focusable region.' },
	},
];

/** A row whose cells are all missing, for the em-dash rendering rule. */
export function rowWithoutCells(cells: Record<string, string>): TableRow {
	return { key: 'r', label: 'h', cells };
}

/**
 * A sample line that is wider than any phone viewport, so the scroll
 * confinement is observable at 375 px instead of being a claim.
 */
export const TABLE_CODE_SAMPLE_CODE = [
	'const table = <DataTable',
	'\tcaption="WCAG 2.2 success criteria"',
	'\tcolumns={columns}',
	'\trows={rows}          // four criteria, one row header column',
	'/>;                    // scroll lives inside the component',
].join('\n');
