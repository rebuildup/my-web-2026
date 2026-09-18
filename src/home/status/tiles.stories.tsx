import type { Meta, StoryObj } from '@storybook/react';
import { StatusTiles } from './tiles';
import type {
	SystemService,
	SystemServiceStatus,
} from './health';

/**
 * StatusTiles stories. The component renders one row per registered
 * service with its binding name and the latest health read. Each
 * variant exercises a different status mix so designers can confirm
 * the mono label, badge tone, and hairline rhythm survive content
 * variation.
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
