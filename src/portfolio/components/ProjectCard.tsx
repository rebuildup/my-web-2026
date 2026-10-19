import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { StateMark } from '../../editorial/primitives/StateMark';
import type { PortfolioProject } from '../schema';
import { PortfolioMediaFigure } from './PortfolioMedia';

/**
 * ProjectCard — list item for `/portfolio`.
 *
 * Reading order (per the editorial coordinate system):
 *   1. cover media (when present),
 *   2. project type (facet label, mono / muted),
 *   3. title,
 *   4. summary,
 *   5. role + period,
 *   6. facet pills,
 *   7. detail link.
 *
 * Pinned projects receive an explicit `Pinned` badge so the
 * editorial intent at the data layer shows up on the surface.
 *
 * The card is a link to the detail route — semantic markup: the
 * `<a>` wraps the title and the whole card (CSS `::after`
 * pseudo-element extends the hit area to the entire card
 * surface).
 *
 * Issue #172 — semantic category accent. The card carries a 4px
 * left-border using `accent.category.<facet>` so the four
 * content categories (design / code / writing / tool) read as a
 * visual hint on each list item without changing the existing
 * reading order. Facet → category mapping:
 *   develop → code, video → tool, design → design, other → writing.
 *
 * Issue #490 — the facet group carries `role="group"`. The
 * `aria-label` on this container was attached to a bare `<div>`,
 * whose implicit ARIA role is `generic`. `aria-label` is a
 * PROHIBITED attribute there: the name is dropped before it reaches
 * any accessibility API, so the pills were announced as an
 * unlabelled run of badges. On a list surface that is one defect per
 * card — 100 on the loader's default page size, 120 on the measured
 * fixture — rather than one mistake. `role="group"` gives the
 * container a role that supports naming, adds no DOM node, changes
 * nothing visually, and is what makes Chromium's accessibility tree
 * expose the pills as a named group (measured: 0 such nodes
 * before, 100 after).
 *
 * The same bare-`<div>` shape exists in `FacetFilter` and
 * `PortfolioDetail`. Neither scales with the catalogue — one page
 * filter and one detail page — so they are outside the surface this
 * Issue measured and are left for a follow-up instead of being fixed
 * silently here.
 *
 * Issue #411 — the category rule is no longer the ONLY
 * non-textual cue, and it is no longer the only cue at all. Before
 * this ticket the 4px rule was four hues of one identical bar: a
 * visitor who cannot separate `accent.category.writing` from
 * `accent.category.code` had nothing left to read the category from,
 * because the coloured rule was the only element that carried it
 * (the facet pills name the FACET, which is a different word for the
 * same fact). The card now pairs the rule with a `StateMark` whose
 * silhouette is unique per category (diamond / square / bars /
 * chevron) and with the existing upper-case category word, so
 * shape + text carry the category when hue is removed — WCAG 2.2
 * SC 1.4.1 (Level A). The rule itself stays `aria-hidden` and keeps
 * its category colour as reinforcement only.
 */
export interface ProjectCardProps {
	project: PortfolioProject;
}

const FACET_LABEL: Readonly<Record<string, string>> = {
	develop: 'Develop',
	video: 'Video',
	design: 'Design',
	other: 'Other',
};

const FACET_CATEGORY: Readonly<Record<string, 'design' | 'code' | 'writing' | 'tool'>> = {
	develop: 'code',
	video: 'tool',
	design: 'design',
	other: 'writing',
};

export function ProjectCard({ project }: ProjectCardProps) {
	const cover = project.media.find((m) => m.isCover) ?? project.media[0] ?? null;
	const type = project.facets[0]
		? (FACET_LABEL[project.facets[0]] ?? project.facets[0])
		: 'Project';
	const category = project.facets[0] ? (FACET_CATEGORY[project.facets[0]] ?? null) : null;
	return (
		<article
			// Issue #411: the category is a published fact of the card,
			// not a private styling detail, so it is exposed as a
			// stable hook for the regression tests and for the
			// monochrome verification fixture. The accessible name
			// still comes from the facet pills below — see the Issue
			// note above.
			data-category={category ?? undefined}
			className={css({
				position: 'relative',
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'minmax(0, 4fr) minmax(0, 8fr)' },
				columnGap: { base: '0', md: '8' },
				rowGap: { base: '4', md: '0' },
				paddingBlock: '8',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<div
				aria-hidden="true"
				className={css({
					position: 'absolute',
					left: '0',
					top: '0',
					bottom: '0',
					width: { base: '0', md: '4px' },
					backgroundColor: category ? `accent.category.${category}` : 'transparent',
				})}
			/>
			{cover ? (
				<div className={css({ minWidth: '0' })}>
					<PortfolioMediaFigure media={cover} loading="lazy" />
				</div>
			) : null}
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
					minWidth: '0',
				})}
			>
				<header
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '2',
					})}
				>
					<div
						className={css({
							display: 'flex',
							alignItems: 'center',
							gap: '3',
						})}
					>
						<span
							aria-hidden="true"
							className={css({
								display: 'inline-flex',
								alignItems: 'center',
								gap: '1',
								fontFamily: 'mono',
								fontSize: 'xs',
								letterSpacing: '0.06em',
								textTransform: 'uppercase',
								color: 'text.muted',
							})}
						>
							{category ? <StateMark kind={category} size="sm" /> : null}
							{type}
						</span>
						{project.pinned ? <Badge tone="accent">Pinned</Badge> : null}
					</div>
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
				</header>
				<p
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
				<dl
					className={css({
						margin: '0',
						display: 'grid',
						gridTemplateColumns: { base: '1fr', sm: 'auto auto' },
						columnGap: '6',
						rowGap: '1',
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
				{/* biome-ignore lint/a11y/useSemanticElements: `role="group"` is the right grouping for a set of static facet badges. A `<fieldset>` would claim a form-control grouping these badges are not, and the card's role / period pairs already use a `<dl>`. */}
				<div
					// Issue #490: `role="group"` is what makes the
					// `aria-label` below reachable — a generic-role
					// <div> silently drops it.
					role="group"
					aria-label="facets"
					className={css({
						display: 'flex',
						flexWrap: 'wrap',
						gap: '2',
					})}
				>
					{project.facets.map((facet) => (
						<Badge key={facet} tone="neutral">
							{FACET_LABEL[facet] ?? facet}
						</Badge>
					))}
				</div>
			</div>
		</article>
	);
}
