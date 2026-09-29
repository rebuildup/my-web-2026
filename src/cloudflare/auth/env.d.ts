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
			// Issue #187 — GA4 measurement ID moved from `vars` to
			// `secrets.required` (Issue #171 originally declared it
			// as a `vars` entry with `string | undefined` shape).
			// Now declared required `string` because
			// `wrangler*.jsonc#secrets.required` lists the name; the
			// placeholder (`G-PLACEHOLDER000`) is seeded into Infisical
			// at merge time and the operator replaces it with the real
			// `G-XXXXXXX` value before traffic is cut to production —
			// see `docs/runbook/analytics.md`. The placeholder string is
			// non-empty so SSR sees a populated `id` and renders the
			// `<script async>` tag; the placeholder IS the GA4 snippet
			// value sent to `gtag`, which makes the placeholder harmless
			// (GA4 just records into a non-existent property) but lets
			// the operator prove the wire-up end-to-end without a real
			// GA ID.
			GOOGLE_ANALYTICS_MEASUREMENT_ID: string;
			// Issue #166 — local API mock layer gate. When this env
			// value is `'mock'` (set in `.dev.vars`, NOT in
			// `wrangler.jsonc#vars` — production must never see this),
			// the Hono external boundary forwards `/api/v1/*` to
			// `src/http/mock/` instead of the real handlers. Optional:
			// unset in production; default behavior (env.LOCAL_API_MODE
			// !== 'mock') runs the production boundary unchanged.
			LOCAL_API_MODE?: string;
		}
	}

	// `worker-configuration.d.ts` declares both `Cloudflare.Env` (in
	// a `declare namespace Cloudflare { ... }`) and a top-level
	// `interface Env extends __BaseEnv_Env {}`. Augmenting only the
	// namespaced form does NOT propagate to the top-level `Env` that
	// every call site uses (`env: Env`); we declare the new field on
	// both surfaces so `c.env.LOCAL_API_MODE` typechecks.
	interface Env {
		LOCAL_API_MODE?: string;
		GOOGLE_ANALYTICS_MEASUREMENT_ID: string;
	}
}

export {};
