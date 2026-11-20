import type { SystemStyleObject } from '../../../styled-system/types';

/**
 * Section / panel tone machinery (ADR-0022 §4.2, layout-system.md §4.2).
 *
 * A tone names a surface AND the ink that belongs on it. `PageSection`
 * and `Panel` re-bind the `--colors-*` custom properties Panda emits
 * for the semantic tokens inside their subtree, so every existing
 * component renders correct ink and surfaces on the tone without
 * knowing the tone exists.
 *
 * Only semantic-token vars are rebound — never raw palette vars — so
 * the rebinding stays valid when the palette is re-tuned. The
 * appearance flip is carried by the semantic tokens themselves
 * (`_dark` already resolved at the `:root` level); tones that need a
 * different *role* per appearance (inverse) pick roles that read
 * correctly on both plates.
 */

export type SectionTone =
	| 'ground'
	| 'sunken'
	| 'raised'
	| 'inverse'
	| 'field.design'
	| 'field.code'
	| 'field.writing'
	| 'field.tool';

export type FieldTone = Extract<SectionTone, `field.${string}`>;

/** The `backgroundColor` token a tone paints on its own element. */
export const TONE_BACKGROUND: Record<SectionTone, string> = {
	ground: 'bg.canvas',
	sunken: 'bg.subtle',
	raised: 'bg.surface',
	inverse: 'bg.inverse',
	'field.design': 'accent.field.design',
	'field.code': 'accent.field.code',
	'field.writing': 'accent.field.writing',
	'field.tool': 'bg.subtle',
};

/**
 * Variable rebinding per tone. `ground` rebinds nothing — the page
 * defaults already are the ground ladder.
 */
const TONE_REBINDS: Record<Exclude<SectionTone, 'ground'>, SystemStyleObject> = {
	// Recessed band. Panels keep `raised`; `subtle` wells step down to
	// `control` so they stay distinct from the band itself.
	sunken: {
		'--colors-bg-canvas': 'var(--colors-mono-surface-sunken)',
		'--colors-bg-subtle': 'var(--colors-mono-surface-control)',
		'--colors-mono-surface-ground': 'var(--colors-mono-surface-sunken)',
		'--colors-mono-surface-sunken': 'var(--colors-mono-surface-control)',
	},
	// Lifted band. `surface` panels step down to `control` so they
	// stay visible against the raised ground.
	raised: {
		'--colors-bg-canvas': 'var(--colors-mono-surface-raised)',
		'--colors-bg-surface': 'var(--colors-mono-surface-control)',
		'--colors-bg-subtle': 'var(--colors-mono-surface-sunken)',
		'--colors-mono-surface-ground': 'var(--colors-mono-surface-raised)',
		'--colors-mono-surface-raised': 'var(--colors-mono-surface-control)',
	},
	// Ink plate. Inverse ground carries `mono.ink.inverse` in both
	// appearances; surfaces step to `control` / `sunken`, the operation
	// fill swaps to the plate-contrasting ink, and its label swaps to
	// the plate colour so Button/TextLink stay correct inside.
	inverse: {
		'--colors-bg-canvas': 'var(--colors-mono-surface-inverse)',
		'--colors-bg-surface': 'var(--colors-mono-surface-control)',
		'--colors-bg-subtle': 'var(--colors-mono-surface-sunken)',
		'--colors-bg-accent': 'var(--colors-mono-ink-inverse)',
		'--colors-bg-inverse': 'var(--colors-mono-ink-inverse)',
		'--colors-mono-surface-ground': 'var(--colors-mono-surface-inverse)',
		'--colors-mono-surface-raised': 'var(--colors-mono-surface-control)',
		'--colors-text-default': 'var(--colors-mono-ink-inverse)',
		'--colors-text-muted': 'var(--colors-mono-ink-inverse)',
		'--colors-text-accent': 'var(--colors-mono-ink-inverse)',
		'--colors-text-inverse': 'var(--colors-mono-surface-inverse)',
		'--colors-mono-ink-text': 'var(--colors-mono-ink-inverse)',
		'--colors-mono-ink-secondary': 'var(--colors-mono-ink-inverse)',
		'--colors-mono-ink-muted': 'var(--colors-mono-ink-inverse)',
		'--colors-mono-ink-on-colour': 'var(--colors-mono-ink-inverse)',
		'--colors-mono-ink-on-colour-inverse': 'var(--colors-mono-ink-inverse)',
		'--colors-border-strong': 'var(--colors-mono-ink-inverse)',
		'--colors-border-focus': 'var(--colors-mono-ink-inverse)',
	},
	// Vivid classification field. `mono.ink.onColour` is the only ink
	// measured for a 500-step field; muted collapses to it because no
	// secondary-on-colour role exists (hierarchy via size/weight).
	// Surfaces, borders and the ink operation fill are untouched — a
	// primary Button stays an ink plate on the field.
	'field.design': {
		'--colors-text-default': 'var(--colors-mono-ink-on-colour)',
		'--colors-text-muted': 'var(--colors-mono-ink-on-colour)',
		'--colors-text-accent': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-text': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-secondary': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-muted': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-on-colour-inverse': 'var(--colors-mono-ink-on-colour)',
	},
	'field.code': {
		'--colors-text-default': 'var(--colors-mono-ink-on-colour)',
		'--colors-text-muted': 'var(--colors-mono-ink-on-colour)',
		'--colors-text-accent': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-text': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-secondary': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-muted': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-on-colour-inverse': 'var(--colors-mono-ink-on-colour)',
	},
	'field.writing': {
		'--colors-text-default': 'var(--colors-mono-ink-on-colour)',
		'--colors-text-muted': 'var(--colors-mono-ink-on-colour)',
		'--colors-text-accent': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-text': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-secondary': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-muted': 'var(--colors-mono-ink-on-colour)',
		'--colors-mono-ink-on-colour-inverse': 'var(--colors-mono-ink-on-colour)',
	},
	// Tool has no approved field step (colors.md); the tone is the
	// sunken band plus normal ink — identical rebinding to `sunken`.
	'field.tool': {
		'--colors-bg-canvas': 'var(--colors-mono-surface-sunken)',
		'--colors-bg-subtle': 'var(--colors-mono-surface-control)',
		'--colors-mono-surface-ground': 'var(--colors-mono-surface-sunken)',
		'--colors-mono-surface-sunken': 'var(--colors-mono-surface-control)',
	},
};

/**
 * The `css({...})` fragment that applies a tone's variable rebinding.
 * Spread into the element that OWNS the tone surface.
 */
export function toneRebinds(tone: SectionTone): SystemStyleObject {
	if (tone === 'ground') return {};
	return TONE_REBINDS[tone];
}
