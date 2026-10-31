/**
 * Is this base URL a local origin? (Issue #728)
 *
 * What this is
 * ------------
 * The e2e suite decides several things from one fact: is the run
 * pointed at a local origin, or at a deployed one?
 *
 *   - the local D1 bootstrap and the preview server run only for a
 *     local origin,
 *   - the local-only specs (the two that seed the LOCAL D1 file) may
 *     only be skipped against a deployed origin when the run says so
 *     explicitly (`E2E_LOCAL_ONLY_ACK=1`).
 *
 * Both decisions used the same string-prefix test
 * (`baseUrl.startsWith('http://127.0.0.1')`). A prefix is not an
 * origin: `http://127.0.0.1.example.org:3000` and
 * `http://127.0.0.1@remote.example/` both pass it while pointing
 * somewhere else entirely. The first would start a local preview
 * against a foreign host; the second would carry the loopback-looking
 * host as a *userinfo* component and point at `remote.example`.
 *
 * The rule
 * --------
 * A base URL is local when it parses, uses `http:`, and its hostname is
 * exactly `127.0.0.1`. The port is irrelevant — every port on the
 * loopback interface is the local machine.
 *
 * Everything else is NOT local, including a URL that does not parse at
 * all. The predicate fails closed: an unrecognised base URL must not
 * be treated as "the local machine", because the local branch is the
 * branch that starts servers and seeds databases.
 *
 * This module is the single owner of that question, so the config and
 * the spec guard cannot drift apart.
 */

/** The only hostname that counts as "this machine". */
export const LOCAL_HOSTNAME = '127.0.0.1';

/**
 * Is this base URL a local origin?
 *
 * @param {string | undefined | null} baseUrl the configured base URL
 * @returns {boolean} true only for a loopback `http:` origin.
 */
export function isLocalOrigin(baseUrl) {
	// Unset means "the local default" — the caller has not chosen a
	// deployed origin, so the local branch is the correct one.
	if (baseUrl === undefined || baseUrl === null) return true;
	let url;
	try {
		url = new URL(baseUrl);
	} catch {
		return false;
	}
	return url.protocol === 'http:' && url.hostname === LOCAL_HOSTNAME;
}
