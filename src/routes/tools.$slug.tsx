import { Link, createFileRoute, notFound } from '@tanstack/react-router';
import type { HTMLAttributeReferrerPolicy } from 'react';
import { css } from '../../styled-system/css';
import { Container } from '../editorial/primitives/Container';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
import { getPublicTool, getTool } from '../tools/registry';
import type { ManifestTool } from '../tools/registry';

/**
 * TanStack Start route for any Tool iframe shell.
 *
 * Issue #195 (2026-09-29) extended this route to render a
 * "Coming soon" placeholder for `host_disabled` Tools instead of
 * throwing `notFound()` for every slug that is not embeddable.
 * The `/tools` index page now lists every manifest entry, so
 * `/tools/<slug>` must produce a meaningful response when the
 * user clicks through to a `host_disabled` Tool.
 *
 * Loader behaviour:
 *
 *   - slug not in manifest at all       → throw notFound()
 *     (404 page; this is the "genuinely missing" case.)
 *   - slug in manifest, embeddable      → return PublicToolSummary
 *     and render the iframe as before.
 *   - slug in manifest, host_disabled   → return a placeholder
 *     shape (`{ state: 'disabled', tool }`) and render the
 *     "Coming soon" copy + disabled_reason + back-link.
 *
 * The route throws `notFound()` when the slug is genuinely absent
 * from the manifest. `notFoundComponent` (Issue #183) renders
 * `ToolNotFound` instead of falling back to TanStack's
 * `<p>Not Found</p>` default. The component reuses the editorial
 * primitives (`Container`, `SectionHeading`) and links back to
 * `/tools`, so the 404 path is a meaningful surface — not a blank
 * page with a default string. The breadcrumb chain also drops the
 * `/tools/$slug` leaf when the loader throws (see
 * `src/editorial/nav/route-labels.ts`), so the visible chrome
 * stops at "Home > Tools" rather than misleadingly showing a
 * stub "Tool" leaf for a slug that does not exist.
 *
 * Chrome convention (Issue #199 → removed by Issue #288). Until
 * #288 this route rendered `<PublicNav />` / `<Breadcrumbs />` /
 * `<BreadcrumbJsonLd />` explicitly in each surface. The Tools
 * surfaces now render NO header chrome at all: the Tool iframe
 * shell is full-bleed by design and the header only consumed
 * viewport height above it, so Issue #288 removed the nav and
 * breadcrumbs from every state (ToolRoute, ToolNotFound,
 * DisabledPlaceholder) and the iframe now fills the full viewport
 * (`100vh`, no header allowance).
 *
 * Case-insensitive lookup (Issue #183): the manifest schema
 * constrains slugs to `[a-z0-9][a-z0-9-]{0,127}` but a visitor
 * arriving from a third-party link or a stale bookmark may type
 * `/tools/ProtoType` (display case). The loader lowercases the URL
 * parameter before consulting the registry so display-case URLs
 * still resolve to the canonical lowercase slug. The canonical URL
 * itself remains lowercase (`/tools/prototype`) — this is URL
 * tolerance, not a canonicalisation contract.
 */
export const Route = createFileRoute('/tools/$slug')({
	loader: ({ params }) => {
		// Display-case tolerance (see module docstring). The manifest
		// schema is lowercase-only, so this is purely a URL-input
		// concession — the canonical slug remains lowercase.
		const slug = params.slug.toLowerCase();
		const tool = getTool(slug);
		if (!tool) throw notFound();
		const publicTool = getPublicTool(slug);
		if (publicTool) return { state: 'embeddable' as const, public: publicTool };
		if (tool.delivery.kind === 'host_disabled') {
			return { state: 'disabled' as const, tool };
		}
		// Any other delivery.kind we don't yet support at /tools/<slug>.
		// Today that is `not_integrable_yet`; fall through to notFound.
		throw notFound();
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
		if (loaderData.state === 'disabled') {
			const tool = loaderData.tool;
			return {
				meta: [
					{ title: `${tool.display_name} — coming soon — my-web-2026 Tools` },
					{
						name: 'description',
						content: `${tool.display_name} is registered in the my-web-2026 Tool Registry but not yet integrated.`,
					},
					{ name: 'robots', content: 'noindex' },
				],
			};
		}
		const tool = loaderData.public;
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
 * Renders inside the same `<Outlet />` slot the iframe would occupy.
 * No site chrome: Issue #288 removed `<PublicNav />` /
 * `<Breadcrumbs />` from every Tools surface, so this 404 state
 * renders only the designed empty-state content.
 */
function ToolNotFound() {
	return (
		<>
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
		</>
	);
}

function ToolRoute() {
	const loaderData = Route.useLoaderData();
	if (loaderData.state === 'disabled') {
		return <DisabledPlaceholder tool={loaderData.tool} />;
	}
	const tool = loaderData.public;
	return (
		<>
			<div
				data-route="tools/$slug"
				data-tool-slug={tool.slug}
				style={{
					width: '100%',
					// Issue #288: no header chrome above the shell, so the
					// iframe fills the full viewport height (the previous
					// `calc(100vh - 64px)` reserved space for the header).
					height: '100vh',
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
		</>
	);
}

/**
 * Placeholder for `/tools/<host_disabled_slug>` (Issue #195).
 *
 * The `/tools` index lists every manifest entry; a user clicking
 * through to a `host_disabled` Tool must reach a meaningful
 * response (this placeholder) rather than a 404. The Tool name,
 * description, and `disabled_reason` all come from the manifest
 * via `getTool()`, so the page is informative even before the
 * Tool-side fix lands.
 */
function DisabledPlaceholder({ tool }: { tool: ManifestTool }) {
	const reason = tool.delivery.kind === 'host_disabled' ? tool.delivery.disabled_reason : '';
	return (
		<>
			<Container as="section">
				<div
					data-route="tools/$slug"
					data-tool-slug={tool.slug}
					data-tool-state="host_disabled"
					className={css({
						paddingBlock: { base: '16', md: '24' },
						maxWidth: '720px',
					})}
				>
					<SectionHeading
						eyebrow="Coming soon"
						title={tool.display_name}
						description={
							<>
								{tool.description}
								{reason ? (
									<>
										<br />
										<br />
										<span
											data-tool-disabled-reason
											className={css({
												fontStyle: 'italic',
												color: 'text.muted',
											})}
										>
											{reason}
										</span>
									</>
								) : null}
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
						<Link
							to="/tools"
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
						</Link>
					</p>
				</div>
			</Container>
		</>
	);
}
