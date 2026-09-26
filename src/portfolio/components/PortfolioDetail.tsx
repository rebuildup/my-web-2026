import type { PortfolioProject, PortfolioLink } from '../schema';
import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { Badge } from '../../editorial/primitives/Badge';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { PortfolioMarkdown } from './Markdown';
import { PortfolioMediaFigure } from './PortfolioMedia';

/**
 * PortfolioDetail — `/portfolio/[slug]` route surface.
 *
 * First viewport contract:
 *   - Project name (h1)
 *   - One-sentence summary
 *   - Role + period + facet pills
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

const FACET_LABEL: Readonly<Record<string, string>> = {
	develop: 'Develop',
	video: 'Video',
	design: 'Design',
	other: 'Other',
};

const LINK_LABEL: Readonly<Record<PortfolioLink['kind'], string>> = {
	repo: 'Repository',
	demo: 'Demo',
	release: 'Release',
	article: 'Article',
	shop: 'Shop',
	video: 'Video',
	other: 'Link',
};

export function PortfolioDetail({ project }: PortfolioDetailProps) {
	const cover = project.media.find((m) => m.isCover) ?? project.media[0] ?? null;
	const primaryLink = project.links[0] ?? null;
	return (
		<>
			<a href="#portfolio-detail" className={skipLinkStyle}>
				本文へスキップ
			</a>
			<main id="main">
				<article id="portfolio-detail" aria-labelledby="portfolio-detail-heading">
					<header
						className={css({
							paddingBlock: { base: '16', lg: '24' },
						})}
					>
						<Container>
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
								</dl>
								<div
									aria-label="facets"
									className={css({
										display: 'flex',
										flexWrap: 'wrap',
										gap: '2',
									})}
								>
									{project.facets.map((facet) => (
										<Badge
											key={facet}
											tone={project.pinned && facet === project.facets[0] ? 'accent' : 'neutral'}
										>
											{FACET_LABEL[facet] ?? facet}
										</Badge>
									))}
								</div>
								{cover ? (
									<div className={css({ maxWidth: '720px' })}>
										<PortfolioMediaFigure media={cover} loading="eager" />
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
										<a
											href={primaryLink.url}
											target="_blank"
											rel="noopener noreferrer"
											className={css({
												color: 'text.accent',
												textDecoration: 'underline',
												_focusVisible: {
													outline: '2px solid {colors.border.focus}',
													outlineOffset: '2px',
												},
											})}
										>
											{LINK_LABEL[primaryLink.kind]}
											{primaryLink.label ? ` — ${primaryLink.label}` : ''}
										</a>
									</p>
								) : null}
							</div>
						</Container>
					</header>
					{SECTION_DEFINITIONS.map((section) => {
						const body = project[section.field];
						if (!body || body.trim() === '') return null;
						return (
							<section
								key={section.id}
								aria-labelledby={`portfolio-section-${section.id}`}
								className={css({
									paddingBlock: { base: '12', lg: '16' },
									borderTop: '1px solid {colors.border.subtle}',
								})}
							>
								<Container>
									<SectionHeading
										id={`portfolio-section-${section.id}`}
										eyebrow={section.eyebrow}
										title={section.title}
									/>
									<PortfolioMarkdown source={body} />
								</Container>
							</section>
						);
					})}
					{project.links.length > 0 ? (
						<section
							aria-labelledby="portfolio-section-links"
							className={css({
								paddingBlock: { base: '12', lg: '16' },
								borderTop: '1px solid {colors.border.subtle}',
							})}
						>
							<Container>
								<SectionHeading id="portfolio-section-links" eyebrow="07" title="Links" />
								<ul
									className={css({
										listStyle: 'none',
										margin: '0',
										padding: '0',
										display: 'flex',
										flexDirection: 'column',
										gap: '3',
									})}
								>
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
													fontFamily: 'sans',
													fontSize: 'md',
													color: 'text.accent',
													textDecoration: 'underline',
													_focusVisible: {
														outline: '2px solid {colors.border.focus}',
														outlineOffset: '2px',
													},
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
								</ul>
							</Container>
						</section>
					) : null}
				</article>
			</main>
		</>
	);
}

const skipLinkStyle = css({
	position: 'absolute',
	left: '0',
	top: '0',
	padding: '2',
	backgroundColor: 'bg.canvas',
	color: 'text.default',
	textDecoration: 'none',
	transform: 'translateY(-200%)',
	_focusVisible: {
		transform: 'translateY(0)',
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});
