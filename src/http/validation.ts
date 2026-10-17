import type { Context, MiddlewareHandler } from 'hono';
import type { ZodType } from 'zod';

/**
 * External boundary input validation (Issue #450).
 *
 * Every byte that reaches a `/api/v1/*` handler is untrusted. The
 * client-side validation in the TanStack Start UI is a **convenience
 * for the user**, never a security control: any caller can `curl` the
 * Worker directly. This module owns the boundary contract that turns
 * an untrusted request into either
 *
 *   - a typed value the handler may use, or
 *   - a **defined** rejection (`400` / `413` / `415`) whose body is
 *     always `{ error: <stable code>, reason: <human string> }`.
 *
 * The dimensions covered are the four OWASP-style input classes this
 * boundary actually faces:
 *
 * | Dimension | Guard                                    | Defined response            |
 * |-----------|------------------------------------------|-----------------------------|
 * | size      | `MAX_JSON_BODY_BYTES`                    | `413 payload_too_large`     |
 * | format    | per-field validators (schema modules)    | `400 <field-specific code>` |
 * | protocol  | `Content-Type` + `Allow` (method)        | `415` / `405`               |
 * | type      | Zod schemas over the parsed JSON         | `400 invalid_body`          |
 *
 * **Ordering vs. authentication.** Validation runs *after*
 * `requireApiKey` on purpose. `requireApiKey` is rate-limited by the
 * Better Auth api-key plugin, so an unauthenticated flood is rejected
 * before the Worker reads a body at all. Moving validation earlier
 * would let an anonymous caller force body reads. See
 * `docs/security/input-validation.md` for the full contract.
 *
 * **Why not `hono/validator`.** `hono/validator('json', …)` parses the
 * body internally, which makes a pre-parse size check impossible —
 * `Request.body` may be consumed exactly once, so the 413 guard has to
 * own the read. The functions below keep the read and the policy in one
 * place instead of splitting them across two middleware.
 */

/** Maximum accepted JSON body for any `/api/v1/*` endpoint. */
export const MAX_JSON_BODY_BYTES = 16 * 1024;

/** A rejection the boundary knows how to serialise. */
export interface BoundaryFailure {
	status: 400 | 413 | 415;
	/** Stable, machine-readable code. Consumers switch on this. */
	code: string;
	/** Human-readable cause. Never contains credentials or raw bodies. */
	reason: string;
}

export type BoundaryResult<T> = { ok: true; value: T } | { ok: false; failure: BoundaryFailure };

/** Minimal structural view of a Zod error — enough to describe it. */
interface IssueLike {
	issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}

/**
 * Render a Zod failure as one human-readable line. The old code put
 * `error.message` — the full JSON-serialised issue list — into
 * `reason`, which is unreadable in a log and grows with every field.
 */
export function formatIssues(error: IssueLike): string {
	const issue = error.issues[0];
	if (!issue) return 'invalid input';
	const path = issue.path.join('.');
	return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Either a Zod schema (the `type` dimension) or one of the throwing
 * `validate*` functions that already live in the per-endpoint schema
 * modules (the `format` dimension). Both are accepted so an endpoint
 * does not have to restate an existing contract in Zod form.
 */
export type BoundaryValidator<T> = ZodType<T> | ((value: unknown) => T);

declare module 'hono' {
	interface ContextVariableMap {
		/** Populated by `jsonBody()`. Typed per-route via a cast. */
		boundaryBody: unknown;
	}
}

/** Serialise a failure into the canonical rejection envelope. */
export function rejection(c: Context, failure: BoundaryFailure): Response {
	return c.json({ error: failure.code, reason: failure.reason }, failure.status);
}

function failure(code: string, reason: string, status: 400 | 413 | 415 = 400): BoundaryFailure {
	return { status, code, reason };
}

/**
 * Run an untrusted value through a boundary validator.
 *
 * Zod schemas are checked through `safeParse`; a throwing `validate*`
 * function is invoked inside a try/catch. Both shapes produce the same
 * defined 400 — a format violation must never escape as a 500.
 */
export function parseBoundaryInput<T>(
	code: string,
	validator: BoundaryValidator<T>,
	value: unknown,
): BoundaryResult<T> {
	if (typeof validator === 'function') {
		try {
			return { ok: true, value: validator(value) };
		} catch (err) {
			return {
				ok: false,
				failure: failure(code, err instanceof Error ? err.message : String(err)),
			};
		}
	}
	const parsed = validator.safeParse(value);
	if (parsed.success) return { ok: true, value: parsed.data };
	return { ok: false, failure: failure(code, formatIssues(parsed.error)) };
}

/**
 * `Content-Length` as declared by the client, when present and
 * numeric. Used for the cheap pre-read rejection of oversized bodies.
 */
export function declaredBodyBytes(headers: Headers): number | null {
	const raw = headers.get('content-length');
	if (raw === null) return null;
	const parsed = Number(raw);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export interface JsonBodyOptions {
	/** Error code for content-type / size / parse / schema failures. */
	code?: string;
	maxBytes?: number;
}

/**
 * Content-Type guard for JSON endpoints.
 *
 * `application/json` is required and `application/*+json` is accepted
 * (structured-suffix JSON, RFC 6839). A wildcard media type — which
 * `curl --data-binary` sends by default — is accepted so scripted
 * callers are not broken, and an absent header is treated the same
 * way. Anything else is a protocol mismatch, not a bad value, so it is
 * answered with `415` instead of a `400` about the body.
 */
export function isJsonContentType(headers: Headers): boolean {
	const raw = headers.get('content-type');
	if (raw === null) return true;
	const mediaType = raw.split(';')[0].trim().toLowerCase();
	if (mediaType.length === 0) return true;
	return mediaType === '*/*' || mediaType === 'application/json' || mediaType.endsWith('+json');
}

/**
 * Read the request body as JSON under the boundary size + protocol
 * contract. The returned value is `unknown` — callers hand it to
 * `jsonBody()` (which also applies the `type` dimension) or to
 * `parseBoundaryInput()`.
 */
export async function readJsonBody(
	c: Context,
	options: JsonBodyOptions = {},
): Promise<BoundaryResult<unknown>> {
	const code = options.code ?? 'invalid_body';
	const maxBytes = options.maxBytes ?? MAX_JSON_BODY_BYTES;

	if (!isJsonContentType(c.req.raw.headers)) {
		return {
			ok: false,
			failure: failure('unsupported_media_type', 'content-type must be application/json', 415),
		};
	}

	const declared = declaredBodyBytes(c.req.raw.headers);
	if (declared !== null && declared > maxBytes) {
		return {
			ok: false,
			failure: failure('payload_too_large', `body must be at most ${maxBytes} bytes`, 413),
		};
	}

	let text: string;
	try {
		text = await c.req.text();
	} catch {
		return { ok: false, failure: failure(code, 'body could not be read') };
	}

	// A chunked request carries no `Content-Length`, so the declared
	// check above can be bypassed. Measuring what was actually read is
	// the authoritative guard.
	const actual = new TextEncoder().encode(text).length;
	if (actual > maxBytes) {
		return {
			ok: false,
			failure: failure('payload_too_large', `body must be at most ${maxBytes} bytes`, 413),
		};
	}

	try {
		return { ok: true, value: JSON.parse(text) as unknown };
	} catch {
		return { ok: false, failure: failure(code, 'body must be valid JSON') };
	}
}

/**
 * Middleware that applies the full body contract — protocol (`415`),
 * size (`413`), and type (`400`) — and stores the typed value in
 * `c.get('boundaryBody')`.
 *
 * ```ts
 * router.post('/hit', requireApiKey, jsonBody(HitInput), (c) => {
 *   const { key } = c.get('boundaryBody') as z.infer<typeof HitInput>;
 * });
 * ```
 */
export function jsonBody<T>(
	schema: BoundaryValidator<T>,
	options: JsonBodyOptions = {},
): MiddlewareHandler<{ Bindings: Env }> {
	const code = options.code ?? 'invalid_body';
	return async (c, next) => {
		const read = await readJsonBody(c, options);
		if (!read.ok) return rejection(c, read.failure);
		const parsed = parseBoundaryInput(code, schema, read.value);
		if (!parsed.ok) return rejection(c, parsed.failure);
		c.set('boundaryBody', parsed.value);
		await next();
	};
}

/**
 * Collect the named query parameters, rejecting HTTP parameter
 * pollution (the same name supplied more than once). Without this a
 * caller could send `?target=a&target=b` and have the two parsing
 * layers in front of it (proxies, `URLSearchParams`, hand-rolled
 * splitters) disagree about which value is authoritative.
 *
 * Absent parameters are simply missing from the result — `required`
 * parameters are the caller's decision, so it can keep its own
 * `missing_*` code.
 */
export function parseQueryInput(
	c: Context,
	names: readonly string[],
	options: { code?: string } = {},
): BoundaryResult<Record<string, string>> {
	const code = options.code ?? 'invalid_query';
	const values: Record<string, string> = {};
	for (const name of names) {
		const all = c.req.queries(name);
		if (all === undefined || all.length === 0) continue;
		if (all.length > 1) {
			return { ok: false, failure: failure(code, `${name} must be supplied at most once`) };
		}
		values[name] = all[0];
	}
	return { ok: true, value: values };
}

/** Validate a single path parameter through a boundary validator. */
export function parsePathInput<T>(
	c: Context,
	name: string,
	validator: BoundaryValidator<T>,
	code: string,
): BoundaryResult<T> {
	return parseBoundaryInput(code, validator, c.req.param(name));
}

/**
 * `405` handler for a path that exists but does not accept the request
 * method. Registered with `.all()` **after** the real handlers so a
 * supported method is matched first.
 */
export function methodNotAllowed(allow: readonly string[]): (c: Context) => Response {
	const header = allow.join(', ');
	return (c) => {
		c.header('Allow', header);
		return c.json(
			{ error: 'method_not_allowed', reason: `${c.req.method} is not allowed on this resource` },
			405,
		);
	};
}
