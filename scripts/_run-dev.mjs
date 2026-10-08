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
 * Argument forwarding (Issue #284): every argv token after the script name
 * (`process.argv.slice(2)`, i.e. whatever follows `pnpm dev --`) is appended
 * to the end of the spawned `vite dev` argv, on both POSIX and Windows
 * plans. pnpm 12.x forwards the `--` separator itself, so a single leading
 * `--` is dropped first (`normalizeForwardedArgs`) — vite's CLI would
 * otherwise treat it as an operand separator and silently ignore every
 * flag after it (server stays on the config port):
 *
 *   pnpm dev -- --port 4999 --strictPort
 *   argv tail:  ['--', '--port', '4999', '--strictPort']
 *   normalised: ['--port', '4999', '--strictPort']
 *   → pnpm exec infisical run --env <slug> -- pnpm exec vite dev --port 4999 --strictPort
 *
 * The extra args are appended AFTER the validated pieces: env-slug
 * validation (`isSafeEnvSlug`) still gates everything that is interpolated
 * from `.infisical.json` before argv construction, so forwarding cannot
 * weaken that gate. The extra args themselves come from the invoking
 * operator's own shell (same trust boundary as running the command) and are
 * otherwise passed through verbatim — they are flags for vite, not config
 * input.
 *
 * Windows quoting of forwarded tokens (`quoteCmdArg`): on the Windows
 * branch the spawn uses `windowsVerbatimArguments: true`, which does NO
 * Node-side quoting — every argv element is concatenated into the
 * `cmd.exe /d /s /c` command line literally. A forwarded token that
 * contains a space, `&`, `|`, `<`, `>`, `^`, `(`, `)` or `"` would
 * therefore split or be re-interpreted by `cmd.exe`. The Windows branch
 * wraps such tokens in double quotes (escaping an embedded `"` as `\"`,
 * the standard cmd/argv quoting) so the token reaches vite as ONE
 * argument. Safe tokens pass through unchanged, and the POSIX branch is
 * untouched (argv array, `shell: false`, no shell involved).
 *
 * Honest limitation: this quoting is unit-verified in
 * `scripts/_run-dev.test.mjs` (exact argv shapes asserted on both
 * branches) but has NOT been exercised on a real Windows host —
 * operator-side smoke on Windows remains the runtime confirmation.
 *
 * Usage:
 *   pnpm dev       (script invoked via package.json#scripts.dev)
 *   pnpm dev -- --port 4999 --strictPort   (extra args forwarded to vite)
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * Characters that make a forwarded token unsafe to place unquoted into
 * the Windows `cmd.exe /d /s /c` command line: whitespace (argv
 * splitting), `cmd.exe` metacharacters (`& | < > ^`), and the
 * quote/paren pair that participates in cmd's own quoting and
 * grouping rules.
 *
 * Deliberately scoped to the Windows branch — the POSIX plan passes an
 * argv array with `shell: false`, so no shell ever re-parses those
 * tokens.
 */
export const CMD_UNSAFE_ARG_RE = /[ "&|<>^()]/;

/**
 * Wrap a single forwarded argv token for the Windows branch of
 * `buildSpawnPlan`.
 *
 * `windowsVerbatimArguments: true` hands the argv to `cmd.exe`
 * literally (no Node-side quoting), so any token containing a cmd-unsafe
 * character would split into multiple tokens or be interpreted as a
 * shell metacharacter. Such tokens are wrapped in double quotes with an
 * embedded `"` escaped as `\"` (standard cmd/argv quoting); tokens
 * without unsafe characters are returned unchanged.
 *
 * Pure. Exported for unit-testing. Does NOT validate the env slug —
 * `isSafeEnvSlug` remains the sole gate for config-derived input; this
 * helper only quotes operator-supplied forwarded flags.
 *
 * Throws for non-string input (caller bug, not shell input).
 */
export function quoteCmdArg(token) {
	if (typeof token !== 'string') {
		throw new Error(`_run-dev: quoteCmdArg expects a string (got ${typeof token})`);
	}
	if (!CMD_UNSAFE_ARG_RE.test(token)) return token;
	return `"${token.replaceAll('"', '\\"')}"`;
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
 * Normalise the raw argv tail that pnpm hands to a run-script
 * (Issue #284). pnpm 12.x forwards the `--` separator itself:
 *
 *   pnpm dev -- --port 4999 --strictPort
 *   → process.argv.slice(2) === ['--', '--port', '4999', '--strictPort']
 *
 * vite's CLI (cac) treats a bare `--` as an operand separator and
 * silently ignores every flag after it, which would leave the server
 * on the config port. Exactly one leading `--` is dropped; any further
 * `--` tokens are genuine forwarded content and are preserved.
 * Pure. Exported for unit-testing.
 *
 * Throws if `rawArgs` is not an array (caller bug, not shell input).
 */
export function normalizeForwardedArgs(rawArgs) {
	if (!Array.isArray(rawArgs)) {
		throw new Error(`_run-dev: rawArgs must be an array (got ${typeof rawArgs})`);
	}
	if (rawArgs.length > 0 && rawArgs[0] === '--') {
		return rawArgs.slice(1);
	}
	return rawArgs;
}

/**
 * Build the spawn plan for the current platform. Pure: deterministic
 * given `isWindows`, `env`, and `extraArgs`.
 *
 * Throws if `env` is not a safe slug. The strict validation here means
 * a bug in the caller cannot smuggle a `cmd.exe` metacharacter into
 * argv — the function enforces the full filename-grade invariant.
 *
 * `extraArgs` (optional, default `[]`) is the normalised argv tail
 * (from `normalizeForwardedArgs(process.argv.slice(2))`, Issue #284):
 * CLI flags for vite such as `['--port', '4999', '--strictPort']`.
 * They are appended AFTER `vite dev` in the pnpm argv — i.e. after
 * every validated piece — so forwarding never bypasses or weakens the
 * env-slug gate above. The args must be an array of strings (whatever
 * the invoking shell handed to the wrapper); anything else throws
 * rather than being coerced into argv.
 *
 * Windows contract (DEP0190-safe):
 *   - command: 'cmd.exe' (resolved via PATH)
 *   - args: ['/d', '/s', '/c', 'pnpm', <pnpm-argv...>]
 *     → `cmd.exe /d /s /c pnpm <pnpm-argv...>` is the canonical Node
 *       pattern for `.cmd` shim execution without DEP0190.
 *   - options.shell: false (no Node shell)
 *   - options.windowsVerbatimArguments: true (Node passes argv literally
 *     to `cmd.exe` without its own quoting/escaping).
 *   - forwarded `extraArgs` are passed through `quoteCmdArg` on this
 *     branch only: `windowsVerbatimArguments` performs NO quoting, so a
 *     token containing a space / `&` / `|` / `<` / `>` / `^` / `(` /
 *     `)` / `"` would split or be re-interpreted by `cmd.exe`. Quoted
 *     in place; the fixed pnpm argv pieces are charset-safe already.
 *
 * POSIX contract:
 *   - command: 'pnpm'
 *   - args: <pnpm-argv...>  (extraArgs verbatim — no shell, no quoting)
 *   - options.shell: false.
 */
export function buildSpawnPlan({ isWindows, env, extraArgs = [] }) {
	if (!isSafeEnvSlug(env)) {
		throw new Error(
			`_run-dev: env=${JSON.stringify(env)} is not a safe slug (expected ${SAFE_ENV_SLUG_RE})`,
		);
	}
	if (!Array.isArray(extraArgs) || extraArgs.some((a) => typeof a !== 'string')) {
		throw new Error(
			`_run-dev: extraArgs must be an array of strings (got ${JSON.stringify(extraArgs)})`,
		);
	}
	const pnpmArgv = ['exec', 'infisical', 'run', '--env', env, '--', 'pnpm', 'exec', 'vite', 'dev'];
	if (!isWindows) {
		// POSIX: argv array + shell:false — appended verbatim to vite.
		pnpmArgv.push(...extraArgs);
		return { command: 'pnpm', args: pnpmArgv, options: { shell: false } };
	}
	// Windows: cmd.exe parses its own command line, so each forwarded
	// token is quoted in place (see quoteCmdArg) before it lands in argv.
	return {
		command: 'cmd.exe',
		args: ['/d', '/s', '/c', 'pnpm', ...pnpmArgv, ...extraArgs.map(quoteCmdArg)],
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
	// Issue #284: forward the CLI tail (`pnpm dev -- <flags>`) to vite.
	// pnpm includes its own `--` separator; strip it so vite sees the flags.
	const extraArgs = normalizeForwardedArgs(process.argv.slice(2));
	const plan = buildSpawnPlan({ isWindows, env, extraArgs });
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
