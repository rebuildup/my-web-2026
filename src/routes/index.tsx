import { createFileRoute } from '@tanstack/react-router';
import { getInternalHealth } from '~/domains/health/application';

/**
 * Landing route. Foundation release renders the boot smoke view that proves
 * the TanStack Start -> Cloudflare Workers pipeline is alive.
 *
 * The `getInternalHealth` server function is invoked through the loader so
 * the value is rendered during SSR (see ADR-0002 for the internal/external
 * split policy).
 */
export const Route = createFileRoute('/')({
	loader: () => getInternalHealth(),
	component: HomePage,
});

function HomePage() {
	const health = Route.useLoaderData();

	return (
		<main>
			<h1>my-web-2026</h1>
			<p>Foundation release candidate.</p>
			<dl>
				<dt>version</dt>
				<dd>{health.version}</dd>
				<dt>service</dt>
				<dd>{health.service}</dd>
				<dt>status</dt>
				<dd>{health.status}</dd>
				<dt>boot</dt>
				<dd>
					<time dateTime={health.timestamp}>{health.timestamp}</time>
				</dd>
			</dl>
		</main>
	);
}
