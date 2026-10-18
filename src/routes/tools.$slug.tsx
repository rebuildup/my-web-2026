import { Link, createFileRoute, notFound } from '@tanstack/react-router';
import { useCallback, useRef } from 'react';
import type { HTMLAttributeReferrerPolicy } from 'react';
import { css } from '../../styled-system/css';
import { Container } from '../editorial/primitives/Container';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
import { evaluateToolEmbedPolicy, toEmbedSubject } from '../tools/embed-policy';
import type {
	AcceptedToolMessage,
	EmbedViolation,
	ToolHostMessageDeclaration,
} from '../tools/embed-policy';
import { getPublicTool, getTool, resolveToolEntryHtml } from '../tools/registry';
import type { ManifestTool } from '../tools/registry';
import { useToolHostMessage } from '../tools/use-tool-host-message';

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
 *
 * Fail-closed embed policy (Issue #465): the loader runs
 * `evaluateToolEmbedPolicy()` (src/tools/embed-policy.ts) over the
 * manifest entry BEFORE deciding to render a frame. Three states:
 *
 *   - `embeddable` — the entry satisfies every sandbox / referrer /
 *     origin rule. The iframe renders with the DECLARED
 *     `sandbox` + `referrerPolicy`; nothing is defaulted here.
 *   - `blocked`   — the entry violates the policy. The route renders
 *     a placeholder naming each violation code and NO iframe, so a
 *     manifest edit cannot silently downgrade the sandbox of a
 *     live Tool (e.g. adding `allow-same-origin`, or pointing
 *     `entry_html` at a foreign origin).
 *   - `disabled`  — the manifest marks the Tool `host_disabled`
 *     (nothing to police; see the "Coming soon" copy below).
 *
 * The `embeddable` branch also carries the Tool's `host_message`
 * declaration into `ToolEmbedShell`, which is the only place a
 * `message` listener can be attached for a Tool frame — and it
 * attaches one only when the manifest declares a contract. With no
 * declaration (today: every Tool), an unexpected message from the
 * frame reaches no host code at all.
 */
export const Route = createFileRoute('/tools/$slug')({
	loader: ({ params }) => {
		// Display-case tolerance (see module docstring). The manifest
		// schema is lowercase-only, so this is purely a URL-input
		// concession — the canonical slug remains lowercase.
		const slug = params.slug.toLowerCase();
		const tool = getTool(slug);
		if (!tool) throw notFound();

		// Issue #465: policy first. A blocked entry never reaches the
		// public-surface lookup, so the iframe cannot be rendered even
		// if the Tool is listed as embeddable.
		const violations = evaluateToolEmbedPolicy(toEmbedSubject(tool.slug, tool.delivery));
		const publicTool = getPublicTool(slug);
		if (violations.length > 0) return { state: 'blocked' as const, tool, violations };
		if (publicTool) return { state: 'embeddable' as const, tool, public: publicTool };
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
		if (loaderData.state === 'blocked') {
			return {
				meta: [
					{ title: `${loaderData.tool.display_name} — blocked — my-web-2026 Tools` },
					{
						name: 'description',
						content: `${loaderData.tool.display_name} is not embedded because its registry entry violates the host embed policy (Issue #465).`,
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
						paddingBlock: { base: '16', lg: '32' },
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
	if (loaderData.state === 'blocked') {
		return <BlockedPlaceholder tool={loaderData.tool} violations={loaderData.violations} />;
	}
	const { tool, public: summary } = loaderData;
	return (
		<ToolEmbedShell
			slug={tool.slug}
			displayName={tool.display_name}
			// Issue #465: `src` comes from `resolveToolEntryHtml`, the same
			// function the embed-policy verifier uses, so the rendered
			// frame can never point somewhere the policy did not see.
			src={resolveToolEntryHtml(tool)}
			sandbox={summary.iframe.sandbox}
			referrerPolicy={summary.iframe.referrer_policy}
			allow={summary.iframe.allow}
			hostMessage={tool.delivery.kind === 'host_disabled' ? undefined : tool.delivery.host_message}
		/>
	);
}

/**
 * The embeddable state (Issue #465).
 *
 * Three responsibilities:
 *
 *   1. Render the iframe with the manifest's DECLARED sandbox,
 *      referrer policy and capability grant (`allow`) — no defaults,
 *      no client-side "upgrade". `allow` is what makes a conditional
 *      sandbox token usable at all: the policy REQUIRES the manifest
 *      to declare it, so dropping it here would make every such
 *      declaration inert while the gate reported it as valid.
 *   2. Host the message channel. `useToolHostMessage` attaches a
 *      `message` listener only when the manifest declares
 *      `delivery.host_message`; otherwise there is no listener at all.
 *      `onToolMessage` is the only host action a Tool can trigger, and
 *      it is a no-op seam today: no Tool declares a contract, so the
 *      effect body never runs. It exists so the contract is complete
 *      (declaration → origin-exact, type-allowlisted channel) rather
 *      than a stub that a future Tool has to re-invent.
 */
function ToolEmbedShell({
	slug,
	displayName,
	src,
	sandbox,
	referrerPolicy,
	allow,
	hostMessage,
}: {
	slug: string;
	displayName: string;
	src: string;
	sandbox: string;
	referrerPolicy: string;
	allow?: string | undefined;
	hostMessage: ToolHostMessageDeclaration | undefined;
}) {
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const getToolWindow = useCallback(() => frameRef.current?.contentWindow ?? null, []);
	const onToolMessage = useCallback((_message: AcceptedToolMessage) => {
		// No Tool declares a message contract yet (#465), so this branch
		// is unreachable by construction. When the first Tool declares
		// one, its host-side action belongs here — behind the origin /
		// source / type checks the guard already performed.
	}, []);

	useToolHostMessage({ slug, declaration: hostMessage, getToolWindow, onMessage: onToolMessage });

	return (
		<>
			<div
				data-route="tools/$slug"
				data-tool-slug={slug}
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
					ref={frameRef}
					title={`${displayName} Tool`}
					src={src}
					sandbox={sandbox}
					referrerPolicy={referrerPolicy as HTMLAttributeReferrerPolicy}
					// Issue #465: render the DECLARED capability grant.
					// `allow` only intersects with the host's own
					// `Permissions-Policy` response header — the host does
					// not send one for Tool frames yet (ADR-0006's
					// re-evaluation trigger covers the header; see
					// `docs/tools/embed-policy.md` §2). Rendering it is
					// still required: without the attribute the declared
					// grant can never take effect when the header lands.
					allow={allow}
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
 * Blocked state (Issue #465) — the manifest entry violates the host
 * embed policy, so the host renders NO iframe.
 *
 * This is the fail-closed surface: a bad sandbox token, a missing
 * referrer policy, or a frame `src` whose origin contradicts the
 * delivery kind stops at this page instead of at the browser. Each
 * violation code is rendered so the fix is mechanical.
 */
function BlockedPlaceholder({
	tool,
	violations,
}: {
	tool: ManifestTool;
	violations: readonly EmbedViolation[];
}) {
	return (
		<>
			<Container as="section">
				<div
					data-route="tools/$slug"
					data-tool-slug={tool.slug}
					data-tool-state="blocked"
					data-testid="tools-embed-blocked"
					className={css({
						paddingBlock: { base: '16', lg: '32' },
						maxWidth: '720px',
					})}
				>
					<SectionHeading
						eyebrow="Blocked by embed policy"
						title={tool.display_name}
						description={
							<>
								この Tool はホストの埋め込みポリシー（sandbox / referrerPolicy / origin 契約）に
								違反するため、iframe は描画されません。
								<br />
								This Tool is not embedded: its registry entry violates the host embed policy, so the
								host renders no iframe. The violations are listed below.
							</>
						}
					/>
					<ul
						data-tool-policy-violations
						className={css({
							marginBlockStart: '12',
							paddingInlineStart: '20',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
							listStyleType: 'disc',
						})}
					>
						{violations.map((v) => (
							<li key={`${v.code}-${v.message}`} data-violation-code={v.code}>
								<code>{v.code}</code> — {v.message}
							</li>
						))}
					</ul>
					<p
						className={css({
							marginBlockStart: '16',
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
						paddingBlock: { base: '16', lg: '32' },
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
