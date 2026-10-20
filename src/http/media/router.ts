import { Hono } from 'hono';
import {
	type MediaObjectSource,
	createPublicMediaDelivery,
} from '../../cloudflare/media-visibility';
import { isPublishedPortfolioMediaKey } from '../../portfolio/media-approval';
import { REACTION_IMAGE_CACHE_CONTROL, isPublicReactionImageKey } from '../reactions/images';

/**
 * Public media delivery, key-addressed (Issue #634).
 *
 * Attack and answer
 * -----------------
 * `GET /media/<key>` serves the `MEDIA` bucket through the Worker, so
 * the two gates in `src/cloudflare/media-visibility.ts` run on the
 * request path instead of being a model with no caller:
 *
 *   1. namespace — only a well-formed key under a declared public
 *      prefix is a candidate;
 *   2. approval — the owning obligation must say this particular
 *      object is published right now (a D1 row).
 *
 * Every refusal is the same 404 with no body and `no-store`. It is
 * never a 403 and never a reason code: a distinguishable answer would
 * confirm that an unapproved object exists, which is the enumeration
 * oracle this path exists to remove.
 *
 * What this route does NOT close
 * ------------------------------
 * An R2 **custom domain** attached to the bucket bypasses the Worker
 * entirely, so keys fetched from that hostname are not gated by this
 * code. Production points `MEDIA_PUBLIC_BASE_URL` at this route's
 * origin path (`https://rebuildup.dev/media`); retiring or redirecting
 * the custom domain is a Cloudflare account operation recorded as an
 * operator step in `docs/security/r2-media-visibility.md`.
 *
 * Content-type allowlist
 * ----------------------
 * The bucket is operator-written, but this route is same-origin as the
 * site: serving `text/html` from it would turn a stray object into an
 * XSS primitive. Only the media types the two producers actually write
 * are served; anything else is treated as absent (404, not 415).
 *
 * Cache behaviour
 * ---------------
 * An object's stored `cacheControl` wins. When the producer did not
 * set one, portfolio media gets a one-hour freshness window: its key
 * is not content-addressed, so unpublishing takes effect at the next
 * cache miss and never later than that hour. `reactions/` keys are
 * content-addressed (SHA-256) and get the immutable policy
 * `REACTION_IMAGE_CACHE_CONTROL` declares.
 * The external boundary's blanket `no-store` never applies because the
 * handler always sets the header.
 */

/** Media types the two producers write (`portfolio/`, `reactions/`). */
const DELIVERABLE_CONTENT_TYPES: ReadonlySet<string> = new Set([
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'image/avif',
	'video/mp4',
	'video/webm',
]);

/** Short default freshness for non-content-addressed portfolio keys. */
export const PORTFOLIO_MEDIA_CACHE_CONTROL = 'public, max-age=3600';

/**
 * Reaction keys are SHA-256 addressed; the bytes never change. The
 * value is the reactions owner's constant, not a second literal: two
 * literals that must agree are a drift risk (Issue #484).
 */
export const REACTION_MEDIA_CACHE_CONTROL = REACTION_IMAGE_CACHE_CONTROL;

export function isDeliverableMediaContentType(contentType: string): boolean {
	return DELIVERABLE_CONTENT_TYPES.has(contentType.toLowerCase().split(';')[0]?.trim() ?? '');
}

/**
 * The response cache policy for one served object. A stored decision
 * outranks the defaults, the same rule `src/server.ts` applies to
 * handler-set headers.
 */
export function mediaCacheControlFor(key: string, stored: string | null): string {
	if (stored && stored.trim().length > 0) return stored;
	return key.startsWith('reactions/')
		? REACTION_MEDIA_CACHE_CONTROL
		: PORTFOLIO_MEDIA_CACHE_CONTROL;
}

/**
 * Compose the owner approvals for one key.
 *
 * The namespace gate has already run by the time this is called, so
 * the only branches reachable with a public key are `portfolio/` and
 * `reactions/`. An unknown namespace answers false rather than
 * defaulting either way.
 */
export async function isApprovedMediaKey(db: D1Database, key: string): Promise<boolean> {
	if (key.startsWith('portfolio/')) return isPublishedPortfolioMediaKey(db, key);
	if (key.startsWith('reactions/')) return isPublicReactionImageKey(db, key);
	return false;
}

/** The refusal every gate shares: no body, no reason, never cached. */
function notFound(): Response {
	return new Response(null, {
		status: 404,
		headers: { 'cache-control': 'no-store' },
	});
}

export function createMediaRouter(): Hono<{ Bindings: Env }> {
	const router = new Hono<{ Bindings: Env }>();

	// Mounted with `.route('/', mediaRouter)`, so the sub-app declares
	// the full path (the same convention `seoRouter` / `authRouter`
	// follow on this boundary).
	router.on(['GET', 'HEAD'], '/media/:key{.+}', async (c) => {
		const key = c.req.param('key');
		const method = c.req.method === 'HEAD' ? 'HEAD' : 'GET';
		const delivery = createPublicMediaDelivery(c.env.MEDIA as MediaObjectSource, {
			isApproved: (candidate) => isApprovedMediaKey(c.env.DB, candidate),
			method,
		});
		const result = await delivery.fetch(key);
		if (result.status !== 200) return notFound();

		const contentType = result.contentType ?? '';
		if (!isDeliverableMediaContentType(contentType)) {
			// The object exists but is not servable, so its body must
			// not be left half-read: cancel rather than drop it.
			await result.body?.cancel();
			return notFound();
		}

		const headers = new Headers();
		headers.set('content-type', contentType);
		headers.set('cache-control', mediaCacheControlFor(result.key, result.cacheControl));
		headers.set('x-content-type-options', 'nosniff');
		if (result.etag) headers.set('etag', result.etag);

		if (method === 'HEAD') {
			await result.body?.cancel();
			return new Response(null, { status: 200, headers });
		}
		return new Response(result.body, { status: 200, headers });
	});

	return router;
}

export const mediaRouter = createMediaRouter();
