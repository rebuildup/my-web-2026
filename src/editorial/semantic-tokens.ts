/**
 * Semantic design tokens for my-web-2026.
 *
 * These are registered with Panda CSS via `theme.semanticTokens` in
 * `panda.config.ts`. Components should consume the semantic layer
 * (e.g. `bg.canvas`, `text.default`, `border.subtle`) so the palette
 * can evolve without touching feature code.
 *
 * Light + dark variants (Issue #290). Every token carries a
 * `{ value: { base, _dark } }` value so Panda emits one CSS custom
 * property per appearance and rebinds it under the `dark` condition.
 * `panda.config.ts` redefines that condition as
 * `@media (prefers-color-scheme: dark)`, so the dark binding follows
 * the visitor's OS preference with no toggle and no runtime class.
 *
 * The `value: { … }` wrapper is required by Panda's semantic-token
 * grammar — a bare `{ base, _dark }` object parses as an extra layer
 * of *token path* rather than as conditions, and the resulting
 * utilities resolve to a literal string (invalid CSS) instead of a
 * var reference. Keep the wrapper.
 *
 * Dark values rest on the near-neutral `charcoal` ladder
 * (`tokens.ts`) rather than on slate's blue-dominant dark tail —
 * sampled dark UIs build hierarchy from near-black layers plus
 * hairlines and reserve brand color for accents, which is what Issue
 * #290's rework moved us toward.
 *
 * Four tokens bind `_dark` to the same value as `base` on purpose:
 * `bg.inverse` / `text.inverse` are a self-contained
 * surface+foreground pair (an inverse panel and the white label that
 * sits on it, including every `bg.accent` CTA label), and
 * `bg.accent` / `accent.interactive` are the primary-action fill and
 * its pressed state — the pair carries both the CTA and the
 * `Badge tone="accent"` live/active signal, and both appearances
 * have to keep white text at ≥ 4.5 : 1 *and* the fill at ≥ 3 : 1 from
 * the page, which leaves essentially one usable step of the brand
 * ramp. Those are decisions, not omissions — see
 * `src/editorial/colors.md`.
 *
 * Keep this list short and stable. New semantic tokens are introduced
 * through an editorial visual-language decision.
 */
export const semanticTokens = {
	colors: {
		bg: {
			canvas: {
				value: { base: '{colors.neutral.0}', _dark: '{colors.charcoal.950}' },
			},
			surface: {
				value: { base: '{colors.neutral.50}', _dark: '{colors.charcoal.900}' },
			},
			subtle: {
				value: { base: '{colors.neutral.100}', _dark: '{colors.charcoal.800}' },
			},
			// Static: the CTA fill stays on the dark brand steps so the
			// white `text.inverse` label keeps ≥ 4.5:1 in both modes.
			accent: {
				value: { base: '{colors.brand.700}', _dark: '{colors.brand.700}' },
			},
			// Static: inverse surface + white label travel together.
			inverse: {
				value: { base: '{colors.neutral.900}', _dark: '{colors.neutral.900}' },
			},
		},
		text: {
			default: {
				value: { base: '{colors.neutral.900}', _dark: '{colors.neutral.50}' },
			},
			muted: {
				value: { base: '{colors.neutral.500}', _dark: '{colors.charcoal.400}' },
			},
			// Static: labels sit on `bg.accent`, which never lightens.
			inverse: {
				value: { base: '{colors.neutral.0}', _dark: '{colors.neutral.0}' },
			},
			accent: {
				value: { base: '{colors.brand.700}', _dark: '{colors.brand.500}' },
			},
		},
		border: {
			subtle: {
				value: { base: '{colors.neutral.100}', _dark: '{colors.charcoal.800}' },
			},
			// Dark drops the slate cast (neutral.500 is B−R = 39) for a
			// near-neutral step so emphasis rules read as hairlines in
			// the same low-chroma family as the rest of the dark
			// chrome. Still 4.19 : 1 on the dark canvas, above the 3:1
			// non-text minimum.
			strong: {
				value: { base: '{colors.neutral.500}', _dark: '{colors.charcoal.600}' },
			},
			focus: {
				value: { base: '{colors.brand.600}', _dark: '{colors.brand.300}' },
			},
		},
		// Accent tokens (Issue #172, audited in Issue #290). `surface`
		// and `interactive` are the two page-level accents; `positive` /
		// `negative` / `warning` carry status semantics; `category.{design,
		// code, writing, tool}` carry the four content categories that
		// portfolio and tool surfaces use as visual identifiers. All
		// variants are WCAG AA compliant against `bg.canvas` (light) and
		// `bg.canvas` (dark) — see src/editorial/colors.md.
		accent: {
			// The light step is a barely-blue tint on white; the dark
			// step is its darkest-sky counterpart rather than a mid
			// blue, so the "featured region" reads as a tint in both
			// appearances and keeps `text.muted` legible on top of it.
			surface: {
				value: { base: '{colors.brand.50}', _dark: '{colors.brand.950}' },
			},
			// Always a fill *beneath* `text.inverse` (hero CTA, composer
			// CTA, the interactive-state demo), so both appearances stay
			// on the dark brand steps. Issue #172 bound `_dark` to
			// brand.300, which put white text on light cyan at ~1.5:1.
			interactive: {
				value: { base: '{colors.brand.800}', _dark: '{colors.brand.800}' },
			},
			positive: {
				value: { base: '{colors.positive.700}', _dark: '{colors.positive.300}' },
			},
			negative: {
				value: { base: '{colors.negative.700}', _dark: '{colors.negative.300}' },
			},
			warning: {
				value: { base: '{colors.warning.700}', _dark: '{colors.warning.300}' },
			},
			category: {
				design: {
					value: { base: '{colors.design.700}', _dark: '{colors.design.300}' },
				},
				code: {
					value: { base: '{colors.code.700}', _dark: '{colors.code.300}' },
				},
				writing: {
					value: { base: '{colors.writing.700}', _dark: '{colors.writing.300}' },
				},
				tool: {
					value: { base: '{colors.tool.700}', _dark: '{colors.tool.300}' },
				},
			},
		},
	},
} as const;

export type SemanticTokens = typeof semanticTokens;
