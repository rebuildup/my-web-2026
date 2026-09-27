import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { z } from 'zod';
import { listPortfolioProjects } from '../../portfolio/public';
import {
	FacetSchema,
	type PortfolioFacet,
	type PortfolioListPage,
	type PortfolioProject,
} from '../../portfolio/schema';
import { PortfolioList } from '../../portfolio/components';

/**
 * `/portfolio` — list route (Issue #77).
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
		const ogImage = loaderData ? deriveOgImage(loaderData.initialPage.projects) : undefined;
		return {
			meta: [
				{ charSet: 'utf-8' },
				{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
				{ title },
				{ name: 'description', content: description },
				{ property: 'og:type', content: 'website' },
				{ property: 'og:title', content: title },
				{ property: 'og:description', content: description },
				{ property: 'og:url', content: 'https://rebuildup.dev/portfolio' },
				...(ogImage
					? [
							{ property: 'og:image', content: ogImage },
							{ name: 'twitter:card', content: 'summary_large_image' },
						]
					: []),
			],
			links: [{ rel: 'canonical', href: 'https://rebuildup.dev/portfolio' }],
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
		<PortfolioList
			initialPage={initialPage}
			activeFacets={activeFacets}
			hasMore={cursor !== null}
			busy={busy}
			error={error}
			extra={extra}
			onLoadMore={onLoadMore}
		/>
	);
}

function parseFacets(raw: string | undefined): PortfolioFacet[] {
	if (!raw) return [];
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter((s): s is PortfolioFacet => FacetSchema.options.some((o) => o === s));
}

function deriveOgImage(projects: readonly PortfolioProject[]): string | undefined {
	const cover = projects.find((p) => p.media.some((m) => m.isCover));
	if (!cover) return undefined;
	const media = cover.media.find((m) => m.isCover) ?? cover.media[0];
	return media?.url ?? undefined;
}
