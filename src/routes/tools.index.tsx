import { Link, createFileRoute } from '@tanstack/react-router';
import { listPublicTools } from '../tools/registry';

/**
 * TanStack Start route for the Tools index page.
 *
 * Lists every Tool whose `delivery.kind` is `same_origin_static` or
 * `external_exception` — the same surface as the iframe shell route.
 * `host_disabled` / `needs_tool_side_fix` / `not_integrable_yet`
 * Tools are intentionally excluded: the brief forbids showing Tools
 * that are not actually integrated.
 *
 * The list is sourced entirely from `listPublicTools()` — no
 * Tool-specific constants live in this file. Adding a Tool to the
 * registry's `same_origin_static` set is sufficient for it to appear
 * here.
 */
export const Route = createFileRoute('/tools/')({
	loader: () => listPublicTools(),
	head: () => ({
		meta: [
			{ title: 'Tools — my-web-2026' },
			{
				name: 'description',
				content: 'Standalone Web Tools integrated into my-web-2026 via the Tool Registry contract.',
			},
		],
	}),
	component: ToolsIndexRoute,
});

function ToolsIndexRoute() {
	const tools = Route.useLoaderData();
	return (
		<section
			data-route="tools"
			style={{
				maxWidth: '960px',
				margin: '0 auto',
				padding: '2rem 1.5rem',
			}}
		>
			<h1 style={{ margin: '0 0 0.5rem', fontSize: '2rem', lineHeight: 1.2 }}>Tools</h1>
			<p style={{ margin: '0 0 2rem', color: 'var(--colors-fg-muted, #555)' }}>
				Standalone Web Tools integrated into my-web-2026. Each Tool is an independent repository,
				built and collected into <code>/tools/&lt;slug&gt;/app/</code>, and served from the same
				origin. See ADR-0006 for the integration contract.
			</p>
			{tools.length === 0 ? (
				<p>No Tools are currently integrated.</p>
			) : (
				<ul
					style={{
						listStyle: 'none',
						margin: 0,
						padding: 0,
						display: 'grid',
						gap: '1rem',
					}}
				>
					{tools.map((tool) => (
						<li
							key={tool.slug}
							data-tool-slug={tool.slug}
							style={{
								border: '1px solid var(--colors-border, #ddd)',
								borderRadius: '8px',
								padding: '1rem 1.25rem',
							}}
						>
							<h2 style={{ margin: '0 0 0.25rem', fontSize: '1.25rem' }}>
								<Link
									to="/tools/$slug"
									params={{ slug: tool.slug }}
									style={{ color: 'inherit', textDecoration: 'none' }}
								>
									{tool.display_name}
								</Link>
							</h2>
							<p style={{ margin: 0, color: 'var(--colors-fg-muted, #555)' }}>{tool.description}</p>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
