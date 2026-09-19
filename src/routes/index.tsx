import { createFileRoute } from '@tanstack/react-router';
import {
	CAPABILITIES,
	HOME_REACTIONS_TARGET,
	SYSTEM_SERVICES,
	getHomeReactions,
	getHomeSystemStatus,
	HomePage,
} from '../home/public';

/**
 * TanStack Start route binding for the canonical home surface.
 *
 * Routing is framework-owned here; page composition and its data
 * obligations live under src/home/.
 *
 * The loader pulls reactions + system status in parallel. Both server
 * fns are read-only (GET); write paths (addReaction / removeReaction)
 * are triggered by the visitor from the `<ReactionsWidget>` and go
 * through their own server-fn endpoints, not through this loader.
 */
export const Route = createFileRoute('/')({
	loader: async () => {
		const [statuses, reactions] = await Promise.all([
			getHomeSystemStatus(),
			getHomeReactions({ data: { target: HOME_REACTIONS_TARGET } }),
		]);
		return {
			capabilities: CAPABILITIES,
			services: SYSTEM_SERVICES,
			statuses,
			observedAt: new Date().toISOString(),
			reactions,
		};
	},
	component: HomeRoute,
});

function HomeRoute() {
	return <HomePage data={Route.useLoaderData()} />;
}
