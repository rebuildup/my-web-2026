/**
 * Issue #764 — 色の体系（WORKTREE ONLY）.
 *
 * owner の訂正（2026-11-02）: 「候補を増やす」は **1 色を選ぶ**ことではない。
 * 黄色しか使えない状況にしないこと。色はコンテンツ側が持ち、複数の色が同じ画面で
 * 同時に生きている状態が到達点。参考サイト（https://www.yell-movie2024.com）も
 * 一色統一をしていない。
 *
 * したがってここにあるのは「候補色の一覧」ではなく、**役割 → 系統（family）** の
 * 割り当てと、その割り当てをどう運用するかの規則である。
 *
 * owner の決定（2026-11-02）: **III — コンテンツ分類固定** を採用。
 * I（少数高彩度）/ II（多数中彩度）は選択されなかったため、この module からは
 * 削除した。比較の記録と実測値は
 * `docs/verification/design/direction-comparison-0-8-1.md` に残っている。
 */

/** 系統。`light` / `dark` は「本文と同じ場所で読める明度」に置いた値。 */
export const FAMILIES = [
	{ id: 'action', role: '操作', label: '紫', light: '#6B3FA0', dark: '#C4A0F5' },
	{ id: 'design', role: 'コンテンツ識別', label: '桃', light: '#A32B62', dark: '#F08CB5' },
	{ id: 'code', role: 'コンテンツ識別', label: '青緑', light: '#0F6B62', dark: '#57D6C6' },
	{ id: 'writing', role: 'コンテンツ識別', label: '黄土', light: '#6F5A00', dark: '#E8CF6A' },
	{ id: 'tool', role: 'コンテンツ識別', label: '藍', light: '#1F5FA8', dark: '#7FB4FF' },
	{ id: 'done', role: '状態', label: '緑', light: '#176B4C', dark: '#4FD6A6' },
	{ id: 'live', role: '状態', label: '橙', light: '#A44A0E', dark: '#FFA45C' },
	{ id: 'fail', role: '状態', label: '赤', light: '#A32B20', dark: '#FF8A7A' },
];

export const FAMILY_BY_ID = Object.fromEntries(FAMILIES.map((f) => [f.id, f]));

/**
 * 色の載せ方。`text` は文字色だけ、`tint` は面に薄く敷く、`rule` は細い罫線。
 * 塗りを大きくしないのは採用案（III）の骨格を壊さないための制約。
 */
export const SYSTEMS = [
	{
		id: 'fixed',
		name: 'III — コンテンツ分類固定',
		summary:
			'系統は 3（分類のみ）+ 操作は墨。状態は色を足さず、分類の色を借りる。もっとも B に近い。',
		action: 'ink',
		categories: ['design', 'code', 'writing'],
		states: ['done', 'live'],
		tag: 'rule',
		state: 'borrow',
		rule: '新しい色を足さない。状態は分類の色を借り、操作は墨のまま。',
		limits: { hues: 4, area: 3 },
	},
];

/** 全案に共通の運用規則（画面に文章で出し、実描画で守られていることを示す）。 */
export const RULES = [
	'色を割り当てるのは slug / 分類から決定的に導く。乱数で振らない（同じ作品は常に同じ色）。',
	'本文の長文・大きな面の塗りには色を置かない。色は 1 行・1 語・1 ピルまで。',
	'操作の系統は 1 つに固定する。画面ごとに操作の色を変えない（散らすのは内容側だけ）。',
	'地は無彩色のまま。色の面積は 1 画面で 5% 前後を上限とし、実測して超えたら色を減らす。',
];
