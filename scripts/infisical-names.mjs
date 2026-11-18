#!/usr/bin/env node
/**
 * Issue #984 — names-only Infisical secret inventory.
 *
 * `infisical secrets --env=<env> --path=<path> --plain` prints
 * `NAME=value` lines. Running it directly exposes every value to
 * stdout (and therefore to agent transcripts — incidents #139 and
 * #984). This script is the safe replacement for the common case
 * "which names exist here?": it spawns the same CLI, parses the
 * `NAME=value` lines IN-PROCESS, and prints only the names.
 *
 * Invariants:
 *   - A secret VALUE never reaches this process's stdout, stderr,
 *     argv, or any error message.
 *   - Lines that do not match the secret-name grammar are skipped
 *     silently — raw CLI output is never echoed.
 *   - Non-zero CLI exit is reported as a status code only.
 *
 * Usage:
 *   INFISICAL_TOKEN=... node scripts/infisical-names.mjs [--env=dev] [--path=/]
 *   pnpm run infisical:names -- --env=prod --path=/feeds
 *   ... -- --json   (emit a JSON array of names instead of lines)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const SPAWN_TIMEOUT_MS = 30_000;
// `NAME=value` output for a whole env can be large; cap generously
// but keep the parse in-memory bounded.
const SPAWN_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

// Secret names are upper-snake identifiers (runbook §3.2). Accept
// the wider Infisical-legal shape so foreign names still surface as
// names — but never anything containing `=`, whitespace or shell
// metacharacters, which a value line could produce.
const SECRET_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

function parseArgs(argv) {
	const helpText = `Usage: infisical-names.mjs [options]

Prints ONLY secret names for an Infisical env/path. Values are
parsed in-process and never emitted.

Options:
  --env=<slug>    Infisical environment (default: dev)
  --path=<path>   Secret path (default: /)
  --json          Emit a JSON array of names instead of one per line
  -h, --help      show this help

Requires INFISICAL_TOKEN (Universal Auth access token).`;
	const opts = { env: 'dev', path: '/', json: false };
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			console.log(helpText);
			process.exit(0);
		}
		if (arg === '--json') {
			opts.json = true;
			continue;
		}
		const eq = arg.indexOf('=');
		if (eq <= 0) throw new Error(`unknown argument: ${arg}`);
		const key = arg.slice(0, eq);
		const value = arg.slice(eq + 1);
		if (key === '--env') {
			if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(value)) {
				throw new Error('invalid --env value');
			}
			opts.env = value;
		} else if (key === '--path') {
			if (!value.startsWith('/') || value.includes('..')) {
				throw new Error('invalid --path value');
			}
			opts.path = value;
		} else {
			throw new Error(`unknown argument: ${key}`);
		}
	}
	return opts;
}

/* ------------------------------------------------------------------ */
/* Pure helpers (regex-extractable for test pinning)                  */
/* ------------------------------------------------------------------ */

/**
 * Extract secret NAMES from `infisical secrets --plain` stdout.
 * Pure helper — exposed for tests.
 *
 * Each well-formed line is `NAME=value`; the name is the text before
 * the FIRST `=` and must match SECRET_NAME_PATTERN. Everything else
 * — values, continuation lines of multi-line values, CLI noise — is
 * dropped without being echoed anywhere.
 *
 * @param {string} stdout
 * @returns {string[]} sorted unique names
 */
function extractSecretNames(stdout) {
	const names = new Set();
	for (const line of String(stdout).split(/\r?\n/)) {
		const eq = line.indexOf('=');
		if (eq <= 0) continue;
		const name = line.slice(0, eq);
		if (SECRET_NAME_PATTERN.test(name)) names.add(name);
	}
	return [...names].sort();
}

function resolveInfisicalCli() {
	const require = createRequire(import.meta.url);
	const pkgPath = require.resolve('@infisical/cli/package.json');
	const pkgDir = dirname(pkgPath);
	const binField = JSON.parse(readFileSync(pkgPath, 'utf8')).bin;
	const binRel =
		typeof binField === 'string'
			? binField
			: binField && typeof binField.infisical === 'string'
				? binField.infisical
				: null;
	if (binRel === null) {
		throw new Error('@infisical/cli/package.json#bin must declare an `infisical` entry');
	}
	return resolve(pkgDir, binRel);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const token = process.env.INFISICAL_TOKEN;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error('INFISICAL_TOKEN env var is required');
	}

	const result = spawnSync(
		resolveInfisicalCli(),
		['secrets', `--env=${opts.env}`, `--path=${opts.path}`, '--plain'],
		{
			shell: false,
			encoding: 'utf8',
			timeout: SPAWN_TIMEOUT_MS,
			maxBuffer: SPAWN_MAX_OUTPUT_BYTES,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				INFISICAL_DOMAIN: process.env.INFISICAL_DOMAIN ?? INFISICAL_API_URL_DEFAULT,
			},
		},
	);

	if (result.error) {
		throw new Error(`spawn failed: ${result.error.message}`);
	}
	if (result.signal) {
		throw new Error(`infisical secrets terminated by signal ${result.signal}`);
	}
	if (result.status !== 0) {
		// Status code only — stdout/stderr are never echoed because
		// they may carry CLI diagnostics adjacent to secret material.
		throw new Error(`infisical secrets exited with status ${result.status}`);
	}

	const names = extractSecretNames(result.stdout ?? '');
	if (opts.json) {
		console.log(JSON.stringify(names));
	} else {
		for (const name of names) console.log(name);
	}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	try {
		main();
	} catch (error) {
		console.error(`infisical-names: ${error instanceof Error ? error.message : 'failed'}`);
		process.exit(1);
	}
}

export { extractSecretNames, parseArgs };
