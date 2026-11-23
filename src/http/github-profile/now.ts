/**
 * GitHub profile "now" strip — unified status SVG (Issue #1205).
 *
 * One image combining GitHub streak / top language / totals, recent
 * public activity, Discord presence and the owner's declared
 * in-progress projects. Sized for GitHub's mobile render: the canvas
 * is narrow (680px) and every label is set large enough that the
 * ~308px mobile display width still leaves body text above ~10px.
 *
 * Data honesty rules (same contract as `status.ts` / ADR-0025):
 *   - a failed or absent upstream renders `—` with an `unavailable`
 *     note, never a guessed number;
 *   - GitHub-derived numbers come from the vendored readme-stats
 *     fetchers (public data only);
 *   - activity / presence come from the D1 snapshots via
 *     `composeProfileCardModel` — the same validation as `/status`;
 *   - repo counts are labelled as "repos active in the window", never
 *     as projects in progress — the IN PROGRESS panel is the only
 *     place curated project names appear, and it reads the committed
 *     `home/current/roster.ts` data (no invented weight or status);
 *   - every data source carries its observation time inside the image.
 *
 * Rendering is deterministic for a given input: no clock, no
 * randomness, no external fetch at render time.
 */

import { COLORS, FONT, escapeXml, formatObserved, textWidth, truncate } from './card';
import type { ProfileCardModel } from './model';

export const NOW_WIDTH = 680;
export const NOW_HEIGHT = 840;

const PAD_X = 24;
const HEADER_Y = 36;
const STAT_Y = 60;
const STAT_GAP = 16;
const STAT_CELL_H = 196;
const ACT_Y = STAT_Y + STAT_CELL_H * 2 + STAT_GAP + STAT_GAP;
const ACT_H = 168;
const BOT_Y = ACT_Y + ACT_H + STAT_GAP;
const BOT_H = 168;
const BOT_GAP = STAT_GAP;
const INNER_X = 20;

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
	readonly note: string | null;
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
			unit: 'all time',
			note: stats.totalContributions === null ? 'unavailable' : null,
		},
		{
			label: 'Current streak',
			value: num(stats.currentStreak),
			unit: 'days',
			note: stats.currentStreak === null ? 'unavailable' : null,
		},
		{
			label: 'Longest streak',
			value: num(stats.longestStreak),
			unit: 'days',
			note: stats.longestStreak === null ? 'unavailable' : null,
		},
		{
			label: 'Top language',
			value: stats.topLanguage ? stats.topLanguage.name : '—',
			unit: stats.topLanguage ? `${stats.topLanguage.pct}%` : 'unavailable',
			note: null,
		},
	];
}

function renderStatCell(cell: StatCell, x: number, y: number, width: number): string {
	const innerX = x + INNER_X;
	const labelY = y + 38;
	const valueY = y + 116;
	const noteY = y + 168;
	const unitY = y + 146;
	const valueSize = cell.value.length > 7 ? 44 : 56;
	const fittedValue = fitText(cell.value, valueSize, width - INNER_X * 2);
	const fittedUnit = fitText(cell.unit, 20, width - INNER_X * 2);
	return `<g>
<rect x="${x}" y="${y}" width="${width}" height="${STAT_CELL_H}" rx="12" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}"/>
<text x="${innerX}" y="${labelY}" font-family="${FONT}" font-size="24" font-weight="600" fill="${COLORS.muted}" letter-spacing="1.5">${escapeXml(cell.label.toUpperCase())}</text>
<text x="${innerX}" y="${valueY}" font-family="${FONT}" font-size="${valueSize}" font-weight="700" fill="${cell.value === '—' ? COLORS.faint : COLORS.text}">${escapeXml(fittedValue)}</text>
${fittedUnit ? `<text x="${innerX}" y="${unitY}" font-family="${FONT}" font-size="20" fill="${COLORS.muted}">${escapeXml(fittedUnit)}</text>` : ''}
${cell.note ? `<text x="${innerX}" y="${noteY}" font-family="${FONT}" font-size="20" fill="${COLORS.stale}">${escapeXml(cell.note)}</text>` : ''}
</g>`;
}

function renderActivityPanel(model: ProfileCardModel, x: number, y: number, width: number): string {
	const innerX = x + INNER_X;
	const gh = model.github;
	const ok = gh.state === 'ok';
	// Repo counts describe activity inside the snapshot window — they
	// are NOT a count of projects in progress. The latest public feed
	// item is the meaningful headline.
	const headline = ok
		? gh.latest
			? `${gh.latest.repoId} · ${gh.latest.type}`
			: 'no public feed items in window'
		: 'GitHub activity unavailable';
	const detail = ok
		? `${gh.publicRepos} public / ${gh.privateRepos} private repos active in ${gh.windowDays}d`
		: 'snapshot missing or unreadable';
	const metaY = y + 136;
	const noteY = y + 158;
	const textMax = width - INNER_X * 2 - 8;
	const fittedHeadline = fitText(headline, 30, textMax);
	const fittedDetail = fitText(detail, 22, textMax);
	const fittedMeta = fitText(
		`${gh.latest && ok ? `latest ${formatObserved(gh.latest.at)} · ` : ''}${gh.observedAt ? `observed ${formatObserved(gh.observedAt)}` : 'no observation recorded'}`,
		20,
		textMax,
	);
	const fittedNote = fitText('window repo activity, not projects in progress', 20, textMax);
	return `<g>
<rect x="${x}" y="${y}" width="${width}" height="${ACT_H}" rx="12" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}"/>
<text x="${innerX}" y="${y + 40}" font-family="${FONT}" font-size="24" font-weight="600" fill="${COLORS.accent}" letter-spacing="1.5">GITHUB ACTIVITY</text>
<text x="${innerX}" y="${y + 84}" font-family="${FONT}" font-size="30" font-weight="600" fill="${ok ? COLORS.text : COLORS.stale}">${escapeXml(fittedHeadline)}</text>
<text x="${innerX}" y="${y + 116}" font-family="${FONT}" font-size="22" fill="${COLORS.muted}">${escapeXml(fittedDetail)}</text>
<text x="${innerX}" y="${metaY}" font-family="${FONT}" font-size="20" fill="${COLORS.faint}">${escapeXml(fittedMeta)}</text>
<text x="${innerX}" y="${noteY}" font-family="${FONT}" font-size="20" fill="${COLORS.faint}">${escapeXml(fittedNote)}</text>
</g>`;
}

function renderDiscordPanel(model: ProfileCardModel, x: number, y: number, width: number): string {
	const innerX = x + INNER_X;
	const dp = model.discord;
	const titleY = y + 40;
	const ok = dp.state === 'ok';
	const headline = ok
		? dp.statusLabel
		: dp.state === 'stale'
			? 'presence stale'
			: 'presence unavailable';
	const detail = ok
		? (dp.detail ?? 'no activity detail')
		: 'snapshot missing, stale, or identity-mismatched';
	const textMax = width - INNER_X * 2 - 8;
	const fittedHeadline = fitText(headline, 30, textMax);
	const fittedDetail = fitText(detail, 21, textMax);
	const fittedObserved = fitText(
		dp.observedAt ? `observed ${formatObserved(dp.observedAt)}` : 'no observation recorded',
		20,
		textMax,
	);
	return `<g>
<rect x="${x}" y="${y}" width="${width}" height="${BOT_H}" rx="12" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}"/>
<circle cx="${innerX + 7}" cy="${titleY - 6}" r="7" fill="${ok ? COLORS.ok : dp.state === 'stale' ? COLORS.stale : COLORS.offline}"/>
<text x="${innerX + 20}" y="${titleY}" font-family="${FONT}" font-size="24" font-weight="600" fill="${COLORS.accent}" letter-spacing="1.5">DISCORD</text>
<text x="${innerX}" y="${y + 92}" font-family="${FONT}" font-size="30" font-weight="600" fill="${ok ? COLORS.text : COLORS.stale}">${escapeXml(fittedHeadline)}</text>
<text x="${innerX}" y="${y + 124}" font-family="${FONT}" font-size="21" fill="${COLORS.muted}">${escapeXml(fittedDetail)}</text>
<text x="${innerX}" y="${y + 152}" font-family="${FONT}" font-size="20" fill="${COLORS.faint}">${escapeXml(fittedObserved)}</text>
</g>`;
}

function renderProjectsPanel(
	projects: readonly string[],
	x: number,
	y: number,
	width: number,
): string {
	const innerX = x + INNER_X;
	const names = projects.slice(0, 4);
	const lines = names.length === 0 ? ['—'] : names;
	const textMax = width - INNER_X * 2 - 8;
	const nameSvgs = lines.map(
		(name, i) =>
			`<text x="${innerX}" y="${y + 70 + i * 24}" font-family="${FONT}" font-size="22" font-weight="600" fill="${COLORS.text}">• ${escapeXml(fitText(name, 22, textMax))}</text>`,
	);
	return `<g>
<rect x="${x}" y="${y}" width="${width}" height="${BOT_H}" rx="12" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}"/>
<text x="${innerX}" y="${y + 40}" font-family="${FONT}" font-size="24" font-weight="600" fill="${COLORS.accent}" letter-spacing="1.5">IN PROGRESS</text>
${nameSvgs.join('\n')}
<text x="${innerX}" y="${y + BOT_H - 12}" font-family="${FONT}" font-size="18" fill="${COLORS.faint}">declared roster · rebuildup.dev</text>
</g>`;
}

/**
 * Render the unified status strip. `stats` carries the GitHub-derived
 * figures (already fetched + cached by the router); `model` carries
 * the validated activity / presence projections; `projects` carries
 * the committed roster names for the IN PROGRESS panel.
 */
export function renderProfileNowSvg(
	model: ProfileCardModel,
	stats: NowStats,
	projects: readonly string[],
): string {
	const cells = statCells(stats);
	const statWidth = Math.floor((NOW_WIDTH - PAD_X * 2 - STAT_GAP) / 2);
	const statSvgs = cells.map((cell, i) => {
		const col = i % 2;
		const row = Math.floor(i / 2);
		return renderStatCell(
			cell,
			PAD_X + col * (statWidth + STAT_GAP),
			STAT_Y + row * (STAT_CELL_H + STAT_GAP),
			statWidth,
		);
	});
	const panelWidth = NOW_WIDTH - PAD_X * 2;
	const botWidth = Math.floor((panelWidth - BOT_GAP) / 2);
	const generated = `generated ${formatObserved(model.generatedAt)}`;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${NOW_WIDTH}" height="${NOW_HEIGHT}" viewBox="0 0 ${NOW_WIDTH} ${NOW_HEIGHT}" role="img" aria-label="rebuildup — GitHub stats, activity, in-progress projects and Discord presence">
<title>rebuildup — GitHub stats, activity, in-progress projects and Discord presence</title>
<desc>GitHub contribution stats, recent public activity, declared in-progress projects and Discord presence for @rebuildup, with observation times.</desc>
<rect width="${NOW_WIDTH}" height="${NOW_HEIGHT}" fill="${COLORS.bg}"/>
<text x="${PAD_X}" y="${HEADER_Y}" font-family="${FONT}" font-size="30" font-weight="700" fill="${COLORS.text}" letter-spacing="2">NOW · @rebuildup</text>
<text x="${NOW_WIDTH - PAD_X}" y="${HEADER_Y}" text-anchor="end" font-family="${FONT}" font-size="20" fill="${COLORS.faint}">${escapeXml(generated)}</text>
${statSvgs.join('\n')}
${renderActivityPanel(model, PAD_X, ACT_Y, panelWidth)}
${renderDiscordPanel(model, PAD_X, BOT_Y, botWidth)}
${renderProjectsPanel(projects, PAD_X + botWidth + BOT_GAP, BOT_Y, botWidth)}
</svg>`;
}
