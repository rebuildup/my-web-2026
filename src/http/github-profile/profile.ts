/**
 * GitHub profile — the COMPOSED surface (Issue #1235 round 2,
 * visual doc §21).
 *
 * The README used to stack three independent SVG bands
 * (`/identity`, `/activity-map`, `/stack`), each a self-contained
 * page — the result read as pasted-together flows with no shared
 * spine, no cross-section rhythm and three separate bottom pads.
 * `/profile` replaces that stack with ONE canvas: the identity
 * masthead, the GitHub-activity section and the stack marquee are
 * sections of a single composition, separated by the contract's
 * section gap and labelled by display-role heads.
 *
 * Composition rules:
 *   - every section is a fragment drawn by its owner module
 *     (`bands.ts` identity/activity, `stack.ts` lanes) at an
 *     explicit y — this file owns ONLY the vertical order, the
 *     section heads and the canvas;
 *   - section heads use the `display` type role so the hierarchy
 *     reads display (section) > title (module) > caption (meta);
 *   - horizontal placement stays on the shared 12/6-column grid —
 *     the same spine the standalone bands use, so nothing recentres
 *     when sections change;
 *   - the legacy band endpoints keep working (same fragments in
 *     their own canvases) — this is additive surface, not a break.
 */

import {
	type Band1Model,
	type Band2Model,
	activityHeadMeta,
	drawActivitySection,
	drawIdentitySection,
	skinFor,
} from './bands';
import type { Theme } from './bands';
import { escapeXml } from './card';
import { type CanvasSpec, SPACE, canvasSpec, gridOverlay, snap, typeTable } from './design';
import { drawStackSection } from './stack';

const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const esc = escapeXml;

/**
 * Section head — the display-role label on the content axis with
 * the section's meta caption on the right edge. `bottom` is the y
 * the section's first content should start at.
 */
function sectionHead(
	spec: CanvasSpec,
	x: number,
	y: number,
	label: string,
	right: string | null,
	T: Theme,
): { svg: string; bottom: number } {
	const TT = typeTable(spec);
	const ly = snap(spec, y + TT.display.lh - 4);
	let s = `<text x="${x}" y="${ly}" font-family="${FONT}" font-size="${TT.display.size}" font-weight="${TT.display.weight}" fill="${T.fg}" letter-spacing="${TT.display.track}">${esc(label)}</text>`;
	if (right) {
		s += `<text x="${spec.width - spec.margin}" y="${ly}" text-anchor="end" font-family="${FONT}" font-size="${TT.caption.size}" fill="${T.faint}">${esc(right)}</text>`;
	}
	return { svg: s, bottom: snap(spec, ly + SPACE.s4) };
}

/**
 * The composed profile SVG — identity masthead, GITHUB ACTIVITY
 * and STACK as three sections of one canvas. Deterministic for a
 * given input: `now` already flowed into the section models.
 */
export function renderProfileSvg(input: {
	readonly theme: 'dark' | 'light';
	readonly mobile: boolean;
	readonly band1: Band1Model;
	readonly band2: Band2Model;
	readonly grid?: boolean;
}): string {
	const spec = canvasSpec(input.mobile);
	const { T } = skinFor(input.theme);
	const m = spec.margin;
	let s = '';
	let y = SPACE.s6;

	// 1 — identity masthead (no section label: it IS the head)
	const id = drawIdentitySection(input.band1, y);
	s += id.svg;
	// top-level sections separate by s10 — the contract's peer-module
	// beat — so the three parts read as chapters, not one flat stack
	y = id.bottom + SPACE.s10;

	// 2 — GITHUB ACTIVITY
	const ah = sectionHead(
		spec,
		m,
		y,
		'GITHUB ACTIVITY',
		activityHeadMeta(input.band2, input.mobile),
		T,
	);
	s += ah.svg;
	const act = drawActivitySection(input.band2, ah.bottom, { sectioned: true });
	s += act.svg;
	y = act.bottom + SPACE.s10;

	// 3 — STACK
	const sh = sectionHead(spec, m, y, 'STACK', null, T);
	s += sh.svg;
	const stk = drawStackSection({ theme: input.theme, mobile: input.mobile, y0: sh.bottom });
	s += stk.svg;

	// mobile trades the canvas tail pad for the stack footer's own
	// caption air — net height is unchanged, the caption clears the
	// icon row instead of sitting 6px under it
	const H =
		snap(spec, stk.bottom + (input.mobile ? SPACE.s2 : SPACE.s4)) +
		(input.grid && input.mobile ? 28 : 0);
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${H}" viewBox="0 0 ${spec.width} ${H}" font-family="${FONT}">`;
	svg += '<title>GitHub profile — identity, activity and stack</title>';
	svg += `<rect width="${spec.width}" height="${H}" fill="${T.bg}"/>`;
	svg += s;
	if (input.grid) svg += gridOverlay(spec, H);
	svg += '</svg>';
	return svg;
}
