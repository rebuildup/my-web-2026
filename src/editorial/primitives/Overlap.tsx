import type { ElementType, ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';

/**
 * Overlap — figure/ground layering inside one grid cell
 * (ADR-0023 §3, layout-system.md §5.4a).
 *
 * `Overlap` is a single-cell grid; every `OverlapLayer` child shares
 * `grid-area: 1 / 1`, so layers stack in DOM order. Each layer picks
 * its own `align` / `justify` — the declarative way to say "text
 * over image" or "caption over media" without exposing `position` or
 * `z-index`.
 */

export interface OverlapProps {
	as?: ElementType;
	className?: string;
	children?: ReactNode;
	/** Pass-through `data-*` attributes for E2E/integration selectors. */
	[key: `data-${string}`]: string | number | boolean | undefined;
}

export function Overlap({ as, className, children, ...rest }: OverlapProps) {
	const Tag: ElementType = as ?? 'div';
	return (
		<Tag {...rest} className={cx(css({ display: 'grid' }), className)}>
			{children}
		</Tag>
	);
}

export type OverlapAlign = 'start' | 'center' | 'end' | 'stretch';
export type OverlapJustify = 'start' | 'center' | 'end' | 'stretch';

export interface OverlapLayerProps {
	align?: OverlapAlign;
	justify?: OverlapJustify;
	as?: ElementType;
	className?: string;
	children?: ReactNode;
	/** Pass-through `data-*` attributes for E2E/integration selectors. */
	[key: `data-${string}`]: string | number | boolean | undefined;
}

export function OverlapLayer({
	align = 'stretch',
	justify = 'stretch',
	as,
	className,
	children,
	...rest
}: OverlapLayerProps) {
	const Tag: ElementType = as ?? 'div';
	return (
		<Tag
			{...rest}
			className={cx(
				css({
					gridArea: '1 / 1',
					alignSelf: align,
					justifySelf: justify,
				}),
				className,
			)}
		>
			{children}
		</Tag>
	);
}
