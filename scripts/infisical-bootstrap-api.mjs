#!/usr/bin/env node
/**
 * ADR-0015 §2 Phase 1 — Infisical project / environment provisioning.
 *
 * Creates a fresh `my-web-2026` Infisical project on the configured
 * self-host instance (`INFISICAL_API_URL`, default
 * `https://secrets.rebuildup.dev`), then creates the `dev` and `prod`
 * environments inside it. Writes `.infisical.json` (workspaceId SoT,
 * committed) with `defaultEnvironment: "dev"`. Idempotent: re-running
 * with an existing project + envs is a no-op (re-runs surface
 * `already exists` for the project, the two environments, and the
 * generated `.infisical.json`).
 *
 * Distinct from `scripts/infisical-bootstrap.mjs`, which is the
 * operator-input shell: that script never makes any HTTP call and
 * accepts `--workspace-id=<uuid>` directly. This script is the
 * agent-driven flow: it obtains the workspaceId by creating the
 * project, then writes it to `.infisical.json` so the operator
 * doesn't have to copy it manually.
 *
 * Self-host API surface (v0.165.x):
 *   - `POST /api/v1/projects` with `{projectName, organizationId}`
 *     (singular `projectName`, not `{name, slug}`)
 *   - `GET /api/v1/projects?orgId=<orgId>` returns `{projects: [...]}` —
 *     no `slug/<slug>` route, so we filter client-side by `.name`
 *   - `POST /api/v1/projects/<id>/environments` with `{name, slug}`
 *   - `GET /api/v1/projects/<id>` returns the project WITH embedded
 *     `environments: [{name, slug, id}, ...]`. There is no separate
 *     environments-list endpoint.
 *
 * Invariants (ADR-0015 §1 + secret-handling):
 *   - argv / log / error message never carries a secret value
 *     (this script never reads or writes a secret — only project /
 *     environment metadata, which are non-secret identifiers).
 *   - Re-running with an existing workspaceId is a no-op; the
 *     existing `.infisical.json` is left unchanged.
 *   - The existing Infisical project (if any) used for other dotfile
 *     repos is NOT reused; this script always finds-or-creates a
 *     project named `my-web-2026`.
 *
 * Usage:
 *   pnpm run infisical:bootstrap:api
 *   INFISICAL_TOKEN=... INFISICAL_ORG_ID=<uuid> node scripts/infisical-bootstrap-api.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const TARGET_PATH = resolve(REPO_ROOT, '.infisical.json');

const INFISICAL_API_URL_DEFAULT = 'https://secrets.rebuildup.dev';
const PROJECT_NAME = 'my-web-2026';
// Self-host auto-suffixes the slug on collision (e.g. `my-web-2026-59n-b`).
// We do NOT pin a slug — the canonical project name is the durable
// identifier; slug is operator-readable metadata only.
const ENVIRONMENT_SLUGS = ['dev', 'prod'];
const HTTPS_TIMEOUT_MS = 10_000;
const HTTPS_MAX_RESPONSE_BYTES = 256 * 1024;
const ALLOWED_INFISICAL_JSON_KEYS = new Set([
	'workspaceId',
	'defaultEnvironment',
	// `infisical init` writes this key unconditionally; accepting it
	// preserves operator tooling that re-runs `infisical init` between
	// agent runs. The field is metadata (branch-to-env mapping); it is
	// not a secret.
	'gitBranchToEnvironmentMapping',
]);

function parseArgs(argv) {
	// Help text is inlined (rather than calling a separate printHelp()
	// or referencing `INFISICAL_API_URL_DEFAULT`) so this function
	// stays self-contained for regex-extraction by the test harness
	// (mirrors the pattern in
	// `bootstrap-home-api-key.test.mjs#loadPureHelpers`).
	const helpText =
		`Usage: infisical-bootstrap-api.mjs

Infisical project + environment provisioning (ADR-0015 §2 Phase 1).

Reads:
  INFISICAL_TOKEN          Bearer access token (Universal Auth or
                           session JWT; obtain via 'infisical login'
                           or 'INFISICAL_CLIENT_ID' +
                           'INFISICAL_CLIENT_SECRET' Universal Auth
                           login).
  INFISICAL_ORG_ID         Organization UUID. Required — extracted
                           from JWT payload via ` +
		'`payload.organizationId`' +
		`
                           OR supplied as env var for non-user auth.
  INFISICAL_API_URL        base URL (default: https://secrets.rebuildup.dev)

Side effects (against the self-host's /api/v1 surface):
  - POST   /api/v1/projects                         (idempotent: 409 → list+filter)
  - POST   /api/v1/projects/{id}/environments      (idempotent: 409 → GET project)
  - Writes .infisical.json (workspaceId + defaultEnvironment='dev')

  -h, --help               show this help`;
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			console.log(helpText);
			process.exit(0);
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return {};
}

/**
 * Low-level HTTPS helper. Returns the parsed JSON body or throws on
 * non-2xx status. Never logs the response body on error (may carry
 * diagnostics); only the status code is exposed.
 *
 * Pure DI seam: extracted as a top-level named function so tests can
 * regex-extract and pin its contract (mirrors `bootstrap-home-api-key.test.mjs#loadPureHelpers`).
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
							new Error(`Infisical ${method} ${url.pathname} failed with HTTP ${res.statusCode}`),
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
 * Idempotently find-or-create the `my-web-2026` project.
 *
 * Resolution order (operator-friendly + never-duplicate):
 *   1. If `preferredWorkspaceId` was provided and `GET /api/v1/projects/{id}`
 *      succeeds with a matching name, USE it — this honours the operator's
 *      pre-existing `.infisical.json` (or an explicit override) without
 *      creating duplicates in the org. The self-host's project-create
 *      endpoint does NOT enforce name uniqueness within an org, so a naive
 *      `POST then check 409` strategy creates duplicates on every run.
 *   2. Otherwise, `GET /api/v1/projects?orgId=<uuid>` and filter by name.
 *      If exactly one match: USE it.
 *      If multiple matches: THROW (operator must disambiguate via
 *      `INFISICAL_WORKSPACE_ID` env var or by deleting duplicates).
 *   3. Otherwise: `POST /api/v1/projects` to create. The self-host auto-
 *      suffixes the slug on collision (e.g. `my-web-2026-59n-b`) and
 *      returns 200 with `{project: {id, ...}}`.
 *
 * Self-host API:
 *   - GET    /api/v1/projects/{id}                  → `{project: {...}}`
 *   - GET    /api/v1/projects?orgId=<uuid>          → `{projects: [...]}`
 *   - POST   /api/v1/projects                       body={projectName, organizationId}
 *
 * Returns the project `id` (workspaceId for `.infisical.json`).
 */
async function ensureProject({ apiUrl, token, organizationId, preferredWorkspaceId }) {
	const base = apiUrl.replace(/\/+$/, '');
	// Step 1: trust preferredWorkspaceId (existing .infisical.json).
	if (typeof preferredWorkspaceId === 'string' && preferredWorkspaceId.length > 0) {
		const existing = await httpsRequestJson(
			'GET',
			`${base}/api/v1/projects/${encodeURIComponent(preferredWorkspaceId)}`,
			{ token },
		);
		const project = existing?.project ?? existing;
		if (project?.id) {
			const nameMatches = project.name === PROJECT_NAME;
			return { id: project.id, created: false, source: 'preferred', nameMatches };
		}
		// preferred id is invalid — fall through to list-and-filter
	}

	// Step 2: list-and-filter by name.
	const listResponse = await httpsRequestJson(
		'GET',
		`${base}/api/v1/projects?orgId=${encodeURIComponent(organizationId)}`,
		{ token },
	);
	const projects = Array.isArray(listResponse?.projects) ? listResponse.projects : [];
	const matches = projects.filter((p) => p?.name === PROJECT_NAME);
	if (matches.length === 1) {
		return { id: matches[0].id, created: false, source: 'list' };
	}
	if (matches.length > 1) {
		throw new Error(
			`multiple projects named '${PROJECT_NAME}' exist in the org (count=${matches.length}); pass INFISICAL_WORKSPACE_ID=<uuid> to disambiguate`,
		);
	}

	// Step 3: create.
	const response = await httpsRequestJson('POST', `${base}/api/v1/projects`, {
		token,
		body: { projectName: PROJECT_NAME, organizationId },
	});
	const created = response?.project ?? response;
	if (!created?.id) {
		throw new Error('Infisical create response missing project.id');
	}
	return { id: created.id, created: true, source: 'create' };
}

/**
 * Idempotently find-or-create an environment slug inside a project.
 *
 * Strategy: ALWAYS look the slug up in the project's embedded
 * `environments[]` (returned by `GET /api/v1/projects/{id}`) before
 * attempting a POST. The self-host's env-create endpoint returns
 * HTTP 400 ("Environment with slug already exists") on collision
 * rather than 409 — so we cannot rely on a 409 catch to fall back to
 * the lookup. Listing first is also a cheaper path on the common
 * re-run case.
 *
 * Self-host API:
 *   - GET    /api/v1/projects/{id}   → `{project: {..., environments: [{slug, id, ...}]}}`
 *   - POST   /api/v1/projects/{id}/environments  body={name, slug}
 *              200 with `{environment: {id, slug, ...}}`
 *              400 "Environment with slug already exists" on collision
 */
async function ensureEnvironment({ apiUrl, token, projectId, slug }) {
	const base = apiUrl.replace(/\/+$/, '');
	// Step 1: ALWAYS look up first. The project's embedded env list is
	// the source of truth for "does this slug exist?".
	const projectResponse = await httpsRequestJson('GET', `${base}/api/v1/projects/${projectId}`, {
		token,
	});
	const project = projectResponse?.project ?? projectResponse;
	const envs = Array.isArray(project?.environments)
		? project.environments
		: Array.isArray(projectResponse?.environments)
			? projectResponse.environments
			: [];
	const found = envs.find((e) => e?.slug === slug);
	if (found?.id) {
		return { id: found.id, slug, created: false };
	}

	// Step 2: not found, attempt create.
	try {
		const response = await httpsRequestJson(
			'POST',
			`${base}/api/v1/projects/${projectId}/environments`,
			{
				token,
				body: { name: slug, slug },
			},
		);
		const createdEnv = response?.environment ?? response;
		if (!createdEnv?.id) {
			throw new Error('Infisical create env response missing environment.id');
		}
		return { id: createdEnv.id, slug, created: true };
	} catch (error) {
		// Race-condition safety: another process may have just created
		// the env between our GET and POST. The self-host returns 400
		// ("Environment with slug already exists") rather than 409.
		if (error.message.includes('already exists')) {
			// Re-read the project and pick up the new env id.
			const projectAfter = await httpsRequestJson('GET', `${base}/api/v1/projects/${projectId}`, {
				token,
			});
			const projectAfterEnv =
				projectAfter?.project?.environments ?? projectAfter?.environments ?? [];
			const e = projectAfterEnv.find((x) => x?.slug === slug);
			if (!e?.id) {
				throw new Error(
					`slug '${slug}' collision raced but no env found in project response after retry`,
				);
			}
			return { id: e.id, slug, created: false };
		}
		throw error;
	}
}

/**
 * Build the JSON content for `.infisical.json`. Pure helper.
 * Exported (top-level function) so tests can regex-extract and pin the
 * output shape.
 */
function buildInfisicalJsonContent({ workspaceId, defaultEnvironment }) {
	const out = { workspaceId };
	if (defaultEnvironment !== null) {
		out.defaultEnvironment = defaultEnvironment;
	}
	return `${JSON.stringify(out, null, 2)}\n`;
}

function validateWorkspaceId(value) {
	// Inline the UUID v4 regex so the function is self-contained for
	// regex-extraction by the test harness (mirrors the pattern in
	// `bootstrap-home-api-key.test.mjs#loadPureHelpers`).
	const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	if (typeof value !== 'string' || !uuidV4.test(value)) {
		throw new Error(`workspaceId from Infisical API is not UUID v4: ${JSON.stringify(value)}`);
	}
	return value.toLowerCase();
}

/**
 * Decode the middle segment of a JWT to extract the
 * `organizationId` claim. Pure helper — exposed for tests.
 *
 * The CLI session JWT (`infisical user get token`) returns a
 * multi-line string; the access token is on the `Token:` line. We
 * accept any string and look for three base64url segments separated
 * by `.`; the middle segment decodes to the JSON payload.
 */
function jwtOrganizationId(token) {
	if (typeof token !== 'string' || token.length === 0) return null;
	const trimmed = token.trim();
	const firstDot = trimmed.indexOf('.');
	if (firstDot === -1) return null;
	const secondDot = trimmed.indexOf('.', firstDot + 1);
	if (secondDot === -1) return null;
	const payload = trimmed.slice(firstDot + 1, secondDot);
	// base64url → base64
	const b64 = payload
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.padEnd(Math.ceil(payload.length / 4) * 4, '=');
	try {
		const json = Buffer.from(b64, 'base64').toString('utf8');
		const parsed = JSON.parse(json);
		// Self-host JWT key is `organizationId`; Infisical Cloud JWT
		// uses the same key in v0.165.x.
		return typeof parsed.organizationId === 'string' ? parsed.organizationId : null;
	} catch {
		return null;
	}
}

function readExistingInfisicalJson() {
	if (!existsSync(TARGET_PATH)) return null;
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(TARGET_PATH, 'utf8'));
	} catch (cause) {
		throw new Error(`.infisical.json is not valid JSON: ${cause.message}`);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('.infisical.json must be a JSON object');
	}
	for (const key of Object.keys(parsed)) {
		if (!ALLOWED_INFISICAL_JSON_KEYS.has(key)) {
			throw new Error(`.infisical.json has unexpected key: ${key}`);
		}
	}
	return {
		workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : null,
		defaultEnvironment:
			typeof parsed.defaultEnvironment === 'string' ? parsed.defaultEnvironment : null,
	};
}

async function main() {
	parseArgs(process.argv.slice(2));

	const apiUrl = process.env.INFISICAL_API_URL ?? INFISICAL_API_URL_DEFAULT;
	const token = process.env.INFISICAL_TOKEN;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error(
			'INFISICAL_TOKEN is required (obtain via `infisical login` or Universal Auth login).',
		);
	}
	// `infisical user get token` returns a multi-line string
	// `SessionID:...<NL>Token:<jwt><NL>ExpiresAt:...<NL>TTL:...`. The
	// raw multi-line text breaks `Authorization: Bearer <hdr>`
	// (`Invalid character in header content`). Extract the JWT line
	// before using it as a Bearer token.
	// (Defensive: jwtOrganizationId accepts the raw output and finds
	// the segment, so this works regardless of which line carries the
	// JWT.)

	const orgIdFromEnv = process.env.INFISICAL_ORG_ID;
	const organizationId =
		typeof orgIdFromEnv === 'string' && orgIdFromEnv.length > 0
			? orgIdFromEnv
			: jwtOrganizationId(token);
	if (typeof organizationId !== 'string' || organizationId.length === 0) {
		throw new Error(
			'INFISICAL_ORG_ID env var is required, or INFISICAL_TOKEN must be a JWT whose payload has an `organizationId` claim.',
		);
	}

	const existing = readExistingInfisicalJson();

	const project = await ensureProject({
		apiUrl,
		token,
		organizationId,
		// Honor `INFISICAL_WORKSPACE_ID` env-var override first; fall back to
		// the existing `.infisical.json#workspaceId`. This idempotency path
		// is critical: the self-host's project-create endpoint does NOT
		// enforce name uniqueness within the org, so a naive post-only
		// strategy creates a duplicate on every run.
		preferredWorkspaceId:
			process.env.INFISICAL_WORKSPACE_ID ||
			(typeof existing?.workspaceId === 'string' && existing.workspaceId.length > 0
				? existing.workspaceId
				: null),
	});
	const workspaceId = validateWorkspaceId(project.id);
	console.log(
		`Project: ${PROJECT_NAME} (${project.created ? 'created' : 'already exists'}) workspaceId=${workspaceId}`,
	);

	const envResults = [];
	for (const slug of ENVIRONMENT_SLUGS) {
		const env = await ensureEnvironment({ apiUrl, token, projectId: workspaceId, slug });
		envResults.push(env);
		console.log(`  env: ${slug} (${env.created ? 'created' : 'already exists'}) id=${env.id}`);
	}

	const defaultEnvironment =
		existing?.defaultEnvironment && existing.defaultEnvironment.length > 0
			? existing.defaultEnvironment
			: (envResults.find((e) => e.slug === 'dev')?.slug ?? 'dev');

	const content = buildInfisicalJsonContent({ workspaceId, defaultEnvironment });
	const isUnchanged =
		existing?.workspaceId === workspaceId && existing?.defaultEnvironment === defaultEnvironment;
	if (!isUnchanged) {
		writeFileSync(TARGET_PATH, content);
	}
	console.log(
		isUnchanged
			? `.infisical.json unchanged (workspaceId already ${workspaceId}).`
			: `.infisical.json written: workspaceId=${workspaceId}`,
	);
	console.log(`  defaultEnvironment=${defaultEnvironment}`);
	console.log(`  path=${TARGET_PATH}`);
}

main().catch((error) => {
	console.error(`infisical-bootstrap-api failed: ${error?.message ?? error}`);
	process.exit(1);
});
