/**
 * GitHub profile layout contract — the shared design foundation every
 * profile SVG band is composed against (Issue #1235, visual doc §20,
 * skills/layout-system + typesetting + motion-system).
 *
 * Before this module each renderer (`bands.ts`, `stack.ts`) decided
 * its own margins, type sizes, gutters and vertical rhythm, so the
 * three bands read as pasted-together flows. This file is the single
 * place that answers:
 *
 *   - CANVAS   — the two viewports the README's `<picture>` swap
 *                serves, and the outer margin every band shares.
 *   - GRID     — the column grid modules are placed on, the gutter,
 *                and the baseline unit all y-coordinates snap to.
 *   - SPACE    — the spacing scale (a projection of the editorial
 *                `spacing` tokens: 4 / 8 / 16 / 24 / 40 / 64).
 *   - TYPE     — the type scale as semantic ROLES (display / hero /
 *                title / body / strong / data / label / caption),
 *                each carrying size + weight + tracking + line
 *                height. Sizes are SVG px at the desktop canvas;
 *                the README renders the 800px asset ~1:1 on desktop,
 *                so these ARE the CSS pixels a reader sees. The
 *                floor is 11px — nothing smaller ships.
 *   - ICON     — optical icon sizes and the baseline-relative
 *                optical-centre rule for inline glyphs.
 *   - MOTION   — the SMIL marquee contract (constant velocity,
 *                seamless duplicated track, computed period).
 *   - overlay  — the grid/type guides a `?grid=1` render draws so a
 *                reviewer can verify the contract on the artifact.
 *
 * Rules this contract enforces on callers:
 *
 *   1. No renderer invents a margin, font size, gutter or y-offset.
 *      Positions come from `gridX`/`snap`/`TYPE`/`SPACE`.
 *   2. Module anatomy is shared: band header (display title left,
 *      observation meta right) → titled modules on grid columns →
 *      caption footnotes. Sections separate by SPACE, not by a
 *      proliferation of rules.
 *   3. Mobile is a RE-GRID (6 columns, tighter margin), never a
 *      uniform scale-down of the desktop layout.
 *   4. Honest-data rules are unchanged: this module owns geometry
 *      and type only; data semantics stay in the band modules.
 */

// ------------------------------------------------------------------
// Canvas + grid
// ------------------------------------------------------------------

export interface CanvasSpec {
	readonly width: number;
	readonly height?: number;
	/** Outer margin — identical on every band so the three SVGs share
	 * one left/right axis when stacked in the README. */
	readonly margin: number;
	/** Column count for module placement. */
	readonly columns: number;
	/** Gutter between columns. */
	readonly gutter: number;
	/** Baseline unit: every y coordinate and text baseline snaps to
	 * a multiple of this. */
	readonly baseline: number;
	/** True on the 400px re-grid — `typeTable` resolves mobile sizes. */
	readonly mobile: boolean;
}

/**
 * The two canvases the README serves. Desktop 800px displays ~1:1 in
 * GitHub's ~896px content column; mobile 400px displays ~1:1 on a
 * ~390px phone viewport. Widths are contractual — a band never picks
 * its own.
 */
export function canvasSpec(mobile: boolean): CanvasSpec {
	return mobile
		? { width: 400, margin: 16, columns: 6, gutter: 12, baseline: 4, mobile: true }
		: { width: 800, margin: 24, columns: 12, gutter: 16, baseline: 4, mobile: false };
}

/** Content width inside the margins. */
export function contentWidth(spec: CanvasSpec): number {
	return spec.width - spec.margin * 2;
}

/** x position of a column start (0-based) and the width a span covers. */
export function gridX(spec: CanvasSpec, col: number): number {
	return spec.margin + col * (colWidth(spec) + spec.gutter);
}

export function colWidth(spec: CanvasSpec): number {
	return (contentWidth(spec) - spec.gutter * (spec.columns - 1)) / spec.columns;
}

/** Right edge of a span starting at `col`. */
export function gridRight(spec: CanvasSpec, col: number, span: number): number {
	return gridX(spec, col) + span * colWidth(spec) + (span - 1) * spec.gutter;
}

/** Snap a y coordinate onto the baseline grid. */
export function snap(spec: CanvasSpec, y: number): number {
	return Math.round(y / spec.baseline) * spec.baseline;
}

// ------------------------------------------------------------------
// Spacing scale — projection of editorial `spacing` tokens
// (tokens.ts: 1=4 2=8 4=16 6=24 10=40 16=64). Values used inside a
// band; page-level beats (64+) belong to the README markdown, not
// the SVG.
// ------------------------------------------------------------------

export const SPACE = {
	/** decoration on a title, ordinal gap */
	s1: 4,
	/** tight cluster, sibling gap */
	s2: 8,
	/** intra-cluster separation */
	s4: 16,
	/** between related clusters */
	s6: 24,
	/** between peer modules */
	s10: 40,
} as const;

// ------------------------------------------------------------------
// Type scale — semantic roles, not sizes
// ------------------------------------------------------------------

export interface TypeRole {
	/** Desktop SVG px — ≈ CSS px at GitHub's ~1:1 desktop render. */
	readonly size: number;
	/** Mobile override: the 400px asset renders at ~0.88× on a phone,
	 * so the small roles carry +1px to keep the CSS-px floor. */
	readonly msize?: number;
	readonly weight: number;
	readonly track: number;
	readonly lh: number;
	readonly mono?: boolean;
}

/**
 * The profile type scale — real steps, not a flat 11/12px soup.
 * Every text element resolves to one role; renderers read sizes
 * through `typeTable(spec)` so the mobile re-grid gets its own
 * floor without a second scale definition.
 *
 * Legibility floor: nothing ships below 12px desktop / 13px mobile
 * SVG px — at GitHub display size that is ≈12px / ≈11.4px CSS.
 */
export const TYPE = {
	/** Section-level title — the composed profile's part names
	 * ('GITHUB ACTIVITY', 'STACK'). One step under hero so a section
	 * head clearly outranks every module label inside it. */
	display: { size: 22, msize: 20, weight: 800, track: 1.2, lh: 28 },
	/** Focal numerals and the profile handle. */
	hero: { size: 30, msize: 28, weight: 800, track: -0.5, lh: 36 },
	/** Metric numerals in a totals strip — between hero and strong so
	 * a row of account figures reads as data, not headlines. */
	stat: { size: 22, msize: 20, weight: 800, track: -0.3, lh: 26 },
	/** Module label — uppercase, tracked ('REPO OUTPUT'). Same size
	 * as body but bold + tracked + uppercase, so the kicker reads as
	 * a label tier, never smaller than the text it introduces. */
	title: { size: 14, msize: 15, weight: 700, track: 1.2, lh: 20 },
	/** Primary text. */
	body: { size: 14, msize: 15, weight: 400, track: 0, lh: 20 },
	/** Emphasised primary text (names, totals). */
	strong: { size: 14, msize: 15, weight: 700, track: 0, lh: 20 },
	/** Monospaced data (repo names, counts). */
	data: { size: 14, msize: 15, weight: 600, track: 0, lh: 20, mono: true },
	/** Secondary inline text. */
	label: { size: 12, msize: 13, weight: 500, track: 0, lh: 18 },
	/** Footnote / observation meta — the legibility floor. */
	caption: { size: 12, msize: 13, weight: 400, track: 0, lh: 18 },
} as const satisfies Record<string, TypeRole>;

export type TypeName = keyof typeof TYPE;

/**
 * The type table resolved for a canvas: identical roles, with
 * `msize` applied on the mobile re-grid. Renderers call this once
 * per band (`const TT = typeTable(spec)`) and never read `TYPE`
 * directly, so the floor cannot drift per call site.
 */
export function typeTable(spec: CanvasSpec): Record<TypeName, TypeRole> {
	if (!spec.mobile) return TYPE;
	const out = {} as Record<TypeName, TypeRole>;
	for (const name of Object.keys(TYPE) as TypeName[]) {
		const r = TYPE[name];
		out[name] = r.msize === undefined ? r : { ...r, size: r.msize };
	}
	return out;
}

// ------------------------------------------------------------------
// Icons — size steps + optical alignment
// ------------------------------------------------------------------

/** Icon box sizes. Inline glyphs align optically, not geometrically:
 * a stroke glyph's visual centre sits slightly above the geometric
 * centre, so `iconCenterY` returns the y a glyph box should be
 * centred on relative to a text baseline. */
export const ICON = {
	/** inline glyph beside `label`/`caption` text */
	xs: 12,
	/** meta-stat glyph */
	sm: 14,
	/** presence / module glyph */
	md: 18,
	/** avatar-scale badge */
	lg: 24,
	/** stack chip (desktop) */
	xl: 44,
	/** stack chip (mobile) */
	xxl: 48,
} as const;

/**
 * Optical centre of an inline icon relative to a text baseline.
 * Cap-height middle ≈ baseline − 0.34em for the sans roles used
 * here; icons optically centred on the x-height read as aligned.
 */
export function iconCenterY(baseline: number, fontSize: number): number {
	return baseline - fontSize * 0.34;
}

// ------------------------------------------------------------------
// Motion — SMIL marquee contract
// ------------------------------------------------------------------

/**
 * The stack band scrolls horizontally via SVG SMIL
 * `<animateTransform>` — the only animation that runs inside an
 * `<img>`-embedded SVG on GitHub (CSS animations and scripts are
 * disabled in image context; SMIL is part of SVG rendering).
 *
 * Rules:
 *   - constant velocity (linear), never eased — a marquee that
 *     accelerates reads as a loader, not a catalogue;
 *   - the track content is duplicated once and the animation
 *     translates exactly one track width, so the loop is seamless
 *     by construction (no visible jump at the seam);
 *   - period derives from track width at a fixed px/s so every lane
 *     drifts at the same speed regardless of icon count;
 *   - direction is right-to-left (content enters at the right edge)
 *     — the reading direction's opposite, matching every marquee
 *     convention.
 */
export const MOTION = {
	/** px per second — slow ambient drift, ~16–45s per loop depending
	 * on lane density. */
	marqueeSpeed: 30,
} as const;

/** Loop period in seconds for a track of `trackWidth` px. */
export function marqueePeriod(trackWidth: number): number {
	return Math.max(12, trackWidth / MOTION.marqueeSpeed);
}

// ------------------------------------------------------------------
// Overlay — `?grid=1` verification guides
// ------------------------------------------------------------------

/**
 * Renders the contract onto the artifact: margin edges, column
 * guides, baseline lines and a type-scale legend strip. Preview /
 * review use only — production reads never pass `grid=1`.
 */
export function gridOverlay(spec: CanvasSpec, height: number): string {
	const cw = colWidth(spec);
	let s = `<g fill="none" stroke="#f85149" stroke-width="0.75" opacity="0.55">`;
	// margins
	s += `<line x1="${spec.margin}" y1="0" x2="${spec.margin}" y2="${height}"/>`;
	s += `<line x1="${spec.width - spec.margin}" y1="0" x2="${spec.width - spec.margin}" y2="${height}"/>`;
	// interior gutter guides only — the margin lines already mark
	// the outer edges; a c=columns iteration drew a stray line 8px
	// past the right margin
	for (let c = 1; c < spec.columns; c++) {
		const x = spec.margin + c * (cw + spec.gutter) - spec.gutter / 2;
		s += `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${height}" opacity="0.3"/>`;
	}
	// baseline grid (every 4px → every 16px stronger)
	for (let y = spec.baseline; y < height; y += spec.baseline) {
		const major = y % 16 === 0;
		s += `<line x1="0" y1="${y}" x2="${spec.width}" y2="${y}" stroke="${major ? '#1f6feb' : '#8b949e'}" opacity="${major ? 0.4 : 0.15}"/>`;
	}
	s += '</g>';
	// type legend along the bottom edge — wraps to two lines on the
	// narrow canvas so the review tooling never clips
	const TT = typeTable(spec);
	const names = (Object.keys(TYPE) as TypeName[]).filter((n) => n !== 'display');
	const mid = Math.ceil(names.length / 2);
	const line = (ns: TypeName[]) => ns.map((n) => `${n} ${TT[n].size}`).join('  ·  ');
	if (spec.mobile) {
		s += `<text x="${spec.margin}" y="${height - 12}" font-size="9" fill="#f85149" opacity="0.8" font-family="monospace">${line(names.slice(0, mid))}</text>`;
		s += `<text x="${spec.margin}" y="${height - 4}" font-size="9" fill="#f85149" opacity="0.8" font-family="monospace">${line(names.slice(mid))}</text>`;
	} else {
		s += `<text x="${spec.margin}" y="${height - 4}" font-size="9" fill="#f85149" opacity="0.8" font-family="monospace">${line(names)}</text>`;
	}
	return s;
}
