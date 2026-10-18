import type { Context } from 'hono';
import { createAuditLogger } from '../logging/logger';
import { generateRequestId } from './middleware/request-id';

/**
 * Public error contract for the external HTTP boundary (Issue #457).
 *
 * Why this module exists
 * ----------------------
 * `externalBoundary.onError` is the single funnel for every
 * unexpected throw inside `/api/v1/*`, `/webhooks/*`, `/oauth/*`
 * and `/integrations/*`. Before this module the fallback was
 * `c.json({ error: 'internal_error' }, 500)` with the raw error
 * object handed to `console.error` — correct in the narrow sense
 * (no stack reached the client) but incomplete as an operational
 * contract:
 *
 *   * the client got a code with no way to quote it back, so a
 *     support question ("the reaction API returned 500") had
 *     nothing to correlate against the Worker log;
 *   * the 503 bodies answered by `/api/v1/db/ping` and
 *     `/api/v1/media/ping` carried `binding: 'd1' | 'r2'`, i.e.
 *     the internal binding name, on a failure path.
 *
 * The contract implemented here:
 *
 *   1. **A failure body never carries internal detail.** No stack,
 *      no SQL / D1 / R2 message, no secret or binding name, no
 *      exception message. Only a stable `error` code, a
 *      repo-authored `message`, and the correlation id.
 *   2. **The correlation id survives.** The same id is written to
 *      the internal `console.error` line, to the `X-Request-Id`
 *      response header, and to the body, so an operator reading a
 *      reported 500 can find the log line by grep.
 *   3. **The success contracts are untouched.** `/api/v1/health`,
 *      `/api/v1/db/ping` (200) and `/api/v1/media/ping` (404
 *      `key_not_found`) are documented operational probes and keep
 *      their existing bodies; only the *failure* branches change.
 *
 * What is deliberately NOT redacted: the 4xx bodies owned by the
 * routers (`invalid_body` + validator-authored `reason`, the auth
 * codes, `rate_limited`). Those messages come from a closed set of
 * strings written in this repository, they describe what the caller
 * sent wrong, and they carry no server state. Redacting them would
 * remove useful client feedback without removing any internal
 * information.
 */

/** Stable machine-readable failure codes. */
export type PublicErrorCode = 'internal_error' | 'service_unavailable';

/**
 * Repo-authored explanations. Never interpolate an internal error,
 * a D1/R2 message, or an exception message here — that is the whole
 * point of the module.
 */
const PUBLIC_MESSAGES: Record<PublicErrorCode, string> = {
	internal_error: 'The request could not be completed. Quote the request_id when reporting this.',
	service_unavailable:
		'A required service is temporarily unavailable. Please try again later. Quote the request_id when reporting this.',
};

/** The exact body shape every 5xx from the boundary returns. */
export interface PublicErrorBody {
	/** Stable code for programmatic handling. */
	error: PublicErrorCode;
	/** Safe, human-readable explanation. */
	message: string;
	/** Correlation id, identical to the `X-Request-Id` response header. */
	request_id: string;
}

type ErrorContext = Context<{
	Bindings: Env;
	Variables: { requestId?: string; requestIdMinted?: boolean };
}>;

/**
 * Boundary diagnostics. Same `[boundary]` scope the module used when
 * it called `console.error` directly (Issue #457), so an operator's
 * grep is unchanged; the record itself now passes through
 * `src/logging` redaction (Issue #467).
 */
const boundaryLogger = createAuditLogger('boundary');

export interface PublicErrorOptions {
	/**
	 * HTTP status for the redacted response. Narrowed to the two the
	 * boundary actually emits: an unexpected throw is 500, a failed
	 * dependency probe is 503.
	 */
	status: 500 | 503;
	/** Stable code exposed to the client. */
	code: PublicErrorCode;
	/**
	 * Operator-facing label for the internal log line, e.g.
	 * `'d1 ping'`. It must describe the *operation*, never the
	 * secret or binding value involved.
	 */
	logLabel: string;
}

/**
 * Resolve the correlation id for a request, and whether this Worker
 * minted it.
 *
 * `/api/v1/*` requests already ran `requestIdMiddleware`, which set
 * the variable and the response header; reusing it keeps the log
 * line, the header and the body in agreement. Errors from the other
 * boundary prefixes (`/webhooks`, `/oauth`, `/integrations`) do not
 * run that middleware, so an id is minted here and published as a
 * header for the same reason.
 *
 * `minted` is what `publicErrorResponse` needs for the log record
 * (Issue #467): only a token this process generated may be written to
 * the operator log verbatim, because a client-supplied `X-Request-Id`
 * is accepted from a much wider alphabet and could therefore be a
 * credential someone is trying to smuggle into an operator-visible
 * stream. The response body and header still carry the id in both
 * cases — a client that supplied it already knows it, and #457
 * publishes it there on purpose.
 */
function resolveCorrelation(c: ErrorContext): { id: string; minted: boolean } {
	const existing = c.get('requestId');
	if (typeof existing === 'string' && existing.length > 0) {
		return { id: existing, minted: c.get('requestIdMinted') === true };
	}
	const generated = generateRequestId();
	c.set('requestId', generated);
	c.header('X-Request-Id', generated);
	return { id: generated, minted: true };
}

/**
 * Resolve the correlation id for a request (id only).
 *
 * Kept for callers that need the value without the record decision;
 * `publicErrorResponse` uses `resolveCorrelation` directly.
 */
export function resolveRequestId(c: ErrorContext): string {
	return resolveCorrelation(c).id;
}

/**
 * Log an internal failure and answer with a redacted public body.
 *
 * The `err` argument goes to the internal log record and nowhere
 * else, and it is written through `createAuditLogger('boundary')`
 * (Issue #467) so an error message, a D1 string or a query echo is
 * redacted before it reaches the stream. The correlation id is the
 * single exception, and only when this Worker minted it — see
 * `redactCorrelationId`. The response is built only from
 * `PUBLIC_MESSAGES` plus the correlation id, so no branch of this
 * function can echo internal detail.
 */
export function publicErrorResponse(
	c: ErrorContext,
	err: unknown,
	options: PublicErrorOptions,
): Response {
	const { id: requestId, minted } = resolveCorrelation(c);
	boundaryLogger.errorCorrelated(
		`${options.logLabel} failed (status=${options.status})`,
		minted ? requestId : null,
		err,
	);
	const body: PublicErrorBody = {
		error: options.code,
		message: PUBLIC_MESSAGES[options.code],
		request_id: requestId,
	};
	return c.json(body, options.status);
}
