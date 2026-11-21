import type { CSSProperties, ElementType, ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';

/**
 * Grid — the only owner of multi-column track presets
 * (ADR-0022 C-4, layout-system.md §5.2).
 *
 * Feature code picks a preset and a spacing-token `gap`; it never
 * writes `gridTemplateColumns` / `gridAutoFlow` itself. `minmax(0, …)`
 * is mandatory inside the presets so content can shrink.
 */

export type GridColumns = 1 | 2 | 3 | 4 | 5;

/**
 * The 12-track coordinate grid (ADR-0023 §3, layout-system.md §5.4a).
 * Used with `GridItem` children carrying `span` / `start` / `end` for
 * asymmetric and offset compositions. Preset `columns` grids remain
 * the default for uniform content.
 */
export type GridTemplate = '12';

/** Spacing tokens allowed by the rhythm contract. */
export type FlowGapToken = '0' | '1' | '2' | '3' | '4' | '6' | '10' | '16' | '24' | '32';

/**
 * A rhythm-token gap, or a responsive override across the `base`/`md`/`lg`
 * breakpoints (Panda resolves the object inside `css()`).
 */
export type FlowGap =
	| FlowGapToken
	| { base?: FlowGapToken; sm?: FlowGapToken; md?: FlowGapToken; lg?: FlowGapToken };

const COLUMN_TRACKS: Record<GridColumns, Record<string, string>> = {
	1: { base: '1fr', md: '1fr', lg: '1fr' },
	2: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(2, minmax(0, 1fr))' },
	3: {
		// Two columns even at `base`: the only consumer is the home
		// Explore destination grid, whose single-column mobile stack
		// read as scroll fatigue in the v10 visual review — paired
		// cards keep the index scannable at 390px.
		base: 'repeat(2, minmax(0, 1fr))',
		md: 'repeat(2, minmax(0, 1fr))',
		lg: 'repeat(3, minmax(0, 1fr))',
	},
	4: {
		base: '1fr',
		md: 'repeat(2, minmax(0, 1fr))',
		lg: 'repeat(4, minmax(0, 1fr))',
	},
	5: {
		// The portfolio card progression: one column on phones, pairs on
		// tablet, a 3-up sheet on desktop — the documented card-grid
		// pattern (`/portfolio` index, Issue #912 round 2).
		base: '1fr',
		md: 'repeat(2, minmax(0, 1fr))',
		lg: 'repeat(3, minmax(0, 1fr))',
	},
};

export interface GridProps {
	columns?: GridColumns;
	/**
	 * Coordinate-grid template. `'12'` renders
	 * `repeat(12, minmax(0, 1fr))` and expects `GridItem` children.
	 * Mutually exclusive with `columns`.
	 */
	template?: GridTemplate;
	/** Gap from the spacing-token rhythm set (default `6` = 24px). */
	gap?: FlowGap;
	/** Row-axis gap override; falls back to `gap`. */
	rowGap?: FlowGap;
	/** Column-axis gap override; falls back to `gap`. */
	columnGap?: FlowGap;
	/** `gridAutoRows: '1fr'` — every row track takes the tallest item's height. */
	equalRows?: boolean;
	as?: ElementType;
	className?: string;
	children?: ReactNode;
	'aria-label'?: string;
	/** Pass-through `data-*` attributes for E2E/integration selectors. */
	[key: `data-${string}`]: string | number | boolean | undefined;
}

export function Grid({
	columns = 1,
	template,
	gap = '6',
	rowGap,
	columnGap,
	equalRows = false,
	as,
	className,
	children,
	...rest
}: GridProps) {
	const Tag: ElementType = as ?? 'div';
	if (template !== undefined && template !== '12') {
		throw new Error(`Grid: unknown template "${template}"`);
	}
	return (
		<Tag
			{...rest}
			className={cx(
				css({
					display: 'grid',
					gridTemplateColumns: template ? 'repeat(12, minmax(0, 1fr))' : COLUMN_TRACKS[columns],
					rowGap: rowGap ?? gap,
					columnGap: columnGap ?? gap,
					...(equalRows ? { gridAutoRows: '1fr' } : {}),
				}),
				className,
			)}
		>
			{children}
		</Tag>
	);
}

/**
 * Track value for `GridItem` placement props. A bare number applies
 * to `md` and `lg`; `base` stays full-width unless given explicitly —
 * that default is the mobile recomposition contract (ADR-0023 §3).
 */
export type TrackValue = number | { base?: number; md?: number; lg?: number };

const GRID_TRACKS = 12;
const GRID_LINES = GRID_TRACKS + 1;
const TRACK_BPS = ['base', 'md', 'lg'] as const;
type TrackBp = (typeof TRACK_BPS)[number];

function spanValue(value: number | undefined, what: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1 || value > GRID_TRACKS) {
		throw new Error(`GridItem: ${what} must be an integer 1–${GRID_TRACKS}, got ${value}`);
	}
	return value;
}

function lineValue(value: number | undefined, what: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1 || value > GRID_LINES) {
		throw new Error(`GridItem: ${what} must be an integer 1–${GRID_LINES}, got ${value}`);
	}
	return value;
}

/**
 * Resolve a `TrackValue` into per-breakpoint numbers. A bare number
 * lands on `md` and `lg` (the composition is desktop-designed and
 * mobile falls back to full width); an object sets each breakpoint
 * explicitly.
 */
function perBreakpoint(
	value: TrackValue | undefined,
	validate: (n: number | undefined, what: string) => number | undefined,
	what: string,
): Partial<Record<TrackBp, number>> {
	if (value === undefined) return {};
	if (typeof value === 'number') {
		const n = validate(value, what);
		return n === undefined ? {} : { md: n, lg: n };
	}
	const out: Partial<Record<TrackBp, number>> = {};
	for (const bp of TRACK_BPS) {
		const n = validate(value[bp], `${bp} ${what}`);
		if (n !== undefined) out[bp] = n;
	}
	return out;
}

interface TrackPlacement {
	span?: number;
	start?: number;
	end?: number;
}

function gridColumnFor(track: TrackPlacement): string | undefined {
	const { span, start, end } = track;
	if (start !== undefined && span !== undefined) return `${start} / span ${span}`;
	if (start !== undefined && end !== undefined) return `${start} / ${end}`;
	if (start !== undefined) return `${start} / span ${GRID_LINES - start}`;
	if (end !== undefined) return `span ${end - 1} / ${end}`;
	if (span !== undefined) return `span ${span}`;
	return undefined;
}

/**
 * Static placement class for `GridItem`. The `grid-column` value is a
 * custom-property indirection so one extracted rule covers every
 * span/start/end combination; the actual spec is written inline.
 */
const gridItemPlacementClass = css({
	minWidth: '0',
	gridColumn: {
		base: 'var(--gi-col, span 12)',
		md: 'var(--gi-col-md, var(--gi-col, span 12))',
		lg: 'var(--gi-col-lg, var(--gi-col-md, var(--gi-col, span 12)))',
	},
});

export interface GridItemProps {
	/**
	 * Tracks spanned (1–12). A bare number applies at `md`/`lg` while
	 * `base` falls back to full width; a responsive object sets each
	 * breakpoint explicitly.
	 */
	span?: TrackValue;
	/** Grid line the item starts on (1–13). */
	start?: TrackValue;
	/** Grid line the item ends on (1–13). */
	end?: TrackValue;
	as?: ElementType;
	className?: string;
	children?: ReactNode;
	/** Pass-through `data-*` attributes for E2E/integration selectors. */
	[key: `data-${string}`]: string | number | boolean | undefined;
}

/**
 * GridItem — one cell occupant of `Grid template="12"` (ADR-0023 §3).
 * Placement is declarative; out-of-range values throw at render so a
 * contract violation cannot ship silently.
 */
export function GridItem({ span, start, end, as, className, children, ...rest }: GridItemProps) {
	const Tag: ElementType = as ?? 'div';

	const spans = perBreakpoint(span, spanValue, 'span');
	const starts = perBreakpoint(start, lineValue, 'start');
	const ends = perBreakpoint(end, lineValue, 'end');

	const specs: Partial<Record<TrackBp, string>> = {};
	let hasPlacement = false;
	for (const bp of TRACK_BPS) {
		const track: TrackPlacement = {
			span: spans[bp],
			start: starts[bp],
			end: ends[bp],
		};
		const col = gridColumnFor(track);
		if (col !== undefined) {
			specs[bp] = col;
			hasPlacement = true;
		}
	}

	// Panda extracts `css()` statically, so the per-breakpoint
	// `grid-column` value cannot be a runtime object. Instead the class
	// reads CSS custom properties with a fallback chain
	// (lg → md → base → full width) and the computed spec strings are
	// written as inline custom properties — the same mechanism
	// `toneRebinds` uses for `--colors-*` (tone-styles.ts).
	const vars: { [K in `--${string}`]: string } = {};
	if (specs.base !== undefined) vars['--gi-col'] = specs.base;
	if (specs.md !== undefined) vars['--gi-col-md'] = specs.md;
	if (specs.lg !== undefined) vars['--gi-col-lg'] = specs.lg;
	const style = vars as CSSProperties;

	return (
		<Tag
			{...rest}
			style={hasPlacement ? style : undefined}
			className={cx(hasPlacement ? gridItemPlacementClass : undefined, className)}
		>
			{children}
		</Tag>
	);
}

/**
 * Split — the 4/12 + 8/12 editorial split (layout-system.md §5.4).
 *
 * Single column on small screens; on `lg` the left column carries a
 * label cluster and the right carries content. Use when the content
 * is not a `SectionHeading` pair; heading+content sections use
 * `SectionHeading variant="spread"` instead.
 */
export interface SplitProps {
	/** Gap between the two columns at `lg` (default `10` = 40px). */
	gap?: FlowGap;
	/**
	 * Stacked-row gap below `lg` (default `6` = 24px). Rows that
	 * tighten their label/content spacing on small screens pass a
	 * smaller token here.
	 */
	rowGap?: FlowGap;
	/**
	 * Row-list separation: a top hairline plus `6` block padding —
	 * the chrome every split-row list (`/contact` channels, `/links`
	 * rows, `/stack` items) shares. Off by default; hero/aside splits
	 * pass nothing.
	 */
	separated?: boolean;
	as?: ElementType;
	className?: string;
	children?: ReactNode;
	/** Pass-through `data-*` attributes for E2E/integration selectors. */
	[key: `data-${string}`]: string | number | boolean | undefined;
}

export function Split({
	gap = '10',
	rowGap = '6',
	separated = false,
	as,
	className,
	children,
	...rest
}: SplitProps) {
	const Tag: ElementType = as ?? 'div';
	return (
		<Tag
			{...rest}
			className={cx(
				css({
					display: 'grid',
					gridTemplateColumns: {
						base: '1fr',
						lg: 'minmax(0, 4fr) minmax(0, 8fr)',
					},
					columnGap: { base: '0', lg: gap },
					rowGap: { base: rowGap, lg: '0' },
					...(separated
						? {
								paddingBlock: '6',
								borderBlockStartWidth: '1px',
								borderBlockStartColor: 'border.subtle',
								borderBlockStartStyle: 'solid',
							}
						: {}),
				}),
				className,
			)}
		>
			{children}
		</Tag>
	);
}
