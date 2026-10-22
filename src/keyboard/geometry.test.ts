import { describe, expect, it } from 'vitest';
import macSource from './sources/key-map-kanata/mac/kanata-us.kbd?raw';
import winSource from './sources/key-map-kanata/win/kay-map-win.kbd?raw';
import { resolveGeometry, splitRows } from './geometry';
import { parseKanata } from './parse-kanata';

describe('keyboard geometry', () => {
	it('maps the macOS defsrc onto six physical US ANSI rows', () => {
		const parsed = parseKanata(macSource);
		const geometry = resolveGeometry('macos', parsed.defsrc);
		expect(geometry).not.toBeNull();
		expect(geometry?.caps).toHaveLength(72);
		expect(geometry?.rows.map((row) => row.caps.length)).toEqual([13, 14, 14, 13, 12, 6]);
		expect(geometry?.rows[0]?.caps[0]).toBe('Esc');
		expect(geometry?.rows[5]?.caps).toEqual(['Ctrl', 'Option', 'Cmd', 'Space', 'Cmd', 'Option']);
		expect(geometry?.capSource).toBe('physical');
	});

	it('maps the Windows defsrc onto six input-order rows', () => {
		const parsed = parseKanata(winSource);
		const geometry = resolveGeometry('windows', parsed.defsrc);
		expect(geometry).not.toBeNull();
		expect(geometry?.caps).toHaveLength(74);
		expect(geometry?.rows.map((row) => row.caps.length)).toEqual([13, 13, 13, 14, 13, 8]);
		expect(geometry?.rows[3]?.caps[0]).toBe('F1');
		expect(geometry?.rows[5]?.caps).toEqual([
			'Ctrl',
			'Win',
			'Alt',
			'無変換',
			'Space',
			'変換',
			'かな',
			'Ctrl',
		]);
		expect(geometry?.capSource).toBe('defsrc');
	});

	it('fails safe when the key count no longer matches', () => {
		expect(resolveGeometry('macos', ['esc'])).toBeNull();
		expect(resolveGeometry('windows', ['esc'])).toBeNull();
	});

	it('splits a defsrc-aligned list into the same rows', () => {
		const rows = splitRows([1, 2, 3, 4, 5, 6], [1, 2, 3]);
		expect(rows).toEqual([[1], [2, 3], [4, 5, 6]]);
	});
});
