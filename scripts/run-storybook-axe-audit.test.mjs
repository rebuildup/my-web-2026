import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	DEFAULT_BASE_URL,
	DEFAULT_PORT,
	auditCommand,
	audit,
	parseArgs,
} from './run-storybook-axe-audit.mjs';

/**
 * The Storybook axe audit as a CI gate (Issue #392).
 *
 * The contract this file protects is the one that decides whether the
 * gate is honest:
 *
 *   - a story that does NOT render is a FAILURE, never a skip. A
 *     skipped audit reports "0 stories measured" and exits 0, which
 *     reads like a pass — the silent green the Issue exists to
 *     prevent;
 *   - a red audit keeps its exit code;
 *   - a failure prints the Storybook log, because the log is the only
 *     place the reason a story did not render appears;
 *   - an already-listening Storybook is reused instead of started a
 *     second time on the same port.
 */

/** A fake dependency set: nothing is started, nothing is measured. */
function fakeDeps(overrides = {}) {
	const calls = { started: [], stopped: [], audited: [], logged: [] };
	return {
		calls,
		deps: {
			ready: async () => false,
			waitOrigin: async () => true,
			waitRendered: async () => ({ rendered: true, storyId: 'a-story--default' }),
			auditRunner: () => {
				calls.audited.push(true);
				return 0;
			},
			start: (port) => {
				calls.started.push(port);
				return { baseUrl: `http://localhost:${port}`, child: {}, logFd: null };
			},
			stop: (server) => {
				calls.stopped.push(server ?? null);
			},
			logger: (line) => calls.logged.push(line),
			...overrides,
		},
	};
}

describe('parseArgs', () => {
	it('defaults to the loopback Storybook on port 6010', () => {
		const options = parseArgs([]);
		assert.equal(options.port, DEFAULT_PORT);
		assert.equal(options.baseUrl, DEFAULT_BASE_URL);
	});

	it('reads the base url, the port and the work dir', () => {
		const options = parseArgs([
			'--base-url=http://localhost:6020',
			'--port=6020',
			'--work-dir=.tmp/other',
		]);
		assert.equal(options.baseUrl, 'http://localhost:6020');
		assert.equal(options.port, 6020);
		assert.equal(options.workDir, '.tmp/other');
	});

	it('refuses an option it does not know', () => {
		assert.throws(() => parseArgs(['--nope=1']), /unknown option: --nope/);
	});
});

describe('auditCommand', () => {
	it('runs the repository entry point for the story suite', () => {
		assert.deepEqual(auditCommand(), ['run', 'a11y:axe-storybook:e2e']);
	});
});

describe('audit', () => {
	it('starts the server, waits for a rendered story, and runs the audit', async () => {
		const { calls, deps } = fakeDeps();
		const exitCode = await audit(parseArgs([]), deps);
		assert.equal(exitCode, 0);
		assert.deepEqual(calls.started, [DEFAULT_PORT]);
		assert.equal(calls.audited.length, 1);
		assert.equal(calls.stopped.length, 1);
	});

	it('reuses a Storybook that is already listening', async () => {
		const { calls, deps } = fakeDeps({ ready: async () => true });
		const exitCode = await audit(parseArgs([]), deps);
		assert.equal(exitCode, 0);
		assert.deepEqual(calls.started, []);
		assert.equal(calls.audited.length, 1);
	});

	it('fails when no story renders, and does not run the audit', async () => {
		const { calls, deps } = fakeDeps({
			waitRendered: async () => ({
				rendered: false,
				storyId: 'a-story--default',
				reason: 'timeout',
			}),
		});
		const exitCode = await audit(parseArgs([]), deps);
		assert.equal(exitCode, 1);
		assert.equal(calls.audited.length, 0);
		assert.ok(calls.logged.some((line) => line.includes('did not render a story')));
	});

	it('keeps the exit code of a red audit and prints the server log', async () => {
		const { calls, deps } = fakeDeps({ auditRunner: () => 1 });
		const exitCode = await audit(parseArgs([]), deps);
		assert.equal(exitCode, 1);
		assert.ok(calls.logged.some((line) => line.includes('the audit failed')));
	});

	it('fails when the server cannot be started at all', async () => {
		const { calls, deps } = fakeDeps({
			start: () => {
				throw new Error('the Storybook binary is not installed');
			},
		});
		const exitCode = await audit(parseArgs([]), deps);
		assert.equal(exitCode, 1);
		assert.equal(calls.audited.length, 0);
		assert.ok(calls.logged.some((line) => line.includes('could not run')));
	});
});
