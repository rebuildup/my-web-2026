/**
 * Raw design tokens for my-web-2026.
 *
 * `panda.config.ts` imports these via its `theme.extend.tokens` block.
 * Components should never reference raw tokens directly; consume the
 * semantic layer in `src/editorial/semantic-tokens.ts` instead.
 *
 * New tokens are introduced only when the editorial visual language owns the requirement.
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
		xs: { value: '0.75rem' },
		sm: { value: '0.875rem' },
		md: { value: '1rem' },
		lg: { value: '1.125rem' },
		xl: { value: '1.5rem' },
		'2xl': { value: '2rem' },
		// Display tier. Reserved for the hero heading, the spread
		// section heading, and the footer's numeric decoration. See
		// src/home/brief.md for the rationale (Issue #31).
		'3xl': { value: '2.5rem' },
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
		0: { value: '0' },
		1: { value: '4px' },
		2: { value: '8px' },
		3: { value: '12px' },
		4: { value: '16px' },
		6: { value: '24px' },
		8: { value: '32px' },
		12: { value: '48px' },
	},
} as const;

export type RawTokens = typeof rawTokens;
