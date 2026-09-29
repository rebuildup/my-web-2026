/**
 * Semantic design tokens for my-web-2026.
 *
 * These are registered with Panda CSS via `theme.semanticTokens` in
 * `panda.config.ts`. Components should consume the semantic layer
 * (e.g. `bg.canvas`, `text.default`, `border.subtle`) so the palette
 * can evolve without touching feature code.
 *
 * The `value` shape uses `{ value: '{token.path}' }` so Panda resolves
 * it against the raw token layer at codegen time.
 *
 * Light + dark variants:
 * Tokens introduced for Issue #172 use the `{ base, _dark }` shape so
 * the dark binding lands without touching feature code when dark mode
 * is enabled. Tokens that pre-date Issue #172 are mode-agnostic and
 * read correctly in both modes today.
 *
 * Keep this list short and stable. New semantic tokens are introduced
 * through an editorial visual-language decision.
 */
export const semanticTokens = {
	colors: {
		bg: {
			canvas: { value: '{colors.neutral.0}' },
			surface: { value: '{colors.neutral.50}' },
			subtle: { value: '{colors.neutral.100}' },
			accent: { value: '{colors.brand.500}' },
			inverse: { value: '{colors.neutral.900}' },
		},
		text: {
			default: { value: '{colors.neutral.900}' },
			muted: { value: '{colors.neutral.500}' },
			inverse: { value: '{colors.neutral.0}' },
			accent: { value: '{colors.brand.600}' },
		},
		border: {
			subtle: { value: '{colors.neutral.100}' },
			strong: { value: '{colors.neutral.500}' },
			focus: { value: '{colors.brand.500}' },
		},
		// Accent tokens (Issue #172). `surface` and `interactive` are
		// the two page-level accents; `positive` / `negative` /
		// `warning` carry status semantics; `category.{design,code,
		// writing,tool}` carry the four content categories that
		// portfolio and tool surfaces use as visual identifiers. All
		// variants are WCAG AA compliant against `bg.canvas` (light)
		// and `bg.inverse` (dark) — see src/editorial/colors.md.
		accent: {
			surface: {
				base: { value: '{colors.brand.50}' },
				_dark: { value: '{colors.brand.800}' },
			},
			interactive: {
				base: { value: '{colors.brand.600}' },
				_dark: { value: '{colors.brand.300}' },
			},
			positive: {
				base: { value: '{colors.positive.700}' },
				_dark: { value: '{colors.positive.300}' },
			},
			negative: {
				base: { value: '{colors.negative.700}' },
				_dark: { value: '{colors.negative.300}' },
			},
			warning: {
				base: { value: '{colors.warning.700}' },
				_dark: { value: '{colors.warning.300}' },
			},
			category: {
				design: {
					base: { value: '{colors.design.700}' },
					_dark: { value: '{colors.design.300}' },
				},
				code: {
					base: { value: '{colors.code.700}' },
					_dark: { value: '{colors.code.300}' },
				},
				writing: {
					base: { value: '{colors.writing.700}' },
					_dark: { value: '{colors.writing.300}' },
				},
				tool: {
					base: { value: '{colors.tool.700}' },
					_dark: { value: '{colors.tool.300}' },
				},
			},
		},
	},
} as const;

export type SemanticTokens = typeof semanticTokens;
