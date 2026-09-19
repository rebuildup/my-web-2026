import { createFileRoute } from '@tanstack/react-router';
import {
	CAPABILITIES,
	SYSTEM_SERVICES,
	getHomeCounter,
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
 * The loader records a hit before reading the counter so the tile
 * reflects the current request. `Promise.all` is intentionally not
 * used here — the record-then-read ordering is part of the contract.
 */
export const Route = createFileRoute('/')({
	loader: async () => {
		await recordHomeHit({ data: {} });
		return {
			capabilities: CAPABILITIES,
			services: SYSTEM_SERVICES,
			statuses: await getHomeSystemStatus(),
			observedAt: new Date().toISOString(),
			counter: await getHomeCounter({ data: {} }),
		};
	},
	component: HomeRoute,
});

function HomeRoute() {
	return <HomePage data={Route.useLoaderData()} />;
}
