import { createFileRoute } from '@tanstack/react-router';
import { LinksPage } from '../about/components';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';

/**
 * `/links` — verified external-link inventory (Issue #390).
 *
 * Thin route per the obligation contract: the inventory lives in
 * `src/about/links.ts` (repo-controlled, owner-published accounts
 * carried over from the predecessor site's link list) and the
 * composition in `src/about/components/LinksPage.tsx`. The route
 * owns only the framework contract — path, loader-free render,
 * head metadata, and the shared chrome (`PublicNav` /
 * `Breadcrumbs` / `BreadcrumbJsonLd`), same convention as
 * `src/routes/contact.tsx` and `src/routes/keyboard.tsx`.
 *
 * Deliberately NOT in `PUBLIC_NAV_ITEMS` and NOT in
 * `SITEMAP_ENTRIES`: it is a destination reached from `/about`,
 * not a primary nav surface (same class as `/keyboard` and
 * `/projects/dotfiles` — see `scripts/_index-boundary.mjs` and
 * `src/http/seo/sitemap.ts#SITEMAP_EXCLUSIONS`).
 *
 * The canonical literal stays readable here because
 * `scripts/check-index-boundary.mjs` cross-checks it textually.
 */
export const Route = createFileRoute('/links')({
	head: () => {
		const title = 'リンク集 / Links — rebuildup.dev';
		const description =
			'公開している外部アカウントとサイト内ページの一覧。連絡先は /contact の verified channel を参照。';
		const url = 'https://rebuildup.dev/links';
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
	component: LinksRoute,
});

function LinksRoute() {
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			<LinksPage />
		</>
	);
}
