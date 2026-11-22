/**
 * GitHub profile card — SVG composer (Issue #1170, ADR-0024).
 *
 * Pure string generation: `ProfileCardModel` in, `image/svg+xml`
 * bytes out. No fetch, no binding, no clock — `generatedAt` arrives
 * inside the model so the same input always renders the same bytes.
 *
 * Design contract (ADR-0024 §2.5):
 *   - fixed dark surface, readable identically on GitHub's light and
 *     dark themes (no `prefers-color-scheme` — SVG-as-image behaviour
 *     is environment-dependent);
 *   - every dynamic claim carries its observation time inside the
 *     image, so a cached copy can never masquerade as fresher than it
 *     is;
 *   - no links or button-like elements inside the image — Camo
 *     proxies the bytes and inner links cannot work; navigation stays
 *     in the README's Markdown.
 */

import type { ProfileCardModel, ProfileCardWork } from './model';

export const CARD_WIDTH = 1280;
export const CARD_HEIGHT = 720;

const COLORS = {
	bg: '#0B0F14',
	panel: '#12181F',
	panelStroke: '#2A3340',
	text: '#E6EDF3',
	muted: '#8B98A5',
	faint: '#5B6B7C',
	accent: '#58A6FF',
	ok: '#3FB950',
	stale: '#D29922',
	offline: '#6E7681',
} as const;

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/** Rough advance-width estimate: CJK/full-width ≈ 1em, latin ≈ 0.56em. */
function textWidth(text: string, fontSize: number): number {
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
		width += wide ? fontSize : fontSize * 0.56;
	}
	return width;
}

/**
 * Greedy word wrap to `maxLines`; the last line ellipsizes. SVG has no
 * auto-wrap, so the composer owns it.
 */
function wrapText(text: string, maxWidth: number, fontSize: number, maxLines = 1): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const all: string[] = [];
	let current = '';
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (textWidth(candidate, fontSize) <= maxWidth) {
			current = candidate;
		} else {
			if (current) all.push(current);
			current = word;
		}
	}
	if (current) all.push(current);
	if (all.length <= maxLines) {
		// A single over-wide token (no spaces) still ellipsizes.
		return all.map((line) => truncate(line, maxWidth, fontSize));
	}
	const kept = all.slice(0, maxLines);
	let last = kept[maxLines - 1] ?? '';
	while (last.length > 1 && textWidth(`${last}…`, fontSize) > maxWidth) {
		last = last.slice(0, -1);
	}
	kept[maxLines - 1] = `${last}…`;
	return kept;
}

function truncate(text: string, maxWidth: number, fontSize: number): string {
	if (textWidth(text, fontSize) <= maxWidth) return text;
	let out = text;
	while (out.length > 1 && textWidth(`${out}…`, fontSize) > maxWidth) {
		out = out.slice(0, -1);
	}
	return `${out}…`;
}

/** `2026-11-22T06:11:00.000Z` → `Nov 22, 2026, 6:11 AM` (en-US, UTC). */
function formatObserved(iso: string | undefined): string {
	if (!iso) return 'unknown time';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return 'unknown time';
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: 'UTC',
		timeZoneName: 'short',
	}).format(date);
}

function formatDay(iso: string | undefined): string {
	if (!iso) return 'unknown date';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return 'unknown date';
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(date);
}

interface WorkTileProps {
	readonly work: ProfileCardWork;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly index: number;
}

const TILE_IMAGE_HEIGHT = 176;
const TILE_TITLE_SIZE = 26;
const TILE_SUMMARY_SIZE = 19;

function renderWorkTile({ work, x, y, width, index }: WorkTileProps): string {
	const imageHeight = TILE_IMAGE_HEIGHT;
	const clipId = `work-clip-${index}`;
	const titleLines = wrapText(work.title, width, TILE_TITLE_SIZE, 2);
	const summary = truncate(work.summary, width, TILE_SUMMARY_SIZE);
	const titleY = y + imageHeight + 18;
	const summaryY = titleY + titleLines.length * (TILE_TITLE_SIZE + 8) + 8;
	return `
	<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${imageHeight}" rx="12"/></clipPath>
	<image href="${escapeXml(work.imageUrl)}" x="${x}" y="${y}" width="${width}" height="${imageHeight}"
		preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})">
		<title>${escapeXml(work.alt)}</title>
	</image>
	<rect x="${x}" y="${y}" width="${width}" height="${imageHeight}" rx="12" fill="none" stroke="${COLORS.panelStroke}" stroke-width="1"/>
	${titleLines
		.map(
			(line, i) =>
				`<text x="${x}" y="${titleY + i * (TILE_TITLE_SIZE + 8)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${TILE_TITLE_SIZE}" font-weight="700" fill="${COLORS.text}">${escapeXml(line)}</text>`,
		)
		.join('')}
	<text x="${x}" y="${summaryY}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${TILE_SUMMARY_SIZE}" fill="${COLORS.muted}">${escapeXml(summary)}</text>`;
}

function renderGitHubPanel(
	model: ProfileCardModel,
	x: number,
	y: number,
	width: number,
	height: number,
): string {
	const github = model.github;
	const innerX = x + 28;
	const innerWidth = width - 56;
	let body = '';
	if (github.state === 'ok') {
		const counts = `${github.publicRepos} public · ${github.privateRepos} private project${github.privateRepos === 1 ? '' : 's'} active`;
		const latest = github.latest
			? truncate(
					`latest: ${github.latest.repoId} — ${github.latest.type} · ${formatDay(github.latest.at)}`,
					innerWidth,
					20,
				)
			: 'no public feed events in window';
		body = `
	<text x="${innerX}" y="${y + 76}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="26" font-weight="600" fill="${COLORS.text}">${escapeXml(counts)}</text>
	<text x="${innerX}" y="${y + 108}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="20" fill="${COLORS.muted}">${escapeXml(latest)}</text>`;
	} else {
		body = `
	<text x="${innerX}" y="${y + 92}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="24" fill="${COLORS.muted}">No GitHub activity observed yet.</text>`;
	}
	const observed = github.observedAt
		? `observed ${formatObserved(github.observedAt)}`
		: 'never observed';
	return `
	<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}" stroke-width="1"/>
	<circle cx="${x + 28}" cy="${y + 34}" r="6" fill="${github.state === 'ok' ? COLORS.ok : COLORS.offline}"/>
	<text x="${x + 44}" y="${y + 40}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="18" font-weight="700" letter-spacing="2" fill="${COLORS.faint}">GITHUB ACTIVITY</text>
	${body}
	<text x="${x + width - 28}" y="${y + height - 18}" text-anchor="end" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="16" fill="${COLORS.faint}">${escapeXml(observed)}</text>`;
}

function renderDiscordPanel(
	model: ProfileCardModel,
	x: number,
	y: number,
	width: number,
	height: number,
): string {
	const discord = model.discord;
	const innerX = x + 28;
	const innerWidth = width - 56;
	let dotColor: string = COLORS.offline;
	let headline = 'Discord presence unavailable';
	let detail = '';
	let footer = '';
	if (discord.state === 'ok') {
		dotColor = discord.statusLabel === 'Online' ? COLORS.ok : COLORS.stale;
		headline = discord.statusLabel;
		detail = discord.detail ? truncate(discord.detail, innerWidth, 20) : '';
		footer = `observed ${formatObserved(discord.observedAt)}`;
	} else if (discord.state === 'stale') {
		dotColor = COLORS.stale;
		headline = 'Presence stale';
		footer = discord.observedAt
			? `last seen ${formatObserved(discord.observedAt)}`
			: 'feed not reporting';
	}
	return `
	<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}" stroke-width="1"/>
	<circle cx="${x + 28}" cy="${y + 34}" r="6" fill="${dotColor}"/>
	<text x="${x + 44}" y="${y + 40}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="18" font-weight="700" letter-spacing="2" fill="${COLORS.faint}">DISCORD</text>
	<text x="${innerX}" y="${y + 92}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="24" font-weight="600" fill="${COLORS.text}">${escapeXml(headline)}</text>
	${detail ? `<text x="${innerX}" y="${y + 122}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="20" fill="${COLORS.muted}">${escapeXml(detail)}</text>` : ''}
	${footer ? `<text x="${x + width - 28}" y="${y + height - 18}" text-anchor="end" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="16" fill="${COLORS.faint}">${escapeXml(footer)}</text>` : ''}`;
}

/**
 * Render the full card. The output is deterministic for a given model:
 * no clock, no randomness, no external fetch.
 */
export function renderProfileCardSvg(model: ProfileCardModel): string {
	const pad = 48;
	const contentWidth = CARD_WIDTH - pad * 2;

	// Works grid: up to WORK_TILE_COUNT columns.
	const tileGap = 24;
	const tileWidth = Math.floor((contentWidth - tileGap * 3) / 4);
	const worksY = 208;
	const tiles = model.works
		.slice(0, 4)
		.map((work, i) =>
			renderWorkTile({
				work,
				x: pad + i * (tileWidth + tileGap),
				y: worksY,
				width: tileWidth,
				index: i,
			}),
		)
		.join('');

	// Status band.
	const panelGap = 24;
	const panelWidth = Math.floor((contentWidth - panelGap) / 2);
	const panelY = 540;
	const panelHeight = 118;
	const githubPanel = renderGitHubPanel(model, pad, panelY, panelWidth, panelHeight);
	const discordPanel = renderDiscordPanel(
		model,
		pad + panelWidth + panelGap,
		panelY,
		panelWidth,
		panelHeight,
	);

	const descriptor = 'After Effects tools · Web apps · Motion design';
	const observedFooter = `card generated ${formatObserved(model.generatedAt)} · data as observed above`;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="rebuildup — GitHub profile card">
<title>rebuildup — GitHub profile card</title>
<desc>Selected works and current GitHub / Discord activity for @rebuildup.</desc>
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${COLORS.bg}"/>
<rect x="24" y="24" width="${CARD_WIDTH - 48}" height="${CARD_HEIGHT - 48}" rx="20" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}" stroke-width="1"/>
<text x="${pad}" y="112" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="60" font-weight="800" letter-spacing="-1" fill="${COLORS.text}">rebuildup</text>
<text x="${pad}" y="152" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="26" fill="${COLORS.muted}">${escapeXml(descriptor)}</text>
<text x="${CARD_WIDTH - pad}" y="56" text-anchor="end" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="20" fill="${COLORS.faint}">@rebuildup · github.com</text>
${tiles}
${githubPanel}
${discordPanel}
<text x="${CARD_WIDTH - pad}" y="${CARD_HEIGHT - 28}" text-anchor="end" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="16" fill="${COLORS.faint}">${escapeXml(observedFooter)}</text>
</svg>`;
}
