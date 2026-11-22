import { createFileRoute } from '@tanstack/react-router';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { CurrentProjects, currentProjectsSummary } from '../home/current/CurrentProjects';
import { getCurrentProjects } from '../home/public';
import { css } from '../../styled-system/css';
import { PageHero } from '../editorial/primitives/PageHero';

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

const summaryClassName = css({
	fontFamily: 'mono',
	fontSize: 'sm',
	fontVariantNumeric: 'tabular-nums',
	color: 'text.muted',
	margin: '0',
});

function NowRoute() {
	const { projects, today } = Route.useLoaderData();
	const summary = currentProjectsSummary(projects, today);
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			{/* Issue #1185 — `/now` is an ENTRY surface and it had no `<h1>`:
			    the page's only heading was the current-projects section's
			    `<h2>`. The hero carries the page's title, and the entry's
			    right column carries the same scale sentence the section
			    used to print under its heading. */}
			<PageHero
				labelledBy="now-hero-title"
				eyebrow="/now"
				title="現在地"
				titleEn="Where I am now"
				description="続けているプロジェクトと、始めた日・最後に動いた日・そこに入れている量です。計測した値には出所（手書き / git）を添えています。"
				asideLabel="Scale"
				aside={
					summary ? (
						<p data-testid="home-current-projects-summary" className={summaryClassName}>
							{summary}
						</p>
					) : undefined
				}
			>
				<main>
					<CurrentProjects projects={projects} today={today} variant="page" />
				</main>
			</PageHero>
		</>
	);
}
