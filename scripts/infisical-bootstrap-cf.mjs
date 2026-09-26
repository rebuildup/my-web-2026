#!/usr/bin/env node
/**
 * ADR-0015 §11 / Phase 1 #67 — Machine Identity + Universal Auth +
 * Cloudflare Workers Builds trigger binding.
 *
 * Creates (or reuses) the `my-web-2026-cf-worker` Machine Identity
 * in Infisical, attaches Universal Auth to the project, generates a
 * new client secret, and binds the credentials to the production
 * Workers Builds trigger's build-time env vars
 * (`INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET`) via the
 * Cloudflare Builds API.
 *
 * Critical invariants (operator-mandated, 2026-09-27):
 *   1. **Client secret is in-memory only.** Never written to disk in
 *      the repo, never echoed to stdout / stderr / log / error. The
 *      secret is captured from the API response, passed to the
 *      Cloudflare Builds PATCH request body, and then nulled out
 *      before the process exits.
 *   2. **No pre-emptive revoke.** Decision-tree idempotency: if the
 *      identity + Universal Auth + Builds env keys already exist,
 *      print "already bound" and exit cleanly. If only the Builds
 *      env keys are missing, generate a NEW client secret (do not
 *      revoke the old one — revoking mid-flight would break
 *      production builds that are still using the old credential).
 *      Cleanup of redundant old credentials happens only after the
 *      new binding is verified.
 *   3. **PATCH body shape is an object map** keyed by variable
 *      name — NOT an array of `{name, value, is_secret}`. Cloudflare
 *      API contract.
 *   4. **Trigger discovery via Worker tag → triggers list.** The
 *      production trigger UUID is NOT in `wrangler.production.jsonc`.
 *      The script discovers it via
 *      `GET /accounts/{accountId}/builds/workers/{tag}/triggers`.
 *
 * Usage:
 *   INFISICAL_TOKEN=... \
 *   CLOUDFLARE_API_TOKEN=... \
 *   CLOUDFLARE_ACCOUNT_ID=... \
 *   node scripts/infisical-bootstrap-cf.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INFISICAL_JSON_PATH = resolve(REPO_ROOT, '.infisical.json');
const WRANGLER_PRODUCTION_CONFIG = resolve(REPO_ROOT, 'wrangler.production.jsonc');

const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const MACHINE_IDENTITY_NAME = 'my-web-2026-cf-worker';
const BUILD_ENV_VARS = ['INFISICAL_CLIENT_ID', 'INFISICAL_CLIENT_SECRET'];
const HTTPS_TIMEOUT_MS = 10_000;
const HTTPS_MAX_RESPONSE_BYTES = 64 * 1024;

function printHelp() {
	console.log(`Usage: infisical-bootstrap-cf.mjs

ADR-0015 §11 Phase 1 #67 — Machine Identity + Universal Auth +
Cloudflare Workers Builds trigger binding.

Reads:
  INFISICAL_TOKEN             Infisical Universal Auth access token
  CLOUDFLARE_API_TOKEN       user-scoped Cloudflare API token with
                             Workers Builds Configuration: Edit +
                             Workers Scripts: Read
  CLOUDFLARE_ACCOUNT_ID      Cloudflare account id (from
                             wrangler.production.jsonc#account_id)
  CF_TRIGGER_UUID            optional override; bypass trigger
                             discovery when set (for re-runs after a
                             discovery mismatch)

Side effects:
  - Infisical: identity + Universal Auth + project membership +
    client secret (POST /api/v1/...)
  - Cloudflare Builds: PATCH trigger env vars (object-map body)

  -h, --help                 show this help`);
}

function parseArgs(argv) {
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return {};
}

/**
 * Low-level HTTPS helper. Returns the parsed JSON body or throws on
 * non-2xx status. Never logs the response body on error (may carry
 * diagnostic text but never secrets — still, the invariant is to
 * log only status code).
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
							new Error(`Cloudflare response exceeded ${HTTPS_MAX_RESPONSE_BYTES} bytes`),
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
						rejectPromise(new Error(`Cloudflare response was not valid JSON: ${cause.message}`));
					}
				});
			},
		);
		req.on('timeout', () => {
			req.destroy(new Error(`Cloudflare request timed out after ${HTTPS_TIMEOUT_MS}ms`));
		});
		req.on('error', rejectPromise);
		if (bodyJson !== undefined) {
			req.end(bodyJson);
		} else {
			req.end();
		}
	});
}

/* ------------------------------------------------------------------ */
/* Pure helpers (regex-extractable for test pinning)                  */
/* ------------------------------------------------------------------ */

/**
 * Strip `// line` and `/* block *\/` comments from JSONC, then
 * parse. Returns the resulting object. Used to read
 * `wrangler.production.jsonc#account_id` + `name`.
 */
function parseJsonc(source) {
	// Remove block comments (non-greedy, multi-line).
	const noBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
	// Remove line comments (// to end of line), but NOT inside string
	// literals. The simple regex below is sufficient for wrangler
	// config files (no // inside string values).
	const noLineComments = noBlockComments.replace(/(^|[^:])\/\/.*$/gm, '$1');
	return JSON.parse(noLineComments);
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

function readWranglerProduction() {
	if (!existsSync(WRANGLER_PRODUCTION_CONFIG)) {
		throw new Error(`wrangler.production.jsonc not found at ${WRANGLER_PRODUCTION_CONFIG}`);
	}
	return parseJsonc(readFileSync(WRANGLER_PRODUCTION_CONFIG, 'utf8'));
}

/**
 * Build the object-map body for the Cloudflare Builds PATCH. Pure
 * helper — keys map to `{value, is_secret}`. Exported (top-level
 * function) so tests can pin the body shape.
 */
function buildBuildsEnvVarsPatchBody({ clientId, clientSecret: secret }) {
	if (typeof clientId !== 'string' || clientId.length === 0) {
		throw new Error('clientId must be a non-empty string');
	}
	if (typeof secret !== 'string' || secret.length === 0) {
		throw new Error('credential field must be a non-empty string');
	}
	return {
		INFISICAL_CLIENT_ID: { value: clientId, is_secret: true },
		INFISICAL_CLIENT_SECRET: { value: secret, is_secret: true },
	};
}

/**
 * Filter a triggers list response to the production-shaped trigger.
 *
 * Returns:
 *   - `null` when no production-shaped trigger exists (no
 *     `deployment_enabled=true` with `branch in {main, release-*}`).
 *   - the single matching trigger when exactly one candidate exists.
 *   - **throws** when multiple production-shaped triggers exist.
 *     Selection by array order is unsafe (Cloudflare returns the
 *     order it wants, not the operator's preferred order) — the
 *     caller must disambiguate by setting `CF_TRIGGER_UUID`
 *     explicitly. Pure helper — exposed for tests.
 */
function selectProductionTrigger(triggers) {
	if (!Array.isArray(triggers)) return null;
	const matches = triggers.filter(
		(trigger) =>
			trigger?.deployment_enabled === true &&
			(trigger?.branch === 'main' ||
				(typeof trigger?.branch === 'string' && trigger.branch.startsWith('release-'))),
	);
	if (matches.length === 0) return null;
	if (matches.length > 1) {
		throw new Error(
			`multiple production-shaped triggers found (count=${matches.length}); set CF_TRIGGER_UUID explicitly to disambiguate`,
		);
	}
	return matches[0];
}

/**
 * Discover the Worker tag for `name` from a worker list response.
 * Returns the tag string or null. Pure helper — exposed for tests.
 */
function findWorkerTag(workersList, workerName) {
	if (!Array.isArray(workersList)) return null;
	const found = workersList.find((w) => w?.name === workerName);
	return found?.tag ?? null;
}

/* ------------------------------------------------------------------ */
/* Cloudflare Builds API calls (side-effectful)                       */
/* ------------------------------------------------------------------ */

function listCloudflareWorkersBuildsWorkers({ accountId, token }) {
	return httpsRequestJson(
		'GET',
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/workers`,
		{ token },
	);
}

function listCloudflareBuildsTriggers({ accountId, token, workerTag }) {
	return httpsRequestJson(
		'GET',
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/workers/${workerTag}/triggers`,
		{ token },
	);
}

function getCloudflareBuildsEnvVars({ accountId, token, triggerUuid }) {
	return httpsRequestJson(
		'GET',
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/triggers/${triggerUuid}/environment_variables`,
		{ token },
	);
}

function patchCloudflareBuildsEnvVars({ accountId, token, triggerUuid, envVarsBody }) {
	return httpsRequestJson(
		'PATCH',
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/triggers/${triggerUuid}/environment_variables`,
		{ token, body: envVarsBody },
	);
}

/* ------------------------------------------------------------------ */
/* Infisical Machine Identity + Universal Auth (side-effectful)       */
/* ------------------------------------------------------------------ */

async function findIdentity({ apiUrl, token, name }) {
	const base = apiUrl.replace(/\/+$/, '');
	// List endpoint shape is `{ identities: [...], totalCount }`
	// (Infisical v1 API). Read `.identities` before filtering.
	const response = await httpsRequestJson('GET', `${base}/api/v1/identities`, { token });
	const list = Array.isArray(response?.identities) ? response.identities : null;
	if (list === null) return null;
	return list.find((identity) => identity?.name === name) ?? null;
}

async function createIdentity({ apiUrl, token, name }) {
	const base = apiUrl.replace(/\/+$/, '');
	const created = await httpsRequestJson('POST', `${base}/api/v1/identities`, {
		token,
		body: { name },
	});
	return created;
}

async function ensureProjectMembership({ apiUrl, token, identityId, projectId }) {
	const base = apiUrl.replace(/\/+$/, '');
	// Try to attach. On 409 (already attached), look up via list and
	// verify the membership exists. On other 4xx, abort explicitly.
	try {
		await httpsRequestJson('POST', `${base}/api/v1/identities/${identityId}/project-memberships`, {
			token,
			body: { projectId },
		});
		return { created: true };
	} catch (error) {
		if (!/HTTP 409/.test(error.message)) throw error;
		return { created: false };
	}
}

async function ensureUniversalAuth({ apiUrl, token, identityId }) {
	const base = apiUrl.replace(/\/+$/, '');
	// Universal Auth attach is idempotent: POSTing again returns 200
	// or 409 (already attached). Either is success.
	try {
		await httpsRequestJson('POST', `${base}/api/v1/identities/${identityId}/universal-auth`, {
			token,
			body: {},
		});
		return { created: true };
	} catch (error) {
		if (!/HTTP 409/.test(error.message)) throw error;
		return { created: false };
	}
}

async function generateClientSecret({ apiUrl, token, identityId }) {
	const base = apiUrl.replace(/\/+$/, '');
	// Always generates a NEW client secret. The previous secret
	// remains valid until it is explicitly revoked (we never revoke
	// in this script — see Sub-step 67.4 in the plan).
	//
	// Infisical API response shape: top-level `clientSecret` plus
	// `clientSecretData` metadata. **No `clientId` here** — the
	// `clientId` is owned by the Universal Auth identity, not by
	// the secret. Caller must fetch it from
	// `GET /api/v1/auth/universal-auth/identities/{identityId}`.
	const response = await httpsRequestJson(
		'POST',
		`${base}/api/v1/auth/universal-auth/identities/${identityId}/client-secrets`,
		{ token, body: {} },
	);
	const secret = response?.clientSecret;
	if (typeof secret !== 'string' || secret.length === 0) {
		throw new Error('client-secrets response missing required credential field');
	}
	return secret;
}

async function getUniversalAuthClientId({ apiUrl, token, identityId }) {
	const base = apiUrl.replace(/\/+$/, '');
	// Read the Universal Auth config for the identity. The
	// `clientId` is stable across secret rotations — it's the
	// identity's public identifier in the Universal Auth flow.
	const response = await httpsRequestJson(
		'GET',
		`${base}/api/v1/auth/universal-auth/identities/${identityId}`,
		{ token },
	);
	const clientId = response?.clientId;
	if (typeof clientId !== 'string' || clientId.length === 0) {
		throw new Error('Universal Auth response missing clientId');
	}
	return clientId;
}

/* ------------------------------------------------------------------ */
/* Main flow                                                          */
/* ------------------------------------------------------------------ */

async function discoverProductionTriggerUuid({ accountId, cloudflareToken, workerName }) {
	if (typeof process.env.CF_TRIGGER_UUID === 'string' && process.env.CF_TRIGGER_UUID.length > 0) {
		return { triggerUuid: process.env.CF_TRIGGER_UUID, source: 'env override' };
	}
	const workersResponse = await listCloudflareWorkersBuildsWorkers({
		accountId,
		token: cloudflareToken,
	});
	// Cloudflare API v4 envelope: `{ success, errors, messages, result }`.
	// Unwrap `.result` before passing to the pure helpers.
	const tag = findWorkerTag(workersResponse?.result, workerName);
	if (tag === null) {
		throw new Error(
			`Worker '${workerName}' not found in Cloudflare Builds workers list. Set CF_TRIGGER_UUID explicitly to bypass discovery.`,
		);
	}
	const triggersResponse = await listCloudflareBuildsTriggers({
		accountId,
		token: cloudflareToken,
		workerTag: tag,
	});
	const trigger = selectProductionTrigger(triggersResponse?.result);
	if (!trigger) {
		throw new Error(
			`No production-shaped trigger (deployment_enabled=true, branch in {main, release-*}) found for Worker '${workerName}'. Set CF_TRIGGER_UUID explicitly.`,
		);
	}
	return { triggerUuid: trigger.uuid, source: `tag=${tag}` };
}

async function main() {
	parseArgs(process.argv.slice(2));

	const infisicalApiUrl = process.env.INFISICAL_API_URL ?? INFISICAL_API_URL_DEFAULT;
	const infisicalToken = process.env.INFISICAL_TOKEN;
	const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN;
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

	if (typeof infisicalToken !== 'string' || infisicalToken.length === 0) {
		throw new Error('INFISICAL_TOKEN env var is required');
	}
	if (typeof cloudflareToken !== 'string' || cloudflareToken.length === 0) {
		throw new Error(
			'CLOUDFLARE_API_TOKEN env var is required (user-scoped token with Workers Builds Configuration: Edit + Workers Scripts: Read)',
		);
	}
	if (typeof accountId !== 'string' || accountId.length === 0) {
		throw new Error('CLOUDFLARE_ACCOUNT_ID env var is required');
	}

	const workspaceId = readInfisicalWorkspaceId();
	const wranglerProd = readWranglerProduction();
	const workerName = wranglerProd.name;
	if (typeof workerName !== 'string' || workerName.length === 0) {
		throw new Error('wrangler.production.jsonc#name must be a non-empty string');
	}
	console.log(`Worker name (from wrangler.production.jsonc): ${workerName}`);
	console.log(`Workspace (from .infisical.json): ${workspaceId}`);

	// ---- Identity + Universal Auth ----
	let identity = await findIdentity({
		apiUrl: infisicalApiUrl,
		token: infisicalToken,
		name: MACHINE_IDENTITY_NAME,
	});
	if (!identity) {
		identity = await createIdentity({
			apiUrl: infisicalApiUrl,
			token: infisicalToken,
			name: MACHINE_IDENTITY_NAME,
		});
		console.log(`Identity created: ${MACHINE_IDENTITY_NAME}`);
	} else {
		console.log(`Identity exists: ${MACHINE_IDENTITY_NAME} (id=${identity.id})`);
	}
	const identityId = identity.id;
	if (typeof identityId !== 'string' || identityId.length === 0) {
		throw new Error('identity.id missing from Infisical response');
	}

	const membership = await ensureProjectMembership({
		apiUrl: infisicalApiUrl,
		token: infisicalToken,
		identityId,
		projectId: workspaceId,
	});
	console.log(
		`Project membership: ${membership.created ? 'created' : 'already exists'} (project=${workspaceId})`,
	);

	const universalAuth = await ensureUniversalAuth({
		apiUrl: infisicalApiUrl,
		token: infisicalToken,
		identityId,
	});
	console.log(`Universal Auth: ${universalAuth.created ? 'attached' : 'already attached'}`);

	// ---- Trigger discovery ----
	const { triggerUuid, source } = await discoverProductionTriggerUuid({
		accountId,
		cloudflareToken,
		workerName,
	});
	console.log(`Production trigger: ${triggerUuid} (${source})`);

	// ---- Builds env vars ----
	const existingEnvResponse = await getCloudflareBuildsEnvVars({
		accountId,
		token: cloudflareToken,
		triggerUuid,
	});
	// Cloudflare API v4 envelope: `{ success, errors, messages, result }`.
	// Unwrap `.result` — it's the env-var object map keyed by name.
	const existingEnvResult = existingEnvResponse?.result;
	const existingKeys =
		existingEnvResult && typeof existingEnvResult === 'object' && !Array.isArray(existingEnvResult)
			? Object.keys(existingEnvResult)
			: [];
	const allKeysPresent = BUILD_ENV_VARS.every((key) => existingKeys.includes(key));

	if (allKeysPresent) {
		console.log(
			`Workers Builds env: ${BUILD_ENV_VARS.length} keys already bound (values redacted by Cloudflare)`,
		);
		for (const key of BUILD_ENV_VARS) {
			console.log(`  ✓ ${key}`);
		}
		console.log('No-op: nothing to bind.');
		return;
	}

	// Generate a new client secret (do NOT revoke any existing ones).
	// Use `let` so we can null-out the credentials before exit (heap
	// inspector mitigation; invariant: secret never persists beyond
	// the process lifetime).
	let clientSecret = await generateClientSecret({
		apiUrl: infisicalApiUrl,
		token: infisicalToken,
		identityId,
	});
	let clientId = await getUniversalAuthClientId({
		apiUrl: infisicalApiUrl,
		token: infisicalToken,
		identityId,
	});

	const envVarsBody = buildBuildsEnvVarsPatchBody({ clientId, clientSecret });
	const patchResponse = await patchCloudflareBuildsEnvVars({
		accountId,
		token: cloudflareToken,
		triggerUuid,
		envVarsBody,
	});
	if (!patchResponse || typeof patchResponse !== 'object' || !patchResponse.success) {
		throw new Error('Cloudflare Builds PATCH did not return success:true');
	}

	// Verify via GET (values are null in the list response — we never
	// see the secret).
	const verifiedResponse = await getCloudflareBuildsEnvVars({
		accountId,
		token: cloudflareToken,
		triggerUuid,
	});
	const verifiedResult = verifiedResponse?.result;
	const verifiedKeys =
		verifiedResult && typeof verifiedResult === 'object' && !Array.isArray(verifiedResult)
			? Object.keys(verifiedResult)
			: [];
	for (const key of BUILD_ENV_VARS) {
		const present = verifiedKeys.includes(key);
		console.log(`  ${present ? '✓' : '✗'} ${key}`);
		if (!present) {
			throw new Error(`Verify failed: '${key}' not present in Builds env after PATCH`);
		}
	}

	// Discard in-process credentials. Force overwrite + null; the
	// JavaScript GC will reclaim the strings, but explicit nulling
	// reduces the window where a heap inspector could recover them.
	clientId = null;
	clientSecret = null;

	console.log(`Workers Builds env: ${BUILD_ENV_VARS.length} keys bound`);
	console.log('  (credential values redacted by Cloudflare list response)');
}

main().catch((error) => {
	console.error(`infisical-bootstrap-cf failed: ${error?.message ?? error}`);
	process.exit(1);
});
