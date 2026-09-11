import { defineConfig } from 'vitest/config';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

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
	},
});
