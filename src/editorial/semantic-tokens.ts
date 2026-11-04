/**
 * Semantic design tokens for my-web-2026.
 *
 * These are registered with Panda CSS via `theme.semanticTokens` in
 * `panda.config.ts`. Components should consume the semantic layer
 * (e.g. `bg.canvas`, `text.default`, `border.subtle`) so the palette
 * can evolve without touching feature code.
 *
 * Direction B — monochrome ground, colour on top (Issue #764 / #887)
 * ------------------------------------------------------------------
 * The owner's decision (2026-11-02, confirmed 2026-11-04) is that the
 * platform is a MONOCHROME design system with a colour layer placed on
 * it. This file is where that decision becomes the token layer:
 *
 *   - `bg.*`, `text.*` and `border.*` no longer point at the slate /
 *     charcoal ladders. They are PROJECTIONS of `mono.*`, the role
 *     scale in `tokens.ts#colors.mono`. A page surface, a raised card,
 *     a hairline, a body ink — each has one role, and the role is the
 *     same in every appearance.
 *   - The operational accent is INK, not brand blue: `bg.accent` and
 *     `bg.inverse` both resolve to the inverse ground, and their label
 *     is `text.inverse`. There is no coloured call to action.
 *   - `text.accent` is INK too. A link is distinguished by an
 *     UNDERLINE, not by a hue; painting body text in a family colour is
 *     the one thing direction B forbids outright.
 *   - Colour survives only in the classification layer
 *     (`accent.category.*` for a mark, `accent.field.*` for a field)
 *     and in the status data model (`accent.positive|negative|
 *     warning`), which is being replaced by "borrow the classification
 *     colour" in Issue #887.
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
 * The monochrome scale is designed per appearance, not inverted
 * (`tokens.ts#colors.mono`). Every binding below therefore names the
 * light role for `base` and the dark role for `_dark`, and the two
 * values are independent designs rather than reflections of each
 * other.
 *
 * Keep this list short and stable. New semantic tokens are introduced
 * through an editorial visual-language decision.
 */
export const semanticTokens = {
	colors: {
		// Page surfaces. The ground is achromatic and the hierarchy is
		// carried by FILL, not by decorative borders (direction B §3).
		// `canvas` is the page, `surface` a raised panel, `subtle` the
		// sunken well a table header or an inset block sits in.
		bg: {
			canvas: {
				value: { base: '{colors.mono.light.ground}', _dark: '{colors.mono.dark.ground}' },
			},
			surface: {
				value: { base: '{colors.mono.light.raised}', _dark: '{colors.mono.dark.raised}' },
			},
			subtle: {
				value: { base: '{colors.mono.light.sunken}', _dark: '{colors.mono.dark.sunken}' },
			},
			// The operation fill. A call to action is INK: the inverse
			// ground with `text.inverse` on it (17.9 : 1 light / 17.6 : 1
			// dark). There is no coloured CTA in direction B.
			accent: {
				value: {
					base: '{colors.mono.light.inverseGround}',
					_dark: '{colors.mono.dark.inverseGround}',
				},
			},
			// A self-contained inverse panel; kept as its own token
			// because a dark plate can appear on any ground and must not
			// be confused with the operation fill at a call site.
			inverse: {
				value: {
					base: '{colors.mono.light.inverseGround}',
					_dark: '{colors.mono.dark.inverseGround}',
				},
			},
		},
		text: {
			default: {
				value: { base: '{colors.mono.light.text}', _dark: '{colors.mono.dark.text}' },
			},
			// The auxiliary ink. Issue #399's 4.5 : 1 rule still governs
			// every surface it lands on; the gate measures it.
			muted: {
				value: { base: '{colors.mono.light.muted}', _dark: '{colors.mono.dark.muted}' },
			},
			// INK, not a hue. Direction B keeps text achromatic; a link
			// earns its affordance from an underline. Call sites that
			// relied on this token to say "this is interactive" must
			// carry `textDecoration: 'underline'` at rest.
			accent: {
				value: { base: '{colors.mono.light.text}', _dark: '{colors.mono.dark.text}' },
			},
			// Labels on the operation fill / inverse plate.
			inverse: {
				value: {
					base: '{colors.mono.light.inverseText}',
					_dark: '{colors.mono.dark.inverseText}',
				},
			},
		},
		border: {
			// Decorative separator. Excluded from the non-text contrast
			// matrix for the same stated reason as before: it carries no
			// information of its own.
			subtle: {
				value: { base: '{colors.mono.light.hairline}', _dark: '{colors.mono.dark.hairline}' },
			},
			// The rule that IDENTIFIES a boundary; measured at 3 : 1.
			strong: {
				value: { base: '{colors.mono.light.rule}', _dark: '{colors.mono.dark.rule}' },
			},
			// Focus is ink. A focus ring is a boundary a keyboard user
			// has to find, so it uses the strongest ink rather than a
			// brand hue.
			focus: {
				value: { base: '{colors.mono.light.text}', _dark: '{colors.mono.dark.text}' },
			},
		},
		// Monochrome layer (Issue #764, direction B).
		//
		// The 11 roles the comparison harness established (page / sunken /
		// raised / control surface, hairline / rule, auxiliary / secondary
		// / body / disabled ink, inverse ground), plus the two lines a
		// colour field needs.
		//
		// `ink.onColour` is the role that makes the colour layer
		// possible: a coloured field is read through a monochrome ink
		// token instead of an ink chosen per render. `onColour` is for
		// a vivid field (the 500 step), `onColourInverse` for a deep one
		// (700–800). The contrast gate measures both against
		// `accent.field.*` (`scripts/check-a11y-contrast.mjs`).
		mono: {
			surface: {
				ground: {
					value: { base: '{colors.mono.light.ground}', _dark: '{colors.mono.dark.ground}' },
				},
				sunken: {
					value: { base: '{colors.mono.light.sunken}', _dark: '{colors.mono.dark.sunken}' },
				},
				raised: {
					value: { base: '{colors.mono.light.raised}', _dark: '{colors.mono.dark.raised}' },
				},
				control: {
					value: { base: '{colors.mono.light.control}', _dark: '{colors.mono.dark.control}' },
				},
				inverse: {
					value: {
						base: '{colors.mono.light.inverseGround}',
						_dark: '{colors.mono.dark.inverseGround}',
					},
				},
				disabled: {
					value: {
						base: '{colors.mono.light.disabledSurface}',
						_dark: '{colors.mono.dark.disabledSurface}',
					},
				},
			},
			line: {
				hairline: {
					value: { base: '{colors.mono.light.hairline}', _dark: '{colors.mono.dark.hairline}' },
				},
				rule: {
					value: { base: '{colors.mono.light.rule}', _dark: '{colors.mono.dark.rule}' },
				},
			},
			ink: {
				text: {
					value: { base: '{colors.mono.light.text}', _dark: '{colors.mono.dark.text}' },
				},
				secondary: {
					value: {
						base: '{colors.mono.light.secondary}',
						_dark: '{colors.mono.dark.secondary}',
					},
				},
				muted: {
					value: { base: '{colors.mono.light.muted}', _dark: '{colors.mono.dark.muted}' },
				},
				disabled: {
					value: {
						base: '{colors.mono.light.disabledText}',
						_dark: '{colors.mono.dark.disabledText}',
					},
				},
				inverse: {
					value: {
						base: '{colors.mono.light.inverseText}',
						_dark: '{colors.mono.dark.inverseText}',
					},
				},
				onColour: {
					value: {
						base: '{colors.mono.light.onColour}',
						_dark: '{colors.mono.dark.onColour}',
					},
				},
				onColourInverse: {
					value: {
						base: '{colors.mono.light.onColourInverse}',
						_dark: '{colors.mono.dark.onColourInverse}',
					},
				},
			},
		},
		// Accent tokens. Under direction B the only colours on the page
		// are the content classifications: `category.*` is the step a
		// MARK is read at, `field.*` the step a FIELD is read at. Both
		// are measured by the contrast gate.
		//
		// `surface` and `interactive` survive as neutral roles so a
		// featured region or a pressed fill does not have to reach for a
		// raw palette value: `surface` is the sunken well (a neutral
		// featured region), `interactive` is the ink fill's hover step.
		//
		// `positive` / `negative` / `warning` are a TRANSITIONAL
		// re-anchoring, not a status hue. Direction B says a status
		// borrows the colour of the classification it belongs to — never
		// green / red / amber. A field error has no classification to
		// borrow from, so its fallback is ink plus a shape plus a word.
		// Binding these three to `mono.ink.text` removes the last hue
		// from the platform in one edit instead of one component at a
		// time, and keeps every existing call site legible while Issue
		// #887 converts it. The tokens are then deleted, consumer by
		// consumer, in the same PR: an alias that outlives its last
		// consumer is dead weight, not a contract.
		accent: {
			surface: {
				value: { base: '{colors.mono.light.sunken}', _dark: '{colors.mono.dark.raised}' },
			},
			interactive: {
				value: {
					base: '{colors.mono.light.secondary}',
					_dark: '{colors.mono.dark.secondary}',
				},
			},
			positive: {
				value: { base: '{colors.mono.light.text}', _dark: '{colors.mono.dark.text}' },
			},
			negative: {
				value: { base: '{colors.mono.light.text}', _dark: '{colors.mono.dark.text}' },
			},
			warning: {
				value: { base: '{colors.mono.light.text}', _dark: '{colors.mono.dark.text}' },
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
			// The approved colour layer (Issue #764, 2026-11-04).
			//
			// `category.*` is the STEP a small non-text mark is read at
			// (700 in light, because a mark on the ground must clear
			// 3 : 1). `field.*` is the STEP a classification colour is
			// read at when it spans a surface: the 500 step, which is
			// the value the owner approved on `/design-system`. Both
			// appearances bind the same step — a colour field does not
			// change value with the reader's appearance; the monochrome
			// ink placed on it does (`mono.ink.onColour`).
			field: {
				design: {
					value: { base: '{colors.design.500}', _dark: '{colors.design.500}' },
				},
				code: {
					value: { base: '{colors.code.500}', _dark: '{colors.code.500}' },
				},
				writing: {
					value: { base: '{colors.writing.500}', _dark: '{colors.writing.500}' },
				},
			},
		},
	},
} as const;

export type SemanticTokens = typeof semanticTokens;
