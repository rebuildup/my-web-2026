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
		brand: {
			50: { value: '#f5f7ff' },
			100: { value: '#e6ecff' },
			500: { value: '#3a6cff' },
			600: { value: '#2b54cc' },
			900: { value: '#0d1d4d' },
		},
		neutral: {
			0: { value: '#ffffff' },
			50: { value: '#f7f8fa' },
			100: { value: '#eef0f4' },
			500: { value: '#7a8194' },
			900: { value: '#0b1020' },
		},
	},
	fonts: {
		sans: { value: 'Inter, "Hiragino Kaku Gothic ProN", system-ui, sans-serif' },
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
