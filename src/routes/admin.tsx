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
	component: AdminLayout,
});

function AdminLayout() {
	return <Outlet />;
}
