import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Vite configuration for my-web-2026.
 *
 * Stack:
 *   - @cloudflare/vite-plugin    -> Cloudflare Workers bundling for `vite build`
 *   - @tanstack/react-start/plugin/vite -> SSR / file-based routes / server functions
 *   - @vitejs/plugin-react       -> React JSX transform
 *
 * Panda CSS styling is consumed via the `styled-system` package generated
 * by `pnpm prepare` (see panda.config.ts).
 *
 * Vitest lives in `vitest.config.ts`; production Vite is deliberately
 * kept free of test-only types.
 */
export default defineConfig({
	plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart(), react()],
	resolve: {
		alias: {
			'~': resolve(__dirname, './src'),
			'@modules': resolve(__dirname, './src/modules'),
			'@design-system': resolve(__dirname, './src/design-system'),
			'@platform': resolve(__dirname, './src/platform'),
		},
	},
	server: {
		port: 3000,
		host: '127.0.0.1',
	},
});
