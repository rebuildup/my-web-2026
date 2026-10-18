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
	head: () => ({
		// Issue #420 — the platform entry is the root of the sitemap,
		// and the sitemap contract is that every `<loc>` is the
		// page's canonical URL. `/` and `/tools` were the only public
		// routes without a canonical, so they gained the same
		// `rel="canonical"` their siblings already declared.
		// `scripts/check-sitemap-route-coverage.test.mjs` asserts that
		// this literal and the sitemap inventory agree, so the two
		// cannot drift apart silently.
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
