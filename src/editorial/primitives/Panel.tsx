import type { ElementType, ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';
import type { FlowGap } from './Grid';
import { type FieldTone, TONE_BACKGROUND, toneRebinds } from './tone-styles';

/**
 * Panel — the classified surface inside a section (ADR-0022 C-3,
 * layout-system.md §4.3).
 *
 * A Panel is never a section tone: it is one card / well / field
 * inside the section's grid. `variant` is the closed surface
 * vocabulary; callers never pick a background colour directly.
 * `field.*` variants re-bind ink to `mono.ink.onColour` inside the
 * panel subtree, the same mechanism `PageSection` uses for tones.
 */

export type PanelVariant =
	| 'surface'
	| 'subtle'
	| 'plain'
	| 'field.design'
	| 'field.code'
	| 'field.writing';

const PANEL_BACKGROUND: Record<PanelVariant, string> = {
	surface: 'bg.surface',
	subtle: 'bg.subtle',
	plain: 'transparent',
	'field.design': TONE_BACKGROUND['field.design'],
	'field.code': TONE_BACKGROUND['field.code'],
	'field.writing': TONE_BACKGROUND['field.writing'],
};

export interface PanelProps {
	variant?: PanelVariant;
	/** Inner spacing from the rhythm set (default `6` = 24px). */
	padding?: FlowGap;
	/** Corner radius (default `md`). */
	radius?: 'sm' | 'md' | 'lg';
	as?: ElementType;
	className?: string;
	children?: ReactNode;
	/** Pass-through `data-*` attributes for E2E/integration selectors. */
	[key: `data-${string}`]: string | number | boolean | undefined;
}

export function Panel({
	variant = 'surface',
	padding = '6',
	radius = 'md',
	as,
	className,
	children,
	...rest
}: PanelProps) {
	const Tag: ElementType = as ?? 'div';
	const tone: FieldTone | 'ground' = variant.startsWith('field.')
		? (variant as FieldTone)
		: 'ground';
	return (
		<Tag
			{...rest}
			className={cx(
				css({
					backgroundColor: PANEL_BACKGROUND[variant],
					borderRadius: radius,
					padding,
					...toneRebinds(tone),
				}),
				className,
			)}
		>
			{children}
		</Tag>
	);
}
