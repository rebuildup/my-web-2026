#!/usr/bin/env node
/**
 * Issue #122 — reconcile the Infisical prod legacy auth-secret audit copy
 * to the known recovery source used for the current production Worker.
 *
 * Source of truth for this one-time reconciliation: Infisical dev
 * BETTER_AUTH_SECRET, because Incident #99 recovery restored the Worker
 * binding from that exact value while Infisical prod was not trustworthy.
 *
 * Safety invariants:
 * - default is dry-run and performs no network access or mutation;
 * - --verify performs read-only comparison;
 * - --execute is the only write path and requires operator INFISICAL_TOKEN;
 * - secret plaintext never appears in argv, stdout/stderr, GitHub, or errors;
 * - write uses a 0600 temporary YAML file consumed by the Infisical CLI;
 * - post-write read-back must byte-match the recovery source.
 */
import { spawnSync } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INFISICAL_JSON_PATH = resolve(REPO_ROOT, '.infisical.json');
const API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const SECRET_NAME = 'BETTER_AUTH_SECRET';
const SOURCE_ENV = 'dev';
const TARGET_ENV = 'prod';
const HTTP_TIMEOUT_MS = 10_000;
const HTTP_MAX_BYTES = 256 * 1024;
const CLI_TIMEOUT_MS = 30_000;

function parseArgs(argv) {
	let mode = 'dry-run';
	let explicitMode = false;
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') return { help: true, mode };
		if (arg === '--dry-run' || arg === '--verify' || arg === '--execute') {
			if (explicitMode) {
				throw new Error('Choose exactly one of --dry-run, --verify, or --execute');
			}
			explicitMode = true;
			mode = arg.slice(2);
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return { help: false, mode };
}

function printHelp() {
	console.log(`Usage: reconcile-prod-auth-secret.mjs [--dry-run | --verify | --execute]

Issue #122 one-time reconciliation:
  source = Infisical dev  / BETTER_AUTH_SECRET
  target = Infisical prod / BETTER_AUTH_SECRET

--dry-run  default; prints the fixed plan only, no network access
--verify   read-only; compares source and target without printing either value
--execute  if different, overwrites only prod BETTER_AUTH_SECRET and verifies read-back

INFISICAL_TOKEN is required for --verify and --execute.
No mode changes Cloudflare Worker bindings or BETTER_AUTH_SECRETS.`);
}

function readWorkspaceId() {
	if (!existsSync(INFISICAL_JSON_PATH)) {
		throw new Error('.infisical.json not found');
	}
	const parsed = JSON.parse(readFileSync(INFISICAL_JSON_PATH, 'utf8'));
	if (typeof parsed.workspaceId !== 'string' || parsed.workspaceId.length === 0) {
		throw new Error('.infisical.json#workspaceId must be a non-empty string');
	}
	return parsed.workspaceId;
}

function httpsGetJson(urlString, token, { allowNotFound = false } = {}) {
	const url = new URL(urlString);
	return new Promise((resolvePromise, rejectPromise) => {
		const req = httpsRequest(
			{
				method: 'GET',
				hostname: url.hostname,
				port: url.port || 443,
				path: url.pathname + url.search,
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${token}`,
				},
				timeout: HTTP_TIMEOUT_MS,
			},
			(res) => {
				const chunks = [];
				let total = 0;
				res.setEncoding('utf8');
				res.on('data', (chunk) => {
					total += Buffer.byteLength(chunk);
					if (total > HTTP_MAX_BYTES) {
						res.destroy();
						rejectPromise(new Error('Infisical response exceeded safety limit'));
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () => {
					if (allowNotFound && res.statusCode === 404) {
						resolvePromise(null);
						return;
					}
					if (res.statusCode !== 200) {
						rejectPromise(new Error(`Infisical read failed with HTTP ${res.statusCode}`));
						return;
					}
					try {
						resolvePromise(JSON.parse(chunks.join('')));
					} catch {
						rejectPromise(new Error('Infisical response was not valid JSON'));
					}
				});
			},
		);
		req.on('timeout', () => req.destroy(new Error('Infisical read timed out')));
		req.on('error', rejectPromise);
		req.end();
	});
}

// Pure seam: builds the GET URL for `httpsGetJson` to read a single secret
// from the Infisical `/api/v3/secrets/raw/{name}` endpoint.
//
// Do NOT include `type=personal` or `type=shared` in the query. The Infisical
// API rejects direct `type` specification on this endpoint (HTTP 422), and
// filtering by `type=personal` excludes shared secrets (HTTP 404). The
// default (no `type` key) resolves to the project's actual storage type
// (shared, in this project's case), which is what G1 source/target reads
// require.
function buildSecretReadUrl({ apiUrl, workspaceId, environment }) {
	const params = new URLSearchParams({
		workspaceId,
		environment,
		secretPath: '/',
		viewSecretValue: 'true',
	});
	return `${apiUrl.replace(/\/+$/, '')}/api/v3/secrets/raw/${SECRET_NAME}?${params.toString()}`;
}

async function readSecret({ apiUrl, token, workspaceId, environment, allowMissing = false }) {
	const url = buildSecretReadUrl({ apiUrl, workspaceId, environment });
	const response = await httpsGetJson(url, token, { allowNotFound: allowMissing });
	return interpretReadResponse({ response, allowMissing, environment });
}

// Pure seam: interprets the parsed JSON body returned by `httpsGetJson`
// for the `/api/v3/secrets/raw/{name}` endpoint. Pins the existing G1 contract:
//   - source/dev 404 → throw (the script must surface a hard failure)
//   - target/prod 404 + allowMissing=true → return null (idempotent first write)
//   - target/prod 404 + allowMissing=false → throw
//   - any environment with empty/missing secretValue → throw
function interpretReadResponse({ response, allowMissing, environment }) {
	if (response === null && allowMissing) return null;
	if (typeof response?.secretValue !== 'string' || response.secretValue.length === 0) {
		throw new Error(`${SECRET_NAME} is missing or empty in environment=${environment}`);
	}
	return response.secretValue;
}

function secretValuesEqual(left, right) {
	const a = Buffer.from(left, 'utf8');
	const b = Buffer.from(right, 'utf8');
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

function buildYamlContent(secretValue) {
	// JSON double-quoted strings are valid YAML 1.2 scalars and safely escape
	// quotes, backslashes, CR/LF, and control characters.
	return `---\n"${SECRET_NAME}": ${JSON.stringify(secretValue)}\n`;
}

function resolveInfisicalCliPath() {
	const require = createRequire(import.meta.url);
	const pkgPath = require.resolve('@infisical/cli/package.json');
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
	const binRel =
		typeof pkg.bin === 'string'
			? pkg.bin
			: pkg.bin && typeof pkg.bin.infisical === 'string'
				? pkg.bin.infisical
				: null;
	if (binRel === null) {
		throw new Error('@infisical/cli package does not declare the infisical binary');
	}
	const cliPath = resolve(dirname(pkgPath), binRel);
	if (cliPath.endsWith('.js')) {
		throw new Error('Infisical CLI resolved to a JS shim; native binary required');
	}
	return cliPath;
}

function buildInfisicalSetArgs(yamlPath) {
	return ['secrets', 'set', '--file', yamlPath, '--env', TARGET_ENV, '--path', '/'];
}

function writeTargetSecretViaCli({ value, token }) {
	const tempDir = mkdtempSync(resolve(tmpdir(), 'my-web-2026-issue-122-'));
	const yamlPath = resolve(tempDir, 'secret.yaml');
	try {
		writeFileSync(yamlPath, buildYamlContent(value), { encoding: 'utf8', mode: 0o600 });
		const result = spawnSync(resolveInfisicalCliPath(), buildInfisicalSetArgs(yamlPath), {
			cwd: REPO_ROOT,
			shell: false,
			encoding: 'utf8',
			timeout: CLI_TIMEOUT_MS,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				INFISICAL_TOKEN: token,
				INFISICAL_API_URL: process.env.INFISICAL_API_URL ?? API_URL_DEFAULT,
			},
		});
		if (result.error) throw new Error(`Infisical CLI failed to spawn: ${result.error.message}`);
		if (result.signal) throw new Error(`Infisical CLI terminated by signal ${result.signal}`);
		if (result.status !== 0) {
			throw new Error(`Infisical CLI exited with status ${result.status}`);
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	if (args.mode === 'dry-run') {
		console.log('[dry-run] Issue #122 reconciliation plan');
		console.log(`[dry-run] source: ${SOURCE_ENV}/${SECRET_NAME}`);
		console.log(`[dry-run] target: ${TARGET_ENV}/${SECRET_NAME}`);
		console.log('[dry-run] execute writes only when source and target differ');
		console.log('[dry-run] plaintext is never printed or passed in argv');
		console.log('[dry-run] no Cloudflare Worker mutation; no BETTER_AUTH_SECRETS mutation');
		return;
	}

	const token = process.env.INFISICAL_TOKEN;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error('INFISICAL_TOKEN is required for --verify and --execute');
	}
	const workspaceId = readWorkspaceId();
	const apiUrl = process.env.INFISICAL_API_URL ?? API_URL_DEFAULT;

	const sourceValue = await readSecret({
		apiUrl,
		token,
		workspaceId,
		environment: SOURCE_ENV,
	});
	const currentTargetValue = await readSecret({
		apiUrl,
		token,
		workspaceId,
		environment: TARGET_ENV,
		allowMissing: true,
	});
	const alreadyEqual =
		currentTargetValue !== null && secretValuesEqual(sourceValue, currentTargetValue);

	if (args.mode === 'verify') {
		console.log(
			`[verify] ${SOURCE_ENV} and ${TARGET_ENV} ${SECRET_NAME}: ${alreadyEqual ? 'MATCH' : currentTargetValue === null ? 'TARGET_MISSING' : 'DIFFER'}`,
		);
		process.exitCode = alreadyEqual ? 0 : 2;
		return;
	}

	if (alreadyEqual) {
		console.log('[execute] target already matches recovery source; no write needed');
		console.log('[execute] Issue #122 reconciliation verified');
		return;
	}

	console.log('[execute] target differs; reconciling prod audit copy from known recovery source');
	writeTargetSecretViaCli({ value: sourceValue, token });

	const readBackValue = await readSecret({
		apiUrl,
		token,
		workspaceId,
		environment: TARGET_ENV,
	});
	if (!secretValuesEqual(sourceValue, readBackValue)) {
		throw new Error('Post-write read-back comparison failed');
	}
	console.log('[execute] read-back byte comparison: MATCH');
	console.log('[execute] Issue #122 reconciliation verified');
}

export {
	SOURCE_ENV,
	TARGET_ENV,
	SECRET_NAME,
	parseArgs,
	secretValuesEqual,
	buildYamlContent,
	buildInfisicalSetArgs,
	buildSecretReadUrl,
	interpretReadResponse,
};

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`reconcile-prod-auth-secret failed: ${error?.message ?? error}`);
		process.exit(1);
	});
}
