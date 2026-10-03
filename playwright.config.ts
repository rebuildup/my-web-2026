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

// `e2e/global-setup.ts` runs once before the webServer starts and
// applies the D1 migrations + skeleton seed to the local D1 binding.
// Without it the portfolio routes 500 on a fresh `.wrangler/state`
// because the `portfolio_project` table does not exist yet. Re-runs
// are idempotent (D1 migration tracking + INSERT OR IGNORE seed).
export default defineConfig({
	testDir: './e2e',
	// `globalSetup` applies the local D1 migrations + skeleton seed that
	// `pnpm preview` needs to serve the portfolio routes. Production runs
	// against `https://rebuildup.dev`, which already owns its D1 — the
	// local migration step is unnecessary and (worse) shells out to the
	// Cloudflare Workers Builds secret preflight when running under CI.
	// Skip it when the canonical production origin is the BASE_URL.
	globalSetup: BASE_URL.startsWith('http://127.0.0.1') ? './e2e/global-setup.ts' : undefined,
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
	// `prod-*.spec.ts` (production-only specs targeting the canonical
	// production origin `https://rebuildup.dev`) only run via the
	// dedicated production scripts — `pnpm run e2e:prod` (Smoke #2),
	// `pnpm run e2e:prod:transition` (Smoke #1), or
	// `pnpm run e2e:prod:portfolio` (post-publication G15) — or the
	// GH Actions `production smoke` workflow, which the operator
	// triggers manually after `pnpm run deploy:production`. When the
	// local preview webServer is up, ignore the `prod-*.spec.ts` glob
	// so the regular `pnpm run e2e` (CI on push, local dev) does not
	// DNS-fail against a domain that may not be deployed yet.
	//
	// `portfolio.spec.ts` likewise targets a local D1 binding: it
	// seeds draft / unlisted / archived rows into the local D1 and
	// asserts the public-visibility boundary. The local D1 file is
	// not addressable from a remote Worker deployment, so the spec
	// is filtered out of the production-only path.
	testIgnore: BASE_URL.startsWith('http://127.0.0.1')
		? '**/prod-*.spec.ts'
		: '**/portfolio.spec.ts',
	// The local project spins up `pnpm preview` against the build
	// output automatically. `pnpm preview` is required because the
	// Tool iframe spec reaches into `dist/client/tools/<slug>/app/`
	// (the collected Tool artifact) and the dev server does NOT serve
	// those static files. The CI workflow already ran `pnpm run
	// build` (= `vite build` + `scripts/build-tools.mjs` +
	// `scripts/check-client-bundle.mjs`) before this step, so the
	// `dist/` tree is guaranteed to be present. For local dev, run
	// `pnpm run build` before `pnpm run e2e` (or rely on
	// `reuseExistingServer: !CI` if a preview is already up). Local
	// previews use `pnpm preview` (= `vite preview` against
	// `dist/client/`), NOT `pnpm dev`.
	webServer: BASE_URL.startsWith('http://127.0.0.1')
		? {
				command: `pnpm preview --port=${PORT}`,
				url: BASE_URL,
				timeout: 60_000,
				reuseExistingServer: !process.env.CI,
			}
		: undefined,
});
