import { Fragment } from 'react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import type { PortfolioProject } from '../../portfolio/schema';
import type { AboutPageData } from '../types';

/**
 * AboutPage — `/about` route surface (presentation only).
 *
 * Reading order (per `docs/personal/domain.md` §12):
 *   - Hero: identity (name + handle + role)
 *   - 01 — Identity      (name / handle / role cluster as data)
 *   - 02 — Interests     (the throughlines that connect portfolio items)
 *   - 03 — Experience    (curated narrative subset of /portfolio)
 *   - 04 — Current       (today)
 *   - 05 — Future        (active vs parked)
 *   - Footer             (finds-me-elsewhere external handles)
 *
 * The Hero adopts the same 4/12 (rail) + 8/12 (lead) grid split
 * as the home hero. The body sections use the spread
 * `SectionHeading` variant so the heading cluster sits in the
 * narrow left column and the section body sits in the wide right
 * column — same coordinate system as the home / portfolio
 * surfaces.
 *
 * Each section heading is `01`–`05` (the page header is the hero).
 * Numbers stay in editorial order; inserting / removing a section
 * means renumbering the remaining ones (per the home `01`–`04`
 * pattern).
 *
 * Per narrative invariant (`docs/personal/domain.md` §11.4) the
 * page must NOT hard-code skill percentages or "current value"
 * metrics that drift; the experience list and the
 * external-handles list are both derived from data the page
 * can stand behind at deploy time.
 */

export interface AboutPageProps {
	data: AboutPageData;
}

const FACET_LABEL: Readonly<Record<string, string>> = {
	develop: 'Develop',
	video: 'Video',
	design: 'Design',
	other: 'Other',
};

const sectionStyle = css({
	paddingBlock: { base: '12', lg: '16' },
	borderTop: '1px solid {colors.border.subtle}',
});

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

export function AboutPage({ data }: AboutPageProps) {
	const { identity, interests, experience, current, future, externalHandles } = data;
	return (
		<>
			<a href="#about-main" className={skipLinkStyle}>
				本文へスキップ
			</a>
			<Hero identity={identity} />
			<main id="about-main">
				<IdentitySection identity={identity} />
				<InterestsSection interests={interests} />
				<ExperienceSection projects={experience} />
				<CurrentSection items={current} />
				<FutureSection active={future.active} parked={future.parked} />
			</main>
			<ExternalHandlesFooter handles={externalHandles} />
		</>
	);
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

function Hero({ identity }: { identity: AboutPageData['identity'] }) {
	return (
		<section
			aria-labelledby="about-hero-title"
			className={css({
				paddingBlock: { base: '16', lg: '32' },
			})}
		>
			<Container>
				<div
					className={css({
						display: 'grid',
						gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 4fr) minmax(0, 8fr)' },
						columnGap: { base: '0', lg: '10' },
						rowGap: { base: '10', lg: '0' },
						alignItems: 'start',
					})}
				>
					<aside
						aria-hidden="true"
						className={css({
							display: { base: 'none', lg: 'flex' },
							flexDirection: 'column',
							gap: '1',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
							lineHeight: '1.6',
						})}
					>
						<span lang="en">about</span>
						<span lang="en">samuido · profile</span>
						<span lang="en">identity → interests → experience → current → future</span>
					</aside>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
							minWidth: '0',
						})}
					>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
							})}
						>
							/about · profile
						</span>
						<h1
							id="about-hero-title"
							lang="ja"
							className={css({
								margin: '0',
								marginBlockStart: '2',
								fontFamily: 'heading',
								fontSize: { base: '3xl', lg: '4xl' },
								fontWeight: '700',
								lineHeight: { base: '1.15', lg: '1.05' },
								color: 'text.default',
								letterSpacing: '-0.03em',
							})}
						>
							{identity.name}
						</h1>
						<p
							lang="ja"
							className={css({
								margin: '0',
								marginBlockStart: '4',
								fontFamily: 'sans',
								fontSize: 'lg',
								lineHeight: '1.6',
								color: 'text.default',
							})}
						>
							{identity.role}
						</p>
						<p
							lang="ja"
							className={css({
								margin: '0',
								marginBlockStart: '4',
								fontFamily: 'sans',
								fontSize: 'md',
								lineHeight: '1.6',
								color: 'text.muted',
							})}
						>
							{identity.lead}
						</p>
						{identity.secondary ? (
							<p
								lang="ja"
								className={css({
									margin: '0',
									marginBlockStart: '4',
									fontFamily: 'sans',
									fontSize: 'md',
									lineHeight: '1.6',
									color: 'text.muted',
								})}
							>
								{identity.secondary}
							</p>
						) : null}
					</div>
				</div>
			</Container>
		</section>
	);
}

/* -------------------------------------------------------------------------- */
/* Identity section                                                           */
/* -------------------------------------------------------------------------- */

function IdentitySection({ identity }: { identity: AboutPageData['identity'] }) {
	const rows: ReadonlyArray<{ label: string; value: string }> = [
		{ label: 'Name', value: identity.name },
		{ label: 'Handle', value: identity.handle },
		{ label: 'Role', value: identity.role },
	];
	return (
		<section aria-labelledby="about-section-identity" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="about-section-identity"
					eyebrow="01 — Identity"
					title="人物像 / Identity"
					description="学校・制作・開発の surface が分かれても、一人の人物から自然に生えているように。"
				>
					<dl
						className={css({
							margin: '0',
							display: 'grid',
							gridTemplateColumns: 'auto 1fr',
							columnGap: '6',
							rowGap: '3',
							fontFamily: 'sans',
							fontSize: 'md',
							color: 'text.default',
						})}
					>
						{rows.map((row) => (
							<Fragment key={row.label}>
								<dt
									className={css({
										fontFamily: 'mono',
										fontSize: 'xs',
										letterSpacing: '0.04em',
										textTransform: 'uppercase',
										color: 'text.muted',
									})}
								>
									{row.label}
								</dt>
								<dd lang="ja" className={css({ margin: '0' })}>
									{row.value}
								</dd>
							</Fragment>
						))}
					</dl>
				</SectionHeading>
			</Container>
		</section>
	);
}

/* -------------------------------------------------------------------------- */
/* Interests section                                                          */
/* -------------------------------------------------------------------------- */

function InterestsSection({ interests }: { interests: AboutPageData['interests'] }) {
	return (
		<section aria-labelledby="about-section-interests" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="about-section-interests"
					eyebrow="02 — Interests"
					title="興味 / Throughlines"
					description="バラバラに見える活動が同じ人物から出てくる理由。プロジェクトを貫く throughline。"
				>
					<ol
						className={css({
							margin: '0',
							padding: '0',
							listStyle: 'none',
							display: 'flex',
							flexDirection: 'column',
							gap: '6',
						})}
					>
						{interests.map((interest, index) => (
							<li
								key={interest.title}
								className={css({
									display: 'flex',
									flexDirection: 'column',
									gap: '2',
									paddingBlock: '4',
									paddingInline: '4',
									borderRadius: '6px',
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: 'border.subtle',
								})}
							>
								<header
									className={css({
										display: 'flex',
										alignItems: 'baseline',
										gap: '3',
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
										{String(index + 1).padStart(2, '0')}
									</span>
									<h3
										className={css({
											margin: '0',
											fontFamily: 'heading',
											fontSize: 'lg',
											fontWeight: '700',
											color: 'text.default',
											letterSpacing: '-0.01em',
										})}
									>
										{interest.title}
									</h3>
								</header>
								<p
									lang="ja"
									className={css({
										margin: '0',
										fontFamily: 'sans',
										fontSize: 'md',
										lineHeight: '1.6',
										color: 'text.default',
									})}
								>
									{interest.description}
								</p>
							</li>
						))}
					</ol>
				</SectionHeading>
			</Container>
		</section>
	);
}

/* -------------------------------------------------------------------------- */
/* Experience section                                                         */
/* -------------------------------------------------------------------------- */

function ExperienceSection({ projects }: { projects: readonly PortfolioProject[] }) {
	return (
		<section aria-labelledby="about-section-experience" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="about-section-experience"
					eyebrow="03 — Experience"
					title="経験 / Selected work"
					description="公開作品の中から語り順で選んだ subset。canonical list は /portfolio 側。"
				>
					{projects.length === 0 ? (
						<output
							className={css({
								display: 'flex',
								flexDirection: 'column',
								gap: '3',
								paddingBlock: '8',
								color: 'text.muted',
							})}
						>
							<p
								className={css({
									margin: '0',
									fontFamily: 'sans',
									fontSize: 'md',
									lineHeight: '1.6',
								})}
							>
								現在、narrative subset に該当する公開作品はありません。
							</p>
						</output>
					) : (
						<ol
							className={css({
								listStyle: 'none',
								margin: '0',
								padding: '0',
								display: 'flex',
								flexDirection: 'column',
							})}
						>
							{projects.map((project) => (
								<li key={project.id}>
									<ExperienceCard project={project} />
								</li>
							))}
						</ol>
					)}
					<p
						lang="ja"
						className={css({
							margin: '0',
							marginBlockStart: '6',
							fontFamily: 'sans',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						すべての作品と解説は{' '}
						<a
							href="/portfolio"
							className={css({
								color: 'text.accent',
								textDecoration: 'underline',
								_focusVisible: {
									outline: '2px solid {colors.border.focus}',
									outlineOffset: '2px',
								},
							})}
						>
							/portfolio
						</a>{' '}
						にあります。
					</p>
				</SectionHeading>
			</Container>
		</section>
	);
}

function ExperienceCard({ project }: { project: PortfolioProject }) {
	const type = project.facets[0]
		? (FACET_LABEL[project.facets[0]] ?? project.facets[0])
		: 'Project';
	return (
		<article
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				paddingBlock: '6',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<header
				className={css({
					display: 'flex',
					alignItems: 'center',
					gap: '3',
					flexWrap: 'wrap',
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
					{type}
				</span>
				{project.periodLabel ? (
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'xs',
							letterSpacing: '0.04em',
							color: 'text.muted',
						})}
					>
						{project.periodLabel}
					</span>
				) : null}
			</header>
			<h3
				className={css({
					margin: '0',
					fontFamily: 'heading',
					fontSize: 'xl',
					fontWeight: '700',
					color: 'text.default',
					lineHeight: '1.25',
					letterSpacing: '-0.01em',
				})}
			>
				<a
					href={`/portfolio/${project.slug}`}
					className={css({
						color: 'inherit',
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
					{project.title}
				</a>
			</h3>
			<p
				lang="ja"
				className={css({
					margin: '0',
					fontFamily: 'sans',
					fontSize: 'md',
					color: 'text.muted',
					lineHeight: '1.6',
				})}
			>
				{project.summary}
			</p>
			{project.role ? (
				<p
					lang="ja"
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					役割: {project.role}
				</p>
			) : null}
		</article>
	);
}

/* -------------------------------------------------------------------------- */
/* Current section                                                            */
/* -------------------------------------------------------------------------- */

function CurrentSection({ items }: { items: readonly string[] }) {
	return (
		<section aria-labelledby="about-section-current" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="about-section-current"
					eyebrow="04 — Current"
					title="現在 / Today"
					description="今、時間を割いていること。半年程度の freshness を想定。"
				>
					<ul
						className={css({
							margin: '0',
							padding: '0',
							listStyle: 'none',
							display: 'flex',
							flexDirection: 'column',
							gap: '3',
							fontFamily: 'sans',
							fontSize: 'md',
							color: 'text.default',
							lineHeight: '1.6',
						})}
					>
						{items.map((item) => (
							<li
								key={item}
								className={css({
									paddingBlock: '3',
									paddingInline: '4',
									borderRadius: '6px',
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: 'border.subtle',
								})}
							>
								{item}
							</li>
						))}
					</ul>
				</SectionHeading>
			</Container>
		</section>
	);
}

/* -------------------------------------------------------------------------- */
/* Future section                                                             */
/* -------------------------------------------------------------------------- */

function FutureSection({
	active,
	parked,
}: {
	active: readonly string[];
	parked: readonly string[];
}) {
	return (
		<section aria-labelledby="about-section-future" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="about-section-future"
					eyebrow="05 — Future"
					title="今後 / Active & parked"
					description="active = 今、方向として進めていること。parked = 意図的に保留しているもの。"
				>
					<div
						className={css({
							display: 'grid',
							gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
							columnGap: '6',
							rowGap: '6',
						})}
					>
						<FutureColumn tone="active" label="Active" items={active} />
						<FutureColumn tone="parked" label="Parked" items={parked} />
					</div>
				</SectionHeading>
			</Container>
		</section>
	);
}

function FutureColumn({
	tone,
	label,
	items,
}: {
	tone: 'active' | 'parked';
	label: string;
	items: readonly string[];
}) {
	return (
		<div
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				paddingBlock: '4',
				paddingInline: '4',
				borderRadius: '6px',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.subtle',
			})}
		>
			<header
				className={css({
					display: 'flex',
					alignItems: 'center',
					gap: '3',
				})}
			>
				<Badge tone={tone === 'active' ? 'accent' : 'neutral'}>{label}</Badge>
			</header>
			<ul
				className={css({
					margin: '0',
					padding: '0',
					listStyle: 'none',
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
					fontFamily: 'sans',
					fontSize: 'md',
					color: 'text.default',
					lineHeight: '1.6',
				})}
			>
				{items.map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* External handles footer                                                    */
/* -------------------------------------------------------------------------- */

function ExternalHandlesFooter({
	handles,
}: {
	handles: AboutPageData['externalHandles'];
}) {
	return (
		<footer
			aria-labelledby="about-footer-heading"
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
					<header
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '2',
						})}
					>
						<span
							aria-hidden="true"
							className={css({
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
							})}
						>
							06 — Finds me elsewhere
						</span>
						<h2
							id="about-footer-heading"
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: 'xl', lg: '2xl' },
								fontWeight: '700',
								lineHeight: '1.15',
								letterSpacing: '-0.02em',
								color: 'text.default',
							})}
						>
							他の場所で見つける / Elsewhere
						</h2>
					</header>
					<ul
						className={css({
							margin: '0',
							padding: '0',
							listStyle: 'none',
							display: 'flex',
							flexWrap: 'wrap',
							gap: '3',
						})}
					>
						{handles.map((handle) => (
							<li key={handle.href}>
								<a
									href={handle.href}
									target="_blank"
									rel="noopener noreferrer"
									className={css({
										display: 'inline-flex',
										alignItems: 'center',
										gap: '2',
										paddingBlock: '2',
										paddingInline: '4',
										borderRadius: 'full',
										borderWidth: '1px',
										borderStyle: 'solid',
										borderColor: 'border.subtle',
										color: 'text.accent',
										fontFamily: 'sans',
										fontSize: 'sm',
										fontWeight: '600',
										textDecoration: 'none',
										_hover: {
											borderColor: 'border.strong',
											textDecoration: 'underline',
										},
										_focusVisible: {
											outline: '2px solid {colors.border.focus}',
											outlineOffset: '2px',
										},
									})}
								>
									{handle.label}
									<span aria-hidden="true">↗</span>
								</a>
							</li>
						))}
					</ul>
				</div>
			</Container>
		</footer>
	);
}
