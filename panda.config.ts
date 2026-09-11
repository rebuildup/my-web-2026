import { defineConfig } from '@pandacss/dev';
import { rawTokens } from './src/design-system/tokens';
import { semanticTokens } from './src/design-system/semantic-tokens';

/**
 * Panda CSS configuration for my-web-2026.
 *
 * Design tokens live under `src/design-system/`:
 *   - `tokens.ts`          raw palette / typography / spacing / radii / shadows
 *   - `semantic-tokens.ts` bg / text / border semantic layer
 *
 * Components reference the semantic layer only. Feature recipes and
 * component primitives are added per-module under
 * `src/modules/<capability>/styling.ts` when needed (see ADR-0005).
 */
export default defineConfig({
	preflight: true,
	include: ['./src/**/*.{ts,tsx}'],
	exclude: [],
	jsxFramework: 'react',
	outdir: 'styled-system',

	theme: {
		extend: {
			breakpoints: rawTokens.breakpoints,
			tokens: {
				colors: rawTokens.colors,
				fonts: rawTokens.fonts,
				fontSizes: rawTokens.fontSizes,
				radii: rawTokens.radii,
				shadows: rawTokens.shadows,
				spacing: rawTokens.spacing,
			},
			semanticTokens,
		},
	},
});
