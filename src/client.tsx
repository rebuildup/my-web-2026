import { RouterProvider } from '@tanstack/react-router';
import { hydrateStart } from '@tanstack/react-start/client';
import { StrictMode } from 'react';
import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { getRouter } from './router';
import './styles.css';

/**
 * Client hydration entry. Invoked by `@tanstack/react-start` after the SSR
 * payload arrives. Do not place HTTP-bound logic here — that belongs to
 * server functions or to the Hono boundary.
 *
 * Hydration order (Issue #291). `hydrateStart()` MUST run before
 * `hydrateRoot`. It is the framework's contract for consuming the
 * dehydrated router payload (`window.$_TSR`) that `<Scripts />` embedded in
 * the SSR HTML, and it does two things `hydrateRoot` alone does not:
 *
 *   1. It calls `hydrate(router)`, which copies the SSR-ed match/loader data
 *      onto the client router. Without it every route loader re-runs in the
 *      browser (the home page re-fired `recordHomeHit` + `getHomeSystemStatus`
 *      + `getHomeReactions` + `getHomeCounter` as `/_serverFn/*` requests).
 *   2. It sets `router.ssr = { manifest }`. `@tanstack/react-router`'s
 *      `Matches()` renders `SafeFragment` when `isServer || router.ssr`, but a
 *      bare `<Suspense fallback={null}>` on the client. The SSR tree has no
 *      such boundary, so skipping `hydrateStart` puts a client-only
 *      `<Suspense>` where the server HTML has `<div id="app-root">`.
 *      React reports that as a hydration mismatch (dev: full
 *      "Hydration failed…" error; prod: minified error #418), throws the
 *      server DOM away and re-renders from scratch — the white flash between
 *      "load complete" and "UI appears" this ticket exists to remove.
 *
 * `getRouter()` stays imported as the mount fallback: if `hydrateStart()`
 * rejects (for example the bootstrap payload is missing) the page would
 * otherwise never become interactive. The fallback accepts the mismatch
 * rather than shipping a dead page, and logs loudly so the real failure is
 * still visible.
 */
function mount(router: Parameters<typeof RouterProvider>[0]['router']) {
	startTransition(() => {
		hydrateRoot(
			document,
			<StrictMode>
				<RouterProvider router={router} />
			</StrictMode>,
		);
	});
}

hydrateStart()
	.then(mount)
	.catch((error: unknown) => {
		console.error('[client] hydrateStart failed; mounting without SSR handoff', error);
		mount(getRouter());
	});
