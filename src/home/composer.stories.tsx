import type { Meta, StoryObj } from '@storybook/react';
import { HomePage } from './composer';
import type { HomePageData } from './composer';

/**
 * HomePage composition stories. The component is purely a function
 * of the loader-shaped `HomePageData` prop, so each variant just
 * supplies a different snapshot. Designers use these stories to
 * iterate on the four-section editorial spread layout without
 * re-running SSR.
 *
 * All four sections (Hero / Capabilities / Status / Footer) sit on
 * the same 12-column grid inside a 1024px `Container`. Body sections
 * render as a 4/12 (heading cluster) + 8/12 (content) spread via
 * `SectionHeading` with `variant="spread"`. The Hero mirrors the same
 * 4/8 split so the metadata rail aligns with the body section
 * headings on the same x-axis. The Footer uses three equal columns.
 *
 * Section differentiation comes from spacing and type, not from
 * per-section borders or background fills.
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
			reactions: {
				target_key: 'home-page',
				aggregates: [
					{ kind: 'emoji', value: 'thumbs_up', count: 17 },
					{ kind: 'emoji', value: 'tada', count: 9 },
					{ kind: 'emoji', value: 'fire', count: 4 },
				],
				// Visitor state for the Storybook viewer (no cookie →
				// empty). Real deployments populate this from
				// `mw_actor_id` (P1 #1 fix).
				viewer_reactions: [],
				catalog: [
					{ slug: 'thumbs_up', codepoint: '👍', enabled: true },
					{ slug: 'tada', codepoint: '🎉', enabled: true },
					{ slug: 'fire', codepoint: '🔥', enabled: true },
					{ slug: 'rocket', codepoint: '🚀', enabled: true },
				],
				enabled: true,
			},
			counter: {
				key: 'home-page',
				count: 1234,
				first_hit: Date.parse('2026-09-01T00:00:00Z'),
				last_hit: Date.parse('2026-09-17T15:02:16.985Z'),
				enabled: true,
			},
			projects: [
				{
					id: 'my-web-2026',
					name: 'my-web-2026',
					statusJa: '個人 Web Platform の再構築。',
				},
			],
			githubActivity: {
				generatedOn: '2026-09-17',
				windowDays: 30,
				sources: {
					public: { status: 'ok', observedAt: '2026-09-17T15:00:00.000Z' },
					private: { status: 'ok', observedAt: '2026-09-17T15:00:00.000Z' },
				},
				feed: [
					{
						id: 'feed-1',
						kind: 'public',
						repoId: 'my-web-2026',
						type: 'PushEvent',
						at: '2026-09-17T14:30:00.000Z',
						href: 'https://github.com/rebuildup/my-web-2026',
					},
				],
				topRepos: [
					{
						id: 'rebuildup/example-repo',
						name: 'example-repo',
						href: 'https://github.com/rebuildup/example-repo',
						commits: 128,
						pullRequests: 14,
						windowDays: 30,
					},
				],
				repoCount: { public: 3, private: 1 },
			},
			adProjects: [
				{
					slug: 'mic-level',
					title: 'Mic Level',
					summary: 'OBS と同じ目盛りでマイク音量を確認。',
					coverUrl: '/media/portfolio/mic-level/cover.webp',
					coverAlt: 'Mic Level の画面。',
				},
			],
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

/**
 * External snapshots unavailable (Issue #935): the committed GitHub
 * activity snapshot could not be read (`null`) and the project roster
 * is empty. The guide, projects section, ads, reactions and counter
 * must stay fully operable while the activity card renders its honest
 * unavailable state — no fabricated "online".
 */
export const SnapshotsUnavailable: Story = {
	args: {
		data: {
			...AllReachable.args?.data,
			projects: [],
			githubActivity: null,
		},
	},
};
