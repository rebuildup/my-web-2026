import { useId } from 'react';
import { css } from '../../styled-system/css';

/**
 * table-code — the readability contract for a table and a code block
 * on a long-form surface (Issue #407).
 *
 * Why this file exists
 * --------------------
 * The representative case the Issue names — an article / technical
 * explanation page — is a table with a caption, a header row, a row
 * header column and a code block that is wider than a phone. Two of
 * those four things are what a reader at 375 px actually loses:
 *
 *   - **Horizontal overflow.** A wide table or a long line of code
 *     either (a) overflows the viewport, which forces the WHOLE page
 *     to scroll sideways (WCAG 2.2 SC 1.4.10 Reflow, AA), or (b) is
 *     clipped and becomes unreadable. This component confines the
 *     scroll to the component itself: the document never becomes
 *     wider than the viewport.
 *   - **Structure.** A table without a `<caption>` and without
 *     `scope` on its header cells is a grid of unrelated boxes to a
 *     screen reader: the reader cannot say which column a value
 *     belongs to, and cannot name the table (WCAG 2.2 SC 1.3.1 Info
 *     and Relationships, A; SC 2.4.6 Headings and Labels, AA).
 *
 * The scroll is only usable if the region can be reached and scrolled
 * from the keyboard. A scrollable `<div>` with `overflow: auto` is
 * focusable nowhere by default: arrow keys scroll the document, not
 * the container. So both surfaces below render their scroll box as a
 * NAMED `<section>` with `tabIndex={0}` (SC 2.1.1 Keyboard, A): a
 * `<section>` that carries an accessible name is exposed as a
 * `region` landmark (HTML-AAM), so the reader can list it and jump to
 * it, and a scroll container has to be operable without a pointer.
 * `scripts/capture-a11y-table-code.mjs` proves that by focusing the
 * region in Chromium and pressing ArrowRight.
 *
 * What this component deliberately does NOT do
 * ---------------------------------------------
 *   - It does not decide WHERE a table or a code block appears. Page
 *     placement belongs to the surface that owns the page; this file
 *     is the obligation owner for the readability rules only
 *     (Issue #407: "未確定なページ配置には依存させない").
 *   - It does not restyle `bordered surfaces` policy. `pre` blocks
 *     keep the exception `src/editorial/layout-system.md` §1 already
 *     grants them (`bg.subtle` + radius); a table does not get a box,
 *     it gets a caption and a hairline header rule.
 *
 * Hooks (read by the gate, the tests and the capture — never
 * duplicated as literals elsewhere):
 *   `data-table-block`   the component root
 *   `data-table-scroll`  the keyboard-reachable scroll container
 *                         (a named `<section>`, i.e. a region)
 *   `data-table-caption` the `<caption>`, which is also the region name
 *   `data-table-state`   `ok` / `empty` / `error`
 *   `data-table-compact` the reduced-density variant (narrow screens)
 *   `data-code-block`    the code component root
 *   `data-code-scroll`   the keyboard-reachable scroll container
 */

/** Column alignment, kept to the two values the design language uses. */
export type TableAlign = 'start' | 'end';

/** The non-empty presentation states a table surface has to render. */
export type DataTableState = 'ok' | 'empty' | 'error';

export interface TableColumn {
	/** Stable key; also rendered as `data-column` on every cell. */
	id: string;
	header: string;
	align?: TableAlign;
	/** Right-aligns and sets `font-variant-numeric: tabular-nums`. */
	numeric?: boolean;
}

export interface TableRow {
	id: string;
	/**
	 * The row's own header. It is rendered as the first cell with
	 * `scope="row"` so a screen reader announces "row header, cell"
	 * while moving across a row.
	 */
	header: string;
	/** Cell values keyed by {@link TableColumn.id}. */
	cells: Readonly<Record<string, string>>;
}

export interface DataTableProps {
	/**
	 * The table's visible name. Rendered as `<caption>` and used as the
	 * scroll region's accessible name, so it is required rather than
	 * optional: a table whose name lives only in surrounding prose is
	 * not nameable when it is scrolled or linked to.
	 */
	caption: string;
	columns: readonly TableColumn[];
	rows?: readonly TableRow[];
	/**
	 * `ok` renders `rows`; `empty` and `error` render a single full-width
	 * message row. The header row is kept in every state so the column
	 * structure a screen reader reports does not depend on the data.
	 */
	state?: DataTableState;
	/** Message for `state="empty"`. Defaults to an English sentence. */
	emptyMessage?: string;
	/** Message for `state="error"`. Defaults to an English sentence. */
	errorMessage?: string;
	/** Optional line under the scroll box (provenance, footnote). */
	note?: string;
	/** Reduced density: tighter padding and the `sm` type step. */
	compact?: boolean;
}

const DEFAULT_EMPTY_MESSAGE = 'No rows to show yet.';
const DEFAULT_ERROR_MESSAGE = 'This data could not be loaded.';

const BLOCK_STYLE = {
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	maxWidth: '640px',
	minWidth: '0',
} as const;

const SCROLL_STYLE = {
	// The scroll is confined here on purpose: the document itself must
	// never grow wider than the viewport (SC 1.4.10).
	overflowX: 'auto',
	overscrollBehaviorX: 'contain',
	minWidth: '0',
	maxWidth: '100%',
} as const;

const CAPTION_STYLE = {
	captionSide: 'top',
	textAlign: 'start',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.default',
	paddingBlockEnd: '2',
	paddingInline: '3',
} as const;

const TABLE_STYLE = {
	width: '100%',
	borderCollapse: 'collapse',
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.default',
} as const;

const HEADER_CELL_STYLE = {
	textAlign: 'start',
	verticalAlign: 'bottom',
	fontWeight: '600',
	color: 'text.muted',
	// A hairline rule, not a box: the header separates, it does not
	// enclose (`layout-system.md` §1).
	borderBottom: '1px solid {colors.border.subtle}',
	padding: '3',
	whiteSpace: 'nowrap',
} as const;

const ROW_HEADER_STYLE = {
	textAlign: 'start',
	verticalAlign: 'top',
	fontWeight: '600',
	color: 'text.default',
	padding: '3',
	whiteSpace: 'nowrap',
} as const;

const CELL_STYLE = {
	textAlign: 'start',
	verticalAlign: 'top',
	padding: '3',
	borderBottom: '1px solid {colors.border.subtle}',
} as const;

const MESSAGE_STYLE = {
	textAlign: 'start',
	verticalAlign: 'top',
	padding: '3',
	color: 'text.muted',
} as const;

const NOTE_STYLE = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	color: 'text.muted',
	paddingInline: '3',
} as const;

/**
 * Resolve a row's cell text. A missing key renders as an em dash rather
 * than an empty cell: an empty `<td>` and a missing value are
 * indistinguishable to a screen reader, and the em dash is the
 * typographic "no value" mark this design language already uses.
 */
export function cellText(row: TableRow, columnId: string): string {
	const value = row.cells[columnId];
	return value === undefined || value === '' ? '—' : value;
}

/**
 * The table surface.
 *
 * The rendered structure is always the same, in every state:
 *
 * ```html
 * <section tabindex="0" aria-labelledby="<caption id>">           <!-- scroll -->
 *   <!-- a named <section> is exposed as a `region` landmark -->
 *   <table>
 *     <caption id="…">…</caption>
 *     <thead><tr><th scope="col">…</th></tr></thead>
 *     <tbody><tr><th scope="row">…</th><td>…</td></tr></tbody>
 *   </table>
 * </section>
 * ```
 *
 * The scroll box is named by the caption (SC 2.4.6) and reachable from
 * the keyboard (SC 2.1.1); the caption is a real `<caption>` so a
 * table-in-a-table or a table referenced from elsewhere keeps its name
 * (SC 1.3.1).
 */
export function DataTable({
	caption,
	columns,
	rows = [],
	state = 'ok',
	emptyMessage = DEFAULT_EMPTY_MESSAGE,
	errorMessage = DEFAULT_ERROR_MESSAGE,
	note,
	compact = false,
}: DataTableProps) {
	const captionId = useId();
	const message = state === 'error' ? errorMessage : emptyMessage;
	const hasRows = state === 'ok' && rows.length > 0;

	return (
		<div data-table-block="" className={css(BLOCK_STYLE)}>
			<section
				data-table-scroll=""
				// A scrollable box that cannot be focused cannot be
				// scrolled with a keyboard (SC 2.1.1). Biome's rule
				// assumes focus means activation; here focus means
				// "arrow keys now move this region, not the page".
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable so arrow keys scroll it (WCAG 2.2 SC 2.1.1); the Chromium capture asserts the keypress actually moves it.
				tabIndex={0}
				aria-labelledby={captionId}
				data-table-state={state}
				data-table-compact={compact ? 'true' : 'false'}
				className={css(SCROLL_STYLE)}
			>
				<table className={css(TABLE_STYLE)}>
					<caption id={captionId} data-table-caption="" className={css(CAPTION_STYLE)}>
						{caption}
					</caption>
					<thead>
						<tr>
							{columns.map((column) => (
								<th
									key={column.id}
									scope="col"
									data-column={column.id}
									className={css({
										...HEADER_CELL_STYLE,
										textAlign: column.align ?? 'start',
										fontFamily: column.numeric ? 'mono' : 'sans',
									})}
								>
									{column.header}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{hasRows ? (
							rows.map((row) => (
								<tr key={row.id} data-row={row.id}>
									<th
										scope="row"
										data-column={columns[0]?.id ?? 'row-header'}
										className={css({
											...ROW_HEADER_STYLE,
											padding: compact ? '2' : '3',
										})}
									>
										{row.header}
									</th>
									{columns.slice(1).map((column) => (
										<td
											key={column.id}
											data-column={column.id}
											className={css({
												...CELL_STYLE,
												textAlign: column.align ?? 'start',
												fontFamily: column.numeric ? 'mono' : 'sans',
												padding: compact ? '2' : '3',
											})}
										>
											{cellText(row, column.id)}
										</td>
									))}
								</tr>
							))
						) : (
							<tr data-row="message">
								<td colSpan={Math.max(columns.length, 1)} className={css(MESSAGE_STYLE)}>
									{message}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>
			{note ? (
				<p data-table-note="" className={css(NOTE_STYLE)}>
					{note}
				</p>
			) : null}
		</div>
	);
}

const CODE_BLOCK_STYLE = {
	...BLOCK_STYLE,
	maxWidth: '640px',
} as const;

const CODE_LABEL_STYLE = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.default',
	paddingInline: '3',
} as const;

const CODE_SCROLL_STYLE = {
	// Same reason as the table: the code block scrolls, the page does
	// not (SC 1.4.10), and the box is keyboard-operable (SC 2.1.1).
	overflowX: 'auto',
	overscrollBehaviorX: 'contain',
	minWidth: '0',
	maxWidth: '100%',
	margin: '0',
	// The `pre` box is one of the surfaces `layout-system.md` §1 allows
	// a box for: it says "this is code, not prose".
	backgroundColor: 'bg.subtle',
	borderRadius: '6px',
	padding: '4',
	fontFamily: 'mono',
	fontSize: 'sm',
	color: 'text.default',
} as const;

export interface CodeBlockProps {
	/**
	 * The code block's VISIBLE name. Rendered as text and used as the
	 * scroll region's accessible name.
	 *
	 * Optional on purpose. `src/portfolio/markdown.safety.test.tsx`
	 * asserts that the Markdown renderer publishes no text the source
	 * document did not contain, so a renderer-owned caption ("Code
	 * example") is not something this component may invent on the
	 * portfolio path. Callers that own their copy pass it; a renderer
	 * that must not speak passes only {@link CodeBlockProps.language}
	 * and gets a region named by the author's own fence token.
	 */
	label?: string;
	code: string;
	/**
	 * The author's fence language. Used as the region's accessible name
	 * when no {@link CodeBlockProps.label} is given, and rendered as
	 * `data-language` for measurement. Never used to fetch or highlight.
	 */
	language?: string;
	compact?: boolean;
}

/**
 * A code block whose overflow is reachable from the keyboard.
 *
 * The accessible name of the scroll box resolves in this order:
 *
 *   1. `label` — visible text, named by `aria-labelledby`.
 *   2. `language` — the author's own fence token, named by `aria-label`.
 *   3. nothing — the box is still focusable and still scrolls with the
 *      arrow keys (SC 2.1.1, SC 1.4.10), it is simply unnamed. Naming
 *      an author-less block needs a per-block caption in the source
 *      schema, which is a product decision, not a rendering one.
 *
 * A focusable, named box is what lets a reader reach the overflow:
 * without it the block can only be scrolled with a pointer.
 */
export function CodeBlock({ label, code, language, compact = false }: CodeBlockProps) {
	const labelId = useId();

	return (
		<div data-code-block="" className={css(CODE_BLOCK_STYLE)}>
			{label ? (
				<p id={labelId} data-code-label="" className={css(CODE_LABEL_STYLE)}>
					{label}
				</p>
			) : null}
			<section
				data-code-scroll=""
				// biome-ignore lint/a11y/noNoninteractiveTabindex: the scroll box has to be focusable for arrow-key scrolling (WCAG 2.2 SC 2.1.1); asserted in the Chromium capture.
				tabIndex={0}
				aria-labelledby={label ? labelId : undefined}
				aria-label={label ? undefined : language}
				data-language={language}
				data-compact={compact ? 'true' : 'false'}
				data-named={label ? 'label' : language ? 'language' : 'none'}
				className={css(CODE_SCROLL_STYLE)}
			>
				<pre
					className={css({
						margin: '0',
						fontFamily: 'mono',
						fontSize: compact ? 'xs' : 'sm',
						width: 'max-content',
						minWidth: '100%',
					})}
				>
					<code>{code}</code>
				</pre>
			</section>
		</div>
	);
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

interface TableCodeCase {
	id: TableCodeCaseId;
	title: string;
	note: string;
	state: DataTableState;
	compact: boolean;
}

/**
 * The columns are the WCAG 2.2 success criteria this component is
 * measured against, and the rows are what the component provides for
 * each of them. The copy is verification copy: it describes public
 * specification text, not a product fact.
 */
const COLUMNS: readonly TableColumn[] = [
	{ id: 'sc', header: 'Success criterion', numeric: false },
	{ id: 'level', header: 'Level', align: 'start', numeric: false },
	{ id: 'provided', header: 'What the component provides', align: 'start' },
];

const ROWS: readonly TableRow[] = [
	{
		id: 'reflow',
		header: '1.4.10 Reflow',
		cells: {
			level: 'AA',
			provided: 'The scroll box is the widest element; the document stays viewport-wide.',
		},
	},
	{
		id: 'info-relationships',
		header: '1.3.1 Info and Relationships',
		cells: {
			level: 'A',
			provided: 'A visible <caption> plus scope="col" and scope="row" on every header cell.',
		},
	},
	{
		id: 'keyboard',
		header: '2.1.1 Keyboard',
		cells: {
			level: 'A',
			provided: 'Each scroll box is a focusable region, so arrow keys move it.',
		},
	},
	{
		id: 'headings-labels',
		header: '2.4.6 Headings and Labels',
		cells: {
			level: 'AA',
			provided: 'The caption and the code label name their own regions.',
		},
	},
];

const CASES: readonly TableCodeCase[] = [
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
 * A single sample line that is wider than any phone viewport, so the
 * scroll confinement is observable at 375 px instead of being a claim.
 */
const SAMPLE_CODE = [
	'const table = <DataTable',
	'\tcaption="WCAG 2.2 success criteria"',
	'\tcolumns={columns}',
	'\trows={rows}          // four criteria, one row header column',
	'/>;                    // scroll lives inside the component',
].join('\n');

const CASE_STYLE = {
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	paddingBlockEnd: '6',
	borderBottom: '1px solid {colors.border.subtle}',
} as const;

const CASE_TITLE_STYLE = {
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '600',
	color: 'text.default',
} as const;

/**
 * The verification fixture (Issue #407 completion condition 2): the
 * four states above, each with a table and a code block, rendered at
 * whatever width the reader gives it.
 *
 * It is published on `/design-system` (the existing public screen) and
 * in Storybook; the Chromium capture measures exactly this DOM.
 */
export function TableCodeFixture() {
	return (
		<div
			data-table-code-fixture=""
			className={css({ display: 'flex', flexDirection: 'column', gap: '8' })}
		>
			{CASES.map((entry) => (
				<section
					key={entry.id}
					data-case={entry.id}
					data-table-code-case=""
					className={css(CASE_STYLE)}
				>
					<h4 className={css(CASE_TITLE_STYLE)}>{`${entry.title} / ${entry.id}`}</h4>
					<DataTable
						caption={`WCAG 2.2 success criteria — ${entry.title.toLowerCase()} state`}
						columns={COLUMNS}
						rows={ROWS}
						state={entry.state}
						compact={entry.compact}
						note={entry.note}
					/>
					<CodeBlock
						label={`Sample markup — ${entry.title.toLowerCase()} state`}
						code={SAMPLE_CODE}
						language="tsx"
						compact={entry.compact}
					/>
				</section>
			))}
		</div>
	);
}
