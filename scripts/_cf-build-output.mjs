#!/usr/bin/env node
/**
 * Cloudflare Build Output verification — the single production
 * authorization boundary (Issue #247, deploy-path slice).
 *
 * What replaced what
 * ------------------
 * The old deploy gate was `--config=wrangler.production.jsonc`: permission
 * to touch production came from *which source file was named*. That is a
 * path convention, not a property of the thing being deployed.
 *
 * The boundary is now the artifact itself. A deploy is authorized because
 * the Build Output it is about to ship was **built in production mode, by
 * this account, for this worker, with a bundle and complete Tool assets**
 * — not because a config path says so.
 *
 * The schema below was measured against a real artifact, not guessed:
 *   `.cloudflare/output/v0/config.json`
 *     -> { accountId, buildContext: { isPreview, mode } }
 *   `.cloudflare/output/v0/workers/default/worker.config.json`
 *     -> { name, compatibilityDate, domains, env, observability, ... }
 * `env` entries carry `{ type: 'secret' }` for runtime secrets, which is
 * what Tier 2 of the drift check now reads instead of parsing a
 * `secrets.required` array out of a source file.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The Build Output root the cf native path produces. */
export const BUILD_OUTPUT_DIR = join(REPO_ROOT, '.cloudflare', 'output', 'v0');
/** The default (entry) Worker's output. */
export const WORKER_OUTPUT_DIR = join(BUILD_OUTPUT_DIR, 'workers', 'default');
/** The deploy artifact's static assets. */
export const ASSETS_DIR = join(WORKER_OUTPUT_DIR, 'assets');
/** Client build tree; the source the Tool bundles are built into. */
export const CLIENT_DIR = join(REPO_ROOT, 'dist', 'client');

/** The Worker this repository deploys. */
export const WORKER_NAME = 'my-web-2026';
/** The Cloudflare account that owns production. */
export const ACCOUNT_ID = 'c6ab6651a5d4d6d0d07686bbd3c3d56f';

/** Runtime secrets the deployed Worker must carry (Infisical is the value SoT). */
export const RUNTIME_SECRET_NAMES = [
	'BETTER_AUTH_SECRETS',
	'MY_WEB_2026_CONSUMER_API_KEY',
	'GOOGLE_ANALYTICS_MEASUREMENT_ID',
];

/**
 * Legacy audit-only secret. It lives in Infisical for recovery and is
 * NEVER written into the Worker's secrets file, because re-uploading it
 * would resurrect the binding that `--delete-legacy-only` removed
 * (Issue #243). Enforced by `assertNoAuditOnlySecrets`.
 */
export const AUDIT_ONLY_SECRET_NAME = 'BETTER_AUTH_SECRET';

export class BuildOutputError extends Error {}

/** Recursive file count; 0 for a missing directory. */
export function countFiles(dir) {
	if (!existsSync(dir)) return 0;
	let n = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		n += entry.isDirectory() ? countFiles(p) : statSync(p).isFile() ? 1 : 0;
	}
	return n;
}

function readJson(path, what) {
	if (!existsSync(path)) {
		throw new BuildOutputError(`missing ${what}: ${path}`);
	}
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (cause) {
		throw new BuildOutputError(`unreadable ${what} (${path}): ${cause.message}`);
	}
}

/**
 * Read the artifact and check it is a production Build Output for this
 * worker. Pure inspection — no network, no mutation.
 */
export function inspectBuildOutput({
	dir = BUILD_OUTPUT_DIR,
	workerName = WORKER_NAME,
	accountId = ACCOUNT_ID,
} = {}) {
	const workerDir = join(dir, 'workers', 'default');
	const outputConfig = readJson(join(dir, 'config.json'), 'Build Output config.json');
	const workerConfig = readJson(join(workerDir, 'worker.config.json'), 'worker.config.json');

	return {
		dir,
		workerDir,
		assetsDir: join(workerDir, 'assets'),
		bundleDir: join(workerDir, 'bundle'),
		accountId: outputConfig.accountId,
		mode: outputConfig.buildContext?.mode,
		isPreview: outputConfig.buildContext?.isPreview,
		workerName: workerConfig.name,
		secretBindings: Object.entries(workerConfig.env ?? {})
			.filter(([, v]) => v && typeof v === 'object' && v.type === 'secret')
			.map(([k]) => k)
			.sort(),
	};
}

/**
 * Assert the Build Output is deployable to production. Throws
 * `BuildOutputError` with a specific reason on the first failure.
 *
 * This runs BEFORE any D1 migration and before any Cloudflare API call,
 * so a bad artifact can never half-deploy.
 */
export function assertDeployableBuildOutput(options = {}) {
	const info = inspectBuildOutput(options);
	// Resolve defaults up front: `!==` binds tighter than `??`, so an
	// inline `x !== o ?? D` would not mean what it looks like.
	const expectedAccountId = options.accountId ?? ACCOUNT_ID;
	const expectedWorkerName = options.workerName ?? WORKER_NAME;

	// 1. Built in production mode.
	if (info.mode !== 'production') {
		throw new BuildOutputError(
			`Build Output mode is ${JSON.stringify(info.mode)}, expected "production". A development Build Output must never be deployed to production.`,
		);
	}
	if (info.isPreview === true) {
		throw new BuildOutputError(
			'Build Output is a preview artifact; refusing to deploy it to production.',
		);
	}

	// 2. Ours: the right account and the right Worker.
	if (info.accountId !== expectedAccountId) {
		throw new BuildOutputError(
			`Build Output account ${info.accountId} does not match the canonical account.`,
		);
	}
	if (info.workerName !== expectedWorkerName) {
		throw new BuildOutputError(
			`Build Output worker ${JSON.stringify(info.workerName)} is not ${expectedWorkerName}.`,
		);
	}

	// 3. A bundle exists.
	if (countFiles(info.bundleDir) === 0) {
		throw new BuildOutputError('Build Output has no worker bundle.');
	}

	// 4. Runtime secret contract.
	for (const name of RUNTIME_SECRET_NAMES) {
		if (!info.secretBindings.includes(name)) {
			throw new BuildOutputError(
				`Build Output is missing the runtime secret binding ${name}. Declared: ${info.secretBindings.join(', ') || 'none'}.`,
			);
		}
	}

	// 5. The audit-only legacy secret must NOT be in the artifact. If it
	//    were, deploying would resurrect the binding #243 removed.
	if (info.secretBindings.includes(AUDIT_ONLY_SECRET_NAME)) {
		throw new BuildOutputError(
			`Build Output declares the audit-only secret ${AUDIT_ONLY_SECRET_NAME}. Deploying it would resurrect the legacy binding.`,
		);
	}

	// 6. Tool artifacts are complete in the deploy artifact.
	const clientTools = countFiles(join(options.clientDir ?? CLIENT_DIR, 'tools'));
	if (clientTools > 0) {
		const outputTools = countFiles(join(info.assetsDir, 'tools'));
		if (outputTools !== clientTools) {
			throw new BuildOutputError(
				`Tool artifacts incomplete in the deploy artifact: ${clientTools} built, ${outputTools} present. /tools/<slug> would ship without its bundle.`,
			);
		}
		const slugs = existsSync(join(info.assetsDir, 'tools'))
			? readdirSync(join(info.assetsDir, 'tools'), { withFileTypes: true })
					.filter((e) => e.isDirectory())
					.map((e) => e.name)
			: [];
		for (const slug of slugs) {
			if (!existsSync(join(info.assetsDir, 'tools', slug, 'app', 'index.html'))) {
				throw new BuildOutputError(`Tool "${slug}" has no app/index.html in the deploy artifact.`);
			}
		}
		info.toolSlugs = slugs;
	}

	return info;
}

/**
 * The audit-only secret must never reach the Worker. Called with the
 * exact object that is about to be written to the secrets file.
 */
export function assertNoAuditOnlySecrets(secrets) {
	if (secrets && Object.hasOwn(secrets, AUDIT_ONLY_SECRET_NAME)) {
		throw new BuildOutputError(
			`refusing to write the audit-only secret ${AUDIT_ONLY_SECRET_NAME} to the Worker secrets file`,
		);
	}
}

/**
 * The exact production deploy argv (Issue #247).
 *
 * `cf` is resolved through the package manager (`pnpm exec cf ...`)
 * rather than by guessing a path inside the package: `cf` is an
 * exact-pinned dependency, so the package manager is the authority on
 * where that binary lives.
 *
 * Lives here, not in `run-deploy-inner.mjs`, so the dry-run self-test
 * can import the SAME builder without executing the deploy.
 */
export function buildDeployArgv({ secretsFile, dryRun = false }) {
	// `cf` is part of the argv on purpose: a caller cannot forget it,
	// and `pnpm exec <this whole array>` resolves the pinned binary.
	const argv = [
		'cf',
		'deploy',
		'--prebuilt',
		'--mode',
		'production',
		'--secrets-file',
		secretsFile,
	];
	if (dryRun) argv.push('--dry-run');
	return argv;
}

/**
 * A production deploy is unattended and needs a Cloudflare
 * credential. It is a DEPLOY-TIME credential: required by the `cf`
 * child only, never written into the Worker's secrets file, and never
 * part of the runtime required-secret contract.
 *
 * Checked explicitly rather than left to fail somewhere inside the CLI.
 * `cf deploy --dry-run` does NOT need it, which is what lets the
 * self-test run in CI.
 */
export function assertDeployCredentialAvailable(env = process.env) {
	if (typeof env.CLOUDFLARE_API_TOKEN !== 'string' || env.CLOUDFLARE_API_TOKEN.length === 0) {
		throw new Error(
			'CLOUDFLARE_API_TOKEN is required for a production deploy. It is a deploy-time ' +
				'credential for the cf child process only: it is NOT a Worker runtime secret ' +
				'and must not appear in the secrets file.',
		);
	}
}
