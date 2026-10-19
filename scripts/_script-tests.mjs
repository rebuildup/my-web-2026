/**
 * Discovery contract for the `scripts/*.test.mjs` suite (Issue #566).
 *
 * Why this exists
 * ---------------
 * `package.json#scripts.test` used to enumerate all 107
 * `node --test scripts/<file>` invocations in ONE line. A ticket that
 * added a test had to insert its own `&& …` segment into that shared
 * line, so concurrent ticket PRs conflicted on it for a change that
 * carried no design decision at all.
 *
 * The suite is now discovered BY CONVENTION: every `scripts/*.test.mjs`
 * is a test entry point, and `scripts/run-script-tests.mjs` runs them
 * in a deterministic order. Adding a test is adding a file.
 *
 * Two things stay deliberate rather than accidental:
 *
 * 1. **Per-file process isolation.** Each file runs in its own
 *    `node --test <file>` child, one file at a time, stopping at the
 *    first failure with that failure's exit code — the semantics of the
 *    `&&` chain this replaces. Files therefore cannot share module
 *    state, and a crash in one cannot take the rest of the suite with
 *    it.
 * 2. **Type stripping is always on.** A few files import TypeScript
 *    source directly (`scripts/check-content-links.test.mjs` and
 *    friends). The flag is passed to every file rather than to a
 *    hand-maintained list, so a new TypeScript-importing test needs no
 *    wiring decision. `AGENTS.md` section 5 pins the Node floor at 22.18
 *    for exactly this reason (type stripping is on by default there);
 *    passing the flag keeps the child correct on any supported Node.
 *
 * This module is pure so `scripts/check-test-wiring.mjs` can prove
 * reachability against the SAME discovery rule the runner uses, instead
 * of grepping `package.json` for a filename.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Suffix that makes a file under `scripts/` a test entry point. */
export const SCRIPT_TEST_SUFFIX = '.test.mjs';

/** Repo-relative path of the runner that consumes the discovery rule. */
export const RUNNER_RELATIVE_PATH = 'scripts/run-script-tests.mjs';

/** File name `package.json` must mention for the rule to be in force. */
export const RUNNER_FILE_NAME = 'run-script-tests.mjs';

/** Node flags every test child runs with. */
export const NODE_TEST_FLAGS = ['--experimental-strip-types', '--test'];

/** Every `scripts/*.test.mjs`, sorted, as repo-relative paths. */
export function discoverScriptTests(scriptsDir) {
	return readdirSync(scriptsDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(SCRIPT_TEST_SUFFIX))
		.map((entry) => `scripts/${entry.name}`)
		.sort();
}

/** argv for one discovered test file. */
export function testFileArgv(relativePath) {
	return [...NODE_TEST_FLAGS, relativePath];
}
