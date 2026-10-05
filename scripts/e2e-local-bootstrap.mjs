/**
 * Prepare the local D1 state, THEN hand off to the preview server.
 *
 * Why this exists (Issue #262)
 * -----------------------------
 * `release-0-6-0` had a red E2E gate on every commit. The failing call
 * was `applyMigrations({ target: 'local' })` from `e2e/global-setup.ts`:
 * `spawnSync pnpm ETIMEDOUT` after the full 600s budget, with not one
 * line of child output. Reproduced locally — it is not a CI-only
 * failure.
 *
 * The cause is an ordering assumption, not a timing one.
 * `e2e/global-setup.ts` and `playwright.config.ts` both asserted that
 * `globalSetup` runs BEFORE the webServer. Playwright does the
 * opposite. In `playwright@1.63.0` `lib/runner/index.js`:
 *
 *     function createGlobalSetupTasks(config) {
 *       return [
 *         createRemoveOutputDirsTask(),
 *         ...createPluginSetupTasks(config),        // <- webServer plugin setup
 *         ...config.globalTeardowns.map(...),
 *         ...config.globalSetups.map(...),          // <- globalSetup runs AFTER
 *       ];
 *     }
 *
 * The webServer plugin's `setup()` starts `vite preview` and waits for
 * its URL before any `globalSetup` file is loaded. So the migration
 * was running against a `.tmp/d1state` that workerd was already serving
 * from, and it never returned.
 *
 * The fix is to stop relying on an ordering Playwright does not
 * provide. `webServer.command` is the only hook that is guaranteed to
 * precede the server, so the mutation moves here: migrate, seed, and
 * only then exec the server. The server cannot bind until the state is
 * ready, which is what the old comments always claimed.
 *
 * Fail closed
 * -----------
 * If the migration or the seed fails, this process exits non-zero
 * WITHOUT starting the server. The URL never becomes ready, so
 * Playwright fails the run. A broken bootstrap can never present as a
 * green E2E — the specs would have nothing to talk to.
 *
 * Usage
 * -----
 *     node scripts/e2e-local-bootstrap.mjs [--port=3000] [-- <server cmd>…]
 *
 * Everything after `--` is the server command. It defaults to
 * `pnpm preview --port=<port>`, which is what `playwright.config.ts`
 * relies on. The override exists so the bootstrap's own regression
 * test can drive a trivial server while still exercising the real
 * migration path.
 */

import { execFileSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from './_d1.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const flags = separator === -1 ? argv : argv.slice(0, separator);
const serverArgv = separator === -1 ? [] : argv.slice(separator + 1);

const portFlag = flags.find((arg) => arg.startsWith('--port='));
const port = portFlag ? portFlag.slice('--port='.length) : '3000';
const server = serverArgv.length > 0 ? serverArgv : ['pnpm', 'preview', `--port=${port}`];

/**
 * A failing bootstrap must say WHY. `applyMigrations` throws with the
 * child's output attached (see `cf()` in `_d1.mjs`); printing it here
 * keeps the reason in the CI log rather than behind an opaque exit
 * code.
 */
function bootstrap(step, error) {
	process.stderr.write(`\n[e2e bootstrap] FAILED during ${step}\n`);
	process.stderr.write(`${error?.stack ?? error}\n`);
	process.stderr.write(
		'\nThe local D1 state was NOT prepared, so the preview server was not\n' +
			'started. Playwright will fail this run. That is intentional: a gate\n' +
			'that cannot reach its own database must be red, not green.\n',
	);
	process.exit(1);
}

try {
	// 1. Migrations — creates the portfolio / reactions / auth schema on
	//    a fresh local state and is a no-op afterwards (cf tracks
	//    applied migrations in `d1_migrations`).
	applyMigrations({ target: 'local', execute: true });
} catch (error) {
	bootstrap('local D1 migration', error);
}

try {
	// 2. Skeleton seed — `INSERT OR IGNORE`, so re-runs are no-ops. The
	//    portfolio list / detail routes need at least one public +
	//    published row to render non-empty.
	execFileSync('node', ['scripts/seed-portfolio.mjs'], {
		cwd: REPO_ROOT,
		stdio: 'inherit',
		env: process.env,
	});
} catch (error) {
	bootstrap('portfolio skeleton seed', error);
}

// 3. The server may start now, and only now.
process.stdout.write(`[e2e bootstrap] local D1 ready; starting: ${server.join(' ')}\n`);

const child = spawn(server[0], server.slice(1), { cwd: REPO_ROOT, stdio: 'inherit' });

// Playwright kills the webServer process group, not this wrapper, so
// forward the signals it uses to tear the server down.
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
	process.stderr.write(`[e2e bootstrap] could not start the server: ${error.message}\n`);
	process.exit(1);
});

child.on('exit', (code, signal) => {
	if (signal) {
		process.stderr.write(`[e2e bootstrap] server terminated by ${signal}\n`);
		process.exit(1);
	}
	process.exit(code ?? 0);
});
