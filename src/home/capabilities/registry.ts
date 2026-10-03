import type { Capability } from './capability';

/**
 * Capabilities currently surfaced by the home page.
 *
 * This is owned by the home capabilities section. A capability moving
 * from planned to live changes this registry without changing the home
 * composition or the platform-health boundary.
 *
 * Portfolio flipped to `live` in Issue #77 — the `/portfolio` and
 * `/portfolio/[slug]` surfaces are deployed and reachable from
 * this page through the existing CTA pattern. The capability
 * summary strings stay short; richer copy lives on the dedicated
 * surface.
 */
export const CAPABILITIES: readonly Capability[] = [
	{
		id: 'portfolio',
		label: 'Portfolio',
		labelJa: 'ポートフォリオ',
		summary: 'Selected projects with short write-ups and source links.',
		summaryJa: '主要な作品と、その解説・ソースへのリンク。',
		status: 'live',
		href: '/portfolio',
	},
	{
		// `tools` (Issue #80): integrated standalone Web Tools,
		// reachable at /tools via the Tool Registry. Surfaced on
		// the home capabilities grid (Issue #168) so a visitor
		// can reach /tools from `/` in one click — the
		// information-architecture gap that motivated #168.
		id: 'tools',
		label: 'Tools',
		labelJa: 'ツール',
		summary: 'Standalone Web Tools, integrated via the Tool Registry.',
		summaryJa: '単体で動作する Web ツール群。Tool Registry 経由で統合。',
		status: 'live',
		href: '/tools',
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
