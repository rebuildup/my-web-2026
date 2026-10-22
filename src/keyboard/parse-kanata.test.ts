import { describe, expect, it } from 'vitest';
import macSource from './sources/key-map-kanata/mac/kanata-us.kbd?raw';
import winSource from './sources/key-map-kanata/win/kay-map-win.kbd?raw';
import { KanataParseError, parseExpressions, parseKanata, splitChord } from './parse-kanata';
import type { KeyboardAction } from './types';

function findLayer(source: ReturnType<typeof parseKanata>, id: string) {
	const layer = source.layers.find((candidate) => candidate.id === id);
	expect(layer).toBeDefined();
	return layer as NonNullable<typeof layer>;
}

describe('kanata — expression reader', () => {
	it('removes line and block comments, including the disabled layer example', () => {
		const expressions = parseExpressions(`
			;; line comment
			#| block (defsrc x) |#
			(defsrc a b)
		`);
		expect(expressions).toEqual([['defsrc', 'a', 'b']]);
	});

	it('keeps literal punctuation as atoms', () => {
		const expressions = parseExpressions('(deflayer x ; \\ [ ] , . / S-- M-S-z)');
		expect(expressions).toEqual([
			['deflayer', 'x', ';', '\\', '[', ']', ',', '.', '/', 'S--', 'M-S-z'],
		]);
	});

	it('rejects unbalanced input', () => {
		expect(() => parseExpressions('(defsrc a')).toThrow(KanataParseError);
	});
});

describe('kanata — chord split', () => {
	it('splits modifiers from the base key', () => {
		expect(splitChord('M-S-z')).toEqual({ modifiers: ['M', 'S'], key: 'z' });
		expect(splitChord('C-M-S-4')).toEqual({ modifiers: ['C', 'M', 'S'], key: '4' });
		expect(splitChord('S-9')).toEqual({ modifiers: ['S'], key: '9' });
	});

	it('keeps a trailing hyphen as the base key', () => {
		expect(splitChord('S--')).toEqual({ modifiers: ['S'], key: '-' });
	});

	it('returns null for a plain key', () => {
		expect(splitChord('spc')).toBeNull();
		expect(splitChord('-')).toBeNull();
	});
});

describe('kanata — macOS config', () => {
	const parsed = parseKanata(macSource);

	it('reads the 72-key physical defsrc and all twelve layers', () => {
		expect(parsed.defsrc).toHaveLength(72);
		expect(parsed.defsrc[0]).toBe('esc');
		expect(parsed.defsrc[69]).toBe('spc');
		expect(parsed.layers.map((layer) => layer.id)).toEqual([
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
	});

	it('keeps the Space tap-hold as a structure, not one character', () => {
		const space = findLayer(parsed, 'onishi').keys[69] as KeyboardAction;
		expect(space.kind).toBe('tap-hold');
		expect(space.reference).toBe('@spco');
		expect(space.timing).toEqual({ tapMs: 170, holdMs: 180 });
		expect(space.tap).toMatchObject({ kind: 'key', key: 'spc' });
		expect(space.hold).toMatchObject({
			kind: 'layer-while-held',
			layer: 'hub-o',
		});
	});

	it('keeps the alias reference beside the resolved form', () => {
		const leftShift = findLayer(parsed, 'hub-o').keys[54] as KeyboardAction;
		expect(leftShift.kind).toBe('tap-hold');
		expect(leftShift.reference).toBe('@lso');
		expect(leftShift.tap).toMatchObject({ kind: 'key', key: 'eisu' });
		expect(leftShift.hold).toMatchObject({
			kind: 'layer-while-held',
			layer: 'lhs-o',
		});
	});

	it('parses one-shot, macro-repeat and macro delays', () => {
		const side = findLayer(parsed, 'lhs-o');
		const oneShot = side.keys.find((key) => key.kind === 'one-shot' && key.reference === '@autoo');
		expect(oneShot).toMatchObject({ timeoutMs: 1500 });
		expect(oneShot?.action).toMatchObject({ kind: 'layer-while-held', layer: 'auto-o' });

		const auto = findLayer(parsed, 'auto-o');
		const repeat = auto.keys.find((key) => key.kind === 'macro' && key.reference === '@auto-left');
		expect(repeat).toMatchObject({ repeatMs: 80 });
		expect(repeat?.steps?.[0]).toMatchObject({
			kind: 'action',
			action: { kind: 'key', key: 'mltp' },
		});

		const screenshot = auto.keys.find(
			(key) => key.kind === 'macro' && key.reference === '@shot-window',
		);
		expect(screenshot?.steps).toEqual([
			{ kind: 'action', action: expect.objectContaining({ kind: 'chord' }) },
			{ kind: 'delay', ms: 120 },
			{ kind: 'action', action: expect.objectContaining({ kind: 'key', key: 'spc' }) },
		]);
	});

	it('parses mouse, dynamic macro and blocked actions', () => {
		const mouse = findLayer(parsed, 'mouse-o');
		expect(
			mouse.keys.some((key) => key.kind === 'mouse' && key.operation === 'movemouse-accel-left'),
		).toBe(true);
		expect(mouse.keys.some((key) => key.kind === 'blocked')).toBe(true);

		const auto = findLayer(parsed, 'auto-o');
		expect(auto.keys.some((key) => key.kind === 'dynamic-macro')).toBe(true);
	});
});

describe('kanata — Windows config', () => {
	const parsed = parseKanata(winSource);

	it('reads the 75-key input list and the three active layers', () => {
		expect(parsed.defsrc).toHaveLength(74);
		expect(parsed.layers.map((layer) => layer.id)).toEqual(['onishi', 'qwerty', 'extra']);
	});

	it('does not parse the block-commented `numbers` example', () => {
		expect(parsed.layers.some((layer) => layer.id === 'numbers')).toBe(false);
	});

	it('keeps the two base-family switch aliases', () => {
		const onishi = findLayer(parsed, 'onishi');
		expect(onishi.keys[1]).toMatchObject({
			kind: 'layer-switch',
			layer: 'qwerty',
			reference: '@to-qwerty',
		});
		const qwerty = findLayer(parsed, 'qwerty');
		expect(qwerty.keys[1]).toMatchObject({
			kind: 'layer-switch',
			layer: 'onishi',
			reference: '@to-onishi',
		});
	});

	it('keeps the held extra layer', () => {
		const onishi = findLayer(parsed, 'onishi');
		expect(onishi.keys[39]).toMatchObject({
			kind: 'layer-while-held',
			layer: 'extra',
			reference: '@ext',
		});
	});
});

describe('kanata — unsupported input becomes an explicit safe value', () => {
	it('reports an undefined alias with its raw reference', () => {
		const parsed = parseKanata('(defsrc a)\n(deflayer base @missing)');
		expect(parsed.layers[0]?.keys[0]).toEqual({
			raw: '@missing',
			kind: 'unknown',
			note: 'alias-not-found',
		});
	});

	it('reports a cyclic alias instead of recursing forever', () => {
		const parsed = parseKanata('(defsrc a)\n(defalias a @b b @a)\n(deflayer base @a)');
		expect(parsed.layers[0]?.keys[0]).toMatchObject({
			kind: 'unknown',
			note: 'alias-cycle',
		});
	});

	it('reports an unsupported form with its raw text', () => {
		const parsed = parseKanata('(defsrc a)\n(deflayer base (tap-dance 200 (a b)))');
		expect(parsed.layers[0]?.keys[0]).toMatchObject({
			kind: 'unknown',
			note: 'unsupported-form',
		});
		expect(parsed.layers[0]?.keys[0]?.raw).toContain('tap-dance');
	});

	it('rejects a layer whose key count disagrees with defsrc', () => {
		expect(() => parseKanata('(defsrc a b)\n(deflayer base a)')).toThrow(KanataParseError);
	});
});
