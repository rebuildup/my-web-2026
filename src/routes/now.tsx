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
import { TextLink } from '../editorial/primitives/TextLink';
import { ARROW_FORWARD_PATH } from '../editorial/primitives/material-symbol-paths';
import { GITHUB_PROJECT_ID_PREFIX } from '../home/activity/snapshot';
import { CurrentProjects, currentProjectsSummary } from '../home/current/CurrentProjects';
import type { CurrentProjectRecord } from '../home/current/types';
import { NowFocus } from './now/NowFocus';
import { getNowRouteData } from './now/load';

/**
 * `/now` — the "current activity" page (Issue #1108, ADR-0022 C-8;
 * redesigned Issue #1297; restructured Issue #1316).
 *
 * The page's job is to say what the owner is focused on NOW —
 * current work, direction, and evidence — not to dump a measurement
 * log. Issue #1316 rebuilds the composition around that job:
 *
 *   01 — いまの焦点 / In focus. The editorial selection: named
 *        records whose owner-written level is 主軸 / 並行, presented
 *        as features with portfolio covers where a case study is
 *        mapped (`src/routes/now/focus.ts`). This is the "so what"
 *        the audit found missing — the page now leads with the
 *        answer instead of the enumeration.
 *   02 — 名付けたプロジェクト. The full named enumeration, grouped
 *        by weight level — the complete record, unchanged.
 *   03 — GitHub で観測されたリポジトリ. The measured `gh-*` records,
 *        ranked by window contribution, with a pointer to `/activity`
 *        for the whole timeline.
 *   04 — closing CTA band, same convention as the other entries.
 *
 * The partition key is still the `gh-` id namespace
 * (`GITHUB_PROJECT_ID_PREFIX`): every published record lands in
 * exactly one enumeration, so sections 02 + 03 still cover the full
 * published set and the hero summary count stays honest.
 *
 * Data obligations are unchanged where they matter: the records come
 * from `getCurrentProjects` (committed artefacts, no request-time
 * fetch). The focus band's covers are the ONE runtime read — the
 * portfolio public server function, resolved fail-soft in
 * `src/routes/now/load.ts` so a cover can never take the page down.
 *
 * Chrome convention matches `/links` and `/contact`: `PublicNav` /
 * `Breadcrumbs` / `BreadcrumbJsonLd` are mounted explicitly.
 * Deliberately NOT in `PUBLIC_NAV_ITEMS`; it is reached from the
 * home section's "see all" link (same class as `/links`,
 * `/keyboard`, `/projects/dotfiles`).
 */
export const Route = createFileRoute('/now')({
	loader: () => getNowRouteData(),
	head: () => {
		const title = '現在地 / Where I am now — rebuildup.dev';
		const description =
			'続けているプロジェクトと、最近動いたリポジトリ。いま注力しているものから、値の出所（手書き / git / GitHub）まで掲載しています。';
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

const sectionBodyClassName = css({ marginBlockStart: '10' });

const observedFooterClassName = css({ marginBlockStart: '8' });

/** The GitHub-observed half of the published list (`gh-*` ids). */
function isGithubObserved(record: CurrentProjectRecord): boolean {
	return record.id.startsWith(GITHUB_PROJECT_ID_PREFIX);
}

function NowRoute() {
	const { projects, today, focus } = Route.useLoaderData();
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
			    used to print under its heading. Issue #1316 — the lead
			    now says what the page ANSWERS (what is being focused on
			    now, with the provenance of every value) instead of
			    describing the list's columns. */}
			<PageHero
				labelledBy="now-hero-title"
				eyebrow="/now"
				title="現在地"
				titleEn="Where I am now"
				description="続けているプロジェクトと、最近動いたリポジトリ。いま注力しているものから読み始められるよう、値の出所（手書き / git / GitHub）を一つずつ添えています。"
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
				{focus.length > 0 ? (
					<PageSection labelledBy="now-focus-heading" name="now" testId="now-focus-section">
						<SectionHeading
							id="now-focus-heading"
							eyebrow="01 — In focus"
							title="いまの焦点"
							titleEn="In focus"
							description="オーナーが重点度「主軸」「並行」と記録したプロジェクトです。case study が公開されているものは表紙を証拠として添え、ないものは文字だけで置きます。"
							variant="default"
						/>
						<div className={sectionBodyClassName}>
							<NowFocus items={focus} today={today} />
						</div>
					</PageSection>
				) : null}
				<PageSection labelledBy="now-named-heading" name="now" testId="now-named-section">
					<SectionHeading
						id="now-named-heading"
						eyebrow="02 — Named projects"
						title="名付けたプロジェクト"
						description="オーナーが名付けて記録している継続中のプロジェクトの全件です。開始日・最終更新・注力度は手書きまたは git の記録から読み、値ごとに出所を添えます。"
						variant="default"
					/>
					<div className={sectionBodyClassName}>
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
						eyebrow="03 — Observed on GitHub"
						title="GitHub で観測されたリポジトリ"
						description="GitHub の公開イベントとコミット計測から自動選定したリポジトリです。順位は直近の計測窓における貢献量（commits + PR）順で、非公開リポジトリは匿名の集計 1 行にまとめています。イベント単位の全記録は活動タイムラインにあります。"
						variant="default"
					/>
					<div className={sectionBodyClassName}>
						<CurrentProjects
							projects={observed}
							today={today}
							variant="page"
							groupHeadingLevel="h3"
							listTestId="now-observed-projects-list"
						/>
						<div className={observedFooterClassName}>
							<TextLink href="/activity" data-testid="now-activity-link">
								<span>活動タイムラインですべての記録を読む</span>
								<MaterialSymbol d={ARROW_FORWARD_PATH} size={16} />
							</TextLink>
						</div>
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
						eyebrow="04 — Next"
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
