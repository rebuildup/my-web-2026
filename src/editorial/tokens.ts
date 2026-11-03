/**
 * Raw design tokens for my-web-2026.
 *
 * `panda.config.ts` imports these via its `theme.extend.tokens` block.
 * Components should never reference raw tokens directly; consume the
 * semantic layer in `src/editorial/semantic-tokens.ts` instead.
 *
 * Issue #31 — golden-ratio scale revision. The type and spacing
 * scales are designed to make a 1:1.618 jump between adjacent
 * tiers the dominant rhythm. Small clusters live at `4`/`8`;
 * page-level beats sit at `64`/`96`. The contrast between the
 * smallest and largest values is dramatic — that contrast is the
 * editorial voice.
 */
export const rawTokens = {
	breakpoints: {
		sm: '640px',
		md: '768px',
		lg: '1024px',
		xl: '1280px',
	},
	colors: {
		// High-chroma sky/cyan brand ramp (Issue #201).
		// 500 is the visual signature; accessible text / CTA roles use
		// the darker 700–800 steps through the semantic layer.
		//
		// 950 (Issue #290) is the dark counterpart of the 50 tint: a
		// near-black step carrying only a sky whisper, so
		// `surface.feature` reads as "a barely blue featured region" in
		// both appearances. It is deliberately NOT Tailwind's
		// sky-950 (`#082f49`) — that value is a saturated navy block,
		// which on a neutral dark page reads as exactly the heavy
		// colored surface the dark rework removed.
		brand: {
			50: { value: '#f0f9ff' },
			100: { value: '#e0f2fe' },
			300: { value: '#7dd3fc' },
			500: { value: '#0ea5e9' },
			600: { value: '#0284c7' },
			700: { value: '#0369a1' },
			800: { value: '#075985' },
			900: { value: '#0c4a6e' },
			950: { value: '#151b26' },
		},
		// Cooler slate neutrals keep the canvas crisp instead of grey-purple.
		// This is the light appearance only: the slate ramp is
		// blue-dominant at its dark end (`neutral.900` has B−R = 39),
		// so painting dark surfaces with it produced a monotone navy
		// page. The dark appearance uses `charcoal` instead.
		//
		// Issue #764 (direction B) reads the ramp as a surface ladder:
		// 100 (sunken) → 50 (canvas) → 25 (raised), with pure white
		// (`0`) reserved for ink. `200` is the structural divider —
		// one step above the sunken fill so a rule stays visible on
		// every surface tier.
		neutral: {
			0: { value: '#ffffff' },
			// 25 (Issue #812) — the raised surface step. Pure white
			// (`0`) is retired as a SURFACE value: the page ground uses
			// `50` instead and `25` is the card / panel tier.
			25: { value: '#fcfcfd' },
			50: { value: '#f8fafc' },
			100: { value: '#f1f5f9' },
			200: { value: '#e2e8f0' },
			500: { value: '#64748b' },
			// 600 (Issue #399) — the step the muted text needed in the
			// light appearance. `neutral.500` measured 4.34:1 on
			// `neutral.100` and 4.46:1 on `brand.50`, both under the
			// 4.5:1 SC 1.4.3 minimum, and no lighter or darker step of
			// this ramp could fix it: `neutral.900` is the body colour
			// and everything above 500 is lighter. 600 keeps the same
			// slate hue and the same saturation ladder — only the
			// lightness moves — so the "quiet secondary text"
			// character survives the repair.
			600: { value: '#475569' },
			900: { value: '#0f172a' },
		},
		// Near-neutral dark ladder (Issue #290 rework, Linear-referenced).
		//
		// Sampled from linear.app under `colorScheme: dark`: canvas
		// `#08090a`, surfaces `#0f1011` / `#161718` / `#191a1b`,
		// hairlines `#18191a` → `#202122` → `#37393a`, secondary text
		// `#8a8f98`. Every one of those is close to achromatic — their
		// hierarchy comes from near-black layers plus hairlines, with
		// brand color reserved for accents.
		//
		// These steps keep a cool whisper (B−R ≈ 3–4, versus slate
		// 900's 39) so the dark appearance still belongs to the same
		// cool-slate product, but rests on neutral near-black layers.
		// Step spacing mirrors the light ladder: 1000 → 950 → 900 → 800 is
		// the same "one notch per tier" relationship as 100 → 50 → 25,
		// read upward (depth = a brighter layer) instead of downward.
		// Issue #764 adds `1000` below the canvas so a recessed surface
		// has somewhere to go; 950 → 900 → 800 remain the raised ladder.
		charcoal: {
			1000: { value: '#050609' }, // sunken — recessed page region
			950: { value: '#0a0b0e' }, // canvas — page background
			900: { value: '#111317' }, // raised surface
			800: { value: '#191b21' }, // control fill + hairline divider
			600: { value: '#6f747d' }, // emphasis rule / disabled text
			400: { value: '#8b9099' }, // secondary text (6.14 : 1 on canvas)
		},
		// Status colors (Issue #172).
		// 50 = light-tinted surface fill, 300 = dark-mode foreground,
		// 600/700 = light-mode foreground. WCAG AA verified against
		// neutral.0 / neutral.900 — see src/editorial/colors.md.
		positive: {
			50: { value: '#ecfdf5' },
			300: { value: '#6ee7b7' },
			500: { value: '#10b981' },
			600: { value: '#059669' },
			700: { value: '#047857' },
		},
		negative: {
			50: { value: '#fff1f2' },
			300: { value: '#fda4af' },
			500: { value: '#f43f5e' },
			600: { value: '#e11d48' },
			700: { value: '#be123c' },
		},
		warning: {
			50: { value: '#fffbeb' },
			300: { value: '#fcd34d' },
			500: { value: '#f59e0b' },
			600: { value: '#d97706' },
			700: { value: '#b45309' },
		},
		// Content hues (Issue #764, direction B).
		//
		// These ramps are named for the HUE, not for a category. Which
		// category receives which hue is decided by `content-signal.ts`
		// from the category id, deterministically, so a category can be
		// re-pointed at another family without touching the palette and
		// the palette can gain a family without inventing a category.
		// 700 is the light-appearance text step, 300 the dark one.
		rose: {
			50: { value: '#fdf2f8' },
			300: { value: '#f9a8d4' },
			500: { value: '#ec4899' },
			600: { value: '#db2777' },
			700: { value: '#be185d' },
		},
		cyan: {
			50: { value: '#ecfeff' },
			300: { value: '#67e8f9' },
			500: { value: '#06b6d4' },
			600: { value: '#0891b2' },
			700: { value: '#0e7490' },
		},
		amber: {
			50: { value: '#fefce8' },
			300: { value: '#fde047' },
			500: { value: '#eab308' },
			600: { value: '#ca8a04' },
			700: { value: '#a16207' },
		},
	},
	fonts: {
		// Body / UI default. Noto Sans JP is loaded via Google Fonts
		// (see src/routes/__root.tsx); the platform Japanese fallback
		// chain keeps first paint legible if the webfont request stalls.
		//
		// The `… Fallback` entry is the metric-compatible face defined
		// at the top of `src/styles.css` (Issue #485): the SAME local
		// font the chain already names, scaled so the pre-swap fallback
		// occupies the same space as the webfont. Without it the swap
		// re-wrapped rows that sit within ~1% of their wrap threshold
		// (desktop nav, hero CTAs) and moved everything below them.
		sans: {
			value:
				'"Noto Sans JP", "Noto Sans JP Fallback", "Hiragino Kaku Gothic ProN", system-ui, sans-serif',
		},
		// Heading / display tier. Reserved for h1/h2/h3 and any
		// non-heading element that renders at font-size xl (24px) or
		// above — applied via :where(h1,h2,h3) in src/styles.css and
		// explicit `fontFamily: 'heading'` overrides where needed.
		heading: {
			value:
				'"Zen Kaku Gothic New", "Zen Kaku Gothic New Fallback", "Hiragino Kaku Gothic ProN", system-ui, sans-serif',
		},
		mono: { value: '"JetBrains Mono", ui-monospace, monospace' },
	},
	fontSizes: {
		// 8-step scale. Major tiers jump at ≈1.618x.
		// body (md 16) → subhead (xl 24, ×1.5) → heading (3xl 40, ×1.67) → display (4xl 64, ×1.6).
		xs: { value: '0.75rem' }, // 12 — mono caption, label
		sm: { value: '0.875rem' }, // 14 — body support
		md: { value: '1rem' }, // 16 — body
		lg: { value: '1.125rem' }, // 18 — lead body
		xl: { value: '1.5rem' }, // 24 — subhead, card h3
		'2xl': { value: '2rem' }, // 32 — footer identity, large subhead
		'3xl': { value: '2.5rem' }, // 40 — section h2 (mid display)
		// Display tier. On the home surface the consumer is the Footer `04`
		// decoration only — the Hero h1 renders the identity mark since
		// Issue #287. See src/home/brief.md (Issue #31) for the rationale.
		'4xl': { value: '4rem' }, // 64 — super display (home: Footer `04`)
	},
	radii: {
		sm: { value: '4px' },
		md: { value: '8px' },
		lg: { value: '16px' },
		full: { value: '9999px' },
	},
	shadows: {
		sm: { value: '0 1px 2px rgba(11, 16, 32, 0.06)' },
		md: { value: '0 4px 12px rgba(11, 16, 32, 0.08)' },
	},
	spacing: {
		// Whitespace scale — values step at ≈1.618x so the contrast
		// between small clusters and page-level beats is dramatic.
		// (4 → 8 → 16 → 24 → 40 → 64 → 96 → 128)
		0: { value: '0' },
		1: { value: '4px' }, // decoration on title, ordinal gap
		2: { value: '8px' }, // tight cluster, sibling gap
		4: { value: '16px' }, // cluster close, body block end
		6: { value: '24px' }, // cluster separator, column gap
		10: { value: '40px' }, // section block end, list gap
		16: { value: '64px' }, // section padding
		24: { value: '96px' }, // page-level beat
		32: { value: '128px' }, // hero entry breath
	},
} as const;

export type RawTokens = typeof rawTokens;

/**
 * The spacing ramp on its own (Issue #812).
 *
 * `rawTokens` is one object literal, so a consumer that imports it
 * keeps the WHOLE palette — every colour ramp — in the client bundle:
 * a bundler cannot split an exported object literal across its
 * consumers. The `/design-system` spacing ruler needs the spacing
 * steps and nothing else, so the ramp is published as its own export;
 * a consumer that imports ONLY this keeps the colour ramps out of the
 * browser bundle (the palette now reaches the browser nowhere — the
 * colour section resolves its hex pairs on the server).
 *
 * The values are the same objects; this is a projection, not a copy.
 */
export const spacingTokens = rawTokens.spacing;

/**
 * The two `theme-color` steps (Issue #764).
 *
 * `src/routes/__root.tsx` carries two `<meta name="theme-color">`
 * entries — one per appearance — because the browser paints its own
 * chrome before any CSS runs. A meta content value cannot be a
 * `var(--colors-…)` reference, so the two steps must reach the
 * document as literal hex. Reading them from here rather than
 * re-typing them keeps the browser chrome on the same `surface.canvas`
 * steps the semantic layer uses (`neutral.25` / `charcoal.950`); a
 * palette change moves both together.
 *
 * This is the same projection shape as `spacingTokens`: importing it
 * keeps the rest of the palette out of the client bundle.
 */
export const themeColorTokens = {
	light: rawTokens.colors.neutral[25].value,
	dark: rawTokens.colors.charcoal[950].value,
} as const;
