import { env } from 'cloudflare:workers';
import { HeadContent, Outlet, Scripts, createRootRoute, useLocation } from '@tanstack/react-router';
import { type ReactNode, Suspense, lazy } from 'react';
import { AnalyticsConsentControl, AnalyticsGate } from '../editorial/analytics/AnalyticsConsent';
import { isAnalyticsMountPath } from '../editorial/analytics/consent';
import '../styles.css';
// Issue #764 comparison preview (WORKTREE ONLY — delete with the worktree).
// Lazy on purpose: the harness must not add bytes to the shipped shell, so the
// module is only fetched on a `?direction=` URL, after hydration.
const PreviewMount = lazy(() =>
	import('../preview/PreviewMount').then((m) => ({ default: m.PreviewMount })),
);
import { parsePreview } from '../preview/preview-css.mjs';

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
		// Google Fonts: Noto Sans JP (body) + Zen Kaku Gothic New
		// (display / heading, applied via the `heading` font token to
		// h1/h2/h3 and large-size elements). Loaded with `display=swap`
		// so first paint shows the platform Japanese fallback
		// (`Hiragino Kaku Gothic ProN` / `system-ui`) while the webfont
		// streams in. The two `preconnect`s cut the TLS handshake off
		// the critical font path.
		//
		// Issue #291 — the font stylesheet used to be render-blocking and
		// it was the first-paint gate for the whole page. Measured on the
		// production build served by `vite preview`:
		//   first-contentful-paint 356 ms with the request live,
		//   first-contentful-paint  36 ms with `fonts.googleapis.com`
		//   blocked outright.
		// i.e. ~320 ms of the opening white interval was bought by a
		// third-party CSS request (Google returns ~570 kB of expanded
		// unicode-range rules for the Japanese faces).
		//
		// The fix is the standard async-CSS pattern: `media="print"` so the
		// browser fetches the sheet without letting it block render, and a
		// tiny parser-blocking `<script>` (below) that flips it back to
		// `media="all"` the moment it lands so the font stack applies.
		// `display=swap` is untouched — the swap window simply opens
		// earlier instead of holding the whole page hostage.
		//
		// React cannot own the flip: an `onload` string attribute is
		// dropped by `HeadContent`, and a React `onLoad` handler only
		// attaches after hydration, by which time the `load` event has
		// already fired. The inline script has neither problem and is the
		// reason this is a script rather than a prop.
		//
		// Trade-off: with scripting disabled the sheet stays at
		// `media="print"`, so a no-JS visitor reads the page in the
		// platform fallback stack — the same face `display=swap` already
		// shows for the first few hundred ms for everyone else.
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
			{ rel: 'preconnect', href: 'https://fonts.googleapis.com' },
			{
				rel: 'preconnect',
				href: 'https://fonts.gstatic.com',
				// `crossOrigin` (camelCase) is the React prop name. The
				// previous lowercase `crossorigin` was passed through as an
				// unknown attribute and produced "Invalid DOM property
				// `crossorigin`" plus a hydration attribute mismatch on
				// every load (Issue #291).
				crossOrigin: 'anonymous',
			},
			{
				rel: 'stylesheet',
				// `wght@400;600;700` — `600` is used widely for
				// eyebrows / Badges / labels / admin table headers; if
				// omitted the browser faux-bolds (or falls back to 700)
				// and the typographic rhythm drifts. `500` is not used
				// in the current type scale and is intentionally dropped from the axis
				// to keep the stylesheet payload minimal.
				href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&family=Zen+Kaku+Gothic+New:wght@400;600;700&display=swap',
				media: 'print',
			},
		],
		scripts: [
			{
				// Issue #764 comparison preview (WORKTREE ONLY). Reads
				// `?direction=b&theme=dark|light`, links the matching
				// static stylesheet into <head>, and does it while the head
				// is still parsing — so the palette is in effect before the
				// first paint and React never owns the node (a <style> or a
				// per-query attribute rendered through the component tree
				// fails React 19 hydration in this shell).
				//
				// owner の決定（2026-11-02）: direction は B だけ。A / C の
				// スタイルシートは削除したので、b 以外の指定は無視する。
				children:
					'(function(){try{var p=new URLSearchParams(location.search);var d=(p.get("direction")||"").toLowerCase();if(d!=="b")return;var t=(p.get("theme")||"").toLowerCase()==="light"?"light":"dark";var h="/preview-assets/dir-"+d+"-"+t+".css";if(document.getElementById("preview-css"))return;var e=document.createElement("link");e.id="preview-css";e.rel="stylesheet";e.href=h;document.head.appendChild(e)}catch(e){}})();',
			},
			{
				// Applies the non-blocking font stylesheet above. Written to
				// be order-independent with respect to the <link>: if the
				// sheet is already parsed (`sheet` set) it flips immediately,
				// otherwise it waits for `load`, and if this script runs
				// before the <link> exists at all it retries — once at
				// `DOMContentLoaded` while the document can still fire it,
				// otherwise on a bounded `requestAnimationFrame` poll.
				//
				// Issue #488 — this script is the ONE element this ticket
				// fixes. TanStack Router merges the root head into every
				// route match, so a client-side navigation re-creates BOTH
				// the `media="print"` <link> and this inline <script>; the
				// browser re-executes the inline body each time. The
				// previous revision ended with
				//
				//     if (!f()) document.addEventListener('DOMContentLoaded', f)
				//
				// so every route change that found no *pending* print link
				// left one more listener on `document` — and after the
				// first document load `DOMContentLoaded` can never fire
				// again, so every one of them was permanently dead. The
				// measurement in `docs/verification/perf/
				// interaction-memory-profile.md` records it as +1 leaked
				// `document` listener per route change, unbounded.
				//
				// The fix keeps the contract (flip whatever print-media
				// stylesheet is currently in the document) and removes the
				// unbounded part:
				//
				//   - the `DOMContentLoaded` fallback is registered ONLY
				//     while `document.readyState === 'loading'`, i.e. only
				//     while the event it waits for is still possible;
				//   - after the document is interactive, a link that is not
				//     in the DOM yet is resolved by a bounded rAF poll
				//     (60 frames ≈ 1 s), which cannot accumulate because it
				//     self-terminates and attaches no listener;
				//   - the per-<link> `load` binding is `once` and guarded by
				//     an expando, so re-running the script against the same
				//     element cannot stack listeners.
				children:
					'(function(){var r=function(){var l=document.querySelector(\'link[rel="stylesheet"][media="print"]\');if(!l)return false;if(l.sheet){l.media="all";return true}if(!l.__myWebFlip){l.__myWebFlip=1;l.addEventListener("load",function(){l.media="all"},{once:true})}return true};if(r())return;if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",r,{once:true});return}var n=0;var t=function(){if(r()||++n>60)return;requestAnimationFrame(t)};requestAnimationFrame(t)})();',
			},
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
	// Issue #764 comparison preview. `?direction=b&theme=dark|light`
	// re-skins the real route; without a query the page is the released one.
	const preview = pathname.startsWith('/compare')
		? { direction: 'b' as const, theme: 'dark' as const, on: false }
		: parsePreview(searchStr);
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
				    `neutral.0` (light) and `charcoal.950` (dark). The
				    manifest's single `theme_color` cannot be
				    appearance-conditional, so it carries the static
				    accent step (`brand.700`) instead. */}
				<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
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
				{/* Issue #764: the palette stylesheet is linked from the head
				    script above (see its comment); this only handles the DOM
				    work React cannot express. */}
				{preview.on ? (
					<Suspense fallback={null}>
						<PreviewMount on />
					</Suspense>
				) : null}
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
