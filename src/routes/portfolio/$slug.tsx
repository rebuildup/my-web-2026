import { createFileRoute, notFound } from '@tanstack/react-router';
import { loadPortfolioProject } from '../../portfolio/public';
import { SlugSchema } from '../../portfolio/schema';
import { PortfolioDetail } from '../../portfolio/components';

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
 * OGP / metadata contract:
 *   `title`, `description`, `canonical`, `og:title`,
 *   `og:description`, `og:url`, `og:type=article`,
 *   `og:image` (cover, only if present), and Twitter card
 *   metadata are all derived from the loader result, not
 *   hardcoded. See `head: ...` below.
 */
export const Route = createFileRoute('/portfolio/$slug')({
	loader: async ({ params }) => {
		const slug = SlugSchema.parse(params.slug);
		const project = await loadPortfolioProject({ data: { slug } });
		if (!project) throw notFound();
		return { project };
	},
	head: ({ loaderData }) => {
		if (!loaderData) {
			return { meta: [{ title: 'Project — rebuildup.dev' }] };
		}
		const { project } = loaderData;
		const title = `${project.title} — Portfolio`;
		const description = project.summary;
		const url = `https://rebuildup.dev/portfolio/${project.slug}`;
		const cover = project.media.find((m) => m.isCover) ?? project.media[0];
		const ogImage = cover?.url ?? undefined;
		return {
			meta: [
				{ charSet: 'utf-8' },
				{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
				{ title },
				{ name: 'description', content: description },
				{ property: 'og:type', content: 'article' },
				{ property: 'og:title', content: project.title },
				{ property: 'og:description', content: description },
				{ property: 'og:url', content: url },
				...(ogImage
					? [
							{ property: 'og:image', content: ogImage },
							{ name: 'twitter:card', content: 'summary_large_image' },
							{ name: 'twitter:title', content: project.title },
							{ name: 'twitter:description', content: description },
							{ name: 'twitter:image', content: ogImage },
						]
					: [{ name: 'twitter:card', content: 'summary' }]),
			],
			links: [{ rel: 'canonical', href: url }],
		};
	},
	component: DetailRoute,
});

function DetailRoute() {
	const { project } = Route.useLoaderData();
	return <PortfolioDetail project={project} />;
}
