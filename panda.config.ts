import { defineConfig } from '@pandacss/dev';

/**
 * Panda CSS configuration for my-web-2026.
 *
 * Design tokens are organized as raw -> semantic so that we can migrate
 * the palette/typography without touching every component.
 *
 * Token semantics and recipes for individual features live next to the
 * feature (see `src/features/<feature>/styling.ts`).
 *
 * 0.1.0 Foundation only ships the raw token layer. Semantic tokens and
 * feature recipes are introduced in subsequent sprints.
 */
export default defineConfig({
	preflight: true,
	include: ['./src/**/*.{ts,tsx}'],
	exclude: [],
	jsxFramework: 'react',
	outdir: 'styled-system',

	theme: {
		extend: {
			breakpoints: {
				sm: '640px',
				md: '768px',
				lg: '1024px',
				xl: '1280px',
			},
			tokens: {
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
			},
		},
	},
});
