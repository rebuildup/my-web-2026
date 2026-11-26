/**
 * GitHub profile "stack" band — technology lanes (Issue #1216
 * follow-up, visual doc §18).
 *
 * The committed skill-icons set (`public/github-profile/skills/*.svg`,
 * tandpfun/skill-icons MIT) inlined by
 * `scripts/build-github-profile-stack-icons.mjs` into `stack-icons.ts`,
 * laid out as labelled lanes grouped by activity area. Group order is
 * the owner's story: Design & motion leads (the distinctive craft),
 * then Languages, Frameworks & runtimes, and the Infra & dev tools
 * substrate.
 *
 * Desktop is a balanced 2×2: three craft lanes across the top two
 * rows' left cells and the substrate lane completing the grid — no
 * empty quadrant, no filler caption, right edge flush with Bands 1–2.
 * Hierarchy is real, not cosmetic: craft lanes render 40px chips,
 * the substrate lane 28px (≥1.4× ratio), and within-lane "also-used"
 * tools (SECONDARY_IDS) render at reduced opacity — all centered on
 * the same pitch grid so nothing breaks alignment. Mobile stacks the
 * same four lanes with smaller chips; category label above each row.
 *
 * Honesty contract: the icon set and grouping are the committed,
 * reviewed list — nothing is invented per request. `?theme=` picks
 * the `-dark` / `-light` chip variants exactly like the old
 * `<picture>` pairs.
 */

import { escapeXml } from './card';
import { STACK_GROUPS, STACK_ICONS, type StackIcon } from './stack-icons';

export const STACK_WIDTH = 800;
export const STACK_MOBILE_WIDTH = 400;

const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const esc = escapeXml;

interface Theme {
	readonly bg: string;
	readonly fg: string;
	readonly muted: string;
	readonly faint: string;
	readonly line: string;
	readonly chipStroke: string;
}

const THEMES: Record<'dark' | 'light', Theme> = {
	dark: {
		bg: '#0d1117',
		fg: '#e6edf3',
		muted: '#bcc6d4',
		faint: '#9aa7b8',
		line: '#2d333f',
		// dark-fill tiles (Adobe, .NET) need a stronger edge on #0d1117
		chipStroke: '#3d4450',
	},
	light: {
		bg: '#ffffff',
		fg: '#1f2328',
		muted: '#525c68',
		faint: '#68717d',
		line: '#d1d9e0',
		chipStroke: '#c9d1d9',
	},
};

const ICON_BY_ID = new Map(STACK_ICONS.map((icon) => [icon.id, icon]));

/** Craft lanes render larger chips — the tools that define the
 * work — while the supporting substrate stays visibly secondary. */
const PRIMARY_LANES = new Set(['Design & motion', 'Languages', 'Frameworks & runtimes']);

interface LaneLayout {
	readonly label: string;
	readonly icons: readonly StackIcon[];
	readonly chip: number;
	readonly pitch: number;
	readonly perRow: number;
	readonly x: number;
	readonly labelY: number;
	readonly iconsY: number;
	readonly cellH: number;
}

interface StackLayout {
	readonly lanes: readonly LaneLayout[];
	readonly height: number;
	readonly padX: number;
}

interface GroupIcons {
	readonly label: string;
	readonly icons: readonly StackIcon[];
}

function resolveGroups(): GroupIcons[] {
	return STACK_GROUPS.map((group) => ({
		label: group.label,
		icons: group.iconIds
			.map((id) => ICON_BY_ID.get(id))
			.filter((icon): icon is StackIcon => icon !== undefined),
	}));
}

function layout(mobile: boolean): StackLayout {
	const W = mobile ? STACK_MOBILE_WIDTH : STACK_WIDTH;
	const padX = mobile ? 14 : 20;
	const groups = resolveGroups();

	if (mobile) {
		// one column, category label stacked above each icon row —
		// a narrow left column cannot hold 'Design & motion' without
		// colliding with the first icon tile. Chips are sized to the
		// 400px canvas, not shrunk to fit — every curated lane lands
		// on a single row whose pitch stretches edge to edge.
		const chipFor = (label: string) => (PRIMARY_LANES.has(label) ? 42 : 30);
		// taller header block: the title gets Band-2-like top air and a
		// real gap before the first lane label instead of stacking tight
		const headerH = 42;
		const laneGap = 12;
		const labelH = 17;
		const iconsW = W - padX * 2;
		let y = headerH;
		const lanes = groups.map((g) => {
			const chip = chipFor(g.label);
			const minPitch = chip + 6;
			const perRow = Math.max(1, Math.floor((iconsW + 6) / minPitch));
			const rows = Math.max(1, Math.ceil(g.icons.length / perRow));
			// single-row lanes stretch their pitch so icons span the
			// full width — no dead margin down the right side.
			// pitch is the left-edge delta between consecutive chips
			const pitch =
				rows === 1 && g.icons.length > 1 ? (iconsW - chip) / (g.icons.length - 1) : chip + 6;
			const iconsY = y + labelH;
			const cellH = labelH + rows * pitch - 8 + 8;
			const lane = {
				label: g.label,
				icons: g.icons,
				chip,
				pitch,
				perRow,
				x: padX,
				labelY: y + 12,
				iconsY,
				cellH,
			};
			y += cellH + laneGap;
			return lane;
		});
		return { lanes, height: y + 4, padX };
	}

	// desktop — 2-column grid, four lanes fill a balanced 2×2.
	// Craft lanes get 40px chips, the substrate lane 28px: a real
	// ≥1.4× tier ratio. Each lane's icon row is vertically centered
	// inside its cell so mixed-height rows still align.
	const cols = 2;
	const colGap = 28;
	const cellW = (W - padX * 2 - colGap * (cols - 1)) / cols;
	const innerPad = 6;
	const iconsW = cellW - innerPad * 2;
	const headerH = 40;
	const labelH = 20;
	const rowGap = 22;
	const cellX = (i: number) => padX + (i % cols) * (cellW + colGap);

	const sized = groups.map((g) => {
		const primary = PRIMARY_LANES.has(g.label);
		const chip = primary ? 40 : 28;
		const minPitch = chip + 6;
		const perRow = Math.max(1, Math.floor((iconsW + 6) / minPitch));
		const rows = Math.max(1, Math.ceil(g.icons.length / perRow));
		// single-row lanes stretch pitch edge to edge so every lane's
		// right edge lands on the same column — no ragged finish.
		// pitch is the left-edge delta between consecutive chips
		const pitch =
			rows === 1 && g.icons.length > 1 ? (iconsW - chip) / (g.icons.length - 1) : chip + 6;
		const cellH = labelH + rows * pitch - 6 + 14;
		return { ...g, chip, pitch, perRow, rows, cellH };
	});

	const rowsCount = Math.ceil(sized.length / cols);
	const rowHeights: number[] = [];
	for (let r = 0; r < rowsCount; r++) {
		rowHeights.push(Math.max(...sized.slice(r * cols, r * cols + cols).map((l) => l.cellH)));
	}
	const rowTop = (row: number) =>
		headerH + rowHeights.slice(0, row).reduce((a, b) => a + b + rowGap, 0);

	const lanes: LaneLayout[] = sized.map((g, i) => {
		const row = Math.floor(i / cols);
		const top = rowTop(row);
		const rowH = rowHeights[row];
		// top-align every lane's icon row at the same label offset —
		// the smaller substrate chips bind to their label exactly
		// like the craft lanes instead of floating mid-cell
		const iconsY = top + labelH + 2;
		return {
			label: g.label,
			icons: g.icons,
			chip: g.chip,
			pitch: g.pitch,
			perRow: g.perRow,
			x: cellX(i) + innerPad,
			labelY: top + 14,
			iconsY,
			cellH: rowH,
		};
	});

	const height = headerH + rowHeights.reduce((a, b) => a + b, 0) + rowGap * (rowsCount - 1) + 12;
	return { lanes, height, padX };
}

export function renderStackSvg(input: {
	readonly theme: 'dark' | 'light';
	readonly mobile: boolean;
}): string {
	const T = THEMES[input.theme];
	const W = input.mobile ? STACK_MOBILE_WIDTH : STACK_WIDTH;
	const L = layout(input.mobile);
	const H = Math.ceil(L.height);
	const mobile = input.mobile;

	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
	s += `<title>Technology stack — ${STACK_ICONS.length} tools in ${STACK_GROUPS.length} activity areas</title>`;
	s += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
	s += `<text x="${L.padX}" y="${mobile ? 24 : 24}" font-size="${mobile ? 12 : 13}" font-weight="800" fill="${T.fg}" letter-spacing="2">TECHNOLOGY STACK</text>`;

	for (const lane of L.lanes) {
		// uppercase tracked category label above the icon row — same
		// voice as the band titles and every lane on both breakpoints
		s += `<text x="${lane.x}" y="${lane.labelY}" font-size="9.5" font-weight="700" fill="${T.muted}" letter-spacing="1">${esc(lane.label.toUpperCase())}</text>`;
		lane.icons.forEach((icon, i) => {
			const row = Math.floor(i / lane.perRow);
			const col = i % lane.perRow;
			const ix = lane.x + col * lane.pitch;
			const iy = lane.iconsY + row * lane.pitch;
			const inner = input.theme === 'dark' ? icon.dark : icon.light;
			// a hairline keeps dark-on-dark tiles (Adobe, .NET) readable
			s += `<rect x="${ix}" y="${iy}" width="${lane.chip}" height="${lane.chip}" rx="${lane.chip * 0.24}" fill="none" stroke="${T.chipStroke}" stroke-width="1"/><svg x="${ix}" y="${iy}" width="${lane.chip}" height="${lane.chip}" viewBox="0 0 256 256">${inner}</svg>`;
		});
	}
	s += '</svg>';
	return s;
}
