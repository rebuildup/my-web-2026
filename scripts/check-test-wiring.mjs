/**
 * Every `*.test.mjs` under `scripts/` must be reachable from a test entry
 * point (Issue #247, secrets slice follow-up).
 *
 * Why this gate exists
 * --------------------
 * `scripts/rotate-home-api-key.test.mjs` was not referenced by
 * `package.json#scripts.test` for several commits. It kept passing in a
 * developer's head and failing everywhere else — and when the secrets
 * slice removed three exports it imported, the file became a hard link
 * error. Nothing caught it, because **nothing ran it**: not CI, not
 * `pnpm test`, not `validate:fast`.
 *
 * The failure it hid was not cosmetic. That file's stale imports sat on
 * a Worker-secret write path whose payload shape had drifted, so
 * `bulkUpdateWorkerSecrets` rejected every call and the home API key
 * rotation failed at Stage 9 — silently, behind a generic
 * "exited with status 1". An unwired test file is not a tidiness
 * problem; it is an unasserted production path.
 *
 * A test file that nothing runs is indistinguishable from a test file
 * that does not exist, so the wiring is now an explicit, checkable
 * contract rather than an omission nobody notices.
 *
 * Exit codes: 0 = fully wired, 1 = at least one orphan, 2 = bad input.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');

/**
 * Files that intentionally are not standalone test entry points.
 *
 * Kept as an explicit allowlist rather than a filename pattern, so a new
 * exception has to be justified in review instead of matching a glob.
 */
const ALLOWED_UNWIRED = new Set([
	// Intentionally empty. Every `scripts/*.test.mjs` has an independent
	// surface and must be reachable. If a future file genuinely has none,
	// add it here with the reason — but an allowlist that is never used
	// is a list of exceptions nobody re-checks.
]);

/** Every `*.test.mjs` in `scripts/`. */
function findTestFiles(dir) {
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
		.map((entry) => entry.name)
		.sort();
}

/**
 * Names referenced by any npm script.
 *
 * The test entry point is the contract, but `validate:*` and the release
 * checks also invoke runners, so any script that mentions the file counts
 * as wired. This keeps the gate from fighting a future refactor that
 * moves the run into its own script.
 */
function referencedTestFiles(pkg) {
	const haystack = Object.values(pkg.scripts ?? {}).join('\n');
	return new Set(findTestFiles(SCRIPTS_DIR).filter((name) => haystack.includes(name)));
}

function main() {
	let pkg;
	try {
		pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
	} catch (error) {
		process.stderr.write(`cannot read package.json: ${error.message}\n`);
		return 2;
	}

	const all = findTestFiles(SCRIPTS_DIR);
	const referenced = referencedTestFiles(pkg);
	const orphans = all.filter((name) => !referenced.has(name) && !ALLOWED_UNWIRED.has(name));

	if (orphans.length === 0) {
		process.stdout.write(
			`test wiring OK: all ${all.length} scripts/*.test.mjs files are reachable from a test entry point\n`,
		);
		return 0;
	}

	process.stderr.write(
		`${orphans.length} test file(s) under scripts/ are not wired into any npm script:\n`,
	);
	for (const name of orphans) process.stderr.write(`  - ${name}\n`);
	process.stderr.write(
		'\nAn unwired test file never runs, so a broken import or a stale\n' +
			'assertion in it is invisible to CI. Add it to `test` in package.json,\n' +
			'or — if it genuinely has no independent surface — add it to\n' +
			'ALLOWED_UNWIRED in scripts/check-test-wiring.mjs with a reason.\n',
	);
	return 1;
}

process.exit(main());
