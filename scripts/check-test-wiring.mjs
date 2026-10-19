#!/usr/bin/env node
/**
 * Every `*.test.mjs` under `scripts/` must be reachable from a test entry
 * point (Issue #247, secrets slice follow-up; re-shaped by Issue #566).
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
 * What changed in Issue #566
 * --------------------------
 * The reachability rule used to be "some npm script mentions this file
 * name", which forced `package.json#scripts.test` to enumerate all 107
 * test files on one line — the line every concurrent ticket rewrote.
 * `pnpm run test` now delegates to `scripts/run-script-tests.mjs`, and
 * that runner discovers every `scripts/*.test.mjs` BY CONVENTION
 * (`scripts/_script-tests.mjs`).
 *
 * This gate therefore proves two things instead of grepping a chain:
 *
 * 1. **The runner is wired.** If no npm script references
 *    `scripts/run-script-tests.mjs`, discovery is dead code and the
 *    "every file is reachable" claim below would be vacuous. That is a
 *    failure, not a pass.
 * 2. **Every discovered file is reachable** — through the runner, or
 *    because an npm script still names it directly (a deliberate
 *    mid-gate invocation such as `node --test
 *    scripts/check-app-icons.test.mjs`).
 *
 * A file added to `ALLOWED_UNWIRED` that no longer exists is reported
 * too: an allowlist that can only grow is a list of exceptions nobody
 * re-checks.
 *
 * Exit codes: 0 = fully wired, 1 = at least one orphan (or an
 * unwired runner / a stale exception), 2 = bad input.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNNER_FILE_NAME, discoverScriptTests } from './_script-tests.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');

/**
 * Files that intentionally are not standalone test entry points.
 *
 * Kept as an explicit allowlist rather than a filename pattern, so a new
 * exception has to be justified in review instead of matching a glob.
 */
export const ALLOWED_UNWIRED = new Set([
	// Intentionally empty. Every `scripts/*.test.mjs` has an independent
	// surface and must be reachable. If a future file genuinely has none,
	// add it here with the reason — but an allowlist that is never used
	// is a list of exceptions nobody re-checks.
]);

/**
 * Reachability of every discovered `scripts/*.test.mjs`.
 *
 * Pure: it takes a scripts directory and a parsed package manifest, so
 * the rules below are asserted against fixtures in
 * `scripts/check-test-wiring.test.mjs` rather than only against the
 * current tree.
 */
export function evaluateTestWiring({ scriptsDir, pkg }) {
	const discovered = discoverScriptTests(scriptsDir);
	const entries = Object.entries(pkg?.scripts ?? {});
	// The gate judges "is there an entry point that runs this file", so
	// both the script name and its body are part of the haystack.
	const haystack = entries.map(([name, body]) => `${name}: ${String(body)}`).join('\n');

	const runnerScripts = entries
		.filter(([, body]) => String(body).includes(RUNNER_FILE_NAME))
		.map(([name]) => name);
	const literal = discovered.filter((relativePath) =>
		haystack.includes(relativePath.slice(relativePath.lastIndexOf('/') + 1)),
	);

	// The convention covers every discovered file exactly when the runner
	// is wired; otherwise only the explicitly named ones count.
	const wired = new Set(literal);
	if (runnerScripts.length > 0) for (const relativePath of discovered) wired.add(relativePath);

	const orphans = discovered.filter(
		(relativePath) => !wired.has(relativePath) && !ALLOWED_UNWIRED.has(basename(relativePath)),
	);
	const staleExceptions = [...ALLOWED_UNWIRED].filter(
		(name) => !discovered.some((relativePath) => basename(relativePath) === name),
	);

	return { discovered, runnerScripts, literal, orphans, staleExceptions };
}

/** `scripts/x.test.mjs` -> `x.test.mjs` */
function basename(relativePath) {
	return relativePath.slice(relativePath.lastIndexOf('/') + 1);
}

export function main() {
	let pkg;
	try {
		pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
	} catch (error) {
		process.stderr.write(`cannot read package.json: ${error.message}\n`);
		return 2;
	}

	const result = evaluateTestWiring({ scriptsDir: SCRIPTS_DIR, pkg });

	if (result.runnerScripts.length === 0) {
		process.stderr.write(
			[
				`no npm script references scripts/${RUNNER_FILE_NAME}.`,
				'',
				'The discovery rule is only in force when `pnpm run test` delegates to the',
				'runner; without it every file below would read as "reachable" while',
				'nothing runs it. Wire `"test": "vitest run && node scripts/run-script-tests.mjs"`.',
				'',
			].join('\n'),
		);
		return 1;
	}

	if (result.staleExceptions.length > 0) {
		process.stderr.write(
			'ALLOWED_UNWIRED in scripts/check-test-wiring.mjs names file(s) that are gone:\n',
		);
		for (const name of result.staleExceptions) process.stderr.write(`  - ${name}\n`);
		process.stderr.write('Delete the entry, so the exception list stays reviewable.\n');
		return 1;
	}

	if (result.orphans.length === 0) {
		process.stdout.write(
			`test wiring OK: all ${result.discovered.length} scripts/*.test.mjs files are reachable ` +
				`(runner scripts/${RUNNER_FILE_NAME} via ${result.runnerScripts.map((name) => `\`pnpm run ${name}\``).join(', ')}` +
				`${result.literal.length > 0 ? `, ${result.literal.length} also named directly` : ''})\n`,
		);
		return 0;
	}

	process.stderr.write(
		`${result.orphans.length} test file(s) under scripts/ are not wired into any npm script:\n`,
	);
	for (const relativePath of result.orphans) process.stderr.write(`  - ${relativePath}\n`);
	process.stderr.write(
		'\nAn unwired test file never runs, so a broken import or a stale\n' +
			'assertion in it is invisible to CI. Name the file in an npm script\n' +
			'(the convention already covers it once scripts/run-script-tests.mjs is\n' +
			'wired), or — if it genuinely has no independent surface — add it to\n' +
			'ALLOWED_UNWIRED in scripts/check-test-wiring.mjs with a reason.\n',
	);
	return 1;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main());
}
