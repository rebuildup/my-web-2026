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
 * Invariants (ADR-0015 §1 + secret-handling):
 *   - argv / log / error message never carries a secret value
 *     (this script never reads or writes a secret — only project /
 *     environment metadata, which are non-secret identifiers).
 *   - Re-running with an existing workspaceId is a no-op; the
 *     existing `.infisical.json` is left unchanged.
 *   - The existing Infisical project (if any) used for other dotfile
 *     repos is NOT reused; this script always creates a project
 *     named `my-web-2026`.
 *
 * Usage:
 *   pnpm run infisical:bootstrap:api
 *   INFISICAL_TOKEN=... node scripts/infisical-bootstrap-api.mjs
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
const PROJECT_SLUG = 'my-web-2026';
const ENVIRONMENT_SLUGS = ['dev', 'prod'];
const HTTPS_TIMEOUT_MS = 10_000;
const HTTPS_MAX_RESPONSE_BYTES = 64 * 1024;
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
	const helpText = `Usage: infisical-bootstrap-api.mjs

Infisical project + environment provisioning (ADR-0015 §2 Phase 1).

Reads:
  INFISICAL_TOKEN          Universal Auth short-lived access token
                           (obtain via 'infisical login' or
                           'INFISICAL_CLIENT_ID' + 'INFISICAL_CLIENT_SECRET'
                           Universal Auth login).
  INFISICAL_API_URL        base URL (default: https://secrets.rebuildup.dev)

Side effects:
  - POST /api/v3/projects (idempotent: 409 → reuses existing)
  - POST /api/v3/projects/{id}/environments (idempotent: 409 → reuses)
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
 * Idempotently create the project. On 409 (already exists), look up
 * by slug. Returns the project `id` (workspaceId for `.infisical.json`).
 */
async function ensureProject({ apiUrl, token }) {
	const base = apiUrl.replace(/\/+$/, '');
	try {
		const created = await httpsRequestJson('POST', `${base}/api/v3/projects`, {
			token,
			body: { name: PROJECT_NAME, slug: PROJECT_SLUG },
		});
		return { id: created.id, created: true };
	} catch (error) {
		if (!/HTTP 409/.test(error.message)) throw error;
		const listed = await httpsRequestJson('GET', `${base}/api/v3/projects/slug/${PROJECT_SLUG}`, {
			token,
		});
		return { id: listed.id, created: false };
	}
}

/**
 * Idempotently create each environment slug. On 409, look up by
 * filtering the project environments list.
 */
async function ensureEnvironment({ apiUrl, token, projectId, slug }) {
	const base = apiUrl.replace(/\/+$/, '');
	try {
		const created = await httpsRequestJson(
			'POST',
			`${base}/api/v3/projects/${projectId}/environments`,
			{
				token,
				body: { name: slug, slug },
			},
		);
		return { id: created.id, slug, created: true };
	} catch (error) {
		if (!/HTTP 409/.test(error.message)) throw error;
		const list = await httpsRequestJson(
			'GET',
			`${base}/api/v3/projects/${projectId}/environments`,
			{ token },
		);
		const found = Array.isArray(list) ? list.find((env) => env.slug === slug) : null;
		if (!found) {
			throw new Error(`environment slug '${slug}' not found after 409 from create`);
		}
		return { id: found.id, slug, created: false };
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

	const existing = readExistingInfisicalJson();

	const project = await ensureProject({ apiUrl, token });
	const workspaceId = validateWorkspaceId(project.id);
	console.log(
		`Project: ${PROJECT_NAME} (${project.created ? 'created' : 'already exists'}) workspaceId=${workspaceId}`,
	);

	const envResults = [];
	for (const slug of ENVIRONMENT_SLUGS) {
		const env = await ensureEnvironment({ apiUrl, token, projectId: workspaceId, slug });
		envResults.push(env);
		console.log(`  env: ${slug} (${env.created ? 'created' : 'already exists'})`);
	}

	const defaultEnvironment =
		existing?.defaultEnvironment ?? envResults.find((e) => e.slug === 'dev')?.slug ?? 'dev';

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
