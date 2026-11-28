import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { listResetClassName } from '../../editorial/primitives/Flow';
import { focusRing, noteSansSmBody } from '../../editorial/primitives/shared-styles';
import type { PortfolioFacet, PortfolioProject } from '../schema';
import { PORTFOLIO_FACETS } from '../schema';
import { hasPeriodLabel, hasRecordedRole } from '../views';
import { FACET_LABEL, FACET_LABEL_JA } from '../vocabulary';

/**
 * PortfolioArchive — the catalogue layer of `/portfolio` (Issue #1318).
 *
 * The page is a two-layer surface (`docs/visual/site-concept-2026.md`
 * §5, audit finding #4 of `docs/verification/design/site-audit-2026-11-28.md`):
 *
 *   1. `SelectedWorks` — the curated exhibition band. It answers
 *      "what does this site stand behind" and carries the media.
 *   2. This archive — the COMPLETE public index, rendered as compact
 *      rows grouped by facet instead of the former uniform card
 *      grid. It answers "where is the work I am looking for" and
 *      carries no media: a catalog row is typography, not a poster.
 *
 * Why facet groups and not another card grid
 * -----------------------------------------
 * The card grid treated all ~74 works as equals, which is exactly
 * the audit's finding #2 (等質カードグリッド乱用): every row paid
 * for a cover frame, a summary and a pill cluster whether or not the
 * visitor wanted any of it. The archive instead files each work
 * under its PRIMARY facet — `facets[0]`, the same rule `ProjectCard`'s
 * eyebrow word and `SelectedWorks`' category mark already apply — so
 * the facet filter chips above and the group headings here speak one
 * vocabulary. A work carrying several facets is filed once, under
 * its first; the remaining facets stay reachable through the filter.
 *
 * Band/list duplication is RESOLVED BY MARKING, not by hiding: a
 * work the band exhibits keeps its archive row (the archive claims
 * completeness — "every published work is here" — and a silent gap
 * would make that claim false) and carries a quiet `Selected` badge
 * that ties the row back to the exhibition above.
 *
 * Every row is server-rendered. The production smoke
 * (`e2e/prod-portfolio.spec.ts`) asserts each published slug appears
 * in the `/portfolio` HTML, so the archive must never defer rows to
 * a client-only expansion — there is no "show more" inside it. The
 * loader's cursor pagination still applies above 100 rows and the
 * route's `Load more` button appends them here unchanged.
 */
export interface PortfolioArchiveProps {
	projects: readonly PortfolioProject[];
	/**
	 * Slugs the Selected works band is exhibiting. Rows for these
	 * works render a `Selected` badge; the set is resolved by the
	 * caller (`resolveSelectedWorks`) so band and archive can never
	 * disagree about which works are curated.
	 */
	selectedSlugs: ReadonlySet<string>;
}

/** The facet a work is filed under — its first, or `other` when untagged. */
function primaryFacet(project: PortfolioProject): PortfolioFacet {
	return project.facets[0] ?? 'other';
}

/**
 * `2025 — Video production` style provenance for the row's quiet
 * meta line. Only RECORDED facts print: `periodLabel` when the row
 * carries one and `role` only when it is a person's role (the
 * facet-derived kind words are suppressed by `hasRecordedRole`, the
 * same guard the card and the detail page apply — Issue #813).
 */
function archiveMeta(project: PortfolioProject): string | null {
	const parts: string[] = [];
	if (hasPeriodLabel(project) && project.periodLabel) parts.push(project.periodLabel);
	if (hasRecordedRole(project) && project.role) parts.push(project.role);
	return parts.length > 0 ? parts.join(' · ') : null;
}

const groupHeadingClassName = /*#__PURE__*/ css({
	display: 'flex',
	alignItems: 'baseline',
	gap: '3',
	margin: '0',
	marginBlockStart: '8',
	marginBlockEnd: '2',
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '700',
	lineHeight: '1.3',
	color: 'text.default',
});

const groupCountClassName = /*#__PURE__*/ css({
	fontFamily: 'mono',
	fontSize: 'xs',
	fontWeight: '400',
	fontVariantNumeric: 'tabular-nums',
	color: 'text.muted',
});

const rowClassName = /*#__PURE__*/ css({
	display: 'block',
	paddingBlock: '3',
	// Row separators are hairlines, not boxes (layout-system.md §4):
	// longhand border props — the `borderBottom` shorthand is the
	// section-separator property C-1 reserves for PageSection.
	borderBottomWidth: '1px',
	borderBottomStyle: 'solid',
	borderBottomColor: 'border.subtle',
});

const rowHeadClassName = /*#__PURE__*/ css({
	display: 'flex',
	alignItems: 'baseline',
	gap: '3',
	flexWrap: 'wrap',
	// `minWidth: 0` keeps a long unbroken title from pushing the row
	// head past the measure.
	minWidth: '0',
});

const indexNumberClassName = /*#__PURE__*/ css({
	fontFamily: 'mono',
	fontSize: 'xs',
	fontVariantNumeric: 'tabular-nums',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

const titleLinkClassName = /*#__PURE__*/ css({
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '600',
	lineHeight: '1.3',
	letterSpacing: '-0.01em',
	color: 'text.default',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
	textDecorationThickness: '1px',
	textDecorationColor: 'border.strong',
	_focusVisible: focusRing,
	_hover: { textDecorationColor: 'currentColor' },
});

const summaryClassName = /*#__PURE__*/ css(noteSansSmBody, {
	marginBlockStart: '1',
	lineClamp: '2',
});

const metaClassName = /*#__PURE__*/ css({
	margin: '0',
	marginBlockStart: '1',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

function ArchiveRow({
	project,
	number,
	selected,
}: {
	project: PortfolioProject;
	number: number;
	selected: boolean;
}) {
	const meta = archiveMeta(project);
	return (
		<li className={rowClassName} data-slug={project.slug} data-selected={selected || undefined}>
			<div className={rowHeadClassName}>
				<span aria-hidden="true" className={indexNumberClassName}>
					{String(number).padStart(2, '0')}
				</span>
				<a href={`/portfolio/${project.slug}`} className={titleLinkClassName}>
					{project.title}
				</a>
				{selected ? <Badge tone="neutral">Selected</Badge> : null}
			</div>
			<p className={summaryClassName}>{project.summary}</p>
			{meta ? <p className={metaClassName}>{meta}</p> : null}
		</li>
	);
}

export function PortfolioArchive({ projects, selectedSlugs }: PortfolioArchiveProps) {
	// File each work once, under its primary facet, in the closed
	// enum's canonical order — the same order the filter chips read.
	const groups = PORTFOLIO_FACETS.map((facet) => ({
		facet,
		projects: projects.filter((project) => primaryFacet(project) === facet),
	})).filter((group) => group.projects.length > 0);

	// Continuous catalog numbering across the groups, in render order.
	let next = 1;

	return (
		<div id="portfolio-archive" data-testid="portfolio-archive">
			{groups.map(({ facet, projects: groupProjects }) => (
				<div key={facet} data-facet={facet}>
					<h3 className={groupHeadingClassName}>
						<span lang="ja">{FACET_LABEL_JA[facet]}</span>{' '}
						<span lang="en" className={css({ fontWeight: '500', color: 'text.muted' })}>
							{FACET_LABEL[facet]}
						</span>
						<span className={groupCountClassName}>{groupProjects.length}</span>
					</h3>
					<ol className={listResetClassName}>
						{groupProjects.map((project) => {
							const number = next;
							next += 1;
							return (
								<ArchiveRow
									key={project.id}
									project={project}
									number={number}
									selected={selectedSlugs.has(project.slug)}
								/>
							);
						})}
					</ol>
				</div>
			))}
		</div>
	);
}
