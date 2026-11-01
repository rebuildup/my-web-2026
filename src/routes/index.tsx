import { createFileRoute } from '@tanstack/react-router';
import {
	CAPABILITIES,
	HOME_REACTIONS_TARGET,
	HomePage,
	KNOWN_INCIDENTS,
	SYSTEM_SERVICES,
	getCurrentProjects,
	getHomeCounter,
	getHomeReactions,
	getHomeSystemStatus,
	recordHomeHit,
} from '../home/public';

/**
 * TanStack Start route binding for the canonical home surface.
 *
 * Routing is framework-owned here; page composition and its data
 * obligations live under src/home/.
 *
 * The loader records an access hit before reading the counter so the
 * tile reflects the current request, then pulls reactions + system
 * status in parallel. Record-then-read ordering on the counter is
 * part of the contract (per ADR-0012); `Promise.all` is only used
 * for the read paths.
 */
export const Route = createFileRoute('/')({
	loader: async () => {
		await recordHomeHit({ data: {} });
		// The base date the current-projects section computes every
		// derived value against. One `observedAt` serves both the status
		// tiles and the section, so "3 日前" and the status snapshot can
		// never disagree about which day they describe (Issue #316).
		const observedAt = new Date().toISOString();
		const today = observedAt.slice(0, 10);
		const [statuses, reactions, counter, projects] = await Promise.all([
			getHomeSystemStatus(),
			getHomeReactions({ data: { target: HOME_REACTIONS_TARGET } }),
			getHomeCounter({ data: {} }),
			getCurrentProjects({ data: { today } }),
		]);
		return {
			capabilities: CAPABILITIES,
			services: SYSTEM_SERVICES,
			statuses,
			observedAt,
			// Issue #502: the committed incident records. There is no
			// runtime fetch here on purpose — the published list is
			// exactly what the repository holds.
			incidents: KNOWN_INCIDENTS,
			reactions,
			counter,
			// Issue #316: the current-project records. Composed from
			// committed artefacts only (the owner's roster plus the
			// generated git snapshot) — the section makes a claim about
			// *now*, and a claim that changes without a commit cannot be
			// reviewed. There is no runtime fetch here.
			projects,
		};
	},
	/**
	 * Home head metadata (Issue #418).
	 *
	 * The home route had no `head()`, so it inherited the root
	 * fallback title (`my-web-2026`) and declared no description and
	 * no canonical at all — the flagship URL of the site was the one
	 * page a crawler could not resolve to a canonical document. The
	 * public-route head gate (`test/integration/seo-head.test.ts`)
	 * now fails on that, which is the point of the gate.
	 *
	 * The description restates the hero lead rather than inventing
	 * copy: `src/home/hero.tsx` says the same thing on the page, and
	 * the migration state ("段階的に移行中") is the honest state, not a
	 * claim the site cannot back.
	 *
	 * Canonical is the origin WITH its trailing slash — `/` is the
	 * home document and the gate derives the expected value from the
	 * route id, so `/` and `` must not disagree. The same link is
	 * also the sitemap entry's target (Issue #420): the sitemap
	 * contract is that every `<loc>` IS the page's canonical URL, and
	 * `scripts/check-sitemap-route-coverage.test.mjs` asserts this
	 * literal and the sitemap inventory agree, so the two cannot
	 * drift apart silently.
	 */
	head: () => {
		const title = 'my-web-2026 — rebuildup.dev';
		const description =
			'開発・制作・活動をまとめる次の Personal Web Platform を構築しています。Portfolio / content / activity を段階的に移行中です。この 2026 edition は移行途中の public preview です。';
		const url = 'https://rebuildup.dev/';
		return {
			meta: [
				{ title },
				{ name: 'description', content: description },
				{ property: 'og:type', content: 'website' },
				{ property: 'og:title', content: title },
				{ property: 'og:description', content: description },
				{ property: 'og:url', content: url },
				{ name: 'twitter:card', content: 'summary' },
			],
			links: [{ rel: 'canonical', href: url }],
		};
	},
	component: HomeRoute,
});

function HomeRoute() {
	return <HomePage data={Route.useLoaderData()} />;
}
