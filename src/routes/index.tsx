import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { env } from 'cloudflare:workers';

/**
 * Internal application operation for the landing route.
 *
 * Runs server-side only, accesses the D1 binding through
 * `cloudflare:workers` env, and returns a small serializable result.
 * Failures are converted to a safe `{ available: false }` state — raw
 * errors and binding internals never cross to the client. The Hono
 * external boundary is not involved (see ADR-0002).
 */
const getInternalDataStatus = createServerFn({ method: 'GET' }).handler(async () => {
	try {
		const row = await env.DB.prepare('SELECT 1 AS one').first<{ one: number }>();
		return { available: row?.one === 1 } as const;
	} catch {
		return { available: false } as const;
	}
});

/**
 * Landing route.
 *
 * 0.1.0 Foundation renders the boot smoke view that proves the
 * TanStack Start -> Cloudflare Workers pipeline is alive. Capability
 * views (portfolio, content, activity, ...) land under
 * `src/modules/<capability>/ui/` in 0.2.0+.
 */
export const Route = createFileRoute('/')({
	loader: () => getInternalDataStatus(),
	component: HomePage,
});

function HomePage() {
	const status = Route.useLoaderData();
	return (
		<main>
			<h1>my-web-2026</h1>
			<p>0.1.0 Foundation release.</p>
			<p>Internal data: {status.available ? 'available' : 'unavailable'}</p>
			<dl>
				<dt>stack</dt>
				<dd>Cloudflare Workers + TanStack Start + Hono + Panda CSS</dd>
				<dt>external boundary</dt>
				<dd>
					<code>/api/v1/*</code> via Hono at <code>src/http/hono.ts</code>
				</dd>
				<dt>internal SSR</dt>
				<dd>TanStack Start default CSRF middleware active</dd>
			</dl>
		</main>
	);
}
