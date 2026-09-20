import { resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Vite configuration for my-web-2026.
 *
 * Stack:
 *   - @cloudflare/vite-plugin    -> Cloudflare Workers bundling for `vite build`
 *   - @tanstack/react-start/plugin/vite -> SSR / file-based routes / server functions
 *   - @vitejs/plugin-react       -> React JSX transform
 *   - cloudflareWorkersClientStub (below) -> resolves `cloudflare:workers`
 *                                            to a stub for non-SSR envs
 *
 * Panda CSS styling is consumed via the `styled-system` package generated
 * by `pnpm prepare` (see panda.config.ts).
 *
 * Vitest lives in `vitest.config.ts`; production Vite is deliberately
 * kept free of test-only types.
 */

/**
 * Map `cloudflare:workers` to a frozen empty stub for any environment
 * that is NOT the workerd-backed SSR one. See
 * `src/cloudflare/workers-stub.ts` for the full rationale.
 */
const cloudflareWorkersClientStub: Plugin = {
	name: 'cloudflare-workers-client-stub',
	enforce: 'pre',
	resolveId(source) {
		if (source !== 'cloudflare:workers') return null;
		// `this.environment.name` is the per-environment identifier set
		// by Vite 7's environment API. The cloudflare() plugin below
		// configures the SSR environment as `name: 'ssr'` (so workerd
		// provides `cloudflare:workers` natively there). For every
		// other environment — including Vite's default `client` and any
		// future environments — return the stub path so import-analysis
		// can walk the import without throwing
		// `Failed to resolve import "cloudflare:workers"`.
		const envName = this.environment?.name;
		if (envName === 'ssr') {
			return null; // let workerd / the cloudflare plugin resolve
		}
		return resolve(__dirname, 'src/cloudflare/workers-stub.ts');
	},
};

export default defineConfig({
	plugins: [
		cloudflareWorkersClientStub,
		cloudflare({ viteEnvironment: { name: 'ssr' } }),
		tanstackStart(),
		react(),
	],
	resolve: {
		alias: {
			'~': resolve(__dirname, './src'),
		},
	},
	server: {
		port: 3000,
		host: '127.0.0.1',
	},
});
