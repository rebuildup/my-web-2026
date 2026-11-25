/**
 * GitHub profile "bands" — the visual-led redesign (Issue #1216,
 * ADR-0026 direction, visual doc §18).
 *
 * Two unboxed SVG bands replace the card stack:
 *
 *   Band 1 `identity`  (800×360 / mobile 560): avatar + handle +
 *     descriptor, Discord presence dot, then four vitals cells
 *     (streak flame, language-ratio bar, contributed-repo dot grid,
 *     rank ring) and the DECLARED FOCUS node map (roster glyphs,
 *     weight segments).
 *   Band 2 `repo-map`  (800×340 / mobile 560): REPO OUTPUT 30d
 *     (commit dots / PR squares, scaled with exact counts) beside
 *     LAST 72 HOURS (event-type shapes on a now=right time axis,
 *     JST feed rows).
 *
 * Geometry is the approved prototype spec
 * (`docs/verification/github-profile/v11/proto-gen6-approved.mjs`,
 * agy review v19 APPROVE). Every encoding is honest: ratios are
 * linear, glyph counts are labelled "scaled" with exact numerals
 * beside them, capped encodings never invert magnitudes, and a
 * missing upstream renders `—` / an explicit empty state — never a
 * guessed value (same contract as `now.ts` / ADR-0025).
 *
 * Rendering is deterministic for a given input: `nowMs` arrives as
 * an argument, no clock, no randomness, no fetch at render time.
 */

import type { RosterEntry } from '../../home/current/types';
import { GitHubActivitySnapshotBody } from '../activity/schema';
import { escapeXml, textWidth, truncate } from './card';
import type { ProfileCardModel } from './model';

export const BAND_WIDTH = 800;
export const BAND1_HEIGHT = 360;
export const BAND2_HEIGHT = 340;
export const BAND_MOBILE_WIDTH = 560;
export const BAND1_MOBILE_HEIGHT = 520;
export const BAND2_MOBILE_HEIGHT = 560;

const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,monospace";

interface Theme {
	readonly bg: string;
	readonly panel: string;
	readonly panel2: string;
	readonly stroke: string;
	readonly fg: string;
	readonly muted: string;
	readonly faint: string;
}

const THEMES: Record<'dark' | 'light', Theme> = {
	dark: {
		bg: '#0d1117',
		panel: '#161b22',
		panel2: '#232b38',
		stroke: '#2d333f',
		fg: '#e6edf3',
		muted: '#bcc6d4',
		faint: '#9aa7b8',
	},
	light: {
		bg: '#ffffff',
		panel: '#f6f8fa',
		panel2: '#eaeef2',
		stroke: '#d1d9e0',
		fg: '#1f2328',
		muted: '#59636e',
		faint: '#818b98',
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

const LEVEL_COLOR: Record<string, keyof typeof SEM> = {
	primary: 'accent',
	active: 'purple',
	side: 'green',
	paused: 'orange',
};
const LEVEL_ORDER: Record<string, number> = { primary: 0, active: 1, side: 2, paused: 3 };
const LEVEL_SEGMENTS: Record<string, number> = { primary: 3, active: 2, side: 1, paused: 1 };

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
const TYPE_LABEL: Record<string, string> = {
	PushEvent: 'push',
	PullRequestEvent: 'PR',
	IssuesEvent: 'issue',
	IssueCommentEvent: 'comment',
	PullRequestReviewEvent: 'review',
	CreateEvent: 'create',
	DeleteEvent: 'delete',
	WatchEvent: 'star',
	ForkEvent: 'fork',
	ReleaseEvent: 'release',
};

function jstStamp(iso: string): string {
	const d = new Date(Date.parse(iso) + 9 * 3600e3);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

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

const esc = escapeXml;

function flame(cx: number, cy: number, s: number, color: string, inner: string): string {
	return `<g>
<path d="M${cx} ${cy - s * 1.1} C ${cx + s * 0.7} ${cy - s * 0.5} ${cx + s * 0.55} ${cy + s * 0.1} ${cx + s * 0.15} ${cy + s * 0.55} C ${cx} ${cy + s * 0.8} ${cx - s * 0.35} ${cy + s * 0.75} ${cx - s * 0.55} ${cy + s * 0.4} C ${cx - s * 0.85} ${cy} ${cx - s * 0.6} ${cy - s * 0.7} ${cx} ${cy - s * 1.1} Z" fill="${color}"/>
<path d="M${cx} ${cy + s * 0.15} C ${cx + s * 0.35} ${cy + s * 0.35} ${cx + s * 0.2} ${cy + s * 0.6} ${cx} ${cy + s * 0.75} C ${cx - s * 0.25} ${cy + s * 0.6} ${cx - s * 0.2} ${cy + s * 0.35} ${cx} ${cy + s * 0.15} Z" fill="${inner}"/>
</g>`;
}

const GLYPHS: Record<string, string> = {
	web: `<g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></g>`,
	agent: `<g fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="3.5" r="1.6"/><circle cx="12" cy="20.5" r="1.6"/><circle cx="3.5" cy="12" r="1.6"/><circle cx="20.5" cy="12" r="1.6"/><path d="M12 5.5v3.5M12 15v3.5M5.5 12H9M15 12h3.5"/></g>`,
	cal: `<g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.5" cy="14.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="8.5" cy="18" r="1.4" fill="currentColor" stroke="none"/></g>`,
	pen: `<g fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.5 4.5l5 5L8 21H3v-5L14.5 4.5z"/><path d="M12 7l5 5"/></g>`,
	dot: `<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>`,
};

/** Roster id → focus glyph. Unknown ids fall back to `dot`. */
const ROSTER_GLYPH: Record<string, string> = {
	'my-web-2026': 'web',
	'ai-coding-agent': 'agent',
	tastile: 'cal',
	'after-effects': 'pen',
};

// ---- models ----

export interface BandLang {
	readonly name: string;
	readonly pct: number;
	readonly color: string;
}

export interface BandStats {
	readonly currentStreak: number | null;
	readonly contributedTo: number | null;
	readonly rankLevel: string | null;
	/** "top X%" — lower is better (vendor calculateRank contract). */
	readonly rankPercentile: number | null;
	readonly topLangs: readonly BandLang[] | null;
}

export interface BandFocusNode {
	readonly id: string;
	readonly name: string;
	readonly note: string;
	readonly glyph: string;
	readonly level: string;
	readonly x: number;
	readonly r: number;
	readonly colorKey: keyof typeof SEM;
}

export interface Band1Model {
	readonly theme: 'dark' | 'light';
	readonly mobile: boolean;
	readonly presenceLabel: string;
	readonly presenceOk: boolean;
	readonly presenceObservedAt: string | null;
	readonly stats: BandStats;
	readonly focus: readonly BandFocusNode[];
	readonly observedAt: string | null;
	readonly generatedAt: string;
}

export interface BandRepoRow {
	readonly name: string;
	readonly commits: number;
	readonly prs: number;
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
	readonly rows: readonly BandRepoRow[];
	readonly feed72: readonly BandEvent[];
	readonly observedAt: string | null;
	readonly generatedAt: string;
	readonly nowMs: number;
}

// ---- shared helpers ----

function levelOf(entry: RosterEntry): string {
	return entry.handwritten?.weightLevel ?? 'side';
}

function noteOf(entry: RosterEntry): string {
	return entry.statusJa ?? entry.name;
}

/** Approved desktop x slots for the canonical 4-project roster; other
 * counts spread evenly so the map never overlaps. */
const FOCUS_X_4 = [130, 360, 565, 720];
const FOCUS_R: Record<string, number> = { primary: 38, active: 30, side: 25, paused: 22 };

export function buildFocusNodes(roster: readonly RosterEntry[]): BandFocusNode[] {
	const sorted = [...roster].sort(
		(a, b) => (LEVEL_ORDER[levelOf(a)] ?? 9) - (LEVEL_ORDER[levelOf(b)] ?? 9),
	);
	return sorted.map((entry, i) => {
		const level = levelOf(entry);
		const x =
			sorted.length === 4
				? FOCUS_X_4[i]
				: Math.round(120 + (i * (BAND_WIDTH - 210)) / Math.max(1, sorted.length - 1));
		return {
			id: entry.id,
			name: entry.name,
			note: noteOf(entry),
			glyph: ROSTER_GLYPH[entry.id] ?? 'dot',
			level,
			x,
			r: FOCUS_R[level] ?? 25,
			colorKey: LEVEL_COLOR[level] ?? 'green',
		};
	});
}

interface LangSegment {
	readonly pct: number;
	readonly color: string;
	readonly other: boolean;
}

/** Top-5 real languages plus an honest grey "Other" remainder so the
 * ratio bar always sums to ~100% and never silently drops languages. */
function langSegments(langs: readonly BandLang[]): readonly LangSegment[] {
	const shown = langs.slice(0, 5);
	const shownPct = shown.reduce((a, l) => a + l.pct, 0);
	const otherPct = Math.max(0, 100 - shownPct);
	const segs: LangSegment[] = shown.map((l) => ({ pct: l.pct, color: l.color, other: false }));
	if (otherPct > 0.3) segs.push({ pct: otherPct, color: '#8b949e', other: true });
	return segs;
}

// ---- Band 1 ----

function renderBand1Desktop(model: Band1Model): string {
	const T = THEMES[model.theme];
	const isDark = model.theme === 'dark';
	const sem = (k: string) => SEM[k][isDark ? 'dark' : 'light'];
	const W = BAND_WIDTH;
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAND1_HEIGHT}" viewBox="0 0 ${W} ${BAND1_HEIGHT}" font-family="${FONT}">`;
	s += `<rect width="${W}" height="${BAND1_HEIGHT}" fill="${T.bg}"/>`;

	// identity header
	s += `<rect x="24" y="20" width="62" height="62" rx="13" fill="${T.panel2}" stroke="${sem('accent')}" stroke-width="2"/>`;
	s += `<text x="55" y="67" font-size="29" font-weight="800" fill="${sem('accent')}" text-anchor="middle">r</text>`;
	s += `<text x="102" y="48" font-size="21" font-weight="800" fill="${T.fg}">rebuildup</text>`;
	s += `<text x="102" y="71" font-size="11.5" fill="${T.muted}">design × code × motion — After Effects tools, web apps, video</text>`;
	const pColor = model.presenceOk ? 'green' : 'orange';
	s += `<circle cx="102" cy="88" r="4.5" fill="${sem(pColor)}"/>`;
	s += `<text x="113" y="92" font-size="10.5" fill="${T.muted}">${esc(model.presenceOk ? `${model.presenceLabel} on Discord` : `Discord ${model.presenceLabel}`)}</text>`;
	s += `<text x="${W - 24}" y="38" text-anchor="end" font-size="10" fill="${T.faint}">observed ${esc(observedJst(model.observedAt ?? model.presenceObservedAt))}</text>`;
	s += `<line x1="24" y1="100" x2="${W - 24}" y2="100" stroke="${T.stroke}"/>`;

	// vitals: 4 cells
	const vy = 112;
	const vh = 82;
	const cw = (W - 48 - 36) / 4;
	for (let i = 0; i < 4; i++)
		s += `<rect x="${24 + i * (cw + 12)}" y="${vy}" width="${cw}" height="${vh}" rx="9" fill="${T.panel}" stroke="${T.stroke}"/>`;

	// 1 streak
	{
		const x = 24;
		const streak = model.stats.currentStreak;
		if (streak !== null) {
			s += flame(x + 30, vy + 40, 13, sem('orange'), '#ffd77a');
			s += `<text x="${x + 52}" y="${vy + 50}" font-size="27" font-weight="800" fill="${T.fg}">${streak.toLocaleString('en-US')}</text>`;
			s += `<text x="${x + cw / 2}" y="${vy + 72}" font-size="10" fill="${T.muted}" text-anchor="middle">day streak</text>`;
		} else {
			s += `<text x="${x + 14}" y="${vy + 50}" font-size="24" font-weight="800" fill="${T.faint}">—</text>`;
			s += `<text x="${x + cw / 2}" y="${vy + 72}" font-size="10" fill="${T.muted}" text-anchor="middle">streak unavailable</text>`;
		}
	}

	// 2 top language
	{
		const x = 24 + cw + 12;
		const langs = model.stats.topLangs;
		s += `<text x="${x + 14}" y="${vy + 20}" font-size="9.5" fill="${T.muted}">TOP LANGUAGE</text>`;
		if (!langs || langs.length === 0) {
			s += `<text x="${x + 14}" y="${vy + 52}" font-size="14" font-weight="700" fill="${T.faint}">—</text>`;
			s += `<text x="${x + 14}" y="${vy + 72}" font-size="9.5" fill="${T.muted}">unavailable</text>`;
		} else {
			let acc = 0;
			const bw = cw - 28;
			for (const seg of langSegments(langs)) {
				const w = (bw * seg.pct) / 100;
				s += `<rect x="${x + 14 + acc}" y="${vy + 30}" width="${w}" height="12" fill="${seg.color}"/>`;
				acc += w;
			}
			const top = langs[0];
			s += `<text x="${x + 14}" y="${vy + 60}" font-size="12.5" font-weight="700" fill="${T.fg}">${esc(truncate(top.name, cw - 90, 12.5))}</text>`;
			s += `<text x="${x + cw - 14}" y="${vy + 60}" font-size="10.5" fill="${T.muted}" text-anchor="end">${top.pct.toFixed(1)}%</text>`;
			let dswx = x + 14;
			const dswy = vy + 73;
			for (const l of langs.slice(1, 3)) {
				s += `<rect x="${dswx}" y="${dswy - 6}" width="6" height="6" fill="${l.color}"/>`;
				s += `<text x="${dswx + 9}" y="${dswy}" font-size="9" fill="${T.muted}">${esc(l.name)} ${l.pct.toFixed(1)}</text>`;
				dswx += 9 + textWidth(l.name, 9) + 26;
			}
			if (langs.length > 3) {
				s += `<text x="${dswx + 2}" y="${dswy}" font-size="9" fill="${T.faint}">+${langs.length - 3} more</text>`;
			}
		}
	}

	// 3 contributed-to dot grid (capacity 28, honest overflow)
	{
		const x = 24 + 2 * (cw + 12);
		const count = model.stats.contributedTo;
		s += `<text x="${x + 14}" y="${vy + 20}" font-size="9.5" fill="${T.muted}">CONTRIBUTED TO${count === null ? '' : ` · ${count} REPOS`}</text>`;
		if (count === null) {
			s += `<text x="${x + 14}" y="${vy + 56}" font-size="10" fill="${T.faint}">unavailable</text>`;
		} else {
			const shown = Math.min(count, 28);
			for (let i = 0; i < shown; i++) {
				const dx = x + 16 + (i % 7) * 15;
				const dy = vy + 34 + Math.floor(i / 7) * 11.5;
				s += `<circle cx="${dx}" cy="${dy}" r="4.2" fill="${sem('accent')}" opacity="${i < 24 ? 0.85 : 0.3}"/>`;
				s += `<circle cx="${dx}" cy="${dy}" r="4.2" fill="none" stroke="${T.stroke}"/>`;
			}
			if (count > 28) {
				s += `<text x="${x + cw - 14}" y="${vy + 76}" font-size="9" fill="${T.faint}" text-anchor="end">+${count - 28} more</text>`;
			}
		}
	}

	// 4 rank ring
	{
		const x = 24 + 3 * (cw + 12);
		s += `<text x="${x + 14}" y="${vy + 20}" font-size="9.5" fill="${T.muted}">GITHUB RANK</text>`;
		const cx = x + 30;
		const cy = vy + 52;
		const r = 19;
		s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${T.panel2}" stroke-width="7"/>`;
		const level = model.stats.rankLevel;
		const pct = model.stats.rankPercentile;
		if (level !== null && pct !== null) {
			const frac = Math.min(1, Math.max(0.04, 1 - pct / 100));
			const a0 = -Math.PI / 2;
			const a1 = a0 + Math.PI * 2 * frac;
			const x0 = cx + r * Math.cos(a0);
			const y0 = cy + r * Math.sin(a0);
			const x1 = cx + r * Math.cos(a1);
			const y1 = cy + r * Math.sin(a1);
			s += `<path d="M ${x0} ${y0} A ${r} ${r} 0 1 1 ${x1} ${y1}" fill="none" stroke="${sem('accent')}" stroke-width="7" stroke-linecap="round"/>`;
			s += `<text x="${cx}" y="${cy + 4.5}" font-size="13" font-weight="800" fill="${T.fg}" text-anchor="middle">${esc(level)}</text>`;
			s += `<text x="${cx + 26}" y="${cy - 2}" font-size="10" fill="${T.muted}">top ${pct.toFixed(1)}%</text>`;
			s += `<text x="${cx + 26}" y="${cy + 12}" font-size="9" fill="${T.faint}">rank</text>`;
		} else {
			s += `<text x="${cx}" y="${cy + 5}" font-size="13" font-weight="800" fill="${T.faint}" text-anchor="middle">—</text>`;
			s += `<text x="${cx + 26}" y="${cy + 4}" font-size="9" fill="${T.faint}">unavailable</text>`;
		}
	}

	// focus node map
	const fy = 214;
	s += `<text x="24" y="${fy - 6}" font-size="10" font-weight="700" fill="${T.muted}" letter-spacing="1.4">IN PROGRESS · DECLARED FOCUS</text>`;
	s += `<text x="${W - 24}" y="${fy - 6}" text-anchor="end" font-size="9" fill="${T.faint}">▮▮▮ primary · ▮▮ active · ▮ side</text>`;
	const cy = 262;
	for (const n of model.focus) {
		const colr = sem(n.colorKey);
		s += `<circle cx="${n.x}" cy="${cy}" r="${n.r}" fill="${T.panel2}" stroke="${colr}" stroke-width="${n.level === 'primary' ? 3 : 1.8}"/>`;
		if (n.level !== 'side' && n.level !== 'paused')
			s += `<circle cx="${n.x}" cy="${cy}" r="${n.r + 6}" fill="none" stroke="${colr}" stroke-width="1" opacity="0.4"/>`;
		const gs = n.r * 1.15;
		s += `<svg x="${n.x - gs / 2}" y="${cy - gs / 2}" width="${gs}" height="${gs}" viewBox="0 0 24 24" color="${colr}">${GLYPHS[n.glyph] ?? GLYPHS.dot}</svg>`;
		const nameY = cy + n.r + 15;
		const noteY = n.level === 'primary' ? 330 : cy + n.r + 27;
		const nameSize = n.level === 'primary' ? 12.5 : 11;
		const xs = model.focus.map((f) => f.x);
		const nearest = Math.min(...xs.filter((x) => x !== n.x).map((x) => Math.abs(x - n.x)));
		const labelW = Math.min(110, nearest * 0.72);
		s += `<text x="${n.x}" y="${nameY}" font-size="${nameSize}" font-weight="700" fill="${T.fg}" text-anchor="middle">${esc(truncate(n.name, labelW, nameSize))}</text>`;
		s += `<text x="${n.x}" y="${noteY}" font-size="9" fill="${T.muted}" text-anchor="middle">${esc(truncate(n.note, labelW, 9))}</text>`;
		const segs = LEVEL_SEGMENTS[n.level] ?? 1;
		const bwid = 48;
		const sx = n.x - bwid / 2;
		for (let i = 0; i < 3; i++) {
			s += `<rect x="${sx + i * (bwid / 3 + 2)}" y="344" width="${bwid / 3 - 2}" height="4" rx="2" fill="${i < segs ? colr : T.stroke}"/>`;
		}
	}
	s += '</svg>';
	return s;
}

function renderBand1Mobile(model: Band1Model): string {
	const T = THEMES[model.theme];
	const isDark = model.theme === 'dark';
	const sem = (k: string) => SEM[k][isDark ? 'dark' : 'light'];
	const W = BAND_MOBILE_WIDTH;
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAND1_MOBILE_HEIGHT}" viewBox="0 0 ${W} ${BAND1_MOBILE_HEIGHT}" font-family="${FONT}">`;
	s += `<rect width="${W}" height="${BAND1_MOBILE_HEIGHT}" fill="${T.bg}"/>`;
	s += `<rect x="20" y="18" width="52" height="52" rx="11" fill="${T.panel2}" stroke="${sem('accent')}" stroke-width="2"/>`;
	s += `<text x="46" y="58" font-size="24" font-weight="800" fill="${sem('accent')}" text-anchor="middle">r</text>`;
	s += `<text x="84" y="42" font-size="18" font-weight="800" fill="${T.fg}">rebuildup</text>`;
	s += `<text x="84" y="62" font-size="10.5" fill="${T.muted}">design × code × motion</text>`;
	s += `<circle cx="84" cy="76" r="4" fill="${sem(model.presenceOk ? 'green' : 'orange')}"/>`;
	s += `<text x="94" y="80" font-size="9.5" fill="${T.muted}">${esc(model.presenceOk ? `${model.presenceLabel} · Discord` : `Discord ${model.presenceLabel}`)}</text>`;
	s += `<text x="${W - 16}" y="34" text-anchor="end" font-size="9" fill="${T.faint}">${esc(observedJst(model.observedAt ?? model.presenceObservedAt))}</text>`;
	s += `<line x1="20" y1="88" x2="${W - 20}" y2="88" stroke="${T.stroke}"/>`;

	// vitals 2x2
	const cw = (W - 40 - 10) / 2;
	const ch = 74;
	const vy = 100;
	const cells = [
		{ x: 20, y: vy },
		{ x: 20 + cw + 10, y: vy },
		{ x: 20, y: vy + ch + 10 },
		{ x: 20 + cw + 10, y: vy + ch + 10 },
	];
	for (const c of cells)
		s += `<rect x="${c.x}" y="${c.y}" width="${cw}" height="${ch}" rx="8" fill="${T.panel}" stroke="${T.stroke}"/>`;

	// streak
	{
		const streak = model.stats.currentStreak;
		if (streak !== null) {
			s += flame(cells[0].x + 24, cells[0].y + 34, 11, sem('orange'), '#ffd77a');
			s += `<text x="${cells[0].x + 42}" y="${cells[0].y + 42}" font-size="22" font-weight="800" fill="${T.fg}">${streak.toLocaleString('en-US')}</text>`;
			s += `<text x="${cells[0].x + cw / 2}" y="${cells[0].y + 62}" font-size="9.5" fill="${T.muted}" text-anchor="middle">day streak</text>`;
		} else {
			s += `<text x="${cells[0].x + 12}" y="${cells[0].y + 42}" font-size="20" font-weight="800" fill="${T.faint}">—</text>`;
			s += `<text x="${cells[0].x + cw / 2}" y="${cells[0].y + 62}" font-size="9.5" fill="${T.muted}" text-anchor="middle">streak unavailable</text>`;
		}
	}
	// langs
	{
		const langs = model.stats.topLangs;
		s += `<text x="${cells[1].x + 12}" y="${cells[1].y + 20}" font-size="9" fill="${T.muted}">TOP LANG</text>`;
		if (!langs || langs.length === 0) {
			s += `<text x="${cells[1].x + 12}" y="${cells[1].y + 48}" font-size="12" font-weight="700" fill="${T.faint}">—</text>`;
			s += `<text x="${cells[1].x + 12}" y="${cells[1].y + 62}" font-size="8.5" fill="${T.muted}">unavailable</text>`;
		} else {
			let acc = 0;
			const bw = cw - 24;
			for (const seg of langSegments(langs)) {
				const w = (bw * seg.pct) / 100;
				s += `<rect x="${cells[1].x + 12 + acc}" y="${cells[1].y + 30}" width="${w}" height="10" fill="${seg.color}"/>`;
				acc += w;
			}
			const top = langs[0];
			s += `<text x="${cells[1].x + 12}" y="${cells[1].y + 56}" font-size="11" font-weight="700" fill="${T.fg}">${esc(truncate(top.name, cw - 80, 11))}</text>`;
			s += `<text x="${cells[1].x + cw - 12}" y="${cells[1].y + 56}" font-size="9.5" fill="${T.muted}" text-anchor="end">${top.pct.toFixed(1)}%</text>`;
			let mswx = cells[1].x + 12;
			const mswy = cells[1].y + 69;
			for (const l of langs.slice(1, 3)) {
				s += `<rect x="${mswx}" y="${mswy - 6}" width="5" height="5" fill="${l.color}"/>`;
				s += `<text x="${mswx + 8}" y="${mswy}" font-size="8" fill="${T.faint}">${esc(l.name)} ${l.pct.toFixed(1)}</text>`;
				mswx += 8 + textWidth(l.name, 8) + 22;
			}
			if (langs.length > 3) {
				s += `<text x="${mswx + 2}" y="${mswy}" font-size="8" fill="${T.faint}">+${langs.length - 3}</text>`;
			}
		}
	}
	// contributed dots 9x3
	{
		const count = model.stats.contributedTo;
		s += `<text x="${cells[2].x + 12}" y="${cells[2].y + 20}" font-size="9" fill="${T.muted}">CONTRIBUTED TO${count === null ? '' : ` · ${count}`}</text>`;
		if (count === null) {
			s += `<text x="${cells[2].x + 12}" y="${cells[2].y + 50}" font-size="10" fill="${T.faint}">—</text>`;
		} else {
			const shown = Math.min(count, 27);
			for (let i = 0; i < shown; i++) {
				const dx = cells[2].x + 12 + (i % 9) * 12;
				const dy = cells[2].y + 36 + Math.floor(i / 9) * 11;
				s += `<circle cx="${dx}" cy="${dy}" r="3.6" fill="${sem('accent')}" opacity="${i < 24 ? 0.85 : 0.3}"/>`;
			}
			s += `<text x="${cells[2].x + cw - 12}" y="${cells[2].y + 66}" font-size="9" fill="${T.faint}" text-anchor="end">${count > 27 ? `+${count - 27} over` : 'all time'}</text>`;
		}
	}
	// rank ring
	{
		const level = model.stats.rankLevel;
		const pct = model.stats.rankPercentile;
		s += `<text x="${cells[3].x + 12}" y="${cells[3].y + 20}" font-size="9" fill="${T.muted}">RANK</text>`;
		const rcx = cells[3].x + 30;
		const rcy = cells[3].y + 44;
		const rr = 16;
		s += `<circle cx="${rcx}" cy="${rcy}" r="${rr}" fill="none" stroke="${T.panel2}" stroke-width="6"/>`;
		if (level !== null && pct !== null) {
			const frac = Math.min(1, Math.max(0.04, 1 - pct / 100));
			const a0 = -Math.PI / 2;
			const a1 = a0 + Math.PI * 2 * frac;
			s += `<path d="M ${rcx + rr * Math.cos(a0)} ${rcy + rr * Math.sin(a0)} A ${rr} ${rr} 0 1 1 ${rcx + rr * Math.cos(a1)} ${rcy + rr * Math.sin(a1)}" fill="none" stroke="${sem('accent')}" stroke-width="6" stroke-linecap="round"/>`;
			s += `<text x="${rcx}" y="${rcy + 4}" font-size="11" font-weight="800" fill="${T.fg}" text-anchor="middle">${esc(level)}</text>`;
			s += `<text x="${cells[3].x + 52}" y="${rcy + 3.5}" font-size="8.5" fill="${T.faint}">top ${pct.toFixed(1)}%</text>`;
		} else {
			s += `<text x="${rcx}" y="${rcy + 4}" font-size="11" font-weight="800" fill="${T.faint}" text-anchor="middle">—</text>`;
			s += `<text x="${cells[3].x + 52}" y="${rcy + 3.5}" font-size="8.5" fill="${T.faint}">unavailable</text>`;
		}
	}
	// focus rows
	const fy = 272;
	s += `<text x="20" y="${fy - 8}" font-size="10" font-weight="700" fill="${T.muted}" letter-spacing="1.2">IN PROGRESS</text>`;
	model.focus.forEach((n, i) => {
		const y = fy + i * 52;
		const colr = sem(n.colorKey);
		const r = n.level === 'primary' ? 20 : n.level === 'active' ? 17 : 14;
		s += `<circle cx="${20 + r}" cy="${y + r}" r="${r}" fill="${T.panel2}" stroke="${colr}" stroke-width="${n.level === 'primary' ? 2.6 : 1.6}"/>`;
		const gs = r * 1.1;
		s += `<svg x="${20 + r - gs / 2}" y="${y + r - gs / 2}" width="${gs}" height="${gs}" viewBox="0 0 24 24" color="${colr}">${GLYPHS[n.glyph] ?? GLYPHS.dot}</svg>`;
		s += `<text x="${20 + r * 2 + 14}" y="${y + r + 2}" font-size="12" font-weight="700" fill="${T.fg}">${esc(n.name)}</text>`;
		s += `<text x="${20 + r * 2 + 14}" y="${y + r + 18}" font-size="9.5" fill="${T.muted}">${esc(truncate(n.note, W - 60 - (20 + r * 2 + 14), 9.5))}</text>`;
		const segs = LEVEL_SEGMENTS[n.level] ?? 1;
		for (let g = 0; g < 3; g++) {
			s += `<rect x="${20 + r * 2 + 14 + g * 16}" y="${y + r * 2 + 8}" width="13" height="5" rx="2.5" fill="${g < segs ? colr : T.stroke}"/>`;
		}
	});
	const legendY = fy + model.focus.length * 52 + 30;
	s += `<text x="${W - 16}" y="${legendY}" text-anchor="end" font-size="8.5" fill="${T.faint}">▮▮▮ primary · ▮▮ active · ▮ side</text>`;
	s += '</svg>';
	return s;
}

export function renderBand1Svg(model: Band1Model): string {
	return model.mobile ? renderBand1Mobile(model) : renderBand1Desktop(model);
}

// ---- Band 2 ----

type ShapeFn = (x: number, y: number, c: string) => string;

const SHAPES: Record<string, ShapeFn> = {
	PushEvent: (x, y, c) => `<circle cx="${x}" cy="${y}" r="3.8" fill="${c}"/>`,
	PullRequestEvent: (x, y, c) =>
		`<rect x="${x - 3}" y="${y - 3}" width="6.5" height="6.5" rx="1.5" fill="${c}" transform="rotate(45 ${x} ${y})"/>`,
	CreateEvent: (x, y, c) =>
		`<path d="M${x} ${y - 4} L${x + 3.6} ${y + 2.6} L${x - 3.6} ${y + 2.6} Z" fill="${c}"/>`,
	DeleteEvent: (x, y, c) =>
		`<path d="M${x - 3} ${y - 3} L${x + 3} ${y + 3} M${x + 3} ${y - 3} L${x - 3} ${y + 3}" stroke="${c}" stroke-width="1.8"/>`,
};
const SHAPE_DEFAULT: ShapeFn = (x, y, c) =>
	`<rect x="${x - 3}" y="${y - 3}" width="6" height="6" rx="1.4" fill="${c}"/>`;
const shapeFor = (type: string): ShapeFn => SHAPES[type] ?? SHAPE_DEFAULT;

const LEGEND_TYPES: readonly [string, string][] = [
	['PushEvent', 'push'],
	['PullRequestEvent', 'PR'],
	['CreateEvent', 'new'],
	['DeleteEvent', 'del'],
];

const COMMIT_UNIT = 50;
const PR_UNIT = 100;
const MAX_DOTS = 18;
const MAX_SQUARES = 4;

function countLabel(c: number): string {
	return c >= 1000 ? `${(c / 1000).toFixed(1)}k` : String(c);
}

function renderBand2Desktop(model: Band2Model): string {
	const T = THEMES[model.theme];
	const isDark = model.theme === 'dark';
	const sem = (k: string) => SEM[k][isDark ? 'dark' : 'light'];
	const typeColor = (t: string) => sem(TYPE_COLOR[t] ?? 'accent');
	const W = BAND_WIDTH;
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAND2_HEIGHT}" viewBox="0 0 ${W} ${BAND2_HEIGHT}" font-family="${FONT}">`;
	s += `<rect width="${W}" height="${BAND2_HEIGHT}" fill="${T.bg}"/>`;
	s += `<text x="24" y="30" font-size="13" font-weight="700" fill="${T.fg}">GitHub activity</text>`;
	s += `<text x="${W - 24}" y="30" text-anchor="end" font-size="10" fill="${T.faint}">${model.windowDays}-day window · observed ${esc(observedJst(model.observedAt))}</text>`;

	// LEFT: repo output
	const lx = 24;
	const nameW = 140;
	const dotX = lx + nameW + 10;
	const dotStep = 8.5;
	const countsX = 464;
	const rx = 476;
	const rw = W - 24 - rx;
	s += `<text x="${lx}" y="54" font-size="10" font-weight="700" fill="${T.muted}" letter-spacing="1.2">REPO OUTPUT · ${model.windowDays}D</text>`;
	s += `<text x="${countsX - 6}" y="54" text-anchor="end" font-size="9" fill="${T.faint}">● commits · ■ ≈100 PRs · scaled</text>`;
	const ly = 66;
	const rowH = 23;
	model.rows.forEach((r, i) => {
		const y = ly + i * rowH;
		const op = r.dim ? 0.72 : 1;
		s += `<text x="${lx}" y="${y + 12}" font-size="10" fill="${r.dim ? T.muted : T.fg}" font-family="${MONO}" opacity="${op}">${esc(truncate(r.name, nameW - 8, 10))}</text>`;
		const nd = Math.min(MAX_DOTS, Math.floor(r.commits / COMMIT_UNIT));
		for (let d = 0; d < nd; d++) {
			const frac = (d + 1) / nd;
			s += `<circle cx="${dotX + d * dotStep}" cy="${y + 4}" r="3.2" fill="${sem('accent')}" opacity="${(0.45 + 0.55 * frac) * op}"/>`;
		}
		const prX = dotX + MAX_DOTS * dotStep + 10;
		const np = Math.min(MAX_SQUARES, Math.ceil(r.prs / PR_UNIT));
		for (let p = 0; p < np; p++) {
			s += `<rect x="${prX + p * 9}" y="${y}" width="6" height="6" fill="${sem('purple')}" opacity="${0.85 * op}"/>`;
		}
		s += `<text x="${countsX}" y="${y + 12}" text-anchor="end" font-size="9.5" font-family="${MONO}" fill="${T.faint}" opacity="${op}">${countLabel(r.commits)}c ${r.prs}p</text>`;
	});
	const leftBottom = ly + model.rows.length * rowH + 8;
	s += `<line x1="${lx}" y1="${leftBottom}" x2="${countsX}" y2="${leftBottom}" stroke="${T.stroke}"/>`;

	// RIGHT: 72h pulse
	s += `<text x="${rx}" y="54" font-size="10" font-weight="700" fill="${T.muted}" letter-spacing="1.2">LAST 72 HOURS</text>`;
	const py = 66;
	const ph = 118;
	const t2x = (t: string) =>
		rx + 10 + (1 - (model.nowMs - Date.parse(t)) / (72 * 3600e3)) * (rw - 20);
	s += `<rect x="${rx}" y="${py}" width="${rw}" height="${ph}" rx="8" fill="${T.panel}" stroke="${T.stroke}"/>`;
	const baseY = py + ph - 30;
	s += `<line x1="${rx + 10}" y1="${baseY}" x2="${rx + rw - 10}" y2="${baseY}" stroke="${T.stroke}"/>`;
	for (let h = 72; h >= 0; h -= 24) {
		const x = rx + 10 + (1 - h / 72) * (rw - 20);
		s += `<line x1="${x}" y1="${baseY - 5}" x2="${x}" y2="${baseY + 5}" stroke="${T.faint}"/>`;
		s += `<text x="${x}" y="${py + ph - 10}" font-size="8.5" fill="${T.faint}" text-anchor="middle">${h === 0 ? 'now' : `-${h}h`}</text>`;
	}
	// legend strip (dedicated top band — never shares y with events)
	let lxg = rx + 10;
	for (const [t, label] of LEGEND_TYPES) {
		s += shapeFor(t)(lxg + 4, py + 12, typeColor(t));
		s += `<text x="${lxg + 14}" y="${py + 15.5}" font-size="9" fill="${T.muted}">${label}</text>`;
		lxg += 14 + label.length * 5.5 + 12;
	}
	if (model.feed72.length === 0) {
		s += `<text x="${rx + rw / 2}" y="${py + ph / 2 + 4}" font-size="10" fill="${T.faint}" text-anchor="middle">no public events in 72h</text>`;
	} else {
		model.feed72.forEach((e, i) => {
			const x = t2x(e.at);
			const yy = py + 32 + ((i * 17) % (ph - 62));
			s += shapeFor(e.type)(x, yy, typeColor(e.type));
		});
	}
	// recent events
	model.feed72.slice(0, 3).forEach((e, i) => {
		const y = py + ph + 22 + i * 20;
		s += `<rect x="${rx + 4}" y="${y - 6}" width="7" height="7" rx="1.5" fill="${typeColor(e.type)}" transform="rotate(45 ${rx + 7.5} ${y - 2.5})"/>`;
		const repo = e.repoId.split('/').pop() ?? e.repoId;
		s += `<text x="${rx + 18}" y="${y}" font-size="10.5" fill="${T.fg}"><tspan font-weight="600" font-family="${MONO}">${esc(repo)}</tspan> <tspan fill="${T.muted}">${esc(TYPE_LABEL[e.type] ?? e.type.toLowerCase())} · ${esc(jstStamp(e.at))} JST</tspan></text>`;
	});
	s += `<text x="${W - 24}" y="${py + ph + 22 + 2 * 20 + 12}" text-anchor="end" font-size="9" fill="${T.faint}">${model.feed72.length} public events · times JST</text>`;
	s += '</svg>';
	return s;
}

function renderBand2Mobile(model: Band2Model): string {
	const T = THEMES[model.theme];
	const isDark = model.theme === 'dark';
	const sem = (k: string) => SEM[k][isDark ? 'dark' : 'light'];
	const typeColor = (t: string) => sem(TYPE_COLOR[t] ?? 'accent');
	const W = BAND_MOBILE_WIDTH;
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAND2_MOBILE_HEIGHT}" viewBox="0 0 ${W} ${BAND2_MOBILE_HEIGHT}" font-family="${FONT}">`;
	s += `<rect width="${W}" height="${BAND2_MOBILE_HEIGHT}" fill="${T.bg}"/>`;
	s += `<text x="20" y="28" font-size="12.5" font-weight="700" fill="${T.fg}">GitHub activity</text>`;
	s += `<text x="${W - 16}" y="28" text-anchor="end" font-size="8.5" fill="${T.faint}">${model.windowDays}d · ${esc(observedJst(model.observedAt).replace(' · ', ' '))}</text>`;

	// repo output: proportional bars
	s += `<text x="20" y="50" font-size="9.5" font-weight="700" fill="${T.muted}" letter-spacing="1">REPO OUTPUT · ${model.windowDays}D</text>`;
	s += `<text x="${W - 16}" y="50" text-anchor="end" font-size="8.5" fill="${T.faint}">bar = commits · ■ ≈100 PRs (scaled)</text>`;
	const maxC = Math.max(1, ...model.rows.filter((r) => !r.dim).map((r) => r.commits));
	const ly = 60;
	const rowH = 30;
	const barMax = 300;
	model.rows.forEach((r, i) => {
		const y = ly + i * rowH;
		const op = r.dim ? 0.72 : 1;
		s += `<text x="20" y="${y + 11}" font-size="9.5" font-family="${MONO}" fill="${r.dim ? T.muted : T.fg}" opacity="${op}">${esc(truncate(r.name, 160, 9.5))}</text>`;
		const w = barMax * (r.commits / maxC);
		s += `<rect x="20" y="${y + 17}" width="${Math.max(3, w)}" height="7" rx="3.5" fill="${sem('accent')}" opacity="${0.85 * op}"/>`;
		const np = Math.min(MAX_SQUARES, Math.ceil(r.prs / PR_UNIT));
		for (let p = 0; p < np; p++) {
			s += `<rect x="${20 + Math.max(3, w) + 8 + p * 9}" y="${y + 18}" width="6" height="6" fill="${sem('purple')}" opacity="${0.85 * op}"/>`;
		}
		s += `<text x="${W - 16}" y="${y + 22}" text-anchor="end" font-size="8.5" font-family="${MONO}" fill="${T.muted}" opacity="${op}">${countLabel(r.commits)}c ${r.prs}p</text>`;
	});
	const lb = ly + model.rows.length * rowH + 6;
	s += `<line x1="20" y1="${lb}" x2="${W - 20}" y2="${lb}" stroke="${T.stroke}"/>`;

	// 72h pulse full width
	const py = lb + 16;
	s += `<text x="20" y="${py}" font-size="9.5" font-weight="700" fill="${T.muted}" letter-spacing="1">LAST 72 HOURS</text>`;
	const ph = 120;
	const baseY = py + ph - 26;
	const t2x = (t: string) => 30 + (1 - (model.nowMs - Date.parse(t)) / (72 * 3600e3)) * (W - 60);
	s += `<rect x="20" y="${py + 12}" width="${W - 40}" height="${ph}" rx="8" fill="${T.panel}" stroke="${T.stroke}"/>`;
	s += `<line x1="30" y1="${baseY}" x2="${W - 30}" y2="${baseY}" stroke="${T.stroke}"/>`;
	let mlx = 34;
	for (const [t, label] of LEGEND_TYPES) {
		const yy = py + 24;
		s += shapeFor(t)(mlx + 4, yy, typeColor(t));
		s += `<text x="${mlx + 13}" y="${yy + 3}" font-size="8" fill="${T.muted}">${label}</text>`;
		mlx += 13 + label.length * 5 + 10;
	}
	for (let h = 72; h >= 0; h -= 24) {
		const x = 30 + (1 - h / 72) * (W - 60);
		s += `<text x="${x}" y="${py + 12 + ph - 8}" font-size="8" fill="${T.faint}" text-anchor="middle">${h === 0 ? 'now' : `-${h}h`}</text>`;
	}
	if (model.feed72.length === 0) {
		s += `<text x="${W / 2}" y="${py + 12 + ph / 2 + 4}" font-size="9.5" fill="${T.faint}" text-anchor="middle">no public events in 72h</text>`;
	} else {
		model.feed72.forEach((e, i) => {
			const x = t2x(e.at);
			const yy = py + 44 + ((i * 15) % (ph - 68));
			s += shapeFor(e.type)(x, yy, typeColor(e.type));
		});
	}
	// recent 3
	const ry = py + 12 + ph + 14;
	model.feed72.slice(0, 3).forEach((e, i) => {
		const y = ry + i * 22;
		s += `<rect x="24" y="${y - 5}" width="6" height="6" rx="1.3" fill="${typeColor(e.type)}" transform="rotate(45 27 ${y - 2})"/>`;
		const repo = e.repoId.split('/').pop() ?? e.repoId;
		s += `<text x="36" y="${y}" font-size="10" fill="${T.fg}"><tspan font-weight="600" font-family="${MONO}">${esc(repo)}</tspan> <tspan fill="${T.muted}">${esc(TYPE_LABEL[e.type] ?? e.type.toLowerCase())} · ${esc(jstStamp(e.at))} JST</tspan></text>`;
	});
	s += `<text x="${W - 16}" y="${ry + 2 * 22 + 16}" text-anchor="end" font-size="8.5" fill="${T.faint}">${model.feed72.length} public events · times JST</text>`;
	s += '</svg>';
	return s;
}

export function renderBand2Svg(model: Band2Model): string {
	return model.mobile ? renderBand2Mobile(model) : renderBand2Desktop(model);
}

// ---- model composition (pure, fail-closed) ----

/**
 * Assemble the Band 1 model. `stats` carries the GitHub-derived
 * figures (fetched + cached by the router, `null` fields render the
 * honest unavailable variant); `model` carries the validated
 * activity/presence projections; `roster` is the committed
 * current-projects roster.
 */
export function composeBand1Model(input: {
	readonly theme: 'dark' | 'light';
	readonly mobile: boolean;
	readonly model: ProfileCardModel;
	readonly stats: BandStats;
	readonly roster: readonly RosterEntry[];
	readonly now: number;
}): Band1Model {
	const observedCandidates = [input.model.discord.observedAt, input.model.github.observedAt].filter(
		(v): v is string => typeof v === 'string',
	);
	const observedAt = observedCandidates.sort().at(-1) ?? null;
	const dp = input.model.discord;
	const presenceOk = dp.state === 'ok';
	return {
		theme: input.theme,
		mobile: input.mobile,
		presenceLabel: presenceOk ? dp.statusLabel : dp.state === 'stale' ? 'stale' : 'unavailable',
		presenceOk,
		presenceObservedAt: dp.observedAt,
		stats: input.stats,
		focus: buildFocusNodes(input.roster),
		observedAt,
		generatedAt: new Date(input.now).toISOString(),
	};
}

/**
 * Assemble the Band 2 model from the stored activity snapshot.
 * Schema failure → empty rows/feed (the panels render their honest
 * empty states, never a 5xx).
 */
export function composeBand2Model(input: {
	readonly theme: 'dark' | 'light';
	readonly mobile: boolean;
	readonly activityPayload: unknown;
	readonly now: number;
}): Band2Model {
	const parsed = GitHubActivitySnapshotBody.safeParse(input.activityPayload);
	const snapshot = parsed.success ? parsed.data : null;
	const windowDays = snapshot?.windowDays ?? 30;
	const observedAt =
		snapshot?.sources.public.observedAt ?? snapshot?.sources.private.observedAt ?? null;
	// The 72h axis ends at the OBSERVATION instant, not render time:
	// snapshot events can never be newer than the collection stamp,
	// so anchoring to wall-clock would draw a false empty tail.
	const observedMs = observedAt ? Date.parse(observedAt) : Number.NaN;
	const axisNow = Number.isNaN(observedMs) ? input.now : observedMs;

	let rows: BandRepoRow[] = [];
	let feed72: BandEvent[] = [];
	if (snapshot) {
		const pubAll = snapshot.repos
			.filter((r) => r.kind === 'public')
			.map((r) => ({
				name: r.name.replace(/^rebuildup\//, ''),
				commits: r.activity?.commits ?? 0,
				prs: r.activity?.prs ?? 0,
				dim: false,
			}))
			.filter((r) => r.commits + r.prs > 0)
			.sort((a, b) => b.commits - a.commits || b.prs - a.prs);
		const priv = snapshot.repos.filter((r) => r.kind !== 'public');
		const privCommits = priv.reduce((a, r) => a + (r.activity?.commits ?? 0), 0);
		const privPrs = priv.reduce((a, r) => a + (r.activity?.prs ?? 0), 0);
		const topN = input.mobile ? 6 : 8;
		const rest = pubAll.slice(topN);
		rows = [
			...pubAll.slice(0, topN),
			...(rest.length > 0
				? [
						{
							name: `+${rest.length} more public`,
							commits: rest.reduce((a, r) => a + r.commits, 0),
							prs: rest.reduce((a, r) => a + r.prs, 0),
							dim: true,
						},
					]
				: []),
			...(privCommits + privPrs > 0
				? [{ name: 'private repos · sum', commits: privCommits, prs: privPrs, dim: true }]
				: []),
		];
		feed72 = snapshot.feed
			.filter((e) => e.kind === 'public')
			.filter((e) => axisNow - Date.parse(e.at) < 72 * 3600e3)
			.sort((a, b) => (a.at < b.at ? 1 : -1))
			.map((e) => ({ repoId: e.repoId, type: e.type, at: e.at }));
	}
	return {
		theme: input.theme,
		mobile: input.mobile,
		windowDays,
		rows,
		feed72,
		observedAt,
		generatedAt: new Date(input.now).toISOString(),
		nowMs: axisNow,
	};
}
