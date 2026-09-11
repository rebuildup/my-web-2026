import { createFileRoute } from '@tanstack/react-router';

/**
 * Landing route.
 *
 * 0.1.0 Foundation renders the boot smoke view that proves the
 * TanStack Start -> Cloudflare Workers pipeline is alive. Capability
 * views (portfolio, content, activity, ...) land under
 * `src/modules/<capability>/ui/` in 0.2.0+.
 */
export const Route = createFileRoute('/')({
	component: HomePage,
});

function HomePage() {
	return (
		<main>
			<h1>my-web-2026</h1>
			<p>0.1.0 Foundation release.</p>
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
