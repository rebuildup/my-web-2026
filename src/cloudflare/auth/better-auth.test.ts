import { describe, expect, it, vi } from 'vitest';

/**
 * Better Auth configuration invariants — read-only smoke tests.
 *
 * The actual Better Auth handler is opaque and depends on D1 tables
 * it manages, so we don't exercise the request / response shape
 * here. The interesting invariants are the configuration knobs that
 * other code in the project relies on:
 *
 *   - `basePath` must equal `/api/v1/auth` so the Hono router's
 *     `c.req.raw` forwarding matches Better Auth's internal route
 *     matching. Without this, every `/api/v1/auth/*` request 404s
 *     inside Better Auth.
 *
 * The module under test pulls `env` from `cloudflare:workers`; we
 * stub it with `vi.mock` to avoid the runtime requirement. The
 * Better Auth instance is constructed once at module load — the
 * stub only needs the few env keys the constructor reads.
 */

// Minimal D1 stub. Better Auth's plugin init may call `.prepare(...)`
// during module load (admin role migration lookup, API key table
// probe); we don't want those to throw unhandled rejections during
// the config-only assertions below.
const d1Stub = {
	prepare: () => ({
		bind: () => ({
			first: async () => null,
			all: async () => ({ results: [] }),
			run: async () => ({ success: true, meta: { changes: 0 } }),
		}),
		first: async () => null,
		all: async () => ({ results: [] }),
		run: async () => ({ success: true, meta: { changes: 0 } }),
	}),
	exec: async () => {},
	batch: async () => [],
};

vi.mock('cloudflare:workers', () => ({
	env: {
		DB: d1Stub as unknown as D1Database,
		BETTER_AUTH_SECRET: 'test-secret-do-not-use-in-prod-32bytes',
		BETTER_AUTH_URL: 'http://localhost:3000',
	},
}));

const betterAuthModule = await import('./better-auth');

describe('better-auth config', () => {
	it('mounts Better Auth under the project external-boundary prefix', () => {
		// Better Auth exposes the resolved config on `auth.options`.
		const options = (betterAuthModule.auth as unknown as { options: { basePath?: string } })
			.options;
		expect(options.basePath).toBe('/api/v1/auth');
	});

	it('keeps sign-up disabled (invitation-only)', () => {
		// `disableSignUp` is the project policy: open sign-up is
		// explicitly rejected. Public POSTs to /sign-up/email must
		// fail. Verified via the resolved config object.
		const options = betterAuthModule.auth as unknown as {
			options: {
				emailAndPassword?: { enabled?: boolean; disableSignUp?: boolean };
			};
		};
		expect(options.options.emailAndPassword?.enabled).toBe(true);
		expect(options.options.emailAndPassword?.disableSignUp).toBe(true);
	});
});
