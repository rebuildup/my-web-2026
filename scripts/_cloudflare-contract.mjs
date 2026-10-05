/**
 * Non-secret production / runtime contract (Issue #247, cleanup slice).
 *
 * Split from `_cloudflare-identity.mjs` on purpose:
 *
 *   - `_cloudflare-identity.mjs` answers "which Cloudflare resources
 *     does this repository own?" — account, Worker, database, bucket,
 *     local persistence paths. Those are stable for the life of the
 *     resource.
 *   - this module answers "what does the runtime REQUIRE?" — which
 *     secret NAMES must exist on the Worker, which names are retained
 *     for audit but must never be uploaded, and which non-secret
 *     production values are pinned (the canonical origin, the public
 *     media origin).
 *
 * Why a module and not a JSON file
 * --------------------------------
 * The consumer set spans TypeScript and plain Node: `cloudflare.config.ts`
 * imports it, and dozens of `.mjs` scripts and Playwright specs import it.
 * A module is loadable from both with no parser, no `readFileSync`, and
 * no schema to keep in sync. A JSON file would force the TS side to
 * import JSON and the scripts to parse it, and would introduce a SECOND
 * config format — exactly the shape the migration is removing.
 *
 * This is a shared constant, not a second Worker config.
 * `cloudflare.config.ts` remains the sole Worker configuration SoT: it
 * declares the actual bindings, and it derives their NAMES from here so
 * a name can never drift between the config and the deploy-time gate.
 *
 * NO SECRET VALUES BELONG HERE. Only names and non-secret identifiers.
 * Values live in Infisical (ADR-0015 §6) and reach the Worker through
 * the deploy-time secrets file. A value in this module would be a
 * committed credential.
 *
 * The Workers Builds trigger UUID is deliberately ABSENT. It is mutable
 * external state that is discovered, not a contract this repository
 * declares — see the discovery logic in `infisical-bootstrap-cf.mjs`.
 */

/**
 * Runtime secret names, named so call sites read as prose rather than
 * as string literals. A name appears exactly once in the codebase.
 */
export const WORKER_RUNTIME_SECRET = Object.freeze({
	/** Versioned 2-name `1:<plaintext>` form (Issue #89). */
	BETTER_AUTH_SECRETS: 'BETTER_AUTH_SECRETS',
	/** Home consumer API key, rotated by `rotate-home-api-key.mjs`. */
	CONSUMER_API_KEY: 'MY_WEB_2026_CONSUMER_API_KEY',
	/**
	 * GA4 measurement ID (Issue #187). A public identifier, but managed
	 * from the Infisical dashboard as a runtime secret so the operator
	 * can set it without a deploy. The placeholder `G-PLACEHOLDER000`
	 * is seeded at merge time; the operator replaces it before cutting
	 * traffic — see `docs/runbook/analytics.md`.
	 */
	GA_MEASUREMENT_ID: 'GOOGLE_ANALYTICS_MEASUREMENT_ID',
});

/**
 * The next deploy's required-secret set — NOT a claim about the live
 * Worker binding state. The two are independent facts:
 *
 *   - this array: the source-controlled desired contract
 *   - the live Worker: changes only via the operator-gated
 *     `phase-3-plus-prod-flip.mjs`, sequenced per
 *     `docs/runbook/cloudflare-workers-builds.md`
 *
 * The generated Build Output is the deployed truth, and
 * `check-cloudflare-contract.mjs` compares it against this array.
 */
export const REQUIRED_RUNTIME_SECRETS = Object.freeze([
	WORKER_RUNTIME_SECRET.BETTER_AUTH_SECRETS,
	WORKER_RUNTIME_SECRET.CONSUMER_API_KEY,
	WORKER_RUNTIME_SECRET.GA_MEASUREMENT_ID,
]);

/**
 * Audit-only names: retained in Infisical prod as a recovery trail
 * (ADR-0015 §9), never uploaded to the Worker.
 *
 * If `infisical run` injects one into `process.env`, the deploy path
 * removes it from the sanitized env AND MUST NOT include it in
 * `secrets.json` — that is the "legacy binding resurrects on next
 * deploy" failure mode. `BETTER_AUTH_SECRET` must be absent from the
 * Build Output; the contract check enforces that.
 */
export const AUDIT_ONLY_SECRETS = Object.freeze(['BETTER_AUTH_SECRET']);

/**
 * Canonical production origin (ADR-0014, Issue #43).
 *
 * The bare hostname. Home, Admin, and `/api/v1/*` all serve from it.
 * `*.workers.dev` is debug / infrastructure only and must never appear
 * in ADRs, READMEs, user-facing copy, or example URLs.
 */
export const PRODUCTION_CUSTOM_DOMAIN = 'rebuildup.dev';

/** `BETTER_AUTH_URL` pins the cookie domain and Better Auth `trustedOrigins`. */
export const PRODUCTION_BETTER_AUTH_URL = `https://${PRODUCTION_CUSTOM_DOMAIN}`;

/**
 * Public R2 custom domain for portfolio media (Issue #77 Decision 5).
 *
 * Media is served directly from R2 rather than through the Worker:
 * zero Worker request cost per image, full CDN cacheability, direct OGP
 * crawlers, natural srcset. The DNS record is attached at the bucket
 * level. Until that attachment is live, `composeMediaUrl` returns `null`
 * and the UI placeholder branch is exercised.
 */
export const PRODUCTION_MEDIA_PUBLIC_BASE_URL = 'https://media.rebuildup.dev';

/** Cloudflare zone for the canonical production domain (verified 2026-09-20). */
export const PRODUCTION_ZONE_ID = '7dde90c8a7be8a304300daa719a7de0a';

/**
 * Per-consumer-principal rate-limit bindings (ADR-0010).
 *
 * These are the runtime's only rate-limit layer; the Better Auth
 * api-key plugin's per-key limit is disabled because two layers would
 * gate on the lower budget.
 */
export const RATE_LIMIT_BINDING = Object.freeze({
	WRITE: 'RATE_LIMIT_WRITE',
	READ: 'RATE_LIMIT_READ',
});

export const RATE_LIMIT_NAMESPACES = Object.freeze({
	[RATE_LIMIT_BINDING.WRITE]: '00000000000000000000000000000001',
	[RATE_LIMIT_BINDING.READ]: '00000000000000000000000000000002',
});

export const RATE_LIMITS = Object.freeze({
	[RATE_LIMIT_BINDING.WRITE]: Object.freeze({ limit: 60, period: 60 }),
	[RATE_LIMIT_BINDING.READ]: Object.freeze({ limit: 600, period: 60 }),
});
