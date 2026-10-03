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
		brand: {
			50: { value: '#f0f9ff' },
			100: { value: '#e0f2fe' },
			300: { value: '#7dd3fc' },
			500: { value: '#0ea5e9' },
			600: { value: '#0284c7' },
			700: { value: '#0369a1' },
			800: { value: '#075985' },
			900: { value: '#0c4a6e' },
		},
		// Cooler slate neutrals keep the canvas crisp instead of grey-purple.
		neutral: {
			0: { value: '#ffffff' },
			50: { value: '#f8fafc' },
			100: { value: '#f1f5f9' },
			500: { value: '#64748b' },
			900: { value: '#0f172a' },
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
		// Category identifiers (Issue #172).
		// Used as left-border / pill-color cues on portfolio facets and
		// tool surfaces. Each family is a distinct hue at comparable
		// saturation so the four are visually separable at a glance.
		design: {
			50: { value: '#fdf2f8' },
			300: { value: '#f9a8d4' },
			500: { value: '#ec4899' },
			600: { value: '#db2777' },
			700: { value: '#be185d' },
		},
		code: {
			50: { value: '#ecfeff' },
			300: { value: '#67e8f9' },
			500: { value: '#06b6d4' },
			600: { value: '#0891b2' },
			700: { value: '#0e7490' },
		},
		writing: {
			50: { value: '#fefce8' },
			300: { value: '#fde047' },
			500: { value: '#eab308' },
			600: { value: '#ca8a04' },
			700: { value: '#a16207' },
		},
		tool: {
			50: { value: '#eef2ff' },
			300: { value: '#a5b4fc' },
			500: { value: '#6366f1' },
			600: { value: '#4f46e5' },
			700: { value: '#4338ca' },
		},
	},
	fonts: {
		// Body / UI default. Noto Sans JP is loaded via Google Fonts
		// (see src/routes/__root.tsx); the platform Japanese fallback
		// chain keeps first paint legible if the webfont request stalls.
		sans: {
			value: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", system-ui, sans-serif',
		},
		// Heading / display tier. Reserved for h1/h2/h3 and any
		// non-heading element that renders at font-size xl (24px) or
		// above — applied via :where(h1,h2,h3) in src/styles.css and
		// explicit `fontFamily: 'heading'` overrides where needed.
		heading: {
			value: '"Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", system-ui, sans-serif',
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
		'3xl': { value: '2.5rem' }, // 40 — section h2, footer `04` (mid display)
		// Display tier. Reserved for the Hero h1 only. See src/home/brief.md
		// (Issue #31) for the rationale.
		'4xl': { value: '4rem' }, // 64 — Hero h1, super display
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
