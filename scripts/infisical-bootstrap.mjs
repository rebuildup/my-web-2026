#!/usr/bin/env node
/**
 * Bootstrap `.infisical.json` (commit-bound workspaceId SoT).
 *
 * Per ADR-0015 §1 Decision, `.infisical.json` is committed (not
 * gitignored) and contains only `workspaceId` — no secrets. This
 * script is the canonical generator for that file. It is
 * idempotent on the workspaceId: re-running with the same
 * workspaceId leaves the file unchanged (apart from a normalised
 * `defaultEnvironment` field); re-running with a different
 * workspaceId overwrites with a confirmation prompt unless
 * `--force` is supplied.
 *
 * Usage:
 *   pnpm run infisical:bootstrap -- --workspace-id=<uuid>
 *   pnpm run infisical:bootstrap -- --workspace-id=<uuid> --default-environment=prod
 *   pnpm run infisical:bootstrap -- --workspace-id=<uuid> --force
 *
 * Local secrets (Universal Auth) are NOT used by this script. The
 * workspaceId is provided via `--workspace-id` (operator obtains
 * it from the Infisical UI: Project Settings → "Project ID" or
 * workspace URL slug). No API call is made — the operator is the
 * trusted source for the workspaceId.
 *
 * Invariants enforced (ADR-0015 §11 + secret-handling):
 *   - argv / log / error message never carries a secret value
 *     (this script never reads or writes one).
 *   - Output file is committed text (JSON, no trailing newline
 *     beyond the standard `\n`); no mode bits beyond the
 *     filesystem default (committed files are world-readable by
 *     convention and contain only a non-secret workspaceId).
 *   - workspaceId format is validated as a UUID v4 string to
 *     prevent malformed entries from sneaking into git history.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const TARGET_PATH = resolve(REPO_ROOT, '.infisical.json');

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_ENVIRONMENTS = new Set(['dev', 'prod']);

function parseArgs(argv) {
	const args = { workspaceId: null, defaultEnvironment: null, force: false };
	for (const arg of argv) {
		if (arg.startsWith('--workspace-id=')) {
			args.workspaceId = arg.slice('--workspace-id='.length);
		} else if (arg === '--force') {
			args.force = true;
		} else if (arg.startsWith('--default-environment=')) {
			args.defaultEnvironment = arg.slice('--default-environment='.length);
		} else if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return args;
}

function printHelp() {
	console.log(`Usage: pnpm run infisical:bootstrap -- --workspace-id=<uuid>

Generate .infisical.json (workspaceId SoT, committed).

Options:
  --workspace-id=<uuid>          required, UUID v4 format
  --default-environment=<dev|prod>  optional, defaults to existing value or 'prod'
  --force                        overwrite without confirmation when
                                  workspaceId differs from existing file
  -h, --help                     show this help`);
}

function validateWorkspaceId(value) {
	if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
		throw new Error(`--workspace-id must be a UUID v4 string (got: ${JSON.stringify(value)})`);
	}
	return value.toLowerCase();
}

function validateEnvironment(value) {
	if (value === null) return null;
	if (!VALID_ENVIRONMENTS.has(value)) {
		throw new Error(
			`--default-environment must be one of ${[...VALID_ENVIRONMENTS].join(', ')} (got: ${JSON.stringify(value)})`,
		);
	}
	return value;
}

function readExisting() {
	if (!existsSync(TARGET_PATH)) {
		return null;
	}
	try {
		const raw = readFileSync(TARGET_PATH, 'utf8');
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('.infisical.json must be a JSON object');
		}
		// Sanity-check shape: only allow workspaceId and defaultEnvironment
		// (and reject unknown keys to catch typos early).
		const allowed = new Set(['workspaceId', 'defaultEnvironment']);
		for (const key of Object.keys(parsed)) {
			if (!allowed.has(key)) {
				throw new Error(`.infisical.json has unexpected key: ${key}`);
			}
		}
		return {
			workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : null,
			defaultEnvironment:
				typeof parsed.defaultEnvironment === 'string' ? parsed.defaultEnvironment : null,
		};
	} catch (cause) {
		if (cause instanceof SyntaxError) {
			throw new Error(`.infisical.json is not valid JSON: ${cause.message}`);
		}
		throw cause;
	}
}

function confirmOverwrite(existingWorkspaceId, newWorkspaceId) {
	if (existingWorkspaceId === newWorkspaceId) return;
	console.error(
		`Existing .infisical.json has workspaceId ${existingWorkspaceId}; new value is ${newWorkspaceId}.`,
	);
	console.error('Pass --force to overwrite without prompting.');
	process.exit(2);
}

function buildContent({ workspaceId, defaultEnvironment }) {
	const out = { workspaceId };
	if (defaultEnvironment !== null) {
		out.defaultEnvironment = defaultEnvironment;
	}
	return `${JSON.stringify(out, null, 2)}\n`;
}

const args = parseArgs(process.argv.slice(2));
const workspaceId = validateWorkspaceId(args.workspaceId);
const environment = validateEnvironment(args.defaultEnvironment);

const existing = readExisting();
const existingEnvironment = existing?.defaultEnvironment ?? null;
const desiredEnvironment = environment ?? existingEnvironment ?? 'prod';

if (existing && !args.force) {
	confirmOverwrite(existing.workspaceId, workspaceId);
}

const content = buildContent({
	workspaceId,
	defaultEnvironment: desiredEnvironment,
});
writeFileSync(TARGET_PATH, content);

if (existing?.workspaceId === workspaceId) {
	console.log(`.infisical.json unchanged (workspaceId already ${workspaceId}).`);
} else {
	console.log(`.infisical.json written: workspaceId=${workspaceId}`);
}
console.log(`  defaultEnvironment=${desiredEnvironment}`);
console.log(`  path=${TARGET_PATH}`);
