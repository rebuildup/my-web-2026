import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

/**
 * TanStack Start router factory.
 *
 * Named `getRouter` because the start-router-plugin's
 * `route-tree-footer.js` appends
 *
 *   `import type { getRouter } from './router.tsx'`
 *
 * to the generated routeTree.gen.ts. The `@tanstack/start-server-core`
 * runtime then calls `entries.routerEntry.getRouter()` (see
 * `createStartHandler.ts`). Renaming this function breaks the SSR
 * dev server.
 *
 * Do not hand-edit `src/routeTree.gen.ts`; it is regenerated from
 * `src/routes/**` by the TanStack Start Vite plugin.
 */
export function getRouter() {
	return createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: 'intent',
		context: {},
	});
}

declare module '@tanstack/react-router' {
	interface Register {
		router: Awaited<ReturnType<typeof getRouter>>;
	}
}
