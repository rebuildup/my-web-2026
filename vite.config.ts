import { resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

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

/**
 * Add `Access-Control-Allow-Origin: *` to every response under
 * `/tools/<slug>/app/*` from `vite preview` (local Tool iframe
 * testing). The production equivalent is the `_headers` file at
 * `public/_headers` (read by Cloudflare Workers Static Assets).
 *
 * Why this plugin exists:
 *
 * Tool iframes are sandboxed `allow-scripts` only (no
 * `allow-same-origin`). The iframe document therefore has an opaque
 * origin, and any `<script type="module">` and
 * `<link rel="stylesheet">` inside it becomes a CORS request — module
 * scripts are always fetched with CORS, even without the
 * `crossorigin` attribute. The default `vite preview` response does
 * not include `Access-Control-Allow-Origin`, so the browser blocks
 * the bundle and React never mounts. We scope the wildcard CORS to
 * `/tools/<slug>/app/*` only — the namespacing guarantees these are
 * same-origin Tool artefacts emitted by the Tool build orchestrator
 * (`scripts/build-tools.mjs`). The host's own `/assets/*` keeps its
 * default behaviour (same-origin module scripts from the host page,
 * no CORS).
 *
 * The hook runs in `configurePreviewServer` so the change applies to
 * `vite preview` only (NOT `vite dev` — the dev server does not serve
 * Tool artefacts; only `pnpm run build` produces
 * `dist/client/tools/<slug>/app/`).
 */
function toolCorsPreviewPlugin(): Plugin {
	return {
		name: 'my-web-2026:tool-cors-preview',
		apply: 'serve',
		configurePreviewServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = req.url ?? '';
				// Pattern matches both `/tools/<slug>/app/index.html`
				// and `/tools/<slug>/app/assets/...`. `<slug>` is a
				// single non-slash path component.
				if (/^\/tools\/[^/]+\/app(\/|$)/.test(url)) {
					res.setHeader('Access-Control-Allow-Origin', '*');
				}
				next();
			});
		},
	};
}

export default defineConfig({
	plugins: [
		cloudflareWorkersClientStub,
		toolCorsPreviewPlugin(),
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
