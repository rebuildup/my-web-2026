import type { PropsWithChildren } from 'react';
import { cva, cx, type RecipeVariantProps } from '../../../styled-system/css';

/**
 * Button — primary interactive primitive.
 *
 * Three variants (primary / secondary / ghost) and two sizes (md / sm).
 * Variant and size are Panda recipe variants; consumers use the
 * generated `button({ variant, size })` style helper.
 */
const buttonRecipe = cva({
	base: {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '2',
		borderRadius: 'md',
		fontFamily: 'sans',
		fontWeight: '600',
		cursor: 'pointer',
		border: '1px solid transparent',
		transition: 'background-color 120ms ease, border-color 120ms ease',
		_focusVisible: {
			outline: '2px solid {colors.border.focus}',
			outlineOffset: '2px',
		},
		_disabled: {
			opacity: '0.5',
			cursor: 'not-allowed',
		},
	},
	variants: {
		variant: {
			primary: {
				bg: 'bg.accent',
				color: 'text.inverse',
				_hover: { bg: 'colors.brand.600' },
			},
			secondary: {
				bg: 'bg.surface',
				color: 'text.default',
				borderColor: 'border.subtle',
				_hover: { bg: 'bg.subtle' },
			},
			ghost: {
				bg: 'transparent',
				color: 'text.accent',
				_hover: { bg: 'bg.subtle' },
			},
		},
		size: {
			md: { h: '10', px: '4', fontSize: 'md' },
			sm: { h: '8', px: '3', fontSize: 'sm' },
		},
	},
	defaultVariants: {
		variant: 'primary',
		size: 'md',
	},
});

type ButtonVariants = NonNullable<RecipeVariantProps<typeof buttonRecipe>>;

export interface ButtonProps extends ButtonVariants {
	type?: 'button' | 'submit' | 'reset';
	disabled?: boolean;
	className?: string;
	onClick?: () => void;
}

export function Button({
	children,
	type = 'button',
	disabled,
	className,
	onClick,
	variant,
	size,
}: PropsWithChildren<ButtonProps>) {
	return (
		<button
			type={type}
			disabled={disabled}
			onClick={onClick}
			className={cx(buttonRecipe({ variant, size }), className)}
		>
			{children}
		</button>
	);
}
