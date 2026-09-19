import { createFileRoute } from '@tanstack/react-router';
import {
	CAPABILITIES,
	HOME_REACTIONS_TARGET,
	SYSTEM_SERVICES,
	getHomeCounter,
	getHomeReactions,
	getHomeSystemStatus,
	HomePage,
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
	component: HomeRoute,
});

function HomeRoute() {
	return <HomePage data={Route.useLoaderData()} />;
}
