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
	},
} as const;

export type SemanticTokens = typeof semanticTokens;
