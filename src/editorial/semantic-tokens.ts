/**
 * Semantic design tokens for my-web-2026.
 *
 * These are registered with Panda CSS via `theme.semanticTokens` in
 * `panda.config.ts`. Components consume this layer, never the raw
 * palette in `tokens.ts`, so the palette can move without touching
 * feature code.
 *
 * Direction B — MONOCHROME / SIGNAL (Issue #764)
 * ----------------------------------------------
 * The owner selected direction B on 2026-11-02 with one correction:
 * the result must not be a system where only one colour (yellow) can
 * be used. So this layer has two halves and they answer different
 * questions.
 *
 *   MONOCHROME (`surface.*` / `text.*` / `border.*`)
 *     The page is built from a neutral ladder. Separation comes from
 *     the fill of a surface, not from a decorative border. The eleven
 *     roles the direction harness studied live here: page ground,
 *     sunken face, raised face, pressable face, hairline, strong
 *     rule, supplementary / secondary / body text, inverse ground,
 *     disabled. Two of them are collapsed into one token where the
 *     shipped system does not need two tiers (`text.muted` covers
 *     both secondary and supplementary text), and `border.divider`
 *     is a STRUCTURAL rule only — it may not be used for decoration.
 *
 *   SIGNAL (`signal.*`)
 *     Saturated colour is a signal, never a surface. `signal.action`
 *     is the single operation hue; `signal.positive` / `negative` /
 *     `warning` are status; `signal.content.*` are content hues
 *     assigned deterministically from a category or slug by
 *     `content-signal.ts`. There is no "category colour" token: a
 *     category asks the assignment rule for a family, so adding a
 *     category never means inventing a colour and re-pointing one
 *     never means editing the palette.
 *
 * A signal is always accompanied by a non-colour cue (a word, a
 * `StateMark` silhouette, an icon). Colour alone is never the
 * message. Colour is placed as one line / one word / one pill per
 * screen, never as a large fill, and the measured colour area of a
 * screen stays under 5%.
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
 * (`tokens.ts`) rather than on slate's blue-dominant dark tail. The
 * light and dark ladders are NOT inversions of each other: each is
 * composed from its own ground, and `25` / `1000` are the two extra
 * steps that let a raised or sunken tier exist on either side.
 *
 * Static bindings are decisions, not omissions:
 *
 *   - `surface.inverse` / `text.inverse` are a self-contained
 *     surface + foreground pair (an inverse panel and the white label
 *     that sits on it).
 *   - `signal.action` / `signal.actionActive` are the primary-action
 *     fill and its pressed state. Both appearances stay on the dark
 *     brand steps so the white `text.inverse` label keeps ≥ 4.5 : 1
 *     AND the fill keeps ≥ 3 : 1 against the page. The dark
 *     appearance cannot lighten this fill without breaking one of
 *     the two. `text.accent` carries the LINK ink instead, and does
 *     lighten in the dark appearance, because text has no white
 *     label to protect.
 *
 * Keep this list short and stable. New semantic tokens are introduced
 * through an editorial visual-language decision.
 */
export const semanticTokens = {
	colors: {
		surface: {
			// The page ground. Light sits on slate-50, not pure white;
			// `neutral.25` is the raised tier instead (Issue #812).
			canvas: {
				value: { base: '{colors.neutral.50}', _dark: '{colors.charcoal.950}' },
			},
			// A recessed region: table header, inset block, quiet band.
			// Always a step INTO the ground in both appearances.
			sunken: {
				value: { base: '{colors.neutral.100}', _dark: '{colors.charcoal.1000}' },
			},
			// A card / panel above the ground. Always a step OUT of it.
			raised: {
				value: { base: '{colors.neutral.25}', _dark: '{colors.charcoal.900}' },
			},
			// A pressable fill. It is not a fixed direction: the fill
			// gains contrast against the ground, which means a darker
			// step in the light appearance and a lighter one in dark.
			// This is the role a control uses instead of a border.
			control: {
				value: { base: '{colors.neutral.200}', _dark: '{colors.charcoal.800}' },
			},
			// Static: inverse plate + white label travel together.
			inverse: {
				value: { base: '{colors.neutral.900}', _dark: '{colors.neutral.900}' },
			},
			// A barely-tinted featured region. This is NOT a signal and
			// never a large saturated fill: brand.50 / brand.950 carry
			// only enough chroma to separate the region from the ground
			// (below the 5% colour-area measurement threshold).
			feature: {
				value: { base: '{colors.brand.50}', _dark: '{colors.brand.950}' },
			},
		},
		text: {
			default: {
				value: { base: '{colors.neutral.900}', _dark: '{colors.neutral.50}' },
			},
			// Secondary and supplementary text share one tier (Issue
			// #399: the light step is neutral.600, because neutral.500
			// measured 4.34 : 1 on the sunken fill, under the 4.5 : 1
			// SC 1.4.3 minimum for normal text).
			muted: {
				value: { base: '{colors.neutral.600}', _dark: '{colors.charcoal.400}' },
			},
			// Inactive text. Disabled controls are exempt from SC 1.4.3,
			// so this step is chosen to READ as inactive rather than to
			// pass; the measured ratio is still recorded in
			// `src/editorial/colors.md`.
			disabled: {
				value: { base: '{colors.neutral.500}', _dark: '{colors.charcoal.600}' },
			},
			// Static: labels sit on the inverse plate / action fill,
			// which never lighten.
			inverse: {
				value: { base: '{colors.neutral.0}', _dark: '{colors.neutral.0}' },
			},
			// Link ink. It lightens in the dark appearance (brand.500,
			// 7.10 : 1) so body-sized link text stays AA; the action
			// FILL cannot do that because it carries a white label.
			accent: {
				value: { base: '{colors.brand.700}', _dark: '{colors.brand.500}' },
			},
		},
		border: {
			// A STRUCTURAL rule: a table row, a data boundary, a
			// definition list where a rule carries meaning. Never a
			// section decoration — direction B separates surfaces by
			// fill alone.
			divider: {
				value: { base: '{colors.neutral.200}', _dark: '{colors.charcoal.800}' },
			},
			// An emphasis rule / non-text boundary that must reach the
			// 3 : 1 SC 1.4.11 minimum (4.55 : 1 light, 4.19 : 1 dark on
			// the canvas).
			strong: {
				value: { base: '{colors.neutral.500}', _dark: '{colors.charcoal.600}' },
			},
			// A focus indicator, not a surface divider. 3.91 : 1 light,
			// 11.80 : 1 dark against the canvas.
			focus: {
				value: { base: '{colors.brand.600}', _dark: '{colors.brand.300}' },
			},
		},
		signal: {
			// The ONE operation hue. Always a fill beneath
			// `text.inverse`.
			action: {
				value: { base: '{colors.brand.700}', _dark: '{colors.brand.700}' },
			},
			actionActive: {
				value: { base: '{colors.brand.800}', _dark: '{colors.brand.800}' },
			},
			// Status. Each is paired with a word or a StateMark
			// silhouette; colour alone never carries the state.
			positive: {
				value: { base: '{colors.positive.700}', _dark: '{colors.positive.300}' },
			},
			negative: {
				value: { base: '{colors.negative.700}', _dark: '{colors.negative.300}' },
			},
			warning: {
				value: { base: '{colors.warning.700}', _dark: '{colors.warning.300}' },
			},
			// Content-derived hues. Which seed (category, slug) receives
			// which family is decided by `content-signal.ts`, not here;
			// the order is the stable assignment order. Exactly three
			// families (Issue #812, colour system III): a Tool has no
			// colour face, so there is no fourth role to fall back to.
			content: {
				rose: {
					value: { base: '{colors.rose.700}', _dark: '{colors.rose.300}' },
				},
				cyan: {
					value: { base: '{colors.cyan.700}', _dark: '{colors.cyan.300}' },
				},
				amber: {
					value: { base: '{colors.amber.700}', _dark: '{colors.amber.300}' },
				},
			},
		},
	},
} as const;

export type SemanticTokens = typeof semanticTokens;
