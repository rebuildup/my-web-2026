#!/usr/bin/env node
/**
 * The Storybook axe audit as a CI gate (Issue #392).
 *
 * What this script is for
 * -----------------------
 * The offline gate (`scripts/check-a11y-axe-storybook.mjs`) checks
 * that the manifest, the ledger and the fixtures agree. It never
 * renders a story, so it can never observe a violation — the only
 * device that can is the browser audit
 * (`e2e/a11y/axe-storybook.spec.ts`). This script is that device's
 * entry point: it owns the whole lifecycle, so the workflow step is
 * one command and the decision logic stays in a script instead of in
 * workflow YAML (AGENTS.md §5).
 *
 * What it does, in order
 * ----------------------
 *   1. start the repository's own Storybook on loopback (or reuse one
 *      that is already listening);
 *   2. wait until the origin answers;
 *   3. wait until a story ACTUALLY RENDERS — the cold start of a
 *      fresh checkout optimises the Vite dependencies on the first
 *      preview requests, and a suite that starts during that window
 *      fails dozens of stories for a reason that has nothing to do
 *      with accessibility;
 *   4. run the audit;
 *   5. when the audit fails, print the tail of the server log, so the
 *      CI output says WHICH story failed to render and why.
 *
 * A failure is a failure
 * ----------------------
 * The script never turns a red audit green. If the server cannot
 * start, if no story renders, or if the audit finds a violation the
 * ledger does not record, the script exits non-zero. There is no
 * "0 stories measured" path that exits 0: a skipped audit that
 * reports success is the silent green this Issue exists to prevent.
 *
 * Usage:
 *   node scripts/run-storybook-axe-audit.mjs [options]
 *
 *   --base-url=<url>   the Storybook origin (default http://localhost:6010)
 *   --port=<n>         the port to start Storybook on (default 6010)
 *   --work-dir=<path>  where the server log is written
 *                      (default .tmp/storybook-axe)
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
	REPO_ROOT,
	readServerLog,
	isOriginReady,
	startStorybook,
	stopStorybook,
	waitForOrigin,
	waitForStoryRendered,
} from './_storybook-server.mjs';

/** The port the audit starts Storybook on. */
export const DEFAULT_PORT = 6010;

/** The base URL that matches the default port. */
export const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;

/** Where the server log is written. */
export const WORK_DIR = '.tmp/storybook-axe';

/** The options this script understands. */
export function parseArgs(argv) {
	const options = {
		baseUrl: DEFAULT_BASE_URL,
		port: DEFAULT_PORT,
		workDir: WORK_DIR,
	};
	for (const arg of argv) {
		const separator = arg.indexOf('=');
		const flag = (
			arg.startsWith('--') ? arg.slice(2, separator === -1 ? undefined : separator) : arg
		).replace(/^--/, '');
		const value = separator === -1 ? null : arg.slice(separator + 1);
		switch (flag) {
			case 'base-url':
				options.baseUrl = value;
				break;
			case 'port':
				options.port = Number(value);
				break;
			case 'work-dir':
				options.workDir = value;
				break;
			default:
				throw new Error(`unknown option: --${flag}`);
		}
	}
	return options;
}

/**
 * The audit command.
 *
 * The suite's own exit code is the verdict: Playwright exits non-zero
 * when a test fails, and the spec fails a story it could not render.
 *
 * The command is the repository's own `a11y:axe-storybook:e2e` script
 * — the same entry point a developer runs by hand — so the CI job and
 * the local run cannot drift apart.
 */
export function auditCommand() {
	return ['run', 'a11y:axe-storybook:e2e'];
}

/**
 * Run the audit and return its exit code.
 *
 * The suite's output is inherited, so the CI log carries the per-story
 * result list — the record of WHICH story failed.
 */
export function runAudit(baseUrl, repoRoot = REPO_ROOT) {
	try {
		execFileSync('pnpm', auditCommand(), {
			cwd: repoRoot,
			stdio: 'inherit',
			env: { ...process.env, STORYBOOK_BASE_URL: baseUrl },
		});
		return 0;
	} catch (error) {
		return typeof error.status === 'number' ? error.status : 1;
	}
}

/**
 * The whole lifecycle, and the exit code it produced.
 *
 * Exported so the test can drive it against a fake Storybook.
 */
export async function audit(options, deps = {}) {
	const {
		ready = isOriginReady,
		waitOrigin = waitForOrigin,
		waitRendered = waitForStoryRendered,
		auditRunner = runAudit,
		start = startStorybook,
		stop = stopStorybook,
		logger = (line) => process.stdout.write(`${line}\n`),
		repoRoot = REPO_ROOT,
	} = deps;
	const workDir = resolve(repoRoot, options.workDir);
	mkdirSync(workDir, { recursive: true });
	const logPath = join(workDir, 'storybook.log');
	let server = null;
	try {
		if (await ready(options.baseUrl)) {
			logger(`[audit] reusing the Storybook already listening on ${options.baseUrl}`);
		} else {
			logger(`[audit] starting the local Storybook on port ${options.port}…`);
			server = await start(options.port, repoRoot, { logPath });
			await waitOrigin(server.baseUrl);
		}
		const probe = await waitRendered(options.baseUrl, { logger });
		if (!probe.rendered) {
			logger(
				`[audit] the Storybook preview did not render a story (${probe.reason}); the audit measured nothing, so it fails`,
			);
			return 1;
		}
		logger(`[audit] the preview renders (${probe.storyId}); running the audit`);
		const exitCode = auditRunner(options.baseUrl, repoRoot);
		if (exitCode !== 0) {
			logger('[audit] the audit failed; the Storybook log follows');
			const tail = readServerLog(logPath);
			if (tail) logger(tail);
		}
		return exitCode;
	} catch (error) {
		logger(
			`[audit] the audit could not run: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 1;
	} finally {
		stop(server);
	}
}

if (process.argv[1]?.endsWith('run-storybook-axe-audit.mjs')) {
	const options = parseArgs(process.argv.slice(2));
	const exitCode = await audit(options);
	process.exit(exitCode);
}
