/**
 * Issue #764 — B (MONOCHROME / SIGNAL) の階層とアクセント候補（WORKTREE ONLY）.
 *
 * owner の判定（2026-11-02）: B の骨格は採用、中身は未完成。
 *   1. モノクロの明度階層が足りず、面の前後関係が読めない  ← このファイル
 *   2. 色は一点に決めない（`colour-systems.mjs`）
 *
 * ここは数値表のためではなく、`specimens.tsx` が実際の面として描くための値。
 * light と dark は「反転」ではなく、それぞれの地から独立に設計している。
 */

/** 役割 → その段。順序は「暗い → 明るい」ではなく、役割の一覧。 */
export const MONO_ROLES = [
	{ key: 'ground', kind: 'surface', label: 'ページ地', note: 'すべての面の基準' },
	{ key: 'sunken', kind: 'surface', label: '沈んだ面', note: '地より一段下（窪み・帯）' },
	{ key: 'raised', kind: 'surface', label: '上がった面', note: 'カード・パネル' },
	{ key: 'control', kind: 'surface', label: '押せる面', note: '地から一段離れた塗り（button）' },
	{ key: 'hairline', kind: 'line', label: 'hairline 罫線', note: '区切りの最小単位' },
	{ key: 'rule', kind: 'line', label: '強い罫線', note: '節の区切り・表の見出し' },
	{ key: 'muted', kind: 'ink', label: '補助文字', note: 'ラベル・キャプション' },
	{ key: 'secondary', kind: 'ink', label: '副次文字', note: '本文より一段弱い' },
	{ key: 'text', kind: 'ink', label: '本文', note: '読ませる文字' },
	{
		key: 'inverseGround',
		kind: 'surface',
		label: '反転地',
		note: '反転面の地（反転文字は inverseText）',
	},
	{ key: 'disabled', kind: 'ink', label: '無効', note: '無効な文字（無効面は disabledSurface）' },
];

export const MONO = {
	light: {
		ground: '#EDEDE8',
		sunken: '#E0E0DA',
		raised: '#FFFFFF',
		control: '#DFDFD8',
		hairline: '#C9C9C2',
		rule: '#74747D',
		muted: '#5F5F68',
		secondary: '#404047',
		text: '#101012',
		inverseGround: '#101012',
		inverseText: '#F6F6F2',
		disabledText: '#A7A7AD',
		disabledSurface: '#E9E9E4',
	},
	dark: {
		ground: '#0A0A0C',
		sunken: '#050506',
		raised: '#1A1A1E',
		control: '#26262C',
		hairline: '#33333A',
		rule: '#5C5C66',
		muted: '#8D8D96',
		secondary: '#B9B9C0',
		text: '#F2F2EF',
		inverseGround: '#F2F2EF',
		inverseText: '#0A0A0C',
		disabledText: '#5C5C64',
		disabledSurface: '#17171B',
	},
};
