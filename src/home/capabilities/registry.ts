import type { Capability } from './capability';

/**
 * Capabilities currently surfaced by the home page.
 *
 * This is owned by the home capabilities section. A capability moving
 * from planned to live changes this registry without changing the home
 * composition or the platform-health boundary.
 */
export const CAPABILITIES: readonly Capability[] = [
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
] as const;
