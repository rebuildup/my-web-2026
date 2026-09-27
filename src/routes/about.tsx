import { createFileRoute } from '@tanstack/react-router';
import { AboutPage } from '../about/components';
import { loadAboutPage } from '../about/public';

/**
 * `/about` — single page route (Issue #102).
 *
 * Sits at `src/routes/about.tsx` per the decision: a single
 * canonical surface, no sub-routes, no `/about/_AI` or `/about/links`
 * children (decision §「Why not bring back /about/_AI or /links」).
 *
 * The loader resolves the canonical `AboutPageData` snapshot
 * (identity / interests / current / future / externalHandles from
 * the repo-controlled source, experience subset from
 * `src/portfolio/load.ts`). The page component is a pure presentational
 * shell — no other server-fn calls land here.
 *
 * OGP / metadata contract mirrors `/portfolio`: title, description,
 * `og:type=profile` (the page IS a person), canonical URL, og:image
 * sourced from the FIRST experience project's cover (only when one
 * is present; the page falls back to `null` and the head renders
 * without an `og:image`).
 *
 * Cross-references:
 *   - `docs/decisions/about-cv-contact.md`
 *   - `src/about/components/AboutPage.tsx` — page composition
 *   - `src/portfolio/load.ts` — DI seam that supplies experience
 */
export const Route = createFileRoute('/about')({
	loader: async () => {
		return loadAboutPage({ data: undefined });
	},
	head: ({ loaderData }) => {
		const data = loaderData;
		const identity = data?.identity;
		const name = identity?.name ?? 'About';
		const role = identity?.role ?? '';
		const title = `${name} — About`;
		const description = identity?.lead ?? 'developer / creator の自己紹介と公開作品。';
		const url = 'https://rebuildup.dev/about';
		const ogImage = deriveOgImage(data?.experience ?? []);
		const meta: Array<Record<string, string>> = [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title },
			{ name: 'description', content: description },
			{ property: 'og:type', content: 'profile' },
			{ property: 'og:title', content: title },
			{ property: 'og:description', content: description },
			{ property: 'og:url', content: url },
			{ property: 'profile:first_name', content: 'Yusuke' },
			{ property: 'profile:last_name', content: 'Kimura' },
			{ property: 'profile:username', content: identity?.handle ?? 'samuido' },
		];
		if (role) meta.push({ property: 'profile:role', content: role });
		if (ogImage) {
			meta.push({ property: 'og:image', content: ogImage });
			meta.push({ name: 'twitter:card', content: 'summary_large_image' });
			meta.push({ name: 'twitter:title', content: title });
			meta.push({ name: 'twitter:description', content: description });
			meta.push({ name: 'twitter:image', content: ogImage });
		} else {
			meta.push({ name: 'twitter:card', content: 'summary' });
		}
		return {
			meta,
			links: [{ rel: 'canonical', href: url }],
		};
	},
	component: AboutRoute,
});

function AboutRoute() {
	const data = Route.useLoaderData();
	return <AboutPage data={data} />;
}

/**
 * First project cover URL, or undefined. The visitor is not
 * promised a specific project as the "hero image" — we use the
 * first one that is actually published + public + has media, and
 * fall back to no `og:image` rather than fabricating one.
 */
function deriveOgImage(
	projects: ReadonlyArray<{ media: ReadonlyArray<{ isCover: boolean; url: string | null }> }>,
): string | undefined {
	for (const project of projects) {
		const cover = project.media.find((m) => m.isCover) ?? project.media[0];
		const url = cover?.url;
		if (url) return url;
	}
	return undefined;
}
