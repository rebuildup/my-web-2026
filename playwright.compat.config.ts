import { devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Cross-engine compat config (Issue #415).
 *
 * Separate from `playwright.config.ts` on purpose. The default config
 * is the chromium-only gate that runs on every push to `main` /
 * `release-*`; multiplying it by three engines would triple that
 * gate's cost and mix "does the public surface work" with "does it
 * work in every engine". This config runs the same server contract
 * (base config is spread in, so `baseURL`, the local D1 bootstrap
 * `webServer` and `globalSetup` are inherited verbatim — there is no
 * second server story to drift) against three engines.
 *
 * Specs live in `e2e/compat/**` and are excluded from the default
 * config through its `testIgnore`, so neither suite runs the other.
 *
 * Outputs:
 *   - `list`  — the human-readable log, same as the default suite.
 *   - `json`  — `.tmp/compat-results.json`, the machine-readable
 *               matrix `scripts/make-compat-matrix-report.mjs` renders
 *               and screenshots for the Issue's required evidence.
 *   - `github`— annotations on the CI run, so a per-engine failure is
 *               visible in the PR checks list without opening logs.
 *
 * Local:
 *   pnpm run build            # `vite preview` serves dist/client
 *   pnpm run e2e:compat:install
 *   pnpm run e2e:compat
 */
const JSON_REPORT = '.tmp/compat-results.json';

const config: PlaywrightTestConfig = {
	...base,
	testDir: './e2e/compat',
	reporter: process.env.CI
		? [['github'], ['list'], ['json', { outputFile: JSON_REPORT }]]
		: [['list'], ['json', { outputFile: JSON_REPORT }]],
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } },
	],
};

export default config;
