import { describe, expect, it } from 'vitest';
import { buildKeyboardCatalog, type KeyboardSourceBundle } from './catalog';
import { KEYBOARD_SOURCES } from './index';
import type { KeyboardManifest } from './types';

function cloneManifest(source: KeyboardSourceBundle): KeyboardManifest {
	return JSON.parse(JSON.stringify(source.manifest)) as KeyboardManifest;
}

describe('keyboard catalog — committed sources', () => {
	const catalog = buildKeyboardCatalog(KEYBOARD_SOURCES);
	const mac = catalog.platforms.find((platform) => platform.id === 'macos');
	const win = catalog.platforms.find((platform) => platform.id === 'windows');

	it('builds both platforms', () => {
		expect(catalog.platforms.map((platform) => platform.id)).toEqual(['macos', 'windows']);
		expect(mac?.status).toBe('ready');
		expect(win?.status).toBe('ready');
	});

	it('exposes the macOS physical keys, twelve layers and hidutil map', () => {
		expect(mac?.defsrc).toHaveLength(72);
		expect(mac?.layers.map((layer) => layer.id)).toEqual([
			'onishi',
			'qwerty',
			'hub-o',
			'hub-q',
			'lhs-o',
			'lhs-q',
			'rhs-o',
			'rhs-q',
			'auto-o',
			'auto-q',
			'mouse-o',
			'mouse-q',
		]);
		expect(mac?.hidutil?.mappings).toHaveLength(25);
		expect(mac?.capSource).toBe('physical');
		expect(mac?.layers[0]?.keys[69]).toMatchObject({
			kind: 'tap-hold',
			reference: '@spco',
		});
	});

	it('exposes the Windows input-order diagram and three layers', () => {
		expect(win?.defsrc).toHaveLength(74);
		expect(win?.layers.map((layer) => layer.id)).toEqual(['onishi', 'qwerty', 'extra']);
		expect(win?.capSource).toBe('defsrc');
		expect(win?.notes[1]).toContain('caps');
	});

	it('reports no unknown actions for the committed configs', () => {
		expect(catalog.warnings).toEqual([]);
	});
});

describe('keyboard catalog — safe states', () => {
	it('marks only macOS unavailable when its Kanata source is corrupt', () => {
		const bundle: KeyboardSourceBundle = {
			...KEYBOARD_SOURCES,
			macKanata: '(defsrc esc)',
		};
		const catalog = buildKeyboardCatalog(bundle);
		const mac = catalog.platforms.find((platform) => platform.id === 'macos');
		const win = catalog.platforms.find((platform) => platform.id === 'windows');
		expect(mac?.status).toBe('unavailable');
		expect(mac?.reason).toBe('macOS の Kanata 設定を解析できませんでした。');
		expect(mac?.layers).toEqual([]);
		expect(win?.status).toBe('ready');
	});

	it('marks macOS unavailable when the hidutil JSON is corrupt', () => {
		const bundle: KeyboardSourceBundle = {
			...KEYBOARD_SOURCES,
			onishiJson: '{',
		};
		const mac = buildKeyboardCatalog(bundle).platforms.find((platform) => platform.id === 'macos');
		expect(mac?.status).toBe('unavailable');
		expect(mac?.reason).toBe('macOS の hidutil 設定を解析できませんでした。');
	});

	it('marks Windows unavailable when its key count no longer matches geometry', () => {
		const bundle: KeyboardSourceBundle = {
			...KEYBOARD_SOURCES,
			winKanata: '(defsrc esc)\n(deflayer onishi esc)',
		};
		const win = buildKeyboardCatalog(bundle).platforms.find(
			(platform) => platform.id === 'windows',
		);
		expect(win?.status).toBe('unavailable');
		expect(win?.reason).toBe('キー数が表示モデルと一致しませんでした。');
	});

	it('marks a platform unavailable when the manifest omits its source', () => {
		const manifest = cloneManifest(KEYBOARD_SOURCES);
		const bundle: KeyboardSourceBundle = {
			...KEYBOARD_SOURCES,
			manifest: {
				...manifest,
				sources: manifest.sources.filter((source) => source.id !== 'onishi-json'),
			},
		};
		const mac = buildKeyboardCatalog(bundle).platforms.find((platform) => platform.id === 'macos');
		expect(mac?.status).toBe('unavailable');
		expect(mac?.reason).toBe('同期マニフェストに必要な source がありません。');
	});

	it('warns about an unsupported form without hiding the layer', () => {
		const bundle: KeyboardSourceBundle = {
			...KEYBOARD_SOURCES,
			macKanata: KEYBOARD_SOURCES.macKanata.replace('@to-qwerty', '(tap-dance 200 (a b))'),
		};
		const catalog = buildKeyboardCatalog(bundle);
		expect(catalog.warnings.some((warning) => warning.includes('未対応の構文'))).toBe(true);
	});
});
