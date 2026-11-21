import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';

/**
 * ToggleChip — the catalogue filter chip (Issue #1109).
 *
 * `FacetFilter` and `ViewSwitcher` drew the same pill-toggle button
 * twice (ADR-0022 C-7: a repeated control literal is a missing
 * primitive). This component owns the chip chrome for both: a
 * `borderRadius: full` toggle whose active state is carried by
 * `aria-pressed` — surface fill when idle, ink fill when selected —
 * never by hue alone (the caller still renders its own check glyph).
 *
 * `tone="clear"` is the dashed dismiss affordance (`Clear`), which
 * is a sibling action, not a toggle, so it carries no `aria-pressed`.
 */
export interface ToggleChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	/** Selected state for `tone="toggle"`; rendered as `aria-pressed`. */
	active?: boolean;
	/** Optional secondary label (mono / uppercase sublabel). */
	sublabel?: string;
	/** `clear` renders the dashed dismiss chip instead of a toggle. */
	tone?: 'toggle' | 'clear';
	children?: ReactNode;
}

const chipBase = css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '2',
	height: '8',
	paddingInline: '4',
	borderRadius: 'full',
	borderWidth: '1px',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	cursor: 'pointer',
	transition: 'background-color 120ms ease, color 120ms ease',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

const chipToggle = css({
	borderStyle: 'solid',
	'&[aria-pressed="true"]': {
		borderColor: 'border.strong',
		backgroundColor: 'bg.accent',
		color: 'text.inverse',
	},
	'&[aria-pressed="false"]': {
		borderColor: 'border.subtle',
		backgroundColor: 'bg.surface',
		color: 'text.default',
	},
});

const chipClear = css({
	borderStyle: 'dashed',
	borderColor: 'border.subtle',
	backgroundColor: 'transparent',
	color: 'text.muted',
});

const sublabelStyle = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
});

const sublabelActive = css({ color: 'text.inverse' });
const sublabelIdle = css({ color: 'text.muted' });

export function ToggleChip({
	active = false,
	sublabel,
	tone = 'toggle',
	className,
	type = 'button',
	children,
	...rest
}: ToggleChipProps) {
	const isClear = tone === 'clear';
	return (
		<button
			{...rest}
			type={type}
			aria-pressed={isClear ? undefined : active}
			className={cx(chipBase, isClear ? chipClear : chipToggle, className)}
		>
			{!isClear ? <span aria-hidden="true">{active ? '✓' : ''}</span> : null}
			<span>{children}</span>
			{sublabel ? (
				<span
					aria-hidden="true"
					className={cx(sublabelStyle, !isClear && active ? sublabelActive : sublabelIdle)}
				>
					{sublabel}
				</span>
			) : null}
		</button>
	);
}
