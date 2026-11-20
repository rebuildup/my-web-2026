import type { ElementType, ReactNode } from 'react';
import { cva, cx } from '../../../styled-system/css';
import type { FlowGap } from './Grid';
import { type FieldTone, type SectionTone, toneRebinds } from './tone-styles';

/**
 * Panel — the classified surface inside a section (ADR-0022 C-3,
 * layout-system.md §4.3).
 *
 * A Panel is never a section tone: it is one card / well / field
 * inside the section's grid. `variant` is the closed surface
 * vocabulary; callers never pick a background colour directly.
 * `field.*` variants re-bind ink to `mono.ink.onColour` inside the
 * panel subtree, the same mechanism `PageSection` uses for tones.
 *
 * The variant → surface map is a `cva` recipe, not a lookup record:
 * Panda resolves recipe variants statically, while a
 * `RECORD[prop]` indirection emits the class name with no rule
 * behind it — `field.*` cards rendered transparent until the map
 * moved here (Issue #1110).
 */

export type PanelVariant =
	| 'surface'
	| 'subtle'
	| 'plain'
	| 'inverse'
	| 'field.design'
	| 'field.code'
	| 'field.writing';

const panelRecipe = cva({
	base: {},
	variants: {
		variant: {
			surface: { backgroundColor: 'bg.surface' },
			subtle: { backgroundColor: 'bg.subtle' },
			plain: { backgroundColor: 'transparent' },
			// The ink plate inside a section — "this destination leaves
			// the site" as a card-scale statement (layout-system.md §4.2).
			inverse: { backgroundColor: 'bg.inverse' },
			'field.design': { backgroundColor: 'accent.field.design' },
			'field.code': { backgroundColor: 'accent.field.code' },
			'field.writing': { backgroundColor: 'accent.field.writing' },
		},
		padding: {
			'1': { padding: '1' },
			'2': { padding: '2' },
			'4': { padding: '4' },
			'6': { padding: '6' },
			'10': { padding: '10' },
			'16': { padding: '16' },
			'24': { padding: '24' },
			'32': { padding: '32' },
		},
		radius: {
			sm: { borderRadius: 'sm' },
			md: { borderRadius: 'md' },
			lg: { borderRadius: 'lg' },
		},
	},
	defaultVariants: {
		variant: 'surface',
		padding: '6',
		radius: 'md',
	},
});

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
	const tone: SectionTone =
		variant === 'inverse'
			? 'inverse'
			: variant.startsWith('field.')
				? (variant as FieldTone)
				: 'ground';
	const content = tone === 'ground' ? children : <div style={toneRebinds(tone)}>{children}</div>;
	return (
		<Tag {...rest} className={cx(panelRecipe({ variant, padding, radius }), className)}>
			{content}
		</Tag>
	);
}
