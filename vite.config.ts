import { resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
		},
	},
	build: {
		// `cloudflare:workers` is a workerd-only virtual module resolved by
		// `@cloudflare/vite-plugin` for the SSR environment. The
		// TanStack Start start-compiler-plugin extracts `createServerFn`
		// handler bodies into separate server-only chunks so the client
		// bundle never executes them — but Rollup still walks the import
		// graph and tries to resolve `cloudflare:workers` while it does.
		// Marking the specifier external for the client build keeps Rollup
		// from failing the resolve step; the corresponding server-only
		// module is never actually loaded in the browser bundle.
		rollupOptions: {
			external: ['cloudflare:workers'],
		},
	},
	server: {
		port: 3000,
		host: '127.0.0.1',
	},
});
