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
 *   - **Project-membership attach** (Issue #86): the canonical
 *     endpoint exists and is used. The earlier conclusion that no
 *     endpoint existed came from probing guessed paths only; the real
 *     surface is project-scoped:
 *       - `GET   /api/v1/projects/{projectId}/roles`
 *       - `GET   /api/v1/projects/{projectId}/memberships/identities/{identityId}`
 *       - `POST  /api/v1/projects/{projectId}/memberships/identities/{identityId}`
 *       - `PATCH /api/v1/projects/{projectId}/memberships/identities/{identityId}`
 *     POST accepts `{roles: [{role}]}` (or the deprecated flat
 *     `{role}`); PATCH accepts ONLY `roles`. A second POST returns
 *     400 "Identity is already a member".
 *     Convergence is driven entirely by the GET: satisfied → zero
 *     writes, absent → POST, wrong role → PATCH, and every write is
 *     confirmed by re-reading. See `convergeProjectMembership`.
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
import { ACCOUNT_ID, WORKER_NAME } from './_cloudflare-identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INFISICAL_JSON_PATH = resolve(REPO_ROOT, '.infisical.json');

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
  CLOUDFLARE_ACCOUNT_ID      Cloudflare account id. Optional, and only
                             accepted when it repeats the canonical id in
                             scripts/_cloudflare-identity.mjs; it may not
                             retarget the bootstrap at another account.
  CF_TRIGGER_UUID            optional override; bypass trigger
                             discovery when set (for re-runs after a
                             discovery mismatch)
  INFISICAL_IDENTITY_ID      optional override; reuse an existing
                             Machine Identity by id. Without it the
                             script asks the provider by name first;
                             it refuses to create when that lookup
                             cannot be trusted (self-host reports a
                             count but returns an empty list).
  INFISICAL_ORG_ID           Organization UUID. Required — extracted
                             from JWT payload via jwtOrganizationId()
                             OR supplied as env var for non-user auth.
  INFISICAL_PROJECT_ROLE     optional override for the project role
                             the identity is granted. Rejected unless
                             the project actually offers that role.
                             Default: the least-privilege read role
                             the project offers (viewer).

Side effects:
  - Infisical: identity + Universal Auth + project membership
    (POST /api/v1/...) — all three are idempotent and each write is
    confirmed by re-reading provider state.
  - Cloudflare Builds: PATCH trigger env vars (object-map body),
    then a value-free project access check.

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
 * Error carrying the HTTP status, with the historical message shape
 * (`METHOD /path failed with HTTP NNN`) that the existing
 * `/HTTP 404/` / `/HTTP 400/` recovery branches in this file match
 * against. `status` lets new code branch on the exact code instead of
 * re-parsing the message.
 */
class HttpStatusError extends Error {
	constructor(method, pathname, status) {
		super(`${method} ${pathname} failed with HTTP ${status}`);
		this.name = 'HttpStatusError';
		this.status = status;
	}
}

/**
 * Low-level HTTPS exchange. Resolves `{ status, data }` for ANY HTTP
 * status — 4xx and 5xx included — so a caller that must tell error
 * causes apart can read the body instead of guessing from the status
 * alone.
 *
 * `data` is the parsed JSON body, or `null` when the body was empty or
 * was not JSON. **The body is handed to the caller and is never
 * logged here** (the invariant is status-only output); a caller that
 * reads `data` must not print it either, because an Infisical error
 * body echoes request context.
 */
function httpsExchange(method, urlString, { token, body } = {}) {
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
						rejectPromise(new Error(`response exceeded ${HTTPS_MAX_RESPONSE_BYTES} bytes`));
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () => {
					const text = chunks.join('');
					if (text.length === 0) {
						resolvePromise({ status: res.statusCode, data: null, parseFailed: false });
						return;
					}
					let data = null;
					let parseFailed = false;
					try {
						data = JSON.parse(text);
					} catch {
						// A caller that only needs the status is fine with
						// `data: null`, but a caller that reads the body
						// must be able to tell "the server sent something
						// I could not parse" from "the server sent
						// nothing". Collapsing the two would let a
						// malformed response read as "the thing I asked
						// about does not exist" — and on the identity
						// path that means creating a duplicate. The flag
						// is what keeps them apart; the body is never
						// logged either way.
						parseFailed = true;
					}
					resolvePromise({ status: res.statusCode, data, parseFailed });
				});
			},
		);
		req.on('timeout', () => {
			req.destroy(new Error(`request timed out after ${HTTPS_TIMEOUT_MS}ms`));
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
 * Throwing wrapper around `httpsExchange`. Returns the parsed JSON
 * body for 2xx, throws `HttpStatusError` otherwise. The error message
 * carries the method, path and status only — never the body.
 *
 * A 2xx body that is not valid JSON throws here rather than resolving
 * to `null`. Callers in this file read `null` as "the object I asked
 * for is not there" (`getIdentityById` → create a new identity; the
 * role list → fall back to the default role), so a silent
 * null-on-unparseable would turn a transport hiccup into a duplicate
 * identity or an unverified grant.
 */
async function httpsRequestJson(method, urlString, { token, body } = {}) {
	const url = new URL(urlString);
	const { status, data, parseFailed } = await httpsExchange(method, urlString, { token, body });
	if (status < 200 || status >= 300) {
		throw new HttpStatusError(method, url.pathname, status);
	}
	if (parseFailed) {
		throw new Error(`${method} ${url.pathname} returned a non-JSON body on HTTP ${status}`);
	}
	return data;
}

/* ------------------------------------------------------------------ */
/* Pure helpers (regex-extractable for test pinning)                  */
/* ------------------------------------------------------------------ */

/**
 * Strip `// line` and `/* block *\/` comments from JSONC, then parse.
 *
 * Issue #247: no longer used to read the Worker config — identity is
 * imported. It remains for the `.infisical.json`-adjacent JSONC parsing
 * this module still performs.
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

/**
 * Resolve the Cloudflare account id.
 *
 * Issue #247: the canonical id is IMPORTED from
 * `_cloudflare-identity.mjs`, not scraped out of a Wrangler config.
 * That file is deleted by this slice, and a value recovered by regex
 * from a config is one edit away from pointing at another account.
 *
 * An env override is still accepted, but ONLY when it repeats the
 * canonical id. The old resolver returned whatever
 * `CLOUDFLARE_ACCOUNT_ID` held, so a stray value silently retargeted
 * the Machine Identity bootstrap at a different account.
 *
 * Pure function — exposed for tests.
 */
function resolveCloudflareAccountId({ envValue }) {
	if (typeof envValue === 'string' && envValue.length > 0) {
		if (envValue !== ACCOUNT_ID) {
			throw new Error(
				`CLOUDFLARE_ACCOUNT_ID=${envValue} does not match the canonical account ${ACCOUNT_ID}. This repository owns one account; an override may not retarget the Cloudflare bootstrap.`,
			);
		}
		return { accountId: ACCOUNT_ID, source: 'env (matches canonical)' };
	}
	return { accountId: ACCOUNT_ID, source: '_cloudflare-identity.mjs#ACCOUNT_ID' };
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
 * Tolerates BOTH shapes:
 *   - Old: `{ deployment_enabled, branch }` where `branch` is a
 *     string. The old `/builds/workers/{tag}/triggers` shape.
 *   - New (2026-09 Cloudflare API): `{ branch_includes, ... }` where
 *     `branch_includes` is an array of strings. The current shape
 *     has no `deployment_enabled` field — the trigger is implicitly
 *     active when listed.
 *
 * A trigger is "production-shaped" iff it targets `main` OR a
 * branch starting with `release-`.
 *
 * Returns:
 *   - `null` when no production-shaped trigger exists.
 *   - the single matching trigger when exactly one candidate exists.
 *   - **throws** when multiple production-shaped triggers exist.
 *     Selection by array order is unsafe (Cloudflare returns the
 *     order it wants, not the operator's preferred order) — the
 *     caller must disambiguate by setting `CF_TRIGGER_UUID`
 *     explicitly. Pure helper — exposed for tests.
 */
function selectProductionTrigger(triggers) {
	if (!Array.isArray(triggers)) return null;
	const matches = triggers.filter((trigger) => {
		// Old shape: deployment_enabled === true AND branch is main/release-*
		if (
			trigger?.deployment_enabled === true &&
			(trigger?.branch === 'main' ||
				(typeof trigger?.branch === 'string' && trigger.branch.startsWith('release-')))
		) {
			return true;
		}
		// New shape: branch_includes (array) contains 'main' or any
		// branch starting with 'release-'. Implicitly active (no
		// deployment_enabled field).
		if (Array.isArray(trigger?.branch_includes)) {
			return trigger.branch_includes.some(
				(b) => b === 'main' || (typeof b === 'string' && b.startsWith('release-')),
			);
		}
		return false;
	});
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
 *
 * Tolerates BOTH shapes:
 *   - Cloudflare Builds API `/builds/workers`: `{ name, tag, ... }`
 *   - Workers Scripts API `/workers/scripts`: `{ id, tag, ... }`
 *     (the Worker name lives in `id`, not `name`)
 *
 * Returns the tag string or null. Pure helper — exposed for tests.
 */
function findWorkerTag(workersList, workerName) {
	if (!Array.isArray(workersList)) return null;
	const found = workersList.find((w) => w?.name === workerName || w?.id === workerName);
	return found?.tag ?? null;
}

/* ------------------------------------------------------------------ */
/* Project identity membership (Issue #86)                            */
/* ------------------------------------------------------------------ */

/**
 * Default project role for the Cloudflare build identity.
 *
 * The production requirement is the LEAST privilege that can read
 * secrets, which on this self-host is `viewer`. It is only a
 * *preference order* — `resolveProjectRole` verifies the slug against
 * the project's actual role list before granting it, and refuses a
 * role the provider does not offer.
 */
const PROJECT_ROLE_PREFERENCE_ORDER = ['viewer', 'developer', 'admin'];
const NO_ACCESS_ROLE = 'no-access';

/**
 * Extract the role slugs a membership actually grants.
 *
 * Infisical stores a membership as a `roles[]` array; a custom role
 * carries its slug in `customRoleSlug` rather than `role`. Returns
 * `null` when the payload is not a membership at all, so a caller can
 * distinguish "no membership" from "membership with no roles" — the
 * difference between "create it" and "converge it".
 *
 * Pure helper — exposed for tests.
 */
function membershipRoleSlugs(membership) {
	if (membership === null || membership === undefined) return null;
	if (typeof membership !== 'object') return null;
	// The GET returns `{ identityMembership: {...} }`; accept the
	// unwrapped form too so both shapes resolve identically.
	const inner = membership.identityMembership ?? membership;
	const roles = Array.isArray(inner.roles) ? inner.roles : null;
	if (roles === null) return null;
	return roles
		.map((entry) => {
			if (typeof entry === 'string') return entry;
			if (typeof entry?.customRoleSlug === 'string' && entry.customRoleSlug.length > 0) {
				return entry.customRoleSlug;
			}
			return typeof entry?.role === 'string' ? entry.role : null;
		})
		.filter((slug) => typeof slug === 'string' && slug.length > 0);
}

/**
 * Decide the role slug to converge on.
 *
 * Never a bare hard-coded constant: an explicit `requested` override
 * wins but is REJECTED unless the project's own role list contains it
 * (granting a role the provider does not define is the access-widening
 * failure this script must not be able to cause). Without an override,
 * the first slug from the preference order that the provider actually
 * offers is used.
 *
 * `availableSlugs === null` means the role list could not be read (the
 * `/roles` endpoint is enterprise-gated on this self-host). The
 * resolution still returns the default, but reports
 * `roleVerifiedAgainstProvider: false` so the caller can say out loud
 * that the role was assumed rather than observed.
 *
 * Pure helper — exposed for tests.
 */
function resolveProjectRole({ availableSlugs, requested }) {
	const offered = Array.isArray(availableSlugs)
		? availableSlugs.filter((s) => typeof s === 'string' && s.length > 0)
		: null;
	const verified = offered !== null;
	if (requested !== undefined && requested !== null && String(requested).length > 0) {
		const wanted = String(requested);
		if (verified && !offered.includes(wanted)) {
			// Refuse rather than guess: a role the project does not
			// define is either a typo or an attempt to widen access.
			throw new Error(
				`INFISICAL_PROJECT_ROLE='${wanted}' is not offered by this project (offered: ${offered.join(', ')}). Refusing to grant an unverified role.`,
			);
		}
		return { role: wanted, source: 'env override', roleVerifiedAgainstProvider: verified };
	}
	const candidates = verified
		? PROJECT_ROLE_PREFERENCE_ORDER.filter((r) => offered.includes(r))
		: [];
	if (candidates.length > 0) {
		return {
			role: candidates[0],
			source: 'least-privilege read role offered by this project',
			roleVerifiedAgainstProvider: true,
		};
	}
	if (verified && offered.length > 0) {
		// The project offers roles, but none of the read-capable ones.
		// Take the lowest-privileged offered role that still grants
		// something.
		//
		// `no-access` is explicitly excluded: it is a real role slug, so
		// a plain lowest-sort would pick it whenever it is the ONLY role
		// on offer — and converging onto it would produce a membership
		// that exists, satisfies every check in this file, and grants
		// the identity nothing. A bootstrap that "succeeds" into no
		// access is the failure this ticket exists to remove, so if
		// nothing but no-access is available we say so and stop.
		const accessGranting = offered.filter((slug) => slug !== NO_ACCESS_ROLE).sort();
		if (accessGranting.length === 0) {
			throw new Error(
				`this project offers only roles that grant no access (offered: ${offered.join(', ')}), so no read-capable project role can be granted. Grant project access in the Infisical UI, or point INFISICAL_API_URL at a project that has a read role.`,
			);
		}
		const fallback = accessGranting[0];
		return {
			role: fallback,
			source: `no read role from the preference order is offered; using the lowest-privilege access-granting role offered (${fallback})`,
			roleVerifiedAgainstProvider: true,
		};
	}
	return {
		role: PROJECT_ROLE_PREFERENCE_ORDER[0],
		source: 'built-in default (project role list was NOT readable — role assumed, not observed)',
		roleVerifiedAgainstProvider: false,
	};
}

/**
 * Decide whether an observed membership already grants the expected
 * role, and whether it grants real access.
 *
 * `no-access` is a membership that exists but confers nothing — it is
 * a converge target, never a satisfied state. Pure helper — exposed
 * for tests.
 */
function classifyMembership(membership, expectedRole) {
	const slugs = membershipRoleSlugs(membership);
	if (slugs === null) return { state: 'absent' };
	if (slugs.length === 0) return { state: 'mismatched', observed: [] };
	if (slugs.includes(expectedRole)) return { state: 'satisfied', observed: slugs };
	return { state: 'mismatched', observed: slugs };
}

/**
 * True when a create response means "a concurrent run already created
 * this membership" rather than "the request was malformed".
 *
 * Infisical's `createMembership` throws `BadRequestError("Identity is
 * already a member")` on the membership uniqueness constraint. That
 * specific 400 message is the ONLY conflict this script treats as a
 * lost race; any other 400 is a real error, because assuming "already
 * there" without evidence is exactly how a bootstrap script half-applies
 * and still exits 0.
 *
 * The body is passed in rather than carried on the thrown error so no
 * error object in this file ever holds response content that a stray
 * `console.error(error)` could print.
 *
 * Pure helper — exposed for tests.
 */
function isAlreadyMemberConflict({ status, data }) {
	if (status !== 400) return false;
	// Written out rather than as a nested ternary: the OCR review rules
	// for this repo prohibit nested ternaries, and the three-way choice
	// ("message field" / "bare string body" / "nothing usable") is not
	// clearer compressed.
	let message = '';
	if (typeof data?.message === 'string') {
		message = data.message;
	} else if (typeof data === 'string') {
		message = data;
	}
	return /already a member/i.test(message);
}

function listCloudflareWorkersBuildsWorkers({ accountId, token }) {
	return httpsRequestJson(
		'GET',
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/workers`,
		{ token },
	);
}

/**
 * List Workers Scripts. Cloudflare's `/workers/scripts` endpoint is
 * the canonical way to discover Worker tags — it works regardless
 * of whether the Worker has a Builds trigger attached. Used as a
 * fallback when `/builds/workers` returns 404 (which happens when
 * the account has no Builds workers in the list response).
 */
function listCloudflareWorkersScripts({ accountId, token }) {
	return httpsRequestJson(
		'GET',
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
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

/**
 * Ask the provider whether a Machine Identity of this name already
 * exists, so a re-run reuses it instead of creating a duplicate.
 *
 * Three outcomes, kept distinct on purpose:
 *   - `found`        — exactly one identity with this name; reuse it.
 *   - `absent`       — the list answered and contains no such name.
 *   - `unobservable` — the list answered but cannot be trusted to be
 *                      complete (the v0.165.x self-host reports
 *                      `totalCount > 0` with an empty array). The
 *                      caller MUST NOT create in this state.
 *
 * `ambiguous` (several identities share the name, which a server that
 * does not enforce uniqueness can produce) is also reported separately
 * so a duplicate already on the server surfaces as a decision rather
 * than a silent pick.
 *
 * Pure decision logic is separated into `pickIdentityByName` so the
 * branch table is testable without a server.
 */
function pickIdentityByName({ identities, totalCount, name }) {
	if (!Array.isArray(identities) || identities.length === 0) {
		// The list is empty. If the server also says there are none,
		// absence is established. If it says there are some, the list
		// is untrustworthy and we must not infer absence from it.
		const count = typeof totalCount === 'number' ? totalCount : null;
		return count !== null && count > 0
			? { state: 'unobservable', totalCount: count }
			: { state: 'absent', totalCount: count ?? 0 };
	}
	const matches = identities.filter((entry) => (entry?.identity ?? entry)?.name === name);
	if (matches.length === 0) return { state: 'absent', totalCount: identities.length };
	if (matches.length > 1) {
		return {
			state: 'ambiguous',
			totalCount: matches.length,
			ids: matches.map((m) => m?.identity?.id ?? m?.id),
		};
	}
	const only = matches[0]?.identity ?? matches[0];
	return { state: 'found', identity: only };
}

async function listIdentitiesByName({ apiUrl, token, organizationId, name }) {
	const base = apiUrl.replace(/\/+$/, '');
	const response = await httpsRequestJson(
		'GET',
		`${base}/api/v1/identities?orgId=${encodeURIComponent(organizationId)}`,
		{ token },
	);
	return pickIdentityByName({
		identities: response?.identities,
		totalCount: response?.totalCount,
		name,
	});
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
	// Idempotency: POSTing twice returns 400 "Failed to add universal
	// auth to already configured identity" on the v0.165.x self-host.
	//
	// The response BODY is what distinguishes that from a genuinely
	// malformed request. The previous implementation treated *every*
	// 400 as "already attached" — so a bad org scope, a bad identity
	// id, or any other client-side rejection was silently reported as
	// success, which is the worst outcome for a bootstrap script: the
	// operator is told the identity is ready when it is not.
	//
	// So the body is inspected, and only the specific already-configured
	// message takes the recovery path. Anything else propagates.
	const { status, data } = await httpsExchange(
		'POST',
		`${base}/api/v1/auth/universal-auth/identities/${identityId}`,
		{ token, body: {} },
	);
	if (status >= 200 && status < 300) {
		return { created: true, universalAuth: data?.identityUniversalAuth };
	}
	const alreadyConfigured =
		status === 400 && typeof data?.message === 'string' && /already configured/i.test(data.message);
	if (!alreadyConfigured) {
		throw new HttpStatusError(
			'POST',
			`/api/v1/auth/universal-auth/identities/${identityId}`,
			status,
		);
	}
	// Fetch existing config so the caller has the clientId.
	const existing = await httpsRequestJson(
		'GET',
		`${base}/api/v1/auth/universal-auth/identities/${identityId}`,
		{ token },
	);
	return { created: false, universalAuth: existing?.identityUniversalAuth ?? existing };
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

/**
 * Provider boundary for project identity membership.
 *
 * Every read and write the convergence algorithm performs goes
 * through this object, so the algorithm can be exercised against a
 * fake in tests with call assertions rather than only end-state
 * assertions. `main()` supplies the HTTP-backed implementation; the
 * shape is deliberately tiny and side-effect-explicit.
 *
 * Contract:
 *   - `listProjectRoleSlugs` → `string[]`, or `null` when the role
 *     list is not readable (enterprise-gated endpoint). `null` is
 *     explicitly NOT the same as `[]`: `[]` means the project offers
 *     no roles, which is a contradiction, while `null` means "could
 *     not ask", which is an honest unknown.
 *   - `getMembership` → membership object, or `null` when the
 *     provider says there is none (404).
 *   - `createMembership` → `{ status, data }` for the create call.
 *     Returned rather than thrown so the caller can distinguish the
 *     already-a-member conflict.
 *   - `updateMembership` → resolves when the role was accepted.
 *
 * `exchange` and `requestJson` default to the module's HTTP helpers but
 * are injectable, so the status-handling DECISIONS above (which of
 * "absent" / "unknown" / "present" a given response means) can be
 * tested directly. Those decisions are the ones that must never be
 * wrong: each wrong answer duplicates a membership, so asserting them
 * only by grepping the source would leave a behaviour change free to
 * pass a test that had read nothing.
 */
function createInfisicalMembershipProvider({
	apiUrl,
	token,
	exchange = httpsExchange,
	requestJson = httpsRequestJson,
}) {
	const base = apiUrl.replace(/\/+$/, '');
	const projectPath = (projectId) => `${base}/api/v1/projects/${encodeURIComponent(projectId)}`;
	const membershipPath = (projectId, identityId) =>
		`${projectPath(projectId)}/memberships/identities/${encodeURIComponent(identityId)}`;

	async function listProjectRoleSlugs({ projectId }) {
		const { status, data } = await exchange('GET', `${projectPath(projectId)}/roles`, {
			token,
		});
		if (status < 200 || status >= 300) return null;
		const roles = data?.roles;
		if (!Array.isArray(roles)) return null;
		return roles
			.map((r) => (typeof r === 'string' ? r : r?.slug))
			.filter((slug) => typeof slug === 'string' && slug.length > 0);
	}

	async function getMembership({ projectId, identityId }) {
		const { status, data, parseFailed } = await exchange(
			'GET',
			membershipPath(projectId, identityId),
			{
				token,
			},
		);
		if (status === 404) return null;
		if (status < 200 || status >= 300) {
			throw new Error(
				`GET project identity membership failed with HTTP ${status}; cannot determine whether membership already exists, so refusing to guess`,
			);
		}
		// A 2xx whose body could not be parsed is NOT "no membership".
		// Returning null here would make the convergence take the create
		// branch and duplicate a membership that already exists — the
		// exact unobservable-state bug the read exists to prevent.
		if (parseFailed) {
			throw new Error(
				`GET project identity membership returned an unreadable body on HTTP ${status}; treating the state as unknown rather than absent`,
			);
		}
		return data?.identityMembership ? { identityMembership: data.identityMembership } : data;
	}

	async function createMembership({ projectId, identityId, role }) {
		// The canonical create contract accepts `{ roles: [{ role, isTemporary }] }`;
		// the flat `{ role }` form is the deprecated shorthand. Send the
		// array form so one code path works on old and new servers.
		return exchange('POST', membershipPath(projectId, identityId), {
			token,
			body: { roles: [{ role, isTemporary: false }] },
		});
	}

	async function updateMembership({ projectId, identityId, role }) {
		// PATCH accepts ONLY `roles` (min 1) — a flat `{ role }` body is
		// rejected, which is why this is not the same payload as create.
		await requestJson('PATCH', membershipPath(projectId, identityId), {
			token,
			body: { roles: [{ role, isTemporary: false }] },
		});
	}

	return { listProjectRoleSlugs, getMembership, createMembership, updateMembership };
}

/**
 * Converge one identity's project membership onto `expectedRole`.
 *
 * Idempotence contract:
 *   - The decision is made from `provider.getMembership()` — the
 *     actual provider state read at the start of this run. No local
 *     marker file, no cached assumption, no "did the last run
 *     succeed?" heuristic that can drift from reality.
 *   - The satisfied path performs ZERO writes. A re-run of a converged
 *     project issues reads only.
 *   - Every mutating branch re-reads provider state afterwards and
 *     throws if the expected role did not land. A run therefore
 *     reaches a well-defined terminal state (converged, or a loud
 *     non-zero failure) — never "probably fine".
 *   - A run interrupted between create and verify is resumable: the
 *     next run's first action is the same state read, sees the
 *     membership that did land, and finishes whatever is left.
 *
 * Returns a report describing what happened, for logging and tests.
 */
async function convergeProjectMembership({ provider, projectId, identityId, expectedRole }) {
	const before = await provider.getMembership({ projectId, identityId });
	const state = classifyMembership(before, expectedRole);

	if (state.state === 'satisfied') {
		// No-op. The membership is present with the expected role.
		return { outcome: 'already-correct', role: expectedRole, observed: state.observed, writes: 0 };
	}

	let outcome;
	if (state.state === 'absent') {
		const create = await provider.createMembership({ projectId, identityId, role: expectedRole });
		if (create.status >= 200 && create.status < 300) {
			outcome = 'created';
		} else if (isAlreadyMemberConflict(create)) {
			// A concurrent run won the race between our read and our
			// write. That is not success and not failure — re-read and
			// let the state drive the decision, so we neither duplicate
			// the membership nor assume a role we have not seen.
			outcome = 'concurrent-create';
		} else {
			throw new Error(
				`project membership create failed with HTTP ${create.status}; the identity has NO project access`,
			);
		}
	} else {
		await provider.updateMembership({ projectId, identityId, role: expectedRole });
		outcome = 'converged';
	}

	// Verify against provider state, not against the write's own
	// response — a 200 from a write is not proof the role landed.
	const after = await provider.getMembership({ projectId, identityId });
	const finalState = classifyMembership(after, expectedRole);
	if (finalState.state !== 'satisfied') {
		const observed =
			finalState.state === 'absent' ? 'no membership' : finalState.observed.join(', ') || 'no role';
		throw new Error(
			`project membership did not converge to '${expectedRole}' after ${outcome} (observed: ${observed})`,
		);
	}
	return {
		outcome: outcome === 'concurrent-create' ? 'converged-after-race' : outcome,
		role: expectedRole,
		observed: finalState.observed,
		writes: 1,
	};
}

/**
 * Prove the freshly-granted project membership actually works, using
 * the Universal Auth credential this run just created.
 *
 * Two steps, both of which must return HTTP 200:
 *   1. Universal Auth login → an identity-scoped access token.
 *   2. `GET /api/v3/secrets/raw?...&viewSecretValue=false` for the
 *      production environment with that token.
 *
 * Step 2 uses `viewSecretValue=false`, the same value-free contract
 * `scripts/check-cf-secrets.mjs` and `scripts/infisical-seed.mjs`
 * already use, so no secret value can reach this process — let alone
 * its stdout. Only the key NAMES come back and only the COUNT is
 * printed; no name is echoed either, so the output stays status-only.
 *
 * A failure here throws. A membership that exists but grants nothing
 * is the half-configured state this script must never report as
 * success.
 */
async function verifyProjectAccess({
	apiUrl,
	clientId,
	clientSecret,
	workspaceId,
	environment,
	role,
}) {
	const base = apiUrl.replace(/\/+$/, '');

	const login = await httpsExchange('POST', `${base}/api/v1/auth/universal-auth/login`, {
		token: null,
		body: { clientId, clientSecret },
	});
	if (login.status !== 200) {
		throw new Error(
			`Universal Auth login for the build identity failed with HTTP ${login.status}; project access is NOT verified`,
		);
	}
	const accessToken = login.data?.accessToken;
	if (typeof accessToken !== 'string' || accessToken.length === 0) {
		throw new Error('Universal Auth login returned no accessToken; project access is NOT verified');
	}

	const params = new URLSearchParams({
		workspaceId,
		environment,
		viewSecretValue: 'false',
	});
	const secrets = await httpsExchange('GET', `${base}/api/v3/secrets/raw?${params.toString()}`, {
		token: accessToken,
	});
	if (secrets.status !== 200) {
		throw new Error(
			`production secret list with the identity token failed with HTTP ${secrets.status}; the '${role}' role does not grant read access`,
		);
	}
	const listed = secrets.data?.secrets;
	if (!Array.isArray(listed)) {
		throw new Error(
			'production secret list did not return a secrets array; project access is NOT verified',
		);
	}
	// Count only. Values are null server-side and names are not printed.
	return { environment, secretCount: listed.length, valuesRead: false };
}

/* ------------------------------------------------------------------ */
/* Main flow                                                          */
/* ------------------------------------------------------------------ */

async function discoverProductionTriggerUuid({ accountId, cloudflareToken, workerName }) {
	if (typeof process.env.CF_TRIGGER_UUID === 'string' && process.env.CF_TRIGGER_UUID.length > 0) {
		return { triggerUuid: process.env.CF_TRIGGER_UUID, source: 'env override' };
	}

	// Step 1: discover the Worker tag. Try `/builds/workers` first
	// (the canonical Builds-API surface), fall back to `/workers/scripts`
	// (the universal Workers surface) — `/builds/workers` may 404
	// when the account's Builds list endpoint is empty / not exposed.
	let tag = null;
	let tagSource = null;
	const buildsWorkersResponse = await listCloudflareWorkersBuildsWorkers({
		accountId,
		token: cloudflareToken,
	});
	tag = findWorkerTag(buildsWorkersResponse?.result, workerName);
	tagSource = 'GET /builds/workers';
	if (tag === null) {
		const scriptsResponse = await listCloudflareWorkersScripts({
			accountId,
			token: cloudflareToken,
		});
		tag = findWorkerTag(scriptsResponse?.result, workerName);
		tagSource = 'GET /workers/scripts (fallback)';
	}
	if (tag === null) {
		throw new Error(
			`Worker '${workerName}' not found in either /builds/workers or /workers/scripts. Set CF_TRIGGER_UUID explicitly to bypass discovery.`,
		);
	}

	// Step 2: list triggers for that Worker tag.
	const triggersResponse = await listCloudflareBuildsTriggers({
		accountId,
		token: cloudflareToken,
		workerTag: tag,
	});
	const trigger = selectProductionTrigger(triggersResponse?.result);
	if (!trigger) {
		throw new Error(
			`No production-shaped trigger (branch_includes contains 'main' or 'release-*') found for Worker '${workerName}'. Set CF_TRIGGER_UUID explicitly.`,
		);
	}
	// Tolerate both shapes: new API returns `trigger_uuid` (snake_case);
	// old API returned `uuid`.
	const triggerUuid = trigger.trigger_uuid ?? trigger.uuid;
	if (typeof triggerUuid !== 'string' || triggerUuid.length === 0) {
		throw new Error('production trigger has no uuid / trigger_uuid field');
	}
	return { triggerUuid, source: `tag=${tag} via ${tagSource}` };
}

async function main() {
	parseArgs(process.argv.slice(2));

	const infisicalApiUrl = process.env.INFISICAL_API_URL ?? INFISICAL_API_URL_DEFAULT;
	const infisicalToken = process.env.INFISICAL_TOKEN;
	const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN;

	if (typeof infisicalToken !== 'string' || infisicalToken.length === 0) {
		throw new Error('INFISICAL_TOKEN env var is required');
	}
	// Cloudflare side is optional — bootstrap-cf can still create
	// the Machine Identity + Universal Auth + client secret even if
	// CLOUDFLARE_API_TOKEN is absent (the binding step will be
	// skipped).

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
	const workerName = WORKER_NAME;
	console.log(`Worker name (canonical): ${workerName}`);
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
		// No override. Before creating, ASK the provider whether the
		// identity already exists — this is what keeps a re-run from
		// accumulating duplicates on a self-host that does not enforce
		// name uniqueness.
		//
		// The v0.165.x self-host has a known bug where
		// `GET /api/v1/identities?orgId=` returns `totalCount > 0`
		// with an EMPTY `identities[]`. That is the dangerous case:
		// we cannot see an identity that may well exist, so creating
		// one would guess. An unobservable provider state must not be
		// treated as "absent" — the previous code warned and created a
		// duplicate anyway, which is how a bootstrap ends up with N
		// identities that all look healthy. It now fails loudly and
		// asks the operator for the id instead.
		const listed = await listIdentitiesByName({
			apiUrl: infisicalApiUrl,
			token: infisicalToken,
			organizationId,
			name: MACHINE_IDENTITY_NAME,
		});
		if (listed.state === 'unobservable') {
			throw new Error(
				`cannot determine whether identity '${MACHINE_IDENTITY_NAME}' already exists: the self-host reports ${listed.totalCount} identit(ies) in this org but returned an empty identities[] list, so the existence check observed nothing. Creating one now would silently duplicate it. Set INFISICAL_IDENTITY_ID=<uuid> to reuse the existing identity.`,
			);
		}
		if (listed.state === 'found') {
			identity = listed.identity;
			console.log(`Identity reused by name lookup: ${MACHINE_IDENTITY_NAME} (id=${identity.id})`);
		} else {
			identity = await createIdentity({
				apiUrl: infisicalApiUrl,
				token: infisicalToken,
				name: MACHINE_IDENTITY_NAME,
				organizationId,
			});
			console.log(
				`Identity created: ${MACHINE_IDENTITY_NAME} (id=${identity.id}). Record this id in INFISICAL_IDENTITY_ID for re-runs.`,
			);
		}
	} else {
		console.log(`Identity reused: ${MACHINE_IDENTITY_NAME} (id=${identity.id})`);
	}
	const identityId = identity.id;
	if (typeof identityId !== 'string' || identityId.length === 0) {
		throw new Error('identity.id missing from Infisical response');
	}

	// ---- Project membership (Issue #86) ----
	// Converge the identity's project membership onto the least
	// privilege that can read secrets. The canonical endpoint on this
	// self-host is
	//   POST   /api/v1/projects/{projectId}/memberships/identities/{identityId}
	//   PATCH  /api/v1/projects/{projectId}/memberships/identities/{identityId}
	//   GET    /api/v1/projects/{projectId}/memberships/identities/{identityId}
	// (the previously-guessed `/identities/{id}/project-memberships` route
	// does not exist — that guess is what produced the "SKIPPED" warning
	// this block replaces).
	//
	// Every decision below is made from a provider read, never from a
	// local flag, so a re-run is a clean no-op and an interrupted run
	// is resumable.
	const membershipProvider = createInfisicalMembershipProvider({
		apiUrl: infisicalApiUrl,
		token: infisicalToken,
	});
	const availableRoleSlugs = await membershipProvider.listProjectRoleSlugs({
		projectId: workspaceId,
	});
	const {
		role: projectRole,
		source: roleSource,
		roleVerifiedAgainstProvider,
	} = resolveProjectRole({
		availableSlugs: availableRoleSlugs,
		requested: process.env.INFISICAL_PROJECT_ROLE,
	});
	if (!roleVerifiedAgainstProvider) {
		// Say it out loud: the role was NOT observed from the provider.
		console.warn(
			`Project role '${projectRole}' could not be verified against the project's role list (endpoint unreadable: ${roleSource}). Granting the documented read-only default. Set INFISICAL_PROJECT_ROLE to override.`,
		);
	} else {
		console.log(`Project role: ${projectRole} (${roleSource})`);
	}

	const membershipResult = await convergeProjectMembership({
		provider: membershipProvider,
		projectId: workspaceId,
		identityId,
		expectedRole: projectRole,
	});
	console.log(
		`Project membership: ${membershipResult.outcome} (role=${membershipResult.role}, observed=[${membershipResult.observed.join(', ')}], writes=${membershipResult.writes})`,
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
	// Resolve the account through the single resolver, so the override
	// rule is enforced in one place whether or not the env var is set.
	const resolved = resolveCloudflareAccountId({
		envValue: process.env.CLOUDFLARE_ACCOUNT_ID,
	});
	accountId = resolved.accountId;
	console.log(`Cloudflare account: ${accountId} (source: ${resolved.source})`);
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
		// No client secret is generated here, deliberately: this branch
		// is the idempotent no-op, and minting a credential just to
		// re-verify would leave a new live secret on the server on every
		// re-run. Project access is therefore NOT re-verified on a no-op
		// run — say so rather than implying it was.
		console.log(
			'No-op: nothing to bind. No client secret was generated, so project access was not re-verified on this run.',
		);
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

	// ---- Project access verification (Issue #86) ----
	// The membership above only says "a role is recorded". This step
	// proves the identity can actually READ, by logging in with the
	// credential generated in this run and listing production secrets
	// with `viewSecretValue=false`. Any non-200 throws, so a membership
	// that looks granted but grants nothing exits non-zero.
	//
	// It runs here, after the binding, and only on the branch that just
	// created a credential — so the idempotent no-op re-run above stays
	// a no-op and never mints a secret purely to check.
	const access = await verifyProjectAccess({
		apiUrl: infisicalApiUrl,
		clientId,
		clientSecret,
		workspaceId,
		environment: 'prod',
		role: projectRole,
	});
	console.log(
		`Project access verified: Universal Auth login 200, ${access.environment} secret list 200 (${access.secretCount} keys, values not read)`,
	);

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
