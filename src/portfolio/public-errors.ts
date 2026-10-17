/**
 * Public error boundary for the Portfolio server functions
 * (Issue #457).
 *
 * Why the server functions need their own boundary
 * ------------------------------------------------
 * The external HTTP boundary redacts through `src/http/errors.ts`.
 * Server functions cannot use it: TanStack Start serialises whatever
 * a handler throws straight into the `/_serverFn/*` payload (and, for
 * an SSR loader failure, into the rendered error screen) using
 * `ShallowErrorPlugin`, which copies the **message** of the thrown
 * `Error`. The stack does not cross — but a D1 failure message does:
 * `D1_ERROR: no such table: portfolio_project: SQLITE_ERROR` tells an
 * anonymous visitor the schema, the table name, and that the project
 * runs on Cloudflare D1. That is exactly the SQL / binding detail
 * Issue #457 forbids on a public surface.
 *
 * The contract implemented here:
 *
 *   1. The internal error is logged once, with a short reference id.
 *   2. The thrown error carries a repo-authored string plus the same
 *      reference id, so the rendered screen shows a safe description
 *      ("portfolio_unavailable (ref: 1a2b3c4d)") that an operator can
 *      grep in the log.
 *   3. `redactedError.message` is built by this module alone; no
 *      branch interpolates the caught error.
 *
 * This is deliberately **not** a shared abstraction with
 * `src/http/errors.ts`. That module owns the HTTP body contract
 * (status code + JSON envelope) of the external boundary; this one
 * owns the thrown-error contract of the Portfolio server-function
 * surface. The two have different owners, different lifecycles, and
 * no third call site — promoting them would be pre-creating a shared
 * concept (ADR-0008).
 */

/** Stable, greppable marker shown to the visitor. */
export const PORTFOLIO_UNAVAILABLE = 'portfolio_unavailable';

/**
 * Short correlation reference (8 hex chars). Not a secret and not a
 * credential — it exists only to pair a rendered screen with a log
 * line.
 */
export function createReferenceId(): string {
	return crypto.randomUUID().replaceAll('-', '').slice(0, 8);
}

/**
 * Run a public Portfolio read, converting any internal failure into a
 * redacted, reference-carrying error.
 *
 * `label` names the operation for the operator (`project`,
 * `adjacent`, `list`) and is a repo-authored constant at every call
 * site — never request input, so a caller cannot forge a log line.
 */
export async function withPublicErrorBoundary<T>(label: string, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (err) {
		const reference = createReferenceId();
		console.error(`[portfolio.public] ${label} failed (ref=${reference})`, err);
		throw new Error(`${PORTFOLIO_UNAVAILABLE} (ref=${reference})`);
	}
}
