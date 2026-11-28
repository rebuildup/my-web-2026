import { createFileRoute } from '@tanstack/react-router';
import { css } from '../../styled-system/css';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { Button } from '../editorial/primitives/Button';
import { MaterialSymbol } from '../editorial/primitives/MaterialSymbol';
import { PageHero } from '../editorial/primitives/PageHero';
import { PageSection } from '../editorial/primitives/PageSection';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
import { ARROW_FORWARD_PATH } from '../editorial/primitives/material-symbol-paths';
import { GITHUB_PROJECT_ID_PREFIX } from '../home/activity/snapshot';
import { CurrentProjects, currentProjectsSummary } from '../home/current/CurrentProjects';
import type { CurrentProjectRecord } from '../home/current/types';
import { getCurrentProjects } from '../home/public';

/**
 * `/now` — the full enumeration surface for the "現在地 / Where I am
 * now" records (Issue #1108, ADR-0022 C-8; redesigned Issue #1297).
 *
 * HOME curates a representative slice of the current-project list;
 * this route exists so every record stays reachable without making
 * the front page a data dump. The data obligation is identical to
 * the home loader's: committed artefacts only, no runtime fetch —
 * `getCurrentProjects` reads the same roster + generated git
 * snapshot the home section projects.
 *
 * Issue #1297 — the page stopped being ONE hero-rhythm section. The
 * records split by provenance into two enumerations, each under its
 * own `PageSection` + `SectionHeading`:
 *
 *   - 名付けたプロジェクト — the roster's declared work (names,
 *     status lines, handwritten/git facts), grouped by weight level;
 *   - GitHub で観測されたリポジトリ — the measured `gh-*` records,
 *     ranked by window contribution, including the single anonymous
 *     aggregate for private repos (`activityProjectRecords`).
 *
 * The partition key is the `gh-` id namespace the loader documents
 * (`GITHUB_PROJECT_ID_PREFIX`) — every record lands in exactly one
 * section, so the two lists still enumerate the full published set.
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

/** The GitHub-observed half of the published list (`gh-*` ids). */
function isGithubObserved(record: CurrentProjectRecord): boolean {
	return record.id.startsWith(GITHUB_PROJECT_ID_PREFIX);
}

function NowRoute() {
	const { projects, today } = Route.useLoaderData();
	const summary = currentProjectsSummary(projects, today);
	const named = projects.filter((record) => !isGithubObserved(record));
	const observed = projects.filter(isGithubObserved);
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			{/* Issue #1185 — `/now` is an ENTRY surface and it had no `<h1>`:
			    the page's only heading was the current-projects section's
			    `<h2>`. The hero carries the page's title, and the entry's
			    right column carries the same scale sentence the section
			    used to print under its heading. Issue #1297 — the hero no
			    longer WRAPS the enumeration: the records live in their own
			    sections below, so the hero rhythm ends at the entry band. */}
			<PageHero
				labelledBy="now-hero-title"
				eyebrow="/now"
				title="現在地"
				titleEn="Where I am now"
				description="続けているプロジェクトと、始めた日・最後に動いた日・そこに入れている量です。計測した値には出所（手書き / git / GitHub）を添えています。"
				asideLabel="Scale"
				aside={
					summary ? (
						<p data-testid="home-current-projects-summary" className={summaryClassName}>
							{summary}
						</p>
					) : undefined
				}
			/>
			<main id="main">
				<PageSection labelledBy="now-named-heading" name="now" testId="now-named-section">
					<SectionHeading
						id="now-named-heading"
						eyebrow="01 — Named projects"
						title="名付けたプロジェクト"
						description="オーナーが名付けて記録している継続中のプロジェクトです。開始日・最終更新・注力度は手書きまたは git の記録から読み、値ごとに出所を添えます。"
						variant="default"
					/>
					<div className={css({ marginBlockStart: '10' })}>
						<CurrentProjects
							projects={named}
							today={today}
							variant="page"
							groupHeadingLevel="h3"
							listTestId="now-named-projects-list"
						/>
					</div>
				</PageSection>
				<PageSection
					labelledBy="now-observed-heading"
					separator
					name="now"
					testId="now-observed-section"
				>
					<SectionHeading
						id="now-observed-heading"
						eyebrow="02 — Observed on GitHub"
						title="GitHub で観測されたリポジトリ"
						description="GitHub の公開イベントとコミット計測から自動選定したリポジトリです。順位は直近の計測窓における貢献量（commits + PR）順で、非公開リポジトリは匿名の集計 1 行にまとめています。"
						variant="default"
					/>
					<div className={css({ marginBlockStart: '10' })}>
						<CurrentProjects
							projects={observed}
							today={today}
							variant="page"
							groupHeadingLevel="h3"
							listTestId="now-observed-projects-list"
						/>
					</div>
				</PageSection>
				{/* Issue #1297 — the closing band: the enumeration ends with
				    a next step instead of a dead end (contact / portfolio). */}
				<PageSection
					labelledBy="now-closing-heading"
					rhythm="closing"
					tone="inverse"
					separator
					name="contact"
				>
					<SectionHeading
						id="now-closing-heading"
						eyebrow="03 — Next"
						title="この活動について話す"
						titleEn="Keep in touch"
						description="現在地の記録は portfolio の case study と活動タイムラインにも展開しています。仕事の相談・掲載の訂正は contact の verified channel からどうぞ。"
						variant="spread"
					>
						<Button as="a" href="/contact" variant="primary">
							<span lang="ja">Contact を見る</span>
							<MaterialSymbol d={ARROW_FORWARD_PATH} size={18} />
						</Button>
					</SectionHeading>
				</PageSection>
			</main>
		</>
	);
}
