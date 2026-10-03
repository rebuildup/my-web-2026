/**
 * About — type surface.
 *
 * The `/about` page is **narrative-led**: identity → interests →
 * experience → current → future. The narrative copy
 * (`identity`, `interests`, `current`, `future`, `externalHandles`)
 * lives in `src/about/data.ts` as the repo-controlled source of
 * truth. The `experience` subset is a curated list of `PortfolioProject`
 * slugs that resolves through `src/portfolio/load.ts` so the public
 * visibility boundary enforced there is preserved by construction.
 *
 * Cross-references:
 *   - `docs/decisions/about-cv-contact.md` — surface decision.
 *   - `docs/personal/domain.md` §11 narrative invariants (no
 *     fabricated affordances, no skill percentages, no current
 *     metrics as current value).
 *   - ADR-0008 obligation-oriented — `about` is its own obligation;
 *     it does not import from `home`, `routes`, `http`, or
 *     `cloudflare` (enforced by `scripts/check-architecture.mjs`).
 */

import type { PortfolioProject } from '../portfolio/schema';

/**
 * Identity cluster — name, current handle, current role, and the
 * canonical external handle list. Rendered as the page hero so
 * visitors land on "who is this person" within the first viewport.
 *
 * `name` and `handles` are required fields; the page fails to load
 * if either is missing rather than degrading silently. The visitor
 * page is fail-closed (decision §「How to apply」).
 */
export interface AboutIdentity {
	readonly name: string;
	readonly handle: string;
	readonly role: string;
	readonly lead: string;
	readonly secondary: string | null;
}

/**
 * An interest throughline — the conceptual spine that connects
 * portfolio items. The page renders each throughline as a single
 * line so the visitor can see *why* the projects sit next to
 * each other in the experience section below.
 */
export interface AboutInterest {
	readonly title: string;
	readonly description: string;
}

/**
 * A single external handle (finds-me-elsewhere footer).
 *
 * `href` MUST be absolute — the footer is the canonical "this is
 * where else I am reachable" surface, and a relative href would
 * resolve under `https://rebuildup.dev/...`, which is wrong.
 */
export interface AboutExternalHandle {
	readonly label: string;
	readonly href: string;
}

/**
 * Repo-controlled narrative copy. Lives in `data.ts`; types here.
 * `experienceSlugs` is the ordered narrative subset of portfolio
 * projects. Order is narrative (the order in which the visitor
 * should read them), NOT the canonical sort order produced by
 * `listPortfolioProjects`. The loader resolves each slug to a
 * `PortfolioProject` and discards slugs that are no longer public.
 */
export interface AboutData {
	readonly identity: AboutIdentity;
	readonly interests: readonly AboutInterest[];
	readonly experienceSlugs: readonly string[];
	readonly current: readonly string[];
	readonly future: {
		readonly active: readonly string[];
		readonly parked: readonly string[];
	};
	readonly externalHandles: readonly AboutExternalHandle[];
}

/**
 * Full about snapshot returned to the route. `experience` is the
 * `PortfolioProject[]` resolved from `experienceSlugs` in narrative
 * order; slugs that resolve to `null` (unpublished / unknown) are
 * silently dropped — the visitor page must not surface affordances
 * the data layer no longer backs.
 */
export interface AboutPageData {
	readonly identity: AboutIdentity;
	readonly interests: readonly AboutInterest[];
	readonly experience: readonly PortfolioProject[];
	readonly current: readonly string[];
	readonly future: {
		readonly active: readonly string[];
		readonly parked: readonly string[];
	};
	readonly externalHandles: readonly AboutExternalHandle[];
}
