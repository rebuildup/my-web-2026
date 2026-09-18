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
			BETTER_AUTH_SECRET: string;
		}
	}
}

export {};
