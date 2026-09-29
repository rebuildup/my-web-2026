import { createFileRoute, notFound } from '@tanstack/react-router';
import type { HTMLAttributeReferrerPolicy } from 'react';
import { css } from '../../styled-system/css';
import { Container } from '../editorial/primitives/Container';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
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
 *
 * Case-insensitive lookup (Issue #183): the manifest schema
 * constrains slugs to `[a-z0-9][a-z0-9-]{0,127}` but a visitor
 * arriving from a third-party link or a stale bookmark may type
 * `/tools/ProtoType` (display case). The loader lowercases the URL
 * parameter before consulting the registry so display-case URLs
 * still resolve to the canonical lowercase slug. The canonical URL
 * itself remains lowercase (`/tools/prototype`) — this is URL
 * tolerance, not a canonicalisation contract.
 *
 * Empty state (Issue #183): when the slug is genuinely unknown
 * (the loader throws `notFound()`), `notFoundComponent` renders
 * `ToolNotFound` instead of falling back to TanStack's
 * `<p>Not Found</p>` default. The component reuses the editorial
 * primitives (`SectionHeading`) and links back to `/tools`, so the
 * 404 path is a meaningful surface — not a blank page with a
 * default string. The breadcrumb chain also drops the
 * `/tools/$slug` leaf when the loader throws (see
 * `src/editorial/nav/route-labels.ts`), so the visible chrome
 * stops at "Home > Tools" rather than misleadingly showing a
 * stub "Tool" leaf for a slug that does not exist.
 */
export const Route = createFileRoute('/tools/$slug')({
	loader: ({ params }) => {
		// Display-case tolerance (see module docstring). The manifest
		// schema is lowercase-only, so this is purely a URL-input
		// concession — the canonical slug remains lowercase.
		const slug = params.slug.toLowerCase();
		const tool = getPublicTool(slug);
		if (!tool) throw notFound();
		return tool;
	},
	head: ({ loaderData }) => {
		// TanStack calls `head()` server-side even when the loader
		// throws `notFound()` (the route still needs an HTTP <head>
		// before the notFound boundary can short-circuit). Guard
		// against `loaderData` being undefined — fall back to a
		// generic head instead of crashing the SSR pipeline.
		if (!loaderData) {
			return {
				meta: [{ title: 'Tool — my-web-2026' }, { name: 'robots', content: 'noindex' }],
			};
		}
		const tool = loaderData;
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
	notFoundComponent: ToolNotFound,
	component: ToolRoute,
});

/**
 * Empty state for `/tools/<unknown>` (Issue #183).
 *
 * Renders inside the same `<Outlet />` slot the iframe would occupy,
 * so the site chrome (`<PublicNav />`, `<Breadcrumbs />`) appears
 * exactly once — the chrome duplication bug fixed in this PR is
 * the breadcrumb resolver's tendency to surface a stub "Tool"
 * leaf for a slug that does not exist; the visible chrome now
 * stops at "Home > Tools" (see
 * `src/editorial/nav/route-labels.ts`).
 */
function ToolNotFound() {
	return (
		<Container as="section">
			<div
				data-testid="tools-not-found"
				className={css({
					paddingBlock: { base: '16', md: '24' },
				})}
			>
				<SectionHeading
					eyebrow="404"
					title="ツールが見つかりません / Tool not found"
					description={
						<>
							指定されたツールは Tool Registry に見つかりませんでした。
							<br />
							The requested Tool is not in the Tool Registry. It may be a typo, or the Tool may be{' '}
							<code>host_disabled</code> until its upstream repo adds a standalone build path.
						</>
					}
				/>
				<p
					className={css({
						marginBlockStart: '8',
						fontFamily: 'sans',
						fontSize: 'md',
						color: 'text.default',
					})}
				>
					<a
						href="/tools"
						className={css({
							color: 'text.accent',
							textDecoration: 'underline',
							_hover: { color: 'text.default' },
							_focusVisible: {
								outline: '2px solid {colors.border.focus}',
								outlineOffset: '2px',
							},
						})}
					>
						ツール一覧に戻る / Back to the Tool list
					</a>
				</p>
			</div>
		</Container>
	);
}

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
