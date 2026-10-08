import { Link, createFileRoute } from '@tanstack/react-router';
import { css } from '../../styled-system/css';
import { Container } from '../editorial/primitives/Container';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { PublicNav } from '../editorial/nav';
import { listAllTools, listPublicTools } from '../tools/registry';
import type { ManifestTool, PublicToolSummary } from '../tools/registry';

/**
 * TanStack Start route for the Tools index page.
 *
 * Issue #195 (2026-09-29) flipped the show-all policy: the index
 * now lists every manifest entry, not just the embeddable subset.
 * `host_disabled` Tools render with a "Coming soon" badge and
 * their `disabled_reason` so users can see the full my-web tool
 * roadmap instead of a single integrated Tool (the pre-#195 state).
 *
 * Two surface kinds:
 *
 *   - `same_origin_static` / `external_exception` →
 *     clickable link to `/tools/<slug>`. Sort: alphabetical within
 *     the embeddable group ("Integrated").
 *   - `host_disabled` → non-link row with tool name, "Coming soon"
 *     badge, and the `disabled_reason` text. Sort: alphabetical
 *     within the disabled group ("Coming soon").
 *
 * Layout — `Container` + editorial whitespace (#184/#189). Each
 * tool is a row separated by a thin `borderTop` (the shared section
 * divider primitive) instead of a per-item border + background
 * card. The per-item borders collapsed the readable column at
 * narrow viewports; the row-divided list keeps the page on the same
 * visual axis as the rest of the public surface.
 *
 * Embeddable Tools are sorted to the top, then `host_disabled`
 * Tools below. The embeddable list is sourced from `listPublicTools()`
 * for sort/display fields (entry_html etc.); the disabled list comes
 * straight from `listAllTools()` filtered by delivery.kind.
 */
export const Route = createFileRoute('/tools/')({
	loader: () => {
		const all = listAllTools();
		const embeddable = listPublicTools();
		const embeddableSlugs = new Set(embeddable.map((t) => t.slug));
		const disabled = all.filter((t) => !embeddableSlugs.has(t.slug));
		// Stable, alphabetical sort within each group so the order is
		// predictable for snapshot tests and screen-reader users.
		const bySlug = (a: { slug: string }, b: { slug: string }) => a.slug.localeCompare(b.slug);
		return {
			embeddable: [...embeddable].sort(bySlug),
			disabled: [...disabled].sort(bySlug),
		};
	},
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
	const { embeddable, disabled } = Route.useLoaderData();
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			{/* Issue #300: the hero block and the tool lists were one
			    section, so the page-entry beat was 96px where every
			    other page enters at 128px. Split into the canonical
			    hero beat (16/32) + body beat (16/24) — same Container,
			    same left axis. */}
			<section data-route="tools-hero" className={css({ paddingBlock: { base: '16', lg: '32' } })}>
				<Container>
					<header
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '4',
							marginBlockEnd: '0',
						})}
					>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
							})}
						>
							Tools
						</span>
						<h1
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: '3xl', lg: '4xl' },
								fontWeight: '700',
								color: 'text.default',
								lineHeight: '1.05',
								letterSpacing: '-0.03em',
								maxWidth: '720px',
							})}
						>
							ツール / Tools
						</h1>
						<p
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: 'md',
								color: 'text.muted',
								lineHeight: '1.6',
								maxWidth: '640px',
							})}
						>
							my-web-2026 に統合している standalone web tool。固定まわりは独立した repository から{' '}
							<code>/tools/&lt;slug&gt;/app/</code> に collection され、同一 origin
							から配信されます。統合 contract は ADR-0006 を参照。
						</p>
					</header>
				</Container>
			</section>
			<section data-route="tools" className={css({ paddingBlock: { base: '16', lg: '24' } })}>
				<Container>
					{embeddable.length === 0 && disabled.length === 0 ? (
						<p
							className={css({
								margin: '0',
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
							})}
						>
							No Tools are currently registered.
						</p>
					) : (
						<>
							{embeddable.length > 0 && (
								<ToolGroup
									title="Integrated"
									description="Same-origin or external Tools currently embedded at /tools/<slug>."
								>
									{embeddable.map((tool) => (
										<ToolRow key={tool.slug} tool={tool} />
									))}
								</ToolGroup>
							)}
							{disabled.length > 0 && (
								<ToolGroup
									title="Coming soon"
									description="Tools registered in the manifest but not yet embedded. The reason is recorded in each Tool's disabled_reason."
								>
									{disabled.map((tool) => (
										<DisabledToolRow key={tool.slug} tool={tool} />
									))}
								</ToolGroup>
							)}
						</>
					)}
				</Container>
			</section>
		</>
	);
}

function ToolGroup({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<div
			data-tool-group={title.toLowerCase().replace(/\s+/g, '-')}
			className={css({ marginBlockEnd: '12' })}
		>
			<h2
				className={css({
					margin: '0 0 2',
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.muted',
					letterSpacing: '0.04em',
					textTransform: 'uppercase',
				})}
			>
				{title}
			</h2>
			<p
				className={css({
					margin: '0 0 4',
					fontFamily: 'sans',
					fontSize: 'sm',
					color: 'text.muted',
					lineHeight: '1.6',
					maxWidth: '640px',
				})}
			>
				{description}
			</p>
			<ul
				className={css({
					listStyle: 'none',
					margin: '0',
					padding: '0',
					display: 'flex',
					flexDirection: 'column',
				})}
			>
				{children}
			</ul>
		</div>
	);
}

function ToolRow({ tool }: { tool: PublicToolSummary }) {
	return (
		<li
			data-tool-slug={tool.slug}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				paddingBlock: '6',
				borderBlockStartWidth: '1px',
				borderBlockStartStyle: 'solid',
				borderBlockStartColor: 'border.subtle',
			})}
		>
			<h2
				className={css({
					margin: '0',
					fontFamily: 'heading',
					fontSize: 'xl',
					fontWeight: '700',
					color: 'text.default',
					lineHeight: '1.25',
					letterSpacing: '-0.01em',
				})}
			>
				<Link
					to="/tools/$slug"
					params={{ slug: tool.slug }}
					className={css({
						color: 'inherit',
						textDecoration: 'none',
						_focusVisible: {
							outline: '2px solid {colors.border.focus}',
							outlineOffset: '4px',
							borderRadius: '2px',
						},
						_hover: {
							textDecoration: 'underline',
						},
					})}
				>
					{tool.display_name}
				</Link>
			</h2>
			<p
				className={css({
					margin: '0',
					fontFamily: 'sans',
					fontSize: 'md',
					color: 'text.muted',
					lineHeight: '1.6',
					// Issue #300: row descriptions ran the full 960px
					// Container measure (~95 characters per line) while
					// every other description on the site caps at 640px.
					maxWidth: '640px',
				})}
			>
				{tool.description}
			</p>
		</li>
	);
}

function DisabledToolRow({ tool }: { tool: ManifestTool }) {
	// tool.delivery.kind is `host_disabled` here; pull the reason with
	// a runtime narrowing cast since ManifestTool is a discriminated
	// union.
	const reason = tool.delivery.kind === 'host_disabled' ? tool.delivery.disabled_reason : '';
	return (
		<li
			data-tool-slug={tool.slug}
			data-tool-state="host_disabled"
			aria-disabled="true"
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				paddingBlock: '6',
				borderBlockStartWidth: '1px',
				borderBlockStartStyle: 'solid',
				borderBlockStartColor: 'border.subtle',
				opacity: '0.85',
			})}
		>
			<h2
				className={css({
					margin: '0',
					fontFamily: 'heading',
					fontSize: 'xl',
					fontWeight: '700',
					color: 'text.default',
					lineHeight: '1.25',
					letterSpacing: '-0.01em',
					display: 'flex',
					flexWrap: 'wrap',
					alignItems: 'baseline',
					gap: '3',
				})}
			>
				<span>{tool.display_name}</span>
				<span
					data-tool-badge="coming-soon"
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						fontWeight: '500',
						textTransform: 'uppercase',
						letterSpacing: '0.06em',
						color: 'text.muted',
						paddingBlock: '1',
						paddingInline: '2',
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: 'border.subtle',
						borderRadius: 'full',
					})}
				>
					Coming soon
				</span>
			</h2>
			<p
				className={css({
					margin: '0',
					fontFamily: 'sans',
					fontSize: 'md',
					color: 'text.muted',
					lineHeight: '1.6',
					// Issue #300: row descriptions ran the full 960px
					// Container measure (~95 characters per line) while
					// every other description on the site caps at 640px.
					maxWidth: '640px',
				})}
			>
				{tool.description}
			</p>
			{reason ? (
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
						lineHeight: '1.5',
						fontStyle: 'italic',
					})}
				>
					{reason}
				</p>
			) : null}
		</li>
	);
}
