/**
 * `onishi.json` parser (macOS `hidutil` `UserKeyMapping`).
 *
 * The file is an allowlisted PUBLIC file. It is small, but it is
 * still third-party content: the parser caps the entry count, rejects
 * non-integer / out-of-range HID usage values, and never turns a
 * malformed file into a partially rendered mapping.
 *
 * Usage ids in the file are full HID usages (`0x700000000 + usage`).
 * The page displays both the friendly key name and the numeric usage,
 * so a future key the table does not know is still auditable.
 */

import type { KeyboardHidMapping } from './types';

/** Maximum mappings accepted (the real file has 25). */
const MAX_MAPPINGS = 256;

/** HID keyboard/Keypad page base, as used by `hidutil`. */
const HID_KEYBOARD_PAGE = 0x700000000;

/** Maximum usage id on the keyboard page. */
const MAX_KEYBOARD_USAGE = 0xff;

/**
 * Friendly names for the HID usages the keyboard page renders.
 *
 * Source: HID Usage Tables, Keyboard/Keypad page (0x07). Only the
 * range the Onishi mapping and the common modifiers use is covered.
 * The table is built from pairs so the usage stays a hex number (the
 * form the HID specification uses) instead of an object key.
 */
const HID_KEY_NAMES: Readonly<Record<number, string>> = Object.fromEntries([
	[0x04, 'A'],
	[0x05, 'B'],
	[0x06, 'C'],
	[0x07, 'D'],
	[0x08, 'E'],
	[0x09, 'F'],
	[0x0a, 'G'],
	[0x0b, 'H'],
	[0x0c, 'I'],
	[0x0d, 'J'],
	[0x0e, 'K'],
	[0x0f, 'L'],
	[0x10, 'M'],
	[0x11, 'N'],
	[0x12, 'O'],
	[0x13, 'P'],
	[0x14, 'Q'],
	[0x15, 'R'],
	[0x16, 'S'],
	[0x17, 'T'],
	[0x18, 'U'],
	[0x19, 'V'],
	[0x1a, 'W'],
	[0x1b, 'X'],
	[0x1c, 'Y'],
	[0x1d, 'Z'],
	[0x1e, '1'],
	[0x1f, '2'],
	[0x20, '3'],
	[0x21, '4'],
	[0x22, '5'],
	[0x23, '6'],
	[0x24, '7'],
	[0x25, '8'],
	[0x26, '9'],
	[0x27, '0'],
	[0x28, 'Enter'],
	[0x29, 'Esc'],
	[0x2a, 'Backspace'],
	[0x2b, 'Tab'],
	[0x2c, 'Space'],
	[0x2d, '-'],
	[0x2e, '='],
	[0x2f, '['],
	[0x30, ']'],
	[0x31, '\\'],
	[0x32, '#'],
	[0x33, ';'],
	[0x34, "'"],
	[0x35, '`'],
	[0x36, ','],
	[0x37, '.'],
	[0x38, '/'],
	[0x39, 'Caps Lock'],
	[0x3a, 'F1'],
	[0x3b, 'F2'],
	[0x3c, 'F3'],
	[0x3d, 'F4'],
	[0x3e, 'F5'],
	[0x3f, 'F6'],
	[0x40, 'F7'],
	[0x41, 'F8'],
	[0x42, 'F9'],
	[0x43, 'F10'],
	[0x44, 'F11'],
	[0x45, 'F12'],
	[0x4f, 'Right'],
	[0x50, 'Left'],
	[0x51, 'Down'],
	[0x52, 'Up'],
	[0xe0, 'Left Ctrl'],
	[0xe1, 'Left Shift'],
	[0xe2, 'Left Alt'],
	[0xe3, 'Left Cmd'],
	[0xe4, 'Right Ctrl'],
	[0xe5, 'Right Shift'],
	[0xe6, 'Right Alt'],
	[0xe7, 'Right Cmd'],
]);

export type OnishiParseCode =
	| 'invalid-json'
	| 'invalid-root'
	| 'too-many-mappings'
	| 'invalid-mapping';

export class OnishiParseError extends Error {
	readonly code: OnishiParseCode;

	constructor(code: OnishiParseCode, message: string) {
		super(message);
		this.name = 'OnishiParseError';
		this.code = code;
	}
}

/** Friendly key name for a full HID usage id. */
export function hidUsageName(usage: number): string {
	const low = usage >= HID_KEYBOARD_PAGE ? usage - HID_KEYBOARD_PAGE : usage;
	return HID_KEY_NAMES[low] ?? `usage 0x${low.toString(16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUsage(entry: Record<string, unknown>, key: string): number {
	const value = entry[key];
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
		throw new OnishiParseError('invalid-mapping', `${key} is not an integer`);
	}
	const low = value >= HID_KEYBOARD_PAGE ? value - HID_KEYBOARD_PAGE : value;
	if (low < 0 || low > MAX_KEYBOARD_USAGE) {
		throw new OnishiParseError('invalid-mapping', `${key} is outside the keyboard page`);
	}
	return value;
}

/**
 * Parse `onishi.json` into ordered mappings.
 *
 * Order is preserved: the mapping table is the reader's evidence for
 * the base layer, and reordering it would make a visual diff harder.
 */
export function parseOnishiJson(source: string): KeyboardHidMapping[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		throw new OnishiParseError('invalid-json', 'onishi.json is not valid JSON');
	}
	if (!isRecord(parsed)) {
		throw new OnishiParseError('invalid-root', 'onishi.json has no object root');
	}
	const entries = parsed.UserKeyMapping;
	if (!Array.isArray(entries)) {
		throw new OnishiParseError('invalid-root', 'UserKeyMapping is not an array');
	}
	if (entries.length === 0 || entries.length > MAX_MAPPINGS) {
		throw new OnishiParseError('too-many-mappings', 'UserKeyMapping is empty or oversized');
	}

	return entries.map((entry, index) => {
		if (!isRecord(entry)) {
			throw new OnishiParseError('invalid-mapping', `mapping ${index} is not an object`);
		}
		const fromUsage = readUsage(entry, 'HIDKeyboardModifierMappingSrc');
		const toUsage = readUsage(entry, 'HIDKeyboardModifierMappingDst');
		return {
			fromUsage,
			toUsage,
			fromKey: hidUsageName(fromUsage),
			toKey: hidUsageName(toUsage),
		};
	});
}
