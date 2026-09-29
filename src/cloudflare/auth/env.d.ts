// Local augmentation for `Cloudflare.Env` so that secrets declared via
// `wrangler secret put` (which are not present in the generated
// `worker-configuration.d.ts`) are typed at compile time.
//
// The generated file declares:
//   declare namespace Cloudflare {
//     interface Env extends __BaseEnv_Env {}
//   }
//   interface Env extends __BaseEnv_Env {}
//
// We extend `Cloudflare.Env` so both the namespaced and the global
// `Env` interface pick up the new fields via re-export.
//
// Keep this list in sync with the secret names used in production.
// `.dev.vars.example` is the source of truth for local naming.
//
// See ADR-0009 §8.

declare global {
	namespace Cloudflare {
		interface Env {
			// Phase 3+ (Issue #89) — versioned 2-name contract. The
			// generated `worker-configuration.d.ts` declares
			// `BETTER_AUTH_SECRETS` (preferred) and
			// `MY_WEB_2026_CONSUMER_API_KEY`. The legacy `BETTER_AUTH_SECRET`
			// Worker binding is deleted in Phase B; it remains a
			// fallback-only reading path in
			// `src/cloudflare/auth/better-auth.ts` for backward
			// compatibility with partially-deployed states, but is NOT
			// declared in the runtime env contract.
			BETTER_AUTH_SECRETS: string;
			// Issue #171 — GA4 measurement ID. Public non-secret
			// identifier declared in `wrangler.jsonc#vars` (and the
			// production mirror). The root route loader reads this
			// during SSR and passes it to
			// `src/editorial/analytics/GoogleAnalytics.tsx`. Empty
			// string means "no GA4 wired". The Cloudflare typegen
			// generates this with `string | undefined` from the
			// `vars` block; we keep the same `string | undefined` shape
			// here so SSR reads stay total.
			GOOGLE_ANALYTICS_MEASUREMENT_ID?: string;
		}
	}
}

export {};
