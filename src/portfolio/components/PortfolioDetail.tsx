import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { Cluster, Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { Grid } from '../../editorial/primitives/Grid';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { SkipLink } from '../../editorial/primitives/SkipLink';
import { TextLink } from '../../editorial/primitives/TextLink';
import { isFacetDerivedRole } from '../kind-labels';
import type { PortfolioAdjacent, PortfolioProject } from '../schema';
import { selectPortfolioVideo } from '../video-facade';
import { FACET_LABEL, LINK_LABEL } from '../vocabulary';
import { PortfolioMarkdown } from './Markdown';
import { PortfolioEvidenceNotice } from './PortfolioEvidenceNotice';
import { PortfolioMediaFigure } from './PortfolioMedia';
import { PortfolioVideoFacade } from './PortfolioVideoFacade';

/**
 * PortfolioDetail — `/portfolio/[slug]` route surface.
 *
 * First viewport contract:
 *   - Project name (h1)
 *   - One-sentence summary
 *   - Role (only when a role is recorded) + period + facet pills
 *   - Representative media (cover)
 *   - Primary link
 *
 * Below-the-fold: data-driven Markdown sections — Motivation,
 * Architecture, Constraints, Implementation, Evidence,
 * Retrospective. Each section is **omitted when its markdown
 * body is empty** (the loader stores `null` for absent fields).
 *
 * The Markdown renderer intentionally omits every structure that
 * Portfolio bodies do not need (tables, images inline, footnotes,
 * raw HTML). External links are classified by origin and get
 * `target=_blank rel=noopener noreferrer`.
 */
export interface PortfolioDetailProps {
	project: PortfolioProject;
	adjacent: PortfolioAdjacent;
}

const SECTION_DEFINITIONS: ReadonlyArray<{
	id: string;
	eyebrow: string;
	title: string;
	field: keyof Pick<
		PortfolioProject,
		| 'motivationMd'
		| 'architectureMd'
		| 'constraintsMd'
		| 'implementationMd'
		| 'evidenceMd'
		| 'retrospectiveMd'
	>;
}> = [
	{
		id: 'motivation',
		eyebrow: '01',
		title: '動機 / Motivation',
		field: 'motivationMd',
	},
	{
		id: 'architecture',
		eyebrow: '02',
		title: '設計 / Architecture',
		field: 'architectureMd',
	},
	{
		id: 'constraints',
		eyebrow: '03',
		title: '制約 / Constraints',
		field: 'constraintsMd',
	},
	{
		id: 'implementation',
		eyebrow: '04',
		title: '実装 / Implementation',
		field: 'implementationMd',
	},
	{
		id: 'evidence',
		eyebrow: '05',
		title: '成果 / Evidence',
		field: 'evidenceMd',
	},
	{
		id: 'retrospective',
		eyebrow: '06',
		title: '振り返り / Retrospective',
		field: 'retrospectiveMd',
	},
];

export function PortfolioDetail({ project, adjacent }: PortfolioDetailProps) {
	const cover = project.media.find((m) => m.isCover) ?? project.media[0] ?? null;
	// Issue #870: a `kind: 'video'` link whose URL this repository can
	// validate gets a play affordance instead of being only a line in
	// §07. The primary link is then the first NON-video link, so the
	// first viewport does not say "Video" twice. A page whose only link
	// is the video keeps the facade and drops the duplicate line.
	const video = selectPortfolioVideo(project.links);
	const primaryLink =
		project.links.find((link) => link.kind !== 'video') ??
		(video === null ? (project.links[0] ?? null) : null);
	const showAdjacent = adjacent.prev !== null || adjacent.next !== null;
	// The `Role` row exists only when a role is actually recorded
	// (Issue #813). A kind of work does not belong in this column — the
	// eyebrow word and the facet pills already carry it. The stored
	// string cannot say where it came from, so the surface applies the
	// reader-side guard (`isFacetDerivedRole`): the closed set of words
	// the legacy migration derived from `facets` is never a person's
	// role, whether or not the row carries `role_source` provenance.
	// The write path nulls those words going forward (Issue #811 /
	// `cms-merge.ts`); this guard covers rows stored before it. An
	// empty `<dd>` would be a row that claims something while saying
	// nothing, so it is dropped. The printed string is the stored
	// string, byte-exact.
	const hasRole =
		project.role !== null && project.role.trim() !== '' && !isFacetDerivedRole(project.role);
	// Issue #767 — `periodLabel` is nullable; an empty `<dd>` beside a
	// `Period` label claims a recorded period while showing nothing, so
	// the pair is dropped exactly as `Role` is.
	const hasPeriod = project.periodLabel !== null && project.periodLabel.trim() !== '';
	return (
		<>
			<SkipLink href="#portfolio-detail" />
			<main id="main">
				<article id="portfolio-detail" aria-labelledby="portfolio-detail-heading">
					<PageSection rhythm="hero" labelledBy="portfolio-detail-heading">
						<div
							className={css({
								display: 'flex',
								flexDirection: 'column',
								gap: '6',
							})}
						>
							<div
								className={css({
									display: 'flex',
									alignItems: 'center',
									gap: '3',
									flexWrap: 'wrap',
								})}
							>
								<a
									href="/portfolio"
									className={css({
										fontFamily: 'mono',
										fontSize: 'xs',
										letterSpacing: '0.04em',
										textTransform: 'uppercase',
										color: 'text.muted',
										textDecoration: 'none',
										_focusVisible: {
											outline: '2px solid {colors.border.focus}',
											outlineOffset: '2px',
										},
										_hover: {
											color: 'text.default',
										},
									})}
								>
									← Back to portfolio
								</a>
								{project.facets[0] ? (
									<span
										aria-hidden="true"
										className={css({
											fontFamily: 'mono',
											fontSize: 'xs',
											letterSpacing: '0.06em',
											textTransform: 'uppercase',
											color: 'text.muted',
										})}
									>
										· {FACET_LABEL[project.facets[0]]}
									</span>
								) : null}
							</div>
							<h1
								id="portfolio-detail-heading"
								className={css({
									margin: '0',
									fontFamily: 'heading',
									fontSize: { base: '3xl', lg: '4xl' },
									fontWeight: '700',
									color: 'text.default',
									lineHeight: '1.05',
									letterSpacing: '-0.03em',
									maxWidth: '720px',
								})}
							>
								{project.title}
							</h1>
							<p
								className={css({
									margin: '0',
									fontFamily: 'sans',
									fontSize: 'lg',
									color: 'text.muted',
									lineHeight: '1.6',
									maxWidth: '720px',
								})}
							>
								{project.summary}
							</p>
							<dl
								className={css({
									margin: '0',
									display: 'grid',
									gridTemplateColumns: { base: '1fr', sm: 'auto auto auto auto' },
									columnGap: '6',
									rowGap: '2',
									fontFamily: 'sans',
									fontSize: 'sm',
									color: 'text.muted',
								})}
							>
								{hasRole ? (
									<>
										<dt
											className={css({
												fontFamily: 'mono',
												fontSize: 'xs',
												letterSpacing: '0.04em',
												textTransform: 'uppercase',
											})}
										>
											Role
										</dt>
										<dd className={css({ margin: '0' })}>{project.role}</dd>
									</>
								) : null}
								{hasPeriod ? (
									<>
										<dt
											className={css({
												fontFamily: 'mono',
												fontSize: 'xs',
												letterSpacing: '0.04em',
												textTransform: 'uppercase',
											})}
										>
											Period
										</dt>
										<dd className={css({ margin: '0' })}>{project.periodLabel}</dd>
									</>
								) : null}
							</dl>
							<Cluster aria-label="facets" gap="2">
								{project.facets.map((facet) => (
									<Badge
										key={facet}
										tone={project.pinned && facet === project.facets[0] ? 'accent' : 'neutral'}
									>
										{FACET_LABEL[facet] ?? facet}
									</Badge>
								))}
							</Cluster>
							{cover ? (
								<div className={css({ maxWidth: '720px' })}>
									<PortfolioMediaFigure media={cover} loading="eager" />
								</div>
							) : null}
							{video ? (
								<div className={css({ maxWidth: '720px' })}>
									<PortfolioVideoFacade video={video} />
								</div>
							) : null}
							{primaryLink ? (
								<p
									className={css({
										margin: '0',
										fontFamily: 'sans',
										fontSize: 'md',
									})}
								>
									<TextLink href={primaryLink.url} target="_blank" rel="noopener noreferrer">
										{LINK_LABEL[primaryLink.kind]}
										{primaryLink.label ? ` — ${primaryLink.label}` : ''}
									</TextLink>
								</p>
							) : null}
						</div>
						{/* ADR-0019 §2.5 — an asset published without a
							    rights record says so, on the page that shows
							    the asset. */}
						<PortfolioEvidenceNotice evidenceStatus={project.evidenceStatus} />
					</PageSection>
					{SECTION_DEFINITIONS.map((section) => {
						const body = project[section.field];
						if (!body || body.trim() === '') return null;
						return (
							<PageSection
								key={section.id}
								labelledBy={`portfolio-section-${section.id}`}
								separator
							>
								<SectionHeading
									id={`portfolio-section-${section.id}`}
									eyebrow={section.eyebrow}
									title={section.title}
								/>
								<PortfolioMarkdown source={body} />
							</PageSection>
						);
					})}
					{project.links.length > 0 ? (
						<PageSection labelledBy="portfolio-section-links" separator>
							<SectionHeading id="portfolio-section-links" eyebrow="07" title="Links" />
							<Stack as="ul" gap="3" className={listResetClassName}>
								{project.links.map((link) => (
									<li key={link.id}>
										<a
											href={link.url}
											target="_blank"
											rel="noopener noreferrer"
											className={css({
												display: 'inline-flex',
												gap: '3',
												alignItems: 'baseline',
												// Issue #871: a URL with no break opportunity
												// (e.g. `https://github.com/rebuildup/Aulymo_v03`)
												// is one unbreakable run. Without these three
												// properties the anchor's max-content width
												// exceeds the viewport at 390px and the WHOLE
												// document scrolls sideways (measured
												// 410 / 390). `flexWrap` lets the label and the
												// URL sit on separate lines; `minWidth: 0` lets
												// the flex item shrink below its content size;
												// `overflowWrap` supplies the break opportunity
												// inside the URL itself.
												flexWrap: 'wrap',
												minWidth: '0',
												maxWidth: '100%',
												overflowWrap: 'anywhere',
												fontFamily: 'sans',
												fontSize: 'md',
												color: 'text.accent',
												textDecoration: 'underline',
												textUnderlineOffset: '0.18em',
												textDecorationThickness: '1px',
												_focusVisible: {
													outline: '2px solid {colors.border.focus}',
													outlineOffset: '2px',
												},
												_hover: { textDecorationThickness: '2px' },
											})}
										>
											<span
												className={css({
													fontFamily: 'mono',
													fontSize: 'xs',
													letterSpacing: '0.04em',
													textTransform: 'uppercase',
													color: 'text.muted',
												})}
											>
												{LINK_LABEL[link.kind]}
											</span>
											<span>{link.label ?? link.url}</span>
										</a>
									</li>
								))}
							</Stack>
						</PageSection>
					) : null}
					{showAdjacent ? (
						<PageSection labelledBy="portfolio-section-adjacent" separator>
							<nav aria-labelledby="portfolio-section-adjacent">
								{/*
								 * Issue #767 — no eyebrow here. The numbered
								 * eyebrows belong to the body sections, and those
								 * are omitted when their markdown body is empty:
								 * an adjacent-only page showed a bare `08` with no
								 * `01`–`07` to belong to. The number is dropped
								 * rather than renumbered, because the visible
								 * numbering is a property of the rendered page and
								 * not of this fixed slot.
								 *
								 * The description used to name the SQL columns
								 * (`display_order`, `updated_at`); that is the
								 * implementation's vocabulary, not the reader's.
								 */}
								<SectionHeading
									id="portfolio-section-adjacent"
									title="隣接 project / Adjacent"
									description="このプロジェクトの前後に並ぶ project。"
								/>
								<Grid as="ul" columns={2} columnGap="6" rowGap="4" className={listResetClassName}>
									<li>
										{adjacent.prev ? (
											<a
												href={`/portfolio/${adjacent.prev.slug}`}
												className={css({
													display: 'flex',
													flexDirection: 'column',
													gap: '2',
													paddingBlock: '4',
													color: 'text.default',
													textDecoration: 'none',
													_focusVisible: {
														outline: '2px solid {colors.border.focus}',
														outlineOffset: '4px',
														borderRadius: '2px',
													},
													_hover: {
														textDecoration: 'underline',
													},
												})}
											>
												<span
													aria-hidden="true"
													className={css({
														fontFamily: 'mono',
														fontSize: 'xs',
														letterSpacing: '0.06em',
														textTransform: 'uppercase',
														color: 'text.muted',
													})}
												>
													← Previous
												</span>
												<span
													className={css({
														fontFamily: 'sans',
														fontSize: 'md',
														fontWeight: '600',
														color: 'text.default',
														lineHeight: '1.4',
													})}
												>
													{adjacent.prev.title}
												</span>
											</a>
										) : (
											<span
												aria-hidden="true"
												className={css({
													display: 'block',
													paddingBlock: '4',
													fontFamily: 'mono',
													fontSize: 'xs',
													letterSpacing: '0.06em',
													textTransform: 'uppercase',
													color: 'text.muted',
												})}
											>
												← First project
											</span>
										)}
									</li>
									<li>
										{adjacent.next ? (
											<a
												href={`/portfolio/${adjacent.next.slug}`}
												className={css({
													display: 'flex',
													flexDirection: 'column',
													gap: '2',
													paddingBlock: '4',
													color: 'text.default',
													textDecoration: 'none',
													textAlign: 'right',
													_focusVisible: {
														outline: '2px solid {colors.border.focus}',
														outlineOffset: '4px',
														borderRadius: '2px',
													},
													_hover: {
														textDecoration: 'underline',
													},
												})}
											>
												<span
													aria-hidden="true"
													className={css({
														fontFamily: 'mono',
														fontSize: 'xs',
														letterSpacing: '0.06em',
														textTransform: 'uppercase',
														color: 'text.muted',
													})}
												>
													Next →
												</span>
												<span
													className={css({
														fontFamily: 'sans',
														fontSize: 'md',
														fontWeight: '600',
														color: 'text.default',
														lineHeight: '1.4',
													})}
												>
													{adjacent.next.title}
												</span>
											</a>
										) : (
											<span
												aria-hidden="true"
												className={css({
													display: 'block',
													paddingBlock: '4',
													fontFamily: 'mono',
													fontSize: 'xs',
													letterSpacing: '0.06em',
													textTransform: 'uppercase',
													color: 'text.muted',
													textAlign: 'right',
												})}
											>
												Last project →
											</span>
										)}
									</li>
								</Grid>
							</nav>
						</PageSection>
					) : null}
				</article>
			</main>
		</>
	);
}
