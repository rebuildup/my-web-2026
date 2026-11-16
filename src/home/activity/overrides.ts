/**
 * Hand-written overrides for GitHub-derived projects (Issues #316 /
 * #932). The generator supplies FACTS; this file supplies the words
 * and the exceptions — exactly the split the Epic requires
 * ("説明や例外はコード/設定で補完。基本情報の手入力を自動選定の
 * 前提にしない").
 *
 * Keys are the snapshot ids: `owner/name` for public repos,
 * `private-<hash>` for anonymised private ones. An override can
 * rename the display, replace the summary, set a weight level, or
 * exclude the project entirely. It can NEVER add a repository the
 * generator did not observe — overrides annotate, they do not invent.
 */

import type { ActivityRepoFacts } from './contract';

export interface ActivityOverride {
	readonly name?: string;
	readonly summaryJa?: string;
	readonly weightLevel?: ActivityRepoFacts['weightLevel'];
	readonly exclude?: boolean;
}

export const ACTIVITY_OVERRIDES: Readonly<Record<string, ActivityOverride>> = {
	// Example shape (uncomment and fill as needed):
	// 'rebuildup/my-web-2026': { summaryJa: '個人 Web Platform の再構築。' },
};
