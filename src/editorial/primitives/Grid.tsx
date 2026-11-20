import type { ElementType, ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';

/**
 * Grid — the only owner of multi-column track presets
 * (ADR-0022 C-4, layout-system.md §5.2).
 *
 * Feature code picks a preset and a spacing-token `gap`; it never
 * writes `gridTemplateColumns` / `gridAutoFlow` itself. `minmax(0, …)`
 * is mandatory inside the presets so content can shrink.
 */

export type GridColumns = 1 | 2 | 3 | 4;

/** Spacing-token gap values allowed by the rhythm contract. */
export type FlowGap = '1' | '2' | '4' | '6' | '10' | '16' | '24' | '32';

const COLUMN_TRACKS: Record<GridColumns, Record<string, string>> = {
	1: { base: '1fr', md: '1fr', lg: '1fr' },
	2: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(2, minmax(0, 1fr))' },
	3: {
		base: '1fr',
		md: 'repeat(2, minmax(0, 1fr))',
		lg: 'repeat(3, minmax(0, 1fr))',
	},
	4: {
		base: '1fr',
		md: 'repeat(2, minmax(0, 1fr))',
		lg: 'repeat(4, minmax(0, 1fr))',
	},
};

export interface GridProps {
	columns?: GridColumns;
	/** Gap from the spacing-token rhythm set (default `6` = 24px). */
	gap?: FlowGap;
	as?: ElementType;
	className?: string;
	children?: ReactNode;
}

export function Grid({ columns = 1, gap = '6', as, className, children }: GridProps) {
	const Tag: ElementType = as ?? 'div';
	return (
		<Tag
			className={cx(
				css({
					display: 'grid',
					gridTemplateColumns: COLUMN_TRACKS[columns],
					gap,
				}),
				className,
			)}
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
	as?: ElementType;
	className?: string;
	children?: ReactNode;
}

export function Split({ gap = '10', as, className, children }: SplitProps) {
	const Tag: ElementType = as ?? 'div';
	return (
		<Tag
			className={cx(
				css({
					display: 'grid',
					gridTemplateColumns: {
						base: '1fr',
						lg: 'minmax(0, 4fr) minmax(0, 8fr)',
					},
					columnGap: { base: '0', lg: gap },
					rowGap: { base: '6', lg: '0' },
				}),
				className,
			)}
		>
			{children}
		</Tag>
	);
}
