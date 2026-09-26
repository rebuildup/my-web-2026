#!/usr/bin/env node
/**
 * ADR-0015 §11 / Phase 1 #67 — Machine Identity + Universal Auth +
 * Cloudflare Workers Builds trigger binding.
 *
 * Creates (or reuses) the `my-web-2026-cf-worker` Machine Identity
 * in Infisical, attaches Universal Auth, generates a new client
 * secret, and binds the credentials to the production Workers
 * Builds trigger's build-time env vars
 * (`INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET`) via the
 * Cloudflare Builds API.
 *
 * Self-host API surface (v0.165.x) — probed 2026-09-27:
 *   - `GET  /api/v1/identities?orgId=<uuid>`
 *         → 200 `{ identities: [...], totalCount: N }`. NOTE: on
 *           this self-host the `identities[]` array is ALWAYS empty
 *           even when `totalCount > 0` — a self-host bug. List-then-
 *           filter by name is therefore impossible; the script must
 *           accept an explicit `INFISICAL_IDENTITY_ID` env override
 *           to reuse an existing identity.
 *   - `POST /api/v1/identities` body `{name, organizationId}`
 *         → 200 `{ identity: {id, name, ..., authMethods: []} }`.
 *           Self-host does NOT enforce name uniqueness — POSTing
 *           the same name twice succeeds twice with different IDs.
 *           Operator MUST pass `INFISICAL_IDENTITY_ID` to reuse.
 *   - `POST /api/v1/auth/universal-auth/identities/{id}` body `{}`
 *         → 200 `{ identityUniversalAuth: {id, clientId, ...} }`.
 *           Idempotency: 2nd POST returns 400 "Failed to add
 *           universal auth to already configured identity" — the
 *           script treats this as success (already attached).
 *   - `POST /api/v1/auth/universal-auth/identities/{id}/client-secrets`
 *         body `{}` → 200 `{ clientSecret, clientSecretData }`.
 *           Generates a NEW secret every call. No pre-emptive revoke
 *           (old secrets remain valid).
 *   - **Project-membership attach**: no discoverable REST endpoint
 *     on this self-host. `POST .../identities/{id}/project-memberships`
 *     returns 404. The script logs a warning and continues — the
 *     Universal Auth attach + client-secret generation can still
 *     succeed; the identity will simply not have project-scoped RBAC
 *     until the operator grants it manually via the Infisical UI.
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
 *   INFISICAL_IDENTITY_ID=<uuid-of-existing-identity> \  # optional override
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
const HTTPS_MAX_RESPONSE_BYTES = 256 * 1024;

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
  INFISICAL_IDENTITY_ID      optional override; reuse an existing
                             Machine Identity by id (required when
                             the self-host returns an empty
                             identities[] array; prevents duplicate
                             identity creation since the self-host
                             does not enforce name uniqueness)
  INFISICAL_ORG_ID           Organization UUID. Required — extracted
                             from JWT payload via jwtOrganizationId()
                             OR supplied as env var for non-user auth.

Side effects:
  - Infisical: identity + Universal Auth + client secret
    (POST /api/v1/...) — project-membership attach is logged as a
    warning on the v0.165.x self-host (no discoverable endpoint).
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

/**
 * Extract organization id (UUID) from a JWT payload, OR from the
 * multi-line `infisical user get token` output (which contains
 * `SessionID:...`, `Token:<jwt>`, `ExpiresAt:...`, `TTL:...`).
 *
 * Pure helper — exposed for tests. Returns `null` for any input
 * that doesn't yield a valid UUID.
 */
function jwtOrganizationId(jwtOrMultiLine) {
	if (typeof jwtOrMultiLine !== 'string') return null;
	const text = jwtOrMultiLine.trim();
	if (text.length === 0) return null;
	// Multi-line output: find a line that starts with `Token:` and
	// extract its value.
	let candidate = text;
	const tokenLineMatch = text.match(/^Token:\s*(\S+)/m);
	if (tokenLineMatch) {
		candidate = tokenLineMatch[1];
	}
	const parts = candidate.split('.');
	if (parts.length !== 3) return null;
	try {
		// Buffer.from is available without imports inside the
		// extracted-eval'd function only if we inline; the test
		// harness already provides Buffer. Use globalThis to keep
		// the helper import-free in test context.
		const BufferCtor = globalThis.Buffer;
		const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const padded = payloadB64 + '==='.slice(0, (4 - (payloadB64.length % 4)) % 4);
		const json = BufferCtor.from(padded, 'base64').toString('utf8');
		const payload = JSON.parse(json);
		const orgId = payload?.organizationId;
		if (typeof orgId !== 'string') return null;
		return orgId;
	} catch {
		return null;
	}
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
 * helper — keys map to `{value, is_secret}`. Exposed (top-level
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

/**
 * Look up an existing identity by id. Returns null if the id is
 * not provided or the GET 404s. The self-host v0.165.x has a bug
 * in the LIST endpoint (`identities[]` always empty even when
 * `totalCount > 0`), so list-then-filter is not viable; the
 * operator must pass `INFISICAL_IDENTITY_ID` to reuse an existing
 * identity. Pure helper — exposed for tests.
 */
async function getIdentityById({ apiUrl, token, identityId }) {
	const base = apiUrl.replace(/\/+$/, '');
	if (typeof identityId !== 'string' || identityId.length === 0) {
		return null;
	}
	try {
		const response = await httpsRequestJson(
			'GET',
			`${base}/api/v1/identities/${encodeURIComponent(identityId)}`,
			{ token },
		);
		const identity = response?.identity ?? response;
		return identity?.id ? identity : null;
	} catch (error) {
		// 404 = not found; any other status = propagate as a hard
		// failure.
		if (/HTTP 404/.test(error.message)) return null;
		throw error;
	}
}

async function createIdentity({ apiUrl, token, name, organizationId }) {
	const base = apiUrl.replace(/\/+$/, '');
	const response = await httpsRequestJson('POST', `${base}/api/v1/identities`, {
		token,
		body: { name, organizationId },
	});
	// Self-host returns `{ identity: {...} }` (wrapper) on success.
	return response?.identity ?? response;
}

async function ensureUniversalAuth({ apiUrl, token, identityId }) {
	const base = apiUrl.replace(/\/+$/, '');
	// Idempotency: POSTing twice returns 400 "Failed to add
	// universal auth to already configured identity" on the
	// v0.165.x self-host. Treat 400 as "already attached".
	try {
		const response = await httpsRequestJson(
			'POST',
			`${base}/api/v1/auth/universal-auth/identities/${identityId}`,
			{ token, body: {} },
		);
		return { created: true, universalAuth: response?.identityUniversalAuth };
	} catch (error) {
		// Already-configured detection: 400 with body matching
		// /already configured/. Any other 4xx is a real error.
		const alreadyConfigured =
			/HTTP 400/.test(error.message) || /already configured/i.test(error.message);
		if (!alreadyConfigured) throw error;
		// Fetch existing config so the caller has the clientId.
		const existing = await httpsRequestJson(
			'GET',
			`${base}/api/v1/auth/universal-auth/identities/${identityId}`,
			{ token },
		);
		return { created: false, universalAuth: existing?.identityUniversalAuth ?? existing };
	}
}

async function generateClientSecret({ apiUrl, token, identityId }) {
	const base = apiUrl.replace(/\/+$/, '');
	// Always generates a NEW client secret. The previous secret
	// remains valid until it is explicitly revoked (we never revoke
	// in this script).
	//
	// Infisical API response shape: top-level `clientSecret` plus
	// `clientSecretData` metadata. **No `clientId` here** — the
	// `clientId` is owned by the Universal Auth identity, not by
	// the secret.
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
	if (typeof cloudflareToken !== 'string' || cloudflareToken.length > 0) {
		// Cloudflare side is optional — bootstrap-cf can still
		// create the Machine Identity + Universal Auth + client
		// secret even if CLOUDFLARE_API_TOKEN is absent (the
		// binding step will be skipped).
	}
	if (typeof accountId !== 'string' || accountId.length > 0) {
		// Same: Cloudflare side is optional.
	}

	// Resolve organizationId: env override > JWT extraction.
	let organizationId = process.env.INFISICAL_ORG_ID;
	if (typeof organizationId !== 'string' || organizationId.length === 0) {
		// Try extracting from JWT (handles multi-line CLI output
		// too).
		organizationId = jwtOrganizationId(infisicalToken);
	}
	if (typeof organizationId !== 'string' || organizationId.length === 0) {
		throw new Error(
			'INFISICAL_ORG_ID env var is required (or a JWT with `organizationId` claim; universal-auth client tokens do not carry it).',
		);
	}

	const workspaceId = readInfisicalWorkspaceId();
	const wranglerProd = readWranglerProduction();
	const workerName = wranglerProd.name;
	if (typeof workerName !== 'string' || workerName.length === 0) {
		throw new Error('wrangler.production.jsonc#name must be a non-empty string');
	}
	console.log(`Worker name (from wrangler.production.jsonc): ${workerName}`);
	console.log(`Workspace (from .infisical.json): ${workspaceId}`);
	console.log(`Organization: ${organizationId}`);

	// ---- Identity ----
	// The self-host v0.165.x LIST endpoint is broken
	// (`identities[]` always empty), so list-then-filter by name is
	// impossible. We accept an explicit `INFISICAL_IDENTITY_ID`
	// override; otherwise the script will POST a new identity each
	// time (and accumulate duplicates since name uniqueness is
	// also not enforced). Operators should set the override after
	// the first successful run.
	let identity = null;
	const identityIdOverride = process.env.INFISICAL_IDENTITY_ID;
	if (typeof identityIdOverride === 'string' && identityIdOverride.length > 0) {
		identity = await getIdentityById({
			apiUrl: infisicalApiUrl,
			token: infisicalToken,
			identityId: identityIdOverride,
		});
		if (identity) {
			console.log(`Identity exists (INFISICAL_IDENTITY_ID override): ${MACHINE_IDENTITY_NAME}`);
		}
	}
	if (!identity) {
		console.warn(
			'INFISICAL_IDENTITY_ID not set; creating a new identity. ' +
				'On the v0.165.x self-host the LIST endpoint is broken ' +
				'(identities[] always empty) and name uniqueness is NOT ' +
				'enforced, so re-running without the override will create ' +
				'duplicate identities. After the first successful run, set ' +
				'INFISICAL_IDENTITY_ID=<id> for re-runs.',
		);
		identity = await createIdentity({
			apiUrl: infisicalApiUrl,
			token: infisicalToken,
			name: MACHINE_IDENTITY_NAME,
			organizationId,
		});
		console.log(`Identity created: ${MACHINE_IDENTITY_NAME} (id=${identity.id})`);
	} else {
		console.log(`Identity reused: ${MACHINE_IDENTITY_NAME} (id=${identity.id})`);
	}
	const identityId = identity.id;
	if (typeof identityId !== 'string' || identityId.length === 0) {
		throw new Error('identity.id missing from Infisical response');
	}

	// ---- Project membership (v0.165.x: not discoverable) ----
	// No documented REST endpoint on the v0.165.x self-host for
	// project-membership attach. The identity will be org-scoped
	// only; operator must grant project access via the Infisical
	// UI for project-scoped secret reads.
	console.warn(
		'Project-membership attach: SKIPPED (self-host v0.165.x has no ' +
			'discoverable REST endpoint for identity project-memberships — ' +
			'`POST /api/v1/identities/{id}/project-memberships` returns 404). ' +
			'Operator must grant project access manually if project-scoped ' +
			'secret reads are required.',
	);

	// ---- Universal Auth attach ----
	const universalAuthResult = await ensureUniversalAuth({
		apiUrl: infisicalApiUrl,
		token: infisicalToken,
		identityId,
	});
	const universalAuth = universalAuthResult.universalAuth ?? universalAuthResult;
	let clientId = universalAuth?.clientId;
	if (typeof clientId !== 'string' || clientId.length === 0) {
		throw new Error(
			'universal-auth response missing clientId (cannot bind to Cloudflare Builds without it)',
		);
	}
	console.log(
		`Universal Auth: ${universalAuthResult.created ? 'attached' : 'already attached'} (clientId redacted)`,
	);

	// ---- Trigger discovery (Cloudflare side, optional) ----
	if (typeof cloudflareToken !== 'string' || cloudflareToken.length === 0) {
		console.log('CLOUDFLARE_API_TOKEN not set — skipping Workers Builds binding step.');
		console.log('Identity + Universal Auth + client secret created successfully.');
		return;
	}
	if (typeof accountId !== 'string' || accountId.length === 0) {
		throw new Error(
			'CLOUDFLARE_ACCOUNT_ID env var is required for the Workers Builds binding step',
		);
	}
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
