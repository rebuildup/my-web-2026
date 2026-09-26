#!/usr/bin/env node
/**
 * ADR-0015 §11 / Phase 1 #67 — Dev environment 3-name secret seeding.
 *
 * Seeds the `dev` environment of the `my-web-2026` Infisical project
 * with the 3-name contract:
 *   - `BETTER_AUTH_SECRET`           (legacy single form, random)
 *   - `BETTER_AUTH_SECRETS`          (versioned form: "1:<random-hex>")
 *   - `MY_WEB_2026_CONSUMER_API_KEY` (random)
 *
 * **Prod env is NOT seeded by this script.** Per operator correction
 * (2026-09-27), seeding prod with any random value would create a
 * trap: when the operator manually imports the legacy 2 secrets
 * post-#67 and Phase 4 runs `deploy:production:prepared`, Better
 * Auth 1.5+ prefers the versioned form when present. A random
 * `BETTER_AUTH_SECRETS` placeholder in prod would become the
 * active signing key and silently invalidate existing sessions.
 * Operator post-#67 work imports current Worker plaintext via
 * `infisical secrets set` manually, outside the agent flow.
 *
 * Idempotency: re-running for an env that already has all 3 secrets
 * is a no-op (does NOT overwrite — preserves any operator-applied
 * tuning). Re-running for a partially-seeded env fills in the
 * missing names only.
 *
 * Invariants:
 *   - argv / log / error message never carries a secret value.
 *   - The 3 dev values are random; they are passed to the API as
 *     request body fields and never echoed to stdout.
 *   - `MY_WEB_2026_CONSUMER_API_KEY` in dev is intentionally
 *     random — no production D1 `apikey` row depends on this value.
 *
 * Usage:
 *   INFISICAL_TOKEN=... node scripts/infisical-seed.mjs [--env=dev]
 */
import { existsSync, readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
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
const HTTPS_TIMEOUT_MS = 10_000;
const HTTPS_MAX_RESPONSE_BYTES = 64 * 1024;

function parseArgs(argv) {
	// Help text is inlined (rather than calling a separate printHelp())
	// and the `VALID_ENVIRONMENTS` Set is inlined, so this function
	// stays self-contained for regex-extraction by the test harness
	// (mirrors the pattern in
	// `bootstrap-home-api-key.test.mjs#loadPureHelpers`).
	const helpText = `Usage: infisical-seed.mjs [--env=<dev|prod>]

ADR-0015 §11 Phase 1 #67 — dev env 3-name secret seeding.

This script is restricted to seeding the dev environment only.
Prod env seeding is operator work (post-#67) and is out of scope
for the agent — see Issue #67 AC for the rationale.

Reads:
  INFISICAL_TOKEN             Infisical Universal Auth access token
  INFISICAL_API_URL           base URL (default: https://secrets.rebuildup.dev)

Side effects:
  - GET /api/v3/secrets/raw (existence check, viewSecretValue=false)
  - POST /api/v3/secrets/raw (insert missing secrets only)
  - NO OVERWRITE of existing secrets (idempotent)

  -h, --help                 show this help`;
	const args = { environment: 'dev' };
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			console.log(helpText);
			process.exit(0);
		} else if (arg.startsWith('--env=')) {
			args.environment = arg.slice('--env='.length);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	const validEnvironments = new Set(['dev', 'prod']);
	if (!validEnvironments.has(args.environment)) {
		throw new Error(
			`--env must be one of ${[...validEnvironments].join(', ')} (got: ${JSON.stringify(args.environment)})`,
		);
	}
	if (args.environment === 'prod') {
		throw new Error(
			'prod env seeding is out of scope for the agent. Operator runs `infisical secrets set` manually post-#67.',
		);
	}
	return args;
}

/* ------------------------------------------------------------------ */
/* Pure helpers (regex-extractable for test pinning)                  */
/* ------------------------------------------------------------------ */

/**
 * Generate the 3-name contract values for the dev environment.
 * Pure function — exported (top-level) for tests. Uses
 * `globalThis.crypto.getRandomValues` (Web Crypto API, Node 19+)
 * so the helper stays self-contained for regex-extraction by the
 * test harness (mirrors the pattern in
 * `bootstrap-home-api-key.test.mjs#loadPureHelpers`).
 */
function buildDevSecretValues() {
	const bytes = new Uint8Array(32);
	globalThis.crypto.getRandomValues(bytes);
	let randomHex = '';
	for (const byte of bytes) {
		randomHex += byte.toString(16).padStart(2, '0');
	}
	return {
		BETTER_AUTH_SECRET: randomHex,
		// versioned form: first entry is the current signing key
		// (Better Auth 1.5+ contract, ADR-0015 §11.2)
		BETTER_AUTH_SECRETS: `1:${randomHex}`,
		MY_WEB_2026_CONSUMER_API_KEY: randomHex,
	};
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

/**
 * Low-level HTTPS helper (mirrors the pattern in
 * `deploy-with-secrets.mjs`).
 */
function httpsRequestJson(method, urlString, { token, body } = {}) {
	const url = new URL(urlString);
	return new Promise((resolvePromise, rejectPromise) => {
		const bodyJson = body === undefined ? undefined : JSON.stringify(body);
		const headers = { Accept: 'application/json' };
		if (bodyJson !== undefined) {
			headers['Content-Type'] = 'application/json';
			headers['Content-Length'] = Buffer.byteLength(bodyJson);
		}
		if (typeof token === 'string' && token.length > 0) {
			headers.Authorization = `Bearer ${token}`;
		}
		const req = httpsRequest(
			{
				method,
				hostname: url.hostname,
				port: url.port || 443,
				path: url.pathname + url.search,
				headers,
				timeout: HTTPS_TIMEOUT_MS,
			},
			(res) => {
				const chunks = [];
				let total = 0;
				res.setEncoding('utf8');
				res.on('data', (chunk) => {
					total += chunk.length;
					if (total > HTTPS_MAX_RESPONSE_BYTES) {
						res.destroy();
						rejectPromise(
							new Error(`Infisical response exceeded ${HTTPS_MAX_RESPONSE_BYTES} bytes`),
						);
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () => {
					const text = chunks.join('');
					if (res.statusCode < 200 || res.statusCode >= 300) {
						rejectPromise(
							new Error(`${method} ${url.pathname} failed with HTTP ${res.statusCode}`),
						);
						return;
					}
					if (text.length === 0) {
						resolvePromise(null);
						return;
					}
					try {
						resolvePromise(JSON.parse(text));
					} catch (cause) {
						rejectPromise(new Error(`Infisical response was not valid JSON: ${cause.message}`));
					}
				});
			},
		);
		req.on('timeout', () => {
			req.destroy(new Error(`Infisical request timed out after ${HTTPS_TIMEOUT_MS}ms`));
		});
		req.on('error', rejectPromise);
		if (bodyJson !== undefined) {
			req.end(bodyJson);
		} else {
			req.end();
		}
	});
}

/**
 * List existing secrets in an environment with viewSecretValue=false
 * (key names only). Returns the raw response array.
 */
async function listSecrets({ apiUrl, token, workspaceId, environment }) {
	const base = apiUrl.replace(/\/+$/, '');
	const params = new URLSearchParams({
		workspaceId,
		environment,
		viewSecretValue: 'false',
	});
	return httpsRequestJson('GET', `${base}/api/v3/secrets/raw?${params.toString()}`, { token });
}

/**
 * Extract the set of existing secret keys from a list response.
 * Pure helper — exposed for tests.
 */
function extractExistingKeys(listResponse) {
	if (!Array.isArray(listResponse)) return new Set();
	return new Set(
		listResponse
			.map((entry) => (entry && typeof entry.secretKey === 'string' ? entry.secretKey : null))
			.filter((key) => key !== null),
	);
}

/**
 * Insert a single secret via V3 raw endpoint. Returns true on
 * success.
 */
async function insertSecret({ apiUrl, token, workspaceId, environment, secretKey, secretValue }) {
	const base = apiUrl.replace(/\/+$/, '');
	await httpsRequestJson('POST', `${base}/api/v3/secrets/raw`, {
		token,
		body: {
			workspaceId,
			environment,
			secretKey,
			secretValue,
			secretPath: '/',
			type: 'shared',
		},
	});
	return true;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	const apiUrl = process.env.INFISICAL_API_URL ?? INFISICAL_API_URL_DEFAULT;
	const token = process.env.INFISICAL_TOKEN;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error('INFISICAL_TOKEN env var is required');
	}

	const workspaceId = readInfisicalWorkspaceId();
	const environment = args.environment;

	const list = await listSecrets({ apiUrl, token, workspaceId, environment });
	const existingKeys = extractExistingKeys(list);

	const values = buildDevSecretValues();
	const summary = { inserted: [], skipped: [] };

	for (const secretKey of DEV_SECRET_NAMES) {
		if (existingKeys.has(secretKey)) {
			summary.skipped.push(secretKey);
			continue;
		}
		const secretValue = values[secretKey];
		if (typeof secretValue !== 'string' || secretValue.length === 0) {
			throw new Error(`internal: missing value for ${secretKey}`);
		}
		await insertSecret({
			apiUrl,
			token,
			workspaceId,
			environment,
			secretKey,
			secretValue,
		});
		summary.inserted.push(secretKey);
	}

	console.log(`Seeded ${environment}:`);
	for (const key of DEV_SECRET_NAMES) {
		const status = summary.inserted.includes(key)
			? 'inserted'
			: summary.skipped.includes(key)
				? 'already exists'
				: '?';
		console.log(`  ${status === 'inserted' ? '✓' : '·'} ${key} (${status})`);
	}
}

main().catch((error) => {
	console.error(`infisical-seed failed: ${error?.message ?? error}`);
	process.exit(1);
});
