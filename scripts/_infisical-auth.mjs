#!/usr/bin/env node
/**
 * Infisical authentication strategy for the production rotation /
 * Phase B drivers (Issue #223).
 *
 * Why this helper exists
 * ----------------------
 * The four production secret drivers —
 * `rotate-better-auth-secret.mjs`, `rotate-home-api-key.mjs`,
 * `rotate-dev-better-auth-secret.mjs`, and
 * `phase-3-plus-prod-flip.mjs` — each hard-required
 * `process.env.INFISICAL_TOKEN` and threw before any side effect when
 * it was absent. That made an operator who already holds an
 * interactively-authenticated `infisical` CLI session unable to run
 * the production cutover without minting a second credential.
 *
 * The token was never a secrecy control. The #139 incident control is
 * the **value-handling** contract: values travel through 0600 temp
 * files, `wrangler secret bulk` stdin, and stripped child environments
 * — never argv, stdout, GitHub, or chat. That contract is unchanged
 * here. What the token requirement provided was an *explicit,
 * assertable* write identity; this module preserves that property by
 * **preflighting the CLI session before any mutation** rather than
 * removing the check.
 *
 * Auth precedence
 * ---------------
 *   1. `INFISICAL_TOKEN` present  → token mode. Byte-identical to the
 *      pre-#223 behaviour; the token is handed to the Infisical CLI
 *      subprocess and used for HTTPS read-back.
 *   2. absent + CLI session reads → CLI mode. The driver holds **no
 *      bearer token at all**; the CLI authenticates itself and the
 *      read-back runs inside a CLI-auth child process.
 *   3. neither                  → fail closed, before any mutation.
 *
 * Deliberately NOT done
 * ---------------------
 * A production **write** probe. Probing write scope requires writing,
 * so a probe would itself mutate production Infisical; the read
 * preflight catches the high-value failures (no session, wrong
 * project, wrong environment, revoked session) and the drivers'
 * existing `--worker-recovery` / `--disable-row` contracts cover a
 * session that reads but does not write.
 *
 * `infisical run` exit-code contract (verified 2026-10-03):
 *   readable env → exit 0; unreadable project/environment → exit 1.
 * That is what makes `preflightCliSession` a real gate.
 *
 * Value handling: this module never returns, logs, or interpolates a
 * secret value. Comparisons happen through a per-call HMAC-SHA256 salt
 * that is generated, used, and discarded inside a single function —
 * nothing that leaves the process is stable or reusable.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Auth strategy selected by {@link resolveInfisicalAuth}. */
export const AUTH_MODE = {
	/** Operator-supplied `INFISICAL_TOKEN`; pre-#223 behaviour. */
	TOKEN: 'token',
	/** Operator's interactively-authenticated `infisical` CLI session. */
	CLI: 'cli',
};

/** Full Infisical credential set stripped from non-Infisical children. */
const INFISICAL_CREDENTIAL_KEYS = [
	'INFISICAL_TOKEN',
	'INFISICAL_CLIENT_ID',
	'INFISICAL_CLIENT_SECRET',
	'INFISICAL_PROJECT_ID',
	'INFISICAL_SITE_URL',
	'INFISICAL_API_URL',
];

/** Base64url salt used for one-shot value comparison. Never persisted. */
function freshSalt() {
	return randomBytes(32).toString('base64url');
}

/**
 * HMAC-SHA256 of a value under a one-shot salt. Only the digest is
 * ever returned; the caller compares digests, not values.
 */
export function hmacDigest(salt, value) {
	return createHmac('sha256', salt).update(value, 'utf8').digest('hex');
}

/**
 * Constant-time equality that is also safe for unequal lengths.
 *
 * `timingSafeEqual` throws when the two buffers differ in length, so
 * the length check must come first — a length mismatch is a mismatch,
 * not an error. Mirrors `rotate-better-auth-secret.mjs#secretValuesEqual`.
 */
export function valuesEqual(a, b) {
	const bufA = Buffer.from(a, 'utf8');
	const bufB = Buffer.from(b, 'utf8');
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

/**
 * Read `INFISICAL_TOKEN` from an environment, or `null` when unset /
 * empty. Never logs the value.
 */
export function readExplicitToken(env = process.env) {
	const token = env.INFISICAL_TOKEN;
	return typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * Build the env for the **Infisical CLI** subprocess.
 *
 * Token mode: injects `INFISICAL_TOKEN` and strips the UA fields the
 * CLI would otherwise inherit (pre-#143/#140 contract).
 *
 * CLI mode: strips the **entire** credential set, including any
 * ambient `INFISICAL_TOKEN`, so the CLI is forced to use its own
 * stored session rather than silently picking up a token from a
 * parent environment that the driver did not validate.
 */
export function buildInfisicalEnv(baseEnv, { mode, token = null }) {
	const env = { ...baseEnv };
	if (mode === AUTH_MODE.TOKEN) {
		env.INFISICAL_TOKEN = token;
	} else {
		env.INFISICAL_TOKEN = undefined;
	}
	for (const key of INFISICAL_CREDENTIAL_KEYS) {
		if (key === 'INFISICAL_TOKEN') continue;
		env[key] = undefined;
	}
	return env;
}

/**
 * Build the env for **Wrangler / D1** subprocesses. Strips the full
 * Infisical credential set so a writer-scoped credential can never
 * leak into a Cloudflare child process.
 */
export function buildWranglerEnv(baseEnv) {
	const env = { ...baseEnv };
	for (const key of INFISICAL_CREDENTIAL_KEYS) {
		env[key] = undefined;
	}
	return env;
}

/** Args for `infisical run`, shared by preflight and digest reads. */
function buildRunArgs({ environment, projectId, script }) {
	return [
		'run',
		'--env',
		environment,
		'--path',
		'/',
		'--projectId',
		projectId,
		'--',
		process.execPath,
		'-e',
		script,
	];
}

/**
 * Read-only preflight: prove the CLI session can authenticate against
 * the target project + environment.
 *
 * This is the read-side gate that replaces the token assertion. It
 * deliberately does NOT read any secret value — it only proves the
 * session can list the environment, so a missing/expired session or a
 * wrong project/environment fails **before** the first mutation.
 *
 * @returns {Promise<{ok: true, authMode: string}>}
 * @throws when the CLI is unusable or the session cannot read.
 */
export async function preflightCliSession({
	cliPath,
	environment,
	projectId,
	env,
	spawn = spawnSync,
	timeoutMs = 30_000,
}) {
	const result = spawn(
		cliPath,
		buildRunArgs({
			environment,
			projectId,
			script: 'process.exit(0)',
		}),
		{ env, timeout: timeoutMs, stdio: 'ignore' },
	);

	if (result.error) {
		throw new Error(
			`Infisical CLI session preflight failed to run: ${result.error.message}. Run the infisical login flow (or set INFISICAL_TOKEN) before retrying.`,
		);
	}
	if (result.status !== 0) {
		throw new Error(
			`Infisical CLI session cannot read environment=${environment} (exit ${result.status}). The session may be logged out, lack access to the project, or the project id may be wrong. No mutation was attempted.`,
		);
	}
	return { ok: true, authMode: AUTH_MODE.CLI };
}

/**
 * Compare a secret against an expected value **without** either value
 * leaving this process.
 *
 * Token mode: direct HTTPS read-back (pre-#223 behaviour).
 * CLI mode: a CLI-auth child process reads the secret from its
 * injected environment, computes `HMAC-SHA256(salt, value)` with a
 * one-shot salt, and writes **only the digest** to a 0600 temp file.
 * The caller compares digests with `timingSafeEqual`.
 *
 * @returns {Promise<{status: 'match'|'mismatch'|'missing', digest?: string}>}
 */
export async function compareSecretViaAuth({
	auth,
	apiUrl,
	cliPath,
	environment,
	projectId,
	name,
	expected,
	token = null,
	readViaToken,
	env = process.env,
	spawn = spawnSync,
	timeoutMs = 30_000,
}) {
	const salt = freshSalt();
	const expectedDigest = hmacDigest(salt, expected);

	if (auth.mode === AUTH_MODE.TOKEN) {
		const actual = await readViaToken({ apiUrl, token, environment, name });
		if (actual === null) return { status: 'missing' };
		const actualDigest = hmacDigest(salt, actual);
		return { status: valuesEqual(actualDigest, expectedDigest) ? 'match' : 'mismatch' };
	}

	// CLI mode — the child never receives the expected value.
	const cliEnv = buildInfisicalEnv(env, { mode: AUTH_MODE.CLI });
	const tempDir = mkdtempSync(join(tmpdir(), 'my-web-2026-authcheck-'));
	const outPath = join(tempDir, 'digest');
	const childScript = [
		`const c=require('node:crypto'),fs=require('node:fs');`,
		`const v=process.env[${JSON.stringify(name)}];`,
		`fs.writeFileSync(${JSON.stringify(outPath)},`,
		`  typeof v==='string'&&v.length>0`,
		`    ? c.createHmac('sha256',${JSON.stringify(salt)}).update(v,'utf8').digest('hex')`,
		`    : 'MISSING',{mode:0o600});`,
	].join('');

	try {
		const result = spawn(cliPath, buildRunArgs({ environment, projectId, script: childScript }), {
			env: cliEnv,
			timeout: timeoutMs,
			stdio: 'ignore',
		});
		if (result.error) {
			throw new Error(`Infisical CLI digest read failed to run: ${result.error.message}`);
		}
		if (result.status !== 0) {
			throw new Error(
				`Infisical CLI digest read failed (exit ${result.status}) for environment=${environment}.`,
			);
		}
		const digest = readFileSync(outPath, 'utf8');
		if (digest === 'MISSING') return { status: 'missing' };
		return { status: valuesEqual(digest, expectedDigest) ? 'match' : 'mismatch', digest };
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

/**
 * Materialise a secret value into a caller-owned 0600 file, using
 * whichever auth mode is active.
 *
 * Only needed by recovery paths that must replay an *existing* value
 * (e.g. `rotate-better-auth-secret --worker-recovery` re-pushes the
 * value already stored in Infisical to the Worker). The primary
 * `--execute` paths generate the value locally and never call this.
 *
 * In CLI mode the value is written by a CLI-auth child so the driver
 * never holds a bearer token; the returned path is the caller's
 * responsibility to delete in a `finally` block. This matches the
 * existing temp-YAML trust model (0600 + explicit cleanup).
 *
 * @returns {Promise<{path: string, cleanup: () => void}>}
 */
export async function materialiseSecret({
	auth,
	apiUrl,
	cliPath,
	environment,
	projectId,
	name,
	token = null,
	readViaToken,
	env = process.env,
	spawn = spawnSync,
	timeoutMs = 30_000,
}) {
	if (auth.mode === AUTH_MODE.TOKEN) {
		const value = await readViaToken({ apiUrl, token, environment, name });
		if (value === null) {
			throw new Error(`${name} is missing in environment=${environment}`);
		}
		const dir = mkdtempSync(join(tmpdir(), 'my-web-2026-recovery-'));
		const path = join(dir, 'value');
		writeFileSync(path, value, { encoding: 'utf8', mode: 0o600 });
		return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
	}

	const dir = mkdtempSync(join(tmpdir(), 'my-web-2026-recovery-'));
	const path = join(dir, 'value');
	const childScript = [
		`const fs=require('node:fs');`,
		`const v=process.env[${JSON.stringify(name)}];`,
		`if(typeof v!=='string'||!v){process.stderr.write('missing');process.exit(3);}`,
		`fs.writeFileSync(${JSON.stringify(path)},v,{mode:0o600});`,
	].join('');

	const result = spawn(cliPath, buildRunArgs({ environment, projectId, script: childScript }), {
		env: buildInfisicalEnv(env, { mode: AUTH_MODE.CLI }),
		timeout: timeoutMs,
		stdio: 'ignore',
	});
	if (result.error) {
		rmSync(dir, { recursive: true, force: true });
		throw new Error(`Infisical CLI value read failed to run: ${result.error.message}`);
	}
	if (result.status !== 0) {
		rmSync(dir, { recursive: true, force: true });
		throw new Error(
			result.status === 3
				? `${name} is missing in environment=${environment}`
				: `Infisical CLI value read failed (exit ${result.status}).`,
		);
	}
	return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Is a secret present in the environment? Returns a boolean and
 * nothing else — no value, and no value-derived length.
 *
 * Token mode keeps the direct HTTPS read. CLI mode asks a CLI-auth
 * child, which sees only its own injected env.
 */
export async function secretPresenceViaAuth({
	auth,
	apiUrl,
	cliPath,
	environment,
	projectId,
	name,
	token = null,
	readViaToken,
	env = process.env,
	spawn = spawnSync,
	timeoutMs = 30_000,
}) {
	if (auth.mode === AUTH_MODE.TOKEN) {
		const value = await readViaToken({ apiUrl, token, environment, name });
		return typeof value === 'string' && value.length > 0;
	}

	const tempDir = mkdtempSync(join(tmpdir(), 'my-web-2026-authcheck-'));
	const outPath = join(tempDir, 'presence');
	const childScript = [
		`const fs=require('node:fs');`,
		`const v=process.env[${JSON.stringify(name)}];`,
		`fs.writeFileSync(${JSON.stringify(outPath)},`,
		`  (typeof v==='string'&&v.length>0)?'PRESENT':'ABSENT',{mode:0o600});`,
	].join('');

	try {
		const result = spawn(cliPath, buildRunArgs({ environment, projectId, script: childScript }), {
			env: buildInfisicalEnv(env, { mode: AUTH_MODE.CLI }),
			timeout: timeoutMs,
			stdio: 'ignore',
		});
		if (result.error) {
			throw new Error(`Infisical CLI presence check failed to run: ${result.error.message}`);
		}
		if (result.status !== 0) {
			throw new Error(
				`Infisical CLI presence check failed (exit ${result.status}) for environment=${environment}.`,
			);
		}
		return readFileSync(outPath, 'utf8') === 'PRESENT';
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

/**
 * Summarise the Better Auth secret pair **without** reading either
 * value into this process.
 *
 * The envelope invariant (`BETTER_AUTH_SECRETS === '1:' + BETTER_AUTH_SECRET`)
 * needs both values, so in CLI mode it is evaluated inside a CLI-auth
 * child that already has both in its injected environment. The child
 * emits only booleans plus a status string; no value, and no
 * value-derived length, is ever returned.
 *
 * Token mode reuses {@link compareSecretViaAuth} for the envelope so
 * the token path keeps its pre-#223 semantics.
 *
 * @returns {Promise<{legacyPresent: boolean, versionedPresent: boolean,
 *   envelopeOk: boolean|null, status: string}>}
 */
export async function summarizeSecretPairViaAuth({
	auth,
	apiUrl,
	cliPath,
	environment,
	projectId,
	legacyName,
	versionedName,
	versionPrefix = '1:',
	token = null,
	readViaToken,
	env = process.env,
	spawn = spawnSync,
	timeoutMs = 30_000,
}) {
	if (auth.mode === AUTH_MODE.TOKEN) {
		const legacy = await readViaToken({ apiUrl, token, environment, name: legacyName });
		const versioned = await readViaToken({ apiUrl, token, environment, name: versionedName });
		const legacyPresent = typeof legacy === 'string' && legacy.length > 0;
		const versionedPresent = typeof versioned === 'string' && versioned.length > 0;
		if (!legacyPresent && !versionedPresent) {
			return { legacyPresent, versionedPresent, envelopeOk: null, status: 'BOTH_MISSING' };
		}
		if (legacyPresent && !versionedPresent) {
			return { legacyPresent, versionedPresent, envelopeOk: null, status: 'LEGACY_ONLY' };
		}
		if (!legacyPresent && versionedPresent) {
			return { legacyPresent, versionedPresent, envelopeOk: null, status: 'VERSIONED_ONLY' };
		}
		const envelopeOk = valuesEqual(versioned, `${versionPrefix}${legacy}`);
		return {
			legacyPresent,
			versionedPresent,
			envelopeOk,
			status: envelopeOk ? 'CONSISTENT' : 'DIVERGENT',
		};
	}

	const tempDir = mkdtempSync(join(tmpdir(), 'my-web-2026-authcheck-'));
	const outPath = join(tempDir, 'summary');
	const childScript = [
		`const fs=require('node:fs');`,
		`const l=process.env[${JSON.stringify(legacyName)}];`,
		`const v=process.env[${JSON.stringify(versionedName)}];`,
		`const lp=typeof l==='string'&&l.length>0;`,
		`const vp=typeof v==='string'&&v.length>0;`,
		'let env_ok=null,status;',
		"if(!lp&&!vp){status='BOTH_MISSING';}",
		"else if(lp&&!vp){status='LEGACY_ONLY';}",
		"else if(!lp&&vp){status='VERSIONED_ONLY';}",
		`else{env_ok=(v===${JSON.stringify(versionPrefix)}+l);status=env_ok?'CONSISTENT':'DIVERGENT';}`,
		`fs.writeFileSync(${JSON.stringify(outPath)},JSON.stringify({`,
		'  legacyPresent:lp,versionedPresent:vp,envelopeOk:env_ok,status',
		'}),{mode:0o600});',
	].join('');

	try {
		const result = spawn(cliPath, buildRunArgs({ environment, projectId, script: childScript }), {
			env: buildInfisicalEnv(env, { mode: AUTH_MODE.CLI }),
			timeout: timeoutMs,
			stdio: 'ignore',
		});
		if (result.error) {
			throw new Error(`Infisical CLI summary failed to run: ${result.error.message}`);
		}
		if (result.status !== 0) {
			throw new Error(
				`Infisical CLI summary failed (exit ${result.status}) for environment=${environment}.`,
			);
		}
		return JSON.parse(readFileSync(outPath, 'utf8'));
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

/**
 * Resolve the auth strategy for a driver invocation.
 *
 * Order: explicit `INFISICAL_TOKEN` wins (unchanged pre-#223 path);
 * otherwise the logged-in CLI session is preflighted and used; if
 * neither is available the caller must fail closed **before** any
 * mutation.
 *
 * @returns {Promise<{mode: string, token: string|null}>}
 */
export async function resolveInfisicalAuth({
	env = process.env,
	cliPath,
	environment,
	projectId,
	spawn = spawnSync,
}) {
	const token = readExplicitToken(env);
	if (token) {
		return { mode: AUTH_MODE.TOKEN, token };
	}
	// CLI mode must prove the *stored CLI session* specifically. Strip
	// Universal Auth and other Infisical credentials before the probe;
	// otherwise an ambient viewer Machine Identity could make the read
	// preflight pass and then disappear for the later write, violating
	// the fail-closed-before-mutation contract.
	const cliEnv = buildInfisicalEnv(env, { mode: AUTH_MODE.CLI });
	await preflightCliSession({ cliPath, environment, projectId, env: cliEnv, spawn });
	return { mode: AUTH_MODE.CLI, token: null };
}
