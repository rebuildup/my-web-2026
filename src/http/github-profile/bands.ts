/**
 * GitHub profile "bands" — the visual-led redesign (Issue #1216,
 * ADR-0026 direction, visual doc §18).
 *
 * The README's dynamic sections are three unboxed SVG bands:
 *
 *   Band 1 `identity`  — profile head: real avatar, name, Discord-
 *     style presence card, then the GitHub-native stat strip
 *     (streak flame + readme-stats card metrics: stars / commits /
 *     PRs / issues / contributed-to) and the top-languages bar.
 *     Rank and all-time totals stay as a quiet footnote — context,
 *     not the headline.
 *   Band 2 `activity-map` — "output": per-repository 30-day commit
 *     bars with exact PR counts (unmeasured ≠ zero) beside a
 *     GitHub-pulse-style strip of recent public events on an
 *     observation-anchored time axis.
 *   Band 3 `stack`     — technology lanes grouped by activity area
 *     (`stack.ts`, generated `stack-icons.ts`).
 *
 * Honesty contract (same as `now.ts` / ADR-0025): ratios are linear,
 * counts are exact numerals beside every scaled mark, an absent
 * upstream renders `—` / an explicit empty state, and a missing
 * activity snapshot is labelled unavailable — never confused with
 * measured zero activity. Observation instants are printed inside
 * the image so cached copies stay honest.
 *
 * Rendering is deterministic for a given input: `now` arrives as
 * an argument, no clock, no randomness, no fetch at render time.
 */

import { GitHubActivitySnapshotBody } from '../activity/schema';
import { escapeXml, textWidth, truncate } from './card';
import {
	type CanvasSpec,
	ICON,
	SPACE,
	type TypeName,
	canvasSpec,
	contentWidth,
	gridOverlay,
	gridRight,
	gridX,
	iconCenterY,
	snap,
	typeTable,
} from './design';
import type { ProfileCardModel } from './model';

export const BAND_WIDTH = 800;
export const BAND_MOBILE_WIDTH = 400;

const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,monospace";

export interface Theme {
	readonly bg: string;
	readonly panel: string;
	readonly panel2: string;
	readonly line: string;
	readonly fg: string;
	readonly muted: string;
	readonly faint: string;
	readonly discord: string;
}

const THEMES: Record<'dark' | 'light', Theme> = {
	dark: {
		bg: '#0d1117',
		panel: '#161b22',
		panel2: '#232b38',
		line: '#2d333f',
		fg: '#e6edf3',
		muted: '#bcc6d4',
		faint: '#9aa7b8',
		discord: '#7983f5',
	},
	light: {
		bg: '#ffffff',
		panel: '#f6f8fa',
		panel2: '#eaeef2',
		line: '#d1d9e0',
		fg: '#1f2328',
		muted: '#525c68',
		faint: '#68717d',
		discord: '#5865f2',
	},
};

const SEM: Record<string, { dark: string; light: string }> = {
	accent: { dark: '#58a6ff', light: '#0969da' },
	green: { dark: '#3fb950', light: '#1a7f37' },
	purple: { dark: '#bc8cff', light: '#8250df' },
	orange: { dark: '#d29922', light: '#9a6700' },
	red: { dark: '#f85149', light: '#cf222e' },
	pink: { dark: '#f778ba', light: '#bf3989' },
};

// ---- feed event encoding (Band 2 pulse) ----
const TYPE_COLOR: Record<string, keyof typeof SEM> = {
	PushEvent: 'accent',
	PullRequestEvent: 'purple',
	IssuesEvent: 'green',
	IssueCommentEvent: 'green',
	PullRequestReviewEvent: 'purple',
	CreateEvent: 'orange',
	DeleteEvent: 'red',
	WatchEvent: 'pink',
	ForkEvent: 'pink',
	ReleaseEvent: 'orange',
};

function observedJst(iso: string | null | undefined): string {
	if (!iso) return 'unknown time';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return 'unknown time';
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Tokyo',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).formatToParts(d);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return `${get('month')} ${get('day')} · ${get('hour')}:${get('minute')} JST`;
}

/**
 * Resolved per-render palette: the single place that knows how a
 * theme name becomes concrete colors. Renderers receive a `skin`
 * instead of re-deriving `THEMES`/`SEM` lookups.
 */
export interface Skin {
	readonly T: Theme;
	readonly sem: (k: string) => string;
	readonly typeColor: (t: string) => string;
}

export function skinFor(theme: 'dark' | 'light'): Skin {
	const T = THEMES[theme];
	const isDark = theme === 'dark';
	const sem = (k: string) => SEM[k][isDark ? 'dark' : 'light'];
	return { T, sem, typeColor: (t) => sem(TYPE_COLOR[t] ?? 'accent') };
}

const esc = escapeXml;

/**
 * Licensed icon glyphs — Lucide (ISC) stroke paths on a 24×24
 * viewBox and the Simple Icons Discord mark (CC0). No hand-drawn
 * stand-ins: every icon is the upstream path data, normalized to
 * the same viewBox and rendered through one helper.
 */
const LUCIDE_INNER: Record<string, string> = {
	flame:
		'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
	commit:
		'<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
	pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
	star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
	issues: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
	create:
		'<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M3 15h6"/><path d="M6 12v6"/>',
	del: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
	folder:
		'<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
	'trending-up':
		'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
	user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
	'git-fork':
		'<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
};

/** Lucide glyph centered on (cx, cy), `size` px square. */
function lucide(name: string, cx: number, cy: number, size: number, color: string): string {
	const inner = LUCIDE_INNER[name];
	if (!inner) return '';
	return `<svg x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/** Simple Icons Discord mark (viewBox 0 0 24 24, fill). */
const DISCORD_LOGO =
	'<path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>';

/** Discord brand status colors (the real client palette). */
const DISCORD_STATUS_COLOR: Record<string, string> = {
	Online: '#23a55a',
	Idle: '#f0b232',
	'Do Not Disturb': '#f23f43',
};

const EVENT_GLYPH: Record<string, string> = {
	PushEvent: 'commit',
	PullRequestEvent: 'pr',
	CreateEvent: 'create',
	DeleteEvent: 'del',
};

/** Chart/event mark for a feed type: a licensed Lucide glyph, or a
 * plain filled dot for unmapped types (a data mark, not an icon). */
function eventGlyph(type: string, cx: number, cy: number, size: number, color: string): string {
	const name = EVENT_GLYPH[type];
	if (name) return lucide(name, cx, cy, size, color);
	return `<circle cx="${cx}" cy="${cy}" r="${size * 0.3}" fill="${color}"/>`;
}

// ---- models ----

export interface BandLang {
	readonly name: string;
	readonly pct: number;
	readonly color: string;
}

export interface BandStats {
	readonly currentStreak: number | null;
	readonly longestStreak: number | null;
	readonly totalContributions: number | null;
	readonly contributedTo: number | null;
	/** "top X%" — lower is better (vendor calculateRank contract). */
	readonly rankLevel: string | null;
	readonly rankPercentile: number | null;
	readonly topLangs: readonly BandLang[] | null;
	/** All-time GitHub stats-card metrics (readme-stats fetchStats). */
	readonly totalStars: number | null;
	readonly totalCommits: number | null;
	readonly totalPRs: number | null;
	readonly totalIssues: number | null;
	/**
	 * Participated scope (Issue #1262, contract §2.1): repos the
	 * account contributed to but does not own, the stars those repos
	 * carry, and their language composition. `null` when the
	 * snapshot's participated aggregation was not measured — the
	 * surface hides the lane rather than printing a zero.
	 */
	readonly participatedRepos: number | null;
	readonly participatedStars: number | null;
	readonly participatedLangs: readonly BandLang[] | null;
	/**
	 * Owned + participated merged by language name (disjoint scopes,
	 * contract §2.1) — the "total development area" primary view for
	 * `/top-languages` (Issue #1262 review). `null` when neither
	 * scope was measured.
	 */
	readonly combinedLangs: readonly BandLang[] | null;
}

export interface Band1Model {
	readonly theme: 'dark' | 'light';
	readonly mobile: boolean;
	/** GitHub avatar as a `data:` URI, when the fetch succeeded. */
	readonly avatarDataUri: string | null;
	readonly presenceLabel: string;
	readonly presenceDetail: string | null;
	readonly presenceOk: boolean;
	readonly presenceObservedAt: string | null;
	readonly stats: BandStats;
	readonly generatedAt: string;
}

export interface BandRepoRow {
	readonly name: string;
	/** `null` = the Search API did not measure this repo — distinct
	 * from a measured zero, which renders an empty track. */
	readonly commits: number | null;
	readonly prs: number | null;
	readonly dim: boolean;
}

export interface BandEvent {
	readonly repoId: string;
	readonly type: string;
	readonly at: string;
}

export interface Band2Model {
	readonly theme: 'dark' | 'light';
	readonly mobile: boolean;
	readonly windowDays: number;
	/** False when no valid snapshot exists — the band says so instead
	 * of implying measured zero activity. */
	readonly snapshotAvailable: boolean;
	readonly sourceStatus: { readonly public: string; readonly private: string } | null;
	readonly totalCommits: number;
	readonly totalPrs: number;
	readonly repoCount: number;
	readonly rows: readonly BandRepoRow[];
	readonly feed72: readonly BandEvent[];
	readonly observedAt: string | null;
	/** The instant the 72h window ends — the snapshot's own observation
	 * time (or render `now` when no snapshot exists). The pulse strip
	 * buckets against this, never against wall-clock now. */
	readonly axisNowMs: number;
	readonly generatedAt: string;
}

// ---- shared helpers ----

interface LangSegment {
	readonly pct: number;
	readonly swatch: string;
	readonly other: boolean;
}

/** Top-3 named languages plus a single neutral "Other" remainder —
 * every colored slice stays labelled, and the bar always sums to
 * ~100% without silently dropping languages. */
function langSegments(langs: readonly BandLang[]): readonly LangSegment[] {
	const shown = langs.slice(0, 3);
	const shownPct = shown.reduce((a, l) => a + l.pct, 0);
	const otherPct = Math.max(0, 100 - shownPct);
	const segs: LangSegment[] = shown.map((l) => ({ pct: l.pct, swatch: l.color, other: false }));
	if (otherPct > 0.3) segs.push({ pct: otherPct, swatch: '#8b949e', other: true });
	return segs;
}

function countLabel(c: number): string {
	return c >= 1000 ? `${(c / 1000).toFixed(1)}k` : String(c);
}

// ---- Band 1 ----

/** Presence status → Discord client dot color (brand palette). */
function discordDotColor(model: Band1Model): string {
	if (!model.presenceOk) return '#80848e';
	return DISCORD_STATUS_COLOR[model.presenceLabel] ?? '#80848e';
}

/** Discord-idiom status badge: the avatar carries a background-ringed
 * status dot at its bottom-right corner — the same composition the
 * Discord client uses, so the state reads at a glance. The ring is
 * canvas-colored, which keeps the cutout crisp in both themes. */

/**
 * The only way this module draws type: a TYPE role from the shared
 * contract (`design.ts`) plus position/fill/anchor. Renderers never
 * pass a raw font-size — the 11px legibility floor is enforced here.
 */
export function bandText(
	spec: CanvasSpec,
	role: TypeName,
	x: number,
	y: number,
	fill: string,
	content: string,
	opts: {
		readonly anchor?: 'start' | 'end' | 'middle';
		readonly mono?: boolean;
		readonly ls?: number;
		readonly weight?: number;
	} = {},
): string {
	const r = typeTable(spec)[role];
	const fam = opts.mono || ('mono' in r && r.mono) ? MONO : FONT;
	return `<text x="${x}" y="${y}" text-anchor="${opts.anchor ?? 'start'}" font-family="${fam}" font-size="${r.size}" font-weight="${opts.weight ?? r.weight}" fill="${fill}" letter-spacing="${opts.ls ?? r.track}">${esc(content)}</text>`;
}

/**
 * Module head — the shared anatomy every band section uses: a
 * title-role label on the content axis, observation/meta on the
 * right edge. Sections separate by SPACE, never by stacked rules.
 */
function moduleHead(
	spec: CanvasSpec,
	x: number,
	y: number,
	label: string,
	right: string | null,
	T: Theme,
	/** right edge for the meta caption — defaults to the canvas margin;
	 * peer modules on a shared row pass their own right edge so the
	 * caption never claims the neighbour's column */
	rightEdge?: number,
): string {
	const TT = typeTable(spec);
	const ly = snap(spec, y + TT.title.lh - 4);
	let s = bandText(spec, 'title', x, ly, T.muted, label.toUpperCase());
	if (right) {
		s += bandText(spec, 'caption', rightEdge ?? spec.width - spec.margin, ly, T.faint, right, {
			anchor: 'end',
		});
	}
	return s;
}

const OWNER_NAME = 'rebuildup';
/** One-line role descriptor under the handle — the masthead's only
 * prose. Desktop carries the full claim set; the 400px canvas only
 * has ~300px beside the avatar, so mobile keeps the same three
 * domains in a shorter form ('tools'/'design' are implied by the
 * stack lanes directly below). */
const OWNER_TAGLINE = 'After Effects tools · Web apps · Motion design';
const OWNER_TAGLINE_MOBILE = 'After Effects · Web apps · Motion';

interface Metric {
	readonly icon: string;
	readonly swatch?: keyof typeof SEM | null;
	readonly label: string;
	readonly value: (st: BandStats) => number | null;
	readonly unit: string | null;
}

/**
 * One uniform strip of account figures — streak first (the figure a
 * profile is remembered by), then the GitHub all-time totals. Every
 * cell shares the same anatomy (icon + `stat` numeral + `label`
 * noun) so no metric shouts over its neighbours; all-time context
 * lives once in the strip's head caption, not repeated per cell.
 */
const METRICS: readonly Metric[] = [
	{
		icon: 'flame',
		swatch: 'orange',
		label: 'streak',
		value: (st) => st.currentStreak,
		unit: 'days',
	},
	{
		icon: 'trending-up',
		swatch: 'accent',
		label: 'contributions',
		value: (st) => st.totalContributions,
		unit: null,
	},
	{ icon: 'star', label: 'stars', value: (st) => st.totalStars, unit: null },
	{ icon: 'commit', label: 'commits', value: (st) => st.totalCommits, unit: null },
	{ icon: 'pr', label: 'PRs', value: (st) => st.totalPRs, unit: null },
	{ icon: 'issues', label: 'issues', value: (st) => st.totalIssues, unit: null },
];

/**
 * Participated scope (Issue #1262): repos contributed to but not
 * owned, and the stars they carry. `repos.participated` (measured
 * contribution evidence) and `metrics.contributedTo` (GraphQL
 * affiliation count) count the same population — real data agrees
 * (both 28) — so the lane shows the measured figure once, not two
 * near-identical numbers.
 */
const PARTICIPATED_METRICS: readonly Metric[] = [
	{
		icon: 'git-fork',
		label: 'projects',
		value: (st) => st.participatedRepos,
		unit: null,
	},
	{ icon: 'star', label: 'stars', value: (st) => st.participatedStars, unit: null },
];

/**
 * The metrics strip: equal cells on the column grid — icon +
 * `stat`-role numeral (+ unit tspan) on the first baseline, `label`
 * noun on the second. Unmeasured metrics render `—` and keep their
 * slot; the head's right caption carries the all-time context
 * (`longest streak`) exactly once.
 */
function metricStrip(
	spec: CanvasSpec,
	y: number,
	colStart: number,
	colCount: number,
	stats: BandStats,
	T: Theme,
	sem: (k: string) => string,
	opts: { metrics?: readonly Metric[]; caption?: string; muted?: boolean } = {},
): { svg: string; bottom: number } {
	const TT = typeTable(spec);
	const list = opts.metrics ?? METRICS;
	// Row plans snap to the column grid: 3 cells per row inside the
	// caller's column span (full width → 4-col spans, right rail →
	// 2-col spans). Every cell edge lands on a column boundary.
	const perRow = Math.min(3, list.length);
	const rowCount = Math.ceil(list.length / perRow);
	const rowPlan: readonly (readonly number[])[] = Array.from(
		{ length: rowCount },
		(_, r) => [r * perRow, r * perRow + 1, r * perRow + 2] as const,
	);
	// cell anatomy: stat baseline → label ~6px below the numeral's
	// foot, then a full s4 air gap before the next row's stat — the
	// pair must read as one unit, not label-to-next-value
	const rowH = TT.stat.lh + TT.label.lh + (spec.mobile ? SPACE.s2 : SPACE.s4);
	const span = colCount / perRow;
	let s = '';
	if (opts.caption) {
		s += bandText(spec, 'caption', gridX(spec, colStart), snap(spec, y - 8), T.faint, opts.caption);
	}
	let cy = y;
	for (const row of rowPlan) {
		let col = colStart;
		for (const mi of row) {
			const mt = list[mi];
			if (!mt) continue;
			const cx = gridX(spec, col);
			col += span;
			const v = mt.value(stats);
			const missing = v === null;
			const iconColor = missing ? T.faint : mt.swatch ? sem(mt.swatch) : T.muted;
			s += lucide(
				mt.icon,
				cx + ICON.sm / 2,
				iconCenterY(cy + TT.stat.size * 0.7, TT.stat.size),
				ICON.sm,
				iconColor,
			);
			const numX = cx + ICON.sm + SPACE.s2;
			const num = missing ? '—' : v.toLocaleString('en-US');
			const unitTxt = !missing && mt.unit ? ` ${mt.unit}` : '';
			const numFill = missing ? T.faint : opts.muted ? T.muted : T.fg;
			s += `<text x="${numX}" y="${cy + TT.stat.size * 0.7}" xml:space="preserve"><tspan font-size="${TT.stat.size}" font-weight="${TT.stat.weight}" fill="${numFill}">${esc(num)}</tspan><tspan font-size="${TT.label.size}" font-weight="${TT.label.weight}" fill="${T.muted}">${esc(unitTxt)}</tspan></text>`;
			s += bandText(spec, 'label', cx, snap(spec, cy + TT.stat.size * 0.7 + 16), T.muted, mt.label);
		}
		cy += rowH;
	}
	const rows = rowCount;
	// bottom hugs the last row's content — the s4 inter-row air gap
	// belongs BETWEEN rows only, never as trailing space before the
	// next module head
	return {
		svg: s,
		bottom: snap(spec, y + (rows - 1) * rowH + TT.stat.lh + TT.label.lh + SPACE.s2),
	};
}

/** Per-char advance estimate for flowing legend text — narrower than
 * textWidth's flat 0.56em for the glyphs that dominate these strings
 * (spaces, punctuation, digits), so gaps between leaders stay even. */
function flowWidth(text: string, fontSize: number): number {
	let width = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		const wide =
			(code >= 0x1100 && code <= 0x11ff) ||
			(code >= 0x2e80 && code <= 0xa4cf) ||
			(code >= 0xac00 && code <= 0xd7af) ||
			(code >= 0xf900 && code <= 0xfaff) ||
			(code >= 0xff00 && code <= 0xffef) ||
			(code >= 0x20000 && code <= 0x3fffd);
		if (wide) {
			width += fontSize;
		} else if (ch === ' ') {
			width += fontSize * 0.3;
		} else if (/[A-Z]/.test(ch)) {
			width += fontSize * 0.66;
		} else if (/[mwMW]/.test(ch)) {
			width += fontSize * 0.85;
		} else if (/[iljtf.,;:'|()[\]{}]/.test(ch)) {
			width += fontSize * 0.34;
		} else if (/[%+#&]/.test(ch)) {
			// wide punctuation — '%' especially is ~0.85em in the UI
			// sans; leaving it in the narrow class made legend items
			// drift together ('C++ 7.7%' → 'Other' gap collapsed)
			width += fontSize * 0.68;
		} else if (/[0-9]/.test(ch)) {
			width += fontSize * 0.56;
		} else {
			width += fontSize * 0.52;
		}
	}
	return width;
}

/** Language share bar: one pill track with hard-stop gradient
 * segments (crisp edges, rounded ends) + a legend that WRAPS inside
 * the bar's own width — every item keeps bar order, and a wrapped
 * second line still sits under the bar it explains. Returns the
 * fragment plus its bottom edge so callers space the next module. */
function langBar(
	spec: CanvasSpec,
	x: number,
	y: number,
	w: number,
	langs: readonly BandLang[],
	T: Theme,
): { svg: string; bottom: number } {
	const TT = typeTable(spec);
	const segs = langSegments(langs);
	const barY = y + 10;
	const barH = 10;
	const fs = TT.label.size;
	const gid = `langbar${x | 0}`;
	let stops = '';
	let acc = 0;
	for (const seg of segs) {
		const c1 = Math.min(1, acc / 100);
		const c2 = Math.min(1, (acc + seg.pct) / 100);
		stops += `<stop offset="${c1}" stop-color="${seg.swatch}"/><stop offset="${c2}" stop-color="${seg.swatch}"/>`;
		acc += seg.pct;
	}
	let s = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs>`;
	s += `<rect x="${x}" y="${barY}" width="${w}" height="${barH}" rx="${barH / 2}" fill="url(#${gid})"/>`;
	// leaders: every named language + the Other remainder, in bar order
	const leaders: { name: string; pct: number; swatch: string }[] = langs
		.slice(0, 3)
		.map((l) => ({ name: l.name, pct: l.pct, swatch: l.color }));
	const namedPct = leaders.reduce((a, l) => a + l.pct, 0);
	const otherPct = 100 - namedPct;
	if (segs.some((g) => g.other) && otherPct > 0.3) {
		leaders.push({ name: 'Other', pct: otherPct, swatch: '#8b949e' });
	}
	let lx = x;
	let ly2 = barY + barH + 15;
	for (const l of leaders) {
		const txt = `${l.name} ${l.pct.toFixed(1)}%`;
		const itemW = 10 + flowWidth(txt, fs) + 14;
		if (lx > x && lx + itemW > x + w) {
			lx = x;
			// wrapped legend rows need more air than the first row's
			// bar gap — 16px baseline step on 13px type left only ~3px
			// between the row above's descenders and this row's caps
			ly2 += TT.label.lh + 1;
		}
		s += `<rect x="${lx}" y="${ly2 - fs * 0.72}" width="7" height="7" fill="${l.swatch}"/>`;
		s += bandText(spec, 'label', lx + 11, ly2, T.muted, txt);
		lx += itemW;
	}
	return { svg: s, bottom: snap(spec, ly2 + 8) };
}

/**
 * Discord presence as a two-line cluster — the Clyde mark + status
 * word in the client status color + muted detail on the first
 * baseline, one honest sync stamp on the second. There is exactly
 * ONE avatar in the whole composition: it sits in the masthead and
 * carries the Discord-idiom status dot, so badge and cluster read
 * as a single presence signal (the previous separate card repeated
 * the same portrait and split the hierarchy).
 */
function presenceCluster(
	spec: CanvasSpec,
	x: number,
	y1: number,
	y2: number,
	availW: number,
	model: Band1Model,
	T: Theme,
	/** right edge the whole cluster must end on — desktop passes the
	 * margin edge so the block sits flush with the spine instead of
	 * floating at its rail start. */
	endX?: number,
): string {
	const TT = typeTable(spec);
	const statusColor = model.presenceOk ? discordDotColor(model) : T.faint;
	const detail = model.presenceDetail;
	const detailTxt = detail
		? ` · ${truncate(detail, Math.max(40, availW - 140), TT.label.size)}`
		: '';
	const stamp = model.presenceObservedAt
		? `last synced ${observedJst(model.presenceObservedAt)}`
		: 'never synced';
	let s: string;
	if (endX !== undefined) {
		// right-anchored cluster: both text lines end flush on the
		// spine, the Clyde mark sits just left of the status run —
		// no ragged left edge, no measured-width drift on the right
		const w1 =
			(flowWidth(model.presenceLabel, TT.strong.size) + flowWidth(detailTxt, TT.label.size)) * 1.05;
		const glyphX = endX - w1 - 4 - 14;
		s = `<svg x="${glyphX}" y="${y1 - 13}" width="14" height="14" viewBox="0 0 24 24">${DISCORD_LOGO.replace('/>', ` fill="${T.discord}"/>`)}</svg>`;
		s += `<text x="${endX}" y="${y1}" text-anchor="end" xml:space="preserve"><tspan font-size="${TT.strong.size}" font-weight="${TT.strong.weight}" fill="${statusColor}">${esc(model.presenceLabel)}</tspan><tspan font-size="${TT.label.size}" fill="${T.muted}">${esc(detailTxt)}</tspan></text>`;
		s += bandText(spec, 'caption', endX, y2, T.faint, stamp, { anchor: 'end' });
		return s;
	}
	s = `<svg x="${x}" y="${y1 - 13}" width="14" height="14" viewBox="0 0 24 24">${DISCORD_LOGO.replace('/>', ` fill="${T.discord}"/>`)}</svg>`;
	const tx = x + 19;
	s += `<text x="${tx}" y="${y1}" xml:space="preserve"><tspan font-size="${TT.strong.size}" font-weight="${TT.strong.weight}" fill="${statusColor}">${esc(model.presenceLabel)}</tspan><tspan font-size="${TT.label.size}" fill="${T.muted}">${esc(detailTxt)}</tspan></text>`;
	s += bandText(spec, 'caption', tx, y2, T.faint, stamp);
	return s;
}

/**
 * Identity section as a reusable fragment — the masthead (one
 * avatar carrying the Discord status dot, handle, tagline, presence
 * cluster on the left rail; the unlabeled vitals grid on the right
 * rail, desktop) and the TOP LANGUAGES bar. `y0` is the section's
 * top edge; `bottom` is the last content baseline region — callers
 * own inter-section spacing.
 */
function drawIdentityDesktop(model: Band1Model, y0: number): { svg: string; bottom: number } {
	const spec = canvasSpec(false);
	const { T, sem } = skinFor(model.theme);
	const TT = typeTable(spec);
	const m = spec.margin;
	let s = '';

	// Two-column masthead (contract §22): LEFT rail cols 0–5
	// carries the person — avatar, name, tagline, Discord presence as
	// one vertical identity stack. RIGHT rail cols 6–11 carries the
	// account state — the vitals grid, unlabeled (icons + numerals
	// are self-evident; the VITALS head was text the data didn't
	// need). TOP LANGUAGES closes the zone full-width, also
	// unlabeled — the bar and its legend explain themselves.
	const as = 72;
	const ax = m;
	const ay = y0;
	if (model.avatarDataUri) {
		s += `<clipPath id="b1av"><rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="18"/></clipPath>`;
		s += `<image href="${model.avatarDataUri}" x="${ax}" y="${ay}" width="${as}" height="${as}" preserveAspectRatio="xMidYMid slice" clip-path="url(#b1av)"/>`;
		s += `<rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="18" fill="none" stroke="${T.line}"/>`;
	} else {
		// No portrait fetched: a neutral rounded tile, never a letter
		// stand-in and never a second glyph pretending to be a face.
		s += `<rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="18" fill="${T.panel2}" stroke="${T.line}"/>`;
	}
	// Discord client idiom: canvas-coloured cutout ring, then the
	// status fill (hollow grey ring when offline / unknown)
	const dotX = ax + as - 2;
	const dotY = ay + as - 2;
	s += `<circle cx="${dotX}" cy="${dotY}" r="13" fill="${T.bg}"/>`;
	if (model.presenceOk) {
		s += `<circle cx="${dotX}" cy="${dotY}" r="8.5" fill="${discordDotColor(model)}"/>`;
	} else {
		s += `<circle cx="${dotX}" cy="${dotY}" r="8.5" fill="none" stroke="#80848e" stroke-width="2"/>`;
	}
	// name lockup — fixed gap from the avatar reads as one block
	const nx = ax + as + SPACE.s4;
	const nameY = snap(spec, ay + as / 2 + TT.hero.size * 0.34);
	s += bandText(spec, 'hero', nx, nameY, T.fg, OWNER_NAME);
	// role descriptor — the masthead's one prose line, on the body
	// role so a first-time viewer learns what the handle makes
	s += bandText(spec, 'body', nx, snap(spec, nameY + 18), T.muted, OWNER_TAGLINE);
	// Discord presence directly under the tagline — avatar dot and
	// status text now share ONE left rail, so the service identity
	// (Clyde mark + status word + sync stamp) reads as a single
	// cluster instead of a cluster exiled to the far edge
	const pY1 = snap(spec, nameY + 18 + TT.body.lh + SPACE.s2);
	const railRight = gridX(spec, 6) - spec.gutter;
	s += presenceCluster(spec, nx, pY1, snap(spec, pY1 + 16), railRight - nx, model, T);

	// VITALS — unlabeled state grid on the right rail (cols 6–11),
	// top-aligned with the avatar so the two rails share one top edge
	const vit = metricStrip(spec, y0 + SPACE.s2, 6, 6, model.stats, T, sem);
	s += vit.svg;

	// TOP LANGUAGES — share bar + wrapped legend, full width below
	// both rails; unlabeled per the contract's state-zone rule
	const ly = snap(spec, Math.max(vit.bottom, snap(spec, pY1 + 16) + SPACE.s2) + SPACE.s6);
	const langs = model.stats.topLangs;
	let bottom: number;
	if (!langs || langs.length === 0) {
		s += bandText(spec, 'body', m, snap(spec, ly + 20), T.faint, 'language data unavailable');
		bottom = snap(spec, ly + 36);
	} else {
		const barTop = ly + 10;
		const bar = langBar(spec, m, barTop, contentWidth(spec), langs, T);
		s += bar.svg;
		bottom = bar.bottom;
	}
	return { svg: s, bottom: snap(spec, bottom + SPACE.s4) };
}

function drawIdentityMobile(model: Band1Model, y0: number): { svg: string; bottom: number } {
	const spec = canvasSpec(true);
	const { T, sem } = skinFor(model.theme);
	const TT = typeTable(spec);
	const m = spec.margin;
	let s = '';

	// masthead — compact avatar + name; the tagline lives in the
	// README intro line
	const as = 56;
	const ax = m;
	const ay = y0;
	if (model.avatarDataUri) {
		s += `<clipPath id="b1mav"><rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="14"/></clipPath>`;
		s += `<image href="${model.avatarDataUri}" x="${ax}" y="${ay}" width="${as}" height="${as}" preserveAspectRatio="xMidYMid slice" clip-path="url(#b1mav)"/>`;
		s += `<rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="14" fill="none" stroke="${T.line}"/>`;
	} else {
		s += `<rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="14" fill="${T.panel2}" stroke="${T.line}"/>`;
	}
	const dotX = ax + as - 2;
	const dotY = ay + as - 2;
	s += `<circle cx="${dotX}" cy="${dotY}" r="11" fill="${T.bg}"/>`;
	if (model.presenceOk) {
		s += `<circle cx="${dotX}" cy="${dotY}" r="7" fill="${discordDotColor(model)}"/>`;
	} else {
		s += `<circle cx="${dotX}" cy="${dotY}" r="7" fill="none" stroke="#80848e" stroke-width="1.8"/>`;
	}
	// s4 gap: the status ring's outer edge reaches ~9px past the
	// avatar's right side — s2 left the bio's first glyph ~3px clear
	const nx = ax + as + SPACE.s4;
	const nameY = snap(spec, ay + as / 2 + TT.hero.size * 0.34);
	s += bandText(spec, 'hero', nx, nameY, T.fg, OWNER_NAME);
	// role descriptor beside the avatar — label role keeps it inside
	// the ~300px that remains on the row
	s += bandText(spec, 'label', nx, snap(spec, nameY + 16), T.muted, OWNER_TAGLINE_MOBILE);
	// presence cluster — full content width under the masthead row,
	// cleared below the avatar's status dot (dot bottom ≈ ay+as+9)
	const clusterY = snap(spec, ay + as + SPACE.s6 + SPACE.s1);
	s += presenceCluster(spec, m, clusterY, clusterY + 16, contentWidth(spec), model, T);

	// state zone — unlabeled per contract §22: the 3+3 vitals grid and
	// the language bar explain themselves through icons and shape
	const y = snap(spec, clusterY + 16 + SPACE.s4);
	const strip = metricStrip(spec, y, 0, spec.columns, model.stats, T, sem);
	s += strip.svg;

	// the vitals→bar air is tighter than desktop's s4+s10: the removed
	// module heads left a ghost gap here, and the bar+legend pair
	// still needs its own breathing room before the section break
	const ly = snap(spec, strip.bottom + SPACE.s1);
	const langs = model.stats.topLangs;
	let bottom: number;
	if (!langs || langs.length === 0) {
		s += bandText(spec, 'body', m, snap(spec, ly + 20), T.faint, 'language data unavailable');
		bottom = snap(spec, ly + 36);
	} else {
		const barTop = ly + 6;
		const bar = langBar(spec, m, barTop, contentWidth(spec), langs, T);
		s += bar.svg;
		bottom = bar.bottom;
	}
	return { svg: s, bottom: snap(spec, bottom + SPACE.s4) };
}

/** Identity section — dispatches on the model's canvas. */
export function drawIdentitySection(
	model: Band1Model,
	y0: number,
): { svg: string; bottom: number } {
	return model.mobile ? drawIdentityMobile(model, y0) : drawIdentityDesktop(model, y0);
}

export function renderBand1Svg(model: Band1Model, opts: { grid?: boolean } = {}): string {
	const spec = canvasSpec(model.mobile);
	const { T } = skinFor(model.theme);
	const sec = drawIdentitySection(model, SPACE.s6);
	const H = snap(spec, sec.bottom + SPACE.s4) + (opts.grid && model.mobile ? 28 : 0);
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${H}" viewBox="0 0 ${spec.width} ${H}" font-family="${FONT}">`;
	svg += `<rect width="${spec.width}" height="${H}" fill="${T.bg}"/>`;
	svg += sec.svg;
	if (opts.grid) svg += gridOverlay(spec, H);
	svg += '</svg>';
	return svg;
}

// ---- Standalone data-source surfaces (Issue #1244) ----
//
// The contract's per-domain surfaces: each renders ONE snapshot's
// worth of data on its own canvas so cache freshness, failure
// isolation and payload size follow the data boundary — a stale
// streak never stalls the language bar, and the README (or any
// consumer) can compose them independently. `/profile` stays the
// compat composition of the same models.

export interface StatsSurfaceModel {
	readonly theme: 'dark' | 'light';
	readonly mobile: boolean;
	readonly stats: BandStats;
}

function statsSurfaceShell(
	model: StatsSurfaceModel,
	body: string,
	bottom: number,
	opts: { grid?: boolean },
): string {
	const spec = canvasSpec(model.mobile);
	const { T } = skinFor(model.theme);
	const H = snap(spec, bottom + SPACE.s4) + (opts.grid && model.mobile ? 28 : 0);
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${H}" viewBox="0 0 ${spec.width} ${H}" font-family="${FONT}">`;
	svg += `<rect width="${spec.width}" height="${H}" fill="${T.bg}"/>`;
	svg += body;
	if (opts.grid) svg += gridOverlay(spec, H);
	svg += '</svg>';
	return svg;
}

/** VITALS — the account-figures strip alone (github_stats_snapshot). */
export function renderVitalsSvg(model: StatsSurfaceModel, opts: { grid?: boolean } = {}): string {
	const spec = canvasSpec(model.mobile);
	const { T, sem } = skinFor(model.theme);
	const strip = metricStrip(spec, SPACE.s6, 0, spec.columns, model.stats, T, sem);
	let body = strip.svg;
	let bottom = strip.bottom;
	// Participated lane (Issue #1262): shown only when the snapshot
	// measured the scope — an absent aggregation hides the lane
	// instead of printing a row of dashes that reads as "no
	// participation". Muted numerals + the scope caption keep it
	// visually subordinate to the account figures.
	const st = model.stats;
	const hasParticipated = st.participatedRepos !== null || st.participatedStars !== null;
	if (hasParticipated) {
		const laneY = bottom + SPACE.s4 + 14;
		const lane = metricStrip(spec, laneY, 0, spec.columns, st, T, sem, {
			metrics: PARTICIPATED_METRICS,
			caption: 'PARTICIPATED — repos contributed to, not owned',
			muted: true,
		});
		body += lane.svg;
		bottom = lane.bottom;
	}
	return statsSurfaceShell(model, body, bottom, opts);
}

/** Scope caption above one language bar — the two scopes measure
 * different populations (owned repos vs repos contributed to), so
 * each bar names its scope instead of implying one blended mix. */
function scopeCaption(spec: CanvasSpec, x: number, y: number, T: Theme, label: string): string {
	return bandText(spec, 'caption', x, snap(spec, y), T.faint, label);
}

/** TOP LANGUAGES — repo language composition (bytes) per scope
 * (github_stats_snapshot). When both scopes are measured the surface
 * leads with the COMBINED mix (the total development area) and shows
 * the owned/participated split as a subordinate pair — on desktop
 * the pair sits side by side so the comparison reads at a glance;
 * on mobile they stack. Never the owner's personal change volume —
 * the captions keep that meaning explicit (contract §3.2). */
export function renderTopLangsSvg(model: StatsSurfaceModel, opts: { grid?: boolean } = {}): string {
	const spec = canvasSpec(model.mobile);
	const { T } = skinFor(model.theme);
	const m = spec.margin;
	const w = contentWidth(spec);
	const y = SPACE.s6;
	const langs = model.stats.topLangs;
	const participated = model.stats.participatedLangs;
	const combined = model.stats.combinedLangs;
	const bothScopes =
		langs !== null && langs.length > 0 && participated !== null && participated.length > 0;
	let s = '';
	let bottom: number;
	if ((!langs || langs.length === 0) && (!participated || participated.length === 0)) {
		s += bandText(spec, 'body', m, snap(spec, y + 20), T.faint, 'language data unavailable');
		bottom = snap(spec, y + 36);
	} else if (bothScopes && combined && combined.length > 0) {
		s += scopeCaption(spec, m, y, T, 'ALL — OWNED + PARTICIPATED');
		const hero = langBar(spec, m, y + 14, w, combined, T);
		s += hero.svg;
		bottom = hero.bottom;
		// scope pair: side-by-side on desktop, stacked on mobile
		let pairY = bottom + SPACE.s4 + 6;
		if (spec.mobile) {
			for (const [label, scopeLangs] of [
				['OWNED REPOS', langs],
				['PARTICIPATED REPOS', participated],
			] as const) {
				s += scopeCaption(spec, m, pairY, T, label);
				const bar = langBar(spec, m, pairY + 14, w, scopeLangs, T);
				s += bar.svg;
				bottom = bar.bottom;
				pairY = bar.bottom + SPACE.s4 + 6;
			}
		} else {
			const gap = spec.gutter;
			const half = (w - gap) / 2;
			s += scopeCaption(spec, m, pairY, T, 'OWNED REPOS');
			s += scopeCaption(spec, m + half + gap, pairY, T, 'PARTICIPATED REPOS');
			const ownedBar = langBar(spec, m, pairY + 14, half, langs, T);
			const partBar = langBar(spec, m + half + gap, pairY + 14, half, participated, T);
			s += ownedBar.svg + partBar.svg;
			bottom = Math.max(ownedBar.bottom, partBar.bottom);
		}
	} else {
		const ownedOnly = langs !== null && langs.length > 0;
		const only = ownedOnly ? langs : (participated ?? []);
		const label = ownedOnly ? 'OWNED REPOS' : 'PARTICIPATED REPOS';
		s += scopeCaption(spec, m, y, T, label);
		const bar = langBar(spec, m, y + 14, w, only, T);
		s += bar.svg;
		bottom = bar.bottom;
	}
	return statsSurfaceShell(model, s, bottom, opts);
}

// ---- Band 2 ----

/** Feed verb → past-tense display word. */
const EVENT_VERB: Record<string, string> = {
	PushEvent: 'pushed',
	PullRequestEvent: 'PR',
	CreateEvent: 'created',
	DeleteEvent: 'deleted',
};

/** Feed verb → plural noun for collapsed runs ('2 pushes'). */
const EVENT_NOUN: Record<string, string> = {
	PushEvent: 'pushes',
	PullRequestEvent: 'PRs',
	CreateEvent: 'creates',
	DeleteEvent: 'deletes',
};

/** Absolute JST stamp for one event — a static SVG must never print
 * relative ages that silently rot after the observation instant. */
function jstDayKey(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(d);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}`;
}

function eventStamp(at: string): string {
	// absolute stamp with date — 'Nov 24 02:46'. A bare '02:46' reads
	// as a duration; the date makes every event unambiguously placed.
	// Still absolute — a static SVG never prints relative ages.
	if (!at) return 'unknown time';
	return observedJst(at).replace(' JST', '').replace(' · ', ' ');
}

/** Recent public activity as a compact notification-style list —
 * repo · verb glyph · verb · absolute JST stamp, all inline so the
 * eye never crosses a blank chasm. Consecutive same-repo/same-type
 * events collapse into one row ('2 pushes'). Honest about the
 * window and never invents a timeline the data doesn't support. */
function renderRecentActivity(
	spec: CanvasSpec,
	x: number,
	y: number,
	w: number,
	model: Band2Model,
	T: Theme,
	compact: boolean,
): { svg: string; bottom: number } {
	const TT = typeTable(spec);
	const { typeColor } = skinFor(model.theme);
	let s = '';
	if (model.feed72.length === 0) {
		s += bandText(spec, 'body', x, snap(spec, y + 20), T.faint, 'no public events in the last 72h');
		return { svg: s, bottom: snap(spec, y + 32) };
	}
	// collapse consecutive runs of the same repo + event type
	const runs: { repo: string; type: string; at: string; count: number }[] = [];
	for (const e of model.feed72) {
		const repo = e.repoId.replace(/^rebuildup\//, '');
		const last = runs[runs.length - 1];
		if (last && last.repo === repo && last.type === e.type) {
			last.count += 1;
		} else {
			runs.push({ repo, type: e.type, at: e.at, count: 1 });
		}
	}
	// mobile shows one fewer ledger row — the pulse above already
	// carries the window's shape, and '+N more' keeps the count honest
	const maxRows = compact ? (spec.mobile ? 3 : 4) : 6;
	const rowH = 22;
	const shown = runs.slice(0, maxRows);
	const firstBaseline = snap(spec, y + 24);
	// one column on every canvas — a second packed column was the
	// source of the desktop collisions; the stamp gets its own
	// right-aligned column so repo names truncate instead of pushing
	// the timestamp off the canvas edge
	const stampW = 104;
	shown.forEach((r, i) => {
		const ry = firstBaseline + i * rowH;
		s += eventGlyph(r.type, x + 6, iconCenterY(ry, TT.data.size), ICON.sm - 2, typeColor(r.type));
		const verb =
			r.count > 1 ? `${r.count} ${EVENT_NOUN[r.type] ?? r.type}` : (EVENT_VERB[r.type] ?? r.type);
		// repo owns the strong role — events are the band's readable
		// payload, so nothing here sits below the legibility floor
		const verbTxt = ` · ${verb}`;
		const verbW = flowWidth(verbTxt, TT.label.size);
		const repo = truncate(r.repo, w - stampW - 24 - verbW - 8, TT.strong.size);
		s += `<text x="${x + 20}" y="${ry}" xml:space="preserve"><tspan font-family="${FONT}" font-size="${TT.strong.size}" font-weight="${TT.strong.weight}" fill="${T.fg}">${esc(repo)}</tspan><tspan font-family="${FONT}" font-size="${TT.label.size}" fill="${T.muted}">${esc(verbTxt)}</tspan></text>`;
		s += bandText(spec, 'caption', x + w, ry, T.faint, eventStamp(r.at), {
			anchor: 'end',
			mono: true,
		});
	});
	const shownEvents = shown.reduce((a, r) => a + r.count, 0);
	const remaining = model.feed72.length - shownEvents;
	const lastBaseline = firstBaseline + (shown.length - 1) * rowH;
	if (remaining > 0) {
		s += bandText(spec, 'caption', x, lastBaseline + rowH, T.faint, `+${remaining} more`);
	}
	return {
		svg: s,
		bottom: snap(spec, lastBaseline + (remaining > 0 ? rowH : 0) + SPACE.s4),
	};
}

/** Aggregate rows (`dim`) — rollup buckets rendered as quiet caption
 * lines on the same columns as the named rows, never sharing the
 * named-repo bar scale. */
function dimRows(rows: readonly BandRepoRow[]): readonly BandRepoRow[] {
	return rows.filter((r) => r.dim);
}

/** Tallest single-hour bucket in the 72h window — the pulse caption
 * quotes it so spike height is never a guessing game. */
function pulsePeak(model: Band2Model): number {
	const counts = new Array<number>(72).fill(0);
	for (const e of model.feed72) {
		const h = Math.floor((model.axisNowMs - Date.parse(e.at)) / 3600e3);
		const hh = Math.min(71, Math.max(0, h));
		counts[71 - hh] += 1;
	}
	return Math.max(0, ...counts);
}

/**
 * 72-hour activity pulse — a GitHub-pulse-style histogram bucketed
 * per hour against the snapshot's own observation instant (never
 * render-now). Buckets carrying a PR event tint purple; everything
 * else accent. Zero hours draw nothing — the baseline alone shows
 * the window, so silence reads as silence.
 */
function renderPulse72(
	spec: CanvasSpec,
	x: number,
	y: number,
	w: number,
	model: Band2Model,
	T: Theme,
	sem: (k: string) => string,
): { svg: string; bottom: number; peak: number } {
	// mobile re-grid runs the strip 8px shorter — the 72h window is
	// already narrow on 400px and the saved row feeds the events list
	const stripH = spec.mobile ? 48 : 56;
	const stripTop = snap(spec, y + 22);
	const baselineY = stripTop + stripH;
	const counts = new Array<number>(72).fill(0);
	const hasPR = new Array<boolean>(72).fill(false);
	for (const e of model.feed72) {
		const h = Math.floor((model.axisNowMs - Date.parse(e.at)) / 3600e3);
		// left edge = 72h ago, right edge = observed now: bucket index
		// counts BACK from the right edge so recent activity lands on
		// the "observed" side
		const hh = Math.min(71, Math.max(0, h));
		const idx = 71 - hh;
		counts[idx] += 1;
		if (e.type.includes('PullRequest')) hasPR[idx] = true;
	}
	const peak = Math.max(0, ...counts);
	const pitch = w / 72;
	const barW = Math.min(10, pitch * 0.8);
	let s = `<line x1="${x}" y1="${baselineY}" x2="${x + w}" y2="${baselineY}" stroke="${T.line}"/>`;
	// whisper guide at the peak bar top — the caption quotes the value,
	// the line gives the height a referent
	if (peak > 0) {
		const peakY = baselineY - Math.min(stripH - 6, 6 + peak * 6);
		s += `<line x1="${x}" y1="${peakY.toFixed(1)}" x2="${x + w}" y2="${peakY.toFixed(1)}" stroke="${T.faint}" stroke-dasharray="2 5" opacity="0.5"/>`;
	}
	// JST day boundaries inside the window — faint ticks so quiet
	// stretches read as dated silence, not a broken chart
	const winStart = model.axisNowMs - 72 * 3600e3;
	const seen = new Set<number>();
	for (let k = 0; k <= 3; k++) {
		const probe = winStart + k * 24 * 3600e3;
		const key = jstDayKey(new Date(probe).toISOString());
		const [yy, mm, dd] = key.split('-').map(Number);
		const midnightJst = Date.UTC(yy, mm - 1, dd) - 9 * 3600e3;
		if (midnightJst <= winStart || midnightJst >= model.axisNowMs || seen.has(midnightJst)) {
			continue;
		}
		seen.add(midnightJst);
		const frac = (model.axisNowMs - midnightJst) / (72 * 3600e3);
		const tx = x + w * (1 - frac);
		// suppress tick AND label inside an endpoint label's
		// footprint — an unlabelled midnight tick sitting on top of
		// '09:00 JST' reads as marking the wrong hour
		if (tx - x < 96 || x + w - tx < 92) continue;
		// ticks hang BELOW the axis rule — inside the plot they read
		// as 1-event bars competing with real data
		s += `<line x1="${tx.toFixed(1)}" y1="${baselineY}" x2="${tx.toFixed(1)}" y2="${baselineY + 5}" stroke="${T.faint}" opacity="0.55"/>`;
		const label = new Intl.DateTimeFormat('en-US', {
			timeZone: 'Asia/Tokyo',
			month: 'short',
			day: 'numeric',
		}).format(new Date(midnightJst));
		s += bandText(spec, 'caption', tx, snap(spec, baselineY + 17), T.faint, label, {
			anchor: 'middle',
		});
	}
	counts.forEach((c, i) => {
		if (c === 0) return;
		const bh = Math.min(stripH - 8, 8 + c * 7);
		const bx = x + i * pitch + (pitch - barW) / 2;
		const col = hasPR[i] ? sem('purple') : sem('accent');
		// one solid bar per hour — the earlier two-tone stem/cap read
		// as a stacked or range encoding, not a single count
		s += `<rect x="${bx.toFixed(1)}" y="${(baselineY - bh).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${col}" opacity="0.9"/>`;
	});
	s += bandText(spec, 'caption', x, snap(spec, baselineY + 17), T.faint, '72h ago');
	// the header already carries the full observed stamp — the axis
	// endpoint only needs the clock time
	const rightStamp = model.observedAt
		? (observedJst(model.observedAt).split(' · ')[1] ?? 'observed')
		: 'observed';
	s += bandText(spec, 'caption', x + w, snap(spec, baselineY + 17), T.faint, rightStamp, {
		anchor: 'end',
	});
	return { svg: s, bottom: snap(spec, baselineY + 22), peak };
}

/**
 * Repo output as a real table: named repos own fixed grid columns —
 * name, proportional 30-day commit bar, exact commit count, PR
 * glyph + count — with the units carried once by the column headers
 * instead of repeated inside every cell. Unmeasured counts render
 * `—`, never a fake zero.
 */
/**
 * PR count cell — the licensed `pr` glyph carries the unit so the
 * number never needs a 'PRs' label repeated per row. Right-aligned
 * at the column edge; unmeasured renders `—` with no glyph (an
 * absent upstream is not a zero).
 */
function prCount(
	spec: CanvasSpec,
	right: number,
	ry: number,
	prs: number | null,
	TT: ReturnType<typeof typeTable>,
	T: Theme,
	/** aggregate rows dim the WHOLE cell — a muted label beside a
	 * full-contrast count made rollups shout louder than named repos */
	dim = false,
): string {
	const numFill = dim ? T.faint : T.fg;
	if (prs === null) {
		return bandText(spec, 'data', right, ry, T.faint, '—', { anchor: 'end', mono: true });
	}
	const num = countLabel(prs);
	// conservative advance for the glyph offset — mono digits run
	// ~0.6em; overshooting left only widens the gap, never overlaps
	const numW = num.length * TT.data.size * 0.62;
	const glyphX = right - numW - 4 - 11;
	let s = lucide('pr', glyphX + 5.5, iconCenterY(ry, TT.data.size), 11, T.faint);
	s += bandText(spec, 'data', right, ry, numFill, num, { anchor: 'end', mono: true });
	return s;
}

/** Commit count cell — the `commit` glyph carries the unit exactly
 * like the PR glyph does, so neither count needs a repeated label. */
function commitCount(
	spec: CanvasSpec,
	right: number,
	ry: number,
	commits: number | null,
	TT: ReturnType<typeof typeTable>,
	T: Theme,
	dim = false,
): string {
	const numFill = dim ? T.faint : T.fg;
	if (commits === null) {
		return bandText(spec, 'data', right, ry, T.faint, '—', { anchor: 'end', mono: true });
	}
	const num = countLabel(commits);
	const numW = num.length * TT.data.size * 0.62;
	const glyphX = right - numW - 4 - 11;
	let s = lucide('commit', glyphX + 5.5, iconCenterY(ry, TT.data.size), 11, T.faint);
	s += bandText(spec, 'data', right, ry, numFill, num, { anchor: 'end', mono: true });
	return s;
}

function renderRepoTable(
	spec: CanvasSpec,
	x: number,
	y: number,
	w: number,
	model: Band2Model,
	T: Theme,
	sem: (k: string) => string,
	compact: boolean,
): { svg: string; bottom: number } {
	const TT = typeTable(spec);
	const named = model.rows.filter((r) => !r.dim);
	// one shared scale across named AND aggregate rows — a private
	// rollup that exceeds the biggest named repo still fits the bar
	const maxC = Math.max(
		1,
		...model.rows.filter((r) => r.commits !== null).map((r) => r.commits ?? 0),
	);
	// column right edges: desktop snaps to the grid — commits end at
	// the column-10 edge so the two count columns sit one gutter
	// apart instead of leaving an empty column between them; mobile
	// snaps commits to the column-4 edge for the same reason
	const commitsRight = compact ? gridRight(spec, 4, 1) : gridRight(spec, 10, 1);
	const prsRight = spec.width - spec.margin;
	const barX = gridX(spec, 3);
	// the longest bar lands exactly on the column-9 right edge —
	// bars are grid furniture, not free-floating marks
	const barZoneW = gridRight(spec, 9, 1) - barX;
	const rowH = compact ? 36 : 24;
	let s = '';
	// no column-header row — the units live once in the Total/legend
	// line below, so bare counts never repeat 'commits'/'PRs' per row
	let ry = snap(spec, y + (compact ? 18 : 20));

	const nameW = compact ? commitsRight - x - 8 : 160;
	for (const r of named) {
		if (compact) {
			// two-line mobile row: name + counts, bar underneath —
			// commits and PRs share the table's right-edge columns
			s += `<text x="${x}" y="${ry}" font-family="${FONT}" font-size="${TT.data.size}" font-weight="600" fill="${T.fg}">${esc(truncate(r.name, nameW, TT.data.size))}</text>`;
			s += commitCount(spec, commitsRight, ry, r.commits, TT, T);
			s += prCount(spec, prsRight, ry, r.prs, TT, T);
			if (r.commits !== null) {
				// meter zone runs name-edge -> commits column edge with a
				// whisper track so the bar reads as a meter, not a divider;
				// it ends flush on the commits column it encodes
				const zoneW = commitsRight - x;
				s += `<rect x="${x}" y="${ry + 8}" width="${zoneW}" height="5" rx="2.5" fill="${T.line}" opacity="0.4"/>`;
				if ((r.commits ?? 0) > 0) {
					const bw = zoneW * ((r.commits ?? 0) / maxC);
					s += `<rect x="${x}" y="${ry + 8}" width="${Math.max(3, bw)}" height="5" rx="2.5" fill="${sem('accent')}" opacity="0.9"/>`;
				}
			}
			ry += rowH;
			continue;
		}
		s += `<text x="${x}" y="${ry}" font-family="${FONT}" font-size="${TT.data.size}" font-weight="600" fill="${T.fg}">${esc(truncate(r.name, nameW, TT.data.size))}</text>`;
		if (r.commits !== null) {
			s += `<rect x="${barX}" y="${ry - 11}" width="${barZoneW}" height="8" rx="4" fill="${T.line}" opacity="0.35"/>`;
			if ((r.commits ?? 0) > 0) {
				const bw = barZoneW * ((r.commits ?? 0) / maxC);
				s += `<rect x="${barX}" y="${ry - 11}" width="${Math.max(3, bw)}" height="8" rx="4" fill="${sem('accent')}"/>`;
			}
		}
		s += commitCount(spec, commitsRight, ry, r.commits, TT, T);
		s += prCount(spec, prsRight, ry, r.prs, TT, T);
		ry += rowH;
	}

	// aggregate buckets on the same columns and the SAME bar scale —
	// muted, so a rollup never competes with a named repo. On the
	// mobile re-grid each bucket collapses to ONE caption line (no
	// bar): the named rows already carry the meter metaphor, and two
	// stacked rollup rows pushed RECENT EVENTS a full screen down.
	let ay = ry + (compact ? 8 : 8);
	for (const d of dimRows(model.rows)) {
		if (!compact && d.commits !== null) {
			const zoneW = barZoneW;
			const bx = barX;
			const by = ay - 8;
			const bh = 6;
			s += `<rect x="${bx}" y="${by}" width="${zoneW}" height="${bh}" rx="${bh / 2}" fill="${T.line}" opacity="0.25"/>`;
			if ((d.commits ?? 0) > 0) {
				s += `<rect x="${bx}" y="${by}" width="${Math.max(3, zoneW * ((d.commits ?? 0) / maxC))}" height="${bh}" rx="${bh / 2}" fill="${sem('accent')}" opacity="0.45"/>`;
			}
		}
		s += bandText(spec, 'caption', x, ay, T.faint, truncate(d.name, nameW, TT.caption.size));
		s += commitCount(spec, commitsRight, ay, d.commits, TT, T, true);
		s += prCount(spec, prsRight, ay, d.prs, TT, T, true);
		ay += compact ? 18 : 20;
	}

	let bottom = ay;
	if (model.repoCount > 0) {
		// clear the last aggregate row before the total line's baseline —
		// mobile keeps a tighter step than desktop's module air
		bottom = snap(spec, ay + (compact ? 16 : 14));
		s += bandText(
			spec,
			'strong',
			x,
			bottom,
			T.muted,
			`Total — ${countLabel(model.totalCommits)} commits · ${countLabel(model.totalPrs)} PRs · ${model.repoCount} active repos`,
		);
		const hasCommits = model.rows.some((r) => (r.commits ?? 0) > 0);
		const legendTxt = `bar = commits · max ${countLabel(maxC)}`;
		if (hasCommits && !compact) {
			s += bandText(spec, 'caption', x + w, bottom, T.faint, legendTxt, { anchor: 'end' });
		}
		bottom += TT.strong.lh;
		if (hasCommits && compact) {
			// mobile has no room beside the long Total string — the bar
			// key drops to its own caption line, funded by the tighter
			// vitals→bar and aggregate→total air reclaimed in r2
			const lg = snap(spec, bottom + SPACE.s1);
			s += bandText(spec, 'caption', x, lg, T.faint, legendTxt);
			bottom = lg + TT.caption.lh;
		}
	}
	return { svg: s, bottom: snap(spec, bottom + SPACE.s2) };
}

/**
 * Band 2 — "output": a titled repo table (30-day commits + PRs),
 * the 72-hour pulse histogram, then the recent-events list. All
 * modules share the band header anatomy and the grid.
 */
function sourceWarn(model: Band2Model): string {
	const bad = model.sourceStatus
		? [model.sourceStatus.public, model.sourceStatus.private].filter((v) => v !== 'ok')
		: [];
	return bad.length > 0 ? ` · source ${bad.join(' + ')} not ok` : '';
}

/** Head meta for the activity section — window + observation. On
 * mobile the degraded-source warning is NOT appended (it would
 * overflow into the title); callers print it as its own caption. */
export function activityHeadMeta(model: Band2Model, mobile: boolean): string {
	return mobile
		? `30d · ${observedJst(model.observedAt).replace(' · ', ' ')}`
		: `last ${model.windowDays} days · observed ${observedJst(model.observedAt)}${sourceWarn(model)}`;
}

/**
 * Activity section as a reusable fragment — repo output table, then
 * the 72-hour pulse beside the recent-events list (side-by-side on
 * desktop, stacked on the mobile re-grid). `sectioned` tells the
 * drawer whether a section-level head ('GITHUB ACTIVITY') was
 * already drawn by the composer: standalone bands keep the
 * 'REPO OUTPUT' module head with the window meta; the composed
 * profile moves that meta onto the section head instead.
 */
function drawActivityDesktop(
	model: Band2Model,
	y0: number,
	sectioned: boolean,
): { svg: string; bottom: number } {
	const spec = canvasSpec(false);
	const { T, sem } = skinFor(model.theme);
	const m = spec.margin;
	let s = '';
	const y = y0;

	if (!model.snapshotAvailable) {
		s += bandText(
			spec,
			'body',
			spec.width / 2,
			snap(spec, y + 40),
			T.faint,
			'no activity snapshot — the sync pipeline has not published data',
			{ anchor: 'middle' },
		);
		return { svg: s, bottom: snap(spec, y + 80) };
	}

	// REPO OUTPUT — named repos on fixed columns; aggregates footnoted.
	// Standalone bands carry the window meta on this module's head;
	// the composed profile already stated it on the section head.
	let tableTop = y;
	if (!sectioned) {
		s += moduleHead(spec, m, y, 'REPO OUTPUT', activityHeadMeta(model, false), T);
		tableTop = snap(spec, y + 18);
	}
	const table = renderRepoTable(spec, m, tableTop, contentWidth(spec), model, T, sem, false);
	s += table.svg;

	// LAST 72 HOURS + RECENT EVENTS — peer modules sharing one row
	// on the 12-column grid (cols 0–5 / 6–11), halving the vertical
	// cost of the activity read-out
	const by = snap(spec, table.bottom + SPACE.s6);
	const halfW = (contentWidth(spec) - spec.gutter) / 2;
	const rightX = gridX(spec, 6);
	const peak = pulsePeak(model);
	const pulseCaption = `${model.feed72.length} events${peak > 0 ? ` · peak ${peak}/hr` : ''}`;
	// the pulse caption belongs to the LEFT module — right-align it to
	// that module's own edge, not the canvas margin over RECENT EVENTS
	const leftRight = m + halfW;
	s += moduleHead(spec, m, by, 'LAST 72 HOURS', pulseCaption, T, leftRight);
	s += moduleHead(spec, rightX, by, 'RECENT EVENTS', null, T);
	const pulse = renderPulse72(spec, m, snap(spec, by + 14), halfW, model, T, sem);
	// single-column list — the packed two-column variant collided on
	// desktop; the module is wide enough for one honest column
	const events = renderRecentActivity(
		spec,
		rightX,
		snap(spec, by + 14),
		spec.width - spec.margin - rightX,
		model,
		T,
		true,
	);
	s += pulse.svg + events.svg;

	return { svg: s, bottom: Math.max(pulse.bottom, events.bottom) };
}

function drawActivityMobile(
	model: Band2Model,
	y0: number,
	sectioned: boolean,
): { svg: string; bottom: number } {
	const spec = canvasSpec(true);
	const { T, sem } = skinFor(model.theme);
	const m = spec.margin;
	let s = '';
	const y = y0;

	if (!model.snapshotAvailable) {
		s += bandText(
			spec,
			'body',
			spec.width / 2,
			snap(spec, y + 40),
			T.faint,
			'no activity snapshot published',
			{ anchor: 'middle' },
		);
		return { svg: s, bottom: snap(spec, y + 80) };
	}

	// compact canvas: the window meta is short enough to share the
	// module head; a degraded source gets its own caption line —
	// appended to the meta it would overflow back into the title
	const warn = sourceWarn(model);
	let tableTop = y;
	if (!sectioned) {
		s += moduleHead(spec, m, y, 'REPO OUTPUT', activityHeadMeta(model, true), T);
		tableTop = snap(spec, y + 16 + (warn ? 20 : 0));
		if (warn) {
			s += bandText(spec, 'caption', m, snap(spec, y + 32), T.faint, warn.trim());
		}
	} else if (warn) {
		// the section head carries no room for the warning on 400px —
		// it gets its own caption line above the table
		s += bandText(spec, 'caption', m, snap(spec, y + 14), T.faint, warn.trim());
		tableTop = snap(spec, y + 30);
	}
	const table = renderRepoTable(spec, m, tableTop, contentWidth(spec), model, T, sem, true);
	s += table.svg;

	const py = snap(spec, table.bottom + SPACE.s4);
	const peak = pulsePeak(model);
	const pulseCaption = `${model.feed72.length} events${peak > 0 ? ` · peak ${peak}/hr` : ''}`;
	// ONE module head for the whole 72h read-out: the pulse is the
	// shape, the event rows beneath it are the same window's ledger —
	// a second 'RECENT EVENTS' head spent a full module row restating
	// what the glyphs and verbs already say.
	s += moduleHead(spec, m, py, 'LAST 72 HOURS', pulseCaption, T);
	const pulse = renderPulse72(spec, m, snap(spec, py + 12), contentWidth(spec), model, T, sem);
	s += pulse.svg;

	// the event ledger gets a wider break than the head→chart gap so
	// the two sub-blocks under the shared head don't read as equals
	const ey = snap(spec, pulse.bottom + SPACE.s4);
	const events = renderRecentActivity(spec, m, ey, contentWidth(spec), model, T, true);
	s += events.svg;

	return { svg: s, bottom: events.bottom };
}

/** Activity section — dispatches on the model's canvas. */
export function drawActivitySection(
	model: Band2Model,
	y0: number,
	opts: { sectioned?: boolean } = {},
): { svg: string; bottom: number } {
	const sectioned = opts.sectioned === true;
	return model.mobile
		? drawActivityMobile(model, y0, sectioned)
		: drawActivityDesktop(model, y0, sectioned);
}

export function renderBand2Svg(model: Band2Model, opts: { grid?: boolean } = {}): string {
	const spec = canvasSpec(model.mobile);
	const { T } = skinFor(model.theme);
	const sec = drawActivitySection(model, SPACE.s4);
	const H = snap(spec, sec.bottom + SPACE.s6) + (opts.grid && model.mobile ? 28 : 0);
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${H}" viewBox="0 0 ${spec.width} ${H}" font-family="${FONT}">`;
	svg += `<rect width="${spec.width}" height="${H}" fill="${T.bg}"/>`;
	svg += sec.svg;
	if (opts.grid) svg += gridOverlay(spec, H);
	svg += '</svg>';
	return svg;
}

// ---- model composition (pure, fail-closed) ----

type ActivitySnapshot = NonNullable<ReturnType<typeof parseSnapshot>>;

function parseSnapshot(payload: unknown) {
	const parsed = GitHubActivitySnapshotBody.safeParse(payload);
	return parsed.success ? parsed.data : null;
}

/**
 * Public feed events inside the trailing 72h of the snapshot's own
 * observation instant — the same window the pulse strip draws, so
 * the count caption and the axis can never disagree.
 */
function publicFeed72(snapshot: ActivitySnapshot, axisNow: number): BandEvent[] {
	return snapshot.feed
		.filter((e) => e.kind === 'public')
		.filter((e) => axisNow - Date.parse(e.at) < 72 * 3600e3)
		.sort((a, b) => (a.at < b.at ? 1 : -1))
		.map((e) => ({ repoId: e.repoId, type: e.type, at: e.at }));
}

/**
 * Assemble the Band 1 model. `stats` carries the GitHub-derived
 * figures (fetched + cached by the router, `null` fields render the
 * honest unavailable variant); `model` carries the validated
 * presence projection; `avatarDataUri` is the optional GitHub avatar
 * bytes the router inlined.
 */
export function composeBand1Model(input: {
	readonly theme: 'dark' | 'light';
	readonly mobile: boolean;
	readonly model: ProfileCardModel;
	readonly stats: BandStats;
	readonly avatarDataUri: string | null;
	readonly now: number;
}): Band1Model {
	const dp = input.model.discord;
	const presenceOk = dp.state === 'ok';
	return {
		theme: input.theme,
		mobile: input.mobile,
		avatarDataUri: input.avatarDataUri,
		// human status words, never telemetry jargon: a stale snapshot
		// reads "Offline · last synced …", a missing one "Status unknown"
		presenceLabel: presenceOk
			? dp.statusLabel
			: dp.state === 'stale'
				? 'Offline'
				: 'Status unknown',
		presenceDetail: presenceOk ? dp.detail : null,
		presenceOk,
		presenceObservedAt: dp.observedAt,
		stats: input.stats,
		generatedAt: new Date(input.now).toISOString(),
	};
}

/**
 * Assemble the Band 2 model from the stored activity snapshot.
 * Schema failure → `snapshotAvailable: false` and empty rows/feed —
 * the band says the snapshot is missing rather than drawing measured
 * zeros. Per-repo `commits`/`prs` stay `null` when the Search API did
 * not measure them ("unmeasured" ≠ "zero").
 */
export function composeBand2Model(input: {
	readonly theme: 'dark' | 'light';
	readonly mobile: boolean;
	readonly activityPayload: unknown;
	readonly now: number;
}): Band2Model {
	const snapshot = parseSnapshot(input.activityPayload);
	const windowDays = snapshot?.windowDays ?? 30;
	const observedAt =
		snapshot?.sources.public.observedAt ?? snapshot?.sources.private.observedAt ?? null;
	const observedMs = observedAt ? Date.parse(observedAt) : Number.NaN;
	const axisNow = Number.isNaN(observedMs) ? input.now : observedMs;

	const empty = {
		theme: input.theme,
		mobile: input.mobile,
		windowDays,
		snapshotAvailable: snapshot !== null,
		sourceStatus: snapshot
			? {
					public: snapshot.sources.public.status,
					private: snapshot.sources.private.status,
				}
			: null,
		totalCommits: 0,
		totalPrs: 0,
		repoCount: 0,
		rows: [] as BandRepoRow[],
		feed72: [] as BandEvent[],
		observedAt,
		axisNowMs: axisNow,
		generatedAt: new Date(input.now).toISOString(),
	};
	if (!snapshot) return empty;

	const sumOrNull = (vals: readonly (number | null)[]): number | null => {
		const measured = vals.filter((v): v is number => v !== null);
		return measured.length > 0 ? measured.reduce((a, b) => a + b, 0) : null;
	};

	const pubAll = snapshot.repos
		.filter((r) => r.kind === 'public')
		.map((r) => ({
			name: r.name.replace(/^rebuildup\//, ''),
			commits: r.activity?.commits ?? null,
			prs: r.activity?.prs ?? null,
			events: r.activity?.events ?? 0,
			dim: false,
		}))
		.filter((r) => (r.commits ?? 0) + (r.prs ?? 0) + r.events > 0)
		.sort((a, b) => (b.commits ?? -1) - (a.commits ?? -1) || (b.prs ?? -1) - (a.prs ?? -1));
	const priv = snapshot.repos.filter((r) => r.kind !== 'public');
	const privCommits = sumOrNull(priv.map((r) => r.activity?.commits ?? null));
	const privPrs = sumOrNull(priv.map((r) => r.activity?.prs ?? null));
	const privEvents = priv.reduce((a, r) => a + (r.activity?.events ?? 0), 0);
	// mobile names three repos and lets the rollup bucket carry the
	// rest — a fourth named row cost a full meter row the 400px
	// canvas could not afford; desktop keeps five
	const topN = input.mobile ? 3 : 5;
	const rest = pubAll.slice(topN);
	const rows: BandRepoRow[] = [
		...pubAll.slice(0, topN),
		...(rest.length > 0
			? [
					{
						name: `Other public (${rest.length})`,
						commits: sumOrNull(rest.map((r) => r.commits)),
						prs: sumOrNull(rest.map((r) => r.prs)),
						dim: true,
					},
				]
			: []),
		...(privCommits !== null || privPrs !== null || privEvents > 0
			? [
					{
						name: 'Private repos',
						commits: privCommits,
						prs: privPrs,
						dim: true,
					},
				]
			: []),
	];
	const totalCommits = rows.reduce((a, r) => a + (r.commits ?? 0), 0);
	const totalPrs = rows.reduce((a, r) => a + (r.prs ?? 0), 0);
	const repoCount = pubAll.length + priv.length;

	return {
		...empty,
		snapshotAvailable: true,
		totalCommits,
		totalPrs,
		repoCount,
		rows,
		feed72: publicFeed72(snapshot, axisNow),
		axisNowMs: axisNow,
	};
}
