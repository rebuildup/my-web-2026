/**
 * Admin path classification (Issue #654, Issue #700).
 *
 * Why this module exists
 * ----------------------
 * Two request-path decisions must agree with the router:
 *
 *   - `src/server.ts#applyHtmlCachePolicy` answers an Admin document
 *     with `no-store`, from the path alone;
 *   - `classifySurface` in the anomaly monitor counts Admin traffic
 *     under the watched `admin` surface.
 *
 * They used to compare the raw pathname case-sensitively, each with
 * its own copy of the rule. `/ADMIN/KEYS` then rendered the admin
 * screen while receiving the generic HTML cache policy and being
 * counted as unclassified. One owner for the rule is what makes those
 * two answers impossible to drift apart.
 *
 * Where the rule lives
 * --------------------
 * The rule itself — how a request path is READ (percent-decode, then
 * case-fold) and what "inside a namespace" means — is owned by
 * `src/i18n/router-path.ts` (Issue #700). It is URL text policy, and
 * it is a leaf obligation, so the analytics mount gate in
 * `src/editorial/analytics/consent.ts` can obey the same rule without
 * this boundary being its dependency (`editorial` may not import
 * `http`, AGENTS.md §3).
 *
 * This module stays the HTTP boundary's own vocabulary: the Admin
 * surface is a boundary concept (cache policy + anomaly surface), and
 * the boundary names it in its own terms.
 */

import { ADMIN_SURFACE_NAMESPACE, isPathInNamespace } from '../i18n/router-path';

/**
 * Does this request path resolve to the Admin surface?
 *
 * Accepts the raw pathname (`new URL(request.url).pathname`), i.e. the
 * value both call sites already hold.
 */
export function isAdminPath(pathname: string): boolean {
	return isPathInNamespace(pathname, ADMIN_SURFACE_NAMESPACE);
}
