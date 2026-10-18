import { createMiddleware } from 'hono/factory';

/**
 * Request id middleware — assigns or echoes `X-Request-Id`.
 *
 * If the client supplies an `X-Request-Id` that matches
 * `ACCEPTED_REQUEST_ID` it is preserved so distributed traces remain
 * correlatable. Otherwise a 128-bit random hex id is generated. The
 * id is exposed to downstream handlers via `c.set('requestId', ...)`
 * and written back to the response headers. `requestIdMinted` records
 * whether this Worker generated the value, which the public error
 * boundary needs before it may write the id to an operator-visible log
 * line (Issue #467).
 *
 * The charset constraint is not cosmetic: since Issue #457 the id is
 * also published in the **body** of a public 5xx response
 * (`src/http/errors.ts`), so an unconstrained echo would let any
 * client string ride along inside a documented contract field.
 *
 * Used by all `/api/v1/*` routes (mounted in `src/http/hono.ts`) so
 * error responses and worker logs share a common correlation token.
 */

/** Max length of a client-supplied correlation id. */
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Shape accepted from a client: the union of the trace-id alphabets
 * the ecosystem actually uses (UUID / W3C `traceparent` / dotted
 * service ids) — letters, digits, `.`, `_`, `:`, `-`. Anything else
 * (spaces, control characters, `<`, `>`) is not echoed back.
 */
const ACCEPTED_REQUEST_ID = new RegExp(`^[A-Za-z0-9._:-]{1,${MAX_REQUEST_ID_LENGTH}}$`);

/**
 * Whether a client-supplied `X-Request-Id` may be reused verbatim.
 * Exported for `src/http/errors.test.ts` — the same rule decides
 * whether a reporter's own id survives into the public body.
 */
export function isAcceptedRequestId(value: string | undefined | null): value is string {
	return typeof value === 'string' && ACCEPTED_REQUEST_ID.test(value);
}

export const requestIdMiddleware = createMiddleware<{
	Bindings: Env;
	Variables: { requestId: string; requestIdMinted: boolean };
}>(async (c, next) => {
	const existing = c.req.header('X-Request-Id');
	const accepted = isAcceptedRequestId(existing);
	const requestId = accepted ? (existing as string) : generateRequestId();
	c.set('requestId', requestId);
	// Whether this Worker minted the id is what `publicErrorResponse`
	// needs for its log record (Issue #467): a token a client chose is
	// not proof of anything, so only a minted one may be printed.
	c.set('requestIdMinted', !accepted);
	c.header('X-Request-Id', requestId);
	await next();
});

/**
 * Mint a correlation id for a request that did not supply one.
 *
 * Exported for `src/http/errors.ts`: the boundary prefixes other
 * than `/api/v1/*` do not run this middleware, so the redaction
 * fallback needs the same generator rather than a second
 * implementation with a different format.
 */
export function generateRequestId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
