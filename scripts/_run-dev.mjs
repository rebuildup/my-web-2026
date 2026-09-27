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
 *   3. `shell: false` prevents shell injection from any env var content;
 *      the inner command is constructed as a literal argv list.
 *   4. Exit code is propagated so `pnpm dev` failures surface as a non-zero
 *      exit code (matters for CI and E2E auto-start).
 *
 * Reads `.infisical.json` from the repo root and passes `defaultEnvironment`
 * to `--env`. If the file is missing, falls back to `--env=dev` (the
 * default; matches `.infisical.json`'s intended default).
 *
 * Usage:
 *   pnpm dev       (script invoked via package.json#scripts.dev)
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const infisicalConfigPath = resolve(repoRoot, '.infisical.json');

let env = 'dev';
if (existsSync(infisicalConfigPath)) {
	try {
		const cfg = JSON.parse(readFileSync(infisicalConfigPath, 'utf8'));
		if (typeof cfg?.defaultEnvironment === 'string' && cfg.defaultEnvironment.length > 0) {
			env = cfg.defaultEnvironment;
		}
	} catch {
		// Malformed config — fall back to default. The CLI will surface
		// its own parse error if it's truly broken.
	}
}

const argv = ['exec', 'infisical', 'run', '--env', env, '--', 'pnpm', 'exec', 'vite', 'dev'];
const child = spawn('pnpm', argv, { stdio: 'inherit', shell: false });

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 0);
});

child.on('error', (err) => {
	console.error(`_run-dev: failed to spawn pnpm: ${err.message}`);
	process.exit(1);
});
