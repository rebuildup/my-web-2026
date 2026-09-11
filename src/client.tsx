import { StrictMode } from 'react';
import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { getRouter } from './router';
import './styles.css';

/**
 * Client hydration entry. Invoked by `@tanstack/react-start` after the SSR
 * payload arrives. Do not place HTTP-bound logic here — that belongs to
 * server functions or to the Hono boundary.
 */
const router = getRouter();

startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<RouterProvider router={router} />
		</StrictMode>,
	);
});
