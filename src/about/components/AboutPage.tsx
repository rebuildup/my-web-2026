import { Fragment } from 'react';
import { css, cx } from '../../../styled-system/css';
import { PetCompanion, petSafeAreaStyle } from '../../editorial/pet';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { Cluster, Stack } from '../../editorial/primitives/Flow';
import { Grid, Split } from '../../editorial/primitives/Grid';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { SkipLink } from '../../editorial/primitives/SkipLink';
import { TextLink } from '../../editorial/primitives/TextLink';
import { cardTitleClassName } from '../../editorial/primitives/card-title';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import type { PortfolioProject } from '../../portfolio/schema';
import type { CareerEntry } from '../career';
import type { SkillEntry } from '../skills';
import type { AboutPageData } from '../types';
import { CareerTimeline } from './CareerTimeline';
import { SkillsList } from './SkillsList';

/**
 * AboutPage — `/about` route surface (presentation only).
 *
 * Reading order (per `docs/personal/domain.md` §12):
 *   - Hero: identity (name + handle + role)
 *   - 01 — Identity      (name / handle / role cluster as data)
 *   - 02 — Interests     (the throughlines that connect portfolio items)
 *   - 03 — Skills        (evidence-linked toolchain, current vs past)
 *   - 04 — Experience    (curated narrative subset of /portfolio)
 *   - 05 — Career        (verified history timeline, Issue #389)
 *   - 06 — Current       (today)
 *   - 07 — Future        (active vs parked)
 *   - Footer             (finds-me-elsewhere external handles)
 *
 * The companion character (Issue #274) is not a section and owns no
 * number: owner instruction 2026-11-01 moved Melty to a page-level
 * floating overlay, drawn once after the footer.
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

/**
 * On-site reference links in the footer (Issue #390 added `/links`
 * and `/commission`; `/keyboard` predates them; Issue #381 added
 * `/stack`). Order is editorial.
 */
const SITE_REFERENCE_LINKS: ReadonlyArray<{ href: string; label: string }> = [
	{ href: '/links', label: 'リンク集 / Links' },
	{ href: '/commission', label: '制作依頼 / Commission' },
	{ href: '/keyboard', label: 'キーボード配列 / Keyboard' },
	{ href: '/stack', label: '開発スタック / Stack' },
];

const listReset = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
});

const bodyText = css({
	fontFamily: 'sans',
	fontSize: 'md',
	color: 'text.default',
	lineHeight: '1.6',
});

export function AboutPage({ data }: AboutPageProps) {
	const { identity, interests, skills, experience, career, current, future, externalHandles } =
		data;
	return (
		// Issue #767 — the fixed companion occupies the bottom-right
		// corner; the page reserves that corridor so its text never
		// scrolls underneath. See `src/editorial/pet/safe-area.ts`.
		<div className={petSafeAreaStyle}>
			<SkipLink href="#about-main" />
			<Hero identity={identity} />
			<main id="about-main">
				<IdentitySection identity={identity} />
				<InterestsSection interests={interests} />
				<SkillsSection skills={skills} />
				<ExperienceSection projects={experience} />
				<CareerSection entries={career} />
				<CurrentSection items={current} />
				<FutureSection active={future.active} parked={future.parked} />
			</main>
			<ExternalHandlesFooter handles={externalHandles} />
			<PetCompanion />
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The narrative order the hero rail names (Issue #823).
 *
 * The separators between the steps are DRAWN, not typed: the `→`
 * is a Material Symbols glyph, so the rail carries no `→`
 * character in the text layer any more (the rail itself is
 * `aria-hidden`, so the sequence stays a visual cue).
 */
const NARRATIVE_ORDER = [
	'identity',
	'interests',
	'skills',
	'experience',
	'career',
	'current',
	'future',
] as const;

function Hero({ identity }: { identity: AboutPageData['identity'] }) {
	return (
		<PageSection rhythm="hero" labelledBy="about-hero-title">
			<Split rowGap="10" className={css({ alignItems: 'start' })}>
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
					<span lang="en">
						{NARRATIVE_ORDER.map((step, index) => (
							<Fragment key={step}>
								{index > 0 ? (
									<>
										{' '}
										<MaterialSymbol d={ARROW_FORWARD_PATH} size={12} />{' '}
									</>
								) : null}
								{step}
							</Fragment>
						))}
					</span>
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
			</Split>
		</PageSection>
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
		<PageSection labelledBy="about-section-identity" separator>
			<SectionHeading
				id="about-section-identity"
				eyebrow="01 — Identity"
				title="人物像 / Identity"
				description="学校・制作・開発の surface が分かれても、一人の人物から自然に生えているように。"
				variant="spread"
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
		</PageSection>
	);
}

/* -------------------------------------------------------------------------- */
/* Interests section                                                          */
/* -------------------------------------------------------------------------- */

function InterestsSection({ interests }: { interests: AboutPageData['interests'] }) {
	return (
		<PageSection labelledBy="about-section-interests" separator>
			<SectionHeading
				id="about-section-interests"
				eyebrow="02 — Interests"
				title="興味 / Throughlines"
				description="バラバラに見える活動が同じ人物から出てくる理由。プロジェクトを貫く throughline。"
				variant="spread"
			>
				<Stack as="ol" gap="10" className={listReset}>
					{interests.map((interest, index) => (
						<li
							key={interest.title}
							className={css({
								display: 'flex',
								flexDirection: 'column',
								gap: '2',
								borderBlockStartWidth: '1px',
								borderBlockStartStyle: 'solid',
								borderBlockStartColor: 'border.subtle',
								paddingBlockStart: '4',
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
				</Stack>
			</SectionHeading>
		</PageSection>
	);
}

/* -------------------------------------------------------------------------- */
/* Skills section                                                             */
/* -------------------------------------------------------------------------- */

function SkillsSection({ skills }: { skills: readonly SkillEntry[] }) {
	return (
		<PageSection labelledBy="about-section-skills" separator>
			<SectionHeading
				id="about-section-skills"
				eyebrow="03 — Skills"
				title="技術 / Skills"
				description="制作記録で裏付けられた技術だけを掲載。習熟度の数値化はしません。"
				variant="spread"
			>
				<SkillsList skills={skills} />
			</SectionHeading>
		</PageSection>
	);
}

/* -------------------------------------------------------------------------- */
/* Experience section                                                         */
/* -------------------------------------------------------------------------- */

function ExperienceSection({ projects }: { projects: readonly PortfolioProject[] }) {
	return (
		<PageSection labelledBy="about-section-experience" separator>
			<SectionHeading
				id="about-section-experience"
				eyebrow="04 — Experience"
				title="経験 / Selected work"
				description="公開作品の中から語り順で選んだ subset。canonical list は /portfolio 側。"
				variant="spread"
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
					<Stack as="ol" gap="0" className={listReset}>
						{projects.map((project) => (
							<li key={project.id}>
								<ExperienceCard project={project} />
							</li>
						))}
					</Stack>
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
					すべての作品と解説は <TextLink href="/portfolio">/portfolio</TextLink> にあります。
				</p>
			</SectionHeading>
		</PageSection>
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
			<h3 className={cardTitleClassName}>
				<a
					href={`/portfolio/${project.slug}`}
					className={css({
						color: 'inherit',
						textDecoration: 'underline',
						textUnderlineOffset: '0.18em',
						textDecorationThickness: '1px',
						// The heading itself is the link, so a full-ink rule under
						// every line would shout. The underline stays (it is now
						// the only affordance) but is drawn in the identifying-
						// rule tone instead of the body ink.
						textDecorationColor: 'border.strong',
						_focusVisible: {
							outline: '2px solid {colors.border.focus}',
							outlineOffset: '4px',
							borderRadius: '2px',
						},
						_hover: {
							textDecorationThickness: '2px',
							textDecorationColor: 'currentColor',
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
/* Career section                                                             */
/* -------------------------------------------------------------------------- */

function CareerSection({ entries }: { entries: readonly CareerEntry[] }) {
	return (
		<PageSection labelledBy="about-section-career" separator>
			<SectionHeading
				id="about-section-career"
				eyebrow="05 — Career"
				title="経歴 / History"
				description="旧サイトの年表を出典つきで再構成し、確認済みの項目だけを掲載しています。"
				variant="spread"
			>
				<CareerTimeline entries={entries} />
			</SectionHeading>
		</PageSection>
	);
}

/* -------------------------------------------------------------------------- */
/* Current section                                                            */
/* -------------------------------------------------------------------------- */

function CurrentSection({ items }: { items: readonly string[] }) {
	return (
		<PageSection labelledBy="about-section-current" separator>
			<SectionHeading
				id="about-section-current"
				eyebrow="06 — Current"
				title="現在 / Today"
				description="今、時間を割いていること。半年程度の freshness を想定。"
				variant="spread"
			>
				<Stack as="ul" gap="4" className={cx(listReset, bodyText)}>
					{items.map((item) => (
						<li
							key={item}
							className={css({
								display: 'flex',
								gap: '3',
								alignItems: 'baseline',
								borderBlockStartWidth: '1px',
								borderBlockStartStyle: 'solid',
								borderBlockStartColor: 'border.subtle',
								paddingBlockStart: '3',
							})}
						>
							<MaterialSymbol
								className={css({
									flexShrink: '0',
									color: 'text.muted',
								})}
								d={ARROW_FORWARD_PATH}
								size={12}
							/>
							<span>{item}</span>
						</li>
					))}
				</Stack>
			</SectionHeading>
		</PageSection>
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
		<PageSection labelledBy="about-section-future" separator>
			<SectionHeading
				id="about-section-future"
				eyebrow="07 — Future"
				title="今後 / Active & parked"
				description="active = 今、方向として進めていること。parked = 意図的に保留しているもの。"
				variant="spread"
			>
				<Grid columns={2} columnGap="6" rowGap="6">
					<FutureColumn tone="active" label="Active" items={active} />
					<FutureColumn tone="parked" label="Parked" items={parked} />
				</Grid>
			</SectionHeading>
		</PageSection>
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
		<Stack gap="4">
			<header
				className={css({
					display: 'flex',
					alignItems: 'center',
					gap: '3',
				})}
			>
				<Badge tone={tone === 'active' ? 'accent' : 'neutral'}>{label}</Badge>
			</header>
			<Stack as="ul" gap="4" className={cx(listReset, bodyText)}>
				{items.map((item) => (
					<li
						key={item}
						className={css({
							display: 'flex',
							gap: '3',
							alignItems: 'baseline',
							borderBlockStartWidth: '1px',
							borderBlockStartStyle: 'solid',
							borderBlockStartColor: 'border.subtle',
							paddingBlockStart: '3',
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
							{tone === 'active' ? '◆' : '·'}
						</span>
						<span>{item}</span>
					</li>
				))}
			</Stack>
		</Stack>
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
				<Stack gap="6">
					<Stack gap="2">
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
							08 — Finds me elsewhere
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
					</Stack>
					<Cluster as="ul" gap="3" className={listReset}>
						{handles.map((handle) => (
							<li key={handle.href}>
								<TextLink
									variant="chip"
									href={handle.href}
									target="_blank"
									rel="noopener noreferrer"
								>
									{handle.label}
									<span aria-hidden="true">↗</span>
								</TextLink>
							</li>
						))}
					</Cluster>
					<nav aria-label="サイト内リファレンス">
						<Cluster as="ul" gap="3" className={listReset}>
							{SITE_REFERENCE_LINKS.map((item) => (
								<li key={item.href}>
									<TextLink variant="chip" href={item.href}>
										{item.label}
										<MaterialSymbol d={ARROW_FORWARD_PATH} size={16} />
									</TextLink>
								</li>
							))}
						</Cluster>
					</nav>
				</Stack>
			</Container>
		</footer>
	);
}
