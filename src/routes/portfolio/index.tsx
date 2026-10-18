import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { z } from 'zod';
import { PublicNav } from '../../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../../editorial/nav/Breadcrumbs.styles';
import { composeSocialCard, socialCardUrl } from '../../editorial/social-card';
import { PortfolioList } from '../../portfolio/components';
import { listPortfolioProjects } from '../../portfolio/public';
import {
	FacetSchema,
	type PortfolioFacet,
	type PortfolioListPage,
	type PortfolioProject,
} from '../../portfolio/schema';

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
 *   `?cursor=<opaque>`         cursor for the next page (set by
 *                              the route after the first load)
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
});

export const Route = createFileRoute('/portfolio/')({
	validateSearch: (search) => SearchSchema.parse(search ?? {}),
	loaderDeps: ({ search }) => ({ facets: search.facets }),
	loader: async ({ deps }) => {
		const activeFacets = parseFacets(deps.facets);
		const page = await listPortfolioProjects({
			data: { facets: activeFacets.length > 0 ? activeFacets : undefined },
		});
		return { initialPage: page, activeFacets };
	},
	head: ({ loaderData }) => {
		const title = 'Portfolio — rebuildup.dev';
		const description =
			'主要な制作物、技術選定、設計、成果、振り返り。facet で絞り込み、各 project の詳細ページから repository / release / 解説へ。';
		const url = socialCardUrl('/portfolio');
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
	const { initialPage, activeFacets } = Route.useLoaderData();
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
			<PortfolioList
				initialPage={initialPage}
				activeFacets={activeFacets}
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
 * no project or no project resolves a public image URL. Returning
 * null (rather than a partially-built image) is what keeps the
 * fallback branch honest: the list cannot publish a card that names a
 * project it did not render.
 */
function firstProjectCover(projects: readonly PortfolioProject[]) {
	for (const project of projects) {
		const media = project.media.find((m) => m.isCover) ?? project.media[0];
		if (!media) continue;
		return { url: media.url, alt: media.alt, width: media.width, height: media.height };
	}
	return null;
}
