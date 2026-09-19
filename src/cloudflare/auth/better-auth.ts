import { env } from 'cloudflare:workers';
import { apiKey } from '@better-auth/api-key';
import { admin } from 'better-auth/plugins/admin';
import { betterAuth } from 'better-auth';

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
 * per-env `env.production.vars` block.
 *
 * Better Auth 1.5+ infers `baseURL` from the incoming request when
 * unset; the project relies on inference for local development and
 * expects operators to set `BETTER_AUTH_URL` for production to pin
 * the cookie domain + `trustedOrigins`. See ADR-0009 §8 / Risks §5.
 *
 * The runtime contract is `string | undefined`. The typegen'd `Env`
 * does not declare it because we removed the fallback from
 * `wrangler.jsonc vars`; the cast below is the documented escape
 * hatch.
 */
const betterAuthUrl = (env as { BETTER_AUTH_URL?: string }).BETTER_AUTH_URL;

/**
 * Disable Better Auth's eager `checkSchema()` so the auth instance
 * remains usable across workerd test isolates whose D1 binding
 * may be empty when the auth module is first imported. The check
 * is fired at module load and caches its verdict per adapter
 * identity — a stale verdict is rethrown on every subsequent
 * `auth.api.*` call. The canonical D1 schema is owned by
 * `migrations/0001_better_auth.sql` and applied explicitly via
 * `pnpm run db:migrate:*`; Better Auth's runtime check is a
 * development aid and is not the project's source of truth.
 */
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
		apiKey({
			defaultPrefix: 'mk_',
			rateLimit: {
				enabled: true,
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
	advanced: { database: { validateSchema: false } },
});

export type Auth = typeof auth;
