/**
 * Skills — the committed evidence-linked list behind the `/about`
 * skills surface (Issue #391).
 *
 * What this module owns
 * ---------------------
 * The structured display data for the skills view: which technology
 * was used, in which role (current vs past), and WHICH work or
 * record proves it. It is data, not a surface — the presentation
 * lives in `src/about/components/SkillsList.tsx`.
 *
 * The honesty contract (Issue #391 acceptance criteria)
 * -----------------------------------------------------
 *   - Every entry carries at least one `evidence` link to the work
 *     or record that demonstrates the use. A skill with no evidence
 *     does not belong in this list — the legacy site's logo wall
 *     ("1回ちゃんと使ったというくらいを最低ライン") is exactly the
 *     shape this module refuses to reproduce.
 *   - `usage` distinguishes `current` (used in shipped work or the
 *     current toolchain today) from `past` (used in work that is
 *     finished and not part of the current toolchain).
 *   - There is NO proficiency field, by construction: the type has
 *     nowhere to put 「上級」「90%」, and `skills.test.ts` asserts the
 *     committed data carries no level-shaped key. Proficiency is
 *     never guessed; the evidence link is the claim.
 *
 * Evidence targets
 * ----------------
 * `href` is either an internal route (`/portfolio/<slug>` — resolved
 * through the canonical portfolio surface so the public-visibility
 * boundary still applies) or an absolute external URL (the legacy
 * site's history section, which is the only surviving record for
 * the pre-portfolio contest work).
 */

/** Coarse technology family — a label, not a ranking. */
export type SkillCategory = 'language' | 'framework' | 'platform' | 'sdk' | 'tool' | 'design-tool';

/** Whether the technology is part of the current toolchain. */
export type SkillUsage = 'current' | 'past';

/** A work or record that demonstrates the use. */
export interface SkillEvidence {
	readonly label: string;
	/** Internal route (`/portfolio/<slug>`) or absolute external URL. */
	readonly href: string;
}

export interface SkillEntry {
	readonly id: string;
	readonly name: string;
	readonly category: SkillCategory;
	readonly usage: SkillUsage;
	readonly summary?: string;
	readonly evidence: readonly SkillEvidence[];
}

const PORTFOLIO = (slug: string) => `/portfolio/${slug}`;

/**
 * Evidence for the current platform itself: the public repository is
 * the work record (the site has no portfolio entry of its own).
 */
const SITE_REPO_URL = 'https://github.com/rebuildup/my-web-2026';

/**
 * Tastile is a current project but has no public portfolio entry yet;
 * `/about`'s Current section is the public record that names it.
 */
const ABOUT_URL = '/about';

const LEGACY_ABOUT_URL = 'https://yusuke-kim.com/about/';

/**
 * The committed skills list. Every `evidence` entry points at a
 * portfolio project that exists in `src/portfolio/seed.ts` or at the
 * legacy record for the contest-era work; `skills.test.ts` re-checks
 * the portfolio slugs against the seed so a renamed project cannot
 * leave a dead link behind.
 */
export const SKILLS: readonly SkillEntry[] = [
	// --- Current toolchain -------------------------------------------------
	{
		id: 'typescript',
		name: 'TypeScript',
		category: 'language',
		usage: 'current',
		summary: 'my-web-2026 / tastile / Aulymo の実装言語。',
		evidence: [
			{ label: 'my-web-2026', href: SITE_REPO_URL },
			{ label: 'Tastile', href: ABOUT_URL },
			{ label: 'Aulymo', href: PORTFOLIO('aulymo-v03') },
		],
	},
	{
		id: 'react',
		name: 'React',
		category: 'framework',
		usage: 'current',
		summary: 'my-web-2026 と Tastile の UI 実装。',
		evidence: [
			{ label: 'my-web-2026', href: SITE_REPO_URL },
			{ label: 'Tastile', href: ABOUT_URL },
		],
	},
	{
		id: 'tanstack-start',
		name: 'TanStack Start',
		category: 'framework',
		usage: 'current',
		summary: 'my-web-2026 の Web framework。',
		evidence: [{ label: 'my-web-2026', href: SITE_REPO_URL }],
	},
	{
		id: 'hono',
		name: 'Hono',
		category: 'framework',
		usage: 'current',
		summary: 'my-web-2026 の外部 HTTP boundary (`/api/v1/*` 等)。',
		evidence: [{ label: 'my-web-2026', href: SITE_REPO_URL }],
	},
	{
		id: 'panda-css',
		name: 'Panda CSS',
		category: 'framework',
		usage: 'current',
		summary: 'my-web-2026 の styling 基盤。',
		evidence: [{ label: 'my-web-2026', href: SITE_REPO_URL }],
	},
	{
		id: 'cloudflare-workers',
		name: 'Cloudflare Workers / D1 / R2',
		category: 'platform',
		usage: 'current',
		summary: 'my-web-2026 の runtime とデータ層。',
		evidence: [{ label: 'my-web-2026', href: SITE_REPO_URL }],
	},
	{
		id: 'vite',
		name: 'Vite',
		category: 'tool',
		usage: 'current',
		summary: 'my-web-2026 / Tastile の build toolchain。',
		evidence: [
			{ label: 'my-web-2026', href: SITE_REPO_URL },
			{ label: 'Tastile', href: ABOUT_URL },
		],
	},
	{
		id: 'biome',
		name: 'Biome',
		category: 'tool',
		usage: 'current',
		summary: 'my-web-2026 の format / lint 基盤。',
		evidence: [{ label: 'my-web-2026', href: SITE_REPO_URL }],
	},
	{
		id: 'kotlin',
		name: 'Kotlin',
		category: 'language',
		usage: 'current',
		summary: 'Tastile の Android client 実装。',
		evidence: [{ label: 'Tastile', href: ABOUT_URL }],
	},
	{
		id: 'rust',
		name: 'Rust',
		category: 'language',
		usage: 'current',
		summary: 'Tastile の desktop / backend 側で使用。',
		evidence: [{ label: 'Tastile', href: ABOUT_URL }],
	},
	{
		id: 'tauri',
		name: 'Tauri',
		category: 'framework',
		usage: 'current',
		summary: 'Tastile の desktop client。',
		evidence: [{ label: 'Tastile', href: ABOUT_URL }],
	},
	{
		id: 'c-plus-plus',
		name: 'C++',
		category: 'language',
		usage: 'current',
		summary: 'MultiSlicer の After Effects native plugin 実装。',
		evidence: [{ label: 'MultiSlicer', href: PORTFOLIO('multislicer') }],
	},
	{
		id: 'after-effects-sdk',
		name: 'After Effects SDK',
		category: 'sdk',
		usage: 'current',
		summary: 'MultiSlicer の effect plugin 開発。',
		evidence: [{ label: 'MultiSlicer', href: PORTFOLIO('multislicer') }],
	},
	{
		id: 'extendscript',
		name: 'ExtendScript',
		category: 'language',
		usage: 'current',
		summary: 'Aulymo の After Effects 向け tool 実装。',
		evidence: [{ label: 'Aulymo', href: PORTFOLIO('aulymo-v03') }],
	},
	// --- Past use ----------------------------------------------------------
	{
		id: 'unity',
		name: 'Unity',
		category: 'platform',
		usage: 'past',
		summary:
			'U-16 プログラミングコンテスト向けのゲーム制作で使用。現在の制作 toolchain には含まれない。',
		evidence: [{ label: '旧サイト 経歴', href: LEGACY_ABOUT_URL }],
	},
	{
		id: 'scratch',
		name: 'Scratch',
		category: 'tool',
		usage: 'past',
		summary: 'U-16 プログラミングコンテスト2023 の作品制作で使用。',
		evidence: [{ label: '旧サイト 経歴', href: LEGACY_ABOUT_URL }],
	},
	{
		id: 'flask',
		name: 'Flask',
		category: 'framework',
		usage: 'past',
		summary: 'ドキュメントエディター Web アプリ試作で使用（旧サイト記載）。',
		evidence: [{ label: '旧サイト 経歴', href: LEGACY_ABOUT_URL }],
	},
];

/** The category label written next to each skill name. */
export const SKILL_CATEGORY_LABELS: Readonly<Record<SkillCategory, string>> = {
	language: '言語',
	framework: 'フレームワーク',
	platform: 'プラットフォーム',
	sdk: 'SDK',
	tool: 'ツール',
	'design-tool': '制作ツール',
};

/** The usage label used to split the list into current / past. */
export const SKILL_USAGE_LABELS: Readonly<Record<SkillUsage, string>> = {
	current: '現在使用',
	past: '過去に使用',
};

/** Skills currently in the toolchain, in committed order. */
export function selectCurrentSkills(skills: readonly SkillEntry[] = SKILLS): readonly SkillEntry[] {
	return skills.filter((skill) => skill.usage === 'current');
}

/** Skills from finished work, in committed order. */
export function selectPastSkills(skills: readonly SkillEntry[] = SKILLS): readonly SkillEntry[] {
	return skills.filter((skill) => skill.usage === 'past');
}
