/**
 * Semantic mapping over the raw Panda CSS tokens defined in
 * `panda.config.ts`. Components should consume **semantic** tokens
 * (`bg.surface`, `text.muted`, `border.subtle`, ...) so the palette
 * can evolve without touching feature code.
 *
 * Keep this list short and stable. New semantic tokens are introduced
 * through a design-system ADR.
 */
export const semanticTokens = {
	bg: {
		canvas: 'neutral.0',
		surface: 'neutral.50',
		subtle: 'neutral.100',
		accent: 'brand.500',
		inverse: 'neutral.900',
	},
	text: {
		default: 'neutral.900',
		muted: 'neutral.500',
		inverse: 'neutral.0',
		accent: 'brand.600',
	},
	border: {
		subtle: 'neutral.100',
		strong: 'neutral.500',
		focus: 'brand.500',
	},
	space: {
		xs: 1,
		sm: 2,
		md: 4,
		lg: 6,
		xl: 8,
	},
} as const;

export type SemanticTokens = typeof semanticTokens;
