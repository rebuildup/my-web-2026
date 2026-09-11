import { createServerFn } from '@tanstack/react-start';

/**
 * Internal health ping exposed to the UI via TanStack Start server functions.
 *
 * External /api/* /webhooks/* /oauth/* traffic is implemented in Hono at
 * `src/boundary/**`. Server functions are reserved for **internal**
 * application operations invoked from the UI (loader/action here).
 */
export const getInternalHealth = createServerFn({ method: 'GET' }).handler(async () => {
	return {
		status: 'ok',
		service: 'my-web-2026',
		version: '0.1.0',
		timestamp: new Date().toISOString(),
	};
});
