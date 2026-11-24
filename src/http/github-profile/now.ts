/**
 * GitHub profile "now" strip — unified status SVG (Issue #1205).
 *
 * One image combining GitHub streak / top language / totals, recent
 * public activity, Discord presence and the owner's DECLARED focus
 * areas. Sized for GitHub's mobile render: the canvas is narrow
 * (680px) and every label is set large enough that the ~308px mobile
 * display width still leaves body text readable; observation times
 * use a compact `Nov 22 · 05:00 UTC` form so they are not truncated.
 *
 * Data honesty rules (same contract as `status.ts` / ADR-0025):
 *   - a failed or absent upstream renders `—` with an `unavailable`
 *     note, never a guessed number;
 *   - GitHub-derived numbers come from the vendored readme-stats
 *     fetchers (public data only);
 *   - activity / presence come from the D1 snapshots via
 *     `composeProfileCardModel` — the same validation as `/status`;
 *   - repo counts are labelled as "repos active in the window", never
 *     as projects in progress — the DECLARED FOCUS panel is the only
 *     place curated project names appear. It reads the committed
 *     `home/current/roster.ts` data whose owner confirmation is still
 *     PENDING, so it is labelled "declared", not "in progress", and no
 *     weight, date or activity is invented;
 *   - every data source carries its observation time inside the image.
 *
 * Rendering is deterministic for a given input: no clock, no
 * randomness, no external fetch at render time.
 */

import { COLORS, FONT, escapeXml, textWidth, truncate } from './card';
import type { ProfileCardModel } from './model';

export const NOW_WIDTH = 800;
export const NOW_HEIGHT = 512;

const PAD_X = 24;
const HEADER_Y = 36;
const ACT_Y = 56;
const ACT_H = 140;
const BOT_Y = ACT_Y + ACT_H + 12;
const BOT_H = 170;
const BOT_GAP = 12;
const STATS_Y = BOT_Y + BOT_H + 12;
const STAT_GAP = 12;
const STAT_CELL_H = 104;
const INNER_X = 20;

/** `2026-11-22T06:11:00.000Z` → `Nov 22 · 15:11 JST` — matches the
 * activity card's timezone so the two images never disagree. */
function formatObservedCompact(iso: string | undefined): string {
	if (!iso) return 'unknown time';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return 'unknown time';
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Tokyo',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${get('month')} ${get('day')} · ${get('hour')}:${get('minute')} JST`;
}

/** `PullRequestEvent` → `pull request` — feed rows must not leak raw
 * GitHub event names into a profile card. */
function friendlyEventType(type: string): string {
	const map: Record<string, string> = {
		PullRequestEvent: 'pull request',
		PullRequestReviewEvent: 'PR review',
		PullRequestReviewCommentEvent: 'PR review comment',
		IssuesEvent: 'issue',
		IssueCommentEvent: 'issue comment',
		PushEvent: 'push',
		CreateEvent: 'create',
		DeleteEvent: 'delete',
		WatchEvent: 'star',
		ForkEvent: 'fork',
		ReleaseEvent: 'release',
		CommitCommentEvent: 'commit comment',
		DiscussionEvent: 'discussion',
	};
	return map[type] ?? type.replace(/Event$/, '').toLowerCase();
}

export interface NowStats {
	/** All-time public contributions (GitHub). */
	readonly totalContributions: number | null;
	/** Consecutive contribution days ending today. */
	readonly currentStreak: number | null;
	/** Longest contribution streak on record. */
	readonly longestStreak: number | null;
	/** Top language by byte share, e.g. `{ name: 'TypeScript', pct: 64 }`. */
	readonly topLanguage: { readonly name: string; readonly pct: number } | null;
}

interface StatCell {
	readonly label: string;
	readonly value: string;
	readonly unit: string;
}

/** Ellipsize so a long upstream string can never spill out of its panel. */
const fitText = (text: string, fontSize: number, maxWidth: number): string =>
	maxWidth < 24 ? '' : truncate(text, maxWidth, fontSize);

function statCells(stats: NowStats): readonly StatCell[] {
	const num = (value: number | null): string =>
		value === null ? '—' : value.toLocaleString('en-US');
	return [
		{
			label: 'Contributions',
			value: num(stats.totalContributions),
			unit: stats.totalContributions === null ? 'unavailable' : 'all time',
		},
		{
			label: 'Current streak',
			value: num(stats.currentStreak),
			unit: stats.currentStreak === null ? 'unavailable' : 'days',
		},
		{
			label: 'Longest streak',
			value: num(stats.longestStreak),
			unit: stats.longestStreak === null ? 'unavailable' : 'days',
		},
		{
			label: 'Top language',
			value: stats.topLanguage ? stats.topLanguage.name : '—',
			unit: stats.topLanguage ? `${stats.topLanguage.pct}%` : 'unavailable',
		},
	];
}

function renderStatCell(
	cell: StatCell,
	x: number,
	y: number,
	width: number,
	height: number = STAT_CELL_H,
): string {
	const innerX = x + INNER_X;
	const valueSize = cell.value.length > 7 ? 26 : cell.value.length > 5 ? 32 : 40;
	const fittedValue = fitText(cell.value, valueSize, width - INNER_X - 8);
	const fittedUnit = fitText(cell.unit, 16, width - INNER_X - 8);
	return `<g>
<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}"/>
<text x="${innerX}" y="${y + 26}" font-family="${FONT}" font-size="15" font-weight="600" fill="${COLORS.muted}" letter-spacing="1">${escapeXml(cell.label.toUpperCase())}</text>
<text x="${innerX}" y="${y + 72}" font-family="${FONT}" font-size="${valueSize}" font-weight="700" fill="${cell.value === '—' ? COLORS.faint : COLORS.text}">${escapeXml(fittedValue)}</text>
<text x="${innerX}" y="${y + 94}" font-family="${FONT}" font-size="16" fill="${COLORS.muted}">${escapeXml(fittedUnit)}</text>
</g>`;
}

function renderActivityPanel(
	model: ProfileCardModel,
	x: number,
	y: number,
	width: number,
	height: number = ACT_H,
): string {
	const innerX = x + INNER_X;
	const gh = model.github;
	const ok = gh.state === 'ok';
	// Repo counts describe activity inside the snapshot window — they
	// are NOT a count of projects in progress. The latest public feed
	// item is the meaningful headline; the repo id is shortened to its
	// last segment and the raw event type is humanised.
	const repoShort = gh.latest ? (gh.latest.repoId.split('/').pop() ?? gh.latest.repoId) : '';
	const headline = ok
		? gh.latest
			? `${repoShort} · ${friendlyEventType(gh.latest.type)}`
			: 'no public feed items in window'
		: 'GitHub activity unavailable';
	// The parenthetical honesty note and the dual timestamps only render
	// when the panel is wide enough — the mobile variant's 512px panels
	// would ellipsize them mid-word, which reads worse than omitting.
	const wide = width >= 620;
	const detail = ok
		? `${gh.publicRepos} public / ${gh.privateRepos} private repos active in ${gh.windowDays}d${wide ? ' (activity, not projects)' : ''}`
		: 'snapshot missing or unreadable';
	const metaY = y + 114;
	const textMax = width - INNER_X * 2 - 8;
	const fittedHeadline = fitText(headline, 26, textMax);
	const fittedDetail = fitText(detail, 18, textMax);
	const fittedMeta = fitText(
		wide
			? `${gh.latest && ok ? `latest ${formatObservedCompact(gh.latest.at)} · ` : ''}${gh.observedAt ? `observed ${formatObservedCompact(gh.observedAt)}` : 'no observation recorded'}`
			: gh.observedAt
				? `observed ${formatObservedCompact(gh.observedAt)}`
				: 'no observation recorded',
		17,
		textMax,
	);
	return `<g>
<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}"/>
<text x="${innerX}" y="${y + 34}" font-family="${FONT}" font-size="20" font-weight="600" fill="${COLORS.accent}" letter-spacing="1.5">GITHUB ACTIVITY</text>
<text x="${innerX}" y="${y + 66}" font-family="${FONT}" font-size="26" font-weight="600" fill="${ok ? COLORS.text : COLORS.stale}">${escapeXml(fittedHeadline)}</text>
<text x="${innerX}" y="${y + 92}" font-family="${FONT}" font-size="18" fill="${COLORS.muted}">${escapeXml(fittedDetail)}</text>
<text x="${innerX}" y="${metaY}" font-family="${FONT}" font-size="17" fill="${COLORS.faint}">${escapeXml(fittedMeta)}</text>
</g>`;
}

function renderDiscordPanel(
	model: ProfileCardModel,
	x: number,
	y: number,
	width: number,
	height: number = BOT_H,
): string {
	const innerX = x + INNER_X;
	const dp = model.discord;
	const titleY = y + 40;
	const ok = dp.state === 'ok';
	const headline = ok
		? dp.statusLabel
		: dp.state === 'stale'
			? 'presence stale'
			: 'presence unavailable';
	const detail = ok ? (dp.detail ?? 'no activity detail') : 'presence stale or unavailable';
	const textMax = width - INNER_X * 2 - 8;
	const fittedHeadline = fitText(headline, 28, textMax);
	const fittedDetail = fitText(detail, 18, textMax);
	const fittedObserved = fitText(
		dp.observedAt ? `observed ${formatObservedCompact(dp.observedAt)}` : 'no observation recorded',
		18,
		textMax,
	);
	return `<g>
<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}"/>
<circle cx="${innerX + 7}" cy="${titleY - 6}" r="7" fill="${ok ? COLORS.ok : dp.state === 'stale' ? COLORS.stale : COLORS.offline}"/>
<text x="${innerX + 20}" y="${titleY}" font-family="${FONT}" font-size="22" font-weight="600" fill="${COLORS.accent}" letter-spacing="1.5">DISCORD</text>
<text x="${innerX}" y="${y + 78}" font-family="${FONT}" font-size="28" font-weight="600" fill="${ok ? COLORS.text : COLORS.stale}">${escapeXml(fittedHeadline)}</text>
<text x="${innerX}" y="${y + 104}" font-family="${FONT}" font-size="19" fill="${COLORS.muted}">${escapeXml(fittedDetail)}</text>
<text x="${innerX}" y="${y + 134}" font-family="${FONT}" font-size="18" fill="${COLORS.faint}">${escapeXml(fittedObserved)}</text>
</g>`;
}

function renderProjectsPanel(
	projects: readonly string[],
	x: number,
	y: number,
	width: number,
	height: number = BOT_H,
): string {
	const innerX = x + INNER_X;
	const names = projects.slice(0, 4);
	const lines = names.length === 0 ? ['—'] : names;
	const textMax = width - INNER_X * 2 - 8;
	const nameSvgs = lines.map(
		(name, i) =>
			`<text x="${innerX}" y="${y + 66 + i * 22}" font-family="${FONT}" font-size="19" font-weight="600" fill="${COLORS.text}">• ${escapeXml(fitText(name, 19, textMax))}</text>`,
	);
	return `<g>
<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}"/>
<text x="${innerX}" y="${y + 38}" font-family="${FONT}" font-size="20" font-weight="600" fill="${COLORS.accent}" letter-spacing="1.5">DECLARED FOCUS</text>
${nameSvgs.join('\n')}
<text x="${innerX}" y="${y + height - 14}" font-family="${FONT}" font-size="15" fill="${COLORS.faint}">declared · rebuildup.dev</text>
</g>`;
}

/**
 * Render the unified status strip. `stats` carries the GitHub-derived
 * figures (already fetched + cached by the router); `model` carries
 * the validated activity / presence projections; `projects` carries
 * the committed roster names for the DECLARED FOCUS panel.
 */
export function renderProfileNowSvg(
	model: ProfileCardModel,
	stats: NowStats,
	projects: readonly string[],
): string {
	// Live status leads (activity → discord → declared focus); the
	// lifetime GitHub stats sit in one compact row underneath as
	// context, so "what is happening now" is never buried.
	const cells = statCells(stats);
	const statWidth = Math.floor((NOW_WIDTH - PAD_X * 2 - STAT_GAP * 3) / 4);
	const statSvgs = cells.map((cell, i) =>
		renderStatCell(cell, PAD_X + i * (statWidth + STAT_GAP), STATS_Y, statWidth),
	);
	const panelWidth = NOW_WIDTH - PAD_X * 2;
	const botWidth = Math.floor((panelWidth - BOT_GAP) / 2);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${NOW_WIDTH}" height="${NOW_HEIGHT}" viewBox="0 0 ${NOW_WIDTH} ${NOW_HEIGHT}" role="img" aria-label="rebuildup — GitHub stats, activity, declared focus areas and Discord presence">
<title>rebuildup — GitHub stats, activity, declared focus areas and Discord presence</title>
<desc>GitHub contribution stats, recent public activity, declared focus areas and Discord presence for @rebuildup, with observation times.</desc>
<rect width="${NOW_WIDTH}" height="${NOW_HEIGHT}" rx="16" fill="${COLORS.bg}" stroke="${COLORS.panelStroke}" stroke-width="1"/>
<text x="${PAD_X}" y="${HEADER_Y}" font-family="${FONT}" font-size="26" font-weight="700" fill="${COLORS.text}" letter-spacing="2">NOW · @rebuildup</text>
<text x="${NOW_WIDTH - PAD_X}" y="${HEADER_Y}" text-anchor="end" font-family="${FONT}" font-size="16" fill="${COLORS.faint}">${escapeXml(`generated ${formatObservedCompact(model.generatedAt)}`)}</text>
${renderActivityPanel(model, PAD_X, ACT_Y, panelWidth)}
${renderDiscordPanel(model, PAD_X, BOT_Y, botWidth)}
${renderProjectsPanel(projects, PAD_X + botWidth + BOT_GAP, BOT_Y, botWidth)}
${statSvgs.join('\n')}
</svg>`;
}

// ---- mobile variant (`?layout=mobile`) ----
// Same reasoning as the activity card: the 800px strip drops to ~0.45x
// on a phone and its metadata falls below readable size, so the route
// serves this stacked single-column variant that the README's
// <picture><source media> swap selects on narrow viewports.

export const NOW_MOBILE_WIDTH = 560;
const NM_PAD = 24;
const NM_W = NOW_MOBILE_WIDTH - NM_PAD * 2;
const NM_ACT_H = 140;
const NM_BOT_H = 168;
const NM_STAT_H = 104;
const NM_GAP = 12;

/** Stacked single-column variant for narrow viewports (`?layout=mobile`). */
export function renderProfileNowMobileSvg(
	model: ProfileCardModel,
	stats: NowStats,
	projects: readonly string[],
): string {
	const cells = statCells(stats);
	const statW = Math.floor((NM_W - NM_GAP) / 2);
	const actY = 56;
	const bot1Y = actY + NM_ACT_H + NM_GAP;
	const bot2Y = bot1Y + NM_BOT_H + NM_GAP;
	const statsY = bot2Y + NM_BOT_H + NM_GAP;
	const height = statsY + NM_STAT_H * 2 + NM_GAP + 24;
	const statSvgs = cells.map((cell, i) => {
		const col = i % 2;
		const row = Math.floor(i / 2);
		return renderStatCell(
			cell,
			NM_PAD + col * (statW + NM_GAP),
			statsY + row * (NM_STAT_H + NM_GAP),
			statW,
			NM_STAT_H,
		);
	});

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${NOW_MOBILE_WIDTH}" height="${height}" viewBox="0 0 ${NOW_MOBILE_WIDTH} ${height}" role="img" aria-label="rebuildup — GitHub stats, activity, declared focus areas and Discord presence">
<title>rebuildup — GitHub stats, activity, declared focus areas and Discord presence</title>
<desc>GitHub contribution stats, recent public activity, declared focus areas and Discord presence for @rebuildup, with observation times.</desc>
<rect width="${NOW_MOBILE_WIDTH}" height="${height}" rx="16" fill="${COLORS.bg}" stroke="${COLORS.panelStroke}" stroke-width="1"/>
<text x="${NM_PAD}" y="38" font-family="${FONT}" font-size="22" font-weight="700" fill="${COLORS.text}" letter-spacing="1.5">NOW · @rebuildup</text>
<text x="${NOW_MOBILE_WIDTH - NM_PAD}" y="38" text-anchor="end" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">${escapeXml(`generated ${formatObservedCompact(model.generatedAt)}`)}</text>
${renderActivityPanel(model, NM_PAD, actY, NM_W, NM_ACT_H)}
${renderDiscordPanel(model, NM_PAD, bot1Y, NM_W, NM_BOT_H)}
${renderProjectsPanel(projects, NM_PAD, bot2Y, NM_W, NM_BOT_H)}
${statSvgs.join('\n')}
</svg>`;
}
