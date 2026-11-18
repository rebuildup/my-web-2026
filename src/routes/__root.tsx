import { env } from 'cloudflare:workers';
import { HeadContent, Outlet, Scripts, createRootRoute, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AnalyticsConsentControl, AnalyticsGate } from '../editorial/analytics/AnalyticsConsent';
import { isAnalyticsMountPath } from '../editorial/analytics/consent';
import { VisitTrailRecorder } from '../home/guide/VisitTrailRecorder';
import '../styles.css';

/**
 * Icon family links (Issue #504).
 *
 * Every entry is a flat object literal with single-quoted string
 * values, because `scripts/check-app-icons.mjs` parses this block to
 * prove the published contract is coherent: every `<link>` here must
 * point at a file that exists at the declared size, must be named by
 * `public/site.webmanifest` or by this list, and must leave no orphan in
 * `public/icons/`. Keep it flat (no spread, no computed values) and keep
 * the files in sync via `pnpm run generate:app-icons`.
 *
 * `rel: 'icon'` (SVG) stays the primary desktop entry from Issue #285 —
 * the PNG entries sit beside it as a raster fallback, because a handful
 * of embedders (and older Safari) still look for a PNG.
 *
 * `apple-touch-icon` covers the iOS sizes that matter: 180 (iPhone),
 * 167 and 152 (iPad), 120 (legacy iOS / Spotlight). iOS ignores
 * `sizes` and picks the largest entry, so each size is a real file
 * rather than one file relabelled four times.
 *
 * The manifest icons (192 / 512 / maskable 512) are deliberately NOT
 * linked here: `public/site.webmanifest` names them itself, and
 * duplicating the list in the document head would create a second
 * place to forget an update.
 *
 * Deliberately absent: `apple-touch-startup-image` (no launch-screen
 * artwork exists) and any offline declaration (see the manifest).
 */
const APP_ICON_LINKS = [
	{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
	{ rel: 'icon', type: 'image/png', sizes: '16x16', href: '/icons/icon-16x16.png' },
	{ rel: 'icon', type: 'image/png', sizes: '32x32', href: '/icons/icon-32x32.png' },
	{
		rel: 'apple-touch-icon',
		type: 'image/png',
		sizes: '120x120',
		href: '/icons/apple-touch-icon-120x120.png',
	},
	{
		rel: 'apple-touch-icon',
		type: 'image/png',
		sizes: '152x152',
		href: '/icons/apple-touch-icon-152x152.png',
	},
	{
		rel: 'apple-touch-icon',
		type: 'image/png',
		sizes: '167x167',
		href: '/icons/apple-touch-icon-167x167.png',
	},
	{
		rel: 'apple-touch-icon',
		type: 'image/png',
		sizes: '180x180',
		href: '/icons/apple-touch-icon-180x180.png',
	},
	{ rel: 'manifest', href: '/site.webmanifest' },
];

/**
 * Root route. Defines the document shell shared by every page.
 *
 * Styling is delegated to Panda CSS (see `src/styles.css`). The
 * side-effect import above is what wires Panda into the SSR'd
 * document head: TanStack Start's dev-server-plugin walks the
 * module graph for each route and bundles CSS dependencies into the
 * `/@tanstack-start/styles.css?routes=…` URL it serves to the
 * browser, so a CSS import made by `__root` shows up there. Without
 * this import, the dev plugin returns 0 bytes for the styles URL
 * because the plugin only collects CSS modules referenced by a
 * route, and Panda CSS is a plain CSS file (see
 * `@tanstack/start-plugin-core/src/vite/dev-server-plugin/dev-styles.ts`,
 * `collectDevStyles`). `client.tsx` keeps its own `import './styles.css'`
 * so production HTML still links the bundled asset via Vite's
 * CSS-extraction transform; the Vite module graph deduplicates
 * the shared `src/styles.css` module so no double bundle.
 *
 * Google Analytics 4 (Issue #171). The root loader reads the GA4
 * measurement ID from `env.GOOGLE_ANALYTICS_MEASUREMENT_ID` during
 * SSR (the `cloudflare:workers` virtual module resolves to the
 * workerd env on the SSR path; on the client it resolves to the
 * frozen empty stub documented in
 * `src/cloudflare/workers-stub.ts`, so subsequent client-side
 * navigations contribute `undefined`). The value flows into
 * `AnalyticsGate` only when the current pathname is NOT under
 * `/admin/*` — the admin gates are flat siblings under that prefix
 * (`admin.login`, `admin.keys`, `admin.images`,
 * `admin.invitations`, `admin.emoji-catalog`). See
 * `src/editorial/analytics/GoogleAnalytics.tsx` for the component
 * contract and the SSR-capture singleton semantics.
 *
 * Analytics consent (Issue #495). `AnalyticsGate` is also the consent
 * gate: it mounts the GA4 script AND the SPA route tracker
 * (`GoogleAnalyticsRouteTracker`, Issue #286) only after a visitor has
 * recorded an affirmative decision, and renders nothing until then —
 * including during SSR, which is why no GA4 markup reaches the HTML a
 * visitor (or a crawler) receives by default. The record is made by
 * `AnalyticsConsentControl` at the end of `<body>`, also on public
 * routes only. See `src/editorial/analytics/consent.ts` for the
 * decision contract and
 * `docs/verification/privacy/analytics-disabled.md` for the
 * verification record.
 *
 * Chrome convention (Issue #199). PublicNav and Breadcrumbs are
 * intentionally NOT mounted here. They are regular components in
 * `src/editorial/nav/` — each page that wants them imports them
 * explicitly and renders them at the position its own design calls
 * for. This is the user-mandated convention: per-page design
 * freedom over a forced uniform nav surface.
 */
export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'my-web-2026' },
		],
		// Webfonts are self-hosted (Issue #876): the woff2 subsets in
		// `public/fonts/` are declared by `@font-face` rules in
		// `src/styles.css` with the same unicode-range partitioning
		// Google Fonts used to serve, so first paint still shows the
		// platform Japanese fallback while the needed subsets stream
		// in — but every request is now same-origin and
		// the page no longer contacts `fonts.googleapis.com` /
		// `fonts.gstatic.com` at all. There is deliberately no font
		// `<link>` or flip script here anymore: the `@font-face` rules
		// live inside the bundled stylesheet, which the browser already
		// fetches for the page itself.
		links: [
			// Icon family (Issue #285 SVG favicon, Issue #504 PNG +
			// Apple Touch Icon + Web App Manifest). `APP_ICON_LINKS`
			// carries the block-level contract; see its docstring.
			//
			// Declared in this `head()`, not in the `<head>` JSX of
			// `RootComponent`, so it flows through TanStack Router's
			// head merge and every page inherits it — including the
			// routes that declare their own `head()`. That is what
			// makes a per-page icon expressible later: a route adds
			// its own `rel: 'icon'` entry in its `head()` links.
			//
			// Measured merge semantics (see Issue #285 PR for the
			// curl evidence): `buildTagsFromMatches` in
			// `@tanstack/router-core` flat-maps `match.links` across
			// the matched routes root-first, then dedupes with
			// `appendUniqueUserTags`, whose key is `JSON.stringify`
			// of the tag — so only byte-identical link tags collapse,
			// while `meta` dedupes by `name`/`property` with the
			// deepest route winning. Because no route declares an
			// icon today, every entry below renders exactly once on
			// every route (root, public pages, admin, and the 404
			// pages).
			...APP_ICON_LINKS,
		],
	}),
	loader: () => {
		const measurementId = (env as { GOOGLE_ANALYTICS_MEASUREMENT_ID?: string })
			.GOOGLE_ANALYTICS_MEASUREMENT_ID;
		return { gaMeasurementId: measurementId };
	},
	component: RootComponent,
});

function RootComponent() {
	const { gaMeasurementId } = Route.useLoaderData();
	const { pathname, searchStr } = useLocation();
	// The `/admin/*` exclusion rule lives in `editorial/analytics/consent.ts`
	// so it can be tested without a router — see `isAnalyticsMountPath`.
	const isAdminPath = !isAnalyticsMountPath(pathname);
	return (
		<html lang="ja">
			<head>
				<HeadContent />
				{/* Issue #504 — the browser-chrome tint, one value per
				    appearance (Issue #290 ships light + dark). Rendered
				    here rather than declared in `head().meta` because
				    TanStack Router dedupes `meta` by `name` with the
				    deepest route winning (see the head-merge note above):
				    two `theme-color` entries in `head()` collapse into
				    one, which is exactly the case the two media queries
				    exist to avoid. The values are the two `bg.canvas`
				    steps from `src/editorial/semantic-tokens.ts`:
				    `neutral.25` (light, Issue #812) and `charcoal.950`
				    (dark). The
				    manifest's single `theme_color` cannot be
				    appearance-conditional, so it carries the static
				    accent step (`brand.700`) instead. */}
				<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fcfcfd" />
				<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0b0e" />
				{/* Measurement (Issue #171) behind the consent gate
				    (Issue #495). `AnalyticsGate` renders nothing — no
				    loader script, no route tracker, no identifier read —
				    until this document carries a granted decision, so the
				    HTML below is the non-tracking default for every public
				    route. The `/admin/*` exclusion stays here, where the
				    router context lives. */}
				{!isAdminPath ? (
					<AnalyticsGate measurementId={gaMeasurementId} locationKey={`${pathname}${searchStr}`} />
				) : null}
			</head>
			<body>
				<RootLayout>
					<Outlet />
				</RootLayout>
				<Scripts />
				{/* Consent control (Issue #495): public routes only — see
				    the comment above. It renders nothing on the server and
				    nothing before hydration, so it can never delay or
				    change the page it sits on. */}
				{!isAdminPath ? <AnalyticsConsentControl /> : null}
				{/* Issue #936 — records public paths into the visitor's
				    own localStorage trail. Public routes only, renders
				    nothing, and every storage failure is swallowed in
				    `recordVisit`. */}
				{!isAdminPath ? <VisitTrailRecorder /> : null}
			</body>
		</html>
	);
}

function RootLayout({ children }: { children: ReactNode }) {
	return (
		<div id="app-root" data-app="my-web-2026">
			{children}
		</div>
	);
}
