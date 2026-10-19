import { createFileRoute } from '@tanstack/react-router';
import { AboutPage } from '../about/components';
import { loadAboutPage } from '../about/public';
import { personFactsFromAbout } from '../about/structured-data';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { composeSocialCard } from '../editorial/social-card';
import { PersonJsonLd } from '../editorial/structured-data';

/**
 * `/about` — single page route (Issue #102, Issue #199).
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
 * Chrome convention (Issue #199). The `<PublicNav />`,
 * `<Breadcrumbs />`, and `<BreadcrumbJsonLd />` components are
 * imported and rendered here explicitly rather than mounted at the
 * `__root` level. This is the user-mandated convention: each page
 * owns its own chrome decisions and references the primitives
 * directly, preserving per-page design freedom.
 *
 * OGP / metadata contract mirrors `/portfolio` (Issue #421): title,
 * description, `og:type=profile` (the page IS a person), canonical
 * URL, and a card composed by `src/editorial/social-card/card.ts`.
 * The card image is the first experience project's cover that
 * resolves a public URL; when none does (no experience row yet, or an
 * unbound media domain) the composer publishes the site fallback card
 * so the unfurl is never image-less.
 *
 * Structured data (Issue #422): `<PersonJsonLd />` renders the
 * machine-readable projection of the SAME approved snapshot the page
 * renders, built by `src/about/structured-data.ts`. It carries no
 * fact the page does not already show, and it deliberately carries
 * no award / education / credential — see
 * `src/editorial/structured-data/contract.json`.
 *
 * Cross-references:
 *   - `docs/decisions/about-cv-contact.md`
 *   - `src/about/components/AboutPage.tsx` — page composition
 *   - `src/about/structured-data.ts` — the approved projection
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
		// The canonical stays a literal here: `scripts/check-index-boundary.mjs`
		// cross-checks this string against the sitemap entry for /about
		// textually (Issue #423), so the declared URL has to be readable
		// in this file, not derived.
		const url = 'https://rebuildup.dev/about';
		const card = composeSocialCard({
			title,
			description,
			url,
			ogType: 'profile',
			image: firstExperienceCover(data?.experience ?? []),
		});
		const meta: Array<Record<string, string>> = [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title },
			{ name: 'description', content: description },
			...card.meta,
			{ property: 'profile:first_name', content: 'Yusuke' },
			{ property: 'profile:last_name', content: 'Kimura' },
			{ property: 'profile:username', content: identity?.handle ?? 'samuido' },
		];
		if (role) meta.push({ property: 'profile:role', content: role });
		return {
			meta,
			links: [{ rel: 'canonical', href: url }],
		};
	},
	component: AboutRoute,
});

function AboutRoute() {
	const data = Route.useLoaderData();
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			<PersonJsonLd facts={personFactsFromAbout(data)} />
			<AboutPage data={data} />
		</>
	);
}

/**
 * First project cover that resolves a public URL, or `null`.
 *
 * The visitor is not promised a specific project as the "hero image"
 * — we take the first one that is actually published + public + has a
 * media row **whose composed URL is usable**, and hand `null` back when
 * there is none so the composer can publish the site fallback card
 * rather than fabricating an image for a project the page does not
 * show. A media row whose `composeMediaUrl` returned `null` (unbound
 * R2 custom domain, invalid key) is skipped rather than stopping the
 * walk: a later experience project with a usable cover is a better
 * answer than the fallback, and the fallback still remains available
 * when no project resolves one.
 */
function firstExperienceCover(
	projects: ReadonlyArray<{
		media: ReadonlyArray<{
			isCover: boolean;
			url: string | null;
			alt: string;
			width: number | null;
			height: number | null;
		}>;
	}>,
) {
	for (const project of projects) {
		const media = project.media.find((m) => m.isCover) ?? project.media[0];
		if (!media?.url) continue;
		return { url: media.url, alt: media.alt, width: media.width, height: media.height };
	}
	return null;
}
