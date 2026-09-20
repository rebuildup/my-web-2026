import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for my-web-2026.
 *
 * Plugins are the **workerd-aware subset** of `vite.config.ts`:
 *   - `cloudflareTest()` provides the Workers test pool (`SELF`,
 *     `env`, real bindings) and reads `wrangler.jsonc`.
 *   - `tanstackStart()` is required so that the worker bundle resolves
 *     `#tanstack-router-entry` / `#tanstack-start-entry` virtual modules
 *     when workerd pulls in `src/server.ts`.
 *
 * `@cloudflare/vite-plugin` is intentionally **not** included here:
 * vitest runs in its own Vite environment and only needs to bundle the
 * Worker once per session to feed workerd.
 *
 * Tests:
 *   - `src/**\/*.{test,spec}.{ts,tsx}`           — Hono unit smoke
 *   - `test/integration/**\/*.{test,spec}.{ts,tsx}` — D1 / R2 SELF smoke
 *
 * Both kinds run inside workerd; bindings are real (D1 / R2 / ASSETS).
 */
export default defineConfig({
	plugins: [tanstackStart(), cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
	test: {
		include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/integration/**/*.{test,spec}.{ts,tsx}'],
		exclude: ['node_modules', 'dist', 'dist-cloudflare', '.vinxi', '.output', '.wrangler'],
		// Apply the canonical Better Auth + auth_invitation schema to
		// the local D1 binding BEFORE any test file is loaded. The
		// Better Auth module eagerly validates its schema at import
		// time and caches the verdict — see test/setup/better-auth-schema.ts.
		setupFiles: ['./test/setup/better-auth-schema.ts'],
	},
});
