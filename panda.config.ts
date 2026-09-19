import { defineConfig } from '@pandacss/dev';
import { semanticTokens } from './src/editorial/semantic-tokens';
import { rawTokens } from './src/editorial/tokens';

/**
 * Panda CSS configuration for the currently shipped editorial visual language.
 *
 * Additional visual languages are introduced only when a surface has an
 * independently observed design obligation; they are not pre-created here.
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
