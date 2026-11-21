import type { ElementType, ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';
import type { FlowGap } from './Grid';

/**
 * Stack / Cluster — the only owners of one-axis flow composition
 * (ADR-0022 C-4, layout-system.md §5.3).
 *
 * `Stack` is vertical flow; `Cluster` is inline flow with wrap.
 * Both take `gap` from the spacing-token rhythm set only — feature
 * code never writes ad-hoc `flexDirection` + `gap` pairs for layout.
 */

export interface StackProps {
	/** Gap from the spacing-token rhythm set (default `4` = 16px). */
	gap?: FlowGap;
	as?: ElementType;
	className?: string;
	children?: ReactNode;
	'aria-label'?: string;
	/** Pass-through `data-*` attributes for E2E/integration selectors. */
	[key: `data-${string}`]: string | number | boolean | undefined;
}

export function Stack({ gap = '4', as, className, children, ...rest }: StackProps) {
	const Tag: ElementType = as ?? 'div';
	return (
		<Tag
			{...rest}
			className={cx(
				css({
					display: 'flex',
					flexDirection: 'column',
					gap,
				}),
				className,
			)}
		>
			{children}
		</Tag>
	);
}

export type ClusterAlign = 'start' | 'center' | 'end' | 'baseline';
export type ClusterJustify = 'start' | 'center' | 'end' | 'between';

const ALIGN_MAP: Record<ClusterAlign, string> = {
	start: 'flex-start',
	center: 'center',
	end: 'flex-end',
	baseline: 'baseline',
};

const JUSTIFY_MAP: Record<ClusterJustify, string> = {
	start: 'flex-start',
	center: 'center',
	end: 'flex-end',
	between: 'space-between',
};

export interface ClusterProps {
	/** Gap from the spacing-token rhythm set (default `2` = 8px). */
	gap?: FlowGap;
	align?: ClusterAlign;
	justify?: ClusterJustify;
	as?: ElementType;
	className?: string;
	children?: ReactNode;
	'aria-label'?: string;
	/** Pass-through `data-*` attributes for E2E/integration selectors. */
	[key: `data-${string}`]: string | number | boolean | undefined;
}

export function Cluster({
	gap = '2',
	align = 'center',
	justify = 'start',
	as,
	className,
	children,
	...rest
}: ClusterProps) {
	const Tag: ElementType = as ?? 'div';
	return (
		<Tag
			{...rest}
			className={cx(
				css({
					display: 'flex',
					flexWrap: 'wrap',
					gap,
					alignItems: ALIGN_MAP[align],
					justifyContent: JUSTIFY_MAP[justify],
				}),
				className,
			)}
		>
			{children}
		</Tag>
	);
}
