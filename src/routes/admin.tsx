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
	// Index boundary (Issue #423). The admin subtree must never appear
	// in a search index, and `robots.txt` cannot deliver that: a
	// `Disallow` stops the crawler before it fetches the document, so
	// the URL is dropped from the CRAWL, not from the INDEX (Google
	// then reports it as "Indexed, though blocked by robots.txt"). The
	// page itself has to say so, and the whole subtree is one layout
	// route — TanStack Router merges `head().meta` along the matched
	// route chain (child wins on attribute collision, see
	// `buildTagsFromMatches` in `@tanstack/react-router`), so this one
	// declaration covers `/admin`, `/admin/login`, `/admin/keys`,
	// `/admin/images`, `/admin/invitations`,
	// `/admin/invitations/accept` and `/admin/emoji-catalog`.
	//
	// `nofollow` alongside `noindex` keeps an authenticated admin page
	// from lending link equity to whatever it renders.
	//
	// This is NOT access control and does not replace one: the gate is
	// still `requireAdmin()` in the child loaders / server functions
	// (`src/admin/auth/require-admin.ts`). Keeping the subtree
	// crawlable costs a crawl of `/admin/login` and the redirects in
	// front of every gated child; the alternative — a `Disallow` — buys
	// that budget at the price of never being able to de-index the URL,
	// which is the whole failure `scripts/_index-boundary.mjs` exists to
	// prevent. That trade is the contract's, and the `noindex-blocked`
	// violation fails the build if the two are ever paired.
	head: () => ({
		meta: [{ name: 'robots', content: 'noindex, nofollow' }],
	}),
	component: AdminLayout,
});

function AdminLayout() {
	return <Outlet />;
}
