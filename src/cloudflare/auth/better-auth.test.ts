import { describe, expect, it, vi } from 'vitest';
import { resolveAuthSecrets } from './better-auth';

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
 * The secret-routing contract (ADR-0015 §11.2) is tested against the
 * DI seam `resolveAuthSecrets(env)` rather than spying on `betterAuth(...)`
 * itself. The workerd test pool does not intercept `vi.mock` for regular
 * TS modules (see memory `workerd-vitest-mock-gap`), so a `vi.mock` of
 * `better-auth` cannot observe the call. Asserting on `resolveAuthSecrets`
 * is equivalent for the contract: it is the only code path that picks
 * `BETTER_AUTH_SECRETS` vs `BETTER_AUTH_SECRET`, and Better Auth
 * receives its result through a 1-line spread (visually verifiable).
 *
 * The remaining `auth.options.*` assertions use a stubbed
 * `cloudflare:workers` env so the Better Auth constructor can run; the
 * stub is the minimum needed (D1 + `BETTER_AUTH_URL`) and the secret
 * vars are left unset because `resolveAuthSecrets` returns
 * `{ versionedSecrets: undefined, legacySecret: undefined }` for both
 * unset, and Better Auth's own validation will not raise until first
 * request. The legacy-fallback contract is tested at the DI seam so
 * the cloudflare:workers env doesn't need a secret binding here.
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

// ADR-0015 §11.2: when `BETTER_AUTH_SECRETS` is unset, `BETTER_AUTH_SECRET`
// (legacy single form) provides the only secret input. We assert the
// contract via `resolveAuthSecrets`, the DI seam used at the production
// `betterAuth({...})` call site (CodeRabbit flagged the previous
// "module-load success" assertion as insufficient — Better Auth permits
// a default secret in test environments, which would make module load
// succeed even when `BETTER_AUTH_SECRET` was dropped on the floor: see
// `PRRT_kwDOUW6FgM6mQRuq`).
describe('better-auth secret routing (DI seam: resolveAuthSecrets)', () => {
	it('routes BETTER_AUTH_SECRET to legacySecret when BETTER_AUTH_SECRETS is unset', () => {
		const result = resolveAuthSecrets({
			BETTER_AUTH_SECRET: 'test-secret-do-not-use-in-prod-32bytes',
		});
		expect(result.legacySecret).toBe('test-secret-do-not-use-in-prod-32bytes');
		expect(result.versionedSecrets).toBeUndefined();
	});

	it('routes BETTER_AUTH_SECRETS to versionedSecrets; both env vars are propagated when both are set', () => {
		// Better Auth 1.5+ accepts `secrets` (versioned array) AND
		// `secret` (legacy single string) as independent options. When
		// both are set, `secrets` is authoritative for new
		// encryption/signing and `secret` is a fallback for data
		// predating the envelope format. `resolveAuthSecrets`
		// therefore propagates both rather than dropping the legacy
		// one — see `better-auth.ts` (the `secrets` / `secret` spread
		// comments) for the full rationale.
		const result = resolveAuthSecrets({
			BETTER_AUTH_SECRETS: '2:new-secret,1:old-secret',
			BETTER_AUTH_SECRET: 'legacy-fallback-for-pre-envelope-data',
		});
		expect(result.versionedSecrets).toEqual([
			{ version: 2, value: 'new-secret' },
			{ version: 1, value: 'old-secret' },
		]);
		expect(result.legacySecret).toBe('legacy-fallback-for-pre-envelope-data');
	});

	it('returns undefined for both fields when neither env var is set', () => {
		const result = resolveAuthSecrets({});
		expect(result.versionedSecrets).toBeUndefined();
		expect(result.legacySecret).toBeUndefined();
	});

	it('surfaces parse errors from BETTER_AUTH_SECRETS rather than silently falling back', () => {
		// A malformed BETTER_AUTH_SECRETS value (e.g. operator typo)
		// must throw rather than drop to the legacy form — silently
		// falling back would let a broken rotation binding pass.
		expect(() => resolveAuthSecrets({ BETTER_AUTH_SECRETS: 'bad-no-colon' })).toThrow();
	});
});
