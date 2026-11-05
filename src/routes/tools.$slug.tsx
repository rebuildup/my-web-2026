import { Link, createFileRoute, notFound } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import type { HTMLAttributeReferrerPolicy, ReactNode } from 'react';
import { css } from '../../styled-system/css';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { Container } from '../editorial/primitives/Container';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
import { ToolConsentNotice } from '../tools/embed-consent-notice';
import { evaluateToolEmbedPolicy, toEmbedSubject } from '../tools/embed-policy';
import type {
	AcceptedToolMessage,
	EmbedViolation,
	ToolHostMessageDeclaration,
} from '../tools/embed-policy';
import {
	CONSENT_MODE_CLICK_TO_LOAD,
	evaluateEmbedPrivacy,
	toPrivacySubject,
} from '../tools/embed-privacy';
import type { EmbedPrivacyVerdict, EmbedPrivacyViolation } from '../tools/embed-privacy';
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
 * Chrome convention — three owner decisions in sequence:
 *
 *   - Issue #199: chrome is per-page opt-in; `__root.tsx` mounts none.
 *   - 2026-11-01 (Issue #785): the owner abolished Issue #288 and put
 *     `<PublicNav />` / `<Breadcrumbs />` / `<BreadcrumbJsonLd />` back
 *     on EVERY `/tools/<slug>` state — 「`/tools` は index・詳細とも
 *     PublicNav とパンくずを戻す。 #288 を全面廃止する。」 — and the
 *     subtraction was done by layout (`ToolChrome` stacked chrome and
 *     frame in one `100dvh` flex column).
 *   - 2026-11-05 (Issue #911): the owner narrowed that restoration to
 *     the states that do NOT show a Tool — 「各ツールはヘッダーなどを
 *     いれず、各ツール全画面でそれぞれ使われるようにする」. The
 *     embeddable shell and the consent gate now render NO chrome and
 *     give the whole viewport to the Tool (`100dvh`, no subtraction
 *     layout); the 404 / `host_disabled` / `blocked` placeholders keep
 *     `ToolChrome` because a visitor who is not using a Tool still has
 *     to be able to leave. The `/tools` index is a list page, not
 *     「各ツール」, so it keeps its chrome (#785 stands for it).
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
 * This is a THIRD published URL slug space, and it is the one URL
 * space the Issue #433 Unicode policy does NOT classify. The loader
 * folds case with `.toLowerCase()` instead of routing `params.slug`
 * through `classifySlugCandidate`, which means
 * `/tools/MultiSlicer` and `/tools/multislicer` resolve to one
 * published identity. The grammar is ASCII-only
 * (`src/tools/manifest.schema.json`), so no non-ASCII character can
 * reach this path today; what stays unresolved is the case-folding
 * tolerance. Recorded as an open owner decision in
 * `docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md`
 * §6.4 — do not read `pnpm run i18n:policy:check` as coverage here: the
 * gate has no rule for case folding a URL parameter. Retiring the
 * tolerance is Issue #183's behaviour change, not this file's call.
 *
 * Fail-closed embed policy (Issue #465): the loader runs
 * `evaluateToolEmbedPolicy()` (src/tools/embed-policy.ts) over the
 * manifest entry BEFORE deciding to render a frame. Three states:
 *
 *   - `embeddable` — the entry satisfies every referrer / origin /
 *     privacy rule. The iframe renders with the DECLARED
 *     `referrerPolicy` (and `allow`); nothing is defaulted here. A
 *     first-party `same_origin_static` Tool carries NO `sandbox`
 *     (ADR-0020) — the frame is a layout / URL / CSS-DOM container,
 *     not a security boundary. Only an `external_exception` frame
 *     renders one.
 *   - `blocked`   — the entry violates the policy. The route renders
 *     a placeholder naming each violation code and NO iframe, so a
 *     manifest edit cannot silently downgrade a live Tool's contract
 *     (e.g. declaring a sandbox on a first-party entry, adding
 *     `allow-same-origin` to an external one, or pointing
 *     `entry_html` at a foreign origin).
 *   - `disabled`  — the manifest marks the Tool `host_disabled`
 *     (nothing to police; see the "Coming soon" copy below).
 *
 * Third-party contact + consent gate (Issue #498): the loader ALSO
 * runs `evaluateEmbedPrivacy()` (`src/tools/embed-privacy.ts`) over
 * the same entry. A violation blocks the frame exactly like an embed
 * violation, and a clean verdict whose `consent` is `click_to_load`
 * renders `ToolConsentNotice` instead of the frame — no iframe, and no
 * third-party origin anywhere in the document, until the visitor
 * activates the load. The consent mode is derived from the manifest
 * declaration, never declared by it (see the policy module header).
 *
 * The `embeddable` branch also carries the Tool's `host_message`
 * declaration into `ToolEmbedShell`, which is the only place a
 * `message` listener can be attached for a Tool frame — and it
 * attaches one only when the manifest declares a contract. With no
 * declaration (today: every Tool), an unexpected message from the
 * frame reaches no host code at all.
 */
/**
 * The only manifest fields a `host_disabled` page may serialize into its
 * hydration payload (Issue #836).
 *
 * The loader used to return the whole `ManifestTool`, so the SSR document
 * carried `delivery.disabled_reason`, `build.command`, `source` and
 * `notes` in `$_TSR` even after the visible field was removed. TanStack
 * serializes loader data by default; the boundary therefore has to be
 * drawn on the data, not on the JSX.
 */
interface DisabledToolView {
	readonly slug: string;
	readonly display_name: string;
	readonly description_ja: string;
}

export const Route = createFileRoute('/tools/$slug')({
	loader: ({ params }) => {
		// Display-case tolerance (see module docstring). The manifest
		// schema is lowercase-only, so this is purely a URL-input
		// concession — the canonical slug remains lowercase. It is NOT
		// routed through `classifySlugCandidate`; that gap is the open
		// owner decision recorded in ADR-0017 §6.4.
		const slug = params.slug.toLowerCase();
		const tool = getTool(slug);
		if (!tool) throw notFound();

		// Issue #465: policy first. A blocked entry never reaches the
		// public-surface lookup, so the iframe cannot be rendered even
		// if the Tool is listed as embeddable.
		const violations = evaluateToolEmbedPolicy(toEmbedSubject(tool.slug, tool.delivery));
		// Issue #498: the third-party contact contract runs over the same
		// entry and fails closed the same way. An embeddable Tool with no
		// `delivery.privacy`, an undeclared external frame origin, or a
		// declared origin with no purpose gets no iframe at all.
		const privacy = evaluateEmbedPrivacy(toPrivacySubject(tool.slug, tool.delivery));
		const publicTool = getPublicTool(slug);
		if (violations.length > 0 || privacy.violations.length > 0) {
			return { state: 'blocked' as const, tool, violations, privacy };
		}
		if (publicTool) return { state: 'embeddable' as const, tool, public: publicTool, privacy };
		if (tool.delivery.kind === 'host_disabled') {
			const view: DisabledToolView = {
				slug: tool.slug,
				display_name: tool.display_name,
				description_ja: tool.description_ja,
			};
			return { state: 'disabled' as const, tool: view };
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
		// generic head instead of crashing the SSR pipeline. The
		// fallback deliberately declares NO canonical: a 404 document
		// must not name a canonical URL (the public-route head gate,
		// Issue #418, fails the build on `not-found.canonical-present`).
		if (!loaderData) {
			return {
				meta: [{ title: 'Tool — my-web-2026' }, { name: 'robots', content: 'noindex' }],
			};
		}
		if (loaderData.state === 'disabled') {
			const tool = loaderData.tool;
			const url = `https://rebuildup.dev/tools/${tool.slug}`;
			return {
				meta: [
					{ title: `${tool.display_name} — coming soon — my-web-2026 Tools` },
					{
						name: 'description',
						content: `${tool.display_name} is registered in the my-web-2026 Tool Registry but not yet integrated.`,
					},
					{ property: 'og:url', content: url },
					{ name: 'robots', content: 'noindex' },
				],
				links: [{ rel: 'canonical', href: url }],
			};
		}
		if (loaderData.state === 'blocked') {
			return {
				meta: [
					{ title: `${loaderData.tool.display_name} — blocked — my-web-2026 Tools` },
					{
						name: 'description',
						content: `${loaderData.tool.display_name} is not embedded because its registry entry violates the host embed policy (Issue #465) or the third-party contact contract (Issue #498).`,
					},
					{ name: 'robots', content: 'noindex' },
				],
			};
		}
		const tool = loaderData.public;
		const url = `https://rebuildup.dev/tools/${tool.slug}`;
		return {
			meta: [
				{ title: `${tool.display_name} — my-web-2026 Tools` },
				{
					name: 'description',
					content: tool.description,
				},
				{ property: 'og:url', content: url },
				// Explicit noindex for Tool iframe shell routes — Tool content
				// is served at /tools/<slug>/<artifact_path>/, and the host
				// shell is intentionally not part of the public canonical
				// surface. Operators can flip this once the Tool surface
				// graduates from pilot to production.
				//
				// Issue #418: the exclusion is declared in
				// `INDEX_EXCLUSIONS` (scripts/seo-head-contract.mjs), so
				// the gate reads this as a recorded decision rather than
				// as drift, and it still requires the canonical below.
				{ name: 'robots', content: 'noindex' },
			],
			links: [{ rel: 'canonical', href: url }],
		};
	},
	notFoundComponent: ToolNotFound,
	component: ToolRoute,
});

/**
 * The chrome column the states that do NOT show a Tool render inside
 * (owner decision 2026-11-01 — Issue #785; narrowed by the owner
 * decision of 2026-11-05 — Issue #911).
 *
 * `ToolChrome` now wraps exactly three surfaces: the 404, the
 * `host_disabled` placeholder and the `blocked` placeholder. The
 * embeddable shell and the consent gate do NOT come through here any
 * more — #911 gave those the whole viewport, so this column exists for
 * the surfaces where a visitor is NOT using a Tool and therefore still
 * needs the site chrome to leave.
 *
 * The page is a full-height column: `PublicNav` and the breadcrumb band
 * keep their natural height, and whatever comes after them is the
 * placeholder's own area. `minHeight: '100dvh'` (not `height`) so a
 * short viewport can still grow the document rather than clip the
 * chrome, and the content area carries `minHeight: '0'` so the flex
 * track is allowed to give it exactly the leftover space instead of the
 * content's intrinsic height.
 */
const toolColumn = css({
	display: 'flex',
	flexDirection: 'column',
	minHeight: '100dvh',
});

/**
 * The Tool's own area: no chrome, no subtraction.
 *
 * `height: '100dvh'` is the whole contract #911 asks for. The
 * pre-#911 version was `flex: '1 1 auto'` + `min-height: 0` inside
 * `ToolChrome`'s `100dvh` column, i.e. `viewport - chrome`; with the
 * chrome gone there is nothing left to subtract from, and keeping a
 * flex track would only reintroduce the intrinsic-150px iframe
 * problem the flex was there to solve. A definite `100dvh` parent also
 * lets the iframe use `height: '100%'` instead of growing into a flex
 * track.
 */
const frameArea = css({
	width: '100%',
	height: '100dvh',
	minWidth: '0',
	overflow: 'hidden',
});

/**
 * The consent gate's own area (Issue #498 / #911): chrome-free and
 * viewport-tall.
 *
 * `minHeight` rather than `height` on purpose: the notice lists the
 * origins the frame may contact plus the declared purpose, and at 390px
 * that content is taller than a phone viewport. A fixed `100dvh` here
 * would clip it behind `overflow: hidden` — the gate must be readable
 * and scrollable even though the frame it guards is exactly one
 * viewport tall.
 */
const gateArea = css({
	width: '100%',
	minHeight: '100dvh',
	minWidth: '0',
});

function ToolChrome({ children }: { children: ReactNode }) {
	return (
		<div className={toolColumn}>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			{children}
		</div>
	);
}

/**
 * Empty state for `/tools/<unknown>` (Issue #183).
 *
 * Renders inside the same `<Outlet />` slot the iframe would occupy,
 * with the chrome every non-Tool state keeps (`ToolChrome`, #911). The
 * breadcrumb chain stops at "Home > Tools": `route-labels.ts` marks this
 * route `dropOnMissingLoaderData`, so a slug that is not in the registry
 * never produces a stub leaf in the chain.
 *
 * This route deliberately renders no `<main>` landmark. `nav` and
 * `main` are separate decisions: restoring / removing the chrome does
 * not create a content landmark, and both `e2e/compat/contract.ts` and
 * `scripts/check-a11y-heading-landmarks.mjs` register `main: 'none'`
 * for the Tools surfaces.
 */
function ToolNotFound() {
	return (
		<ToolChrome>
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
								// Issue #887: `text.accent` is ink now, so the
								// underline carries the affordance and hover
								// fattens it instead of repainting the ink.
								color: 'text.accent',
								textDecoration: 'underline',
								textUnderlineOffset: '0.18em',
								textDecorationThickness: '1px',
								_hover: { textDecorationThickness: '2px' },
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
		</ToolChrome>
	);
}

function ToolRoute() {
	const loaderData = Route.useLoaderData();
	if (loaderData.state === 'disabled') {
		return <DisabledPlaceholder tool={loaderData.tool} />;
	}
	if (loaderData.state === 'blocked') {
		return (
			<BlockedPlaceholder
				tool={loaderData.tool}
				violations={loaderData.violations}
				privacyViolations={loaderData.privacy.violations}
			/>
		);
	}
	const { tool, public: summary, privacy } = loaderData;
	return (
		<ToolEmbedGate
			slug={tool.slug}
			displayName={tool.display_name}
			privacy={privacy}
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
 * Consent gate in front of the frame (Issue #498).
 *
 * The gate owns exactly one piece of state: whether the visitor has
 * activated the load. Until then the document carries the notice and
 * no frame — which is what makes "no third-party request before
 * activation" a structural property of the route rather than a promise
 * in the copy (asserted in `test/integration/embed-privacy.test.ts`).
 *
 * The state is deliberately NOT persisted: no cookie, no
 * `localStorage`, no server-side record. A consent store would be a new
 * published data surface with its own retention story, and this Issue
 * does not need one — see `docs/tools/embed-privacy.md` §5.
 */
function ToolEmbedGate({
	slug,
	displayName,
	privacy,
	src,
	sandbox,
	referrerPolicy,
	allow,
	hostMessage,
}: {
	slug: string;
	displayName: string;
	privacy: EmbedPrivacyVerdict;
	src: string;
	sandbox?: string | undefined;
	referrerPolicy: string;
	allow?: string | undefined;
	hostMessage: ToolHostMessageDeclaration | undefined;
}) {
	const [activated, setActivated] = useState(false);

	if (privacy.consent === CONSENT_MODE_CLICK_TO_LOAD && !activated) {
		// Owner decision 2026-11-05 (Issue #911): the gate is part of
		// the Tool's own surface, so it no longer carries the site
		// chrome — the notice owns the viewport on its own.
		// `ToolConsentNotice` itself was always chrome-free (it is also
		// a Storybook fixture); the route decides what wraps it.
		return (
			<div className={gateArea}>
				<ToolConsentNotice
					displayName={displayName}
					contacts={privacy.contacts_after_activation}
					purpose={declaredPurpose(slug)}
					frameIsThirdParty={privacy.frame_is_third_party}
					onActivate={() => setActivated(true)}
				/>
			</div>
		);
	}

	return (
		<ToolEmbedShell
			slug={slug}
			displayName={displayName}
			src={src}
			sandbox={sandbox}
			referrerPolicy={referrerPolicy}
			allow={allow}
			hostMessage={hostMessage}
			consentState={activated ? 'granted' : 'not-required'}
		/>
	);
}

/**
 * The declared purpose for a Tool, read from the manifest entry the
 * verdict was derived from. `evaluateEmbedPrivacy` already refuses a
 * Tool that declares contacts without a purpose in both locales, so a
 * blocked entry never reaches the gate and this cannot render an empty
 * purpose under a list of origins.
 */
/**
 * Whether the manifest's capability grant names `fullscreen`.
 *
 * The grant is the ONE field that decides it (`delivery.iframe.allow`,
 * Issue #449 / #465): the container half of a fullscreen permission is
 * the HTML `allowfullscreen` attribute on the iframe, and the policy
 * half is the `allow="fullscreen"` delegation plus the response header
 * — all three are derived from this declaration, so a Tool cannot get
 * one half without the others.
 */
function grantsFullscreen(allow: string | undefined): boolean {
	return (allow ?? '').split(/\s+/).some((token) => token.trim().toLowerCase() === 'fullscreen');
}

function declaredPurpose(slug: string): { ja: string; en: string } | undefined {
	const tool = getTool(slug);
	if (!tool || tool.delivery.kind === 'host_disabled') return undefined;
	const purpose = tool.delivery.privacy?.purpose;
	return purpose ? { ja: purpose.ja, en: purpose.en } : undefined;
}

/**
 * The embeddable state (Issue #465).
 *
 * Three responsibilities:
 *
 *   1. Render the iframe with the manifest's DECLARED referrer policy
 *      and capability grant (`allow`) — no defaults, no client-side
 *      "upgrade". A first-party `same_origin_static` Tool declares no
 *      sandbox (ADR-0020), so `sandbox` is `undefined` and React omits
 *      the attribute; only an `external_exception` frame renders one.
 *      `allow` remains the Permissions-Policy delegation for either
 *      kind (see `docs/tools/embed-policy.md` §2).
 *   2. Host the message channel. `useToolHostMessage` attaches a
 *      `message` listener only when the manifest declares
 *      `delivery.host_message`; otherwise there is no listener at all.
 *      `onToolMessage` is the only host action a Tool can trigger, and
 *      it is a no-op seam today: no Tool declares a contract, so the
 *      effect body never runs. It exists so the contract is complete
 *      (declaration → origin-exact, type-allowlisted channel) rather
 *      than a stub that a future Tool has to re-invent.
 *   3. Own the viewport (owner decision 2026-11-05 — Issue #911): the
 *      shell renders no `PublicNav` / breadcrumb band and gives the
 *      frame the full `100dvh`. This is the one state a visitor
 *      actually uses a Tool in, which is exactly why the owner took
 *      the chrome off it.
 */
function ToolEmbedShell({
	slug,
	displayName,
	src,
	sandbox,
	referrerPolicy,
	allow,
	hostMessage,
	consentState,
}: {
	slug: string;
	displayName: string;
	src: string;
	sandbox?: string | undefined;
	referrerPolicy: string;
	allow?: string | undefined;
	hostMessage: ToolHostMessageDeclaration | undefined;
	consentState?: 'granted' | 'not-required' | undefined;
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
		// Owner decision 2026-11-05 (Issue #911): no `ToolChrome` — the
		// Tool gets the viewport. `frameArea` is a definite `100dvh`, so
		// there is no subtraction layout left to do and no chrome height
		// the frame can be shorter or taller than.
		<div
			data-route="tools/$slug"
			data-tool-slug={slug}
			data-tool-consent={consentState ?? 'not-required'}
			className={frameArea}
		>
			<iframe
				ref={frameRef}
				title={`${displayName} Tool`}
				src={src}
				// ADR-0020: `undefined` for a first-party Tool, so
				// React renders NO `sandbox` attribute. A sandbox on a
				// `same_origin_static` entry is a build-time violation
				// (`embed.sandbox.not-allowed-for-first-party`), not a
				// weaker declaration.
				sandbox={sandbox}
				referrerPolicy={referrerPolicy as HTMLAttributeReferrerPolicy}
				// Issue #465: render the DECLARED capability grant.
				// `allow` is the Permissions-Policy delegation; since
				// Issue #449 the matching response header IS sent: the
				// shell route goes through `toolRouteSecurityPolicy()`
				// in `src/server.ts` and `public/_headers` carries the
				// grant for `/tools/<slug>/app/**` (see
				// `docs/security/security-headers.md` §3). See
				// `docs/tools/embed-policy.md` §2.
				allow={allow}
				// Issue #817: the Permissions-Policy half of the
				// fullscreen grant (`allow="fullscreen"` + the
				// response header) is not enough on its own —
				// Chromium reads the CONTAINER half, the HTML
				// `allowfullscreen` attribute, before it lets the
				// framed document call requestFullscreen(). The
				// attribute is derived from the same manifest
				// declaration, so the two halves cannot disagree.
				allowFullScreen={grantsFullscreen(allow)}
				style={{
					width: '100%',
					// Definite because `frameArea` is a definite
					// `100dvh` — a percentage height resolves against
					// it, so the frame IS the viewport (#911).
					height: '100%',
					border: '0',
					display: 'block',
				}}
			/>
		</div>
	);
}

/**
 * Blocked state (Issue #465) — the manifest entry violates the host
 * embed policy, so the host renders NO iframe.
 *
 * This is the fail-closed surface: a sandbox declared on a first-party
 * entry, a bad external sandbox token, a missing referrer policy, or a
 * frame `src` whose origin contradicts the delivery kind stops at this
 * page instead of at the browser. Each violation code is rendered so
 * the fix is mechanical.
 *
 * It carries the site chrome (`ToolChrome`, owner decision
 * 2026-11-01, kept by the owner decision of 2026-11-05 — Issue
 * #911): a blocked Tool shows no Tool, so #911's chrome removal does
 * not apply here, and this is the surface where a visitor most needs
 * a way out.
 */
function BlockedPlaceholder({
	tool,
	violations,
	privacyViolations,
}: {
	tool: ManifestTool;
	violations: readonly EmbedViolation[];
	privacyViolations: readonly EmbedPrivacyViolation[];
}) {
	// Issue #498: embed violations and third-party-contact violations
	// share one list. They are different contracts with different
	// authors, but a blocked frame has exactly one fix path, and two
	// lists would only make that path slower to read.
	const allViolations = [
		...violations.map((entry) => ({ code: entry.code, message: entry.message })),
		...privacyViolations.map((entry) => ({ code: entry.code, message: entry.message })),
	];
	return (
		<ToolChrome>
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
								この Tool はホストの埋め込みポリシー（referrerPolicy / origin 契約）または
								第三者通信の契約に違反するため、iframe は描画されません。
								<br />
								This Tool is not embedded: its registry entry violates the host embed policy or the
								third-party contact contract, so the host renders no iframe. The violations are
								listed below.
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
						{allViolations.map((v) => (
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
								// Issue #887: `text.accent` is ink now, so the
								// underline carries the affordance and hover
								// fattens it instead of repainting the ink.
								color: 'text.accent',
								textDecoration: 'underline',
								textUnderlineOffset: '0.18em',
								textDecorationThickness: '1px',
								_hover: { textDecorationThickness: '2px' },
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
		</ToolChrome>
	);
}

/**
 * Placeholder for `/tools/<host_disabled_slug>` (Issue #195).
 *
 * The `/tools` index lists every manifest entry; a user clicking
 * through to a `host_disabled` Tool must reach a meaningful
 * response (this placeholder) rather than a 404. The Tool name and
 * public Japanese description come from the manifest via `getTool()`.
 * `disabled_reason` is operator documentation (Issue #836): it names
 * build/repo facts a visitor cannot act on, so it stays in the
 * manifest and never reaches this surface.
 *
 * It carries the site chrome (`ToolChrome`, owner decision
 * 2026-11-01, kept by the owner decision of 2026-11-05 — Issue
 * #911): the fullscreen treatment applies to surfaces that SHOW a
 * Tool, and a 「準備中」 page shows none — dropping the site nav there
 * would strand the visitor on the one surface that has nothing to do.
 */
function DisabledPlaceholder({ tool }: { tool: DisabledToolView }) {
	return (
		<ToolChrome>
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
						description={tool.description_ja}
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
								// Issue #887: `text.accent` is ink now, so the
								// underline carries the affordance and hover
								// fattens it instead of repainting the ink.
								color: 'text.accent',
								textDecoration: 'underline',
								textUnderlineOffset: '0.18em',
								textDecorationThickness: '1px',
								_hover: { textDecorationThickness: '2px' },
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
		</ToolChrome>
	);
}
