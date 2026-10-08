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

	/**
	 * Dark condition (Issue #290).
	 *
	 * Panda's built-in `dark` condition is `.dark &` — a class-scoped
	 * switch that requires an app-managed toggle. my-web-2026 follows
	 * the OS preference instead (a theme toggle is explicitly out of
	 * scope for Issue #290), so `dark` is redefined here as the
	 * `prefers-color-scheme` media query. Every `_dark` variant in
	 * `theme.semanticTokens` then activates when the visitor's system
	 * is in dark mode, with no runtime class management.
	 *
	 * The overriding is deliberate and local: `conditions` merges the
	 * user entry over the preset entry of the same name, so all other
	 * built-in conditions (hover, focus, motion, …) keep their preset
	 * definitions.
	 */
	conditions: {
		dark: '@media (prefers-color-scheme: dark)',
	},

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
			// Keyframes used by the access-counter digit swap
			// (`src/home/access/tiles.tsx`). Each digit image slides up
			// from below with a per-digit stagger, evoking a mechanical
			// counter rolling to its value. The animation is opt-out via
			// `prefers-reduced-motion: reduce` at the component level
			// (the styles.css `@media` block).
			keyframes: {
				counterDigitRoll: {
					'0%': { transform: 'translateY(60%)', opacity: '0' },
					'60%': { opacity: '1' },
					'100%': { transform: 'translateY(0)', opacity: '1' },
				},
			},
		},
	},
});
