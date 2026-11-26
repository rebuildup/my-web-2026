/**
 * GitHub profile "stack" band — the technology catalogue as four
 * category lanes on SMIL marquees (Issue #1216 follow-up, #1235,
 * visual doc §20).
 *
 * Layout contract: every position, size and rhythm value comes from
 * `design.ts` — canvas spec, 12/6-column grid, 4px baseline, the
 * TYPE/SPACE/ICON scales and the MOTION marquee rules. This module
 * owns only WHAT scrolls (the committed 48-icon set grouped by
 * activity area) and WHERE each lane sits on the grid.
 *
 * Why a marquee: the README constraint is HEIGHT, not width —
 * 48 legible icons cannot sit still in one row, and stacking them
 * statically is exactly the vertical bloat the owner rejected.
 * Each lane is a clipped viewport over a duplicated icon track
 * translated by SMIL `<animateTransform>` (the only animation that
 * runs inside an `<img>`-embedded SVG — CSS animations and scripts
 * are disabled in image context). Constant velocity, one-period
 * translate → seamless loop by construction.
 *
 * Desktop recomposes as a label rail + scroll field per lane
 * (categories read as a legend on the left); mobile stacks the
 * label above each lane so the scroll field keeps the full content
 * width. Chip size and lane height are independent axes: horizontal
 * pitch (`chip + gap`) is chosen per lane density, vertical leading
 * is one shared lane height.
 *
 * Honesty contract: all 48 committed skill icons (ADR-0026 §2.4
 * baseline) render — coverage is never traded for compactness.
 * `?theme=` picks the `-dark` / `-light` chip variants.
 */

import { escapeXml } from './card';
import { SPACE, canvasSpec, gridOverlay, gridX, marqueePeriod, snap, typeTable } from './design';
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

// Lane metrics — horizontal pitch and vertical leading are designed
// independently (user requirement): pitch packs icons tightly so the
// track overflows the viewport and the marquee has somewhere to go;
// lane height is one shared rhythm for every lane.
const LANE = {
	/** chip edge length, px — small enough that four lanes read as a
	 * compressed catalogue, large enough that brand marks stay legible */
	chip: 40,
	/** gap between consecutive chips inside a track, px — pitch
	 * (chip + gap) must exceed the viewport or a lane's shortest
	 * period could render the same icon twice in-frame */
	gap: 24,
	/** vertical padding above/below the chip row inside a lane, px */
	padY: 8,
	/** gap between lanes, px */
	gapY: 4,
} as const;

const CHIP_MOBILE = 32;
const GAP_MOBILE = 14;

interface LaneGeom {
	readonly label: string;
	readonly icons: readonly StackIcon[];
	/** lane block top y (label row included on mobile) */
	readonly top: number;
	/** icon row top y */
	readonly iconsY: number;
	/** label baseline y */
	readonly labelY: number;
	/** scroll viewport left edge */
	readonly vpX: number;
	/** scroll viewport width */
	readonly vpW: number;
	readonly laneH: number;
	readonly chip: number;
	readonly pitch: number;
}

interface StackGeom {
	readonly lanes: readonly LaneGeom[];
	readonly height: number;
}

function layout(mobile: boolean): StackGeom {
	const spec = canvasSpec(mobile);
	const groups = resolveGroups();
	const chip = mobile ? CHIP_MOBILE : LANE.chip;
	const gap = mobile ? GAP_MOBILE : LANE.gap;
	const pitch = chip + gap;

	// no header strip — the README's H2 owns the section name, so
	// the first lane starts at the top margin like every peer band
	const TT = typeTable(spec);

	if (mobile) {
		// label ABOVE each lane — the rail can't hold 'Design & motion'
		// beside a 30px icon row on a 368px canvas
		const labelRowH = TT.title.lh + SPACE.s1;
		const laneH = labelRowH + LANE.padY + chip + LANE.padY;
		let y = SPACE.s4;
		const lanes = groups.map((g, i) => {
			const labelY = snap(spec, y + TT.title.lh - 4);
			const iconsY = snap(spec, y + labelRowH + LANE.padY);
			const lane = {
				label: g.label,
				icons: g.icons,
				top: y,
				iconsY,
				labelY,
				vpX: spec.margin,
				vpW: spec.width - spec.margin * 2,
				laneH,
				chip,
				pitch,
			};
			// mobile lanes need real air between icon row and the next
			// label — 4px read as one continuous strip
			y += laneH + (i < groups.length - 1 ? SPACE.s4 : 0);
			return lane;
		});
		return { lanes, height: snap(spec, y + SPACE.s4) };
	}

	// desktop — label rail on grid columns 0–2, scroll field from
	// column 3 to the right margin (560px) — the same col-3 spine
	// bands 1–2 build their left content edge on. Pitch is 64px so
	// the shortest lane period (9 chips = 576px) always exceeds the
	// viewport — one full period fills the window and no icon ever
	// renders twice in-frame. One shared lane height; the rail
	// label is optically centred on the icon row.
	const vpX = gridX(spec, 3);
	const vpW = spec.width - spec.margin - vpX;
	const laneH = chip + LANE.padY * 2;
	let y = SPACE.s4;
	const lanes = groups.map((g, i) => {
		const iconsY = snap(spec, y + LANE.padY);
		// rail label centred on the chip row: baseline sits at the
		// optical middle of the icons, not the lane block
		const labelY = snap(spec, iconsY + chip / 2 + TT.title.size * 0.34);
		const lane = {
			label: g.label,
			icons: g.icons,
			top: y,
			iconsY,
			labelY,
			vpX,
			vpW,
			laneH,
			chip,
			pitch,
		};
		y += laneH + (i < groups.length - 1 ? LANE.gapY : 0);
		return lane;
	});
	return { lanes, height: snap(spec, y + SPACE.s4) };
}

/** fade zone width per canvas — mobile burns less of its narrow
 * viewport on edge dissolution */
function fadeWidth(mobile: boolean, vpW: number): number {
	return mobile ? Math.min(32, vpW / 9) : Math.min(48, vpW / 9);
}

/**
 * Icon definitions — each committed chip is emitted ONCE as a
 * `<symbol>` and instanced with `<use>`; without this a marquee
 * track would inline the same path data dozens of times per lane.
 */
function iconSymbols(theme: 'dark' | 'light'): string {
	return STACK_ICONS.map((icon) => {
		const inner = theme === 'dark' ? icon.dark : icon.light;
		return `<symbol id="stk-${icon.id}" viewBox="0 0 256 256">${inner}</symbol>`;
	}).join('');
}

/** One chip instance inside a track: hairline + symbol use. */
function chipUse(icon: StackIcon, x: number, y: number, size: number, T: Theme): string {
	return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${Math.round(size * 0.24)}" fill="none" stroke="${T.chipStroke}" stroke-width="1"/><use href="#stk-${icon.id}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
}

/**
 * One marquee lane: a clipped viewport over `copies` repetitions of
 * the icon sequence, translated by exactly one period (`seqW =
 * n * pitch`). The content is periodic, so the loop is seamless by
 * construction; `copies` is the smallest count that keeps the
 * viewport covered through the whole translation.
 */
function marqueeLane(lane: LaneGeom, index: number, T: Theme): string {
	const seqW = lane.icons.length * lane.pitch;
	const copies = Math.ceil(lane.vpW / seqW) + 1;
	const dur = marqueePeriod(seqW);
	const clipId = `stkclip${index}`;

	let track = '';
	for (let c = 0; c < copies; c++) {
		for (const [j, icon] of lane.icons.entries()) {
			track += chipUse(icon, c * seqW + j * lane.pitch, 0, lane.chip, T);
		}
	}

	return `<clipPath id="${clipId}"><rect x="${lane.vpX}" y="${lane.iconsY}" width="${lane.vpW}" height="${lane.chip}"/></clipPath><g clip-path="url(#${clipId})"><g mask="url(#stkm)"><g transform="translate(${lane.vpX} ${lane.iconsY})"><g><animateTransform attributeName="transform" type="translate" from="0 0" to="${-seqW} 0" dur="${dur.toFixed(2)}s" repeatCount="indefinite"/>${track}</g></g></g></g>`;
}

export function renderStackSvg(input: {
	readonly theme: 'dark' | 'light';
	readonly mobile: boolean;
	readonly grid?: boolean;
}): string {
	const T = THEMES[input.theme];
	const spec = canvasSpec(input.mobile);
	const W = spec.width;
	const G = layout(input.mobile);
	// the footer meta line sits below the last lane — the canvas
	// height is derived after layout so the strip is real space,
	// and grid=1's bottom legend keeps its own reserve on mobile
	const contentBottom = G.height - SPACE.s4;
	const footerY = snap(spec, contentBottom + SPACE.s4);
	const H = snap(spec, footerY + SPACE.s4) + (input.grid && input.mobile ? 28 : 0);
	const mobile = input.mobile;
	const groups = resolveGroups();
	const totalIcons = groups.reduce((a, g) => a + g.icons.length, 0);

	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
	s += `<title>Technology stack — ${totalIcons} tools in ${groups.length} activity areas</title>`;
	s += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;

	const TT = typeTable(spec);
	const firstLane = G.lanes[0];
	const lastLane = G.lanes[G.lanes.length - 1];
	const vpRight = firstLane.vpX + firstLane.vpW;
	const fadeW = fadeWidth(mobile, firstLane.vpW);
	const maskY = firstLane.iconsY - 4;
	const maskH = lastLane.iconsY + lastLane.chip + 4 - maskY;

	// Edge dissolution as an SVG mask on the scrolling group — the
	// clip bounds the viewport AND the mask is pure black at both
	// boundaries, so a partially-clipped icon can never leave a
	// 1px sliver the way a painted fade overlay could. One mask
	// serves every lane: the gradients are horizontal-only and the
	// mask region spans all icon rows.
	s += `<defs>${iconSymbols(input.theme)}`;
	s += `<linearGradient id="stkgL" gradientUnits="userSpaceOnUse" x1="${firstLane.vpX}" y1="0" x2="${firstLane.vpX + fadeW}" y2="0"><stop offset="0" stop-color="#000"/><stop offset="0.2" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>`;
	s += `<linearGradient id="stkgR" gradientUnits="userSpaceOnUse" x1="${vpRight - fadeW}" y1="0" x2="${vpRight}" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="0.2" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>`;
	s += `<mask id="stkm" maskUnits="userSpaceOnUse" x="${firstLane.vpX - 2}" y="${maskY}" width="${firstLane.vpW + 4}" height="${maskH}"><rect x="${firstLane.vpX - 2}" y="${maskY}" width="${firstLane.vpW + 4}" height="${maskH}" fill="#fff"/><rect x="${firstLane.vpX - 2}" y="${maskY}" width="${fadeW + 2}" height="${maskH}" fill="url(#stkgL)"/><rect x="${vpRight - fadeW}" y="${maskY}" width="${fadeW + 2}" height="${maskH}" fill="url(#stkgR)"/></mask>`;
	s += '</defs>';

	G.lanes.forEach((lane, i) => {
		// lane label — title role, uppercase, tracked; the category
		// name is the lane's permanent label, not a caption
		s += `<text x="${spec.margin}" y="${lane.labelY}" font-size="${TT.title.size}" font-weight="${TT.title.weight}" fill="${T.muted}" letter-spacing="${TT.title.track}">${esc(lane.label.toUpperCase())}</text>`;
		s += marqueeLane(lane, i, T);
	});

	// footer meta — bottom-right, matching the band grammar of a
	// single observation line per module
	const caption = `${totalIcons} technologies · ${groups.length} categories`;
	s += `<text x="${W - spec.margin}" y="${footerY}" text-anchor="end" font-size="${TT.caption.size}" fill="${T.faint}">${esc(caption)}</text>`;

	if (input.grid) {
		s += gridOverlay(spec, H);
	}

	s += '</svg>';
	return s;
}
