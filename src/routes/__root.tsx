import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/**
 * Root route. Defines the document shell shared by every page.
 *
 * The HTML structure stays minimal — styling is delegated to Panda CSS
 * (see `src/styles.css`).
 */
export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'my-web-2026' },
		],
	}),
	component: RootComponent,
});

function RootComponent() {
	return (
		<html lang="ja">
			<head>
				<HeadContent />
			</head>
			<body>
				<RootLayout>{<Outlet />}</RootLayout>
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
