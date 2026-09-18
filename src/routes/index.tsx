import { createFileRoute } from '@tanstack/react-router';
import {
	CAPABILITIES,
	SYSTEM_SERVICES,
	getHomeSystemStatus,
	HomePage,
} from '../home/public';

/**
 * TanStack Start route binding for the canonical home surface.
 *
 * Routing is framework-owned here; page composition and its data
 * obligations live under src/home/.
 */
export const Route = createFileRoute('/')({
	loader: async () => ({
		capabilities: CAPABILITIES,
		services: SYSTEM_SERVICES,
		statuses: await getHomeSystemStatus(),
		observedAt: new Date().toISOString(),
	}),
	component: HomeRoute,
});

function HomeRoute() {
	return <HomePage data={Route.useLoaderData()} />;
}
