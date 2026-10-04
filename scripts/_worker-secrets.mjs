/**
 * Repository-owned Worker-secret adapter (Issue #247, secrets slice).
 *
 * Built on the Cloudflare Workers API rather than the beta CLI.
 *
 * Why not `cf workers secrets bulk --body …`
 * -----------------------------------------
 * Passing real secret values to a CLI body risks putting them in argv
 * or in dry-run output. The API keeps the value in the request body of
 * a single HTTPS call, and — more importantly — the live *listing*
 * is already an API call, so reads and writes share one credential
 * boundary instead of splitting across two tools.
 *
 * Merge Patch semantics
 * --------------------
 * `PATCH /accounts/{id}/workers/scripts/{script}/secrets-bulk` takes
 * a JSON Merge Patch over the binding set:
 *
 *     { "secrets": { "NAME": { type: "secret_text", name, text } } }
 *
 *   - a value object  -> create or update that binding
 *   - `null`          -> delete that binding
 *   - omitted         -> unchanged
 *
 * This is why a deletion is expressed as a single-key `null` rather
 * than by re-sending the current set: re-sending would race with any
 * concurrent change, whereas the patch only touches the named binding.
 *
 * Credential separation
 * --------------------
 * `CLOUDFLARE_API_TOKEN` is the Worker-scoped credential (deploy, Worker
 * API, secret mutation). It is NEVER the D1 token, and no D1 token is
 * accepted as a fallback here.
 */

import { ACCOUNT_ID, WORKER_NAME } from './_cloudflare-identity.mjs';

const API = 'https://api.cloudflare.com/client/v4';
const HTTPS_TIMEOUT_MS = 30_000;

/** Hard ceiling on one bulk call, so a bug cannot fan out into a mass write. */
const MAX_OPERATIONS = 64;

/** Cloudflare secret binding names: letters, digits, underscore, hyphen. */
const SECRET_NAME_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Worker-scoped credential for a secret child/request.
 *
 * Deliberately does not fall back to `CLOUDFLARE_D1_API_TOKEN`, and
 * deliberately does not accept the D1 token at all.
 */
function workerCredential(env) {
	const token = env.CLOUDFLARE_API_TOKEN;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error(
			'CLOUDFLARE_API_TOKEN is required for a Worker secret operation. It is the Worker-scoped ' +
				'credential (deploy / Worker API / secret mutation) and is deliberately distinct from ' +
				'CLOUDFLARE_D1_API_TOKEN, which must not be accepted as a fallback here.',
		);
	}
	return token;
}

async function workerJson(
	method,
	path,
	{
		body,
		env = process.env,
		timeout = HTTPS_TIMEOUT_MS,
		accountId = ACCOUNT_ID,
		workerName = WORKER_NAME,
	} = {},
) {
	const headers = { Authorization: `Bearer ${workerCredential(env)}` };
	if (body !== undefined) headers['content-type'] = 'application/json';
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		const res = await fetch(`${API}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: controller.signal,
		});
		const text = await res.text();
		let parsed = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = null;
		}
		if (!res.ok || parsed?.success === false) {
			// FAIL-SAFE on the remote body. Cloudflare's `message` is not
			// guaranteed to avoid echoing the value it was sent, and this
			// module's contract is that a secret value never reaches a
			// thrown error, stderr, or a log. The remote `message` is
			// therefore NOT surfaced on a mutation path. Diagnostic value
			// is preserved without it: HTTP status, the scalar Cloudflare
			// error code, the operation, and the canonical identity.
			const codes = (Array.isArray(parsed?.errors) ? parsed.errors : [])
				.map((e) => (e && typeof e === 'object' ? e.code : undefined))
				.filter((c) => typeof c === 'number' || typeof c === 'string')
				.slice(0, 5)
				.map((c) => String(c))
				.join(', ');
			const codePart = codes ? ` codes=[${codes}]` : '';
			const identity = `account ${accountId} Worker ${workerName}`;
			const reason =
				'Remote error text is intentionally not surfaced: it may echo the submitted value.';
			throw new Error(
				`Cloudflare Worker API ${method} failed (HTTP ${res.status}${codePart}) on ${identity}. ${reason}`,
			);
		}
		return parsed;
	} finally {
		clearTimeout(timer);
	}
}

/** The single live Worker secret listing, shared by every caller. */
export async function listWorkerSecretNames({
	env = process.env,
	accountId = ACCOUNT_ID,
	workerName = WORKER_NAME,
} = {}) {
	const parsed = await workerJson(
		'GET',
		`/accounts/${accountId}/workers/scripts/${workerName}/secrets`,
		{ env, accountId, workerName },
	);
	const result = parsed?.result;
	const list = Array.isArray(result) ? result : (result?.secrets ?? []);
	// Names and types only. Values are never present and never requested.
	return list
		.map((entry) => (typeof entry === 'string' ? { name: entry, type: 'secret_text' } : entry))
		.filter((entry) => entry && typeof entry.name === 'string' && entry.name.length > 0)
		.map((entry) => ({ name: entry.name, type: entry.type ?? 'secret_text' }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Live listing, as bare names. */
export async function listWorkerSecretNameList(options) {
	return (await listWorkerSecretNames(options)).map((e) => e.name);
}

/**
 * Build the JSON Merge Patch body.
 *
 * `changes` maps a name to either a plaintext value (create/update) or
 * `null` (delete). A name absent from `changes` is left untouched —
 * that is the property that makes a one-key deletion safe.
 *
 * Exported so the exact wire shape is unit-testable.
 */
export function buildBulkSecretPayload(changes) {
	if (changes === null || typeof changes !== 'object' || Array.isArray(changes)) {
		throw new Error('bulk secret changes must be an object of name -> value|null');
	}
	const names = Object.keys(changes);
	if (names.length === 0) {
		throw new Error('refusing an empty bulk secret patch: it would be a no-op with no effect');
	}
	if (names.length > MAX_OPERATIONS) {
		throw new Error(
			`refusing a bulk secret patch with ${names.length} operations (max ${MAX_OPERATIONS}).`,
		);
	}
	const secrets = {};
	for (const name of names) {
		if (!SECRET_NAME_RE.test(name)) {
			throw new Error(`invalid Worker secret name: ${JSON.stringify(name)}`);
		}
		const value = changes[name];
		if (value === null) {
			// Merge Patch delete: only this binding, nothing else.
			secrets[name] = null;
			continue;
		}
		if (typeof value !== 'string' || value.length === 0) {
			throw new Error(`Worker secret ${name} must be a non-empty string or null for deletion`);
		}
		secrets[name] = { type: 'secret_text', name, text: value };
	}
	return { secrets };
}

/**
 * The lowest-layer gate for a Worker secret mutation.
 *
 * Requires an explicit execute plus the canonical account and Worker
 * identity, so removing one `if` at a call site cannot turn a
 * production secret write back on.
 */
export function assertWorkerSecretWriteAllowed({
	execute,
	accountId = ACCOUNT_ID,
	workerName = WORKER_NAME,
	env = process.env,
	operationCount = 1,
} = {}) {
	if (!execute) {
		throw new Error(
			'refusing a Worker secret mutation without an explicit execute. ' +
				'A dry run reports names and operation types only and never sends values.',
		);
	}
	if (accountId !== ACCOUNT_ID) {
		throw new Error(`refusing a Worker secret mutation on account ${accountId}.`);
	}
	if (workerName !== WORKER_NAME) {
		throw new Error(`refusing a Worker secret mutation on Worker ${workerName}.`);
	}
	if (operationCount > MAX_OPERATIONS) {
		throw new Error(`refusing ${operationCount} operations (max ${MAX_OPERATIONS}).`);
	}
	// Resolve the credential here so a missing one is an explicit error
	// rather than an opaque 401 from the API.
	workerCredential(env);
}

/**
 * Apply a bulk secret change. Dry run reports names and operations and
 * sends nothing; `execute: true` performs the Merge Patch.
 *
 * @returns {Promise<{applied: boolean, plan?: Array<{name, operation}>>}>}
 */
export async function bulkUpdateWorkerSecrets(
	changes,
	{ execute = false, env = process.env, accountId = ACCOUNT_ID, workerName = WORKER_NAME } = {},
) {
	// Build and validate the payload first: an invalid name or an empty
	// patch must fail before any network call, in dry run too.
	const payload = buildBulkSecretPayload(changes);
	const operationCount = Object.keys(payload.secrets).length;
	const plan = Object.entries(payload.secrets).map(([name, value]) => ({
		name,
		operation: value === null ? 'delete' : 'create/update',
	}));

	// The gate guards the MUTATION. A dry run is the explicitly
	// non-mutating path: it reports the plan and sends nothing, so it
	// must not be rejected as an un-authorised write.
	if (!execute) {
		return { applied: false, plan };
	}

	assertWorkerSecretWriteAllowed({ execute, accountId, workerName, env, operationCount });

	await workerJson('PATCH', `/accounts/${accountId}/workers/scripts/${workerName}/secrets-bulk`, {
		body: payload,
		env,
		accountId,
		workerName,
	});
	return { applied: true, plan };
}

export { MAX_OPERATIONS, SECRET_NAME_RE };
