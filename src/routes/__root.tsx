import { HeadContent, Outlet, Scripts, createRootRoute, useLocation } from '@tanstack/react-router';
import { env } from 'cloudflare:workers';
import type { ReactNode } from 'react';
import { GoogleAnalytics } from '../editorial/analytics/GoogleAnalytics';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { PublicNav } from '../editorial/nav';
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
		links: [
			{ rel: 'preconnect', href: 'https://fonts.googleapis.com' },
			{
				rel: 'preconnect',
				href: 'https://fonts.gstatic.com',
				crossorigin: 'anonymous',
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
				{/*
				 * BreadcrumbList JSON-LD lives in `<head>` so search
				 * engines see it alongside the rest of the page
				 * metadata. `BreadcrumbJsonLd` resolves the same
				 * chain the visible nav shows — Issue #173.
				 */}
				<BreadcrumbJsonLd />
			</head>
			<body>
				<RootLayout>
					{/*
					 * The visible breadcrumb nav sits above the page
					 * content. The component returns `null` on
					 * suppressed leaves (home + auth pages) so the
					 * layout is unaffected there.
					 */}
					<Breadcrumbs />
					<Outlet />
				</RootLayout>
				<Scripts />
			</body>
		</html>
	);
}

function RootLayout({ children }: { children: ReactNode }) {
	const { pathname } = useLocation();
	// The admin area owns its own chrome (the `/admin` layout is a
	// pure `<Outlet />` and each admin route is a self-contained
	// surface — adding a public nav next to it would defeat the
	// signed-in / signed-out split). Mount `PublicNav` for every
	// other route.
	const isAdmin = pathname.startsWith('/admin');
	return (
		<div id="app-root" data-app="my-web-2026">
			{isAdmin ? null : <PublicNav />}
			{children}
		</div>
	);
}
