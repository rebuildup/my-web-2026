import type { ElementType, ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';

/**
 * Breakout — lets ONE block inside a `PageSection` exceed the
 * canonical 1024 px measure (ADR-0023 §3, layout-system.md §5.4a).
 *
 * Intended for media, figures and large display type — the cases
 * where the content IS the section's subject and the measure would
 * only shrink it. It is a declaration, not a margin hack: the escape
 * is owned here and the block still sits inside the section's tone
 * and vertical rhythm.
 *
 * `variant="viewport"` reaches the viewport edges (full bleed);
 * `variant="wide"` reaches a declared 1440 px measure — wide enough
 * to escape the 1024 column without touching the screen edge.
 */

export type BreakoutVariant = 'viewport' | 'wide';

export interface BreakoutProps {
	variant?: BreakoutVariant;
	as?: ElementType;
	className?: string;
	children?: ReactNode;
	/** Pass-through `data-*` attributes for E2E/integration selectors. */
	[key: `data-${string}`]: string | number | boolean | undefined;
}

export function Breakout({
	variant = 'viewport',
	as,
	className,
	children,
	...rest
}: BreakoutProps) {
	const Tag: ElementType = as ?? 'div';
	return (
		<Tag
			{...rest}
			className={cx(
				css(
					variant === 'viewport'
						? {
								width: '100vw',
								marginInlineStart: 'calc(50% - 50vw)',
							}
						: {
								width: 'min(1440px, 100vw)',
								marginInlineStart: 'calc(50% - min(720px, 50vw))',
							},
				),
				className,
			)}
		>
			{children}
		</Tag>
	);
}
