/**
 * `/commission` — 制作依頼の受付状況と依頼内容 (Issue #390, relates to
 * the parked spikes #368 / #369).
 *
 * This module is the repo-controlled source of truth for the public
 * commission page. The service descriptions, the request flow, the
 * information an estimate needs and the software list are ported
 * from the predecessor site
 * (`my-web-2025/src/app/about/commission/{develop,video}/page.tsx`)
 * — the same facts the owner published there, restated in the 2026
 * editorial voice.
 *
 * What is deliberately NOT here, and why:
 *
 *   - **No prices.** The 2025 video page carried a 「料金例」 table
 *     and a full estimate calculator, but the same page marked the
 *     figures as 検討段階 (under review), and Issue #369 reserves the
 *     pricing surface for a preview-only prototype until the owner
 *     fixes a real pricing policy. Publishing the 2025 numbers would
 *     state a price list the owner has not re-confirmed for this
 *     platform.
 *   - **No intake form / CTA.** The commission mode is `parked` in
 *     the approved `/about` narrative (`src/about/data.ts`
 *     `future.parked`: 依頼制の映像 / デザイン制作を継続的に受ける
 *     mode は現時点では parked). The page therefore renders the
 *     status honestly — 受付休止中 — and points at `/contact` for
 *     the verified channels, exactly what spike #368 asks the
 *     contact surface to do.
 *   - **No response-time / business-hours claims.** The 2025 pages
 *     stated 平日 9:00-18:00 / 24 時間以内; those are operational
 *     commitments the 2026 surface cannot re-verify, so they stay
 *     out rather than being restated as fact.
 *   - **No e-mail addresses.** Contact routes live in
 *     `src/contact/channels.json` behind the fail-closed freshness
 *     gate; this page links to `/contact`, it does not restate an
 *     address (same rule as `src/about/links.ts`, Issue #390).
 */

/** One requestable service inside a group. */
export interface CommissionService {
	readonly title: string;
	readonly description?: string;
	readonly items?: readonly string[];
}

/** A labelled group of services (開発 / 映像). */
export interface CommissionServiceGroup {
	readonly id: string;
	readonly title: string;
	readonly titleEn: string;
	readonly services: readonly CommissionService[];
}

/** One step of the request flow. */
export interface CommissionStep {
	readonly step: number;
	readonly title: string;
	readonly description: string;
}

/**
 * Service groups — ported from the 2025 `services` arrays on the
 * develop and video commission pages.
 */
export const COMMISSION_SERVICE_GROUPS: readonly CommissionServiceGroup[] = [
	{
		id: 'development',
		title: '開発',
		titleEn: 'Development',
		services: [
			{
				title: 'Web 開発',
				items: ['ポートフォリオサイト', 'コーポレートサイト', 'EC サイト'],
			},
			{
				title: 'アプリケーション開発',
				items: ['Web アプリ', 'ゲーム', 'ツール'],
			},
			{
				title: 'プラグイン開発',
				items: ['AfterEffects プラグイン', 'Premiere Pro プラグイン'],
			},
			{
				title: '技術サポート',
				items: ['既存システムの改善', 'バグ修正'],
			},
		],
	},
	{
		id: 'video',
		title: '映像',
		titleEn: 'Video',
		services: [
			{
				title: 'MV 制作',
				description: 'ミュージックビデオの制作',
			},
			{
				title: 'リリックモーション',
				description: '歌詞に合わせたアニメーション',
			},
			{
				title: 'イラストアニメーション',
				description: 'イラストを使ったアニメーション',
			},
			{
				title: 'プロモーション映像',
				description: '商品・サービスのプロモーション映像',
			},
		],
	},
];

/**
 * The request flow — the six steps both 2025 commission pages
 * published (お問い合わせ → 要件確認 → 見積もり → 制作開始 /
 * 開発開始 → レビュー・修正 / テスト・修正 → 納品).
 */
export const COMMISSION_STEPS: readonly CommissionStep[] = [
	{
		step: 1,
		title: 'お問い合わせ',
		description: '掲載されている contact channel から依頼内容を相談',
	},
	{
		step: 2,
		title: '要件確認',
		description: '仕様と要件の詳細確認',
	},
	{
		step: 3,
		title: '見積もり',
		description: '制作期間と料金の見積もり',
	},
	{
		step: 4,
		title: '制作開始',
		description: '要件に基づいた制作・開発作業',
	},
	{
		step: 5,
		title: 'レビュー・修正',
		description: 'フィードバックの反映と必要に応じた修正',
	},
	{
		step: 6,
		title: '納品',
		description: '完成品の納品とサポート',
	},
];

/**
 * What an estimate needs — the five topics the 2025 video page
 * asked requesters to prepare. Kept as topics, not as a form:
 * there is no intake while the mode is parked.
 */
export const COMMISSION_REQUIREMENTS: readonly string[] = [
	'何を作るか (例: 歌ってみたの MV 制作)',
	'希望する納期',
	'予算',
	'作る映像・システムの規模または楽曲名',
	'イメージ (指標となる作例、箇条書き、絵コンテなど)',
];

/** Software lists — ported verbatim from the 2025 video page. */
export const COMMISSION_SOFTWARE: readonly {
	readonly title: string;
	readonly titleEn: string;
	readonly tools: readonly string[];
}[] = [
	{
		title: 'フロントエンド',
		titleEn: 'Frontend',
		tools: ['HTML', 'CSS', 'JavaScript', 'TypeScript', 'React', 'Next.js'],
	},
	{
		title: 'ゲーム開発',
		titleEn: 'Game development',
		tools: ['p5.js', 'PIXI.js', 'Unity'],
	},
	{
		title: '映像制作',
		titleEn: 'Video production',
		tools: ['AfterEffects', 'Premiere Pro', 'Blender'],
	},
	{
		title: 'グラフィック',
		titleEn: 'Graphics',
		tools: ['Photoshop', 'Illustrator'],
	},
	{
		title: 'プラグイン開発',
		titleEn: 'Plugin development',
		tools: ['AfterEffects', 'Premiere Pro'],
	},
	{
		title: 'その他',
		titleEn: 'Other',
		tools: ['C', 'C++', 'C#', 'Python'],
	},
];
