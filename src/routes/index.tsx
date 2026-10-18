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
	// Index boundary (Issue #423): the home surface is the canonical
	// public page, so it declares the same canonical URL the sitemap
	// advertises (`public/sitemap.xml` is generated from the route
	// inventory in `scripts/_index-boundary.mjs`, and the check fails if
	// the two disagree). No `robots` meta is emitted here on purpose —
	// an accidental `noindex` on this route would silently de-index the
	// entire site, which is why the checker treats a noindex meta on any
	// public route as a violation rather than a style choice.
	head: () => ({
		meta: [
			{ title: 'my-web-2026' },
			{
				name: 'description',
				content:
					'rebuildup の個人 Web プラットフォーム。Home / Portfolio / Tools / Contact の公開面と、Admin の運用面を同一の Cloudflare Worker で配信しています。',
			},
			{ property: 'og:type', content: 'website' },
			{ property: 'og:title', content: 'my-web-2026' },
			{ property: 'og:url', content: 'https://rebuildup.dev/' },
		],
		links: [{ rel: 'canonical', href: 'https://rebuildup.dev/' }],
	}),
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
	component: HomeRoute,
});

function HomeRoute() {
	return <HomePage data={Route.useLoaderData()} />;
}
