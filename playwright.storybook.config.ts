import { devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

/**
 * Storybook axe-core audit config (Issue #392).
 *
 * Separate from `playwright.config.ts` for the same reason
 * `playwright.compat.config.ts` and `playwright.viewport.config.ts`
 * are separate (Issues #415 / #417): the default config is the
 * chromium-only required gate that runs on every push, and this suite
 * asks a different question — not "does the surface render" but "does
 * the independent component a designer iterates on violate WCAG 2.2
 * A / AA".
 *
 * The base config is NOT spread in here, and that is deliberate. The
 * base config owns the application preview server (`webServer` → the
 * local D1 bootstrap) and the `globalSetup` that verifies it; this
 * suite measures STORYBOOK, which is a different server with a
 * different lifecycle. Inheriting the base config would start the
 * application preview for a run that never opens an application page.
 *
 * The Storybook server is started by the caller:
 *
 *   - `scripts/capture-a11y-axe-storybook.mjs` starts it on loopback
 *     and then runs this suite against it;
 *   - a developer can start `pnpm run storybook` and run this suite by
 *     hand with `STORYBOOK_BASE_URL` set.
 *
 * When no Storybook is reachable, the suite FAILS instead of skipping.
 * A skipped audit reports "0 stories measured" with exit code 0, which
 * reads like a pass — the silent green this Issue exists to prevent.
 *
 * Chromium only, deliberately: the compat suite (Issue #415) already
 * answers the engine question, and an accessibility audit that changed
 * its verdict with the engine would be a gate nobody could trust.
 *
 * The spec lives in `e2e/a11y/` and is excluded from the default
 * config's `testIgnore` only by its own file name — the default config
 * runs every spec under `e2e/` except the production-only ones, so
 * this file is listed in `testIgnore` there to keep the two suites
 * apart.
 *
 * Local:
 *   pnpm run storybook                       # in one terminal
 *   STORYBOOK_BASE_URL=http://localhost:6006 pnpm run a11y:axe-storybook:e2e
 *   pnpm run capture:a11y-axe-storybook      # starts Storybook itself
 */
const config: PlaywrightTestConfig = {
	testDir: './e2e/a11y',
	testMatch: 'axe-storybook.spec.ts',
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: true,
	retries: process.env.CI ? 1 : 0,
	workers: process.env.CI ? 2 : undefined,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: {
		baseURL: (process.env.STORYBOOK_BASE_URL ?? 'http://localhost:6006').replace(/\/$/, ''),
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
};

export default config;
