import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for my-web-2026.
 *
 * Tests cover a single surface today — the HTTP-only smoke in
 * `e2e/smoke.spec.ts`. The same checks work for the local
 * `pnpm dev` server and a deployed Worker; the only difference is
 * `PLAYWRIGHT_BASE_URL`. The webServer block below starts
 * `pnpm dev` automatically when `PLAYWRIGHT_BASE_URL` points at
 * localhost; when it points at a deployed URL (`*.workers.dev` or
 * similar) the block is omitted so the deployed Worker is assumed
 * already live.
 *
 * Chromium only at 0.1.0. Firefox / WebKit land when a feature needs
 * them. Playwright's own browser binaries are installed via
 * `pnpm run e2e:install`; CI runs that step in the bootstrap.
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
