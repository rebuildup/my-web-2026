import type { ButtonHTMLAttributes, ElementType, ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';
import type { SystemStyleObject } from '../../../styled-system/types';

/**
 * Button — the only owner of control chrome (ADR-0022 C-6,
 * layout-system.md §8).
 *
 * `variant` is the closed vocabulary: `primary` is the ink operation
 * fill, `secondary`/`ghost` step through surface roles, `link` is a
 * control that reads as a link. Callers never restyle padding,
 * radius, background or border on a button-like element.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'link';
export type ButtonSize = 'sm' | 'md';

const VARIANT_STYLES: Record<ButtonVariant, SystemStyleObject> = {
	primary: {
		backgroundColor: 'bg.accent',
		color: 'text.inverse',
		_hover: { backgroundColor: 'accent.interactive', color: 'text.inverse' },
	},
	secondary: {
		backgroundColor: 'bg.surface',
		color: 'text.default',
		borderWidth: '1px',
		borderStyle: 'solid',
		borderColor: 'border.strong',
		_hover: { backgroundColor: 'bg.subtle' },
	},
	ghost: {
		backgroundColor: 'transparent',
		color: 'text.default',
		_hover: { backgroundColor: 'bg.subtle' },
	},
	link: {
		backgroundColor: 'transparent',
		color: 'text.accent',
		textDecoration: 'underline',
		_hover: { color: 'text.default' },
	},
};

const SIZE_STYLES: Record<ButtonSize, SystemStyleObject> = {
	sm: { paddingBlock: '2', paddingInline: '4', fontSize: 'sm' },
	md: { paddingBlock: '4', paddingInline: '6', fontSize: 'md' },
};

const BASE_STYLES = {
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: '2',
	borderRadius: 'md',
	fontFamily: 'sans',
	fontWeight: '600',
	lineHeight: '1',
	cursor: 'pointer',
	textDecoration: 'none',
	borderWidth: '0',
	borderStyle: 'solid',
	borderColor: 'transparent',
	_focusVisible: {
		outlineWidth: '2px',
		outlineStyle: 'solid',
		outlineColor: 'border.focus',
		outlineOffset: '2px',
	},
	_disabled: {
		backgroundColor: 'bg.subtle',
		color: 'text.muted',
		cursor: 'not-allowed',
	},
} satisfies SystemStyleObject;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
	/** Render as another element (e.g. `a` for a link-button). */
	as?: ElementType;
	/** Anchor target when `as="a"` — forwarded through `...rest`. */
	href?: string;
	/** Anchor `target` when `as="a"`. */
	target?: string;
	/** Anchor `rel` when `as="a"`. */
	rel?: string;
	children?: ReactNode;
}

export function Button({
	variant = 'primary',
	size = 'md',
	as,
	className,
	children,
	type,
	...rest
}: ButtonProps) {
	const Tag: ElementType = as ?? 'button';
	const isNativeButton = Tag === 'button';
	return (
		<Tag
			className={cx(
				css({
					...BASE_STYLES,
					...SIZE_STYLES[size],
					...VARIANT_STYLES[variant],
				}),
				className,
			)}
			type={isNativeButton ? (type ?? 'button') : type}
			{...rest}
		>
			{children}
		</Tag>
	);
}
