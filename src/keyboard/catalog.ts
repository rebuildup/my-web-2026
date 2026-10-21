/**
 * Build the display catalog from committed public sources.
 *
 * This module owns the decision "what does a parse failure look
 * like?". It never throws: a platform that cannot be parsed becomes
 * an `unavailable` platform with a fixed public sentence, so one
 * broken source cannot take down the other platform's diagram.
 *
 * No network access happens here. The sources are committed bytes;
 * `scripts/sync-keyboard-layout.mjs` is the only thing that fetches.
 */

import { layerMeta } from './format';
import { resolveGeometry } from './geometry';
import { parseKanata } from './parse-kanata';
import { parseOnishiJson } from './parse-onishi';
import type {
	KeyboardCatalog,
	KeyboardLayer,
	KeyboardManifest,
	KeyboardPlatform,
	KeyboardSourceRecord,
} from './types';

export interface KeyboardSourceBundle {
	readonly manifest: KeyboardManifest;
	/** Committed bytes of `key-map-kanata`'s macOS config. */
	readonly macKanata: string;
	/** Committed bytes of `key-map-kanata`'s Windows config. */
	readonly winKanata: string;
	/** Committed bytes of `pc-setup`'s `onishi.json`. */
	readonly onishiJson: string;
}

const MAC_NOTES: readonly string[] = [
	'hidutil が物理キーボードを大西配列へ変換する。Kanata はその変換後のイベントを読み、同じ大西配列をベースに Space 長押し HUB を重ねる。',
	'Karabinier DriverKit の仮想キーボードには同じ変換を入れない。入れると Kanata の出力が二重変換される。',
	'物理 US ANSI のキー位置で表示する。キーキャップの文字は物理キー、下段の文字はその位置が出力するアクション。',
];

const WIN_NOTES: readonly string[] = [
	'ChgKey などで大西配列化済みの入力が Kanata に届く。Kanata 側の onishi レイヤーはその入力をそのまま通す。',
	'defsrc の `caps` 位置が大西配列 / QWERTY の切り替え。`f1` 位置を押している間は `extra` レイヤー。',
	'defsrc は ChgKey 後の入力キー列であり、物理キー位置ではない。図のキーキャップは Kanata が受け取るキー名を示す。',
];

const UNAVAILABLE = {
	macKanata: 'macOS の Kanata 設定を解析できませんでした。',
	winKanata: 'Windows の Kanata 設定を解析できませんでした。',
	onishi: 'macOS の hidutil 設定を解析できませんでした。',
	geometry: 'キー数が表示モデルと一致しませんでした。',
	missingSource: '同期マニフェストに必要な source がありません。',
} as const;

function findSource(manifest: KeyboardManifest, id: string): KeyboardSourceRecord | undefined {
	return manifest.sources.find((source) => source.id === id);
}

function layersFrom(parsed: ReturnType<typeof parseKanata>): KeyboardLayer[] {
	return parsed.layers.map((layer) => {
		const meta = layerMeta(layer.id);
		return {
			id: layer.id,
			label: meta.label,
			group: meta.group,
			family: meta.family,
			keys: layer.keys,
		};
	});
}

function unavailablePlatform(
	id: 'macos' | 'windows',
	layout: string,
	reason: string,
	sourceIds: readonly string[],
	notes: readonly string[],
	capSource: 'physical' | 'defsrc',
): KeyboardPlatform {
	return {
		id,
		label: id === 'macos' ? 'macOS' : 'Windows',
		layout,
		status: 'unavailable',
		reason,
		sourceIds,
		notes,
		defsrc: [],
		layers: [],
		capSource,
	};
}

function collectUnknownWarnings(platform: KeyboardPlatform): string[] {
	const warnings: string[] = [];
	for (const layer of platform.layers) {
		const count = layer.keys.filter((key) => key.kind === 'unknown').length;
		if (count > 0) {
			warnings.push(
				`${platform.label} のレイヤー ${layer.id} に未対応の構文が ${count} 件あります。`,
			);
		}
	}
	return warnings;
}

function buildMacPlatform(bundle: KeyboardSourceBundle): KeyboardPlatform {
	const kanataSource = findSource(bundle.manifest, 'mac-kanata');
	const onishiSource = findSource(bundle.manifest, 'onishi-json');
	const sourceIds = ['mac-kanata', 'onishi-json'];
	if (kanataSource === undefined || onishiSource === undefined) {
		return unavailablePlatform(
			'macos',
			'US ANSI',
			UNAVAILABLE.missingSource,
			sourceIds,
			MAC_NOTES,
			'physical',
		);
	}

	let parsed: ReturnType<typeof parseKanata>;
	let mappings: ReturnType<typeof parseOnishiJson>;
	try {
		parsed = parseKanata(bundle.macKanata);
	} catch {
		return unavailablePlatform(
			'macos',
			'US ANSI',
			UNAVAILABLE.macKanata,
			sourceIds,
			MAC_NOTES,
			'physical',
		);
	}
	try {
		mappings = parseOnishiJson(bundle.onishiJson);
	} catch {
		return unavailablePlatform(
			'macos',
			'US ANSI',
			UNAVAILABLE.onishi,
			sourceIds,
			MAC_NOTES,
			'physical',
		);
	}

	const geometry = resolveGeometry('macos', parsed.defsrc);
	if (geometry === null) {
		return unavailablePlatform(
			'macos',
			'US ANSI',
			UNAVAILABLE.geometry,
			sourceIds,
			MAC_NOTES,
			'physical',
		);
	}

	return {
		id: 'macos',
		label: 'macOS',
		layout: geometry.layout,
		status: 'ready',
		sourceIds,
		notes: MAC_NOTES,
		defsrc: parsed.defsrc,
		layers: layersFrom(parsed),
		hidutil: {
			mappings,
			note: 'hidutil の UserKeyMapping。物理キー（Src）→ 大西配列の出力（Dst）。',
		},
		capSource: 'physical',
	};
}

function buildWindowsPlatform(bundle: KeyboardSourceBundle): KeyboardPlatform {
	const source = findSource(bundle.manifest, 'win-kanata');
	const sourceIds = ['win-kanata'];
	if (source === undefined) {
		return unavailablePlatform(
			'windows',
			'JIS',
			UNAVAILABLE.missingSource,
			sourceIds,
			WIN_NOTES,
			'defsrc',
		);
	}

	let parsed: ReturnType<typeof parseKanata>;
	try {
		parsed = parseKanata(bundle.winKanata);
	} catch {
		return unavailablePlatform(
			'windows',
			'JIS',
			UNAVAILABLE.winKanata,
			sourceIds,
			WIN_NOTES,
			'defsrc',
		);
	}

	const geometry = resolveGeometry('windows', parsed.defsrc);
	if (geometry === null) {
		return unavailablePlatform(
			'windows',
			'JIS',
			UNAVAILABLE.geometry,
			sourceIds,
			WIN_NOTES,
			'defsrc',
		);
	}

	return {
		id: 'windows',
		label: 'Windows',
		layout: geometry.layout,
		status: 'ready',
		sourceIds,
		notes: WIN_NOTES,
		defsrc: parsed.defsrc,
		layers: layersFrom(parsed),
		capSource: 'defsrc',
	};
}

/**
 * Build both platforms. Never throws.
 *
 * A platform is `unavailable` only when its own source fails; the
 * other platform is still built. The only page-level failure is a
 * manifest that cannot name the sources at all (`load.ts`).
 */
export function buildKeyboardCatalog(bundle: KeyboardSourceBundle): KeyboardCatalog {
	const platforms = [buildMacPlatform(bundle), buildWindowsPlatform(bundle)];
	const warnings = platforms.flatMap(collectUnknownWarnings);
	return { platforms, warnings };
}
