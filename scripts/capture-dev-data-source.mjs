#!/usr/bin/env node

/**
 * capture-dev-data-source — capture the development data-source
 * indicator (Issue #377) for the verification artefacts under
 * `docs/verification/development/`.
 *
 * What this captures
 * ------------------
 * The indicator the home page renders in a DEVELOPMENT runtime, in the
 * two states the issue names:
 *
 *   - `mock`               — the dev server with the mock gate
 *                            (`pnpm dev:mock`).
 *   - `read-only-guard`    — the dev server with the production-readonly
 *                            write policy and LOCAL bindings
 *                            (`pnpm dev:read-only-guard`).
 *
 * The second state is the SAFE way to photograph the production-readonly
 * behaviour: the write refusal is the production one, and the numbers
 * behind it are local, so the capture cannot touch production data.
 * The remote state (`pnpm dev:production-data`) needs a Cloudflare
 * remote session, which a development API token often cannot create —
 * see `docs/verification/development/README.md`.
 *
 * The capture FAILS when the rendered indicator does not carry the
 * expected source and write policy. A screenshot of the wrong state is
 * worse than no screenshot, so the script refuses to write one.
 *
 * Safety
 * ------
 *   - Nothing is deployed. The dev server runs on loopback only.
 *   - No secret value is read, printed or captured: the indicator
 *     carries the data source, the write policy and one explanation.
 *   - The capture never performs a write; it only reads the home page.
 *
 * Artefacts
 * ---------
 * Issue #377 names PNG paths (`mock-source.png`,
 * `production-readonly-source.png`) and this repository commits its
 * verification screenshots as WebP (Issue #495 and later). Both are
 * written: the PNG at the path the issue names, the WebP next to it.
 *
 * Usage:
 *   node scripts/capture-dev-data-source.mjs --mode=<mock|read-only-guard>
 *        [--out-prefix=docs/verification/development/<name>]
 *        [--port=<n>] [--json-out=<path>]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The modes this script can photograph, and what the indicator must
 * say in each of them. The expectation is part of the capture: the
 * script verifies it and refuses to write an artefact that does not
 * match.
 */
export const MODES = {
	mock: {
		script: 'dev:mock',
		expectedSource: 'mock',
		expectedWritePolicy: 'writable',
	},
	'read-only-guard': {
		script: 'dev:read-only-guard',
		expectedSource: 'production-readonly',
		expectedWritePolicy: 'read-only',
	},
};

const INDICATOR_TEST_ID = 'home-data-source-badge';
const READY_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1_000;

function parseArgs(argv) {
	const options = { mode: null, outPrefix: null, port: 4321, jsonOut: null };
	for (const arg of argv) {
		if (arg.startsWith('--mode=')) options.mode = arg.slice('--mode='.length);
		else if (arg.startsWith('--out-prefix=')) options.outPrefix = arg.slice('--out-prefix='.length);
		else if (arg.startsWith('--port='))
			options.port = Number.parseInt(arg.slice('--port='.length), 10);
		else if (arg.startsWith('--json-out=')) options.jsonOut = arg.slice('--json-out='.length);
		else throw new Error(`unknown argument: ${arg}`);
	}
	if (!options.mode || !(options.mode in MODES)) {
		throw new Error(`--mode must be one of ${Object.keys(MODES).join(', ')}`);
	}
	return options;
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Start the dev server for a mode and wait until the home page
 * answers. The server is spawned with the repository's own script, so
 * the captured state is the state an operator gets from the same
 * command.
 */
async function startDevServer(mode, port) {
	const child = spawn(
		'pnpm',
		['run', MODES[mode].script, '--', '--port', String(port), '--strictPort'],
		{
			cwd: REPO_ROOT,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: process.env,
		},
	);
	const log = [];
	child.stdout.on('data', (chunk) => log.push(String(chunk)));
	child.stderr.on('data', (chunk) => log.push(String(chunk)));
	const origin = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(
				`the dev server exited with code ${child.exitCode} before it answered:\n${log.join('')}`,
			);
		}
		try {
			const res = await fetch(`${origin}/`, { redirect: 'manual' });
			if (res.status < 500) return { child, origin, log };
		} catch {
			// The server is not listening yet.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	child.kill('SIGTERM');
	throw new Error(`the dev server did not answer within ${READY_TIMEOUT_MS} ms`);
}

/**
 * Capture the indicator element and write both artefacts.
 */
async function capture({ origin, mode, outPrefix }) {
	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	try {
		await page.goto(`${origin}/`, { waitUntil: 'networkidle', timeout: 60_000 });
		const indicator = page.locator(`[data-testid="${INDICATOR_TEST_ID}"]`);
		await indicator.waitFor({ state: 'visible', timeout: 60_000 });
		const observed = {
			source: await indicator.getAttribute('data-data-source'),
			writePolicy: await indicator.getAttribute('data-write-policy'),
		};
		const expected = MODES[mode];
		if (observed.source !== expected.expectedSource) {
			throw new Error(
				`the indicator reported source=${observed.source}, expected ${expected.expectedSource}`,
			);
		}
		if (observed.writePolicy !== expected.expectedWritePolicy) {
			throw new Error(
				`the indicator reported write-policy=${observed.writePolicy}, expected ${expected.expectedWritePolicy}`,
			);
		}
		const pngPath = resolve(REPO_ROOT, `${outPrefix}.png`);
		const webpPath = resolve(REPO_ROOT, `${outPrefix}.webp`);
		mkdirSync(dirname(pngPath), { recursive: true });
		await indicator.screenshot({ path: pngPath });
		await sharp(pngPath).webp({ quality: 80 }).toFile(webpPath);
		return { observed, pngPath, webpPath };
	} finally {
		await browser.close();
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const outPrefix =
		options.outPrefix ??
		`docs/verification/development/${options.mode === 'mock' ? 'mock-source' : 'production-readonly-source'}`;
	const { child, origin, log } = await startDevServer(options.mode, options.port);
	let result;
	try {
		result = await capture({ origin, mode: options.mode, outPrefix });
	} finally {
		child.kill('SIGTERM');
	}
	const report = {
		mode: options.mode,
		script: MODES[options.mode].script,
		origin,
		expected: MODES[options.mode],
		observed: result.observed,
		artefacts: [result.pngPath, result.webpPath],
		devServerLog: log.join('').slice(-4000),
	};
	if (options.jsonOut) {
		const jsonPath = resolve(REPO_ROOT, options.jsonOut);
		mkdirSync(dirname(jsonPath), { recursive: true });
		writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
	}
	process.stdout.write(
		`[capture-dev-data-source] mode=${options.mode} source=${result.observed.source} write-policy=${result.observed.writePolicy}\n`,
	);
	process.stdout.write(`[capture-dev-data-source] wrote ${result.pngPath}\n`);
	process.stdout.write(`[capture-dev-data-source] wrote ${result.webpPath}\n`);
}

if (existsSync(process.argv[1] ?? '')) {
	main().catch((error) => {
		process.stderr.write(`[capture-dev-data-source] ${error?.message ?? String(error)}\n`);
		process.exit(1);
	});
}
