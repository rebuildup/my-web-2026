import { describe, expect, it } from 'vitest';
import onishiSource from './sources/pc-setup/platforms/macos/keyboard/onishi.json?raw';
import { OnishiParseError, hidUsageName, parseOnishiJson } from './parse-onishi';

describe('onishi.json — hidutil mapping', () => {
	const mappings = parseOnishiJson(onishiSource);

	it('reads all 25 mappings in source order', () => {
		expect(mappings).toHaveLength(25);
		expect(mappings[0]).toMatchObject({ fromKey: '-', toKey: '/' });
	});

	it('decodes the documented Onishi base layout', () => {
		const decoded = Object.fromEntries(mappings.map((mapping) => [mapping.fromKey, mapping.toKey]));
		expect(decoded).toEqual({
			'-': '/',
			W: 'L',
			E: 'U',
			R: ',',
			T: '.',
			Y: 'F',
			U: 'W',
			I: 'R',
			O: 'Y',
			A: 'E',
			S: 'I',
			D: 'A',
			F: 'O',
			G: '-',
			H: 'K',
			J: 'T',
			K: 'N',
			L: 'S',
			';': 'H',
			B: ';',
			N: 'G',
			M: 'D',
			',': 'M',
			'.': 'J',
			'/': 'B',
		});
	});

	it('keeps the numeric HID usages for audit', () => {
		expect(mappings[0]?.fromUsage).toBe(30064771117);
		expect(mappings[0]?.toUsage).toBe(30064771128);
		expect(hidUsageName(30064771117)).toBe('-');
		expect(hidUsageName(45)).toBe('-');
	});

	it('rejects malformed JSON', () => {
		expect(() => parseOnishiJson('{')).toThrow(OnishiParseError);
	});

	it('rejects a mapping outside the keyboard usage page', () => {
		expect(() =>
			parseOnishiJson(
				JSON.stringify({
					UserKeyMapping: [
						{
							HIDKeyboardModifierMappingSrc: 30064771072 + 300,
							HIDKeyboardModifierMappingDst: 30064771072,
						},
					],
				}),
			),
		).toThrow(OnishiParseError);
	});

	it('rejects a non-integer usage', () => {
		expect(() =>
			parseOnishiJson(
				JSON.stringify({
					UserKeyMapping: [
						{
							HIDKeyboardModifierMappingSrc: 30064771072.5,
							HIDKeyboardModifierMappingDst: 30064771072,
						},
					],
				}),
			),
		).toThrow(OnishiParseError);
	});
});
