import type { Meta, StoryObj } from '@storybook/react';
import { MonochromeProof } from '../../../.storybook/MonochromeProof';
import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import type { SystemService, SystemServiceStatus } from './health';
import type { KnownIncident } from './incidents';
import { StatusTiles } from './tiles';

/**
 * StatusTiles stories. The component renders one row per registered
 * service with its binding name and the latest health read. Each
 * variant exercises a different status mix so designers can confirm
 * the editorial spread rhythm survives content variation.
 *
 * The section uses the spread `SectionHeading`. Rows are separated
 * by `gap: 10` (40px) — a golden-ratio jump from the card-level
 * `gap: 4` to mark the transition from heading cluster to service
 * rows. The `dt` is sans-bold at `lg` with the binding rendering
 * adjacent in mono `sm`; the badge anchors the right edge. The
 * observed-at line sits at `marginBlockStart: 10`, separated from
 * the last row by a deliberate beat.
 */
const meta = {
	title: 'home/StatusTiles',
	component: StatusTiles,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof StatusTiles>;

export default meta;
type Story = StoryObj<typeof meta>;

const services: readonly SystemService[] = [
	{
		id: 'external-boundary',
		label: 'External boundary',
		binding: 'Hono',
		description: 'Public REST endpoints at /api/v1/*.',
	},
	{
		id: 'd1',
		label: 'Internal data',
		binding: 'D1',
		description: 'Structured content queried via createServerFn.',
	},
	{
		id: 'r2',
		label: 'Media',
		binding: 'R2',
		description: 'Blob storage for media and assets.',
	},
];

const allOk: readonly SystemServiceStatus[] = [
	{ id: 'external-boundary', health: 'ok', detail: '/api/v1/* wired through src/http/hono.ts' },
	{ id: 'd1', health: 'ok', detail: 'SELECT 1 returned 1' },
	{ id: 'r2', health: 'ok', detail: 'bucket reachable, probe key absent' },
];

const mixedHealth: readonly SystemServiceStatus[] = [
	{ id: 'external-boundary', health: 'ok', detail: '/api/v1/* wired through src/http/hono.ts' },
	{ id: 'd1', health: 'degraded', detail: 'empty result set' },
	{ id: 'r2', health: 'unreachable' },
];

/** One row per health — the greyscale / narrow-width frames need all three at once. */
const allThreeHealths: readonly SystemServiceStatus[] = [
	{ id: 'external-boundary', health: 'ok', detail: 'all probes returned within budget' },
	{ id: 'd1', health: 'degraded', detail: 'empty result set' },
	{ id: 'r2', health: 'unreachable' },
];

export const AllOk: Story = {
	args: {
		services,
		statuses: allOk,
		observedAt: '2026-09-17T15:02:16.985Z',
	},
};

export const MixedHealth: Story = {
	args: {
		services,
		statuses: mixedHealth,
		observedAt: '2026-09-17T15:02:16.985Z',
	},
};

export const EmptyStatuses: Story = {
	args: {
		services,
		statuses: [],
		observedAt: '2026-09-17T15:02:16.985Z',
	},
};

/**
 * Locale previews (Issue #430). The observed-at line is the section's
 * only instant, and it is rendered through the home format adapter:
 * the same snapshot reads per locale and names the zone it was read
 * in. The zone defaults to UTC so the server HTML and the hydrated
 * HTML stay identical.
 */
export const LocaleJa: Story = {
	args: {
		services,
		statuses: allOk,
		observedAt: '2026-01-05T09:00:00.000Z',
		locale: 'ja',
	},
};

export const LocaleKo: Story = {
	args: {
		services,
		statuses: allOk,
		observedAt: '2026-01-05T09:00:00.000Z',
		locale: 'ko',
	},
};

export const LocaleTokyo: Story = {
	args: {
		services,
		statuses: allOk,
		observedAt: '2026-01-05T09:00:00.000Z',
		timeZone: 'Asia/Tokyo',
	},
};

/**
 * Issue #411 — the greyscale proof.
 *
 * Every health in one frame, hue removed. Before this ticket the
 * three states were three identical pills once colour was taken away
 * (`ok` differed only by its accent fill). The frame is what makes
 * that regression visible without a colour-vision simulator: if the
 * rows read the same here, the badge is colour-only and WCAG 2.2 SC
 * 1.4.1 (Level A) is violated. Capture it once per appearance — the
 * semantic tokens switch on `prefers-color-scheme`, so the light and
 * dark frames are two emulations of the SAME story, not two stories.
 */
export const Monochrome: Story = {
	args: {
		services,
		statuses: allThreeHealths,
		observedAt: '2026-01-05T09:00:00.000Z',
	},
	render: (args) => (
		<MonochromeProof caption="greyscale — status shapes: disc = reachable, triangle = degraded, cross = unreachable">
			<StatusTiles {...args} />
		</MonochromeProof>
	),
};

/**
 * Issue #502 — the incident-context gallery.
 *
 * This is the verification surface of the status section, and it is
 * what `scripts/capture-status-incident-context.mjs` screenshots
 * for `docs/verification/ops/status-incident-context.webp`. It is a
 * REPORT of the section, not a page of the site: no route mounts it.
 *
 * Two panels, because the two things this ticket adds have to be
 * seen TOGETHER to be checkable:
 *
 *   - panel 1 is the PUBLISHED state: a service with no reading at
 *     all (no entry in the snapshot) and a committed incident list
 *     that is empty, which is the honest starting point — the
 *     section says "no incidents recorded" and links the public
 *     issue tracker;
 *   - panel 2 carries a SAMPLE incident record, labelled as a
 *     verification sample and pointing at the canonical public
 *     tracker. It exists to prove the record renders (title, date,
 *     summary, link); it is NOT a published incident, and the
 *     published list stays empty until a real incident is recorded
 *     in `src/home/status/incidents.ts`.
 *
 * The two panels together also show the whole health vocabulary:
 * reachable, degraded, not observed (panel 1) and unreachable
 * (panel 2) — the four states are four different silhouettes.
 */
const galleryLabelClassName = css({
	margin: '0',
	paddingBlockStart: '8',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.06em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const galleryNoteClassName = css({
	margin: '0',
	marginBlockStart: '2',
	maxWidth: '720px',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
});

/** A verification-only record. It is NOT a published incident. */
const SAMPLE_INCIDENT: KnownIncident = {
	id: 'verification-sample',
	title: 'Sample incident record (verification only)',
	occurredAt: '2026-09-17',
	summary:
		'A sample record rendered by the verification gallery to prove the record shape: title, date, summary and a public link.',
	reference: 'https://github.com/rebuildup/my-web-2026/issues',
};

/** No entry for `r2`: the service was not observed at all. */
const publishedSurfaceStatuses: readonly SystemServiceStatus[] = [
	{ id: 'external-boundary', health: 'ok', detail: '/api/v1/* wired through src/http/hono.ts' },
	{ id: 'd1', health: 'degraded', detail: 'empty result set' },
];

/** A failed read still reads as a failure, next to an absent one. */
const failureSurfaceStatuses: readonly SystemServiceStatus[] = [
	{ id: 'external-boundary', health: 'ok', detail: '/api/v1/* wired through src/http/hono.ts' },
	{ id: 'd1', health: 'unreachable' },
];

export const IncidentContext: Story = {
	args: {
		services,
		statuses: publishedSurfaceStatuses,
		observedAt: '2026-09-17T15:02:16.985Z',
		incidents: [],
	},
	render: (args) => (
		<div data-testid="status-incident-context">
			<Container>
				<p className={galleryLabelClassName}>
					published surface — nothing observed, nothing recorded
				</p>
				<p className={galleryNoteClassName}>
					`r2` has no entry in the snapshot: it renders as「未観測 / not observed」, not as a
					failure. The committed incident list is empty, so the section states that no incident is
					recorded and links the public issue tracker.
				</p>
			</Container>
			<StatusTiles {...args} headingId="status-heading-published" />
			<Container>
				<p className={galleryLabelClassName}>
					verification sample — a record shape, not a published incident
				</p>
				<p className={galleryNoteClassName}>
					A failed read still reads as「到達不能 / unreachable」next to an absent one, and a sample
					record shows the published record shape. The sample is not in the published list and is
					never rendered on the site.
				</p>
			</Container>
			<StatusTiles
				{...args}
				headingId="status-heading-sample"
				statuses={failureSurfaceStatuses}
				incidents={[SAMPLE_INCIDENT]}
			/>
		</div>
	),
};

/**
 * Issue #411 — the reduced-width layout. Below `md` the row collapses
 * to a single column and the badge moves under the detail text, so
 * the shape is the first thing still readable at 200% zoom on a
 * phone-width viewport.
 */
export const NarrowViewport: Story = {
	args: {
		services,
		statuses: allThreeHealths,
		observedAt: '2026-01-05T09:00:00.000Z',
	},
	render: (args) => (
		<div style={{ width: '360px', border: '1px solid #d0d0d0' }}>
			<StatusTiles {...args} />
		</div>
	),
};
