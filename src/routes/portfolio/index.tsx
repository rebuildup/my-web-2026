import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { z } from 'zod';
import { PublicNav } from '../../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../../editorial/nav/Breadcrumbs.styles';
import { composeSocialCard } from '../../editorial/social-card';
import { HOME_REACTIONS_TARGET, getHomeReactions } from '../../home/public';
import { ReactionsWidget } from '../../home/reactions/widget';
import { PortfolioList } from '../../portfolio/components';
import { listPortfolioProjects } from '../../portfolio/public';
import {
	FacetSchema,
	type PortfolioFacet,
	type PortfolioListPage,
	type PortfolioProject,
} from '../../portfolio/schema';
import { parsePortfolioView } from '../../portfolio/views';

/** Target key for the portfolio list page reactions. */
export const PORTFOLIO_REACTIONS_TARGET = 'portfolio-list';
/**
 * `/portfolio` — list route (Issue #77, Issue #199).
 *
 * The route owns the server-fn call so client bundles do not
 * transitively pull `cloudflare:workers`. The `loader` runs on
 * the Worker at request time, returns the first page, and the
 * page component fetches further pages through `useServerFn` on
 * demand.
 *
 * URL search-param contract:
 *   `?facets=develop,design`  any-of filter (closed enum)
 *   `?view=develop|video|design`  exhibition mode (Issue #1048;
 *                              absent = `all`, the card grid)
 *   `?cursor=<opaque>`         cursor for the next page (set by
 *                              the route after the first load)
 *
 * `facets` and `view` are orthogonal: facets filter the catalogue,
 * the view decides how the filtered set is exhibited, so a view
 * change never refetches and never appears in `loaderDeps`.
 *
 * Both are validated server-side. Malformed cursors fall back to
 * the first page per Decision 4; malformed facets are dropped.
 *
 * Chrome convention (Issue #199). The `<PublicNav />`,
 * `<Breadcrumbs />`, and `<BreadcrumbJsonLd />` components are
 * imported and rendered here explicitly rather than mounted at the
 * `__root` level — see `src/routes/about.tsx` for the rationale.
 */

const SearchSchema = z.object({
	facets: z.string().optional(),
	view: z.string().optional(),
});

export const Route = createFileRoute('/portfolio/')({
	validateSearch: (search) => SearchSchema.parse(search ?? {}),
	loaderDeps: ({ search }) => ({ facets: search.facets }),
	loader: async ({ deps }) => {
		const activeFacets = parseFacets(deps.facets);
		// Issue #1000: the two reads are independent — awaiting them in
		// sequence added a full server-fn round trip to every list load.
		const [page, reactions] = await Promise.all([
			listPortfolioProjects({
				data: { facets: activeFacets.length > 0 ? activeFacets : undefined },
			}),
			getHomeReactions({ data: { target: PORTFOLIO_REACTIONS_TARGET } }),
		]);
		return { initialPage: page, activeFacets, reactions };
	},
	head: ({ loaderData }) => {
		const title = 'Portfolio — rebuildup.dev';
		const description =
			'主要な制作物、技術選定、設計、成果、振り返り。facet で絞り込み、各 project の詳細ページから repository / release / 解説へ。';
		// Literal for the same reason as /about: the index-boundary gate
		// matches this canonical against the sitemap entry (Issue #423).
		const url = 'https://rebuildup.dev/portfolio';
		// The list card is the first public project that actually
		// publishes a cover; with no project on this page yet it is
		// null and `composeSocialCard` publishes the site fallback card
		// instead of dropping `og:image` (Issue #421).
		const card = composeSocialCard({
			title,
			description,
			url,
			ogType: 'website',
			image: loaderData ? firstProjectCover(loaderData.initialPage.projects) : null,
		});
		return {
			meta: [
				{ charSet: 'utf-8' },
				{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
				{ title },
				{ name: 'description', content: description },
				...card.meta,
			],
			links: [{ rel: 'canonical', href: url }],
		};
	},
	component: PortfolioRoute,
});

function PortfolioRoute() {
	const { activeFacets } = Route.useLoaderData();
	// Issue #1000: `extra` / `cursor` are client-side pagination state
	// for ONE facet query. When the facet set changes the loader
	// returns a new first page, but React keeps the component mounted
	// — without a remount the previous filter's loaded pages and
	// cursor would render under the new filter. Keying the view on
	// the facet set resets that state exactly when the query changes.
	return <PortfolioFacetView key={activeFacets.join(',')} />;
}

function PortfolioFacetView() {
	const { initialPage, activeFacets, reactions } = Route.useLoaderData();
	// Issue #1048: the exhibition view is presentation, not query — it
	// is read from the validated search params here rather than the
	// loader, so switching views never refetches the catalogue.
	const { view: rawView } = Route.useSearch();
	const view = parsePortfolioView(rawView);
	const [extra, setExtra] = useState<PortfolioProject[]>([]);
	const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const loadMore = useServerFn(listPortfolioProjects);

	const onLoadMore = async () => {
		if (!cursor) return;
		setBusy(true);
		setError(null);
		try {
			const page: PortfolioListPage = await loadMore({
				data: {
					facets: activeFacets.length > 0 ? [...activeFacets] : undefined,
					cursor,
				},
			});
			setExtra((prev) => [...prev, ...page.projects]);
			setCursor(page.nextCursor);
		} catch (err) {
			setError((err as Error).message ?? 'failed to load more');
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			<ReactionsWidget data={reactions} />
			<PortfolioList
				initialPage={initialPage}
				activeFacets={activeFacets}
				view={view}
				hasMore={cursor !== null}
				busy={busy}
				error={error}
				extra={extra}
				onLoadMore={onLoadMore}
			/>
		</>
	);
}

function parseFacets(raw: string | undefined): PortfolioFacet[] {
	if (!raw) return [];
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter((s): s is PortfolioFacet => FacetSchema.options.some((o) => o === s));
}

/**
 * The first published cover on the list, or `null` when the page has
 * no project or no project resolves a public image URL. A media row
 * whose `composeMediaUrl` returned `null` is skipped so the walk
 * continues to the next project rather than stopping the list on an
 * unusable row. Returning null (rather than a partially-built image)
 * is what keeps the fallback branch honest: the list cannot publish a
 * card that names a project it did not render.
 */
function firstProjectCover(projects: readonly PortfolioProject[]) {
	for (const project of projects) {
		const media = project.media.find((m) => m.isCover) ?? project.media[0];
		if (!media?.url) continue;
		return { url: media.url, alt: media.alt, width: media.width, height: media.height };
	}
	return null;
}
