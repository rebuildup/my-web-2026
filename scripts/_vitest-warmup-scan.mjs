/**
 * Decide which test files need the workerd cold-start warm-up
 * (Issue #261).
 *
 * The problem
 * -----------
 * A test file that issues its first `SELF.fetch` pays the Worker
 * bundle's cold start: the worker module graph, the TanStack Start
 * route tree and the first SSR render are all loaded on demand. That
 * cost is measured at 2230-3240 ms per file, which is 45-65% of the
 * 5000 ms per-test budget before the test has asserted anything. The
 * first test in such a file therefore fails with
 * "Test timed out in 5000ms" whenever the machine is busy — a flake
 * with no failing assertion.
 *
 * The fix is to issue one warm-up request before the timed tests run,
 * so the cold start is paid in the setup/hook budget instead of a test
 * budget. This scanner decides WHICH files pay it.
 *
 * Why the scan is direct
 * ----------------------
 * `SELF` is a binding of the `cloudflare:test` module, so a file that
 * uses it must import it from there. The import graph does not have to
 * be walked: no module in this repository re-exports `SELF`, and a
 * file that obtained it that way would still import the module holding
 * it. A direct scan of the test file's own import statement is
 * therefore exact, and it is far cheaper than the transitive walk the
 * pool-connection scanner performs.
 *
 * Failure direction
 * -----------------
 * The two directions are not symmetric. Including a file that does not
 * need the warm-up costs one extra request (~150 ms once the worker
 * is already up). Excluding a file that needs it restores the flake.
 * Every ambiguous case therefore resolves to "included".
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Test entry points the Vitest workerd config includes. */
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:ts|tsx)$/;

/**
 * `import { SELF } from 'cloudflare:test'` and `import { SELF as S }`.
 *
 * Only the named-import form is matched: `SELF` is a module binding, so
 * a default or namespace import cannot produce it (`import * as cf`
 * would give `cf.SELF`, which the caller uses as `cf.SELF.fetch` — that
 * form is still matched by the `SELF` token test below).
 */
const NAMED_IMPORT_PATTERN = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]cloudflare:test['"]/g;

/** The module that exports the `SELF` binding. */
const CLOUDFLARE_TEST = 'cloudflare:test';

/**
 * Whether `source` imports the `SELF` binding from `cloudflare:test`.
 *
 * Exported so the rule is testable on its own, without a file tree.
 */
export function importsSelf(source) {
	NAMED_IMPORT_PATTERN.lastIndex = 0;
	for (const match of source.matchAll(NAMED_IMPORT_PATTERN)) {
		const bindings = (match[1] ?? '')
			.split(',')
			.map((binding) => binding.trim())
			.filter(Boolean);
		for (const binding of bindings) {
			// `SELF` or `SELF as localName` — the imported name is what
			// matters, the local alias does not change the fact that the
			// file can issue a worker request.
			const imported = binding.split(/\s+as\s+/)[0].trim();
			if (imported === 'SELF') return true;
		}
	}

	// A namespace import (`import * as cf from 'cloudflare:test'`) also
	// yields `SELF`; the call site then reads `cf.SELF.fetch`. The
	// module is the same, so the file needs the warm-up too.
	const namespacePattern = new RegExp(
		`import\\s*\\*\\s*as\\s+\\w+\\s+from\\s*['"]${CLOUDFLARE_TEST}['"]`,
	);
	return namespacePattern.test(source);
}

/**
 * Absolute, sorted paths of test files under `dirs` that import the
 * `SELF` binding, i.e. the files whose first timed test can carry the
 * cold start.
 *
 * `rootDir` is the repository root.
 */
export function discoverWarmupTestFiles(rootDir, { dirs = ['src', 'test'] } = {}) {
	const root = resolve(rootDir);
	const found = [];

	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			// A missing directory is an empty candidate set. The gate
			// that proves the suite is wired
			// (check-test-wiring.mjs) is what fails when the tree
			// disappears, not this scan.
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (!entry.isFile() || !TEST_FILE_PATTERN.test(entry.name)) continue;

			let source;
			try {
				source = readFileSync(full, 'utf8');
			} catch {
				// Fail safe: a file we cannot read may need the warm-up.
				found.push(resolve(full));
				continue;
			}
			if (importsSelf(source)) found.push(resolve(full));
		}
	};

	for (const dir of dirs) walk(resolve(root, dir));
	return found.sort();
}
