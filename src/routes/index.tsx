import { createFileRoute } from '@tanstack/react-router';
import {
	CAPABILITIES,
	HOME_REACTIONS_TARGET,
	HomePage,
	SYSTEM_SERVICES,
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
		const [statuses, reactions, counter] = await Promise.all([
			getHomeSystemStatus(),
			getHomeReactions({ data: { target: HOME_REACTIONS_TARGET } }),
			getHomeCounter({ data: {} }),
		]);
		return {
			capabilities: CAPABILITIES,
			services: SYSTEM_SERVICES,
			statuses,
			observedAt: new Date().toISOString(),
			reactions,
			counter,
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
	 * route id, so `/` and `` must not disagree.
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
