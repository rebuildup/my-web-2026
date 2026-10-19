/**
 * Public surface for the social-card module (Issue #421).
 *
 * Open Graph / Twitter card metadata is chrome a public surface owns
 * and publishes to link unfurlers, not a data source — the same
 * argument that puts `BreadcrumbJsonLd` and `PersonJsonLd` under
 * `src/editorial/`. The fact sources stay with their obligations:
 * `src/about/**` for identity, `src/portfolio/**` for works, and each
 * maps its own record onto the structural inputs `composeSocialCard`
 * accepts, so this module imports neither.
 *
 * Cross-references:
 *   - `contract.json` — canonical origin, fallback card, route coverage
 *   - `card.ts` — the composer
 *   - `scripts/ogp-card-contract.mjs` — the policy engine
 *   - `test/integration/ogp-card.test.ts` — the CI gate
 *   - `docs/verification/seo/ogp-preview.md` — reproduction
 */
export {
	CANONICAL_ORIGIN,
	CARD_TYPES,
	DEFERRED_SURFACES,
	FALLBACK_CARD,
	FALLBACK_CARD_URL,
	OG_TYPES,
	ROUTE_COVERAGE,
	SITE_LOCALE,
	SITE_NAME,
} from './contract';
export type {
	DeferredSocialCardSurface,
	FallbackCard,
	SocialCardPolicy,
	SocialCardRouteCoverage,
	SocialCardStatus,
} from './contract';
export {
	composeSocialCard,
	fallbackCardImage,
	resolveCardImage,
	type ResolvedCardImage,
	type SocialCard,
	type SocialCardImageInput,
	type SocialCardImageSource,
	type SocialCardInput,
	type SocialCardMetaTag,
} from './card';
