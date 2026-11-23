/**
 * GitHub profile "now" strip — unified status SVG (Issue #1205).
 *
 * One image replacing the four separate readme-stats cards: GitHub
 * streak / top language / totals plus the live GitHub-activity and
 * Discord-presence panels, all on the same dark surface as `/status`.
 * Every figure carries its meaning in a short label and every data
 * source carries its observation time inside the image — nothing here
 * claims realtime freshness it does not have.
 *
 * Data honesty rules (same contract as `status.ts` / ADR-0025):
 *   - a failed or absent upstream renders `—` with an `unavailable`
 *     note, never a guessed number;
 *   - GitHub-derived numbers come from the vendored readme-stats
 *     fetchers (public data only);
 *   - activity / presence come from the D1 snapshots via
 *     `composeProfileCardModel` — the same validation as `/status`.
 *
 * Rendering is deterministic for a given input: no clock, no
 * randomness, no external fetch at render time.
 */

import { COLORS, FONT, escapeXml, formatObserved, textWidth } from './card';
import type { ProfileCardModel } from './model';

export const NOW_WIDTH = 1200;
export const NOW_HEIGHT = 400;

const PAD_X = 28;
const PAD_Y = 20;
const CELL_GAP = 16;
const STAT_CELL_H = 148;
const PANEL_GAP = 16;
const PANEL_H = 168;

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
	const innerX = x + 20;
	const labelY = y + 34;
	const valueY = y + 92;
	const unitY = y + 118;
	const noteY = y + 140;
	const valueSize = cell.value.length > 7 ? 34 : 44;
	return `<g>
<rect x="${x}" y="${y}" width="${width}" height="${STAT_CELL_H}" rx="10" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}"/>
<text x="${innerX}" y="${labelY}" font-family="${FONT}" font-size="15" font-weight="600" fill="${COLORS.muted}" letter-spacing="1">${escapeXml(cell.label.toUpperCase())}</text>
<text x="${innerX}" y="${valueY}" font-family="${FONT}" font-size="${valueSize}" font-weight="700" fill="${cell.value === '—' ? COLORS.faint : COLORS.text}">${escapeXml(cell.value)}</text>
<text x="${innerX + textWidth(cell.value, valueSize) + 10}" y="${valueY - 8}" font-family="${FONT}" font-size="16" fill="${COLORS.muted}">${escapeXml(cell.unit)}</text>
${cell.note ? `<text x="${innerX}" y="${noteY}" font-family="${FONT}" font-size="13" fill="${COLORS.stale}">${escapeXml(cell.note)}</text>` : ''}
</g>`;
}

function renderActivityPanel(model: ProfileCardModel, x: number, y: number, width: number): string {
	const innerX = x + 20;
	const gh = model.github;
	const titleY = y + 32;
	const line1Y = y + 68;
	const line2Y = y + 98;
	const line3Y = y + 128;
	const noteY = y + 154;
	let headline: string;
	let detail: string;
	if (gh.state === 'ok') {
		headline = `${gh.publicRepos} public · ${gh.privateRepos} private projects active`;
		detail = gh.latest
			? `latest: ${gh.latest.repoId} — ${gh.latest.type} · ${formatObserved(gh.latest.at)}`
			: 'no public feed items in window';
	} else {
		headline = 'GitHub activity unavailable';
		detail = 'snapshot missing or unreadable';
	}
	return `<g>
<rect x="${x}" y="${y}" width="${width}" height="${PANEL_H}" rx="10" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}"/>
<text x="${innerX}" y="${titleY}" font-family="${FONT}" font-size="15" font-weight="600" fill="${COLORS.accent}" letter-spacing="1">GITHUB ACTIVITY</text>
<text x="${innerX}" y="${line1Y}" font-family="${FONT}" font-size="20" font-weight="600" fill="${gh.state === 'ok' ? COLORS.text : COLORS.stale}">${escapeXml(headline)}</text>
<text x="${innerX}" y="${line2Y}" font-family="${FONT}" font-size="15" fill="${COLORS.muted}">${escapeXml(detail)}</text>
<text x="${innerX}" y="${line3Y}" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">window ${gh.windowDays}d${gh.observedAt ? ` · observed ${formatObserved(gh.observedAt)}` : ''}</text>
<text x="${innerX}" y="${noteY}" font-family="${FONT}" font-size="12" fill="${COLORS.faint}">counts from the public activity snapshot; private = aggregate only</text>
</g>`;
}

function renderDiscordPanel(model: ProfileCardModel, x: number, y: number, width: number): string {
	const innerX = x + 20;
	const dp = model.discord;
	const titleY = y + 32;
	const line1Y = y + 68;
	const line2Y = y + 98;
	const line3Y = y + 128;
	const noteY = y + 154;
	const ok = dp.state === 'ok';
	const headline = ok
		? dp.statusLabel
		: dp.state === 'stale'
			? 'presence stale'
			: 'presence unavailable';
	const detail = ok
		? (dp.detail ?? 'no activity detail')
		: 'snapshot missing, stale, or identity-mismatched';
	return `<g>
<rect x="${x}" y="${y}" width="${width}" height="${PANEL_H}" rx="10" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}"/>
<circle cx="${innerX + 6}" cy="${titleY - 5}" r="6" fill="${ok ? COLORS.ok : dp.state === 'stale' ? COLORS.stale : COLORS.offline}"/>
<text x="${innerX + 18}" y="${titleY}" font-family="${FONT}" font-size="15" font-weight="600" fill="${COLORS.accent}" letter-spacing="1">DISCORD</text>
<text x="${innerX}" y="${line1Y}" font-family="${FONT}" font-size="20" font-weight="600" fill="${ok ? COLORS.text : COLORS.stale}">${escapeXml(headline)}</text>
<text x="${innerX}" y="${line2Y}" font-family="${FONT}" font-size="15" fill="${COLORS.muted}">${escapeXml(detail)}</text>
<text x="${innerX}" y="${line3Y}" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">${dp.observedAt ? `observed ${formatObserved(dp.observedAt)}` : 'no observation recorded'}</text>
<text x="${innerX}" y="${noteY}" font-family="${FONT}" font-size="12" fill="${COLORS.faint}">presence snapshot · stale after the freshness window</text>
</g>`;
}

/**
 * Render the unified status strip. `stats` carries the GitHub-derived
 * figures (already fetched + cached by the router); `model` carries
 * the validated activity / presence projections.
 */
export function renderProfileNowSvg(model: ProfileCardModel, stats: NowStats): string {
	const cells = statCells(stats);
	const statWidth = Math.floor(
		(NOW_WIDTH - PAD_X * 2 - CELL_GAP * (cells.length - 1)) / cells.length,
	);
	const statY = PAD_Y;
	const panelY = statY + STAT_CELL_H + PANEL_GAP;
	const panelWidth = Math.floor((NOW_WIDTH - PAD_X * 2 - PANEL_GAP) / 2);
	const generated = `generated ${formatObserved(model.generatedAt)}`;

	const statSvgs = cells.map((cell, i) =>
		renderStatCell(cell, PAD_X + i * (statWidth + CELL_GAP), statY, statWidth),
	);
	const activitySvg = renderActivityPanel(model, PAD_X, panelY, panelWidth);
	const discordSvg = renderDiscordPanel(model, PAD_X + panelWidth + PANEL_GAP, panelY, panelWidth);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${NOW_WIDTH}" height="${NOW_HEIGHT}" viewBox="0 0 ${NOW_WIDTH} ${NOW_HEIGHT}" role="img" aria-label="rebuildup — GitHub streak, activity and Discord presence">
<title>rebuildup — GitHub streak, activity and Discord presence</title>
<desc>GitHub contribution stats, recent public activity and Discord presence for @rebuildup, with observation times.</desc>
<rect width="${NOW_WIDTH}" height="${NOW_HEIGHT}" fill="${COLORS.bg}"/>
<text x="${PAD_X}" y="${PAD_Y + 6}" font-family="${FONT}" font-size="16" font-weight="700" fill="${COLORS.text}" letter-spacing="2">NOW · @rebuildup</text>
<text x="${NOW_WIDTH - PAD_X}" y="${PAD_Y + 6}" text-anchor="end" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">${escapeXml(generated)}</text>
${statSvgs.join('\n')}
${activitySvg}
${discordSvg}
</svg>`;
}
