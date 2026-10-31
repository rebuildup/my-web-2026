/**
 * Local-only e2e specs must not skip silently (Issue #728).
 *
 * What this is
 * ------------
 * Two e2e specs seed a row into the LOCAL D1 file
 * (`.tmp/d1state`) and assert on it:
 *
 *   - `e2e/seo-status.spec.ts`
 *   - `e2e/portfolio-markdown-xss.spec.ts`
 *
 * A deployed origin cannot read that file, so both specs are
 * local-only. Two mechanisms keep them local:
 *
 *   1. `playwright.config.ts` does not collect them against a
 *      non-local `PLAYWRIGHT_BASE_URL`.
 *   2. The spec itself repeats the check with a describe-level
 *      `test.skip`, because an explicitly named file
 *      (`playwright test <file>`) is not covered by `testIgnore`.
 *
 * Both mechanisms were SILENT. A skipped file — or a file that was
 * never collected — looks exactly like a file that verified something.
 * A run pointed at a deployed origin could therefore report "green"
 * while two specs contributed nothing, and nothing in the output said
 * so.
 *
 * The rule
 * --------
 * A local-only spec may only be skipped against a non-local origin
 * when the run says so EXPLICITLY. The acknowledgement is an
 * environment variable, and its absence is a failure rather than a
 * skip:
 *
 *   E2E_LOCAL_ONLY_ACK=1
 *
 * The default is deliberately "fail": a person who points the suite at
 * a deployed origin should be told that two specs cannot run there,
 * not handed a green result that quietly says less than it looks.
 *
 * Nothing here is secret-bearing and nothing here reaches the network:
 * it reads two environment values and compares strings.
 */

/** The environment variable that acknowledges the lost coverage. */
export const LOCAL_ONLY_ACK_ENV = 'E2E_LOCAL_ONLY_ACK';

/**
 * Is the run pointed at a local origin?
 *
 * The predicate is deliberately the SAME one the specs already used
 * (`PLAYWRIGHT_BASE_URL` unset → the local default; otherwise the
 * origin must be `http://127.0.0.1`). Narrowing it here would change
 * which runs are considered local, and that is not this Issue's
 * business.
 *
 * @param {string | undefined} baseUrl the configured base URL
 * @returns {boolean}
 */
export function isLocalBaseUrl(baseUrl) {
	return baseUrl?.startsWith('http://127.0.0.1') ?? true;
}

/**
 * Did the run acknowledge that local-only specs will not run?
 *
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function localOnlyAcknowledged(env) {
	return env[LOCAL_ONLY_ACK_ENV] === '1';
}

/**
 * Refuse a silent skip.
 *
 * Called at module load by every local-only spec. Throws when the spec
 * would be skipped against a non-local origin without an explicit
 * acknowledgement, so the run fails with a message that names the
 * cause instead of reporting a file that verified nothing.
 *
 * @param {{baseUrl: string | undefined, acknowledged: boolean}} options
 * @returns {void}
 */
export function assertLocalOnlySpecMaySkip({ baseUrl, acknowledged }) {
	if (isLocalBaseUrl(baseUrl)) return;
	if (acknowledged) return;
	throw new Error(
		[
			'This spec is local-only: it seeds a row into the LOCAL D1 file, which a',
			`deployed origin cannot read. Running it against ${baseUrl} would skip every`,
			'test in this file, and a skipped file is indistinguishable from a file',
			'that verified something.',
			'',
			'Refusing to skip silently. Either:',
			'  - run the suite against a local origin (leave PLAYWRIGHT_BASE_URL unset,',
			'    or set it to http://127.0.0.1:<port>), or',
			`  - acknowledge the lost coverage explicitly with ${LOCAL_ONLY_ACK_ENV}=1.`,
		].join('\n'),
	);
}
