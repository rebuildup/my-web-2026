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

// The local D1 state (`.tmp/d1state`) must be migrated and seeded
// BEFORE the preview server starts serving from it. That work runs in
// `scripts/e2e-local-bootstrap.mjs`, wired in as the `webServer.command`
// below — NOT in `globalSetup`.
//
// The reason is ordering, and the ordering is not what the two hooks'
// names suggest. Playwright runs the webServer plugin's `setup()` —
// which boots the server and waits for its URL — and only then loads
// any `globalSetup` file. See `createGlobalSetupTasks` in
// `playwright@1.63.0` `lib/runner/index.js`. Migrating from
// `globalSetup` therefore runs a schema migration against a state
// directory workerd is already serving, which is how
// `release-0-6-0` spent eight commits on a 600s `spawnSync pnpm
// ETIMEDOUT` (Issue #262).
export default defineConfig({
	testDir: './e2e',
	// `globalSetup` no longer prepares anything — it VERIFIES that the
	// pre-server bootstrap produced the schema the specs need, and
	// throws if it did not. Production runs against
	// `https://rebuildup.dev`, which already owns its D1 and has no
	// local state directory to check, so it is skipped there.
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
	// The local project spins up the preview server automatically.
	// `pnpm preview` is required because the Tool iframe spec reaches
	// into `dist/client/tools/<slug>/app/` (the collected Tool artifact)
	// and the dev server does NOT serve those static files. The CI
	// workflow already ran `pnpm run build` (= `vite build` +
	// `scripts/build-tools.mjs` + `scripts/check-client-bundle.mjs`)
	// before this step, so the `dist/` tree is guaranteed to be present.
	// For local dev, run `pnpm run build` before `pnpm run e2e` (or rely
	// on `reuseExistingServer: !CI` if a preview is already up). Local
	// previews use `pnpm preview` (= `vite preview` against
	// `dist/client/`), NOT `pnpm dev`.
	//
	// `e2e-local-bootstrap.mjs` migrates + seeds `.tmp/d1state` and then
	// execs `pnpm preview --port=${PORT}`. It is here rather than in
	// `globalSetup` because this is the only hook guaranteed to run
	// before the server binds. If the migration fails, the bootstrap
	// exits non-zero without starting the server, the URL never becomes
	// ready, and Playwright fails the run — the gate stays red rather
	// than quietly running against an unprepared database (Issue #262).
	webServer: BASE_URL.startsWith('http://127.0.0.1')
		? {
				command: `node scripts/e2e-local-bootstrap.mjs --port=${PORT}`,
				url: BASE_URL,
				timeout: 60_000,
				reuseExistingServer: !process.env.CI,
			}
		: undefined,
});
