#!/usr/bin/env node
/**
 * `dev-doctor.mjs` — readiness contract + failure-mode diagnosis for the
 * local dev server (Issue #1317).
 *
 * Why this exists
 * ---------------
 * During the #1266 redesign program the dev server failed in THREE
 * distinct ways that all looked identical from the outside ("vite says
 * ready", then nothing answers):
 *
 *   1. `vite dev` with LOCAL bindings against an empty `.tmp/d1state`:
 *      `/` works, `/portfolio` and `/about` return 500
 *      (`D1_ERROR: no such table: portfolio_project`).
 *   2. A killed dev server leaves `workerd serve` children behind; the
 *      next dev server prints "ready" but EVERY request hangs forever
 *      with 0 bytes and no log line. Recovery needed a manual
 *      `pkill`/`kill` of the stale workerd PIDs.
 *   3. Under machine load "ready in" took 100–600 s, so capture scripts
 *      hit their Playwright timeouts before the server could answer.
 *
 * `vite ready` is NOT the readiness contract — SSR answering
 * `/api/v1/health` is. This script is the scripted way to know which
 * side of that line the server is on, and WHICH failure mode it is in.
 *
 * What it does (it never kills a process or mutates repo/server state)
 * ---------------------------------------------------------------------
 *   - probes `GET /api/v1/health`        → is the Worker SSR path alive?
 *   - probes `GET /api/v1/db/ping`       → is the D1 binding reachable?
 *   - probes `GET /`                     → does SSR render, and which
 *                                          data source does it declare
 *                                          (`data-data-source` attr).
 *                                          This is ONE normal page view —
 *                                          the same write a browser visit
 *                                          performs; the doctor never
 *                                          fetches it twice.
 *   - probes `GET /portfolio`            → the known data-route canary
 *   - when local bindings are in play, scans `.tmp/d1state` for the
 *     `portfolio_project` schema text (`scripts/_local-d1-state.mjs`)
 *   - on a HANG, lists `workerd` processes (pid / ppid / elapsed /
 *     command) so the operator can see the stale children. It prints
 *     candidates; it NEVER kills them.
 *
 * Usage:
 *   node scripts/dev-doctor.mjs [base-url] [--wait=<seconds>] [--timeout=<ms>]
 *
 *   pnpm dev:doctor                 # one-shot diagnosis of :3000
 *   pnpm dev:doctor -- --wait=300   # poll health for up to 300 s first
 *
 * Exit codes:
 *   0  healthy — every probe answered as expected
 *   2  usage error
 *   3  vite-not-listening — connection refused (dev server not up)
 *   4  wedged — the port accepts but never answers (stale workerd?)
 *   5  probe-failed — answered, but with an unexpected status
 *   6  empty-local-d1 — data routes 500 and the local D1 lacks the schema
 *
 * `waitForDevServer` is exported for `scripts/capture-design-matrix.mjs`,
 * which uses it as a pre-flight so a slow cold start fails fast with a
 * named cause instead of a Playwright `page.goto` timeout.
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_STATE_DIR } from './_cloudflare-identity.mjs';
import { inspectLocalD1Table } from './_local-d1-state.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
/** Per-request probe budget. A healthy SSR answer is milliseconds. */
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
/** Table whose absence produces the observed `/portfolio` 500. */
export const LOCAL_D1_REQUIRED_TABLE = 'portfolio_project';

/**
 * Parse the CLI boundary. Pure — exported for tests.
 *
 *   [base-url]                  positional, default http://127.0.0.1:3000
 *   --wait=<seconds>            poll /api/v1/health before diagnosing
 *   --timeout=<ms>              per-request probe budget
 */
export function parseArgs(argv) {
	const positional = [];
	const options = { waitMs: 0, probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS };
	// pnpm forwards its own `--` separator (`pnpm dev:doctor -- --wait=30`);
	// drop exactly one leading separator so it is not read as an option.
	const args = argv[0] === '--' ? argv.slice(1) : argv;
	for (const arg of args) {
		if (arg.startsWith('--wait=')) {
			const seconds = Number(arg.slice('--wait='.length));
			if (!Number.isFinite(seconds) || seconds < 0) {
				throw new Error(`--wait expects seconds >= 0 (got ${arg})`);
			}
			options.waitMs = seconds * 1000;
		} else if (arg.startsWith('--timeout=')) {
			const ms = Number(arg.slice('--timeout='.length));
			if (!Number.isFinite(ms) || ms <= 0) {
				throw new Error(`--timeout expects ms > 0 (got ${arg})`);
			}
			options.probeTimeoutMs = ms;
		} else if (arg.startsWith('--')) {
			throw new Error(`unknown option: ${arg}`);
		} else {
			positional.push(arg);
		}
	}
	if (positional.length > 1) {
		throw new Error(`expected at most one base url (got ${positional.length})`);
	}
	return { base: positional[0] ?? DEFAULT_BASE_URL, ...options };
}

/**
 * One HTTP probe. Never throws: every failure mode is a value so the
 * classifier can name it.
 *
 *   { kind: 'response', status }              — got an HTTP answer
 *   { kind: 'refused' }                       — ECONNREFUSED: nothing listening
 *   { kind: 'timeout' }                       — connected (or not) but no bytes in budget
 *   { kind: 'error', message }                — anything else (DNS, reset, …)
 */
export async function probeHttp(url, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(timeoutMs),
			redirect: 'manual',
		});
		// Drain nothing — status is the contract; bodies are tiny anyway.
		await response.arrayBuffer().catch(() => undefined);
		return { kind: 'response', status: response.status };
	} catch (error) {
		return classifyFetchError(error);
	}
}

/**
 * Same probe contract as `probeHttp`, but keeps the response body —
 * used ONLY for `GET /`, whose SSR HTML carries the declared data
 * source (`data-data-source`). One request, one page view: the home
 * surface records page views, so the doctor must not fetch it twice.
 */
export async function probeHttpText(url, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(timeoutMs),
			redirect: 'manual',
		});
		const body = await response.text();
		return { kind: 'response', status: response.status, body };
	} catch (error) {
		return classifyFetchError(error);
	}
}

function classifyFetchError(error) {
	const name = error?.name ?? '';
	const message = error instanceof Error ? error.message : String(error);
	const causeCode = error?.cause?.code ?? '';
	if (name === 'TimeoutError' || name === 'AbortError') {
		return { kind: 'timeout', message };
	}
	if (causeCode === 'ECONNREFUSED' || /ECONNREFUSED|connection refused/i.test(message)) {
		return { kind: 'refused', message };
	}
	return { kind: 'error', message };
}

/**
 * Poll `GET <base>/api/v1/health` until it answers 200 or the deadline
 * passes. The readiness contract for capture scripts: "vite printed
 * ready" is not readiness — SSR answering the health route is.
 *
 * Returns `{ ready, attempts, last }`. `last` is the final probeHttp
 * result so the caller can distinguish refused / timeout / wrong-status.
 */
export async function waitForDevServer(
	base,
	{
		timeoutMs = 0,
		intervalMs = 2_000,
		probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
		now = () => Date.now(),
		sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
	} = {},
) {
	const healthUrl = `${String(base).replace(/\/+$/, '')}/api/v1/health`;
	const deadline = now() + timeoutMs;
	let attempts = 0;
	let last = null;
	for (;;) {
		attempts += 1;
		last = await probeHttp(healthUrl, probeTimeoutMs);
		if (last.kind === 'response' && last.status === 200) {
			return { ready: true, attempts, last };
		}
		if (now() >= deadline) {
			return { ready: false, attempts, last };
		}
		await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
	}
}

/**
 * Parse `ps -axo pid=,ppid=,etime=,command=` output (POSIX) into
 * workerd process records. Pure — exported for tests.
 *
 * Lines that do not carry `workerd` in the command are dropped, so the
 * caller gets ONLY the candidates it asked about. Shape:
 * `{ pid, ppid, etime, command }` — `pid`/`ppid` as numbers when parseable.
 */
export function parseWorkerdProcessList(text) {
	const records = [];
	for (const line of String(text ?? '').split('\n')) {
		const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
		if (!match) continue;
		const [, pid, ppid, etime, command] = match;
		if (!/workerd/.test(command)) continue;
		records.push({ pid: Number(pid), ppid: Number(ppid), etime, command: command.trim() });
	}
	return records;
}

/**
 * List `workerd` processes on this machine. Read-only — the doctor
 * REPORTS stale candidates; killing them stays an operator decision
 * (AGENTS.md: do not auto-kill other processes).
 *
 * POSIX uses `ps`; Windows falls back to PowerShell's Win32_Process
 * query (the repo supports Windows dev — see `_run-dev.mjs`). Returns
 * `[]` when the platform query itself fails; the caller prints the
 * probe result either way.
 */
export function listWorkerdProcesses({ platform = process.platform, exec = execFileSync } = {}) {
	try {
		if (platform === 'win32') {
			const out = exec(
				'powershell',
				[
					'-NoProfile',
					'-Command',
					'Get-CimInstance Win32_Process -Filter "Name like \'workerd%\'" | ' +
						'ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) - $($_.CommandLine)" }',
				],
				{ encoding: 'utf8', timeout: 15_000 },
			);
			return parseWorkerdProcessList(out);
		}
		const out = exec('ps', ['-axo', 'pid=,ppid=,etime=,command='], {
			encoding: 'utf8',
			timeout: 15_000,
		});
		return parseWorkerdProcessList(out);
	} catch {
		return [];
	}
}

/**
 * Extract the declared data source from a rendered `/` page. The home
 * page's development badge (`src/home/data-source-badge.tsx`) emits
 * `data-data-source="<source>"` in SSR HTML whenever the runtime is not
 * the deployed Worker — a stable, committed attribute, not prose.
 * Pure — exported for tests. Returns `null` when absent.
 */
export function detectDataSource(html) {
	const match = String(html ?? '').match(/data-data-source="([a-z-]+)"/);
	return match ? match[1] : null;
}

const EXIT = {
	OK: 0,
	USAGE: 2,
	NOT_LISTENING: 3,
	WEDGED: 4,
	PROBE_FAILED: 5,
	EMPTY_LOCAL_D1: 6,
};

function fmtProbe(probe) {
	if (probe.kind === 'response') return `HTTP ${probe.status}`;
	if (probe.kind === 'timeout') return 'TIMEOUT (no bytes in budget)';
	if (probe.kind === 'refused') return 'CONNECTION REFUSED';
	return `ERROR (${probe.message ?? 'unknown'})`;
}

function printWorkerdReport(processes) {
	if (processes.length === 0) {
		process.stdout.write(
			'  workerd processes: none found via ps — if the hang persists, check for a wedged\n' +
				'  `vite`/`node` process holding port 3000 (`lsof -nP -iTCP:3000 -sTCP:LISTEN`).\n',
		);
		return;
	}
	process.stdout.write('  workerd processes on this machine:\n');
	for (const proc of processes) {
		process.stdout.write(
			`    pid=${proc.pid} ppid=${proc.ppid} etime=${proc.etime} ${proc.command}\n`,
		);
	}
	process.stdout.write(
		'  A dev server whose parent chain is gone (ppid=1, or a parent that is not the\n' +
			'  current `vite dev`) is the usual stale child. Stop it yourself, e.g.\n' +
			'  `kill <pid>` (or `kill <pid> <pid> …` for several). This tool never kills.\n',
	);
}

async function main() {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`[dev-doctor] ${error.message}\n`);
		process.stderr.write('usage: dev-doctor.mjs [base-url] [--wait=<seconds>] [--timeout=<ms>]\n');
		return EXIT.USAGE;
	}
	const { base, waitMs, probeTimeoutMs } = args;
	const baseUrl = base.replace(/\/+$/, '');

	if (waitMs > 0) {
		process.stdout.write(
			`[dev-doctor] waiting up to ${waitMs / 1000}s for ${baseUrl}/api/v1/health …\n`,
		);
		const waited = await waitForDevServer(baseUrl, {
			timeoutMs: waitMs,
			probeTimeoutMs,
		});
		if (!waited.ready) {
			process.stderr.write(
				`[dev-doctor] server did not become ready within ${waitMs / 1000}s ` +
					`(${waited.attempts} probe(s); last: ${fmtProbe(waited.last)}).\n`,
			);
			if (waited.last?.kind === 'timeout') {
				process.stdout.write('Failure mode: wedged — listing workerd processes:\n');
				printWorkerdReport(listWorkerdProcesses());
				return EXIT.WEDGED;
			}
			return waited.last?.kind === 'refused' ? EXIT.NOT_LISTENING : EXIT.PROBE_FAILED;
		}
		process.stdout.write(`[dev-doctor] ready after ${waited.attempts} probe(s).\n`);
	}

	// 1. Health — the readiness contract itself.
	const health = await probeHttp(`${baseUrl}/api/v1/health`, probeTimeoutMs);
	process.stdout.write(`[dev-doctor] GET /api/v1/health -> ${fmtProbe(health)}\n`);
	if (health.kind === 'refused') {
		process.stderr.write(
			`[dev-doctor] FAILURE MODE: vite-not-listening — nothing accepts connections on ${baseUrl}. The dev server is not running (or crashed). Start it with \`pnpm dev\` (or \`pnpm dev:production-data\` / \`pnpm dev:mock\`) and re-run.\n`,
		);
		return EXIT.NOT_LISTENING;
	}
	if (health.kind === 'timeout') {
		process.stderr.write(
			'[dev-doctor] FAILURE MODE: wedged — the port accepts connections but never ' +
				'answers (0 bytes, no error). The classic cause is orphaned `workerd serve` ' +
				'children from a previous dev server. workerd processes:\n',
		);
		printWorkerdReport(listWorkerdProcesses());
		return EXIT.WEDGED;
	}
	if (health.kind !== 'response' || health.status !== 200) {
		process.stderr.write(
			`[dev-doctor] FAILURE MODE: probe-failed — /api/v1/health answered ${fmtProbe(health)} instead of 200. Check the dev-server terminal output.\n`,
		);
		return EXIT.PROBE_FAILED;
	}

	// 2. D1 binding reachability.
	const dbPing = await probeHttp(`${baseUrl}/api/v1/db/ping`, probeTimeoutMs);
	process.stdout.write(`[dev-doctor] GET /api/v1/db/ping -> ${fmtProbe(dbPing)}\n`);

	// 3. Home page — SSR render + declared data source. `probeHttpText`
	// keeps the body so `detectDataSource` can read the badge attribute;
	// ONE request only (the home surface records page views).
	let dataSource = null;
	const home = await probeHttpText(`${baseUrl}/`, probeTimeoutMs);
	process.stdout.write(`[dev-doctor] GET / -> ${fmtProbe(home)}\n`);
	if (home.kind === 'response' && home.status === 200) {
		dataSource = detectDataSource(home.body);
	}
	if (dataSource) {
		process.stdout.write(`[dev-doctor] declared data source: ${dataSource}\n`);
	}

	// 4. Data-route canary — the route class that failed silently.
	const portfolio = await probeHttp(`${baseUrl}/portfolio`, probeTimeoutMs);
	process.stdout.write(`[dev-doctor] GET /portfolio -> ${fmtProbe(portfolio)}\n`);

	// Classification.
	const dataRouteFailed =
		(portfolio.kind === 'response' && portfolio.status >= 500) || portfolio.kind === 'timeout';
	if (dataRouteFailed) {
		// Local D1 schema check — only meaningful when bindings are local.
		// `production-readonly` is ambiguous here: `dev:production-data`
		// binds REMOTE (local scan irrelevant) while `dev:read-only-guard`
		// binds LOCAL (scan is the answer). The wording covers both.
		const inspection = await inspectLocalD1Table({
			stateDir: resolve(REPO_ROOT, LOCAL_STATE_DIR),
			table: LOCAL_D1_REQUIRED_TABLE,
		});
		process.stdout.write(
			`[dev-doctor] local D1 scan (${LOCAL_STATE_DIR}): ${inspection.status} ` +
				`(${inspection.filesScanned} file(s) scanned)\n`,
		);
		if (inspection.status !== 'table-found') {
			process.stderr.write(
				'[dev-doctor] FAILURE MODE: empty-local-d1 — /portfolio fails and the local ' +
					'D1 has no `portfolio_project` table. If this dev server uses LOCAL ' +
					'bindings (`pnpm dev`, `pnpm dev:mock`, `pnpm dev:read-only-guard`), this ' +
					'is the cause: run `pnpm db:migrate:apply:local` and reload. ' +
					'(`pnpm dev:production-data` binds the remote D1 instead — the local ' +
					'scan does not apply there.)\n',
			);
			return EXIT.EMPTY_LOCAL_D1;
		}
		process.stderr.write(
			`[dev-doctor] FAILURE MODE: probe-failed — /portfolio returned ${fmtProbe(portfolio)} but the local D1 schema looks complete. Check the dev-server terminal for the SSR error.\n`,
		);
		return EXIT.PROBE_FAILED;
	}

	if (dbPing.kind === 'response' && dbPing.status >= 500) {
		process.stderr.write(
			`[dev-doctor] note: /api/v1/db/ping returned ${dbPing.status} — the D1 binding is not answering. Data routes may still work if they do not hit D1.\n`,
		);
	}

	process.stdout.write('[dev-doctor] OK — SSR is answering and the canary route responded.\n');
	return EXIT.OK;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(await main());
}
