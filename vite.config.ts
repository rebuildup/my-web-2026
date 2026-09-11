/// <reference types="vitest" />
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
 * Vitest-specific options live in `vitest.config.ts` to keep the production
 * Cloudflare bundle free of test-only code.
 */
export default defineConfig({
	plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart(), react()],
	resolve: {
		alias: {
			'~': resolve(__dirname, './src'),
			'@features': resolve(__dirname, './src/features'),
			'@domains': resolve(__dirname, './src/domains'),
			'@boundary': resolve(__dirname, './src/boundary'),
			'@infra': resolve(__dirname, './src/infra'),
		},
	},
	server: {
		port: 3000,
		host: '127.0.0.1',
	},
});
