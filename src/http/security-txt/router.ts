import { Hono } from 'hono';
import type { SecurityTxtDocument } from './document';
import {
	SECURITY_TXT_CONTENT_TYPE,
	SECURITY_TXT_PATH,
	isSecurityTxtLive,
	renderSecurityTxt,
} from './document';
import { loadSecurityTxtPolicy } from './policy';

/**
 * `GET /.well-known/security.txt` (Issue #468).
 *
 * Why the external boundary owns this
 * -----------------------------------
 * TanStack Start 1.168 has no raw-response route primitive, so a route
 * file always renders through the document shell and cannot answer
 * with `text/plain`. This path is registered in
 * `EXTERNAL_BOUNDARY_PREFIXES` (`src/server.ts`) and mounted on
 * `externalBoundary` (`src/http/hono.ts`), exactly as
 * `src/http/seo/router.ts` owns the two sibling crawler documents.
 *
 * The HTTP contract
 * -----------------
 *   200  `text/plain; charset=utf-8`   — an approved, unexpired
 *                                          policy (RFC 9116 §3)
 *   404  `text/plain; charset=utf-8`   — no policy is published, or
 *                                          the published one has
 *                                          expired. A site that does
 *                                          not publish the file
 *                                          answers 404, which is
 *                                          what this endpoint does
 *                                          today (RFC 9116 §3.2).
 *
 * Both statuses carry the same cache policy. That is deliberate: the
 * document is a deploy-time artefact that can be APPROVED without a
 * code change, and a shared cache that kept a `404` for an hour would
 * hide the approval. Five minutes is the same freshness window the
 * sitemap uses for the same class of decision
 * (`src/http/seo/router.ts`).
 *
 * The body of the `404` states only that nothing is published. It
 * never names a contact, a mailbox or an internal note: a reader of a
 * refused document is an anonymous client, and the whole point of the
 * approval gate is that unpublished information does not leak.
 *
 * Why the router re-checks the deadline
 * -------------------------------------
 * The seam below is injectable, so the router does not trust it to
 * have applied the expiry gate: an injected source that returned a
 * stale document would publish a reporting channel that may no longer
 * be monitored, which is the exact failure RFC 9116 §2.5.1 warns
 * about. The production source (`./policy.ts`) applies the same gate,
 * so the check is redundant in production and load-bearing for every
 * future source.
 */
export const SECURITY_TXT_CACHE_CONTROL = 'public, max-age=300, must-revalidate';

/**
 * The refusal body. One line, no detail: a `404` from this endpoint
 * means "no approved policy exists", and nothing else about the
 * platform's reporting posture may be inferred from it.
 */
const UNPUBLISHED_BODY = 'no security.txt is published\n';

/**
 * Where the router reads its policy from.
 *
 * Returns the document to serve, or `null` for "nothing is
 * approved". Injected so tests can drive a policy the repository does
 * not yet have — the same DI seam `createSeoRouter` uses for the
 * project index (`src/http/seo/router.ts`).
 */
export type SecurityTxtPolicySource = () => SecurityTxtDocument | null;

/** Response headers shared by both outcomes. */
const RESPONSE_HEADERS = Object.freeze({
	'content-type': SECURITY_TXT_CONTENT_TYPE,
	'cache-control': SECURITY_TXT_CACHE_CONTROL,
});

/**
 * Factory (DI seam). `loadPolicy` defaults to the repo-controlled
 * manifest bound in `./policy.ts`; `now` defaults to the wall clock so
 * the deadline is evaluated per request instead of at module load.
 */
export function createSecurityTxtRouter(
	loadPolicy: SecurityTxtPolicySource = () => loadSecurityTxtPolicy(),
	now: () => number = () => Date.now(),
): Hono<{ Bindings: Env }> {
	const router = new Hono<{ Bindings: Env }>();

	router.get(SECURITY_TXT_PATH, (c) => {
		const document = loadPolicy();
		if (document === null || !isSecurityTxtLive(document, now())) {
			return c.body(UNPUBLISHED_BODY, 404, { ...RESPONSE_HEADERS });
		}
		return c.body(renderSecurityTxt(document), 200, { ...RESPONSE_HEADERS });
	});

	return router;
}

/** Production wiring: the repo-controlled manifest, gated as described above. */
export const securityTxtRouter = createSecurityTxtRouter();
