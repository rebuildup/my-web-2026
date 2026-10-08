/**
 * Repository-owned R2 driver for `cf` (Issue #247, cleanup slice).
 *
 * Mirrors `_d1.mjs` deliberately. The two adapters have the same shape
 * because the same reasoning applies to both: a beta CLI's defaults are
 * not a safety model, and a repo-owned driver is where the safety model
 * lives.
 *
 * Targets
 * -------
 *   local        — the default, and the only target a script can reach
 *                  by accident.
 *   production   — the only remote bucket this repository owns. Named
 *                  explicitly rather than called `remote`: `remote`
 *                  hides the blast radius, and here the remote bucket
 *                  IS production.
 *
 * There is no `remote` target, exactly as in `_d1.mjs`.
 *
 * A production MUTATION requires all of:
 *   - target === 'production'
 *   - an explicit `execute: true`
 *   - the canonical account id
 *   - the canonical bucket name
 *   - an R2-scoped credential
 *
 * Identity is checked against the canonical constants, never against a
 * bucket NAME discovered from a config file.
 *
 * Credential separation
 * ---------------------
 *   CLOUDFLARE_API_TOKEN      Worker deploy / Worker API / secret mutation
 *   CLOUDFLARE_D1_API_TOKEN   D1 only
 *   CLOUDFLARE_R2_API_TOKEN   R2 only
 *
 * Three distinct capabilities, deliberately not merged into one
 * all-powerful token. The `cf` CLI requires the env var named
 * `CLOUDFLARE_API_TOKEN`, so the child's env NAME stays that — but the
 * VALUE handed to an R2 child is the R2 token. An R2 child never falls
 * back to the Worker deploy token, and an R2 child never receives the
 * D1 token.
 *
 * Permission model: for the Cloudflare REST API this is the bucket-scoped
 * **Workers R2 Storage** read/write permission, NOT an S3 Access Key /
 * Secret pair. S3 credentials are a different product surface with a
 * different blast radius and are deliberately not used here.
 *
 * A LOCAL operation requires NO Cloudflare credential at all and is
 * handed a credential-free env, so a local operation can never silently
 * depend on a production token.
 *
 * Local persistence
 * -----------------
 * Local operations use the same `--persist-to` directory as the Vite dev
 * server and every other `cf --local` command in this repository. That
 * makes local state visible in BOTH directions: a script writes an
 * object the running Worker can read, and an object the Worker wrote is
 * readable by a script.
 *
 * CLI surface
 * -----------
 * The argument shapes below were read from the installed CLI's own help
 * (`cf r2 objects put --help`, `cf r2 objects get --help`), NOT guessed
 * from the wrangler equivalents — and the two genuinely differ:
 *
 *   - it is `cf r2 objects`, plural; wrangler used `r2 object`
 *   - the bucket is `--bucket-name`, not a `bucket/key` positional
 *   - `get` has NO `--file`: it writes raw bytes to stdout, and `--text`
 *     decodes them as UTF-8
 *
 * A beta CLI can change any of this. Keeping the translation here means
 * one file absorbs it.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_ID, LOCAL_STATE_DIR, R2_BUCKET_NAME } from './_cloudflare-identity.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The only targets. There is no `remote`. */
export const R2_TARGETS = /** @type {const} */ (['local', 'production']);

/** Hard ceiling on one bulk call, so a bug cannot fan out into a mass write. */
export const MAX_OPERATIONS = 64;

/** R2 object keys: 1-1024 printable characters. */
const OBJECT_KEY_RE = /^.{1,1024}$/;

/**
 * Control characters are rejected by an explicit code-point scan rather
 * than by the shape regex. A negated class containing control-character
 * escapes reads as "any character except these", which is easy to get
 * subtly wrong (and is flagged as suspicious); scanning for them states
 * the rule directly.
 */
function hasControlCharacter(key) {
	for (const character of key) {
		const code = character.codePointAt(0);
		// C0 controls, DEL, and C1 controls.
		if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
	}
	return false;
}

/** Content types the publication path actually writes. */
const CONTENT_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

/**
 * R2-scoped credential for a remote child/request.
 *
 * Deliberately does not fall back to `CLOUDFLARE_API_TOKEN` (the Worker
 * deploy token) or `CLOUDFLARE_D1_API_TOKEN`. Expanding either into R2
 * capability would quietly widen a token's scope.
 */
function r2Credential(env) {
	const token = env.CLOUDFLARE_R2_API_TOKEN;
	if (typeof token !== 'string' || token.length === 0) {
		throw new Error(
			'CLOUDFLARE_R2_API_TOKEN is required for a remote R2 operation. It is an R2-scoped ' +
				'credential (Workers R2 Storage read/write) and is deliberately distinct from ' +
				'CLOUDFLARE_API_TOKEN (Worker deploy / Worker API) and CLOUDFLARE_D1_API_TOKEN ' +
				'(D1). Neither may be accepted as a fallback here. Local R2 operations need no ' +
				'Cloudflare credential at all.',
		);
	}
	return token;
}

function remoteChildEnv(env) {
	return {
		PATH: env.PATH,
		HOME: env.HOME,
		// cf requires this name; the value is the R2-scoped token.
		CLOUDFLARE_API_TOKEN: r2Credential(env),
	};
}

/** Local operations get NO Cloudflare credential. */
function localChildEnv(env) {
	return { PATH: env.PATH, HOME: env.HOME };
}

function cf(args, { env = process.env, cwd = REPO_ROOT, local = false, encoding = 'utf8' } = {}) {
	return execFileSync('pnpm', ['exec', 'cf', ...args], {
		cwd,
		// Never let the child inherit stdin. `cf` can prompt (notably
		// for authentication when no credential is present), and an
		// automated path that waits on a prompt it cannot answer hangs
		// until the timeout. CI has no TTY, so the prompt blocks until
		// the runner kills the step — which is exactly what the Playwright
		// E2E step did on release-0-6-0.
		stdio: ['ignore', 'pipe', 'pipe'],
		encoding,
		env: local ? localChildEnv(env) : remoteChildEnv(env),
		timeout: 600_000,
		maxBuffer: 256 * 1024 * 1024,
	});
}

/** Resolve + validate a target. Throws rather than defaulting to production. */
export function resolveTarget(target) {
	if (target === undefined || target === null) return 'local'; // safe default
	if (!R2_TARGETS.includes(target)) {
		throw new Error(
			`refusing R2 target ${JSON.stringify(target)}: expected one of ${R2_TARGETS.join(', ')}. There is no "remote" target; the only remote bucket is production and it must be named.`,
		);
	}
	return target;
}

/**
 * The lowest-level production WRITE gate.
 *
 * EVERY production write primitive calls this, so the gate does not
 * depend on a caller remembering one `if`. Reads (`getObject`,
 * `listObjects`) deliberately do not call it — but they do check
 * identity, so a read cannot be aimed at a foreign bucket either.
 */
export function assertProductionWriteAllowed({
	target,
	execute,
	kind = 'mutation',
	bucketName = R2_BUCKET_NAME,
	accountId = ACCOUNT_ID,
	env = process.env,
}) {
	if (target !== 'production') return; // local is the safe default
	if (!execute) {
		throw new Error(
			`refusing a production R2 ${kind}: requires an explicit execute. An omitted flag would otherwise be a production write.`,
		);
	}
	if (accountId !== ACCOUNT_ID) {
		throw new Error(`refusing a production R2 ${kind} on account ${accountId}.`);
	}
	if (bucketName !== R2_BUCKET_NAME) {
		throw new Error(
			`refusing a production R2 ${kind} against bucket ${bucketName}: expected ${R2_BUCKET_NAME}.`,
		);
	}
	// Resolve the credential here so a missing one is an explicit error
	// rather than an opaque 401 from the API.
	r2Credential(env);
}

/** Identity check shared by reads and writes. */
function assertCanonicalIdentity({ bucketName, accountId, target, kind }) {
	if (bucketName !== R2_BUCKET_NAME) {
		throw new Error(
			`refusing an R2 ${kind} against bucket ${bucketName}: expected the canonical ${R2_BUCKET_NAME}.`,
		);
	}
	if (accountId !== ACCOUNT_ID) {
		throw new Error(`refusing an R2 ${kind} on account ${accountId}.`);
	}
	if (target !== 'local' && target !== 'production') {
		throw new Error(`refusing an R2 ${kind} with target ${target}.`);
	}
}

function localArgs() {
	return ['--local', '--persist-to', join(REPO_ROOT, LOCAL_STATE_DIR)];
}

function assertKey(key) {
	if (typeof key !== 'string' || !OBJECT_KEY_RE.test(key)) {
		throw new Error(`invalid R2 object key: ${JSON.stringify(key)}`);
	}
	if (hasControlCharacter(key)) {
		throw new Error(`R2 object key must not contain control characters: ${JSON.stringify(key)}`);
	}
	if (key.startsWith('/') || key.endsWith('/')) {
		throw new Error(`R2 object key must not start or end with '/': ${JSON.stringify(key)}`);
	}
	return key;
}

function assertContentType(contentType) {
	if (typeof contentType !== 'string' || !CONTENT_TYPE_RE.test(contentType)) {
		throw new Error(
			`R2 uploads require an explicit valid content type; got ${JSON.stringify(contentType)}. Portfolio media is served with its real type by the Worker and the R2 custom domain, so an implicit or guessed type is a correctness bug, not a default.`,
		);
	}
	return contentType;
}

/**
 * Upload one object.
 *
 * `contentType` is REQUIRED, not defaulted: the public media surface
 * serves the stored Content-Type, so an omitted type would ship a wrong
 * MIME type to a CDN and to OGP crawlers.
 */
export function putObject(
	key,
	filePath,
	{
		target = 'local',
		contentType,
		bucketName = R2_BUCKET_NAME,
		accountId = ACCOUNT_ID,
		env = process.env,
		execute = false,
	} = {},
) {
	const resolved = resolveTarget(target);
	assertCanonicalIdentity({ bucketName, accountId, target: resolved, kind: 'put' });
	assertKey(key);
	assertContentType(contentType);
	// `execute` is a PRODUCTION gate, exactly as in `_d1.mjs`.
	//
	// A local write goes to an ephemeral `.tmp/` store and is not a
	// production mutation, so the operator gate does not apply to it.
	// Gating local writes too would make every local R2 script silently
	// a no-op that still reported success — which is precisely the bug
	// this ordering was written to remove.
	//
	// A production upload with no `execute` is a DRY RUN: it reports the
	// plan and sends nothing. That is checked BEFORE the gate, because
	// the gate requires a credential precisely for a real write, and a
	// dry run should not need one.
	if (resolved === 'production' && !execute) {
		return { applied: false, key, bucket: bucketName, target: resolved, contentType };
	}

	assertProductionWriteAllowed({
		target: resolved,
		execute,
		kind: 'object put',
		bucketName,
		accountId,
		env,
	});

	const args = [
		'r2',
		'objects',
		'put',
		key,
		'--bucket-name',
		bucketName,
		'--content-type',
		contentType,
		'--file',
		filePath,
		...(resolved === 'local' ? localArgs() : []),
	];
	const stdout = cf(args, { env, local: resolved === 'local' });
	return { applied: true, key, bucket: bucketName, target: resolved, contentType, stdout };
}

/**
 * Download one object.
 *
 * `cf r2 objects get` has no `--file`: it writes raw bytes to stdout.
 * A Buffer is returned by default so a binary asset is never mangled
 * by a text decode; pass `text: true` for a UTF-8 string.
 */
export function getObject(
	key,
	{
		target = 'local',
		bucketName = R2_BUCKET_NAME,
		accountId = ACCOUNT_ID,
		env = process.env,
		text = false,
	} = {},
) {
	const resolved = resolveTarget(target);
	assertCanonicalIdentity({ bucketName, accountId, target: resolved, kind: 'get' });
	assertKey(key);

	const args = [
		'r2',
		'objects',
		'get',
		key,
		'--bucket-name',
		bucketName,
		...(text ? ['--text'] : []),
		...(resolved === 'local' ? localArgs() : []),
	];
	return cf(args, { env, local: resolved === 'local', encoding: text ? 'utf8' : 'buffer' });
}

/** List object keys in the bucket. */
export function listObjects({
	target = 'local',
	bucketName = R2_BUCKET_NAME,
	accountId = ACCOUNT_ID,
	env = process.env,
} = {}) {
	const resolved = resolveTarget(target);
	assertCanonicalIdentity({ bucketName, accountId, target: resolved, kind: 'list' });
	const args = [
		'r2',
		'objects',
		'list',
		'--bucket-name',
		bucketName,
		...(resolved === 'local' ? localArgs() : []),
	];
	return parseCfJson(cf(args, { env, local: resolved === 'local' }));
}

function parseCfJson(stdout) {
	const trimmed = String(stdout ?? '').trim();
	if (trimmed.length === 0) return null;
	const start = trimmed.search(/[[{]/);
	if (start === -1) return null;
	try {
		return JSON.parse(trimmed.slice(start));
	} catch {
		const end = Math.max(trimmed.lastIndexOf(']'), trimmed.lastIndexOf('}'));
		if (end <= start) throw new Error('could not parse cf JSON output');
		return JSON.parse(trimmed.slice(start, end + 1));
	}
}

export { R2_BUCKET_NAME };
