import { createFileRoute, notFound } from '@tanstack/react-router';
import type { HTMLAttributeReferrerPolicy } from 'react';
import { getPublicTool } from '../tools/registry';

/**
 * TanStack Start route for any Tool iframe shell.
 *
 * Mounts the Tool iframe via the Tool Registry contract. Every
 * piece of metadata that distinguishes one Tool from another is
 * sourced from `getPublicTool(params.slug)`:
 *
 *   - `display_name`       → `<title>` and visible heading
 *   - `entry_html`         → iframe `src`
 *   - `iframe.sandbox`     → iframe `sandbox` attribute
 *   - `iframe.referrer_policy` → iframe `referrerpolicy` attribute
 *
 * No Tool-specific constants live in this file. Adding a Tool to
 * the registry's `same_origin_static` set is sufficient for it to
 * be reachable at `/tools/<slug>` — no route file edit required.
 *
 * The route throws `notFound()` when the slug is not in the public
 * list (e.g. it is `host_disabled`, `needs_tool_side_fix`, or
 * absent from the manifest). This is the contract: the route must
 * never render a Tool the registry refuses to expose.
 */
export const Route = createFileRoute('/tools/$slug')({
	loader: ({ params }) => {
		const tool = getPublicTool(params.slug);
		if (!tool) throw notFound();
		return tool;
	},
	head: ({ loaderData }) => {
		// The loader throws `notFound()` when the slug is not in the
		// public list, so by the time `head()` runs, loaderData is
		// guaranteed. TanStack's type signature still surfaces
		// `PublicToolSummary | undefined`, so we assert here.
		const tool = loaderData as NonNullable<typeof loaderData>;
		return {
			meta: [
				{ title: `${tool.display_name} — my-web-2026 Tools` },
				{
					name: 'description',
					content: tool.description,
				},
				// Explicit noindex for Tool iframe shell routes — Tool content
				// is served at /tools/<slug>/<artifact_path>/, and the host
				// shell is intentionally not part of the public canonical
				// surface. Operators can flip this once the Tool surface
				// graduates from pilot to production.
				{ name: 'robots', content: 'noindex' },
			],
		};
	},
	component: ToolRoute,
});

function ToolRoute() {
	const tool = Route.useLoaderData();
	return (
		<div
			data-route="tools/$slug"
			data-tool-slug={tool.slug}
			style={{
				width: '100%',
				height: 'calc(100vh - 64px)',
				border: '0',
				display: 'block',
			}}
		>
			<iframe
				title={`${tool.display_name} Tool`}
				src={tool.entry_html}
				sandbox={tool.iframe.sandbox}
				referrerPolicy={tool.iframe.referrer_policy as HTMLAttributeReferrerPolicy}
				loading="lazy"
				style={{
					width: '100%',
					height: '100%',
					border: '0',
					display: 'block',
				}}
			/>
		</div>
	);
}
