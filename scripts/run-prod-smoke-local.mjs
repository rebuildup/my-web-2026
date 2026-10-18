/**
 * Run the production smoke spec against a LOCAL preview build.
 *
 * `pnpm run e2e:prod:local` is the Issue #500 rehearsal path: it exercises
 * `e2e/prod-smoke.spec.ts` against `vite preview` (built from the current
 * working tree) without ever resolving the canonical production origin.
 *
 * Why this is a wrapper instead of a bare `playwright test`:
 *
 *   - `PLAYWRIGHT_BASE_URL` may be inherited from the shell / CI job. If it
 *     still names production, Playwright would run the whole file there —
 *     including the Issue #43 group's anonymous reaction mutation. The
 *     wrapper always overwrites it with the local origin, so the command
 *     name cannot lie.
 *   - The preview webServer serves `dist/client`, so a clean checkout or a
 *     stale build would inspect the wrong artifact (or fail to start). The
 *     wrapper builds first.
 *   - `PLAYWRIGHT_PORT` is honoured, matching `playwright.config.ts`.
 *
 * The origin and the build are both printed so the run is auditable.
 */

import { spawnSync } from 'node:child_process';

const port = process.env.PLAYWRIGHT_PORT ?? '3000';
const baseUrl = `http://127.0.0.1:${port}`;

const env = {
	...process.env,
	// Force the local origin even when a parent process exported production.
	PLAYWRIGHT_BASE_URL: baseUrl,
	E2E_LOCAL_PROD_SMOKE: '1',
	// Placeholder only: the local rehearsal must not reach the real upstream.
	MY_WEB_2026_CONSUMER_API_KEY: 'local-rehearsal-not-a-credential',
};

process.stdout.write(`[e2e:prod:local] building, then running against ${baseUrl}\n`);

const build = spawnSync('pnpm', ['run', 'build'], { stdio: 'inherit', env });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync('pnpm', ['exec', 'playwright', 'test', 'e2e/prod-smoke.spec.ts'], {
	stdio: 'inherit',
	env,
});
if (run.error) throw run.error;
process.exit(run.status ?? 1);
