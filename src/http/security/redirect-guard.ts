import type { Context, MiddlewareHandler } from 'hono';
import {
	REDIRECT_TARGET_PARAM_NAMES,
	type RedirectCandidate,
	collectRedirectCandidatesFromBody,
	collectRedirectCandidatesFromUrl,
	firstRejectedRedirect,
} from './redirect';

/**
 * Open-redirect guard for the external HTTP boundary (Issue #454).
 *
 * Mounts in front of any handler that will turn an untrusted
 * `returnTo`-shaped value into a `Location` header. It answers exactly
 * one question — "is every redirect target in this request an
 * internal path?" — and refuses the request when the answer is no.
 *
 * Today it guards `/api/v1/auth/*` (`src/http/auth/router.ts`), where
 * Better Auth's post-sign-in `callbackURL` / `redirectTo` fields arrive.
 * The `/oauth/*` and `/integrations/*` boundaries that AGENTS.md §2
 * reserves do not exist yet; when one lands it mounts this same
 * middleware rather than re-deriving the rules.
 *
 * Two design points worth stating, because both are easy to undo by
 * accident:
 *
 * 1. **The guard runs before the handler.** Better Auth validates
 *    `callbackURL` against `trustedOrigins`, but that list is derived
 *    from `BETTER_AUTH_URL` — if that binding is missing, the list is
 *    whatever the request looks like. The guard's allow-list is
 *    project-owned and fail-closed, so a mis-provisioned origin
 *    cannot turn into an open redirect.
 * 2. **A rejection never echoes the value.** The body carries the
 *    parameter name, the reason and the source, so the response is
 *    safe to log and cannot be used as a reflector.
 *
 * Reading the body is safe because `Request.clone()` tees the stream:
 * the handler below still receives an unread body.
 */

export interface RedirectGuardOptions {
	/**
	 * Origins allowed to appear as an absolute redirect target; a
	 * matching URL is downgraded to its internal path. Resolve at
	 * request time (`(c) => …`) when the origin comes from a worker
	 * binding rather than a module constant.
	 */
	trustedOrigins?: readonly string[] | ((c: Context) => readonly string[]);
	/** Parameter / body-field names to inspect. Defaults to
	 *  `REDIRECT_TARGET_PARAM_NAMES`. */
	params?: readonly string[];
	/** Internal path prefixes the target must start with. */
	allowedPrefixes?: readonly string[];
}

/** How much of a request body the guard is willing to read. No shape
 *  this project produces puts a redirect target past it, so a larger
 *  body is not parsed rather than being buffered whole. */
const MAX_BODY_BYTES_SCANNED = 16 * 1024;

function resolveTrustedOrigins(options: RedirectGuardOptions, c: Context): readonly string[] {
	const configured = options.trustedOrigins;
	if (typeof configured === 'function') return configured(c);
	return configured ?? [];
}

/**
 * Read at most `maxBytes` of a cloned body, then give up.
 *
 * `Content-Length` alone is not a bound — a chunked request can declare
 * nothing — so the read is capped here as well. Cancelling one branch
 * of the `clone()` tee leaves the original body readable by the
 * handler below; only this side stops.
 */
async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
	const stream = request.clone().body;
	if (!stream) return null;
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = '';
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				return null;
			}
			text += decoder.decode(value, { stream: true });
		}
	} catch {
		return null;
	} finally {
		reader.releaseLock();
	}
	return text + decoder.decode();
}

/**
 * Every redirect target in the request — query string first, then the
 * body when it is one of the two encodings this project speaks.
 */
export async function collectRequestRedirectCandidates(
	request: Request,
	params: readonly string[],
): Promise<RedirectCandidate[]> {
	const candidates = collectRedirectCandidatesFromUrl(new URL(request.url), params);
	if (request.method === 'GET' || request.method === 'HEAD') return candidates;

	const contentType = request.headers.get('content-type');
	if (
		!contentType?.includes('application/json') &&
		!contentType?.includes('x-www-form-urlencoded')
	) {
		return candidates;
	}
	// Declared length is the cheap pre-filter; the bounded read below is
	// the one that actually holds when the request lies about it.
	const declaration = request.headers.get('content-length');
	if (declaration !== null && Number(declaration) > MAX_BODY_BYTES_SCANNED) return candidates;

	const text = await readBoundedText(request, MAX_BODY_BYTES_SCANNED);
	if (text === null || text.length === 0 || !params.some((param) => text.includes(param))) {
		return candidates;
	}
	return [...candidates, ...collectRedirectCandidatesFromBody(text, contentType, params)];
}

/**
 * Hono middleware form of the guard.
 *
 * On a rejected target: `400 { error: 'invalid_redirect_target', param,
 * reason, source }`. On an accepted (or absent) target: `next()`.
 */
export function redirectTargetGuard(
	options: RedirectGuardOptions = {},
): MiddlewareHandler<{ Bindings: Env }> {
	const params = options.params ?? REDIRECT_TARGET_PARAM_NAMES;
	return async function redirectTargetGuardMiddleware(c, next) {
		const candidates = await collectRequestRedirectCandidates(c.req.raw, params);
		const rejected = firstRejectedRedirect(candidates, {
			trustedOrigins: resolveTrustedOrigins(options, c),
			...(options.allowedPrefixes ? { allowedPrefixes: options.allowedPrefixes } : {}),
		});
		if (rejected) {
			return c.json(
				{
					error: 'invalid_redirect_target',
					param: rejected.param,
					reason: rejected.reason,
					source: rejected.source,
				},
				400,
			);
		}
		await next();
	};
}
