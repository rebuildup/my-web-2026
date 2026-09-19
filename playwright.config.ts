import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for my-web-2026.
 *
 * Tests cover two surfaces today:
 *   1. `e2e/smoke.spec.ts` — HTTP + home composition, runs against
 *      local `pnpm dev` (the default) or any deployed URL via
 *      `PLAYWRIGHT_BASE_URL`.
 *   2. `e2e/prod-smoke.spec.ts` — production-only smoke, runs via
 *      `pnpm run e2e:prod` (= `PLAYWRIGHT_BASE_URL=https://rebuildup.dev
 *      playwright test e2e/prod-smoke.spec.ts`). Triggers the GH
 *      Actions `production smoke` workflow on `workflow_dispatch`.
 *
 * The webServer block below starts `pnpm dev` automatically when
 * `PLAYWRIGHT_BASE_URL` points at localhost; for any deployed URL
 * (the canonical production URL `https://rebuildup.dev`, or the
 * debug-only `*.workers.dev` URL) the block is omitted so the
 * deployed Worker is assumed already live.
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
	// the local `pnpm dev` webServer is up, ignore it so the regular
	// `pnpm run e2e` (CI on push, local dev) does not DNS-fail against
	// a domain that may not be deployed yet.
	testIgnore: BASE_URL.startsWith('http://127.0.0.1') ? '**/prod-smoke.spec.ts' : undefined,
	// The local project spins up `pnpm dev` automatically. The smoke
	// project (run via PLAYWRIGHT_BASE_URL) must NOT start a server —
	// the deployed Worker is assumed to already be live.
	webServer: BASE_URL.startsWith('http://127.0.0.1')
		? {
				command: 'pnpm dev',
				url: BASE_URL,
				timeout: 60_000,
				reuseExistingServer: !process.env.CI,
			}
		: undefined,
});
