import { describe, expect, it } from 'vitest';
import macSource from './sources/key-map-kanata/mac/kanata-us.kbd?raw';
import {
	actionDescription,
	actionLabel,
	formatDate,
	keyCapLabel,
	keyLabel,
	layerLabel,
	shortRef,
} from './format';
import { parseKanata } from './parse-kanata';
import type { KeyboardAction } from './types';

const parsed = parseKanata(macSource);
const space = parsed.layers.find((layer) => layer.id === 'onishi')?.keys[69] as KeyboardAction;
const redo = parsed.layers.find((layer) => layer.id === 'auto-o')?.keys[28] as KeyboardAction;

describe('keyboard formatting', () => {
	it('labels physical caps and output keys', () => {
		expect(keyCapLabel('esc')).toBe('Esc');
		expect(keyCapLabel('mhnk')).toBe('無変換');
		expect(keyCapLabel(',')).toBe(',');
		expect(keyLabel('lmet', 'macos')).toBe('Cmd');
		expect(keyLabel('lmet', 'windows')).toBe('Win');
		expect(keyLabel('a', 'macos')).toBe('A');
	});

	it('keeps tap and hold visible in the cap label', () => {
		expect(actionLabel(space, 'macos')).toBe('Space / ⇩HUB');
	});

	it('describes tap and hold as separate actions', () => {
		const description = actionDescription(space, 'macos');
		expect(description).toContain('タップ: Space を出力');
		expect(description).toContain('長押し: 押している間だけ「HUB（大西）」レイヤー');
		expect(description).toContain('tap 170ms / hold 180ms');
	});

	it('renders macOS modifier chords with glyphs', () => {
		expect(actionLabel(redo, 'macos')).toBe('⌘⇧Z');
		expect(actionDescription(redo, 'macos')).toBe('⌘⇧Z を出力');
	});

	it('resolves user-facing layer labels', () => {
		expect(layerLabel('hub-o')).toBe('HUB（大西）');
		expect(layerLabel('unknown-layer')).toBe('unknown-layer');
	});

	it('formats provenance dates deterministically', () => {
		expect(formatDate('2026-10-20T00:00:00.000Z')).toBe('2026/10/20');
		expect(formatDate('not-a-date')).toBe('不明');
		expect(shortRef('0c02df504029d84bdaa145a70b2ac9719f5e9956')).toBe('0c02df504029');
	});
});
