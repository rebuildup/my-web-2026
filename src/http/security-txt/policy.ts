import type { SecurityTxtDocument } from './document';
import manifestJson from './policy.json' with { type: 'json' };
import {
	type PublicationDecision,
	type SecurityTxtManifest,
	parseSecurityTxtManifest,
	resolvePublication,
} from './schema';

/**
 * The bound `security.txt` policy: the repo-controlled manifest, parsed
 * once, and the publication decision derived from it on request
 * (Issue #468).
 *
 * Why a module-evaluation parse
 * -----------------------------
 * `src/contact/public.ts` makes the same decision for the same reason:
 * a malformed `channels.json` must fail the Worker boot rather than
 * render an empty contact list. Here the malformed case would be worse
 * — a `security.txt` with no `Expires` line is not a degraded
 * document, it is an invalid one, and it would be served to strangers
 * as the platform's reporting policy. So `policy.json` is parsed at
 * import time and a failure throws.
 *
 * Why the decision is per-request rather than computed once
 * ---------------------------------------------------------
 * `Expires` is a deadline, not a constant. A decision cached at module
 * evaluation would keep serving a document for the lifetime of the
 * isolate after its deadline passed; resolving per request (with the
 * clock injected by the router) means an expired policy stops being
 * published on the very next request, with no deploy in between.
 */

/** The validated manifest. Throws at module evaluation if malformed. */
export const SECURITY_TXT_MANIFEST: SecurityTxtManifest = parseSecurityTxtManifest(manifestJson);

/**
 * The document to serve right now, or `null` when the gate is closed.
 *
 * `null` is the whole answer for `pending` / `rejected` /
 * `expired`; the caller renders a `404`. {@link resolveSecurityTxt}
 * additionally returns the reason for anyone who needs it (the tests,
 * and this module's own documentation).
 */
export function resolveSecurityTxt(now: number = Date.now()): PublicationDecision {
	return resolvePublication(SECURITY_TXT_MANIFEST, now);
}

/**
 * Convenience seam for the router: the live document, or `null`.
 *
 * Kept separate from {@link resolveSecurityTxt} so the router's
 * dependency is one value (`SecurityTxtDocument | null`) and cannot
 * accidentally branch on a reason string.
 */
export function loadSecurityTxtPolicy(now: number = Date.now()): SecurityTxtDocument | null {
	const decision = resolveSecurityTxt(now);
	return decision.state === 'published' ? decision.document : null;
}
