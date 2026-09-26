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
 *   the current auth surface. Real delivery is out of scope.
 *
 * Environment contract (ADR-0009 §8 + ADR-0014):
 *
 * `BETTER_AUTH_URL` is intentionally NOT pinned at the top-level
 * `wrangler.jsonc vars` — production must not silently inherit a
 * localhost default. Local development sets it in `.dev.vars`;
 * production pins it in the companion file `wrangler.production.jsonc`
 * (see ADR-0014 / Issue #43) as `https://rebuildup.dev`. Canonical production
 * delivery runs from GitHub Actions after the main CI gate; the local
 * `pnpm run deploy:production` command is a debugging fallback. The companion file exists because
 * `env.production` inside `wrangler.jsonc` breaks the typegen for the
 * default env.
 *
 * Better Auth's own validation raises at first sign-in request if
 * `baseURL` is missing, which is the operator-facing signal.
 *
 * The runtime contract is `string | undefined`. The typegen'd `Env`
 * does not declare it because the top-level `vars` block omits it;
 * the cast below is the documented escape hatch. wrangler injects
 * the production-only var into the runtime `env` at deploy time even
 * though the default-env typegen does not enumerate it, so the cast
 * still works.
 */
const betterAuthUrl = (env as { BETTER_AUTH_URL?: string }).BETTER_AUTH_URL;

// ADR-0015 §11.2 Better Auth versioned rotation contract:
// `BETTER_AUTH_SECRETS` (preferred) takes comma-separated `version:value`
// pairs in highest-version-first order (the first entry is the active
// signing key; later entries are decryption-only for in-flight cookies).
// Format example: `BETTER_AUTH_SECRETS=2:<new-secret>,1:<old-secret>`.
// Falls back to `BETTER_AUTH_SECRET` (legacy single form) when
// `BETTER_AUTH_SECRETS` is unset, so the Phase 1 → Phase 2 transition can
// keep existing Cloudflare secret bindings working until the new env var
// is seeded. Phase 3 will register `BETTER_AUTH_SECRETS` in
// `wrangler.jsonc#secrets.required` and regenerate the `Env` type via
// `pnpm run cf-typegen`; until then the cast below keeps
// `verbatimModuleSyntax: true` happy without a value import.
type SecretEntry = { version: number; value: string };

export function parseVersionedSecrets(raw: string): SecretEntry[] {
	// Split without `.filter(Boolean)` so empty segments (e.g. "2:new,,1:old"
	// or a trailing comma) are surfaced as errors instead of silently
	// dropped — silently dropping would let a broken rotation binding pass
	// while still leaving the operator thinking the new key was applied.
	const entries = raw.split(',').map((s) => s.trim());
	if (entries.length === 0 || raw.trim().length === 0) {
		throw new Error(
			'BETTER_AUTH_SECRETS is empty. Expected comma-separated "version:value" pairs (e.g. "2:<new-secret>,1:<old-secret>").',
		);
	}
	const parsed: SecretEntry[] = entries.map((entry, idx) => {
		if (entry.length === 0) {
			throw new Error(`BETTER_AUTH_SECRETS entry #${idx} is empty (extra or trailing comma?).`);
		}
		const colonIdx = entry.indexOf(':');
		if (colonIdx === -1) {
			// Error messages deliberately omit the raw entry: it may carry the
			// secret itself, and the project invariant forbids leaking secrets
			// to argv / logs / errors.
			throw new Error(
				`BETTER_AUTH_SECRETS entry #${idx} is missing ':' separator. Expected "version:value".`,
			);
		}
		const versionStr = entry.slice(0, colonIdx);
		const value = entry.slice(colonIdx + 1);
		if (!/^\d+$/.test(versionStr)) {
			throw new Error(
				`BETTER_AUTH_SECRETS entry #${idx} has invalid version (decimal digits only).`,
			);
		}
		const version = Number(versionStr);
		if (!Number.isSafeInteger(version) || version <= 0) {
			throw new Error(
				`BETTER_AUTH_SECRETS entry #${idx} has invalid version (positive safe integer).`,
			);
		}
		if (value.length === 0) {
			throw new Error(`BETTER_AUTH_SECRETS entry #${idx} has empty value.`);
		}
		return { version, value };
	});

	// Cross-entry invariants: the first entry is the current signing key in
	// Better Auth 1.5+. If versions are not strictly descending (or duplicate),
	// an older key could end up as the "current" one and silently sign new
	// cookies / tokens.
	const seenVersions = new Set<number>();
	for (let idx = 0; idx < parsed.length; idx += 1) {
		const version = parsed[idx]?.version;
		if (version === undefined) {
			continue;
		}
		if (seenVersions.has(version)) {
			throw new Error(
				'BETTER_AUTH_SECRETS has duplicate version (entries must have unique versions).',
			);
		}
		seenVersions.add(version);
	}
	for (let idx = 1; idx < parsed.length; idx += 1) {
		const prev = parsed[idx - 1];
		const cur = parsed[idx];
		if (!prev || !cur) {
			continue;
		}
		if (cur.version >= prev.version) {
			throw new Error(
				'BETTER_AUTH_SECRETS entries must be in strictly descending order (first entry is the current signing key).',
			);
		}
	}
	return parsed;
}

/**
 * Resolve the secret inputs from the worker `env` (or any compatible
 * `Record<string, unknown>`) into the shape Better Auth 1.5+ accepts.
 *
 * Routing rules (ADR-0015 §11.2):
 *   - `BETTER_AUTH_SECRETS` present (any value, including empty string)
 *     → parse via `parseVersionedSecrets`; surface the resulting array.
 *     An empty / malformed value throws — silently falling back to the
 *     legacy secret would let a broken rotation binding pass.
 *   - `BETTER_AUTH_SECRETS` absent → fall back to `BETTER_AUTH_SECRET`
 *     (legacy single form) for backward compatibility with Phase 1 →
 *     Phase 2 deploys.
 *
 * Both unset → both return fields are undefined, and Better Auth's own
 * validation surfaces the missing-secret failure (the exact module-load
 * vs request-time surface is version-dependent; documented at the
 * `auth` call site below).
 *
 * This function is a pure DI seam so tests can inject arbitrary env
 * values without depending on the workerd test pool's vi.mock gap
 * (memory `workerd-vitest-mock-gap`). The production `auth` call site
 * passes the real worker env; tests pass mock objects.
 */
export function resolveAuthSecrets(envRecord: Record<string, unknown>): {
	versionedSecrets?: SecretEntry[];
	legacySecret?: string;
} {
	const betterAuthSecretsConfigured = 'BETTER_AUTH_SECRETS' in envRecord;
	const betterAuthSecretsEnv = betterAuthSecretsConfigured
		? (envRecord.BETTER_AUTH_SECRETS as string | undefined)
		: undefined;
	const betterAuthLegacySecret = (envRecord.BETTER_AUTH_SECRET as string | undefined) ?? undefined;

	let versionedSecrets: SecretEntry[] | undefined;
	let legacySecret: string | undefined;

	if (betterAuthSecretsConfigured) {
		versionedSecrets = parseVersionedSecrets(betterAuthSecretsEnv ?? '');
	}
	if (betterAuthLegacySecret) {
		legacySecret = betterAuthLegacySecret;
	}
	return { versionedSecrets, legacySecret };
}

// Cast through `unknown` because the typegen'd `Env` does not have an
// index signature (only declared bindings are enumerated). Going directly
// to `Record<string, unknown>` triggers TS2352 (neither type sufficiently
// overlaps with the other).
const { versionedSecrets, legacySecret } = resolveAuthSecrets(
	env as unknown as Record<string, unknown>,
);

export const auth = betterAuth({
	database: env.DB,
	// Better Auth 1.5+ accepts `secrets` (versioned array) and `secret`
	// (legacy single string) as independent options. When both are set,
	// `secrets` is authoritative for new encryption/signing; `secret` is
	// a fallback for data that predates the envelope format.
	...(versionedSecrets ? { secrets: versionedSecrets } : {}),
	...(legacySecret ? { secret: legacySecret } : {}),
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
		// throttle: the Workers Rate Limiting binding keyed
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
		// No SMTP is configured. Password reset / verification emails land in
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
