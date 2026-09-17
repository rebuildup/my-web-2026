import type { Capability, SystemService } from '../model';

/**
 * Static capability inventory for the home page.
 *
 * Lives in `data/` (not in the component) so future ticket PRs that
 * flip a capability to `live` only edit one place. The home page
 * does not render routes that have not landed yet; until a
 * capability is live, the corresponding section shows a `planned`
 * state.
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

/**
 * Canonical list of platform services surfaced on the home page.
 *
 * The order here is the render order in the SystemStatusSection.
 * Adding a new service means adding it to `SystemServiceId` in
 * `model.ts`, populating status in `server.ts`, and appending to
 * this array.
 */
export const SYSTEM_SERVICES: readonly SystemService[] = [
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
] as const;
