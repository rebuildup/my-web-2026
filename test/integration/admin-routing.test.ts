/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Admin routing regression (Issue #106).
 *
 * Pre-fix: `/admin/login` 307-self-redirected because the parent
 * `/admin` loader ran before any child loader and threw
 * `redirect({ to: '/admin/login' })` for unauthenticated requests.
 * TanStack Router runs the parent loader first, so the login URL
 * was never reachable for anonymous clients.
 *
 * Post-fix: `/admin` is a pure layout (no loader); the dashboard
 * lives at `/admin` via the new index child `admin.index.tsx`,
 * `/admin/login` is its own public child with a `redirect-if-signed-in`
 * loader, and the protected children (`/admin/keys`, etc.) carry
 * their own session + role guards in their loaders. The parent
 * loader no longer fires an auth-gating redirect.
 *
 * These tests exercise the parent/child loader chain end-to-end
 * via `SELF.fetch`, which routes through the same TanStack Start
 * SSR pipeline production hits. They are the only test layer that
 * catches the parent-vs-child loader ordering invariant — a unit
 * test on the child loader alone would pass under the bug.
 *
 * Scope: anonymous surfaces only. The "signed-in user visits
 * `/admin/login`" branch is covered by the production e2e
 * (`e2e/prod-smoke.spec.ts`): operator manual sign-in, not
 * automated (no seeded credentials in workerd).
 */
async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('admin routing (Issue #106)', () => {
	it('GET /admin/login returns 200 HTML with the sign-in form (anonymous)', async () => {
		// Regression: this previously returned 307 to /admin/login
		// because the parent /admin loader auth-gated the
		// unauthenticated request and TanStack Router ran the parent
		// loader before the child loader. With the layout split
		// (`admin.tsx` as <Outlet/>, dashboard moved to
		// `admin.index.tsx`) the parent loader no longer redirects,
		// so the child loader can run and render the form.
		const res = await SELF.fetch('https://example.com/admin/login', { redirect: 'manual' });
		expect(res.status).toBe(200);
		const html = await res.text();
		// The form is rendered with the canonical Better Auth
		// POST target + email + password inputs. These three
		// assertions match `e2e/prod-smoke.spec.ts`'s
		// `/admin/login` smoke shape so a pre-existing post-fix
		// contract is doubly guarded (workerd local AND live prod).
		expect(html).toContain('action="/api/v1/auth/sign-in/email"');
		expect(html).toMatch(/<input[^>]+type="email"/);
		expect(html).toMatch(/<input[^>]+type="password"/);
	});

	it('GET /admin/login/ (trailing slash) does not 307-self-redirect', async () => {
		// Pre-fix, BOTH `/admin/login` and `/admin/login/` 307-self-
		// redirected (location header pointed to the same URL — the
		// request URL was unchanged, so the canonicalize redirect
		// would loop forever in a browser and curl with `-L` would
		// hit the cap).
		// Post-fix, the trailing-slash variant may canonicalize to
		// the slash-less form (`/admin/login` — TanStack Router
		// default trailing-slash policy); that 307's `location`
		// DIFFERS from the request URL, so a following GET lands on
		// 200 HTML.
		// Either direct 200 or canonicalize-307 with a slash-less
		// target is acceptable. What is NOT acceptable is a
		// location header identical to the request URL (the
		// original 307-self bug).
		const res = await SELF.fetch('https://example.com/admin/login/', { redirect: 'manual' });
		if (res.status === 307) {
			const loc = res.headers.get('location') ?? '';
			// Resolve against the request URL so an absolute-URL
			// Location (e.g. `https://example.com/admin/login/`) is
			// still detected as a self-redirect — string equality on
			// the raw header would let that slip through. (CodeRabbit
			// nitpick, 2026-09-27.)
			const target = new URL(loc, 'https://example.com/admin/login/');
			expect(target.pathname).not.toBe('/admin/login/');
			// Canonicalize target is the slash-less form.
			expect(target.pathname).toBe('/admin/login');
		} else {
			expect(res.status).toBe(200);
		}
	});

	it('GET /admin still redirects unauthenticated requests to /admin/login', async () => {
		// Removing the parent loader must NOT weaken the dashboard
		// gate: anonymous `/admin` still ends up at `/admin/login`.
		// The dashboard auth guard now lives in `admin.index.tsx`,
		// which TanStack Router runs as the deepest matched loader
		// for `/admin` exactly. This test confirms the gate still
		// fires after the move.
		const res = await SELF.fetch('https://example.com/admin', { redirect: 'manual' });
		expect(res.status).toBeGreaterThanOrEqual(300);
		expect(res.status).toBeLessThan(400);
		expect(res.headers.get('location')).toContain('/admin/login');
	});

	it('GET /admin/keys still redirects unauthenticated requests to /admin/login', async () => {
		// Protected child loaders carry their own session + role
		// guard. Removing the parent redirect must NOT bypass them:
		// each protected child is the gate, not the parent layout.
		const res = await SELF.fetch('https://example.com/admin/keys', { redirect: 'manual' });
		expect(res.status).toBeGreaterThanOrEqual(300);
		expect(res.status).toBeLessThan(400);
		expect(res.headers.get('location')).toContain('/admin/login');
	});

	it('GET /admin/emoji-catalog still redirects unauthenticated requests to /admin/login', async () => {
		const res = await SELF.fetch('https://example.com/admin/emoji-catalog', {
			redirect: 'manual',
		});
		expect(res.status).toBeGreaterThanOrEqual(300);
		expect(res.status).toBeLessThan(400);
		expect(res.headers.get('location')).toContain('/admin/login');
	});
	it('GET /admin/invitations/accept reaches the valid-token form anonymously', async () => {
		const token = 'route-valid-token-aaaaaaaaaaaaaaaa';
		const id = 'inv-route-valid';
		const email = 'route-valid@test.local';
		const tokenHash = await sha256Hex(token);
		await env.DB.prepare(
			`INSERT INTO auth_invitation
				(id, email, token_hash, invited_by, expires_at, consumed_at, created_at)
			 VALUES (?, ?, ?, ?, ?, NULL, ?)`,
		)
			.bind(id, email, tokenHash, 'admin-id', Date.now() + 60_000, Date.now())
			.run();

		try {
			const res = await SELF.fetch(
				`https://example.com/admin/invitations/accept?token=${encodeURIComponent(token)}`,
				{ redirect: 'manual' },
			);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain(email);
			expect(html).toContain('Create account');
			expect(html).toMatch(/<input[^>]+name="password"/);
		} finally {
			await env.DB.prepare('DELETE FROM auth_invitation WHERE id = ?').bind(id).run();
		}
	});

	it('GET /admin/invitations remains admin-only after accept-route unnesting', async () => {
		const res = await SELF.fetch('https://example.com/admin/invitations', { redirect: 'manual' });
		expect(res.status).toBeGreaterThanOrEqual(300);
		expect(res.status).toBeLessThan(400);
		expect(res.headers.get('location')).toContain('/admin/login');
	});

});
