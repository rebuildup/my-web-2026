import type { Meta, StoryObj } from '@storybook/react';
import { HomePage } from './composer';
import type { HomePageData } from './composer';

/**
 * HomePage composition stories. The component is purely a function
 * of the loader-shaped `HomePageData` prop, so each variant just
 * supplies a different snapshot. Designers use these stories to
 * iterate on the four-section layout without re-running SSR.
 */
const meta = {
	title: 'home/HomePage',
	component: HomePage,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof HomePage>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseStatuses: HomePageData['statuses'] = [
	{ id: 'external-boundary', health: 'ok', detail: '/api/v1/* wired through src/http/hono.ts' },
	{ id: 'd1', health: 'ok', detail: 'SELECT 1 returned 1' },
	{ id: 'r2', health: 'ok', detail: 'bucket reachable, probe key absent' },
];

const degradedStatuses: HomePageData['statuses'] = [
	{ id: 'external-boundary', health: 'ok', detail: '/api/v1/* wired through src/http/hono.ts' },
	{ id: 'd1', health: 'degraded', detail: 'empty result set' },
	{ id: 'r2', health: 'unreachable' },
];

export const AllReachable: Story = {
	args: {
		data: {
			capabilities: [
				{
					id: 'portfolio',
					label: 'Portfolio',
					labelJa: 'ポートフォリオ',
					summary: 'Selected projects with short write-ups and source links.',
					summaryJa: '主要な作品と、その解説・ソースへのリンク。',
					status: 'planned',
				},
				{
					id: 'content',
					label: 'Content',
					labelJa: 'コンテンツ',
					summary: 'Long-form notes and posts, surfaced via RSS and JSON feed.',
					summaryJa: '長めのノートや記事。RSS と JSON フィードで配信。',
					status: 'planned',
				},
				{
					id: 'activity',
					label: 'Activity',
					labelJa: 'アクティビティ',
					summary: 'Recent commits, releases, and shipped work in one timeline.',
					summaryJa: '最近のコミット・リリース・出荷した仕事を 1 本のタイムラインに。',
					status: 'planned',
				},
			],
			services: [
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
			],
			statuses: baseStatuses,
			observedAt: '2026-09-17T15:02:16.985Z',
		},
	},
};

export const Degraded: Story = {
	args: {
		data: {
			...AllReachable.args?.data,
			statuses: degradedStatuses,
		},
	},
};
