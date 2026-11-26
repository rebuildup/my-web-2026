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
import type { ProfileCardModel } from './model';

export const BAND_WIDTH = 800;
export const BAND1_HEIGHT = 250;
export const BAND2_HEIGHT = 360;
export const BAND_MOBILE_WIDTH = 400;
export const BAND1_MOBILE_HEIGHT = 228;
export const BAND2_MOBILE_HEIGHT = 440;

const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,monospace";

interface Theme {
	readonly bg: string;
	readonly panel2: string;
	readonly line: string;
	readonly fg: string;
	readonly muted: string;
	readonly faint: string;
}

const THEMES: Record<'dark' | 'light', Theme> = {
	dark: {
		bg: '#0d1117',
		panel2: '#232b38',
		line: '#2d333f',
		fg: '#e6edf3',
		muted: '#bcc6d4',
		faint: '#9aa7b8',
	},
	light: {
		bg: '#ffffff',
		panel2: '#eaeef2',
		line: '#d1d9e0',
		fg: '#1f2328',
		muted: '#525c68',
		faint: '#68717d',
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
function statusBadge(ax: number, ay: number, as: number, model: Band1Model, T: Theme): string {
	const dx = ax + as - 5;
	const dy = ay + as - 5;
	let dot: string;
	if (model.presenceOk) {
		dot = `<circle cx="${dx}" cy="${dy}" r="6" fill="${discordDotColor(model)}"/>`;
	} else {
		// Discord's offline mark is a hollow grey ring, not a filled dot
		dot = `<circle cx="${dx}" cy="${dy}" r="6" fill="none" stroke="#80848e" stroke-width="2.4"/>`;
	}
	return `<circle cx="${dx}" cy="${dy}" r="8.5" fill="${T.bg}"/>${dot}`;
}

/** One-line Discord presence readout: brand glyph + status word in
 * the status color + muted detail / honest sync note. */
function statusLine(
	x: number,
	y: number,
	model: Band1Model,
	T: Theme,
	maxW: number,
	rightEdge?: number,
): string {
	const statusColor = model.presenceOk ? discordDotColor(model) : T.faint;
	const head = model.presenceLabel;
	let detail = model.presenceDetail;
	if (model.presenceObservedAt && !model.presenceOk) {
		detail = `last synced ${observedJst(model.presenceObservedAt)}`;
	}
	// measure first so `rightEdge` can anchor the whole run — the
	// status word and its detail then sit at standard inline spacing
	// regardless of which status string the snapshot carried
	// textWidth's flat 0.56em/char runs ~10% wide for this proportional
	// mix — calibrate so the left-anchored cluster's right edge lands
	// flush with the margin (estimate error only shifts the start x)
	const headW = textWidth(head, 10.5) * 0.85;
	const budget = rightEdge !== undefined ? Math.min(maxW, rightEdge - x) : maxW;
	const availForDetail = budget - 17 - headW - 4;
	let detailTxt = detail ? ` · ${detail}` : '';
	if (detail && textWidth(detailTxt, 10) * 1.1 > availForDetail) {
		detail = truncate(detail, Math.max(0, availForDetail - 8), 10);
		detailTxt = detail ? ` · ${detail}` : '';
	}
	const detW = detailTxt ? textWidth(detailTxt, 10) * 0.85 : 0;
	let s = '';
	if (rightEdge !== undefined) {
		// LEFT-anchor the whole cluster: the estimate only decides where
		// the cluster starts, never where the icon sits — the glyph
		// always hugs the status word at a fixed gap, like mobile. The
		// run's right edge lands within estimate error of the margin.
		const clusterW = 12 + 5 + headW + detW;
		const clusterX = Math.max(x, rightEdge - clusterW);
		s += `<svg x="${clusterX}" y="${y - 9}" width="12" height="12" viewBox="0 0 24 24">${DISCORD_LOGO.replace('/>', ` fill="${T.muted}"/>`)}</svg>`;
		const tx = clusterX + 17;
		const detailSpan =
			detW > 0 ? `<tspan font-size="10" fill="${T.faint}">${esc(detailTxt)}</tspan>` : '';
		s += `<text x="${tx}" y="${y}" xml:space="preserve"><tspan font-size="10.5" font-weight="700" fill="${statusColor}">${esc(head)}</tspan>${detailSpan}</text>`;
		return s;
	}
	// mobile: head + detail flow inside ONE <text> run (tspan carries
	// the second color) — typeset middot spacing, no positioned gap
	const detailSpan =
		detW > 0 ? `<tspan font-size="10" fill="${T.faint}">${esc(detailTxt)}</tspan>` : '';
	const tx = x + 17;
	s += `<svg x="${x}" y="${y - 9}" width="12" height="12" viewBox="0 0 24 24">${DISCORD_LOGO.replace('/>', ` fill="${T.muted}"/>`)}</svg>`;
	s += `<text x="${tx}" y="${y}" xml:space="preserve"><tspan font-size="10.5" font-weight="700" fill="${statusColor}">${esc(head)}</tspan>${detailSpan}</text>`;
	return s;
}

const OWNER_NAME = 'rebuildup';
const OWNER_DESCRIPTOR = 'design × code × motion — After Effects tools, web apps, video';

interface StatSpec {
	readonly icon: string;
	readonly color: keyof typeof SEM | null;
	readonly label: string;
	readonly value: (st: BandStats) => number | null;
	readonly format?: (v: number) => string;
}

/** Two hero metrics — the figures a profile should be remembered by. */
const HERO_STATS: readonly StatSpec[] = [
	{
		icon: 'flame',
		color: 'orange',
		label: 'DAY STREAK',
		value: (st) => st.currentStreak,
	},
	{
		icon: 'trending-up',
		color: 'accent',
		label: 'ALL-TIME CONTRIBUTIONS',
		value: (st) => st.totalContributions,
	},
];

/** Compact secondary metrics — one quiet inline row, not a KPI grid. */
const META_STATS: readonly StatSpec[] = [
	{ icon: 'star', color: null, label: 'stars', value: (st) => st.totalStars },
	{ icon: 'commit', color: null, label: 'commits', value: (st) => st.totalCommits },
	{ icon: 'pr', color: null, label: 'PRs', value: (st) => st.totalPRs },
	{ icon: 'issues', color: null, label: 'issues', value: (st) => st.totalIssues },
];

function statValue(spec: StatSpec, st: BandStats): { text: string; missing: boolean } {
	const v = spec.value(st);
	if (v === null) return { text: '—', missing: true };
	return {
		text: spec.format ? spec.format(v) : v.toLocaleString('en-US'),
		missing: false,
	};
}

/** Hero metric block: licensed glyph + large number + small caps
 * label (+ optional benchmark note). `endX` right-anchors the whole
 * block so a hero stat can balance the composition against the
 * identity column instead of leaving a right-side void. */
function heroStat(
	x: number,
	y: number,
	spec: StatSpec,
	stats: BandStats,
	T: Theme,
	sem: (k: string) => string,
	size: number,
	endX?: number,
): string {
	const { text, missing } = statValue(spec, stats);
	const iconColor = spec.color ? sem(spec.color) : T.muted;
	// `text-anchor="end"` makes x the RIGHT edge — do not subtract the
	// width again. Estimate generously (800-weight digits run wider
	// than the 0.56em latin metric) so the glyph keeps clear air left
	// of the numeral.
	const estW = textWidth(text, size) * 1.3;
	const end = endX !== undefined;
	const nx = end ? endX : x + size * 0.95 + 8;
	const iconCx = end ? endX - estW - 10 - size * 0.45 : x + size * 0.42;
	const anchor = end ? ' text-anchor="end"' : '';
	let s = '';
	s += lucide(spec.icon, iconCx, y + size * 0.42, size * 0.9, missing ? T.faint : iconColor);
	s += `<text x="${nx}" y="${y + size * 0.82}" font-size="${size}" font-weight="800" fill="${missing ? T.faint : T.fg}"${anchor}>${esc(text)}</text>`;
	s += `<text x="${end ? endX : nx}" y="${y + size * 1.36}" font-size="8.5" font-weight="700" fill="${T.muted}" letter-spacing="1.1"${anchor}>${esc(spec.label)}</text>`;
	return s;
}

/** Compact meta stats: tiny glyph + value + noun on a fixed
 * two-column grid. Columns are LEFT-anchored at caller-supplied x
 * positions — icons sit at the column edge and text flows right of
 * them, so no font-metric estimate can ever strand an icon or stagger
 * the columns. Missing metrics are omitted entirely. */
function metaGrid(
	colXs: readonly number[],
	y: number,
	stats: BandStats,
	T: Theme,
	size: number,
): { svg: string; rows: number } {
	const items = META_STATS.filter((spec) => spec.value(stats) !== null).map((spec) => {
		const v = spec.value(stats);
		const text = spec.format ? spec.format(v ?? 0) : (v ?? 0).toLocaleString('en-US');
		return { icon: spec.icon, label: `${text} ${spec.label}` };
	});
	const cols = colXs.length;
	const fs = size + 1;
	const iconGap = 6;
	let s = '';
	items.forEach((item, i) => {
		const col = i % cols;
		const row = Math.floor(i / cols);
		const cx = colXs[col];
		const ry = y + row * 11;
		s += lucide(item.icon, cx + fs / 2, ry - 3.5, fs, T.faint);
		s += `<text x="${cx + fs + iconGap}" y="${ry}" font-size="${fs}" fill="${T.muted}">${esc(truncate(item.label, 200, fs))}</text>`;
	});
	return { svg: s, rows: Math.ceil(items.length / cols) };
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

/** GitHub-native rounded language bar: one pill track with hard-stop
 * gradient segments (crisp edges, rounded ends) + labelled leaders. */
function langBar(
	x: number,
	y: number,
	w: number,
	langs: readonly BandLang[],
	T: Theme,
	fs: number,
): string {
	const segs = langSegments(langs);
	const barY = y + 10;
	const barH = fs > 10 ? 11 : 9;
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
	const leaders: { name: string; pct: number; color: string }[] = langs
		.slice(0, 3)
		.map((l) => ({ name: l.name, pct: l.pct, color: l.color }));
	const namedPct = leaders.reduce((a, l) => a + l.pct, 0);
	const otherPct = 100 - namedPct;
	if (segs.some((g) => g.other) && otherPct > 0.3) {
		leaders.push({ name: 'Other', pct: otherPct, color: '#8b949e' });
	}
	let lx = x;
	const ly2 = barY + barH + 15;
	for (const l of leaders) {
		const txt = `${l.name} ${l.pct.toFixed(1)}%`;
		s += `<rect x="${lx}" y="${ly2 - fs * 0.72}" width="7" height="7" fill="${l.color}"/>`;
		s += `<text x="${lx + 11}" y="${ly2}" font-size="${fs}" fill="${T.muted}">${esc(txt)}</text>`;
		lx += 11 + flowWidth(txt, fs) + 18;
	}
	return s;
}

function renderBand1Desktop(model: Band1Model): string {
	const { T, sem } = skinFor(model.theme);
	const W = BAND_WIDTH;
	const H = BAND1_HEIGHT;
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
	s += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;

	// identity header: one avatar carrying the Discord status badge —
	// no duplicate portrait, the badge IS the presence surface
	const ax = 24;
	const ay = 14;
	const as = 72;
	if (model.avatarDataUri) {
		s += `<clipPath id="b1av"><rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="16"/></clipPath>`;
		s += `<image href="${model.avatarDataUri}" x="${ax}" y="${ay}" width="${as}" height="${as}" preserveAspectRatio="xMidYMid slice" clip-path="url(#b1av)"/>`;
	} else {
		// No portrait fetched: a neutral disc, never a letter stand-in.
		s += `<circle cx="${ax + as / 2}" cy="${ay + as / 2}" r="${as / 2}" fill="${T.panel2}" stroke="${T.line}"/>`;
		s += lucide('commit', ax + as / 2, ay + as / 2, 28, T.faint);
	}
	s += statusBadge(ax, ay, as, model, T);
	const nx = ax + as + 18;
	// the name is the type anchor — KPI numerals stay below it
	s += `<text x="${nx}" y="56" font-size="26" font-weight="800" fill="${T.fg}">${OWNER_NAME}</text>`;
	s += `<text x="${nx}" y="76" font-size="11.5" fill="${T.muted}">${esc(truncate(OWNER_DESCRIPTOR, 480, 11.5))}</text>`;
	// presence occupies the header's right column, flush to the
	// margin — balances the identity block instead of stranding it
	s += statusLine(W / 2, 62, model, T, W / 2 - 24, W - 24);
	s += `<line x1="24" y1="106" x2="${W - 24}" y2="106" stroke="${T.line}"/>`;

	// middle row on a shared two-column grid: hero figures own the
	// left half as a pair (no hollow center), the five secondary
	// metrics stack quietly in the right column
	const hy = 118;
	const streakSpec =
		model.stats.longestStreak !== null
			? { ...HERO_STATS[0], label: `DAY STREAK · BEST ${model.stats.longestStreak}D` }
			: HERO_STATS[0];
	s += heroStat(24, hy, streakSpec, model.stats, T, sem, 22);
	// second KPI at a clean column start — same left-anchored
	// icon + gap + digits construction as mobile, no floating icon
	s += heroStat(212, hy, HERO_STATS[1], model.stats, T, sem, 22);
	// meta columns sit at 66% / 83% — tight pair grouped on the right,
	// clearly separated from the hero KPIs, right edge near the margin
	const meta = metaGrid([W * 0.66, W * 0.83], hy + 12, model.stats, T, 9);
	s += meta.svg;
	s += `<line x1="24" y1="${hy + 52}" x2="${W - 24}" y2="${hy + 52}" stroke="${T.line}" opacity="0.6"/>`;

	// top languages — GitHub pill bar + labelled leaders
	const langs = model.stats.topLangs;
	const ly = hy + 68;
	s += `<text x="24" y="${ly}" font-size="9.5" font-weight="700" fill="${T.muted}" letter-spacing="1.4">TOP LANGUAGES</text>`;
	if (!langs || langs.length === 0) {
		s += `<text x="24" y="${ly + 30}" font-size="12" fill="${T.faint}">language data unavailable</text>`;
	} else {
		s += langBar(24, ly, W - 48, langs, T, 10.5);
	}
	s += '</svg>';
	return s;
}

function renderBand1Mobile(model: Band1Model): string {
	const { T, sem } = skinFor(model.theme);
	const W = BAND_MOBILE_WIDTH;
	const H = BAND1_MOBILE_HEIGHT;
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
	s += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;

	// header — single avatar + Discord badge, concrete craft kept
	const as = 48;
	const ax = 16;
	const ay = 12;
	if (model.avatarDataUri) {
		s += `<clipPath id="b1mav"><rect x="${ax}" y="${ay}" width="${as}" height="${as}" rx="12"/></clipPath>`;
		s += `<image href="${model.avatarDataUri}" x="${ax}" y="${ay}" width="${as}" height="${as}" preserveAspectRatio="xMidYMid slice" clip-path="url(#b1mav)"/>`;
	} else {
		s += `<circle cx="${ax + as / 2}" cy="${ay + as / 2}" r="${as / 2}" fill="${T.panel2}" stroke="${T.line}"/>`;
	}
	s += statusBadge(ax, ay, as, model, T);
	const nx = ax + as + 12;
	s += `<text x="${nx}" y="37" font-size="19" font-weight="800" fill="${T.fg}">${OWNER_NAME}</text>`;
	s += `<text x="${nx}" y="52" font-size="9.5" fill="${T.muted}">${esc(truncate('After Effects tools · web apps · video', 280, 9.5))}</text>`;
	s += statusLine(nx, 69, model, T, W - 16 - nx);
	s += `<line x1="16" y1="79" x2="${W - 16}" y2="79" stroke="${T.line}"/>`;

	// hero metrics — streak + contributions side by side
	const hy = 93;
	const streakSpecM =
		model.stats.longestStreak !== null
			? { ...HERO_STATS[0], label: `DAY STREAK · BEST ${model.stats.longestStreak}D` }
			: HERO_STATS[0];
	s += heroStat(16, hy, streakSpecM, model.stats, T, sem, 18);
	s += heroStat(212, hy, HERO_STATS[1], model.stats, T, sem, 18);
	s += `<line x1="16" y1="${hy + 42}" x2="${W - 16}" y2="${hy + 42}" stroke="${T.line}" opacity="0.6"/>`;

	// compact secondary metrics — same fixed columns as the hero
	// pair above (16 / 212), so icons and digits share vertical axes
	const my = hy + 58;
	const metaM = metaGrid([16, 212], my, model.stats, T, 8);
	s += metaM.svg;

	// top languages — same pill bar, tighter leaders
	const langs = model.stats.topLangs;
	const ly = my + 15 + metaM.rows * 11;
	s += `<text x="16" y="${ly}" font-size="9.5" font-weight="700" fill="${T.muted}" letter-spacing="1.2">TOP LANGUAGES</text>`;
	if (!langs || langs.length === 0) {
		s += `<text x="16" y="${ly + 24}" font-size="10.5" fill="${T.faint}">language data unavailable</text>`;
	} else {
		s += langBar(16, ly, W - 32, langs, T, 9.5);
	}
	s += '</svg>';
	return s;
}

export function renderBand1Svg(model: Band1Model): string {
	return model.mobile ? renderBand1Mobile(model) : renderBand1Desktop(model);
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
	return full;
}

/** Recent public activity as a compact notification-style list —
 * repo · verb glyph · verb · absolute JST stamp, all inline so the
 * eye never crosses a blank chasm. Consecutive same-repo/same-type
 * events collapse into one row ('2 pushes'). Honest about the
 * window (the count line says how many events the 72h window
 * actually held) and never invents a timeline the data doesn't
 * support. */
function renderRecentActivity(
	x: number,
	y: number,
	w: number,
	model: Band2Model,
	T: Theme,
	compact: boolean,
): string {
	const { typeColor } = skinFor(model.theme);
	let s = '';
	s += `<text x="${x}" y="${y}" font-size="${compact ? 10.5 : 10}" font-weight="700" fill="${T.muted}" letter-spacing="1.2">RECENT PUBLIC EVENTS</text>`;
	// the observed day + zone rides the feed subheader once, so the
	// collapsed 'HH:MM' row stamps stay self-contained
	const feedDay = model.observedAt ? `${observedJst(model.observedAt).split(' · ')[0]} JST` : null;
	const feedCount = feedDay
		? `${model.feed72.length} in 72h · ${feedDay}`
		: `${model.feed72.length} in 72h`;
	s += `<text x="${x + w}" y="${y}" text-anchor="end" font-size="8.5" fill="${T.faint}">${feedCount}</text>`;
	if (model.feed72.length === 0) {
		s += `<text x="${x}" y="${y + 22}" font-size="${compact ? 10.5 : 10}" fill="${T.faint}">no public events in the last 72h</text>`;
		return s;
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
	// 6 desktop runs fill the 2-column grid evenly (3×2, no orphan
	// row); mobile keeps 4 in a single column
	const maxRows = compact ? 4 : 6;
	const rowH = compact ? 20 : 18;
	const fs = compact ? 10 : 9.5;
	const shown = runs.slice(0, maxRows);
	// desktop spreads the list across two columns so the lower half
	// of the band doesn't collapse into the left third; mobile keeps
	// one column. Repo + verb + stamp flow inside ONE <text> via
	// tspan — manual x-estimates once caused text-on-text collisions
	const cols = compact ? 1 : 2;
	const colGap = 16;
	const cellW = (w - colGap * (cols - 1)) / cols;
	// column-major: the eye reads down the newest column, then across —
	// no zig-zag through time
	const gridRows = Math.ceil(shown.length / cols);
	shown.forEach((r, i) => {
		const row = compact ? i : i % gridRows;
		const col = compact ? 0 : Math.floor(i / gridRows);
		const gx = x + col * (cellW + colGap);
		const ry = y + (compact ? 22 : 20) + row * rowH;
		s += eventGlyph(r.type, gx + 6, ry - 3, compact ? 11 : 10, typeColor(r.type));
		const repo = truncate(r.repo, compact ? 120 : 200, fs);
		const verb =
			r.count > 1 ? `${r.count} ${EVENT_NOUN[r.type] ?? r.type}` : (EVENT_VERB[r.type] ?? r.type);
		s += `<text x="${gx + 18}" y="${ry}" font-size="${fs}" fill="${T.fg}" font-family="${MONO}" xml:space="preserve">${esc(repo)}<tspan font-size="${compact ? 8.5 : 8}" fill="${T.faint}"> · ${esc(`${verb} · ${eventStamp(r.at, model.observedAt)}`)}</tspan></text>`;
	});
	const shownEvents = shown.reduce((a, r) => a + r.count, 0);
	const remaining = model.feed72.length - shownEvents;
	if (remaining > 0) {
		// footer line under the whole grid, right-aligned to the feed
		// margin — reads as the section's tail, not a stray cell under
		// column 1
		const ry = y + (compact ? 22 : 20) + gridRows * rowH;
		s += `<text x="${x + w}" y="${ry}" text-anchor="end" font-size="${compact ? 9 : 8.5}" fill="${T.faint}">+${remaining} more</text>`;
	}
	return s;
}

/** Aggregate rows (`dim`) render as their own quiet lines — rollup
 * buckets never share the named-repo bar scale and never truncate
 * mid-value the way a joined line did. */
function dimRows(rows: readonly BandRepoRow[]): readonly BandRepoRow[] {
	return rows.filter((r) => r.dim);
}

/** Named-repo output rows. Desktop: name | proportional bar | counts
 * close to the bar (no right-edge chasm). Mobile: name + counts on
 * one line, full-width bar underneath. Unmeasured commits draw no
 * track at all — "not measured" never looks like "zero". */
function renderRepoRows(
	x: number,
	y: number,
	w: number,
	model: Band2Model,
	T: Theme,
	compact: boolean,
): { svg: string; rowsBottom: number } {
	const { sem } = skinFor(model.theme);
	let s = '';
	const named = model.rows.filter((r) => !r.dim);
	const measured = named.filter((r) => r.commits !== null);
	const maxCommits = Math.max(1, ...measured.map((r) => r.commits ?? 0));
	const fs = compact ? 10.5 : 9.5;

	if (compact) {
		const rowH = 42;
		const cfs = 8.5;
		named.forEach((r, i) => {
			const ry = y + i * rowH;
			s += `<text x="${x}" y="${ry + 15}" font-size="${fs}" fill="${T.fg}" font-family="${MONO}">${esc(truncate(r.name, w - 140, fs))}</text>`;
			// same fixed sub-columns as desktop — the separator can't drift
			const prsTxtM = r.prs !== null ? `${countLabel(r.prs)} PRs` : null;
			const comTxtM = r.commits !== null ? `${countLabel(r.commits)} commits` : 'commits —';
			s += `<text x="${x + w - 64}" y="${ry + 15}" text-anchor="end" font-size="${cfs}" fill="${T.faint}" font-family="${MONO}">${esc(comTxtM)}</text>`;
			if (prsTxtM !== null) {
				s += `<text x="${x + w}" y="${ry + 15}" text-anchor="end" font-size="${cfs}" fill="${T.faint}" font-family="${MONO}">${esc(prsTxtM)}</text>`;
			}
			// bare magnitude bar from a clean left baseline — length IS
			// the encoding; a track rail would read as a progress meter
			if (r.commits !== null && (r.commits ?? 0) > 0) {
				const bw = w * ((r.commits ?? 0) / maxCommits);
				s += `<rect x="${x}" y="${ry + 24}" width="${Math.max(3, bw)}" height="7" rx="3.5" fill="${sem('accent')}" opacity="0.9"/>`;
			}
		});
		return { svg: s, rowsBottom: y + named.length * rowH };
	}

	const rowH = 21;
	const nameW = 120;
	const countsW = 150;
	const barX = x + nameW + 10;
	const barW = w - nameW - 10 - 14 - countsW;
	named.forEach((r, i) => {
		const ry = y + i * rowH;
		s += `<text x="${x}" y="${ry + 14}" font-size="${fs}" fill="${T.fg}" font-family="${MONO}">${esc(truncate(r.name, nameW - 8, fs))}</text>`;
		if (r.commits !== null && (r.commits ?? 0) > 0) {
			const bw = barW * ((r.commits ?? 0) / maxCommits);
			s += `<rect x="${barX}" y="${ry + 7}" width="${Math.max(2, bw)}" height="6" rx="3" fill="${sem('accent')}" opacity="0.9"/>`;
		}
		// counts split into two fixed right-aligned sub-columns —
		// '51' vs '572' can no longer drift the separator across rows
		const prsTxt = r.prs !== null ? `${countLabel(r.prs)} PRs` : null;
		const comTxt = r.commits !== null ? `${countLabel(r.commits)} commits` : 'commits —';
		s += `<text x="${x + w - 78}" y="${ry + 14}" text-anchor="end" font-size="${fs}" fill="${T.faint}" font-family="${MONO}">${esc(comTxt)}</text>`;
		if (prsTxt !== null) {
			s += `<text x="${x + w}" y="${ry + 14}" text-anchor="end" font-size="${fs}" fill="${T.faint}" font-family="${MONO}">${esc(prsTxt)}</text>`;
		}
		// whisper-quiet ledger rule under each row — gives the eye a
		// track across the bar→counts gulf without reading as a
		// progress rail (5% opacity, below all glyphs)
		s += `<line x1="${x}" y1="${ry + rowH - 2.5}" x2="${x + w}" y2="${ry + rowH - 2.5}" stroke="${T.line}" stroke-width="1" opacity="0.05"/>`;
	});
	return { svg: s, rowsBottom: y + named.length * rowH };
}

function renderBand2Desktop(model: Band2Model): string {
	const { T } = skinFor(model.theme);
	const W = BAND_WIDTH;
	const H = BAND2_HEIGHT;
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
	s += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
	s += `<text x="24" y="26" font-size="13" font-weight="800" fill="${T.fg}" letter-spacing="2">GITHUB ACTIVITY</text>`;
	const headRight = model.snapshotAvailable
		? `last ${model.windowDays} days · observed ${esc(observedJst(model.observedAt))}`
		: 'activity snapshot unavailable';
	s += `<text x="${W - 24}" y="28" text-anchor="end" font-size="10" fill="${T.faint}">${headRight}</text>`;
	if (model.sourceStatus) {
		const bad = [model.sourceStatus.public, model.sourceStatus.private].filter((v) => v !== 'ok');
		if (bad.length > 0) {
			s += `<text x="${W - 24}" y="42" text-anchor="end" font-size="9" fill="${T.faint}">source ${bad.join(' + ')} not ok — coverage may be partial</text>`;
		}
	}
	// hairline frames the band header so 'REPO OUTPUT' doesn't read as
	// a second stacked title bar
	s += `<line x1="24" y1="47" x2="${W - 24}" y2="47" stroke="${T.line}" opacity="0.6"/>`;

	if (!model.snapshotAvailable) {
		s += `<text x="${W / 2}" y="${H / 2 + 4}" font-size="12" fill="${T.faint}" text-anchor="middle">no activity snapshot — the sync pipeline has not published data</text>`;
		s += '</svg>';
		return s;
	}

	// repo output — named repos only; aggregates are quiet footnote
	// lines. ry sits lower than the band title so 'GITHUB ACTIVITY'
	// and 'REPO OUTPUT' don't read as a double heading
	const ry = 60;
	s += `<text x="24" y="${ry}" font-size="10" font-weight="700" fill="${T.muted}" letter-spacing="1.2">REPO OUTPUT</text>`;
	const named = model.rows.filter((r) => !r.dim && r.commits !== null);
	const maxC = Math.max(1, ...named.map((r) => r.commits ?? 0));
	const legend = named.length > 0 ? `bar = commits · max = ${countLabel(maxC)}` : '';
	s += `<text x="${W - 24}" y="${ry}" text-anchor="end" font-size="9" fill="${T.faint}">${legend}</text>`;
	const rowsOut = renderRepoRows(24, ry + 10, W - 48, model, T, false);
	s += rowsOut.svg;
	let ly = rowsOut.rowsBottom + 8;
	// aggregate buckets keep the named rows' count columns — the eye
	// scans one right edge for every number in the section
	for (const d of dimRows(model.rows)) {
		const comD = d.commits !== null ? `${countLabel(d.commits)} commits` : 'commits —';
		const prsD = d.prs !== null ? `${countLabel(d.prs)} PRs` : null;
		s += `<text x="24" y="${ly + 10}" font-size="9" fill="${T.faint}">${esc(truncate(d.name, W - 140, 9))}</text>`;
		s += `<text x="${W - 102}" y="${ly + 10}" text-anchor="end" font-size="9" fill="${T.faint}" font-family="${MONO}">${esc(comD)}</text>`;
		if (prsD !== null) {
			s += `<text x="${W - 24}" y="${ly + 10}" text-anchor="end" font-size="9" fill="${T.faint}" font-family="${MONO}">${esc(prsD)}</text>`;
		}
		ly += 13;
	}
	if (model.repoCount > 0) {
		s += `<line x1="24" y1="${ly + 4}" x2="${W - 24}" y2="${ly + 4}" stroke="${T.line}" opacity="0.5"/>`;
		s += `<text x="24" y="${ly + 18}" font-size="10" font-weight="700" fill="${T.muted}">Total — ${countLabel(model.totalCommits)} commits · ${countLabel(model.totalPrs)} PRs · ${model.repoCount} active repos</text>`;
		ly += 27;
	}
	const lb = ly + 8;
	s += `<line x1="24" y1="${lb}" x2="${W - 24}" y2="${lb}" stroke="${T.line}"/>`;

	// recent public activity — compact list, not a fake timeline
	const ey = lb + 14;
	s += renderRecentActivity(24, ey, W - 48, model, T, false);
	s += '</svg>';
	return s;
}

function renderBand2Mobile(model: Band2Model): string {
	const { T } = skinFor(model.theme);
	const W = BAND_MOBILE_WIDTH;
	const H = BAND2_MOBILE_HEIGHT;
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
	s += `<rect width="${W}" height="${H}" fill="${T.bg}"/>`;
	s += `<text x="16" y="24" font-size="12" font-weight="800" fill="${T.fg}" letter-spacing="1.8">GITHUB ACTIVITY</text>`;
	s += `<text x="${W - 14}" y="24" text-anchor="end" font-size="9" fill="${T.faint}">${model.snapshotAvailable ? `last ${model.windowDays}d · observed ${esc(observedJst(model.observedAt))}` : 'snapshot unavailable'}</text>`;
	if (model.sourceStatus) {
		const bad = [model.sourceStatus.public, model.sourceStatus.private].filter((v) => v !== 'ok');
		if (bad.length > 0) {
			s += `<text x="${W - 14}" y="39" text-anchor="end" font-size="8.5" fill="${T.faint}">source ${bad.join(' + ')} partial</text>`;
		}
	}
	s += `<line x1="16" y1="45" x2="${W - 16}" y2="45" stroke="${T.line}" opacity="0.6"/>`;

	if (!model.snapshotAvailable) {
		s += `<text x="${W / 2}" y="${H / 2 + 4}" font-size="11" fill="${T.faint}" text-anchor="middle">no activity snapshot published</text>`;
		s += '</svg>';
		return s;
	}

	const ry = 58;
	s += `<text x="16" y="${ry}" font-size="10.5" font-weight="700" fill="${T.muted}" letter-spacing="1">REPO OUTPUT</text>`;
	const namedM = model.rows.filter((r) => !r.dim && r.commits !== null);
	const maxCM = Math.max(1, ...namedM.map((r) => r.commits ?? 0));
	s += `<text x="${W - 14}" y="${ry}" text-anchor="end" font-size="8.5" fill="${T.faint}">bar = commits · max = ${countLabel(maxCM)}</text>`;
	const rowsOut = renderRepoRows(16, ry + 10, W - 32, model, T, true);
	s += rowsOut.svg;
	let ly = rowsOut.rowsBottom + 6;
	for (const d of dimRows(model.rows)) {
		const comD = d.commits !== null ? `${countLabel(d.commits)} commits` : 'commits —';
		const prsD = d.prs !== null ? `${countLabel(d.prs)} PRs` : null;
		s += `<text x="16" y="${ly + 11}" font-size="8.5" fill="${T.faint}">${esc(truncate(d.name, W - 110, 8.5))}</text>`;
		s += `<text x="${W - 80}" y="${ly + 11}" text-anchor="end" font-size="8.5" fill="${T.faint}" font-family="${MONO}">${esc(comD)}</text>`;
		if (prsD !== null) {
			s += `<text x="${W - 16}" y="${ly + 11}" text-anchor="end" font-size="8.5" fill="${T.faint}" font-family="${MONO}">${esc(prsD)}</text>`;
		}
		ly += 13;
	}
	if (model.repoCount > 0) {
		s += `<line x1="16" y1="${ly + 4}" x2="${W - 16}" y2="${ly + 4}" stroke="${T.line}" opacity="0.5"/>`;
		s += `<text x="16" y="${ly + 17}" font-size="9.5" font-weight="700" fill="${T.muted}">Total — ${countLabel(model.totalCommits)} commits · ${countLabel(model.totalPrs)} PRs · ${model.repoCount} active repos</text>`;
		ly += 25;
	}
	const lb = ly + 8;
	s += `<line x1="16" y1="${lb}" x2="${W - 16}" y2="${lb}" stroke="${T.line}"/>`;

	const ey = lb + 12;
	s += renderRecentActivity(16, ey, W - 32, model, T, true);
	s += '</svg>';
	return s;
}

export function renderBand2Svg(model: Band2Model): string {
	return model.mobile ? renderBand2Mobile(model) : renderBand2Desktop(model);
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
	};
}
