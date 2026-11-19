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
				// Issue #316: the current-projects change marker. One
				// run, opacity + a 4px lift only — no layout property,
				// so the row's height cannot move while it plays.
				currentLocationChange: {
					'0%': { transform: 'translateY(4px)', opacity: '0' },
					'100%': { transform: 'translateY(0)', opacity: '1' },
				},
				// The companion character's greeting (`src/editorial/pet/
				// PetSprite.tsx`, Issue #274). The strip holds four
				// 96 px-wide frames, so translating it by three frame
				// widths (-75 % of a 384 px strip) and stepping with
				// `steps(4, jump-none)` lands exactly on frames 1, 2, 3
				// and 4 — no blank cell, and the final step holds the
				// last pose instead of sliding past it.
				petReaction: {
					from: { transform: 'translateX(0)' },
					to: { transform: 'translateX(-75%)' },
				},
				// Travel strip for the drag (`running-left.webp` /
				// `running-right.webp`, Issue #274). Eight 96 px frames in
				// a 768 px strip: -87.5 % is seven frame widths, so
				// `steps(8, jump-none)` shows each frame once and holds
				// the last one. One keyframe serves both directions
				// because only the image differs.
				petRun: {
					from: { transform: 'translateX(0)' },
					to: { transform: 'translateX(-87.5%)' },
				},
				// Issue #1044 — the resting idle loop
				// (`idle.webp`, `src/editorial/pet/PetSprite.tsx`). Six
				// 96 px frames in a 576 px strip: -83.3333 % is five
				// frame widths, so `steps(6, jump-none)` lands on each
				// frame once and the infinite loop returns to the
				// breathing frame.
				petIdle: {
					from: { transform: 'translateX(0)' },
					to: { transform: 'translateX(-83.3333%)' },
				},
				// Issue #925 — the home ad units. The entrance variants
				// animate transform / clip-path only, never opacity: an
				// opacity fade leaves every descendant blended toward
				// the page background while it plays, which the axe
				// color-contrast scan reads as a real violation
				// (composer.stories.tsx#AllReachable / #Degraded).
				// `adPulse` is the slow attention breath on in-creative
				// chrome (play button, TRY IT badge) — scale only, for
				// the same reason. All of them opt out at render time
				// through `usePrefersReducedMotion` and at the
				// stylesheet layer through their `data-motion` hooks.
				adReveal: {
					'0%': { transform: 'translateY(14px)' },
					'100%': { transform: 'translateY(0)' },
				},
				adPulse: {
					'0%, 100%': { transform: 'scale(1)' },
					'50%': { transform: 'scale(1.06)' },
				},
				// Issue #925 — per-format entrance variants. Real ad
				// surfaces do not animate every unit identically: a
				// masthead banner drops in from above, a feed card
				// rises, a carousel slides, a display rectangle wipes,
				// a store card pops. No variant animates opacity — a
				// translucent entrance blends every descendant toward the
				// page background and the axe color-contrast scan reads
				// it as a violation. The `ad-reveal` data-motion hook
				// covers all of them — the variant changes HOW the unit
				// arrives, never WHAT it says.
				adDrop: {
					'0%': { transform: 'translateY(-18px)' },
					'100%': { transform: 'translateY(0)' },
				},
				adSlideLeft: {
					'0%': { transform: 'translateX(-22px)' },
					'100%': { transform: 'translateX(0)' },
				},
				adSlideRight: {
					'0%': { transform: 'translateX(22px)' },
					'100%': { transform: 'translateX(0)' },
				},
				adScaleIn: {
					'0%': { transform: 'scale(0.96)' },
					'100%': { transform: 'scale(1)' },
				},
				adPop: {
					'0%': { transform: 'scale(0.9)' },
					'70%': { transform: 'scale(1.02)' },
					'100%': { transform: 'scale(1)' },
				},
				adWipeLeft: {
					'0%': { clipPath: 'inset(0 100% 0 0)' },
					'100%': { clipPath: 'inset(0 0 0 0)' },
				},
			},
		},
	},
});
