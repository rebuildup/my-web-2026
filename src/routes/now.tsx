import { createFileRoute } from '@tanstack/react-router';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { CurrentProjects } from '../home/current/CurrentProjects';
import { getCurrentProjects } from '../home/public';

/**
 * `/now` — the full enumeration surface for the "現在地 / Where I am
 * now" records (Issue #1108, ADR-0022 C-8).
 *
 * HOME curates a representative slice of the current-project list;
 * this route exists so every record stays reachable without making
 * the front page a data dump. The data obligation is identical to
 * the home loader's: committed artefacts only, no runtime fetch —
 * `getCurrentProjects` reads the same roster + generated git
 * snapshot the home section projects.
 *
 * Chrome convention matches `/links` and `/contact`: `PublicNav` /
 * `Breadcrumbs` / `BreadcrumbJsonLd` are mounted explicitly.
 * Deliberately NOT in `PUBLIC_NAV_ITEMS`; it is reached from the
 * home section's "see all" link (same class as `/links`,
 * `/keyboard`, `/projects/dotfiles`).
 */
export const Route = createFileRoute('/now')({
	loader: async () => {
		const today = new Date().toISOString().slice(0, 10);
		const projects = await getCurrentProjects({ data: { today } });
		return { projects, today };
	},
	head: () => {
		const title = '現在地 / Where I am now — rebuildup.dev';
		const description =
			'続けているプロジェクトの全件一覧。開始日・最終更新・活動量を出所付きで掲載しています。';
		const url = 'https://rebuildup.dev/now';
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
	component: NowRoute,
});

function NowRoute() {
	const { projects, today } = Route.useLoaderData();
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			<main>
				{/* Issue #1163 — `/now` is the ENTRY surface: the
				    current-projects section is its title block, and the
				    summary facts sit in the entry's right column. */}
				<CurrentProjects projects={projects} today={today} variant="page" />
			</main>
		</>
	);
}
