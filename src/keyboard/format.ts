/**
 * Presentation strings for the keyboard model.
 *
 * The model stores structure only; every label and description is
 * derived here. That keeps the committed source bytes small and makes
 * a wording change a single-file change.
 *
 * The descriptions are intentionally explicit about tap / hold:
 * "Space / HUB" in a key cap is supported by "タップで Space、長押し
 * で HUB レイヤー" in the detail panel, so the alias never collapses
 * into one character.
 */

import type {
	KeyboardAction,
	KeyboardFamily,
	KeyboardLayerGroup,
	KeyboardPlatformId,
} from './types';

export interface LayerMeta {
	readonly label: string;
	readonly group: KeyboardLayerGroup;
	readonly family: KeyboardFamily;
}

/** Kanata layer metadata for the two public configurations. */
export const LAYER_META: Readonly<Record<string, LayerMeta>> = {
	onishi: { label: '大西配列', group: 'base', family: 'onishi' },
	qwerty: { label: 'QWERTY', group: 'base', family: 'qwerty' },
	'hub-o': { label: 'HUB（大西）', group: 'hub', family: 'onishi' },
	'hub-q': { label: 'HUB（QWERTY）', group: 'hub', family: 'qwerty' },
	'lhs-o': { label: '左シンボル（大西）', group: 'symbols', family: 'onishi' },
	'rhs-o': { label: '右シンボル（大西）', group: 'symbols', family: 'onishi' },
	'lhs-q': { label: '左シンボル（QWERTY）', group: 'symbols', family: 'qwerty' },
	'rhs-q': { label: '右シンボル（QWERTY）', group: 'symbols', family: 'qwerty' },
	'auto-o': { label: '自動化（大西）', group: 'automation', family: 'onishi' },
	'auto-q': { label: '自動化（QWERTY）', group: 'automation', family: 'qwerty' },
	'mouse-o': { label: 'マウス（大西）', group: 'mouse', family: 'onishi' },
	'mouse-q': { label: 'マウス（QWERTY）', group: 'mouse', family: 'qwerty' },
	extra: { label: '記号・ナビ', group: 'extra', family: null },
};

const SHORT_LAYER: Readonly<Record<string, string>> = {
	onishi: '大西',
	qwerty: 'QWERTY',
	'hub-o': 'HUB',
	'hub-q': 'HUB',
	'lhs-o': '左記号',
	'rhs-o': '右記号',
	'lhs-q': '左記号',
	'rhs-q': '右記号',
	'auto-o': '自動化',
	'auto-q': '自動化',
	'mouse-o': 'マウス',
	'mouse-q': 'マウス',
	extra: '記号',
};

export function layerMeta(id: string): LayerMeta {
	return LAYER_META[id] ?? { label: id, group: 'extra', family: null };
}

export function layerLabel(id: string): string {
	return layerMeta(id).label;
}

function layerShort(id: string): string {
	return SHORT_LAYER[id] ?? id;
}

const SHARED_KEY_LABELS: Readonly<Record<string, string>> = {
	esc: 'Esc',
	f1: 'F1',
	f2: 'F2',
	f3: 'F3',
	f4: 'F4',
	f5: 'F5',
	f6: 'F6',
	f7: 'F7',
	f8: 'F8',
	f9: 'F9',
	f10: 'F10',
	f11: 'F11',
	f12: 'F12',
	grv: '`',
	bspc: 'Backspace',
	tab: 'Tab',
	caps: 'Caps',
	ret: 'Enter',
	ent: 'Enter',
	spc: 'Space',
	del: 'Delete',
	ins: 'Insert',
	home: 'Home',
	end: 'End',
	pgup: 'PageUp',
	pgdn: 'PageDown',
	lft: '←',
	rght: '→',
	up: '↑',
	down: '↓',
	eisu: '英数',
	kana: 'かな',
	mhnk: '無変換',
	hnk: '変換',
	ro: 'ろ',
	prnt: 'PrintScreen',
	lrld: 'Layer reload',
	brdn: '明るさ↓',
	brup: '明るさ↑',
	vold: '音量↓',
	volu: '音量↑',
	mute: 'ミュート',
	prev: '前の曲',
	next: '次の曲',
	pp: '再生 / 一時停止',
	mlft: '左クリック',
	mrgt: '右クリック',
	mmid: '中クリック',
	mltp: '左クリック',
	mrtp: '右クリック',
	comma: ',',
	dot: '.',
	semi: ';',
	squote: "'",
	dq: '"',
	pipe: '|',
	colon: ':',
	minus: '-',
	plus: '+',
	eq: '=',
	slash: '/',
	star: '*',
	under: '_',
	question: '?',
	bslash: '\\',
	lb: '[',
	rb: ']',
	lp: '(',
	rp: ')',
};

const MAC_MODIFIER_KEYS: Readonly<Record<string, string>> = {
	lctl: 'Ctrl',
	rctl: 'Ctrl',
	lsft: 'Shift',
	rsft: 'Shift',
	lalt: 'Option',
	ralt: 'Option',
	lmet: 'Cmd',
	rmet: 'Cmd',
};

const WIN_MODIFIER_KEYS: Readonly<Record<string, string>> = {
	lctl: 'Ctrl',
	rctl: 'Ctrl',
	lsft: 'Shift',
	rsft: 'Shift',
	lalt: 'Alt',
	ralt: 'Alt',
	lmet: 'Win',
	rmet: 'Win',
};

/**
 * Physical / defsrc cap label.
 *
 * Used where the diagram has no explicit cap list (the Windows
 * `defsrc` order). Single letters are upper-cased; punctuation stays
 * literal, so a token `;` renders as `;` rather than as a word.
 */
export function keyCapLabel(key: string): string {
	const modifier = WIN_MODIFIER_KEYS[key];
	if (modifier !== undefined) return modifier;
	const label = SHARED_KEY_LABELS[key];
	if (label !== undefined) return label;
	if (/^[a-z]$/.test(key)) return key.toUpperCase();
	return key;
}

/** Output key label, platform-aware for the modifier keys. */
export function keyLabel(key: string, platform: KeyboardPlatformId = 'macos'): string {
	const modifiers = platform === 'macos' ? MAC_MODIFIER_KEYS : WIN_MODIFIER_KEYS;
	const modifier = modifiers[key];
	if (modifier !== undefined) return modifier;
	const label = SHARED_KEY_LABELS[key];
	if (label !== undefined) return label;
	if (/^[a-z]$/.test(key)) return key.toUpperCase();
	return key;
}

const MAC_MODIFIER_SYMBOL: Readonly<Record<string, string>> = {
	C: '⌃',
	S: '⇧',
	A: '⌥',
	M: '⌘',
	R: '⌘',
	RC: '⌃',
	RS: '⇧',
	RA: '⌥',
	RM: '⌘',
	LC: '⌃',
	LS: '⇧',
	LA: '⌥',
	LM: '⌘',
	RSA: '⌘⌥⇧',
	RSC: '⌘⌃⇧',
};

const WIN_MODIFIER_NAME: Readonly<Record<string, string>> = {
	C: 'Ctrl',
	S: 'Shift',
	A: 'Alt',
	M: 'Win',
	R: 'Win',
	RC: 'Ctrl',
	RS: 'Shift',
	RA: 'Alt',
	RM: 'Win',
	LC: 'Ctrl',
	LS: 'Shift',
	LA: 'Alt',
	LM: 'Win',
	RSA: 'Win Alt Shift',
	RSC: 'Win Ctrl Shift',
};

function modifierSymbol(modifier: string, platform: KeyboardPlatformId): string {
	return platform === 'macos'
		? (MAC_MODIFIER_SYMBOL[modifier] ?? modifier)
		: (WIN_MODIFIER_NAME[modifier] ?? modifier);
}

function chordLabel(action: KeyboardAction, platform: KeyboardPlatformId): string {
	const modifiers = action.modifiers ?? [];
	const key = keyLabel(action.key ?? '', platform);
	if (platform === 'macos') {
		return `${modifiers.map((m) => modifierSymbol(m, platform)).join('')}${key}`;
	}
	return [...modifiers.map((m) => modifierSymbol(m, platform)), key].join('+');
}

/** Compact label shown inside a key cap. */
export function actionLabel(
	action: KeyboardAction,
	platform: KeyboardPlatformId = 'macos',
): string {
	switch (action.kind) {
		case 'key':
			return keyLabel(action.key ?? action.raw, platform);
		case 'chord':
			return chordLabel(action, platform);
		case 'tap-hold':
			return `${action.tap ? actionLabel(action.tap, platform) : '?'} / ${
				action.hold ? actionLabel(action.hold, platform) : '?'
			}`;
		case 'layer-switch':
			return `→${action.layer ? layerShort(action.layer) : '?'}`;
		case 'layer-while-held':
			return `⇩${action.layer ? layerShort(action.layer) : '?'}`;
		case 'layer-toggle':
			return `⇄${action.layer ? layerShort(action.layer) : '?'}`;
		case 'one-shot': {
			const seconds =
				action.timeoutMs === null || action.timeoutMs === undefined
					? null
					: action.timeoutMs / 1000;
			const prefix = seconds === null ? '1shot' : `${seconds}s`;
			return `${prefix} ${action.action ? actionLabel(action.action, platform) : '?'}`;
		}
		case 'macro': {
			const first = action.steps?.find((step) => step.kind === 'action');
			const inner = first?.kind === 'action' ? actionLabel(first.action, platform) : 'macro';
			return action.repeatMs === null || action.repeatMs === undefined
				? `macro ${inner}`
				: `連打 ${inner}`;
		}
		case 'dynamic-macro':
			switch (action.operation) {
				case 'dynamic-macro-record':
					return 'DM0 記録';
				case 'dynamic-macro-record-stop':
					return 'DM 停止';
				case 'dynamic-macro-play':
					return 'DM0 再生';
				default:
					return 'DM';
			}
		case 'mouse':
			return mouseShort(action.operation ?? action.raw);
		case 'transparent':
			return '·';
		case 'blocked':
			return '✕';
		case 'unknown':
			return '?';
	}
}

function mouseShort(operation: string): string {
	switch (operation) {
		case 'movemouse-accel-left':
			return '←加速';
		case 'movemouse-accel-right':
			return '→加速';
		case 'movemouse-accel-up':
			return '↑加速';
		case 'movemouse-accel-down':
			return '↓加速';
		case 'mwheel-left':
			return '⟲';
		case 'mwheel-right':
			return '⟳';
		case 'mwheel-up':
			return '↥';
		case 'mwheel-down':
			return '↧';
		case 'movemouse-speed':
			return '速度';
		default:
			return 'mouse';
	}
}

function mouseDescription(operation: string): string {
	switch (operation) {
		case 'movemouse-accel-left':
			return 'マウスポインタを左へ加速移動';
		case 'movemouse-accel-right':
			return 'マウスポインタを右へ加速移動';
		case 'movemouse-accel-up':
			return 'マウスポインタを上へ加速移動';
		case 'movemouse-accel-down':
			return 'マウスポインタを下へ加速移動';
		case 'mwheel-left':
			return '横スクロール（左）';
		case 'mwheel-right':
			return '横スクロール（右）';
		case 'mwheel-up':
			return '縦スクロール（上）';
		case 'mwheel-down':
			return '縦スクロール（下）';
		case 'movemouse-speed':
			return 'マウスポインタの速度を変更';
		default:
			return `マウス操作（${operation}）`;
	}
}

function macroStepsDescription(action: KeyboardAction, platform: KeyboardPlatformId): string {
	const parts: string[] = [];
	for (const step of action.steps ?? []) {
		if (step.kind === 'delay') {
			parts.push(`${step.ms}ms 待機`);
		} else {
			parts.push(actionDescription(step.action, platform));
		}
	}
	let description = parts.join(' → ');
	if (action.repeatMs !== null && action.repeatMs !== undefined) {
		description = `${action.repeatMs}ms ごとに ${description}`;
	}
	return description;
}

/** Full sentence for the key detail panel and every key's aria-label. */
export function actionDescription(
	action: KeyboardAction,
	platform: KeyboardPlatformId = 'macos',
): string {
	switch (action.kind) {
		case 'key':
			return `${keyLabel(action.key ?? action.raw, platform)} を出力`;
		case 'chord':
			return `${chordLabel(action, platform)} を出力`;
		case 'tap-hold': {
			const tap = action.tap ? actionDescription(action.tap, platform) : '未定義';
			const hold = action.hold ? actionDescription(action.hold, platform) : '未定義';
			const timing =
				action.timing?.tapMs !== null && action.timing?.tapMs !== undefined
					? `（tap ${action.timing.tapMs}ms / hold ${action.timing.holdMs ?? '?'}ms）`
					: '';
			return `タップ: ${tap} / 長押し: ${hold}${timing}`;
		}
		case 'layer-switch':
			return `「${action.layer ? layerLabel(action.layer) : '?'}」レイヤーへ切り替え`;
		case 'layer-while-held':
			return `押している間だけ「${action.layer ? layerLabel(action.layer) : '?'}」レイヤー`;
		case 'layer-toggle':
			return `「${action.layer ? layerLabel(action.layer) : '?'}」レイヤーをトグル`;
		case 'one-shot':
			return `${
				action.timeoutMs ?? '?'
			}ms のワンショット: ${action.action ? actionDescription(action.action, platform) : '未定義'}`;
		case 'macro':
			return `マクロ: ${macroStepsDescription(action, platform)}`;
		case 'dynamic-macro':
			switch (action.operation) {
				case 'dynamic-macro-record':
					return '動的マクロ slot 0 の記録を開始';
				case 'dynamic-macro-record-stop':
					return '動的マクロの記録を停止';
				case 'dynamic-macro-play':
					return '動的マクロ slot 0 を再生';
				default:
					return '動的マクロ操作';
			}
		case 'mouse':
			return mouseDescription(action.operation ?? action.raw);
		case 'transparent':
			return 'この位置は下のレイヤーのキーをそのまま通します';
		case 'blocked':
			return 'この位置では入力を出力しません';
		case 'unknown':
			if (action.note === 'alias-not-found') {
				return `未定義の alias です: ${action.raw}`;
			}
			if (action.note === 'alias-cycle') {
				return `alias の参照が循環しています: ${action.raw}`;
			}
			if (action.note === 'unsupported-form') {
				return `未対応の構文です: ${action.raw}`;
			}
			return `未対応のキーまたは構文です: ${action.raw}`;
	}
}

/** Raw form for the detail panel. */
export function actionRaw(action: KeyboardAction): string {
	return action.raw;
}

/** `2026-10-20` for a provenance timestamp, or `不明` when unparsable. */
export function formatDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '不明';
	return new Intl.DateTimeFormat('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: 'UTC',
	}).format(date);
}

/** Short commit SHA (first 12 characters) with a stable fallback. */
export function shortRef(ref: string): string {
	return /^[0-9a-f]{7,64}$/i.test(ref) ? ref.slice(0, 12) : ref;
}
