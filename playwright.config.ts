import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for my-web-2026.
 *
 * Tests cover these surfaces today:
 *   1. `e2e/smoke.spec.ts` — HTTP + home composition.
 *   2. `e2e/prod-smoke.spec.ts` — production-only smoke, runs via
 *      `pnpm run e2e:prod` (= `PLAYWRIGHT_BASE_URL=https://rebuildup.dev
 *      playwright test e2e/prod-smoke.spec.ts`). Triggers the GH
 *      Actions `production smoke` workflow on `workflow_dispatch`.
 *   3. `e2e/tools-index.spec.ts` — `/tools` index page contract.
 *   4. `e2e/tools-prototype.spec.ts` — `/tools/prototype` iframe
 *      contract against the **built** Tool artifact.
 *
 * The webServer block below spins up `pnpm preview` (= `vite preview`
 * against `dist/client/`) automatically when `PLAYWRIGHT_BASE_URL`
 * points at localhost. `pnpm preview` is required because the
 * Tool iframe spec asserts that the same-origin Tool artifact at
 * `/tools/<slug>/app/index.html` is reachable from the host — the
 * artifact only exists in `dist/client/` (produced by
 * `scripts/build-tools.mjs` after `vite build`), NOT under the dev
 * server. The CI workflow runs `pnpm run validate:integration` (which
 * includes `pnpm run build`) before invoking `pnpm run e2e`, so the
 * `dist/` tree is guaranteed to be present when Playwright starts.
 *
 * For any deployed URL (the canonical production URL
 * `https://rebuildup.dev`, or the debug-only `*.workers.dev` URL)
 * the block is omitted so the deployed Worker is assumed already live.
 *
 * Chromium only at 0.1.0. Firefox / WebKit land when a feature needs
 * them. Playwright's own browser binaries are installed via
 * `pnpm run e2e:install`; CI runs that step in the bootstrap.
 *
 * Canonical production URL policy: ADR-0014 / Issue #43. The
 * `*.workers.dev` URL is debug / infra only and is NOT documented
 * as canonical.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	expect: { timeout: 5_000 },
	fullyParallel: true,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 2 : undefined,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: {
		baseURL: BASE_URL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	// `prod-smoke.spec.ts` targets the canonical production origin
	// (`https://rebuildup.dev`) and only runs via `pnpm run e2e:prod`
	// or the GH Actions `production smoke` workflow — the operator
	// triggers it manually after `pnpm run deploy:production`. When
	// the local preview webServer is up, ignore it so the regular
	// `pnpm run e2e` (CI on push, local dev) does not DNS-fail against
	// a domain that may not be deployed yet.
	testIgnore: BASE_URL.startsWith('http://127.0.0.1') ? '**/prod-smoke.spec.ts' : undefined,
	// The local project spins up `pnpm preview` against the build
	// output automatically. `pnpm preview` is required because the
	// Tool iframe spec reaches into `dist/client/tools/<slug>/app/`
	// (the collected Tool artifact) and the dev server does NOT serve
	// those static files. The CI workflow already ran `pnpm run
	// build` (= `vite build` + `scripts/build-tools.mjs` +
	// `scripts/check-client-bundle.mjs`) before this step, so the
	// `dist/` tree is guaranteed to be present. For local dev, run
	// `pnpm run build` before `pnpm run e2e` (or rely on
	// `reuseExistingServer: !CI` if a preview is already up).
	webServer: BASE_URL.startsWith('http://127.0.0.1')
		? {
				command: `pnpm preview --port=${PORT}`,
				url: BASE_URL,
				timeout: 60_000,
				reuseExistingServer: !process.env.CI,
			}
		: undefined,
});
