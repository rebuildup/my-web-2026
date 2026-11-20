import { createFileRoute } from '@tanstack/react-router';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { StackPage } from './stack/StackPage';
import { getStackPageData } from './stack/load';

/**
 * `/stack` — the site's actual development stack, explained (Issue #381).
 *
 * Thin route per the obligation contract: the article data lives in
 * `src/routes/stack/stack.ts` (repo-controlled sections and items,
 * designed so later Issues append sections without restructuring)
 * and the version resolution in `src/routes/stack/load.ts` (the
 * loader reads `package.json` and `quality/profile.yaml` at request
 * time, so no version literal can drift from its source). The page
 * composition is `src/routes/stack/StackPage.tsx`. This file owns
 * only the framework contract — path, loader, head metadata, and
 * the shared chrome (`PublicNav` / `Breadcrumbs` / `BreadcrumbJsonLd`),
 * same convention as `src/routes/links.tsx` and
 * `src/routes/commission.tsx`.
 *
 * Deliberately NOT in `PUBLIC_NAV_ITEMS` and NOT in
 * `SITEMAP_ENTRIES`: it is a reference surface reached from `/about`,
 * same class as `/keyboard`, `/links` and `/commission` (see
 * `scripts/_index-boundary.mjs`, `src/http/seo/sitemap.ts`
 * `SITEMAP_EXCLUSIONS`, and `scripts/publication-surface.mjs`).
 *
 * The canonical literal stays readable here because
 * `scripts/check-index-boundary.mjs` cross-checks it textually.
 */
export const Route = createFileRoute('/stack')({
	loader: () => getStackPageData(),
	head: () => {
		const title = '開発スタック / Stack — rebuildup.dev';
		const description =
			'my-web-2026 を動かしている runtime・framework・データ層・開発ツールの一覧。version は package.json と profile.yaml から読み取り、各項目に根拠 source へのリンクを付けています。';
		const url = 'https://rebuildup.dev/stack';
		return {
			meta: [
				{ charSet: 'utf-8' },
				{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
				{ title },
				{ name: 'description', content: description },
				{ property: 'og:type', content: 'website' },
				{ property: 'og:title', content: title },
				{ property: 'og:description', content: description },
				{ property: 'og:url', content: url },
			],
			links: [{ rel: 'canonical', href: url }],
		};
	},
	component: StackRoute,
});

function StackRoute() {
	const data = Route.useLoaderData();
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			<StackPage data={data} />
		</>
	);
}
