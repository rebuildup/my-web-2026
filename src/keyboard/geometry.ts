/**
 * Key geometry for the two keyboard diagrams.
 *
 * macOS is a physical US ANSI picture: `defsrc` is written in
 * physical order and the Onishi base is applied by `hidutil` before
 * Kanata sees the event.
 *
 * Windows is NOT a physical picture. The config itself says `defsrc`
 * is the post-ChgKey input list — the physical W position arrives as
 * `l`, the physical E position as `u`, and so on. Drawing those
 * tokens under a guessed physical QWERTY cap would be a fabrication,
 * so the Windows diagram labels each position with the key Kanata
 * actually receives and the page states that.
 */

import { keyCapLabel } from './format';
import type { KeyboardGeometry, KeyboardPlatformId } from './types';

export interface ResolvedGeometry extends KeyboardGeometry {
	readonly rows: readonly {
		readonly caps: readonly string[];
		readonly widths: readonly number[];
	}[];
}

interface GeometrySpec {
	readonly layout: string;
	readonly capSource: 'physical' | 'defsrc';
	readonly rowWidths: readonly number[];
	readonly widths: readonly number[];
	readonly caps?: readonly string[];
	readonly note: string;
}

const MAC_ROWS = [13, 14, 14, 13, 12, 6] as const;
const WIN_ROWS = [13, 13, 13, 14, 13, 8] as const;

const MAC_GEOMETRY: GeometrySpec = {
	layout: 'US ANSI',
	capSource: 'physical',
	rowWidths: MAC_ROWS,
	widths: [
		...Array.from({ length: 13 }, () => 1),
		...Array.from({ length: 13 }, () => 1),
		2,
		1.5,
		...Array.from({ length: 12 }, () => 1),
		1.5,
		1.75,
		...Array.from({ length: 11 }, () => 1),
		2.25,
		2.25,
		...Array.from({ length: 10 }, () => 1),
		2.25,
		1.25,
		1,
		1.25,
		6.25,
		1.25,
		1,
	],
	caps: [
		'Esc',
		'F1',
		'F2',
		'F3',
		'F4',
		'F5',
		'F6',
		'F7',
		'F8',
		'F9',
		'F10',
		'F11',
		'F12',
		'`',
		'1',
		'2',
		'3',
		'4',
		'5',
		'6',
		'7',
		'8',
		'9',
		'0',
		'-',
		'=',
		'Backspace',
		'Tab',
		'Q',
		'W',
		'E',
		'R',
		'T',
		'Y',
		'U',
		'I',
		'O',
		'P',
		'[',
		']',
		'\\',
		'Caps',
		'A',
		'S',
		'D',
		'F',
		'G',
		'H',
		'J',
		'K',
		'L',
		';',
		"'",
		'Enter',
		'Shift',
		'Z',
		'X',
		'C',
		'V',
		'B',
		'N',
		'M',
		',',
		'.',
		'/',
		'Shift',
		'Ctrl',
		'Option',
		'Cmd',
		'Space',
		'Cmd',
		'Option',
	],
	note: 'US ANSI の物理キー位置。hidutil が先に大西配列へ変換し、Kanata はその出力を受け取る。',
};

const WIN_GEOMETRY: GeometrySpec = {
	layout: 'JIS',
	capSource: 'defsrc',
	rowWidths: WIN_ROWS,
	widths: [
		...Array.from({ length: 13 }, () => 1),
		...Array.from({ length: 12 }, () => 1),
		2,
		...Array.from({ length: 13 }, () => 1),
		...Array.from({ length: 13 }, () => 1),
		2.25,
		2.25,
		...Array.from({ length: 11 }, () => 1),
		2.25,
		1.25,
		1.25,
		1,
		1.5,
		6.25,
		1.5,
		1.5,
		1.25,
	],
	note: 'ChgKey 後の入力キー列。物理キー位置ではなく、Kanata が受け取るキー名の順番で表示する。',
};

const SPECS: Readonly<Record<KeyboardPlatformId, GeometrySpec>> = {
	macos: MAC_GEOMETRY,
	windows: WIN_GEOMETRY,
};

/**
 * Resolve geometry for a platform, or `null` when the parsed
 * `defsrc` no longer matches the declared key count.
 *
 * `null` is a safe state: the platform is rendered as unavailable
 * rather than drawing a diagram whose rows and actions disagree.
 */
export function resolveGeometry(
	platform: KeyboardPlatformId,
	defsrc: readonly string[],
): ResolvedGeometry | null {
	const spec = SPECS[platform];
	const expected = spec.rowWidths.reduce((sum, width) => sum + width, 0);
	if (defsrc.length !== expected) return null;
	if (spec.widths.length !== expected) return null;

	const caps = spec.caps ?? defsrc.map(keyCapLabel);
	if (caps.length !== expected) return null;

	const rows: Array<{ caps: string[]; widths: number[] }> = [];
	let offset = 0;
	for (const width of spec.rowWidths) {
		rows.push({
			caps: caps.slice(offset, offset + width),
			widths: spec.widths.slice(offset, offset + width),
		});
		offset += width;
	}

	return {
		platform,
		layout: spec.layout,
		capSource: spec.capSource,
		rowWidths: spec.rowWidths,
		widths: spec.widths,
		caps,
		note: spec.note,
		rows,
	};
}

/** Split any `defsrc`-aligned array into the platform's visual rows. */
export function splitRows<T>(items: readonly T[], rowWidths: readonly number[]): T[][] {
	const rows: T[][] = [];
	let offset = 0;
	for (const width of rowWidths) {
		rows.push(items.slice(offset, offset + width));
		offset += width;
	}
	return rows;
}
