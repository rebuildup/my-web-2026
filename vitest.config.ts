import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * Kept separate from `vite.config.ts` so the Cloudflare / TanStack Start
 * bundle isn't disturbed by Vitest-specific options.
 */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		exclude: ['node_modules', 'dist', '.vinxi', '.output', '.wrangler'],
	},
});
