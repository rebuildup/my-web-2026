import type { PropsWithChildren } from 'react';
import { cva, cx, type RecipeVariantProps } from '../../../styled-system/css';

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
}

export function Badge({ children, className, tone }: PropsWithChildren<BadgeProps>) {
	return <span className={cx(badgeRecipe({ tone }), className)}>{children}</span>;
}
