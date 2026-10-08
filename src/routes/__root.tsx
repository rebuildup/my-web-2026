import { HeadContent, Outlet, Scripts, createRootRoute, useLocation } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';
import type { ReactNode } from 'react';
import { GoogleAnalytics } from '../editorial/analytics/GoogleAnalytics';
import '../styles.css';

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
 * `GoogleAnalytics` only when the current pathname is NOT under
 * `/admin/*` — the admin gates are flat siblings under that prefix
 * (`admin.login`, `admin.keys`, `admin.images`,
 * `admin.invitations`, `admin.emoji-catalog`). See
 * `src/editorial/analytics/GoogleAnalytics.tsx` for the component
 * contract and the SSR-capture singleton semantics.
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
				// Applies the non-blocking font stylesheet above. Written to
				// be order-independent with respect to the <link>: if the
				// sheet is already parsed (`sheet` set) it flips immediately,
				// otherwise it waits for `load`, and if this script runs
				// before the <link> exists at all it retries once at
				// `DOMContentLoaded`.
				children:
					'(function(){var f=function(){var l=document.querySelector(\'link[rel="stylesheet"][media="print"]\');if(!l)return false;if(l.sheet){l.media="all";return true}l.addEventListener("load",function(){l.media="all"});return true};if(!f())document.addEventListener("DOMContentLoaded",f)})();',
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
	const { pathname } = useLocation();
	const isAdminPath = pathname.startsWith('/admin');
	return (
		<html lang="ja">
			<head>
				<HeadContent />
				{!isAdminPath ? <GoogleAnalytics measurementId={gaMeasurementId} /> : null}
			</head>
			<body>
				<RootLayout>
					<Outlet />
				</RootLayout>
				<Scripts />
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
