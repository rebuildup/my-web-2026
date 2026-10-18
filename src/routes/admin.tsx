import { Outlet, createFileRoute } from '@tanstack/react-router';

/**
 * `/admin` — admin area path-bearing layout.
 *
 * Pure layout: no auth loader here (Issue #106 self-redirect fix).
 *
 * Auth gating lives in each child route's loader instead:
 *   /admin/login          → public; loader redirects signed-in users
 *   /admin                → admin.index.tsx loader (signed-in only)
 *   /admin/invitations    → admin.invitations.tsx loader (admin role)
 *   /admin/keys           → admin.keys.tsx loader (admin role)
 *   /admin/emoji-catalog  → admin.emoji-catalog.tsx loader (admin role)
 *   /admin/images         → admin.images.tsx loader (admin role)
 *   /admin/invitations/accept → inherits admin.invitations auth
 *
 * Why no parent loader: TanStack Router runs the parent loader before
 * the child loader, so a parent redirect would self-redirect the
 * public `/admin/login` child back to itself (307, see Issue #106).
 *
 * The initial admin-surface commit `7801d0e` (2026-09-18) shipped
 * this self-redirecting shape; it surfaced in production after the
 * Issue #99 incident recovery smoke exposed the broken
 * `/admin/login` 200 contract from `e2e/prod-smoke.spec.ts`.
 *
 * Server-fn authorization via `requireAdmin()` in the
 * `src/admin/<obligation>/load.ts` obligations is independent of
 * this route layout — that gate remains unchanged.
 */
export const Route = createFileRoute('/admin')({
	/**
	 * Non-public surface policy (Issue #418).
	 *
	 * `/admin/login` is reachable by an anonymous visitor (it is the
	 * sign-in form), so before this the admin surface rendered with the
	 * root fallback title `my-web-2026`, no robots directive and no
	 * canonical — i.e. the one admin URL a crawler can fetch was
	 * indexable and looked like the site's home page to a search
	 * engine.
	 *
	 * Declared on the LAYOUT route on purpose: TanStack merges head tags
	 * across the whole match chain, so every admin child inherits this
	 * directive and a future `/admin/*` route is covered without
	 * remembering to add it.
	 *
	 * No canonical here, deliberately: naming a canonical on an admin
	 * URL would tell a crawler that URL is the preferred version of
	 * something. The public-route head gate asserts both halves of
	 * this policy on `/admin/login`.
	 */
	head: () => ({
		meta: [{ name: 'robots', content: 'noindex, nofollow' }],
	}),
	component: AdminLayout,
});

function AdminLayout() {
	return <Outlet />;
}
