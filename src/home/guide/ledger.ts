/**
 * Site guide ledger — the typed configuration the home "構内案内"
 * section renders from (Issue #929, Epic #928).
 *
 * What this file owns
 * -------------------
 * WHICH destinations the top page guides a first-time visitor to,
 * WHAT each one is for, and WHEN a destination is emphasised. It is
 * the "station directory board" data: facilities (site pages), their
 * subordinate destinations, a small set of explicitly chosen external
 * bases, and time-boxed promotions.
 *
 * What it deliberately is NOT
 * ----------------------------
 *   - Not a projection of the URL tree. `/portfolio/$slug` is a
 *     dynamic surface; the ledger names the INDEX and lets the page
 *     itself list members. A route rename is caught by the contract
 *     test (`ledger.test.ts`), not by copying every path here.
 *   - Not a copy of page content. `summaryJa` is one orientation
 *     sentence; the destination page stays the canonical source.
 *   - Not a CMS. Editing this file IS the configuration surface.
 *
 * Safety rules (enforced by `selectGuideEntries` + the contract test)
 * ------------------------------------------------------------------
 *   - `site` entries must resolve to a real public route; `external`
 *     entries must be `https://` and are never confused with routes.
 *   - `/admin*`, tool execution internals and unpublished paths are
 *     refused — the ledger fails closed, it does not warn.
 *   - A promotion can emphasise ONE entry inside its window; it can
 *     never remove the permanent guide entries.
 */

/** A subordinate destination inside a facility (one level deep). */
export interface GuideChild {
	readonly id: string;
	readonly href: string;
	readonly labelJa: string;
	readonly summaryJa: string;
}

/** A time-boxed emphasis window (`YYYY-MM-DD`, inclusive both ends). */
export interface GuidePromotion {
	readonly startsOn: string;
	readonly endsOn: string;
	/** Higher wins when several promotions overlap; default 0. */
	readonly priority?: number;
}

/**
 * The content class a facility belongs to. The value selects one of
 * the four semantic category accents (`accent.category.*`), so the
 * station node's colour MEANS something — it is the same
 * classification the rest of the editorial system uses, not a
 * decorative hue. Absent = neutral station (a utility destination
 * like the contact window that belongs to no content class).
 */
export type GuideCategory = 'design' | 'code' | 'writing' | 'tool';

export interface GuideEntry {
	readonly id: string;
	readonly kind: 'site' | 'external';
	/** Internal path (`/…`) for `site`, absolute `https://` URL for `external`. */
	readonly href: string;
	readonly titleJa: string;
	readonly summaryJa: string;
	readonly category?: GuideCategory;
	readonly children?: readonly GuideChild[];
	/** Time-boxed emphasis; absent = permanent guide position only. */
	readonly promotion?: GuidePromotion;
}

/**
 * The published ledger. Order is the authored reading order — the
 * section renders facilities in this sequence; sorting is not applied
 * because "which facility matters first" is a curation decision, not
 * a measurable one.
 */
export const GUIDE_LEDGER = [
	{
		id: 'about',
		kind: 'site',
		href: '/about',
		titleJa: 'About — この人について',
		summaryJa: '運営者の経歴・考え方・活動の背景。サイト全体の文脈を知りたいときの入口。',
		category: 'writing',
	},
	{
		id: 'portfolio',
		kind: 'site',
		href: '/portfolio',
		titleJa: 'Portfolio — 作品',
		summaryJa: '公開している制作物の一覧。個別の作品ページへはここから辿る。',
		category: 'design',
		children: [
			{
				id: 'portfolio-index',
				href: '/portfolio',
				labelJa: '作品一覧',
				summaryJa: '公開作品の一覧と絞り込み。',
			},
		],
	},
	{
		id: 'dotfiles',
		kind: 'site',
		href: '/projects/dotfiles',
		titleJa: 'Dotfiles — 開発環境の設計図',
		summaryJa: '日々の開発環境を構成する設定群の紹介。実際のリポジトリと同期して更新される。',
		category: 'code',
	},
	{
		id: 'tools',
		kind: 'site',
		href: '/tools',
		titleJa: 'Tools — ブラウザで使える小物',
		summaryJa: 'インストール不要のブラウザツール集。QR 生成・タイマー・変換器など。',
		category: 'tool',
	},
	{
		id: 'keyboard',
		kind: 'site',
		href: '/keyboard',
		titleJa: 'Keyboard — キーボードレイアウト',
		summaryJa: '現在使っているキーボード配列の一覧と、その配置を確認するリファレンス。',
		category: 'design',
	},
	{
		id: 'contact',
		kind: 'site',
		href: '/contact',
		titleJa: 'Contact — 連絡先',
		summaryJa: 're-verified 済みの連絡手段だけを掲載している窓口。',
	},
	{
		id: 'github',
		kind: 'external',
		href: 'https://github.com/rebuildup',
		titleJa: 'GitHub — ソースと活動',
		summaryJa: 'リポジトリとコミット履歴の一次情報。サイト内の「現在地」はここから要約している。',
	},
] as const satisfies readonly GuideEntry[];
