import CONTRACT from './contract.json';

/**
 * Open Graph / Twitter card contract (Issue #421).
 *
 * This module is the typed view over `contract.json`. The JSON file
 * — not this TypeScript wrapper — is the single source of truth,
 * because two runtimes have to read it:
 *
 *   - the Worker / test bundle (`src/routes/**`, Vitest workerd pool)
 *     imports it as a module, and
 *   - the gates and the verification report (`scripts/*.mjs`, plain
 *     Node) read the same file with `fs`, because the report must be
 *     reproducible outside the Worker.
 *
 * A duplicated constant would let the screenshot in the PR body drift
 * away from what CI validates, which is the failure mode this Issue is
 * about.
 *
 * What this contract is NOT: a claim about any crawler's own rules.
 * `og:*` has no validation service and no "Rich Results"-style verdict.
 * The gate answers exactly one question — *does the document match the
 * declaration this repository makes?* — and the missing-media fallback
 * it makes nameable is a repository decision, not a guarantee that
 * every unfurler renders it.
 *
 * Cross-references:
 *   - `card.ts` — the composer every public surface head uses
 *   - `scripts/ogp-card-contract.mjs` — the policy engine
 *   - `test/integration/ogp-card.test.ts` — the CI gate (real SSR HTML)
 *   - `docs/verification/seo/ogp-preview.md` — reproduction
 */

/** Canonical production origin (ADR-0014). */
export const CANONICAL_ORIGIN = CONTRACT.canonicalOrigin;

/** `og:site_name` value. */
export const SITE_NAME = CONTRACT.siteName;

/** `og:locale` value — the document language is `ja` (see `__root.tsx`). */
export const SITE_LOCALE = CONTRACT.siteLocale;

/** Closed set of `og:type` values this repository is allowed to publish. */
export const OG_TYPES: readonly string[] = CONTRACT.ogTypes;

/** Closed set of `twitter:card` values this repository is allowed to publish. */
export const CARD_TYPES: readonly string[] = CONTRACT.cardTypes;

/** The site-owned card a surface falls back to when it has no media. */
export interface FallbackCard {
	/** Origin-relative path of the committed asset under `public/`. */
	readonly path: string;
	readonly width: number;
	readonly height: number;
	readonly alt: string;
	/** Script that regenerates the committed bytes (deterministic). */
	readonly generator: string;
	readonly reason: string;
}

export const FALLBACK_CARD: FallbackCard = CONTRACT.fallbackCard;

/** Absolute URL of the fallback card — the value that reaches `og:image`. */
export const FALLBACK_CARD_URL = `${CANONICAL_ORIGIN}${FALLBACK_CARD.path}`;

/**
 * Coverage status a surface may declare for the card obligation.
 *
 * `implemented` — the surface composes its card through `card.ts`, so
 * the gate evaluates the full og / twitter set against the document.
 * `not-implemented` — the surface declares that it publishes no card
 * image. It is NOT "nothing to check": the gate asserts the absence,
 * so the day a tag appears the contract has to change with it.
 */
export type SocialCardStatus = 'implemented' | 'not-implemented';

/**
 * What a surface publishes when it has no composable image of its own.
 *
 * `content-first` — publish the surface's own media URL, and the
 * fallback card when there is none.
 * `none` — publish no `og:image` at all.
 */
export type SocialCardPolicy = 'content-first' | 'none';

/** One entry of the route coverage matrix. */
export interface SocialCardRouteCoverage {
	/** Route id in router form (`/portfolio/$slug`). */
	readonly path: string;
	/** Whether the surface is visitor-facing. */
	readonly public: boolean;
	readonly status: SocialCardStatus;
	/** `og:type` the document must declare. Present when `implemented`. */
	readonly ogType?: string;
	readonly cardPolicy: SocialCardPolicy;
	/** Concrete URL the integration suite fetches. */
	readonly samplePath: string;
	/** Why this surface is (or is not) in the card contract. */
	readonly note: string;
}

/**
 * The route coverage matrix — one entry per non-admin route.
 *
 * The `as` is the same narrowing the structured-data contract makes
 * (`src/editorial/structured-data/contract.ts`): TypeScript widens a
 * JSON string to `string`, so the closed unions (`status`,
 * `cardPolicy`) have to be reasserted here. The gate keeps them honest
 * at runtime — an unknown value is a coverage error, not a silent
 * `undefined`.
 */
export const ROUTE_COVERAGE: readonly SocialCardRouteCoverage[] =
	CONTRACT.routes as SocialCardRouteCoverage[];

/**
 * Surfaces Issue #421 names but the repository does not have yet.
 *
 * Declaring them is what keeps "記事" from becoming a silent pass: the
 * coverage gate fails when a deferred surface turns into a real route,
 * at which point its entry moves into `routes` with an `ogType`.
 */
export interface DeferredSocialCardSurface {
	readonly id: string;
	readonly reason: string;
}

export const DEFERRED_SURFACES: readonly DeferredSocialCardSurface[] = CONTRACT.deferredSurfaces;

/**
 * Absolute URL for a published path.
 *
 * `path` is origin-relative by contract; a caller passing an absolute
 * URL gets it back unchanged so a caller holding a loader-derived
 * canonical does not have to know which one it has.
 */
export function socialCardUrl(path: string): string {
	return path.startsWith('http')
		? path
		: `${CANONICAL_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}
