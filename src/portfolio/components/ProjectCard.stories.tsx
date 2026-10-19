import type { Meta, StoryObj } from '@storybook/react';
import { MonochromeProof } from '../../../.storybook/MonochromeProof';
import type { PortfolioFacet, PortfolioProject } from '../schema';
import { ProjectCard } from './ProjectCard';

/**
 * ProjectCard stories (Issue #411).
 *
 * The card is the surface where the content category was encoded by
 * hue alone: a 4px rule painted `accent.category.<facet>` and
 * nothing else. These fixtures put all four categories in one frame so
 * the non-colour half of the cue — the `StateMark` silhouette and the
 * upper-case category word — can be compared side by side, and then
 * the same frame in greyscale.
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
		<div style={{ display: 'flex', flexDirection: 'column' }}>
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
		<MonochromeProof caption="greyscale — category shapes: diamond = design, square = code, chevron = tool, bars = writing">
			<Row facets={FACETS} />
		</MonochromeProof>
	),
};

/** A project with no facets: no category cue at all, and none invented. */
export const NoFacets: Story = {
	args: { project: placeholder('design', 0) },
	render: () => <Row facets={[]} />,
};
