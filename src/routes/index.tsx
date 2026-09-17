import { createFileRoute } from '@tanstack/react-router';
import { CAPABILITIES, SYSTEM_SERVICES, getHomeSystemStatus } from '../modules/home';
import { HomePage } from '../modules/home/ui';

/**
 * Landing route.
 *
 * 0.1.0 Foundation rendered a boot-smoke view. From 0.2.0 the
 * page is owned by the `home` capability module under
 * `src/modules/home/`. This file stays thin: it owns the route
 * definition and the loader composition only. Composition lives in
 * `<HomePage>`.
 */
export const Route = createFileRoute('/')({
	loader: async () => {
		const statuses = await getHomeSystemStatus();
		return {
			capabilities: CAPABILITIES,
			services: SYSTEM_SERVICES,
			statuses,
			observedAt: new Date().toISOString(),
		};
	},
	component: HomeRoute,
});

function HomeRoute() {
	const data = Route.useLoaderData();
	return <HomePage data={data} />;
}
