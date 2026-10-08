/**
 * Non-secret Cloudflare contract verification (Issue #247, cleanup slice).
 *
 * Two phases, because they have different runtimes:
 *
 *   static     — the contract module is internally consistent and the
 *                canonical identities are well formed. Runs in
 *                `validate:fast`, needs no build.
 *   build      — the generated Build Output actually implements the
 *                contract: its secret bindings are EXACTLY the required
 *                set, and no audit-only name has resurrected. Runs after
 *                `build:production` in `validate:integration`.
 *
 * The build phase is skipped when no Build Output exists, so this script
 * is safe to run before a build without reporting a false pass: it says
 * so explicitly and exits 0 with a SKIPPED note, while `--build` makes
 * the absence a failure. `validate:integration` passes `--build` because
 * it has just built.
 *
 * The generated Build Output is the deployed truth. This check
 * deliberately does NOT read `cloudflare.config.ts` — parsing the config
 * source would only prove the config agrees with itself, and would
 * re-introduce exactly the text-scraping coupling the migration removes.
 *
 * No secret VALUES are read, asserted, or printed. Bindings carry
 * `{"type":"secret"}` with no value, and that is the whole point.
 *
 * Exit: 0 pass (or skipped), 1 violated, 2 bad input.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AUDIT_ONLY_SECRETS,
	PRODUCTION_BETTER_AUTH_URL,
	PRODUCTION_CUSTOM_DOMAIN,
	PRODUCTION_MEDIA_PUBLIC_BASE_URL,
	RATE_LIMIT_BINDING,
	RATE_LIMIT_NAMESPACES,
	REQUIRED_RUNTIME_SECRETS,
} from './_cloudflare-contract.mjs';
import {
	ACCOUNT_ID,
	D1_DATABASE_ID,
	R2_BUCKET_NAME,
	WORKER_NAME,
} from './_cloudflare-identity.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_OUTPUT = join(REPO_ROOT, '.cloudflare', 'output', 'v0');
const WORKER_CONFIG = join(BUILD_OUTPUT, 'workers', 'default', 'worker.config.json');
const ROOT_CONFIG = join(BUILD_OUTPUT, 'config.json');

/** The number of Worker runtime secrets this repository has settled on. */
const EXPECTED_REQUIRED_SECRET_COUNT = 3;

const errors = [];
const notes = [];

function fail(message) {
	errors.push(message);
}

function sameSet(a, b) {
	if (a.length !== b.length) return false;
	const left = [...a].sort();
	const right = [...b].sort();
	return left.every((value, index) => value === right[index]);
}

/* -- static: the contract module ---------------------------------------- */

function checkContractShape() {
	if (!Array.isArray(REQUIRED_RUNTIME_SECRETS) || REQUIRED_RUNTIME_SECRETS.length === 0) {
		fail('REQUIRED_RUNTIME_SECRETS must be a non-empty array');
		return;
	}
	if (REQUIRED_RUNTIME_SECRETS.length !== EXPECTED_REQUIRED_SECRET_COUNT) {
		fail(
			`REQUIRED_RUNTIME_SECRETS must have exactly ${EXPECTED_REQUIRED_SECRET_COUNT} names, got ${REQUIRED_RUNTIME_SECRETS.length}: ${REQUIRED_RUNTIME_SECRETS.join(', ')}`,
		);
	}
	const unique = new Set(REQUIRED_RUNTIME_SECRETS);
	if (unique.size !== REQUIRED_RUNTIME_SECRETS.length) {
		fail('REQUIRED_RUNTIME_SECRETS contains a duplicate name');
	}
	for (const name of REQUIRED_RUNTIME_SECRETS) {
		if (!/^[A-Za-z0-9_]{1,128}$/.test(name)) {
			fail(`REQUIRED_RUNTIME_SECRETS contains an invalid Worker binding name: ${name}`);
		}
	}
	// An audit-only name in the required set would upload the legacy
	// binding — the exact resurrection this split exists to prevent.
	const overlap = REQUIRED_RUNTIME_SECRETS.filter((name) => AUDIT_ONLY_SECRETS.includes(name));
	if (overlap.length > 0) {
		fail(`audit-only names must not appear in the required set: ${overlap.join(', ')}`);
	}
	for (const name of AUDIT_ONLY_SECRETS) {
		if (!/^[A-Za-z0-9_]{1,128}$/.test(name)) {
			fail(`AUDIT_ONLY_SECRETS contains an invalid Worker binding name: ${name}`);
		}
	}
	if (Object.isFrozen(REQUIRED_RUNTIME_SECRETS) !== true) {
		notes.push('REQUIRED_RUNTIME_SECRETS is not frozen');
	}
}

function checkIdentity() {
	// An account id is 32 hex chars. A D1 database id is a UUID — the
	// same 32 hex digits, hyphenated — so it is validated as a UUID
	// rather than as bare hex.
	const hex32 = /^[0-9a-f]{32}$/;
	const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
	if (!hex32.test(ACCOUNT_ID)) fail(`ACCOUNT_ID is not a 32-char hex account id: ${ACCOUNT_ID}`);
	if (!uuid.test(D1_DATABASE_ID)) {
		fail(`D1_DATABASE_ID is not a UUID-shaped database id: ${D1_DATABASE_ID}`);
	}
	if (typeof WORKER_NAME !== 'string' || WORKER_NAME.length === 0) {
		fail('WORKER_NAME must be a non-empty string');
	}
	if (typeof R2_BUCKET_NAME !== 'string' || R2_BUCKET_NAME.length === 0) {
		fail('R2_BUCKET_NAME must be a non-empty string');
	}
	if (PRODUCTION_BETTER_AUTH_URL !== `https://${PRODUCTION_CUSTOM_DOMAIN}`) {
		fail(
			`BETTER_AUTH_URL must pin the canonical production origin, got ${PRODUCTION_BETTER_AUTH_URL}`,
		);
	}
	if (PRODUCTION_MEDIA_PUBLIC_BASE_URL !== 'https://media.rebuildup.dev') {
		fail(
			`MEDIA_PUBLIC_BASE_URL must be the R2 public custom domain, got ${PRODUCTION_MEDIA_PUBLIC_BASE_URL}`,
		);
	}
	for (const binding of Object.values(RATE_LIMIT_BINDING)) {
		if (!/^[0-9a-f]{32}$/.test(RATE_LIMIT_NAMESPACES[binding])) {
			fail(`rate-limit namespace for ${binding} is not a 32-char hex id`);
		}
	}
}

/* -- build: the generated artifact implements the contract --------------- */

function checkBuildOutput() {
	if (!existsSync(WORKER_CONFIG) || !existsSync(ROOT_CONFIG)) {
		return 'missing';
	}
	const worker = JSON.parse(readFileSync(WORKER_CONFIG, 'utf8'));
	const root = JSON.parse(readFileSync(ROOT_CONFIG, 'utf8'));
	const env = worker?.env ?? {};

	if (root?.accountId !== ACCOUNT_ID) {
		fail(`Build Output accountId is ${root?.accountId}, expected ${ACCOUNT_ID}`);
	}
	if (root?.buildContext?.mode !== 'production') {
		fail(`Build Output mode is ${root?.buildContext?.mode}, expected production`);
	}
	if (worker?.name !== WORKER_NAME) {
		fail(`Build Output worker name is ${worker?.name}, expected ${WORKER_NAME}`);
	}
	if (env?.MEDIA?.name !== R2_BUCKET_NAME) {
		fail(`Build Output R2 bucket is ${env?.MEDIA?.name}, expected ${R2_BUCKET_NAME}`);
	}
	if (env?.DB?.id !== D1_DATABASE_ID) {
		fail(`Build Output D1 database id is ${env?.DB?.id}, expected ${D1_DATABASE_ID}`);
	}
	if (!Array.isArray(worker?.domains) || !worker.domains.includes(PRODUCTION_CUSTOM_DOMAIN)) {
		fail(`Build Output must attach the canonical production domain ${PRODUCTION_CUSTOM_DOMAIN}`);
	}

	// Secret bindings in the artifact. `{"type":"secret"}` carries no
	// value, so this reads names only and never touches a credential.
	const artifactSecrets = Object.entries(env)
		.filter(([, binding]) => binding?.type === 'secret')
		.map(([name]) => name);

	if (!sameSet(artifactSecrets, REQUIRED_RUNTIME_SECRETS)) {
		const artifact = [...artifactSecrets].sort().join(', ');
		const contract = [...REQUIRED_RUNTIME_SECRETS].sort().join(', ');
		fail(
			`Build Output secret bindings must match REQUIRED_RUNTIME_SECRETS exactly. artifact: [${artifact}] contract: [${contract}]`,
		);
	}

	// The audit-only name must not have come back. Checked separately from
	// the set comparison so the failure names the actual regression.
	for (const name of AUDIT_ONLY_SECRETS) {
		if (name in env) {
			fail(
				`audit-only secret ${name} is present in the Build Output; it must never be uploaded (legacy binding resurrection)`,
			);
		}
	}

	// Production-only text vars.
	if (env?.BETTER_AUTH_URL?.value !== PRODUCTION_BETTER_AUTH_URL) {
		fail(
			`Build Output BETTER_AUTH_URL is ${env?.BETTER_AUTH_URL?.value}, expected ${PRODUCTION_BETTER_AUTH_URL}`,
		);
	}
	if (env?.MEDIA_PUBLIC_BASE_URL?.value !== PRODUCTION_MEDIA_PUBLIC_BASE_URL) {
		fail(
			`Build Output MEDIA_PUBLIC_BASE_URL is ${env?.MEDIA_PUBLIC_BASE_URL?.value}, expected ${PRODUCTION_MEDIA_PUBLIC_BASE_URL}`,
		);
	}
	// LOCAL_API_MODE is a development-only opt-in (Issue #186); the
	// plugin's config customizer is mode-blind, so a production artifact
	// carrying it would mean the mock gate shipped.
	if ('LOCAL_API_MODE' in env) {
		fail('LOCAL_API_MODE must not appear in a production Build Output');
	}

	for (const binding of Object.values(RATE_LIMIT_BINDING)) {
		if (!env?.[binding]) {
			fail(`Build Output is missing the ${binding} rate-limit binding`);
		} else if (env[binding].namespace !== RATE_LIMIT_NAMESPACES[binding]) {
			fail(`Build Output ${binding} namespace drifted from the contract`);
		}
	}
	return 'checked';
}

function main() {
	const requireBuild = process.argv.includes('--build');
	checkContractShape();
	checkIdentity();

	let buildState = 'skipped';
	if (requireBuild || existsSync(WORKER_CONFIG)) {
		buildState = checkBuildOutput();
		if (buildState === 'missing') {
			if (requireBuild) {
				fail('no Build Output found; run `pnpm run build:production` before this check');
			} else {
				notes.push('no Build Output present; build-output comparison skipped');
			}
		}
	}

	for (const note of notes) process.stdout.write(`note: ${note}\n`);

	if (errors.length > 0) {
		process.stderr.write('cloudflare contract violated:\n');
		for (const error of errors) process.stderr.write(`  - ${error}\n`);
		return 1;
	}
	process.stdout.write(
		`cloudflare contract OK: ${REQUIRED_RUNTIME_SECRETS.length} required secret(s), ` +
			`${AUDIT_ONLY_SECRETS.length} audit-only, build-output=${buildState}\n`,
	);
	return 0;
}

process.exit(main());
