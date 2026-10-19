import { devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Viewport regression config (Issue #417).
 *
 * Separate from `playwright.config.ts` for the same reason
 * `playwright.compat.config.ts` is (Issue #415): the default config is
 * the chromium-only required gate that runs on every push to `main` /
 * `release-*`, and this suite asks a different question — not "does the
 * surface render" but "does the same surface still lay out correctly
 * at 390 / 768 / 1024 / 1440". The base config is spread in, so
 * `baseURL`, the local D1 bootstrap `webServer` and `globalSetup` are
 * inherited verbatim; there is no second server story to drift.
 *
 * Specs live in `e2e/viewport/**` and are excluded from the default
 * config through its `testIgnore` (Issue #417), so neither suite runs
 * the other.
 *
 * Chromium only, deliberately. The compat suite already answers the
 * engine question, and a pixel diff is only meaningful against a fixed
 * engine build: comparing raster output across three engines would
 * measure font rasterisation, which is the 誤検知 (false positive)
 * this gate must not have.
 *
 * `deviceScaleFactor: 1` is the layout contract, not a default: the
 * gate compares CSS pixels at every width, so a DPR-3 phone capture
 * would triple each raster without changing one measured box.
 *
 * Outputs:
 *   - `list`  — the human-readable log, same as the other suites.
 *   - `json`  — `.tmp/viewport-results.json`, the machine-readable
 *               result `scripts/make-viewport-diff-grid-report.mjs`
 *               renders and screenshots for the Issue's evidence.
 *   - `github`— annotations on the CI run, so a per-cell failure is
 *               visible in the PR checks list without opening logs.
 *   - `html`  — `playwright-report/` on CI only, uploaded by
 *               `.github/workflows/viewport.yml` for failure
 *               inspection.
 *
 * Local:
 *   pnpm run build                    # `vite preview` serves dist/client
 *   pnpm run e2e:install              # chromium binary
 *   pnpm run e2e:viewport
 *   pnpm run verify:viewport-diff-grid
 */
const JSON_REPORT = '.tmp/viewport-results.json';

const config: PlaywrightTestConfig = {
	...base,
	testDir: './e2e/viewport',
	// `base.testIgnore` carries `**/viewport/**` (Issue #417) so the
	// default suite does not run these specs. That glob would also
	// exclude them HERE, so it is replaced rather than inherited: the
	// viewport directory holds only `*.spec.ts`, none of which is a
	// production-only or D1-mutating spec.
	testIgnore: [],
	reporter: process.env.CI
		? [
				['github'],
				['list'],
				['json', { outputFile: JSON_REPORT }],
				['html', { open: 'never', outputFolder: 'playwright-report' }],
			]
		: [['list'], ['json', { outputFile: JSON_REPORT }]],
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				deviceScaleFactor: 1,
				viewport: { width: 1440, height: 900 },
			},
		},
	],
};

export default config;
