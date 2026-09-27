import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for client-side React tests.
 *
 * `vitest.config.ts` runs the workerd pool (Cloudflare bindings +
 * D1 + R2), which is required for the loader / schema / server-fn
 * integration tests but does NOT support a DOM environment — the
 * workerd pool runs without `window` / `document` and tries to
 * use Node's `vm.Script`, which conflicts with happy-dom's
 * environment shim.
 *
 * This config is a separate entry point used only by tests that
 * need to dispatch real DOM events (currently
 * `PortfolioMedia.client.test.tsx` — the image-load-failure
 * fallback). It uses happy-dom so React's synthetic event system
 * can deliver `error` to image elements without `document`
 * polyfilling itself.
 *
 * Run locally with `pnpm run test:client`. The default
 * `pnpm test` script does NOT invoke this config.
 *
 * Tests included: only files whose name ends in `.client.test.ts`
 * or `.client.test.tsx` — explicit opt-in so the rest of the
 * suite keeps running on the workerd pool.
 */
export default defineConfig({
	test: {
		include: ['src/**/*.client.test.ts', 'src/**/*.client.test.tsx'],
		exclude: ['node_modules', 'dist', 'dist-cloudflare', '.vinxi', '.output', '.wrangler'],
		environment: 'happy-dom',
	},
});
