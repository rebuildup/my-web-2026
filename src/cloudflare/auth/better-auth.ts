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
 */
export const auth = betterAuth({
	database: env.DB,
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
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
	trustedOrigins: [env.BETTER_AUTH_URL],
});

export type Auth = typeof auth;
