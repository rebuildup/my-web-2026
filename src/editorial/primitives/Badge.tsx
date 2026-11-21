import type { PropsWithChildren } from 'react';
import { type RecipeVariantProps, cva, cx } from '../../../styled-system/css';

/**
 * Badge — short, inline status indicator.
 *
 * Two tones (neutral | accent). Use for tags and status pills —
 * never as a primary interactive element.
 */
const badgeRecipe = cva({
	base: {
		display: 'inline-flex',
		alignItems: 'center',
		h: '6',
		px: '3',
		borderRadius: 'full',
		fontFamily: 'sans',
		fontSize: 'xs',
		fontWeight: '600',
	},
	variants: {
		tone: {
			neutral: {
				bg: 'bg.subtle',
				color: 'text.muted',
			},
			accent: {
				bg: 'bg.accent',
				color: 'text.inverse',
			},
		},
	},
	defaultVariants: {
		tone: 'neutral',
	},
});

type BadgeVariants = NonNullable<RecipeVariantProps<typeof badgeRecipe>>;

export interface BadgeProps extends BadgeVariants {
	className?: string;
	/** Pass-through `data-*` attributes for E2E/integration selectors. */
	[key: `data-${string}`]: string | number | boolean | undefined;
}

export function Badge({ children, className, tone, ...rest }: PropsWithChildren<BadgeProps>) {
	return (
		<span {...rest} className={cx(badgeRecipe({ tone }), className)}>
			{children}
		</span>
	);
}
