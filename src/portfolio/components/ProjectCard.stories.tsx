import type { Meta, StoryObj } from '@storybook/react';
import { MonochromeProof } from '../../../.storybook/MonochromeProof';
import { css } from '../../../styled-system/css';
import type { PortfolioFacet, PortfolioProject } from '../schema';
import { ProjectCard } from './ProjectCard';

/**
 * ProjectCard stories (Issue #411).
 *
 * The card is the surface where the content category used to be
 * encoded by hue alone: a 4px rule painted `accent.category.<facet>`
 * and nothing else. Issue #794 removed that rule (owner decision,
 * 2026-11-01 — no left rule, no left border), so what these fixtures
 * compare is now three separate things:
 *
 *   1. the PLANE — the card's own `bg.surface` against the page's
 *      `bg.canvas`, a luminance step rather than a hue, which is why it
 *      survives the greyscale frame below;
 *   2. the SHAPE — the `StateMark` silhouette, one per category
 *      (diamond / square / chevron / stacked bars);
 *   3. the WORD — the upper-case category label beside the mark.
 *
 * All four categories sit in one frame so 1–3 can be compared side by
 * side, and then the same frame in greyscale. Nothing on this card is
 * painted with a category hue, so the greyscale frame is not an
 * approximation of the cue — it IS the cue.
 *
 * Every row is a SYNTHETIC placeholder on purpose. A story must never
 * be able to invent a portfolio fact: the titles, roles and periods
 * here are numbered placeholders, exactly like
 * `test/fixtures/large-portfolio-fixture.ts`.
 *
 * Media is left empty on purpose — `cover = null` is the real branch
 * for a project with no uploaded media, and it keeps the fixture free
 * of R2 URLs so the story renders identically offline.
 */
const meta = {
	title: 'portfolio/ProjectCard',
	component: ProjectCard,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof ProjectCard>;

export default meta;
type Story = StoryObj<typeof meta>;

function placeholder(facet: PortfolioFacet, index: number): PortfolioProject {
	return {
		id: `p-${index}`,
		slug: `placeholder-${facet}`,
		title: `Placeholder ${facet} project`,
		summary: 'Synthetic fixture row. Not a real project.',
		role: 'Engineer',
		periodStart: 2_020,
		periodEnd: 2_021,
		periodLabel: '2020 — 2021',
		motivationMd: '',
		architectureMd: null,
		constraintsMd: null,
		implementationMd: null,
		evidenceMd: null,
		retrospectiveMd: null,
		facets: [facet],
		technologies: [],
		visibility: 'public',
		status: 'published',
		pinned: false,
		displayOrder: index,
		createdAt: 0,
		updatedAt: 0,
		links: [],
		media: [],
	};
}

const FACETS: readonly PortfolioFacet[] = ['design', 'develop', 'video', 'other'];

function Row({ facets }: { facets: readonly PortfolioFacet[] }) {
	return (
		<div
			// The page canvas, so the card's `bg.surface` plane is visible
			// against the same background it ships on.
			className={css({
				display: 'flex',
				flexDirection: 'column',
				backgroundColor: 'bg.canvas',
				padding: '6',
			})}
		>
			{facets.map((facet, index) => (
				<ProjectCard key={facet} project={placeholder(facet, index)} />
			))}
		</div>
	);
}

/** All four categories, full appearance. */
export const AllCategories: Story = {
	args: { project: placeholder('design', 0) },
	render: () => <Row facets={FACETS} />,
};

/** The greyscale proof — the frame `docs/verification/a11y/` records. */
export const Monochrome: Story = {
	args: { project: placeholder('design', 0) },
	render: () => (
		<MonochromeProof caption="greyscale — the plane is a luminance step (not a hue); category shapes: diamond = design, square = code, chevron = tool, bars = writing">
			<Row facets={FACETS} />
		</MonochromeProof>
	),
};

/** A project with no facets: no category cue at all, and none invented. */
export const NoFacets: Story = {
	args: { project: placeholder('design', 0) },
	render: () => <Row facets={[]} />,
};
