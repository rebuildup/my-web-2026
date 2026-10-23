/**
 * The test pool's outbound-request policy (Issue #261).
 *
 * Why the pool needs one
 * ----------------------
 * The Worker under test must not reach the public internet. It did,
 * and the reason is structural rather than accidental: **the home
 * route is its own consumer of the access-counter and reactions
 * APIs** (ADR-0011). Rendering `/` therefore makes the Worker call
 * its OWN origin — and in this pool the request origin is a public
 * host name (`https://example.com`, and `https://rebuildup.dev` in
 * `test/integration/cors.test.ts`), so every home render used to
 * spend real DNS + TLS + round-trip time on the open internet, and
 * `cors.test.ts` used to send that traffic to the **production**
 * origin.
 *
 * The consequences were measurable:
 *
 *   - a home render cost 1900-3100 ms (measured), of which the
 *     outbound round trips were the dominant part, and the spread
 *     between a fast and a slow run was large enough to push the
 *     first test of a file past vitest's 5000 ms budget;
 *   - the suite was not hermetic — its result depended on public
 *     (and production) availability;
 *   - the suite sent traffic to production from a test run.
 *
 * What the policy does
 * --------------------
 * The pool answers every outbound request itself, immediately, with a
 * 503. The upstream call therefore fails FAST, and the Worker takes
 * the **same degradation branch it already took**: the old answer was
 * a 404/405 from the public host (the API path does not exist
 * there), so every caller already handled "upstream did not answer
 * with a payload" and already degraded. The only thing that changes
 * is the latency and the fact that the request never leaves the
 * machine.
 *
 * No assertion changes, and no application code changes: this is a
 * statement about the TEST ENVIRONMENT, not about the product.
 *
 * If a future surface needs a real outbound call (the outbound
 * third-party read in `src/external-api/**` is not wired to a route
 * today), it has to be mocked HERE — deliberately, per host — rather
 * than silently reaching the network from a test.
 */

/** The status the pool answers an outbound request with. */
export const OUTBOUND_BLOCKED_STATUS = 503;

/**
 * The body the pool answers with. It names the path and says why,
 * so a failing test log says "the pool blocked this" instead of
 * leaving the reader to guess whether a third party was slow.
 */
export function outboundBlockedBody(url) {
	let path = url;
	try {
		path = new URL(url).pathname;
	} catch {
		/* A URL the platform did not give us stays as it is. */
	}
	return `outbound request blocked by the test pool (Issue #261): ${path}`;
}

/**
 * Build the pool's `outboundService`.
 *
 * The platform hands this function the outbound `Request`; it
 * answers with a `Response`. The request is never forwarded, so no
 * host, header or body leaves the machine.
 */
export function createOutboundPolicy() {
	return async (request) =>
		new Response(outboundBlockedBody(request?.url ?? ''), {
			status: OUTBOUND_BLOCKED_STATUS,
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		});
}
