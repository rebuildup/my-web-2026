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

interface Theme {
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
interface Skin {
	readonly T: Theme;
	readonly sem: (k: string) => string;
	readonly typeColor: (t: string) => string;
}

function skinFor(theme: 'dark' | 'light'): Skin {
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
function bandText(
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

/**
 * Unified Discord presence module — one card carrying the brand
 * glyph with the client-style status dot, the status word in the
 * status color, the detail line and the honest sync stamp. The
 * avatar badge uses the same dot color, so badge and card read as
 * a single presence signal instead of two disconnected marks.
 */
function presenceCard(
	spec: CanvasSpec,
	x: number,
	y: number,
	w: number,
	h: number,
	model: Band1Model,
	T: Theme,
): string {
	const TT = typeTable(spec);
	const statusColor = model.presenceOk ? discordDotColor(model) : T.faint;
	// whisper surface — the only card in the band, so it must not
	// carry more contrast than the hero numerals beside it
	let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${T.panel}" stroke="${T.line}" stroke-width="0.75"/>`;
	// circular user avatar with the Discord-idiom status dot on its
	// bottom-right corner: card-colour cutout ring, then status fill
	// (hollow grey ring when offline / unknown — never a filled "off")
	const as = h >= 60 ? 34 : 32;
	const ax = x + SPACE.s4;
	const ay = y + (h - as) / 2;
	const acx = ax + as / 2;
	const acy = ay + as / 2;
	if (model.avatarDataUri) {
		s += `<clipPath id="pcav"><circle cx="${acx}" cy="${acy}" r="${as / 2}"/></clipPath>`;
		s += `<image href="${model.avatarDataUri}" x="${ax}" y="${ay}" width="${as}" height="${as}" preserveAspectRatio="xMidYMid slice" clip-path="url(#pcav)"/>`;
	} else {
		s += `<circle cx="${acx}" cy="${acy}" r="${as / 2}" fill="${T.panel2}" stroke="${T.line}"/>`;
		s += lucide('user', acx, acy, as * 0.55, T.faint);
	}
	// hairline under the status-dot cutout — on dark themes the avatar
	// photo's own edge can dissolve into the card fill
	s += `<circle cx="${acx}" cy="${acy}" r="${as / 2}" fill="none" stroke="${T.line}" stroke-width="1"/>`;
	const dotColor = discordDotColor(model);
	const dotX = ax + as - 1;
	const dotY = ay + as - 1;
	s += `<circle cx="${dotX}" cy="${dotY}" r="${as * 0.3}" fill="${T.panel}"/>`;
	if (model.presenceOk) {
		s += `<circle cx="${dotX}" cy="${dotY}" r="${as * 0.19}" fill="${dotColor}"/>`;
	} else {
		s += `<circle cx="${dotX}" cy="${dotY}" r="${as * 0.19}" fill="none" stroke="#80848e" stroke-width="1.8"/>`;
	}
	// text block is optically spaced from the avatar — never snapped
	// to the page column grid inside a widget
	const l1 = y + h / 2 - 4;
	const textX = ax + as + 12;
	const detail = model.presenceDetail;
	const detailTxt = detail ? ` · ${truncate(detail, 200, TT.strong.size)}` : '';
	s += `<text x="${textX}" y="${l1}" xml:space="preserve"><tspan font-size="${TT.strong.size}" font-weight="${TT.strong.weight}" fill="${statusColor}">${esc(model.presenceLabel)}</tspan><tspan font-size="${TT.label.size}" fill="${T.muted}">${esc(detailTxt)}</tspan></text>`;
	// footer identifies the source with a small Clyde mark + one
	// honest sync stamp — never repeated inline
	const stamp = model.presenceObservedAt ? observedJst(model.presenceObservedAt) : 'never synced';
	const clyde = 12;
	const cly = l1 + 9 - clyde / 2;
	s += `<svg x="${textX}" y="${cly}" width="${clyde}" height="${clyde}" viewBox="0 0 24 24">${DISCORD_LOGO.replace('/>', ` fill="${T.discord}"/>`)}</svg>`;
	s += bandText(
		spec,
		'caption',
		textX + clyde + 5,
		l1 + 15,
		T.faint,
		`Synced via Discord · ${stamp}`,
	);
	return s;
}

const OWNER_NAME = 'rebuildup';

interface FocalStat {
	readonly icon: string;
	readonly swatch: keyof typeof SEM | null;
	readonly label: string;
	readonly value: (st: BandStats) => number | null;
	readonly unit: string | null;
	readonly note: (st: BandStats) => string | null;
}

/** Two focal metrics — the figures a profile should be remembered
 * by. Everything else is context, rendered smaller in TOTAL_STATS. */
const FOCAL_STATS: readonly FocalStat[] = [
	{
		icon: 'flame',
		swatch: 'orange',
		label: 'DAY STREAK',
		value: (st) => st.currentStreak,
		unit: 'days',
		note: (st) => (st.longestStreak !== null ? `best ${st.longestStreak}d` : null),
	},
	{
		icon: 'trending-up',
		swatch: 'accent',
		label: 'CONTRIBUTIONS',
		value: (st) => st.totalContributions,
		unit: null,
		note: (st) =>
			st.contributedTo !== null ? `all-time · ${st.contributedTo} public repos` : 'all-time',
	},
];

/** Secondary account totals — one quiet 2×2 module, never a KPI wall. */
const TOTAL_STATS = [
	{ icon: 'star', label: 'stars', value: (st: BandStats) => st.totalStars },
	{ icon: 'commit', label: 'commits', value: (st: BandStats) => st.totalCommits },
	{ icon: 'pr', label: 'PRs', value: (st: BandStats) => st.totalPRs },
	{ icon: 'issues', label: 'issues', value: (st: BandStats) => st.totalIssues },
] as const;

/**
 * Focal metric module on the shared anatomy: title-role label, then
 * licensed glyph + hero numeral + unit on one baseline, caption note
 * underneath. Missing metrics render `—` and keep their slot — an
 * absent upstream never collapses the grid.
 */
function focalStat(
	spec: CanvasSpec,
	x: number,
	y: number,
	stat: FocalStat,
	stats: BandStats,
	T: Theme,
	sem: (k: string) => string,
): { svg: string; bottom: number } {
	const TT = typeTable(spec);
	let s = bandText(spec, 'title', x, snap(spec, y + 12), T.muted, stat.label);
	const v = stat.value(stats);
	const missing = v === null;
	const num = missing ? '—' : v.toLocaleString('en-US');
	const iconColor = missing ? T.faint : stat.swatch ? sem(stat.swatch) : T.muted;
	const numY = snap(spec, y + 42);
	const iconSize = ICON.md + 2;
	s += lucide(
		stat.icon,
		x + iconSize / 2,
		iconCenterY(numY, TT.hero.size) + iconSize * 0.1,
		iconSize,
		iconColor,
	);
	const numX = x + iconSize + SPACE.s2;
	const unitTxt = !missing && stat.unit ? ` ${stat.unit}` : '';
	s += `<text x="${numX}" y="${numY}" xml:space="preserve"><tspan font-size="${TT.hero.size}" font-weight="${TT.hero.weight}" fill="${missing ? T.faint : T.fg}">${esc(num)}</tspan><tspan font-size="${TT.strong.size}" font-weight="${TT.strong.weight}" fill="${T.muted}">${esc(unitTxt)}</tspan></text>`;
	const raw = stat.note(stats);
	// the note must fit inside its own module's column span — measure
	// with the flowing estimator first so proportional text isn't cut
	// mid-word while space remains
	const availW = spec.width - spec.margin - x - SPACE.s2;
	const note =
		raw && flowWidth(raw, TT.caption.size) > availW ? truncate(raw, availW, TT.caption.size) : raw;
	if (note) {
		s += bandText(spec, 'caption', x, snap(spec, numY + 16), T.faint, note);
	}
	return { svg: s, bottom: snap(spec, numY + (note ? 22 : 10)) };
}

/** 'GITHUB TOTALS' module — 2×2 cells of icon + value + noun, all on
 * the strong/caption roles. Unmeasured metrics are omitted, not zeroed. */
function totalsGrid(
	spec: CanvasSpec,
	x: number,
	y: number,
	w: number,
	stats: BandStats,
	T: Theme,
): { svg: string; bottom: number } {
	const TT = typeTable(spec);
	let s = bandText(spec, 'title', x, snap(spec, y + 12), T.muted, 'GITHUB TOTALS');
	const items = TOTAL_STATS.filter((it) => it.value(stats) !== null);
	const cellW = (w - SPACE.s4) / 2;
	const rowH = 22;
	const firstBaseline = snap(spec, y + 32);
	items.forEach((it, i) => {
		const cx = x + (i % 2) * (cellW + SPACE.s4);
		const ry = firstBaseline + Math.floor(i / 2) * rowH;
		const v = it.value(stats) ?? 0;
		s += lucide(it.icon, cx + ICON.sm / 2, iconCenterY(ry, TT.strong.size), ICON.sm, T.faint);
		s += `<text x="${cx + ICON.sm + SPACE.s2}" y="${ry}" xml:space="preserve" font-family="${FONT}"><tspan font-size="${TT.strong.size}" font-weight="${TT.strong.weight}" fill="${T.fg}">${v.toLocaleString('en-US')}</tspan><tspan font-size="${TT.caption.size}" fill="${T.muted}"> ${esc(it.label)}</tspan></text>`;
	});
	const rows = Math.max(1, Math.ceil(items.length / 2));
	return { svg: s, bottom: firstBaseline + rows * rowH + SPACE.s1 };
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
		} else if (/[iljtf.,;:'%!|()[\]{}]/.test(ch)) {
			width += fontSize * 0.34;
		} else if (/[0-9]/.test(ch)) {
			width += fontSize * 0.56;
		} else {
			width += fontSize * 0.52;
		}
	}
	return width;
}

/** Language share bar: one pill track with hard-stop gradient
 * segments (crisp edges, rounded ends) + labelled leaders on the
 * label role. The bar and its legend share one x axis. */
function langBar(
	spec: CanvasSpec,
	x: number,
	y: number,
	w: number,
	langs: readonly BandLang[],
	T: Theme,
): string {
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
	// leaders: every named language + the Other remainder
	const leaders: { name: string; pct: number; swatch: string }[] = langs
		.slice(0, 3)
		.map((l) => ({ name: l.name, pct: l.pct, swatch: l.color }));
	const namedPct = leaders.reduce((a, l) => a + l.pct, 0);
	const otherPct = 100 - namedPct;
	if (segs.some((g) => g.other) && otherPct > 0.3) {
		leaders.push({ name: 'Other', pct: otherPct, swatch: '#8b949e' });
	}
	let lx = x;
	const ly2 = barY + barH + 15;
	for (const l of leaders) {
		const txt = `${l.name} ${l.pct.toFixed(1)}%`;
		s += `<rect x="${lx}" y="${ly2 - fs * 0.72}" width="7" height="7" fill="${l.swatch}"/>`;
		s += bandText(spec, 'label', lx + 11, ly2, T.muted, txt);
		lx += 11 + flowWidth(txt, fs) + 18;
	}
	return s;
}

/**
 * Band 1 — the profile head on the shared contract. One left rail
 * (avatar + name + descriptor), one presence card on grid columns
 * 6–11, then focal stats and account totals as titled modules, and
 * the language share bar last. Height is computed from the modules,
 * never a fixed canvas.
 */
function renderBand1Desktop(model: Band1Model, grid: boolean): string {
	const spec = canvasSpec(false);
	const { T, sem } = skinFor(model.theme);
	const TT = typeTable(spec);
	const W = spec.width;
	const right = W - spec.margin;
	const m = spec.margin;
	let s = '';
	let y: number = SPACE.s6;

	// identity rail — avatar carries the Discord-style status badge
	const as = 80;
	const ax = m;
	const ay = y;
	if (model.avatarDataUri) {
		s += `<clipPath id="b1av"><rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="16"/></clipPath>`;
		s += `<image href="${model.avatarDataUri}" x="${ax}" y="${ay}" width="${as}" height="${as}" preserveAspectRatio="xMidYMid slice" clip-path="url(#b1av)"/>`;
		s += `<rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="16" fill="none" stroke="${T.line}"/>`;
	} else {
		// No portrait fetched: a neutral disc, never a letter stand-in.
		s += `<circle cx="${ax + as / 2}" cy="${ay + as / 2}" r="${as / 2}" fill="${T.panel2}" stroke="${T.line}"/>`;
		s += lucide('commit', ax + as / 2, ay + as / 2, 28, T.faint);
	}
	// name + descriptor lockup — a fixed gap from the avatar keeps the
	// pair reading as one identity block (a full empty column between
	// them reads as two unrelated objects)
	const nx = ax + as + SPACE.s4;
	const nameY = snap(spec, ay + as / 2 + TT.hero.size * 0.34);
	s += bandText(spec, 'hero', nx, nameY, T.fg, OWNER_NAME);
	// presence card — sized to its content (~312px) and right-aligned;
	// stretching it across cols 6–11 left a third of the stroke framing
	// empty air
	const cardW = 312;
	const cardX = right - cardW;
	const cardH = 64;
	// centre the card on the avatar's midline — top-aligned left a
	// ~12px step under the taller avatar
	s += presenceCard(spec, cardX, ay + (as - cardH) / 2, cardW, cardH, model, T);
	const blockBottom = Math.max(ay + as, nameY + 6, ay + cardH);
	y = snap(spec, blockBottom) + SPACE.s6;

	// stats row: two focal modules on columns 0–2 / 3–5, totals on 6–11
	const hy = snap(spec, y);
	const modX2 = gridX(spec, 3);
	const f1 = focalStat(spec, m, hy, FOCAL_STATS[0], model.stats, T, sem);
	const f2 = focalStat(spec, modX2, hy, FOCAL_STATS[1], model.stats, T, sem);
	const totals = totalsGrid(spec, cardX, hy, cardW, model.stats, T);
	s += f1.svg + f2.svg + totals.svg;
	const rowBottom = Math.max(f1.bottom, f2.bottom, totals.bottom);

	// languages module — share bar + labelled leaders
	const ly = snap(spec, rowBottom + SPACE.s6);
	s += moduleHead(spec, m, ly, 'TOP LANGUAGES', null, T);
	const barTop = snap(spec, ly + 18);
	const langs = model.stats.topLangs;
	if (!langs || langs.length === 0) {
		s += bandText(spec, 'body', m, snap(spec, barTop + 20), T.faint, 'language data unavailable');
		y = snap(spec, barTop + 36);
	} else {
		s += langBar(spec, m, barTop, contentWidth(spec), langs, T);
		y = snap(spec, barTop + 46);
	}
	const H = snap(spec, y + SPACE.s4);

	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
	svg += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
	svg += s;
	if (grid) svg += gridOverlay(spec, H);
	svg += '</svg>';
	return svg;
}

function renderBand1Mobile(model: Band1Model, grid: boolean): string {
	const spec = canvasSpec(true);
	const { T, sem } = skinFor(model.theme);
	const TT = typeTable(spec);
	const W = spec.width;
	const m = spec.margin;
	let s = '';
	let y: number = SPACE.s4;

	// identity rail — compact avatar + name + descriptor
	const as = 48;
	const ax = m;
	const ay = y;
	if (model.avatarDataUri) {
		s += `<clipPath id="b1mav"><rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="12"/></clipPath>`;
		s += `<image href="${model.avatarDataUri}" x="${ax}" y="${ay}" width="${as}" height="${as}" preserveAspectRatio="xMidYMid slice" clip-path="url(#b1mav)"/>`;
		s += `<rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="12" fill="none" stroke="${T.line}"/>`;
	} else {
		s += `<circle cx="${ax + as / 2}" cy="${ay + as / 2}" r="${as / 2}" fill="${T.panel2}" stroke="${T.line}"/>`;
	}
	const nx = ax + as + SPACE.s2;
	// name only on mobile — the tagline lives in the README intro
	// line, and a second baseline under a 28px handle collides
	const nameY = snap(spec, ay + as / 2 + TT.hero.size * 0.34);
	s += bandText(spec, 'hero', nx, nameY, T.fg, OWNER_NAME);
	y = ay + as + SPACE.s4;

	// presence card — full content width, single Discord surface
	const cardH = 56;
	s += presenceCard(spec, m, y, contentWidth(spec), cardH, model, T);
	y += cardH + SPACE.s4;

	// focal stats — two modules on the 6-column re-grid (cols 0–2 / 3–5)
	const hy = snap(spec, y);
	const f1 = focalStat(spec, m, hy, FOCAL_STATS[0], model.stats, T, sem);
	const f2 = focalStat(spec, gridX(spec, 3), hy, FOCAL_STATS[1], model.stats, T, sem);
	s += f1.svg + f2.svg;
	const rowBottom = Math.max(f1.bottom, f2.bottom);

	// totals module — full width, 2×2
	const totals = totalsGrid(
		spec,
		m,
		snap(spec, rowBottom + SPACE.s4),
		contentWidth(spec),
		model.stats,
		T,
	);
	s += totals.svg;

	// languages module
	const ly = snap(spec, totals.bottom + SPACE.s2);
	s += moduleHead(spec, m, ly, 'TOP LANGUAGES', null, T);
	const barTop = snap(spec, ly + 18);
	const langs = model.stats.topLangs;
	if (!langs || langs.length === 0) {
		s += bandText(spec, 'body', m, snap(spec, barTop + 20), T.faint, 'language data unavailable');
		y = snap(spec, barTop + 36);
	} else {
		s += langBar(spec, m, barTop, contentWidth(spec), langs, T);
		y = snap(spec, barTop + 46);
	}
	const H = snap(spec, y + SPACE.s4);

	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
	svg += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
	svg += s;
	if (grid) svg += gridOverlay(spec, H);
	svg += '</svg>';
	return svg;
}

export function renderBand1Svg(model: Band1Model, opts: { grid?: boolean } = {}): string {
	return model.mobile
		? renderBand1Mobile(model, opts.grid === true)
		: renderBand1Desktop(model, opts.grid === true);
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

function eventStamp(at: string, observedAt: string | null): string {
	// compact absolute stamp. The band header already declares the JST
	// timezone and the observed day, so events landing on that same day
	// collapse to 'HH:MM'; other days keep 'Nov 24 · 02:46'. Still
	// absolute — a static SVG never prints relative ages that rot.
	if (!at) return 'unknown time';
	const full = observedJst(at).replace(' JST', '');
	if (observedAt && jstDayKey(at) === jstDayKey(observedAt)) {
		return full.split(' · ')[1] ?? full;
	}
	// 'Nov 24 · 02:46' -> 'Nov 24 02:46' — tighter, still absolute
	return full.replace(' · ', ' ');
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
	const maxRows = compact ? 4 : 5;
	const rowH = 20;
	const shown = runs.slice(0, maxRows);
	const firstBaseline = snap(spec, y + 24);
	// one column on every canvas — a second packed column was the
	// source of the desktop collisions; the stamp gets its own
	// right-aligned column so repo names truncate instead of pushing
	// the timestamp off the canvas edge
	const stampW = 92;
	shown.forEach((r, i) => {
		const ry = firstBaseline + i * rowH;
		s += eventGlyph(r.type, x + 6, iconCenterY(ry, TT.data.size), ICON.sm - 2, typeColor(r.type));
		const verb =
			r.count > 1 ? `${r.count} ${EVENT_NOUN[r.type] ?? r.type}` : (EVENT_VERB[r.type] ?? r.type);
		// repo owns the strong slot in the UI sans; the verb is a muted
		// caption tspan so rows don't shout over their module head
		const repoFs = TT.data.size - 1;
		const verbTxt = ` · ${verb}`;
		const verbW = textWidth(verbTxt, TT.caption.size);
		const repo = truncate(r.repo, w - stampW - 24 - verbW - 8, repoFs);
		s += `<text x="${x + 20}" y="${ry}" xml:space="preserve"><tspan font-family="${FONT}" font-size="${repoFs}" font-weight="600" fill="${T.fg}">${esc(repo)}</tspan><tspan font-family="${FONT}" font-size="${TT.caption.size}" fill="${T.muted}">${esc(verbTxt)}</tspan></text>`;
		s += bandText(spec, 'caption', x + w, ry, T.faint, eventStamp(r.at, model.observedAt), {
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
	const stripH = 44;
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
	const barW = Math.min(9, pitch * 0.72);
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
		const bh = Math.min(stripH - 6, 6 + c * 6);
		const bx = x + i * pitch + (pitch - barW) / 2;
		s += `<rect x="${bx.toFixed(1)}" y="${(baselineY - bh).toFixed(1)}" width="${barW.toFixed(1)}" height="${bh}" rx="2" fill="${hasPR[i] ? sem('purple') : sem('accent')}"/>`;
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
	// column right edges: desktop uses the grid; mobile packs two
	// count columns against the right margin
	const commitsRight = compact ? x + w - 76 : gridRight(spec, 8, 2);
	const prsRight = spec.width - spec.margin;
	const barX = gridX(spec, 3);
	// the longest bar lands exactly on the column-8 right edge —
	// bars are grid furniture, not free-floating marks
	const barZoneW = gridRight(spec, 8, 1) - barX;
	const rowH = compact ? 40 : 24;
	let s = '';
	let ry = snap(spec, y + 22);

	if (compact && named.length > 0) {
		// compact column headers — units stay intact ('30D COMMITS',
		// not a stripped '30D'); the 'REPO' sub-label is redundant
		// under the REPO OUTPUT module head
		s += bandText(spec, 'caption', commitsRight, snap(spec, y + 14), T.faint, '30D COMMITS', {
			anchor: 'end',
			ls: 1,
		});
		s += bandText(spec, 'caption', prsRight, snap(spec, y + 14), T.faint, 'PRS', {
			anchor: 'end',
			ls: 1,
		});
		ry = snap(spec, y + 34);
	}

	if (!compact) {
		// column headers — units live here, once; no 'REPO' label,
		// the module head already names the column
		s += bandText(spec, 'caption', commitsRight, snap(spec, y + 14), T.faint, '30D COMMITS', {
			anchor: 'end',
			ls: 1.2,
		});
		s += bandText(spec, 'caption', prsRight, snap(spec, y + 14), T.faint, 'PRS', {
			anchor: 'end',
			ls: 1.2,
		});
		ry = snap(spec, y + 36);
	}

	const nameW = compact ? w - 150 : 160;
	for (const r of named) {
		if (compact) {
			// two-line mobile row: name + bare counts, bar underneath —
			// commits and PRs share the table's right-edge columns
			s += `<text x="${x}" y="${ry}" font-family="${FONT}" font-size="${TT.data.size}" font-weight="600" fill="${T.fg}">${esc(truncate(r.name, nameW, TT.data.size))}</text>`;
			s += bandText(
				spec,
				'data',
				commitsRight,
				ry,
				r.commits !== null ? T.fg : T.faint,
				r.commits !== null ? countLabel(r.commits) : '—',
				{ anchor: 'end', mono: true },
			);
			if (r.prs !== null) {
				const num = countLabel(r.prs);
				s += bandText(spec, 'data', prsRight, ry, T.fg, num, { anchor: 'end', mono: true });
			} else {
				s += bandText(spec, 'data', prsRight, ry, T.faint, '—', { anchor: 'end', mono: true });
			}
			if (r.commits !== null) {
				// meter zone runs name-edge -> commits column edge with a
				// whisper track so the bar reads as a meter, not a divider
				const zoneW = commitsRight - x - 6;
				s += `<rect x="${x}" y="${ry + 6}" width="${zoneW}" height="6" rx="3" fill="${T.line}" opacity="0.4"/>`;
				if ((r.commits ?? 0) > 0) {
					const bw = zoneW * ((r.commits ?? 0) / maxC);
					s += `<rect x="${x}" y="${ry + 6}" width="${Math.max(3, bw)}" height="6" rx="3" fill="${sem('accent')}" opacity="0.9"/>`;
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
		s += bandText(
			spec,
			'data',
			commitsRight,
			ry,
			r.commits !== null ? T.fg : T.faint,
			r.commits !== null ? countLabel(r.commits) : '—',
			{ anchor: 'end', mono: true },
		);
		if (r.prs !== null) {
			const num = countLabel(r.prs);
			s += bandText(spec, 'data', prsRight, ry, T.fg, num, { anchor: 'end', mono: true });
		} else {
			s += bandText(spec, 'data', prsRight, ry, T.faint, '—', { anchor: 'end', mono: true });
		}
		ry += rowH;
	}

	// aggregate buckets on the same columns and the SAME bar scale —
	// muted, so a rollup never competes with a named repo
	let ay = ry + (compact ? 8 : 8);
	for (const d of dimRows(model.rows)) {
		if (d.commits !== null) {
			const zoneW = compact ? commitsRight - x - 6 : barZoneW;
			const bx = compact ? x : barX;
			const by = compact ? ay + 6 : ay - 8;
			const bh = compact ? 5 : 6;
			if (compact) {
				s += `<rect x="${bx}" y="${by}" width="${zoneW}" height="${bh}" rx="${bh / 2}" fill="${T.line}" opacity="0.3"/>`;
			} else {
				s += `<rect x="${bx}" y="${by}" width="${zoneW}" height="${bh}" rx="${bh / 2}" fill="${T.line}" opacity="0.25"/>`;
			}
			if ((d.commits ?? 0) > 0) {
				s += `<rect x="${bx}" y="${by}" width="${Math.max(3, zoneW * ((d.commits ?? 0) / maxC))}" height="${bh}" rx="${bh / 2}" fill="${sem('accent')}" opacity="0.45"/>`;
			}
		}
		s += bandText(spec, 'caption', x, ay, T.faint, truncate(d.name, nameW, TT.caption.size));
		s += bandText(
			spec,
			'caption',
			commitsRight,
			ay,
			T.faint,
			d.commits !== null ? countLabel(d.commits) : '—',
			{
				anchor: 'end',
				mono: true,
			},
		);
		if (d.prs !== null) {
			s += bandText(spec, 'caption', prsRight, ay, T.faint, countLabel(d.prs), {
				anchor: 'end',
				mono: true,
			});
		}
		ay += compact ? 32 : 20;
	}

	let bottom = ay;
	if (model.repoCount > 0) {
		// clear the last aggregate bar (mobile bars reach ay+11) before
		// the total line's baseline
		bottom = snap(spec, ay + (compact ? 22 : 14));
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
			// mobile: the legend gets its own line — sharing the Total
			// baseline collided the two strings into double-exposed text
			s += bandText(spec, 'caption', x, bottom + SPACE.s1, T.faint, legendTxt);
			bottom += SPACE.s1 + TT.caption.lh;
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

function renderBand2Desktop(model: Band2Model, grid: boolean): string {
	const spec = canvasSpec(false);
	const { T, sem } = skinFor(model.theme);
	const W = spec.width;
	const m = spec.margin;
	let s = '';
	// no band header — the README H2 owns the section name and the
	// observation meta lives on the REPO OUTPUT module head
	const y: number = SPACE.s4;

	if (!model.snapshotAvailable) {
		const H = snap(spec, y + 120);
		s += bandText(
			spec,
			'body',
			W / 2,
			snap(spec, y + 60),
			T.faint,
			'no activity snapshot — the sync pipeline has not published data',
			{
				anchor: 'middle',
			},
		);
		let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
		svg += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
		svg += s;
		if (grid) svg += gridOverlay(spec, H);
		svg += '</svg>';
		return svg;
	}

	// REPO OUTPUT — named repos on fixed columns; aggregates footnoted.
	// The window + observation meta lives on THIS module's head so it
	// is attributed to the table, never to the feed below it
	const headRight = `last ${model.windowDays} days · observed ${observedJst(model.observedAt)}`;
	s += moduleHead(spec, m, y, 'REPO OUTPUT', headRight + sourceWarn(model), T);
	const table = renderRepoTable(
		spec,
		m,
		snap(spec, y + 18),
		contentWidth(spec),
		model,
		T,
		sem,
		false,
	);
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

	const contentBottom = Math.max(pulse.bottom, events.bottom);
	const H = snap(spec, contentBottom + SPACE.s6);
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
	svg += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
	svg += s;
	if (grid) svg += gridOverlay(spec, H);
	svg += '</svg>';
	return svg;
}

function renderBand2Mobile(model: Band2Model, grid: boolean): string {
	const spec = canvasSpec(true);
	const { T, sem } = skinFor(model.theme);
	const W = spec.width;
	const m = spec.margin;
	let s = '';
	// no band header — the README H2 owns the name; observation meta
	// lives on the REPO OUTPUT module head
	const y: number = SPACE.s4;

	if (!model.snapshotAvailable) {
		const H = snap(spec, y + 80);
		s += bandText(
			spec,
			'body',
			W / 2,
			snap(spec, y + 40),
			T.faint,
			'no activity snapshot published',
			{
				anchor: 'middle',
			},
		);
		let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
		svg += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
		svg += s;
		if (grid) svg += gridOverlay(spec, H);
		svg += '</svg>';
		return svg;
	}

	// compact canvas: shorten the window meta so the module-head
	// caption can't collide with the title — '30D COMMITS' column
	// header already carries the window. A degraded-source warning
	// gets its own caption line: appended to the meta it would
	// overflow back into the title
	const warn = sourceWarn(model);
	const headRight = `30d · observed ${observedJst(model.observedAt)}`;
	s += moduleHead(spec, m, y, 'REPO OUTPUT', headRight, T);
	const tableTop = snap(spec, y + 16 + (warn ? 20 : 0));
	if (warn) {
		s += bandText(spec, 'caption', m, snap(spec, y + 32), T.faint, warn.trim());
	}
	const table = renderRepoTable(spec, m, tableTop, contentWidth(spec), model, T, sem, true);
	s += table.svg;

	const py = snap(spec, table.bottom + SPACE.s4);
	const peak = pulsePeak(model);
	const pulseCaption = `${model.feed72.length} events${peak > 0 ? ` · peak ${peak}/hr` : ''}`;
	s += moduleHead(spec, m, py, 'LAST 72 HOURS', pulseCaption, T);
	const pulse = renderPulse72(spec, m, snap(spec, py + 14), contentWidth(spec), model, T, sem);
	s += pulse.svg;

	const ey = snap(spec, pulse.bottom + SPACE.s4);
	s += moduleHead(spec, m, ey, 'RECENT EVENTS', null, T);
	const events = renderRecentActivity(
		spec,
		m,
		snap(spec, ey + 12),
		contentWidth(spec),
		model,
		T,
		true,
	);
	s += events.svg;

	const H = snap(spec, events.bottom + SPACE.s6);
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
	svg += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
	svg += s;
	if (grid) svg += gridOverlay(spec, H);
	svg += '</svg>';
	return svg;
}

export function renderBand2Svg(model: Band2Model, opts: { grid?: boolean } = {}): string {
	return model.mobile
		? renderBand2Mobile(model, opts.grid === true)
		: renderBand2Desktop(model, opts.grid === true);
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
	const topN = input.mobile ? 4 : 5;
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
