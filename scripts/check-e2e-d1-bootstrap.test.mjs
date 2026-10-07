import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Guards for the E2E local-D1 bootstrap (Issue #262).
 *
 * What class of defect this catches
 * ---------------------------------
 * A false-green CI step. `release-0-6-0` spent eight commits on a red
 * E2E gate, and the natural wrong response to a gate that has been red
 * that long is to make it quiet. Every assertion here exists to make
 * that response impossible to land by accident:
 *
 *   1. The local D1 migration must be wired into `webServer.command`,
 *      not `globalSetup`. Playwright starts the webServer BEFORE any
 *      globalSetup file loads (`createGlobalSetupTasks` in
 *      `playwright@1.63.0` `lib/runner/index.js`), so migrating from
 *      `globalSetup` is the exact ordering defect this issue fixed.
 *   2. `globalSetup` must not mutate the database. It verifies; the
 *      pre-server bootstrap mutates. If it goes back to mutating, the
 *      D1 write is issued against a persist root workerd is already
 *      serving from.
 *   3. The bootstrap must fail closed: a migration error has to stop
 *      it BEFORE it hands off to the server, so a server that starts
 *      is provably a server with a migrated state behind it.
 *   4. `globalSetup` must fail closed too, on a state that is missing
 *      the schema the specs read. This is the artifact assertion, and
 *      it lives in the E2E gate rather than here — see below.
 *   5. The CI step itself must stay strict: no `continue-on-error`, no
 *      weakened `if:`, no removed step.
 *
 * Why this file is static-only
 * ---------------------------
 * The obvious place to assert "the bootstrap really produced the
 * schema" is here, by shelling out to `scripts/e2e-local-bootstrap.mjs`
 * and reading the SQLite it leaves behind. That was the first version
 * of this file, and it had to be taken out again.
 *
 * `cf@1.0.0-beta.12`'s `d1 migrations apply --local` intermittently
 * never returns — measured 2 hangs in 6 consecutive runs on an
 * otherwise idle machine, with no second process on the persist root
 * and no `.miniflare-startup.lock` present. Successful runs take
 * 0.9-1.7s. A test that shells out to `cf` would therefore fail
 * roughly a third of the time for reasons that have nothing to do with
 * the code under test, and the unit suite is ALREADY carrying a
 * flake report (Issue #261). Manufacturing more is a net loss.
 *
 * So the artifact assertion lives where a `cf` failure is already
 * visible and already red: `e2e/global-setup.ts` throws when the local
 * D1 state is missing `portfolio_project` / `portfolio_link` /
 * `portfolio_media`, and it runs in the E2E gate itself. A bootstrap
 * that stops working therefore cannot present as a green run — it
 * presents as a red E2E, next to the `cf` failure that caused it.
 * What this file adds is the part the E2E gate cannot check about
 * itself: that the wiring which makes that possible is still in place.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT_CONFIG = resolve(REPO_ROOT, 'playwright.config.ts');
const GLOBAL_SETUP = resolve(REPO_ROOT, 'e2e/global-setup.ts');
const BOOTSTRAP = resolve(REPO_ROOT, 'scripts/e2e-local-bootstrap.mjs');
const CI_WORKFLOW = resolve(REPO_ROOT, '.github/workflows/ci.yml');

/** Tables the portfolio E2E specs read. Mirrors `e2e/global-setup.ts`. */
const REQUIRED_TABLES = ['portfolio_project', 'portfolio_link', 'portfolio_media'];

/**
 * Drop `/* … *\/` and `// …` so a guard can assert on CODE rather than
 * on the prose documenting it. The guarded files deliberately NAME the
 * calls they must not make, and matching that prose would fail them
 * for the right reason written down wrong.
 */
function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('E2E local D1 bootstrap wiring (Issue #262)', () => {
	it('runs the migration from webServer.command, not globalSetup', () => {
		const config = stripComments(readFileSync(PLAYWRIGHT_CONFIG, 'utf8'));

		assert.match(
			config,
			/webServer:[\s\S]*?command:\s*`node scripts\/e2e-local-bootstrap\.mjs/,
			'playwright.config.ts must start the preview server through scripts/e2e-local-bootstrap.mjs.\n' +
				'Playwright loads the webServer plugin before any globalSetup file, so the\n' +
				'migration has to live in the webServer command to run before the server\n' +
				'binds. Wiring it anywhere else re-runs a D1 write against a persist root\n' +
				'workerd is already serving from.',
		);

		// The bare `pnpm preview` form is what used to be there. If it
		// comes back, the state is unprepared when the server starts.
		assert.doesNotMatch(
			config,
			/command:\s*`pnpm preview/,
			'playwright.config.ts must not start `pnpm preview` directly — the local D1\n' +
				'state would be unmigrated when the server binds.',
		);
	});

	it('keeps globalSetup read-only', () => {
		const code = stripComments(readFileSync(GLOBAL_SETUP, 'utf8'));

		// Assert on the mutation VECTORS, not on keywords. Naming the
		// forbidden calls in prose — or inside an error message that
		// explains the failure — must not trip the guard.
		assert.doesNotMatch(
			code,
			/from\s+['"][^'"]*_d1\.mjs['"]/,
			'e2e/global-setup.ts must not import the cf driver. It runs AFTER the\n' +
				'webServer, so a mutation there contends with a live server.\n' +
				'Use scripts/e2e-local-bootstrap.mjs, which runs before the server binds.',
		);
		assert.doesNotMatch(
			code,
			/from\s+['"]node:child_process['"]/,
			'e2e/global-setup.ts must not shell out. Same reason: this hook runs after\n' +
				'the webServer, and the mutation has to happen before the server binds.',
		);
		assert.doesNotMatch(
			code,
			/\bapplyMigrations\s*\(/,
			'e2e/global-setup.ts must not call applyMigrations(). It runs AFTER the\n' +
				'webServer; the migration belongs in scripts/e2e-local-bootstrap.mjs.',
		);
	});

	it('makes globalSetup a real, fail-closed artifact check', () => {
		const code = stripComments(readFileSync(GLOBAL_SETUP, 'utf8'));

		// It has to read the state, or a read-only globalSetup is
		// indistinguishable from no globalSetup at all.
		assert.match(
			code,
			/(?:from|import\()\s*['"]node:sqlite['"]/,
			'e2e/global-setup.ts must read the local D1 state to verify it.',
		);
		// It has to check the exact tables the specs read.
		for (const table of REQUIRED_TABLES) {
			assert.match(
				code,
				new RegExp(`['"\`]${table}['"\`]`),
				`e2e/global-setup.ts must assert on \`${table}\`. A bootstrap that stopped\nworking would otherwise leave the portfolio specs against an empty\ndatabase with nothing here to notice.`,
			);
		}
		assert.match(
			code,
			/throw new Error/,
			'e2e/global-setup.ts must fail closed: an unprepared state has to throw, or a\n' +
				'broken bootstrap presents as a green run.',
		);
	});

	it('makes the bootstrap fail closed before it hands off to the server', () => {
		const code = stripComments(readFileSync(BOOTSTRAP, 'utf8'));

		// The migration and the seed must be awaited BEFORE the spawn.
		const migrate = code.indexOf('applyMigrations(');
		const spawn = code.indexOf('spawn(');
		assert.ok(migrate !== -1, 'the bootstrap must apply the local migrations');
		assert.ok(spawn !== -1, 'the bootstrap must start the server itself');
		assert.ok(
			migrate < spawn,
			'the bootstrap must migrate BEFORE it spawns the server. The whole point of\n' +
				'this file is the ordering; a spawn above the migrate call reintroduces the\n' +
				'defect that hung release-0-6-0.',
		);
		// And every failure path has to stop the process, so a broken
		// bootstrap can never reach the server.
		assert.match(
			code,
			/process\.exit\(1\)/,
			'the bootstrap must exit non-zero on a failed migration or seed. A bootstrap\n' +
				'that continued would serve an unmigrated database and read as green.',
		);
	});

	it('leaves the CI E2E step strict', () => {
		const workflow = readFileSync(CI_WORKFLOW, 'utf8');
		const step = workflow.match(/- name: Playwright E2E\n(?:.*\n)*?(?=\n* {6}- name:|\n*jobs:|\Z)/);

		assert.ok(step, 'the `Playwright E2E` step must still exist in .github/workflows/ci.yml');

		const body = step[0];
		assert.doesNotMatch(
			body,
			/continue-on-error/,
			'the Playwright E2E step must not set continue-on-error. The gate has been red\n' +
				'for a long time; absorbing the failure is the false-green this task exists\n' +
				'to prevent.',
		);
		assert.match(body, /run: pnpm run e2e/, 'the E2E step must still run the suite.');
		assert.match(
			body,
			/startsWith\(github\.ref, 'refs\/heads\/release-'\)/,
			'the E2E step must still run on release branches — that is how a red release\n' +
				'trunk is observed at all.',
		);
	});
});
