#!/usr/bin/env node
/**
 * ADR-0015 §9 / Phase 3 #69 — Windows-safe `pnpm dev` wrapper.
 *
 * Why a Node wrapper (not `infisical run --env=dev -- pnpm exec vite dev`):
 *
 *   1. POSIX + Windows native shell compatibility. The CLI shell substitution
 *      `infisical run --env=dev -- pnpm exec vite dev` requires a POSIX shell
 *      to interpolate; on Windows native PowerShell / cmd it fails because
 *      `infisical run` itself is invoked from a POSIX shell wrapper.
 *   2. `.infisical.json` project resolution is automatic via the CLI, so no
 *      `--projectId` flag is needed (and the CLI forbids `--projectId` when
 *      `.infisical.json` is present in the working directory).
 *   3. Exit code is propagated so `pnpm dev` failures surface as a non-zero
 *      exit code (matters for CI and E2E auto-start).
 *
 * Spawn-shape by platform (DEP0190-safe):
 *
 *   - POSIX: `shell: false`. The literal argv is taken as-is.
 *   - Windows native: spawn `cmd.exe` directly with `shell: false` AND
 *     `windowsVerbatimArguments: true`. This is the Node.js-canonical
 *     pattern (per the Node docs note on DEP0190) for executing `.cmd`
 *     / `.bat` shims without `shell: true` — `spawn('pnpm', ...)` resolves
 *     to `pnpm.cmd`, which Node cannot exec directly without a shell.
 *     `cmd.exe /d /s /c pnpm <args>` resolves the shim through `cmd.exe`'s
 *     own argv parser, with no Node-side shell quoting (avoids DEP0190 in
 *     Node 22.15+, which deprecates `shell: true` combined with `args[]`).
 *
 *     Even with `shell: false`, `cmd.exe` itself still parses its command
 *     line for command separators (`&`, `|`, `<`, `>`, `^`, etc.). So
 *     `defaultEnvironment` (read from `.infisical.json`) is validated by
 *     `isSafeEnvSlug(env)` against the canonical Infisical slug charset
 *     `[A-Za-z0-9_-]{1,64}` BEFORE being placed into argv, so no
 *     `cmd.exe` metacharacter can be smuggled in via the slug.
 *
 * Reads `.infisical.json` from the repo root and passes `defaultEnvironment`
 * to `--env`. If the file is missing OR carries a malformed (or missing)
 * `defaultEnvironment`, falls back to `--env=dev` (the default). An
 * unsafe-but-present slug is an ERROR (fail-loud, exit 2) — silent
 * fallback would mask config drift.
 *
 * Usage:
 *   pnpm dev       (script invoked via package.json#scripts.dev)
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const INFISICAL_CONFIG_PATH = resolve(REPO_ROOT, '.infisical.json');

/**
 * Canonical Infisical env-slug charset. Used to validate any value that
 * will be interpolated into a Windows-side argv before it reaches
 * `cmd.exe` (which parses `& | < > ^` even when Node's `shell: false`
 * is in effect, because `cmd.exe` parses its OWN command line).
 *
 * Length cap mirrors the practical limit of Infisical env slugs on the
 * self-host v0.165.x — no real env name ever needs more than 64 chars.
 */
export const SAFE_ENV_SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Whether a given environment-slug string is safe to interpolate into
 * a Windows `cmd.exe /d /s /c pnpm --env <slug> ...` invocation.
 *
 * Must be:
 *   - a non-empty string
 *   - at most 64 chars
 *   - composed only of `[A-Za-z0-9_-]`
 *
 * Pure. Exported for unit-testing.
 */
export function isSafeEnvSlug(s) {
	return typeof s === 'string' && SAFE_ENV_SLUG_RE.test(s);
}

/**
 * Read `.infisical.json#defaultEnvironment`. Returns the candidate
 * environment name (which may NOT be a safe slug — caller MUST validate
 * via `isSafeEnvSlug` before use). Falls back to `'dev'` when the
 * file is missing, malformed, or carries no slug.
 *
 * Pure: takes injected fs accessors so it can be unit-tested without
 * touching disk.
 */
export function readDefaultEnvironmentCandidate({ configPath, fsExistsSync, fsReadFileSync }) {
	if (!fsExistsSync(configPath)) return 'dev';
	let cfg;
	try {
		cfg = JSON.parse(fsReadFileSync(configPath, 'utf8'));
	} catch {
		return 'dev';
	}
	const candidate = cfg?.defaultEnvironment;
	if (typeof candidate !== 'string' || candidate.length === 0) return 'dev';
	return candidate;
}

/**
 * Build the spawn plan for the current platform. Pure: deterministic
 * given `isWindows` and `env`.
 *
 * Throws if `env` is not a safe slug. The strict validation here means
 * a bug in the caller cannot smuggle a `cmd.exe` metacharacter into
 * argv — the function enforces the full filename-grade invariant.
 *
 * Windows contract (DEP0190-safe):
 *   - command: 'cmd.exe' (resolved via PATH)
 *   - args: ['/d', '/s', '/c', 'pnpm', <pnpm-argv...>]
 *     → `cmd.exe /d /s /c pnpm <pnpm-argv...>` is the canonical Node
 *       pattern for `.cmd` shim execution without DEP0190.
 *   - options.shell: false (no Node shell)
 *   - options.windowsVerbatimArguments: true (Node passes argv literally
 *     to `cmd.exe` without its own quoting/escaping).
 *
 * POSIX contract:
 *   - command: 'pnpm'
 *   - args: <pnpm-argv...>
 *   - options.shell: false.
 */
export function buildSpawnPlan({ isWindows, env }) {
	if (!isSafeEnvSlug(env)) {
		throw new Error(
			`_run-dev: env=${JSON.stringify(env)} is not a safe slug (expected ${SAFE_ENV_SLUG_RE})`,
		);
	}
	const pnpmArgv = ['exec', 'infisical', 'run', '--env', env, '--', 'pnpm', 'exec', 'vite', 'dev'];
	if (!isWindows) {
		return { command: 'pnpm', args: pnpmArgv, options: { shell: false } };
	}
	return {
		command: 'cmd.exe',
		args: ['/d', '/s', '/c', 'pnpm', ...pnpmArgv],
		options: { shell: false, windowsVerbatimArguments: true },
	};
}

function main() {
	const candidate = readDefaultEnvironmentCandidate({
		configPath: INFISICAL_CONFIG_PATH,
		fsExistsSync: existsSync,
		fsReadFileSync: readFileSync,
	});
	if (!isSafeEnvSlug(candidate)) {
		console.error(
			`_run-dev: .infisical.json#defaultEnvironment=${JSON.stringify(candidate)} is not a safe slug. ` +
				`Expected ${SAFE_ENV_SLUG_RE}. Refusing to spawn (would risk Windows cmd.exe metacharacter injection).`,
		);
		process.exit(2);
	}
	const env = candidate;
	const isWindows = process.platform === 'win32';
	const plan = buildSpawnPlan({ isWindows, env });
	const child = spawn(plan.command, plan.args, { stdio: 'inherit', ...plan.options });

	child.on('exit', (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}
		process.exit(code ?? 0);
	});

	child.on('error', (err) => {
		console.error(`_run-dev: failed to spawn ${plan.command}: ${err.message}`);
		process.exit(1);
	});
}

main();
