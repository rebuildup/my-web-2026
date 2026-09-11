import type { PropsWithChildren } from 'react';
import { cva, cx, type RecipeVariantProps } from '../../../styled-system/css';

/**
 * Card — surface container.
 *
 * One elevation variant (flat | raised) and one tone variant (default |
 * accent). Used for grouping content in pages and modules.
 */
const cardRecipe = cva({
	base: {
		display: 'block',
		borderRadius: 'lg',
		border: '1px solid',
		borderColor: 'border.subtle',
		padding: '6',
		fontFamily: 'sans',
	},
	variants: {
		elevation: {
			flat: { boxShadow: 'none' },
			raised: { boxShadow: 'md' },
		},
		tone: {
			default: { bg: 'bg.surface', color: 'text.default' },
			accent: { bg: 'bg.canvas', color: 'text.default' },
		},
	},
	defaultVariants: {
		elevation: 'flat',
		tone: 'default',
	},
});

type CardVariants = NonNullable<RecipeVariantProps<typeof cardRecipe>>;

export interface CardProps extends CardVariants {
	className?: string;
}

export function Card({ children, className, elevation, tone }: PropsWithChildren<CardProps>) {
	return <div className={cx(cardRecipe({ elevation, tone }), className)}>{children}</div>;
}
