import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { describe, it } from 'node:test';
import {
	detectDataSource,
	listWorkerdProcesses,
	parseArgs,
	parseWorkerdProcessList,
	probeHttp,
	waitForDevServer,
} from './dev-doctor.mjs';

/**
 * `dev-doctor.mjs` tests (Issue #1317).
 *
 * The doctor is the readiness contract for the dev server: pure helpers
 * (`parseArgs`, `parseWorkerdProcessList`, `detectDataSource`) are
 * fixture-tested, and the HTTP helpers run against a real `node:http`
 * server on an ephemeral port — no dev server, no workerd, no network.
 */

describe('dev-doctor.mjs', () => {
	/**
	 * A port that was bound and immediately released — guaranteed
	 * ECONNREFUSED without racing a real service. (Port 1 is rejected
	 * by undici as a "bad port" before any connect attempt.)
	 */
	async function closedPortUrl() {
		const server = createNetServer();
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const { port } = server.address();
		await new Promise((resolve) => server.close(resolve));
		return `http://127.0.0.1:${port}`;
	}

	describe('parseArgs', () => {
		it('defaults to the canonical dev port', () => {
			const args = parseArgs([]);
			assert.equal(args.base, 'http://127.0.0.1:3000');
			assert.equal(args.waitMs, 0);
		});

		it('accepts a positional base url and --wait seconds', () => {
			const args = parseArgs(['http://localhost:4000', '--wait=12', '--timeout=2500']);
			assert.equal(args.base, 'http://localhost:4000');
			assert.equal(args.waitMs, 12_000);
			assert.equal(args.probeTimeoutMs, 2500);
		});

		it('drops the pnpm `--` separator pnpm forwards to run-scripts', () => {
			const args = parseArgs(['--', '--wait=5']);
			assert.equal(args.waitMs, 5_000);
		});

		it('rejects unknown options and bad numbers', () => {
			assert.throws(() => parseArgs(['--bogus']), /unknown option/);
			assert.throws(() => parseArgs(['--wait=-1']), /--wait expects/);
			assert.throws(() => parseArgs(['--timeout=0']), /--timeout expects/);
			assert.throws(() => parseArgs(['a', 'b']), /at most one base url/);
		});
	});

	describe('parseWorkerdProcessList', () => {
		it('keeps only workerd lines and parses pid/ppid/etime/command', () => {
			const ps = [
				'  101     1 02-03:04:05 /usr/local/bin/node /x/vite dev',
				'  202   101    01:23 /Users/x/workerd-darwin-arm64 serve --binary',
				'  303     1    04:05 /opt/homebrew/bin/node scripts/dev-doctor.mjs',
				'not a process line',
			].join('\n');
			const records = parseWorkerdProcessList(ps);
			assert.equal(records.length, 1);
			assert.deepEqual(records[0], {
				pid: 202,
				ppid: 101,
				etime: '01:23',
				command: '/Users/x/workerd-darwin-arm64 serve --binary',
			});
		});

		it('returns [] for empty or unrelated output', () => {
			assert.deepEqual(parseWorkerdProcessList(''), []);
			assert.deepEqual(parseWorkerdProcessList(undefined), []);
			assert.deepEqual(parseWorkerdProcessList('  1 0 00:01 /bin/zsh'), []);
		});
	});

	describe('listWorkerdProcesses', () => {
		it('parses injected ps output (POSIX path)', () => {
			const exec = () => '  55 1 12:34 /x/workerd serve --binary\n';
			const records = listWorkerdProcesses({ platform: 'darwin', exec });
			assert.equal(records.length, 1);
			assert.equal(records[0].pid, 55);
		});

		it('returns [] when the platform query fails — never throws', () => {
			const exec = () => {
				throw new Error('ps: command not found');
			};
			assert.deepEqual(listWorkerdProcesses({ platform: 'linux', exec }), []);
		});
	});

	describe('detectDataSource', () => {
		it('reads the badge attribute out of SSR HTML', () => {
			const html =
				'<div data-testid="home-data-source-badge" data-data-source="local" data-write-policy="writable">';
			assert.equal(detectDataSource(html), 'local');
		});

		it('returns null when the badge is absent (production Worker)', () => {
			assert.equal(detectDataSource('<html>no badge</html>'), null);
			assert.equal(detectDataSource(undefined), null);
		});
	});

	describe('probeHttp / waitForDevServer', () => {
		async function withServer(handler, fn) {
			const server = createServer(handler);
			await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
			const { port } = server.address();
			try {
				await fn(`http://127.0.0.1:${port}`);
			} finally {
				await new Promise((resolve) => server.close(resolve));
			}
		}

		it('probeHttp reports a response with its status', async () => {
			await withServer(
				(_req, res) => {
					res.writeHead(200, { 'content-type': 'application/json' });
					res.end('{"status":"ok"}');
				},
				async (base) => {
					const probe = await probeHttp(`${base}/api/v1/health`, 5_000);
					assert.deepEqual(probe, { kind: 'response', status: 200 });
				},
			);
		});

		it('probeHttp reports refused when nothing listens', async () => {
			const probe = await probeHttp(`${await closedPortUrl()}/api/v1/health`, 2_000);
			assert.equal(probe.kind, 'refused');
		});

		it('probeHttp reports timeout when the server accepts but never answers', async () => {
			await withServer(
				() => {
					// Intentionally never respond — the wedged-workerd shape.
				},
				async (base) => {
					const probe = await probeHttp(`${base}/api/v1/health`, 200);
					assert.equal(probe.kind, 'timeout');
				},
			);
		});

		it('waitForDevServer resolves ready on the first 200', async () => {
			await withServer(
				(_req, res) => {
					res.writeHead(200).end('ok');
				},
				async (base) => {
					const result = await waitForDevServer(base, { timeoutMs: 5_000 });
					assert.equal(result.ready, true);
					assert.equal(result.attempts, 1);
				},
			);
		});

		it('waitForDevServer gives up at the deadline and reports refused', async () => {
			const result = await waitForDevServer(await closedPortUrl(), {
				timeoutMs: 300,
				intervalMs: 50,
				probeTimeoutMs: 500,
			});
			assert.equal(result.ready, false);
			assert.equal(result.last.kind, 'refused');
			assert.ok(result.attempts >= 1);
		});
	});
});
