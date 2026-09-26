#!/usr/bin/env node
/**
 * ADR-0015 §11 / Phase 1 #67 — Fileless dev smoke verification.
 *
 * Spawns `infisical run --projectId=... --env=dev -- node -e "..."`
 * with the inner Node script dumping key-presence markers for the
 * 3-name contract. Asserts all 3 keys are present and non-empty.
 *
 * **Windows-safe**: uses `child_process.spawnSync` with
 * `shell: false` and a JSON argv array. The inner command is
 * constructed as a literal argv list — no POSIX command-substitution
 * syntax, no shell pipelines into text-processing tools.
 *
 * **No value leak**: the inner Node script outputs only
 * `KEY=<true|false>` markers (boolean of `process.env[k]`), never
 * the actual values. The outer script captures stdout in process
 * and parses only the marker line.
 *
 * Invariants:
 *   - argv / log / error message never carries a secret value.
 *   - The presence check uses `Boolean(process.env[k])` which
 *     evaluates to `true` / `false` regardless of value content.
 *
 * Usage:
 *   INFISICAL_TOKEN=... node scripts/infisical-verify.mjs
 *   pnpm run infisical:verify
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INFISICAL_JSON_PATH = resolve(REPO_ROOT, '.infisical.json');

const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const DEV_SECRET_NAMES = [
	'BETTER_AUTH_SECRET',
	'BETTER_AUTH_SECRETS',
	'MY_WEB_2026_CONSUMER_API_KEY',
];
const SPAWN_TIMEOUT_MS = 30_000;
const SPAWN_MAX_OUTPUT_BYTES = 4 * 1024;

function parseArgs(argv) {
	// Help text is inlined (rather than calling a separate printHelp())
	// so this function stays self-contained for regex-extraction by
	// the test harness (mirrors the pattern in
	// `bootstrap-home-api-key.test.mjs#loadPureHelpers`).
	const helpText = `Usage: infisical-verify.mjs

ADR-0015 §11 Phase 1 #67 — fileless dev smoke verification.

Reads:
  INFISICAL_TOKEN             Infisical Universal Auth access token
  INFISICAL_API_URL           base URL (default: https://secrets.rebuildup.dev)

Spawns:
  infisical run --projectId=<workspaceId> --env=dev -- node -e "<presence check>"
  and asserts all 3 contract keys are present and non-empty.

  -h, --help                 show this help`;
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			console.log(helpText);
			process.exit(0);
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return {};
}

/* ------------------------------------------------------------------ */
/* Pure helpers (regex-extractable for test pinning)                  */
/* ------------------------------------------------------------------ */

/**
 * Build the inner Node script that dumps key-presence markers.
 * Returns the literal `node -e` script text. Pure helper — exposed
 * for tests.
 *
 * The script writes 3 lines, each `KEY=true` or `KEY=false`
 * (Boolean coercion of `process.env[KEY]`). No value ever appears
 * in stdout — only the boolean presence marker.
 */
function buildPresenceCheckScript(secretNames) {
	if (!Array.isArray(secretNames) || secretNames.length === 0) {
		throw new Error('secretNames must be a non-empty array');
	}
	const lines = secretNames.map(
		(key) =>
			`process.stdout.write(${JSON.stringify(`${key}=`)} + Boolean(process.env[${JSON.stringify(key)}]) + "\\n")`,
	);
	return `${lines.join(';\n')};\n`;
}

/**
 * Parse the presence-check stdout into a `{ key: boolean }` map.
 * Pure helper — exposed for tests. Only emits an entry when the
 * value is the literal string `true` or `false`; any other content
 * is treated as malformed and skipped (the key is left absent).
 */
function parsePresenceMarkers(stdout) {
	const out = {};
	for (const line of stdout.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq);
		const val = trimmed.slice(eq + 1);
		if (val !== 'true' && val !== 'false') continue;
		out[key] = val === 'true';
	}
	return out;
}

function readInfisicalWorkspaceId() {
	if (!existsSync(INFISICAL_JSON_PATH)) {
		throw new Error(
			`.infisical.json not found at ${INFISICAL_JSON_PATH}. Run \`pnpm run infisical:bootstrap:api\` first.`,
		);
	}
	const parsed = JSON.parse(readFileSync(INFISICAL_JSON_PATH, 'utf8'));
	if (typeof parsed.workspaceId !== 'string' || parsed.workspaceId.length === 0) {
		throw new Error('.infisical.json#workspaceId must be a non-empty string');
	}
	return parsed.workspaceId;
}

/* ------------------------------------------------------------------ */
/* Spawn (side-effectful)                                             */
/* ------------------------------------------------------------------ */

function spawnPresenceCheck({ workspaceId, infisicalCli }) {
	const script = buildPresenceCheckScript(DEV_SECRET_NAMES);
	const result = spawnSync(
		infisicalCli,
		['run', '--projectId', workspaceId, '--env', 'dev', '--', process.execPath, '-e', script],
		{
			shell: false,
			encoding: 'utf8',
			timeout: SPAWN_TIMEOUT_MS,
			maxBuffer: SPAWN_MAX_OUTPUT_BYTES,
			stdio: ['ignore', 'pipe', 'pipe'],
			// Self-host v0.165.x: the CLI defaults to
			// `https://app.infisical.com/api`. The .infisical.json
			// schema (see ALLOWED_INFISICAL_JSON_KEYS in
			// bootstrap-api.mjs) doesn't include `domain`, so we set
			// the domain via the INFISICAL_DOMAIN env var instead
			// of committing it to the file.
			env: {
				...process.env,
				INFISICAL_DOMAIN: process.env.INFISICAL_DOMAIN ?? INFISICAL_API_URL_DEFAULT,
			},
		},
	);
	return result;
}

async function main() {
	parseArgs(process.argv.slice(2));

	const apiUrl = process.env.INFISICAL_API_URL ?? INFISICAL_API_URL_DEFAULT;
	const token = process.env.INFISICAL_TOKEN;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error('INFISICAL_TOKEN env var is required');
	}

	const workspaceId = readInfisicalWorkspaceId();

	// Resolve the devDep-pinned CLI via Node module resolution.
	// `@infisical/cli` exposes a NATIVE executable at
	// `bin/infisical` (no `.js` extension; declared in
	// `package.json#bin`), so a plain `require.resolve` for a
	// `.js` extension would fail. Read the bin field instead and
	// construct the absolute path.
	//
	// We do NOT call the global `infisical` binary because
	// Windows / native shells differ in how they resolve PATH.
	const { createRequire } = await import('node:module');
	const require = createRequire(import.meta.url);
	const infisicalPkgPath = require.resolve('@infisical/cli/package.json');
	const infisicalPkgDir = dirname(infisicalPkgPath);
	const pkgBinField = JSON.parse(readFileSync(infisicalPkgPath, 'utf8')).bin;
	const binRel =
		typeof pkgBinField === 'string'
			? pkgBinField
			: pkgBinField && typeof pkgBinField.infisical === 'string'
				? pkgBinField.infisical
				: null;
	if (binRel === null) {
		throw new Error('@infisical/cli/package.json#bin must declare an `infisical` entry');
	}
	const infisicalCli = resolve(infisicalPkgDir, binRel);

	const result = spawnPresenceCheck({ workspaceId, infisicalCli });

	if (result.error) {
		throw new Error(`spawn failed: ${result.error.message}`);
	}
	if (result.signal) {
		throw new Error(`infisical run terminated by signal ${result.signal}`);
	}
	if (result.status !== 0) {
		// Don't include stdout / stderr contents — they may carry
		// diagnostic text. Operator can re-run with INFISICAL_DEBUG=1
		// if needed.
		throw new Error(`infisical run exited with status ${result.status}`);
	}

	const presence = parsePresenceMarkers(result.stdout ?? '');
	const allPresent = DEV_SECRET_NAMES.every((key) => presence[key] === true);
	if (!allPresent) {
		const missing = DEV_SECRET_NAMES.filter((key) => presence[key] !== true);
		console.error(`Fileless dev (--env=dev): MISSING ${missing.join(', ')}`);
		process.exit(1);
	}

	console.log('Fileless dev (--env=dev):');
	for (const key of DEV_SECRET_NAMES) {
		console.log(`  ✓ ${key}`);
	}

	// Also report prod env status (must be empty per operator decision).
	console.log('');
	console.log('Prod env (--env=prod, expected: 0 secrets per Issue #67 AC):');
	// Best-effort: spawn the same check against prod. If prod env is
	// empty (as it should be per AC), all keys will be `false`.
	const prodResult = spawnSync(
		infisicalCli,
		[
			'run',
			'--projectId',
			workspaceId,
			'--env',
			'prod',
			'--',
			process.execPath,
			'-e',
			buildPresenceCheckScript(DEV_SECRET_NAMES),
		],
		{
			shell: false,
			encoding: 'utf8',
			timeout: SPAWN_TIMEOUT_MS,
			maxBuffer: SPAWN_MAX_OUTPUT_BYTES,
			stdio: ['ignore', 'pipe', 'pipe'],
			// See spawnPresenceCheck for INFISICAL_DOMAIN rationale.
			env: {
				...process.env,
				INFISICAL_DOMAIN: process.env.INFISICAL_DOMAIN ?? INFISICAL_API_URL_DEFAULT,
			},
		},
	);
	if (prodResult.status === 0) {
		const prodPresence = parsePresenceMarkers(prodResult.stdout ?? '');
		const prodPresent = DEV_SECRET_NAMES.filter((key) => prodPresence[key] === true);
		if (prodPresent.length === 0) {
			console.log('  ✓ 0 secrets (matches AC: prod env seeded with zero secrets)');
		} else {
			console.log(`  · ${prodPresent.length} secrets present (operator post-#67 import)`);
		}
	} else {
		console.log('  (prod env check skipped — non-zero exit from infisical run)');
	}
}

main().catch((error) => {
	console.error(`infisical-verify failed: ${error?.message ?? error}`);
	process.exit(1);
});
