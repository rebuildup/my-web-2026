import type { Meta, StoryObj } from '@storybook/react';
import { MonochromeProof } from '../../../.storybook/MonochromeProof';
import type { SystemService, SystemServiceStatus } from './health';
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
