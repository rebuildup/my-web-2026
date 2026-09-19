import { env } from 'cloudflare:workers';
import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins/admin';

/**
 * Better Auth instance — the project's auth foundation.
 *
 * Lives in `src/cloudflare/auth/` because:
 *
 * 1. It binds directly to the Cloudflare D1 binding via
 *    `database: env.DB` (Better Auth 1.5+); the binding is a
 *    Cloudflare runtime concern, owned by `src/cloudflare/`.
 * 2. Admin login + invitation accept flows consume it via
 *    `auth.api.*` from `src/admin/`. Hono mounts the auth handler
 *    at `/api/v1/auth/*` via `src/http/auth/router.ts`.
 *
 * See ADR-0009 for the full decision record.
 *
 * Configuration summary (full rationale in ADR-0009 §8):
 *
 * - `basePath: '/api/v1/auth'` — Better Auth strips this prefix
 *   when matching routes, so the router mounts under
 *   `/api/v1/auth/*` and Better Auth sees `/sign-in/email`,
 *   `/sign-out`, etc. **Required**: the default basePath is
 *   `/api/auth`; without this option no Better Auth route would
 *   match the project's external-boundary prefix.
 * - `emailAndPassword.disableSignUp: true` blocks the public
 *   sign-up endpoint with `EMAIL_PASSWORD_SIGN_UP_DISABLED`. The
 *   invitation accept flow (§4) uses `auth.api.createUser` via the
 *   admin plugin's `create-user` endpoint, which is independent of
 *   this gate.
 * - `session.expiresIn: 60*60*24*30` (30 days), `updateAge: 60*60*24`
 *   (24h rolling refresh) — explicit project policy, not Better Auth
 *   defaults.
 * - `admin()` plugin adds `role`, `banned`, `banReason`, `banExpires`
 *   to the `user` table and `impersonatedBy` to the `session` table.
 * - `apiKey()` plugin (separate `@better-auth/api-key` package) adds
 *   the `apikey` table; permissions are stored JSON-stringified and
 *   checked via `key.permissions[resource]?.includes(action)` in
 *   `src/http/api-keys/middleware.ts` (Ticket B).
 * - `sendEmail` is a console-log stub — no SMTP is configured in
 *   0.3.0. Real delivery is out of scope.
 *
 * Environment contract (ADR-0009 §8):
 *
 * `BETTER_AUTH_URL` is intentionally NOT pinned in `wrangler.jsonc`
 * `vars` — production must not silently inherit a localhost
 * default. Local development sets it in `.dev.vars`; production
 * supplies it via `wrangler deploy --var BETTER_AUTH_URL=...` or a
 * per-env `env.production.vars` block. Better Auth's own
 * validation raises at first sign-in request if `baseURL` is
 * missing, which is the operator-facing signal.
 *
 * The runtime contract is `string | undefined`. The typegen'd `Env`
 * does not declare it because we removed the fallback from
 * `wrangler.jsonc vars`; the cast below is the documented escape
 * hatch.
 */
const betterAuthUrl = (env as { BETTER_AUTH_URL?: string }).BETTER_AUTH_URL;

export const auth = betterAuth({
	database: env.DB,
	secret: env.BETTER_AUTH_SECRET,
	baseURL: betterAuthUrl,
	basePath: '/api/v1/auth',
	emailAndPassword: {
		enabled: true,
		disableSignUp: true,
		autoSignIn: false,
	},
	session: {
		expiresIn: 60 * 60 * 24 * 30,
		updateAge: 60 * 60 * 24,
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60,
		},
	},
	plugins: [
		admin(),
		// The @better-auth/api-key plugin's per-key rate limit is
		// **disabled** at the auth layer. ADR-0010 owns the only
		// throttle in 0.3.0: the Workers Rate Limiting binding keyed
		// by API key id, mounted per-endpoint-bucket from
		// `src/http/middleware/rate-limit.ts`. Running BOTH layers
		// in series gates the effective budget at the lower limit;
		// for the access-counter hot path that meant `60/min` for
		// both read and write (the auth-layer's 60/min hides the
		// 600/min read binding). The auth-layer check additionally
		// counts ALL requests through `auth.api.verifyApiKey`,
		// regardless of endpoint, so it cannot implement different
		// per-endpoint budgets anyway. Anti-brute-force on key
		// guessing is already covered by the hashing scheme (a
		// guessed `mk_*` string cannot be verified in bulk).
		apiKey({
			defaultPrefix: 'mk_',
			rateLimit: {
				enabled: false,
				timeWindow: 60_000,
				maxRequests: 60,
			},
		}),
	],
	sendEmail: async (payload: { to: string; subject: string; body?: string }) => {
		// 0.3.0: no SMTP. Password reset / verification emails land in
		// the worker logs and the admin uses the invitation flow
		// instead of password reset (ADR-0009 §1).
		console.log('[auth.email]', payload);
	},
	trustedOrigins: betterAuthUrl ? [betterAuthUrl] : [],
	// `checkSchema()` runs eagerly at module load and caches a per-adapter
	// verdict. In the workerd test pool, the worker module graph resolves
	// before the vitest setupFiles have had a chance to apply the
	// canonical Better Auth schema; the cached verdict then claims the
	// tables are missing even when they are present at request time.
	// We manage the schema via `migrations/0001_better_auth.sql` (and
	// follow-ups) and `wrangler d1 migrations apply`, so per-request
	// schema validation is redundant. See ADR-0009 §6 and the test
	// setup notes in `test/integration/` for the migration-driven
	// pattern.
	advanced: { database: { validateSchema: false } },
});

export type Auth = typeof auth;
