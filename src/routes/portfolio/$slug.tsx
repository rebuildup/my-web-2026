import { createFileRoute, notFound } from '@tanstack/react-router';
import { ABOUT_DATA } from '../../about/data';
import { personFactsFromAbout } from '../../about/structured-data';
import { PublicNav } from '../../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../../editorial/nav/Breadcrumbs.styles';
import { composeSocialCard } from '../../editorial/social-card';
import { CreativeWorkJsonLd } from '../../editorial/structured-data';
import { PortfolioDetail } from '../../portfolio/components';
import { loadPortfolioAdjacent, loadPortfolioProject } from '../../portfolio/public';
import { SlugSchema } from '../../portfolio/schema';
import { creativeWorkFactsFromProject } from '../../portfolio/structured-data';

/**
 * `/portfolio/[slug]` — detail route (Issue #77).
 *
 * The route calls `loadPortfolioProject` directly so the slug
 * round-trip is owned by the loader (a draft / unlisted / unknown
 * slug resolves to `null`, which we convert to a 404). The
 * public-visibility boundary enforced by the loader (#76) is
 * preserved here — the page just renders nothing for an
 * invisible slug.
 *
 * Structured data (Issue #422): `<CreativeWorkJsonLd />` projects
 * the loader result — a `public + published` row, so the visibility
 * boundary is inherited by construction. The author is the same
 * approved person identity `/about` emits, taken from `ABOUT_DATA`
 * rather than restated here: one fact source, one person. No award,
 * education or credential is emitted anywhere in this graph (see
 * `src/editorial/structured-data/contract.json`).
 *
 * Prev / next: the detail surface renders the project that sits
 * immediately above / below the target in canonical sort order.
 * `loadPortfolioAdjacent` runs in parallel with the project fetch
 * so the loader work is bounded to one extra round-trip per
 * side (and both queries can hit the D1 prepared-statement
 * cache, since they share the public-visibility filter).
 *
 * OGP / metadata contract (Issue #421):
 *   `title`, `description`, `canonical` and the whole og / twitter
 *   set are composed by `src/editorial/social-card/card.ts` from the
 *   loader result, never restated per route. The interesting branch
 *   is the media-less project: the cover row is absent, or the R2
 *   custom domain is unbound so `composeMediaUrl` returns `null`.
 *   That used to degrade silently to an image-less summary card;
 *   it now publishes the site-owned fallback card
 *   (`src/editorial/social-card/contract.json#fallbackCard`) so the
 *   unfurl always has an image AND the degradation is nameable — the
 *   gate reads the emitted `og:image` and reports `fallback`.
 */
export const Route = createFileRoute('/portfolio/$slug')({
	loader: async ({ params }) => {
		const slug = SlugSchema.parse(params.slug);
		const [project, adjacent] = await Promise.all([
			loadPortfolioProject({ data: { slug } }),
			loadPortfolioAdjacent({ data: { slug } }),
		]);
		if (!project) throw notFound();
		return { project, adjacent };
	},
	head: ({ loaderData }) => {
		if (!loaderData) {
			return { meta: [{ title: 'Project — rebuildup.dev' }] };
		}
		const { project } = loaderData;
		const title = `${project.title} — Portfolio`;
		const description = project.summary;
		// Literal, like /about and /portfolio: the publication-surface
		// snapshot and the index-boundary gate both read the canonical
		// origin out of this file textually, so it stays readable here.
		const url = `https://rebuildup.dev/portfolio/${project.slug}`;
		const card = composeSocialCard({
			title,
			socialTitle: project.title,
			description,
			url,
			ogType: 'article',
			image: coverImage(project.media),
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
	component: DetailRoute,
});

function DetailRoute() {
	const { project, adjacent } = Route.useLoaderData();
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			<CreativeWorkJsonLd
				facts={creativeWorkFactsFromProject(project)}
				author={personFactsFromAbout(ABOUT_DATA)}
			/>
			<PortfolioDetail project={project} adjacent={adjacent} />
		</>
	);
}

/**
 * The cover this route publishes as its card, or `null` when the
 * project publishes no usable image (no media row, unbound media
 * domain, or a row without alt text). `composeSocialCard` decides
 * what that means; the route only reports what the loader found.
 */
function coverImage(
	media: ReadonlyArray<{
		isCover: boolean;
		url: string | null;
		alt: string;
		width: number | null;
		height: number | null;
	}>,
) {
	const cover = media.find((m) => m.isCover) ?? media[0];
	if (!cover) return null;
	return {
		url: cover.url,
		alt: cover.alt,
		width: cover.width,
		height: cover.height,
	};
}
