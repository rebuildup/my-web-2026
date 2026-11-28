import { createFileRoute } from '@tanstack/react-router';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { ActivityPage } from './activity/ActivityPage';
import { getActivityPageData } from './activity/load';

/**
 * `/activity` — the unified activity timeline (Issue #352).
 *
 * Thin route per the obligation contract: the loader
 * (`src/routes/activity/load.ts`) composes the GitHub public
 * projection and the public portfolio index through the
 * `src/activity` adapters and merge, the assembly rules live in
 * `src/routes/activity/assemble.ts`, and the page composition is
 * `src/routes/activity/ActivityPage.tsx`. This file owns only the
 * framework contract — path, loader, head metadata, and the shared
 * chrome (`PublicNav` / `Breadcrumbs` / `BreadcrumbJsonLd`), same
 * convention as `src/routes/stack.tsx`.
 *
 * Index policy: public and indexable (`index: crawl`), but not a
 * `PUBLIC_NAV_ITEMS` destination and therefore not listed in
 * `SITEMAP_ENTRIES` — it is reached from the home site guide and
 * discovered by crawling, same class as `/stack`, `/keyboard`,
 * `/links` and `/commission` (see `scripts/_index-boundary.mjs`,
 * `src/http/seo/sitemap.ts` `SITEMAP_EXCLUSIONS`, and
 * `scripts/publication-surface.mjs`).
 *
 * The canonical literal stays readable here because
 * `scripts/check-index-boundary.mjs` cross-checks it textually.
 */
export const Route = createFileRoute('/activity')({
	loader: () => getActivityPageData(),
	head: () => {
		const title = '活動の記録 / Activity — rebuildup.dev';
		const description =
			'GitHub のリリースと Portfolio の公開作品を編集した活動記録。観測窓の計測値・選定作品・直近のリリースをハイライトし、全記録の時系列アーカイブを畳んで保管します。';
		const url = 'https://rebuildup.dev/activity';
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
	component: ActivityRoute,
});

function ActivityRoute() {
	const model = Route.useLoaderData();
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			<ActivityPage model={model} />
		</>
	);
}
