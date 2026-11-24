import { GitHubActivitySnapshotBody } from '../activity/schema';
import { COLORS, FONT, escapeXml, panelChrome, panelFooter, truncate, wrapText } from './card';

/**
 * GitHub activity card — `GET /api/v1/github-profile/activity`
 * (GitHub profile redesign, rebuildup/rebuildup#8).
 *
 * One self-contained SVG that answers "what has rebuildup been
 * building?" instead of repeating GitHub's own contribution graph:
 *
 *   - commits / events / PRs per repository over the snapshot window
 *     (public repos by name, private repos anonymously aggregated),
 *   - the most recent public feed items with their Issue/PR refs,
 *   - window totals and the snapshot's own observation stamps.
 *
 * Timezone contract: every calendar date on this card is rendered in
 * `Asia/Tokyo` (JST, UTC+9, no DST) — the owner's local day boundary,
 * not the snapshot's UTC `generatedOn`. The raw observation stamps
 * stay in the footer so a cached copy stays honest.
 *
 * Failure behaviour matches the other profile surfaces: the endpoint
 * always answers 200 and renders an honest "unavailable" variant for
 * missing / invalid snapshots. Nothing is guessed.
 */

export const ACTIVITY_WIDTH = 840;
export const ACTIVITY_HEIGHT = 480;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Render an instant's calendar fields in JST (UTC+9 fixed offset). */
function jstParts(iso: string | number): {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
} | null {
	const ms = typeof iso === 'number' ? iso : Date.parse(iso);
	if (Number.isNaN(ms)) return null;
	const shifted = new Date(ms + JST_OFFSET_MS);
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		hour: shifted.getUTCHours(),
		minute: shifted.getUTCMinutes(),
	};
}

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/** `Nov 22, 2026 · 15:11 JST` style stamp for a feed item. */
export function formatJst(iso: string): string {
	const parts = jstParts(iso);
	if (!parts) return iso;
	const month = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).toLocaleString('en-US', {
		month: 'short',
		timeZone: 'UTC',
	});
	return `${month} ${parts.day}, ${parts.year} · ${pad2(parts.hour)}:${pad2(parts.minute)} JST`;
}

/** `Nov 24, 16:38 JST` — row-level stamp; the panel header carries the year. */
function formatJstCompact(iso: string): string {
	const parts = jstParts(iso);
	if (!parts) return iso;
	const month = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).toLocaleString('en-US', {
		month: 'short',
		timeZone: 'UTC',
	});
	return `${month} ${parts.day}, ${pad2(parts.hour)}:${pad2(parts.minute)} JST`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function jstRangeLabel(fromIso: string, toIso: string): string {
	const from = jstParts(fromIso);
	const to = jstParts(toIso);
	if (!from || !to) return '';
	const fromLabel = `${MONTHS[from.month - 1]} ${from.day}`;
	const toLabel = `${MONTHS[to.month - 1]} ${to.day}, ${to.year}`;
	return fromLabel === toLabel ? toLabel : `${fromLabel} – ${toLabel} · JST`;
}

interface RepoRow {
	name: string;
	events: number;
	commits: number;
	prs: number;
}

interface FeedRow {
	at: string;
	label: string;
	type: string;
}

function aggregate(payload: unknown): {
	windowDays: number;
	generatedOn: string | null;
	repos: RepoRow[];
	feed: FeedRow[];
	totals: { events: number; commits: number; prs: number };
	privateCount: number;
	privateTotals: { events: number; commits: number; prs: number };
	observedAt: string | null;
} | null {
	const parsed = GitHubActivitySnapshotBody.safeParse(payload);
	if (!parsed.success) return null;
	const snapshot = parsed.data;
	const repos: RepoRow[] = [];
	const privateTotals = { events: 0, commits: 0, prs: 0 };
	let privateCount = 0;
	const totals = { events: 0, commits: 0, prs: 0 };
	for (const repo of snapshot.repos) {
		const counts = repo.activity;
		if (repo.kind === 'public') {
			repos.push({
				name: repo.repoFullName ?? repo.name,
				events: counts?.events ?? 0,
				commits: counts?.commits ?? 0,
				prs: counts?.prs ?? 0,
			});
			totals.events += counts?.events ?? 0;
			totals.commits += counts?.commits ?? 0;
			totals.prs += counts?.prs ?? 0;
		} else {
			privateCount += 1;
			privateTotals.events += counts?.events ?? 0;
			privateTotals.commits += counts?.commits ?? 0;
			privateTotals.prs += counts?.prs ?? 0;
		}
	}
	repos.sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
	const feed = snapshot.feed
		.filter((item) => item.kind === 'public')
		.slice()
		.sort((a, b) => (a.at < b.at ? 1 : -1))
		.slice(0, MAX_FEED_ROWS)
		.map((item) => {
			const ref = item.ref;
			const refLabel =
				ref?.kind === 'pull'
					? `PR #${ref.number}`
					: ref?.kind === 'issue'
						? `Issue #${ref.number}`
						: '';
			const repoShort = item.repoId.split('/').pop() ?? item.repoId;
			const shortType = item.type.replace(/Event$/, '');
			// The ref label already names the kind ("PR #42", "Issue #5"),
			// so the bare event type only appears when there is no ref —
			// and the row glyph carries the type visually either way.
			const label = [repoShort, refLabel || shortType].filter(Boolean).join(' · ');
			return { at: item.at, label, type: item.type };
		});
	const observed = [snapshot.sources.public.observedAt, snapshot.sources.private.observedAt].filter(
		(s): s is string => typeof s === 'string',
	);
	return {
		windowDays: snapshot.windowDays,
		generatedOn: snapshot.generatedOn,
		repos,
		feed,
		totals,
		privateCount,
		privateTotals,
		observedAt: observed.sort().at(-1) ?? null,
	};
}

const PAD = 28;
const INNER = PAD + 24;
const MAX_REPO_ROWS = 6;
const MAX_FEED_ROWS = 8;
const MAX_BAR = 200;
// The two columns share one panel band: chrome, content and footer all
// live inside it, so dense snapshots cannot spill past the panel edge.
const PANEL_Y = 72;
const PANEL_H = ACTIVITY_HEIGHT - PANEL_Y - 32;

// ---- semantic glyphs (Issue #1216) ----
// Status was text-only; small shapes now carry the event/repo
// meaning before the words do. Colours follow the card palette.
const ISSUE_COLOR = '#BC8CFF';

/** Tiny git-graph mark drawn before each repository row. */
function repoGlyph(x: number, y: number): string {
	return [
		`<g transform="translate(${x},${y})" fill="none" stroke="${COLORS.muted}" stroke-width="1.3">`,
		`<circle cx="3.5" cy="3.5" r="2" fill="${COLORS.bg}"/>`,
		`<circle cx="8.5" cy="10.5" r="2" fill="${COLORS.bg}"/>`,
		`<path d="M3.5 5.5c0 3 2 4.5 5 4.5"/>`,
		'</g>',
	].join('');
}

type FeedGlyph = { color: string; shape: 'circle' | 'square' | 'triangle' | 'diamond' };

function feedGlyph(type: string): FeedGlyph {
	if (/pull/i.test(type)) return { color: COLORS.accent, shape: 'square' };
	if (/issue/i.test(type)) return { color: ISSUE_COLOR, shape: 'triangle' };
	if (/commit|push/i.test(type)) return { color: COLORS.ok, shape: 'circle' };
	return { color: COLORS.offline, shape: 'diamond' };
}

/** ~9px event-type marker centred on (cx, cy). */
function feedGlyphSvg(glyph: FeedGlyph, cx: number, cy: number): string {
	switch (glyph.shape) {
		case 'square':
			return `<rect x="${cx - 3.5}" y="${cy - 3.5}" width="7" height="7" rx="1.5" fill="${glyph.color}"/>`;
		case 'triangle':
			return `<path d="M${cx} ${cy - 4} L${cx + 4} ${cy + 3} L${cx - 4} ${cy + 3} Z" fill="${glyph.color}"/>`;
		case 'diamond':
			return `<path d="M${cx} ${cy - 4} L${cx + 4} ${cy} L${cx} ${cy + 4} L${cx - 4} ${cy} Z" fill="${glyph.color}"/>`;
		default:
			return `<circle cx="${cx}" cy="${cy}" r="4" fill="${glyph.color}"/>`;
	}
}

export function renderActivitySvg(payload: unknown): string {
	const data = aggregate(payload);
	const parts: string[] = [];
	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ACTIVITY_WIDTH}" height="${ACTIVITY_HEIGHT}" viewBox="0 0 ${ACTIVITY_WIDTH} ${ACTIVITY_HEIGHT}" role="img" aria-label="GitHub activity">`,
		`<rect width="${ACTIVITY_WIDTH}" height="${ACTIVITY_HEIGHT}" fill="${COLORS.bg}"/>`,
	);

	if (!data) {
		parts.push(
			panelChrome(
				INNER,
				PANEL_Y,
				ACTIVITY_WIDTH - INNER * 2,
				'GITHUB ACTIVITY',
				COLORS.offline,
				PANEL_H,
			),
			`<text x="${INNER}" y="${PANEL_Y + PANEL_H / 2 + 8}" font-family="${FONT}" font-size="22" fill="${COLORS.muted}">GitHub activity snapshot unavailable.</text>`,
			panelFooter(
				INNER,
				PANEL_Y,
				ACTIVITY_WIDTH - INNER * 2,
				'rebuildup.dev/github-profile',
				PANEL_H,
			),
		);
		parts.push('</svg>');
		return parts.join('');
	}

	// Header: window label + JST coverage note + observation stamp.
	const windowLabel = data.generatedOn
		? jstRangeLabel(
				new Date(
					Date.parse(`${data.generatedOn}T00:00:00Z`) - (data.windowDays - 1) * DAY_MS,
				).toISOString(),
				`${data.generatedOn}T23:59:59Z`,
			)
		: `${data.windowDays}d window`;
	parts.push(
		`<text x="${PAD}" y="52" font-family="${FONT}" font-size="26" font-weight="800" fill="${COLORS.text}">GitHub activity</text>`,
		`<text x="${ACTIVITY_WIDTH - PAD}" y="50" text-anchor="end" font-family="${FONT}" font-size="14" fill="${COLORS.faint}">${escapeXml(windowLabel)}</text>`,
	);

	// Left column: totals + per-repo bars.
	const leftX = INNER;
	const leftW = 360;
	const shownRepos = data.repos.slice(0, MAX_REPO_ROWS);
	const maxEvents = Math.max(1, ...data.repos.map((r) => r.events));

	parts.push(
		panelChrome(leftX, PANEL_Y, leftW, 'EVENTS BY REPOSITORY', COLORS.ok, PANEL_H),
		`<text x="${leftX + 24}" y="${PANEL_Y + 70}" font-family="${FONT}" font-size="28" font-weight="800" fill="${COLORS.text}">${data.totals.commits.toLocaleString('en-US')}</text>`,
		`<text x="${leftX + 24}" y="${PANEL_Y + 90}" font-family="${FONT}" font-size="13" fill="${COLORS.muted}">commits · ${data.totals.events.toLocaleString('en-US')} events · ${data.totals.prs.toLocaleString('en-US')} PRs · ${data.windowDays}d</text>`,
	);

	let y = PANEL_Y + 110;
	for (const repo of shownRepos) {
		const name = truncate(repo.name, 170, 13);
		parts.push(
			repoGlyph(leftX + 24, y - 10),
			`<text x="${leftX + 40}" y="${y}" font-family="${FONT}" font-size="13" fill="${COLORS.muted}">${escapeXml(name)}</text>`,
			`<text x="${leftX + leftW - 24}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="12" fill="${COLORS.faint}">${repo.events} ev</text>`,
		);
		if (repo.events > 0) {
			const barW = Math.max(4, Math.round((repo.events / maxEvents) * MAX_BAR));
			parts.push(
				`<rect x="${leftX + 24}" y="${y + 5}" width="${barW}" height="7" rx="3.5" fill="${COLORS.ok}" opacity="0.85"/>`,
			);
		}
		y += 30;
	}
	if (data.repos.length > shownRepos.length) {
		parts.push(
			`<text x="${leftX + 24}" y="${y + 12}" font-family="${FONT}" font-size="12" fill="${COLORS.faint}">+${data.repos.length - shownRepos.length} more repositories</text>`,
		);
		y += 30;
	}
	if (data.privateCount > 0) {
		parts.push(
			`<text x="${leftX + 24}" y="${y + 12}" font-family="${FONT}" font-size="12" fill="${COLORS.faint}">${data.privateCount} private ${data.privateCount === 1 ? 'repo' : 'repos'} · ${data.privateTotals.commits.toLocaleString('en-US')} commits · ${data.privateTotals.prs.toLocaleString('en-US')} PRs (aggregated)</text>`,
		);
	}
	parts.push(panelFooter(leftX, PANEL_Y, leftW, 'bars: public repos only', PANEL_H));

	// Right column: recent public feed.
	const rightX = leftX + leftW + 32;
	const rightW = ACTIVITY_WIDTH - PAD - rightX;
	parts.push(panelChrome(rightX, PANEL_Y, rightW, 'RECENT ACTIVITY', COLORS.ok, PANEL_H));
	let fy = PANEL_Y + 68;
	if (data.feed.length === 0) {
		parts.push(
			`<text x="${rightX + 24}" y="${fy + 8}" font-family="${FONT}" font-size="14" fill="${COLORS.muted}">No public feed items in window.</text>`,
		);
	} else {
		for (const item of data.feed) {
			const when = formatJstCompact(item.at);
			const lines = wrapText(item.label, rightW - 170, 13, 1);
			const glyph = feedGlyph(item.type);
			parts.push(
				feedGlyphSvg(glyph, rightX + 18, fy - 4),
				`<text x="${rightX + 34}" y="${fy}" font-family="${FONT}" font-size="13" font-weight="600" fill="${COLORS.text}">${escapeXml(lines[0])}</text>`,
				`<text x="${rightX + rightW - 20}" y="${fy}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${COLORS.muted}">${escapeXml(when)}</text>`,
			);
			fy += 34;
		}
	}
	parts.push(panelFooter(rightX, PANEL_Y, rightW, 'times in JST', PANEL_H));

	// Footer: observation stamps keep cached copies honest. User-facing
	// times are JST throughout; the snapshot's own UTC stamps stay inside
	// the payload, not on the image.
	const footerBits: string[] = [];
	if (data.observedAt) footerBits.push(`observed ${formatJst(data.observedAt)}`);
	footerBits.push('rebuildup.dev');
	parts.push(
		`<text x="${PAD}" y="${ACTIVITY_HEIGHT - 14}" font-family="${FONT}" font-size="12" fill="${COLORS.faint}">${escapeXml(footerBits.join(' · '))}</text>`,
	);

	parts.push('</svg>');
	return parts.join('');
}
