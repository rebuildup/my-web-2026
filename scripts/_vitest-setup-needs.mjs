/**
 * Decision shared by `vitest.config.ts` (the scanner result) and the
 * Better Auth schema setup file (the per-file check). Issue #618.
 *
 * Why this exists
 * ---------------
 * Importing `cloudflare:test` connects the test file to the Workers
 * pool (Miniflare). That connection costs ~2.4s per test FILE and is
 * paid even by files that never touch a binding, because the global
 * setup file imported `cloudflare:test` unconditionally. Across the
 * suite this was the dominant Vitest cost (521s cumulative setup in
 * CI run 39354102866).
 *
 * Only the files that import `cloudflare:test` can reach `env.DB`, so
 * only they need the Better Auth DDL. `vitest.config.ts` scans the
 * test tree for the specifier and passes the result through an
 * environment variable; the setup file applies the schema only when
 * the current test file is in that set.
 *
 * Fail-safe direction
 * -------------------
 * Anything the setup cannot decide — a missing environment variable,
 * malformed JSON, an unknown test path — returns `true` (apply the
 * schema). A misconfiguration therefore falls back to the previous
 * behaviour instead of silently leaving a DB test without its tables.
 * The fallback is a schema mismatch, never a skipped assertion.
 */

/** Environment variable carrying the JSON array of absolute test paths. */
export const AUTH_SCHEMA_ENV_VAR = 'BETTER_AUTH_SCHEMA_TEST_FILES';

/** Serialize the scanner result for `test.env`. */
export function encodeAuthSchemaTestFiles(files) {
	return JSON.stringify(files);
}

/**
 * Whether the current test file needs the Better Auth / D1 schema.
 *
 * `encodedFiles` is the value read from `process.env[AUTH_SCHEMA_ENV_VAR]`;
 * `testPath` is `expect.getState().testPath` from the setup file. Both
 * are passed in so this function stays pure and testable.
 */
export function needsAuthSchema(testPath, encodedFiles) {
	if (typeof encodedFiles !== 'string' || encodedFiles.length === 0) return true;

	let files;
	try {
		files = JSON.parse(encodedFiles);
	} catch {
		return true;
	}
	if (!Array.isArray(files)) return true;

	// A file that cannot name itself cannot prove it does not need the
	// schema, so keep the previous behaviour.
	if (typeof testPath !== 'string' || testPath.length === 0) return true;

	return files.includes(testPath);
}
