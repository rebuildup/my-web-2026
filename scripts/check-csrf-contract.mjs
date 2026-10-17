#!/usr/bin/env node

/**
 * CSRF contract gate (Issue #440).
 *
 * The project has TWO mutation layers, and each one owns a different
 * cross-site request forgery check:
 *
 *   1. TanStack Start server functions (`/_serverFn/*`) are covered by
 *      the framework's **default** CSRF middleware. `createStartHandler`
 *      only installs that default while the repository ships no custom
 *      `startInstance` — the canonical file for one is `src/start.ts`.
 *      The moment that file appears, whatever it declares replaces the
 *      default, and every server-function mutation silently loses its
 *      origin check. There is no runtime warning in production.
 *   2. The Hono external boundary (`/api/v1/*`) never reaches the
 *      framework middleware at all: `src/server.ts` dispatches those
 *      prefixes to Hono *before* the Start handler runs. It therefore
 *      needs its own guard, `csrfGuard`
 *      (`src/http/middleware/csrf.ts`), mounted on `/api/v1/*`.
 *
 * Both halves are easy to break without breaking anything visible:
 * adding `src/start.ts`, dropping one `use()` line, or switching on an
 * opt-out flag all leave the site rendering perfectly while removing
 * the protection. This gate turns those edits into build failures.
 *
 * It also refuses the dependency-side opt-outs that suppress the same
 * protection: `disableCsrfMiddlewareWarning` (hides the dev-time
 * warning) and Better Auth's `skipCSRFCheck` / `disableCSRFCheck` /
 * `disableOriginCheck`.
 *
 * Behaviour (positive + negative cases, real D1 side-effect checks)
 * lives in `test/integration/csrf-contract.test.ts` and
 * `e2e/csrf.spec.ts`. This file only owns the structural half, because
 * the workerd test pool sandboxes `node:fs` and cannot read the
 * repository tree at all.
 *
 * Exit codes: 0 = contract intact, 1 = violation, 2 = bad input.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The canonical custom-`startInstance` file (ADR-0002 §2). */
const START_INSTANCE_FILE = 'src/start.ts';

/** The boundary module that owns the Hono-side origin check. */
const CSRF_MIDDLEWARE_FILE = 'src/http/middleware/csrf.ts';

/** Where the guard has to be mounted. */
const HONO_FILE = 'src/http/hono.ts';
const GUARD_IMPORT = "from './middleware/csrf'";
const GUARD_MOUNT = "externalBoundary.use('/api/v1/*', csrfGuard)";

/**
 * Flags that disable an origin / CSRF check in either dependency.
 * Scanned against code with comments stripped, so a module that only
 * *documents* one of them (this file's siblings often do) is not a
 * violation.
 */
const FORBIDDEN_OPT_OUTS = [
	'disableCsrfMiddlewareWarning',
	'skipCSRFCheck',
	'disableCSRFCheck',
	'disableOriginCheck',
];

function sourceFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return ['.ts', '.tsx'].includes(extname(path)) ? [path] : [];
	});
}

/**
 * Strip `//` and block comments so the opt-out scan reads code only.
 * Not a parser — a string literal containing `//` would confuse it,
 * which is acceptable for a gate whose flags never appear in strings.
 */
export function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * @returns {{errors: string[]}} — a pure result so the test file can
 * exercise the rules against a fixture tree without spawning a process.
 */
export function collectViolations(repoRoot = REPO_ROOT) {
	const srcRoot = join(repoRoot, 'src');
	const errors = [];

	// Rule 1 — no custom `startInstance`.
	if (existsSync(join(repoRoot, START_INSTANCE_FILE))) {
		errors.push(
			`${START_INSTANCE_FILE} exists: a custom startInstance replaces TanStack Start's default CSRF middleware (AGENTS.md §2 requires an ADR).`,
		);
	}

	// Rule 2 — the boundary guard module is present.
	if (!existsSync(join(repoRoot, CSRF_MIDDLEWARE_FILE))) {
		errors.push(`${CSRF_MIDDLEWARE_FILE} is missing. The Hono boundary owns its own origin check.`);
	}

	// Rules 3 + 4 — the guard is imported and mounted on the boundary.
	const honoPath = join(repoRoot, HONO_FILE);
	if (!existsSync(honoPath)) {
		errors.push(`${HONO_FILE} is missing; the external boundary cannot be verified.`);
	} else {
		const hono = readFileSync(honoPath, 'utf8');
		if (!hono.includes(GUARD_IMPORT)) {
			errors.push(`${HONO_FILE} does not import csrfGuard (${GUARD_IMPORT}).`);
		}
		if (!hono.includes(GUARD_MOUNT)) {
			errors.push(
				`${HONO_FILE} does not mount the guard (${GUARD_MOUNT}): a /api/v1/* write is unprotected.`,
			);
		}
	}

	// Rule 5 — no dependency opt-out anywhere in src/.
	if (!existsSync(srcRoot)) {
		errors.push('src/ is missing; nothing to verify.');
		return { errors };
	}
	for (const file of sourceFiles(srcRoot)) {
		const code = stripComments(readFileSync(file, 'utf8'));
		for (const flag of FORBIDDEN_OPT_OUTS) {
			if (code.includes(flag)) {
				errors.push(
					`${relative(repoRoot, file)} references ${flag}, which disables an origin / CSRF check.`,
				);
			}
		}
	}

	return { errors };
}

function main() {
	let errors;
	try {
		({ errors } = collectViolations());
	} catch (error) {
		process.stderr.write(`cannot evaluate the CSRF contract: ${error.message}\n`);
		return 2;
	}

	if (errors.length > 0) {
		process.stderr.write('[csrf:contract:check] CSRF contract violations:\n');
		for (const error of errors) process.stderr.write(`- ${error}\n`);
		process.stderr.write(
			'\nA missing check here is invisible at runtime: the site keeps rendering and the\n' +
				'write still succeeds for legitimate callers. See docs/security.md (CSRF).\n',
		);
		return 1;
	}

	process.stdout.write(
		'csrf:contract:check OK: default Start CSRF middleware active (no src/start.ts, no opt-outs) ' +
			'+ boundary csrfGuard mounted on /api/v1/*\n',
	);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(main());
}
