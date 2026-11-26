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

/** `Nov 24 · 16:37 JST` — row-level stamp; the panel header carries the year. */
function formatJstCompact(iso: string): string {
	const parts = jstParts(iso);
	if (!parts) return iso;
	const month = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).toLocaleString('en-US', {
		month: 'short',
		timeZone: 'UTC',
	});
	return `${month} ${parts.day} · ${pad2(parts.hour)}:${pad2(parts.minute)} JST`;
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

/** `PullRequestEvent` → `pull request` — raw GitHub event names must
 * not leak into a profile card, and sibling event types on the same
 * PR/issue (opened vs reviewed) need a verb to stay distinguishable. */
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
	// GitHub emits one event per state transition, so the same PR or
	// issue can legitimately appear twice in a few seconds (opened +
	// closed). On a profile card that reads as a duplicated row, so
	// keep only the most recent event per repo+type+ref.
	const seenFeedKeys = new Set<string>();
	const feed = snapshot.feed
		.filter((item) => item.kind === 'public')
		.slice()
		.sort((a, b) => (a.at < b.at ? 1 : -1))
		.filter((item) => {
			const key = `${item.repoId}|${item.type}|${item.ref?.kind ?? ''}:${item.ref?.number ?? ''}`;
			if (seenFeedKeys.has(key)) return false;
			seenFeedKeys.add(key);
			return true;
		})
		.slice(0, MAX_FEED_ROWS)
		.map((item) => {
			const ref = item.ref;
			const refLabel =
				(ref?.kind === 'pull'
					? `PR #${ref.number}`
					: ref?.kind === 'issue'
						? `Issue #${ref.number}`
						: '') + (ref?.state ? ` · ${ref.state}` : '');
			const repoShort = item.repoId.split('/').pop() ?? item.repoId;
			// The ref label already names the kind ("PR #42", "Issue #5"),
			// so the entity's own event type adds nothing — but sibling
			// types on the same ref (review, comment) do, and bare events
			// fall back to the humanised type name.
			const redundant =
				(ref?.kind === 'pull' && item.type === 'PullRequestEvent') ||
				(ref?.kind === 'issue' && item.type === 'IssuesEvent');
			const parts = [repoShort];
			if (refLabel) {
				if (!redundant) parts.push(friendlyEventType(item.type));
				parts.push(refLabel);
			} else {
				parts.push(friendlyEventType(item.type));
			}
			const label = parts.join(' · ');
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

/** `Nov 20 – Nov 24, 2026 · JST`-style coverage label for the snapshot
 * window. Noon UTC lands on the same JST calendar day as `generatedOn`,
 * so the label names the snapshot day itself rather than the next
 * morning its UTC end-of-day instant spills into. */
function activityWindowLabel(data: {
	readonly generatedOn: string | null;
	readonly windowDays: number;
}): string {
	if (!data.generatedOn) return `${data.windowDays}d window`;
	return jstRangeLabel(
		new Date(
			Date.parse(`${data.generatedOn}T00:00:00Z`) - (data.windowDays - 1) * DAY_MS,
		).toISOString(),
		`${data.generatedOn}T12:00:00Z`,
	);
}
const MAX_REPO_ROWS = 6;
const MAX_FEED_ROWS = 7;
const FEED_ROW_H = 44;
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
		`<rect width="${ACTIVITY_WIDTH}" height="${ACTIVITY_HEIGHT}" rx="16" fill="${COLORS.bg}" stroke="${COLORS.panelStroke}" stroke-width="1"/>`,
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
	const windowLabel = activityWindowLabel(data);
	parts.push(
		`<text x="${PAD}" y="52" font-family="${FONT}" font-size="26" font-weight="800" fill="${COLORS.text}">GitHub activity</text>`,
		`<text x="${ACTIVITY_WIDTH - PAD}" y="50" text-anchor="end" font-family="${FONT}" font-size="15" fill="${COLORS.faint}">${escapeXml(windowLabel)}</text>`,
	);

	// Left column: totals + per-repo bars. The panel's left edge aligns
	// with the page header/footer margin (PAD), matching the right
	// column's right edge.
	const leftX = PAD;
	const leftW = 384;
	const shownRepos = data.repos.slice(0, MAX_REPO_ROWS);
	const maxEvents = Math.max(1, ...data.repos.map((r) => r.events));

	parts.push(
		panelChrome(leftX, PANEL_Y, leftW, 'EVENTS BY REPOSITORY', COLORS.ok, PANEL_H),
		`<text x="${leftX + 24}" y="${PANEL_Y + 70}" font-family="${FONT}" font-size="28" font-weight="800" fill="${COLORS.text}">${data.totals.commits.toLocaleString('en-US')}</text>`,
		`<text x="${leftX + 24}" y="${PANEL_Y + 90}" font-family="${FONT}" font-size="14" fill="${COLORS.muted}">commits · ${data.totals.events.toLocaleString('en-US')} events · ${data.totals.prs.toLocaleString('en-US')} PRs · ${data.windowDays}d</text>`,
	);

	let y = PANEL_Y + 110;
	for (const repo of shownRepos) {
		const name = truncate(repo.name, 230, 14);
		parts.push(
			repoGlyph(leftX + 24, y - 10),
			`<text x="${leftX + 40}" y="${y}" font-family="${FONT}" font-size="14" fill="${COLORS.muted}">${escapeXml(name)}</text>`,
			`<text x="${leftX + leftW - 24}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">${repo.events} ev</text>`,
		);
		if (repo.events > 0) {
			const barW = Math.max(4, Math.round((repo.events / maxEvents) * MAX_BAR));
			parts.push(
				`<rect x="${leftX + 24}" y="${y + 7}" width="${barW}" height="7" rx="3.5" fill="${COLORS.ok}" opacity="0.85"/>`,
			);
		}
		y += 32;
	}
	if (data.repos.length > shownRepos.length) {
		parts.push(
			`<text x="${leftX + 24}" y="${y + 12}" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">+${data.repos.length - shownRepos.length} more repositories</text>`,
		);
		y += 32;
	}
	if (data.privateCount > 0) {
		const privateLine = `${data.privateCount} private ${data.privateCount === 1 ? 'repo' : 'repos'} (aggregated): ${data.privateTotals.commits.toLocaleString('en-US')} commits · ${data.privateTotals.prs.toLocaleString('en-US')} PRs`;
		parts.push(
			`<text x="${leftX + 24}" y="${y + 12}" font-family="${FONT}" font-size="11" fill="${COLORS.faint}">${escapeXml(truncate(privateLine, leftW - 52, 11))}</text>`,
		);
	}
	parts.push(panelFooter(leftX, PANEL_Y, leftW, 'bars: public repos only', PANEL_H));

	// Right column: recent public feed.
	const rightX = leftX + leftW + 32;
	const rightW = ACTIVITY_WIDTH - PAD - rightX;
	parts.push(panelChrome(rightX, PANEL_Y, rightW, 'RECENT ACTIVITY', COLORS.accent, PANEL_H));
	let fy = PANEL_Y + 58;
	if (data.feed.length === 0) {
		parts.push(
			`<text x="${rightX + 24}" y="${fy + 8}" font-family="${FONT}" font-size="14" fill="${COLORS.muted}">No public feed items in window.</text>`,
		);
	} else {
		for (const item of data.feed) {
			const when = formatJstCompact(item.at);
			// The stamp drops to a second line so the label owns the full
			// row width — PR/issue refs stop ellipsizing while space sat
			// unused beside the timestamp.
			const lines = wrapText(item.label, rightW - 60, 14, 1);
			const glyph = feedGlyph(item.type);
			parts.push(
				feedGlyphSvg(glyph, rightX + 18, fy - 4),
				`<text x="${rightX + 34}" y="${fy}" font-family="${FONT}" font-size="14" font-weight="600" fill="${COLORS.text}">${escapeXml(lines[0])}</text>`,
				`<text x="${rightX + rightW - 20}" y="${fy + 17}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${COLORS.faint}">${escapeXml(when)}</text>`,
			);
			fy += FEED_ROW_H;
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
		`<text x="${PAD}" y="${ACTIVITY_HEIGHT - 14}" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">${escapeXml(footerBits.join(' · '))}</text>`,
	);

	parts.push('</svg>');
	return parts.join('');
}

// ---- mobile variant (`?layout=mobile`) ----
// The 840px two-column card shrinks to ~0.43x on a 390px phone and its
// body text drops below readable size. GitHub READMEs can swap assets
// through <picture><source media>, so the route serves this stacked
// single-column variant at a native 560px — ~0.64x on mobile, legible
// without pinch-zoom, while desktop keeps the denser two-column card.

export const ACTIVITY_MOBILE_WIDTH = 560;
const MOBILE_PAD = 24;
const MOBILE_PANEL_W = ACTIVITY_MOBILE_WIDTH - MOBILE_PAD * 2;
const MOBILE_CONTENT_X = MOBILE_PAD + 28;
const MOBILE_MAX_REPO_ROWS = 10;
const MOBILE_MAX_FEED_ROWS = 10;
const MOBILE_ROW_H = 34;
const MOBILE_BAR_MAX = 220;

type ActivityData = NonNullable<ReturnType<typeof aggregate>>;

function renderRepoRowsMobile(
	data: ActivityData,
	panelX: number,
	panelY: number,
): { svg: string; bottom: number } {
	const parts: string[] = [];
	const contentX = panelX + 28;
	const innerRight = panelX + MOBILE_PANEL_W - 28;
	const maxEvents = Math.max(1, ...data.repos.map((r) => r.events));
	// Zero-event repos carry no signal on a phone-sized card — they only
	// inflate the height, so the mobile variant lists active repos only.
	const activeRepos = data.repos.filter((r) => r.events > 0);
	const shown = activeRepos.slice(0, MOBILE_MAX_REPO_ROWS);

	parts.push(
		`<text x="${contentX}" y="${panelY + 78}" font-family="${FONT}" font-size="30" font-weight="800" fill="${COLORS.text}">${data.totals.commits.toLocaleString('en-US')}</text>`,
		`<text x="${contentX}" y="${panelY + 102}" font-family="${FONT}" font-size="13" fill="${COLORS.muted}">commits · ${data.totals.events.toLocaleString('en-US')} events · ${data.totals.prs.toLocaleString('en-US')} PRs · ${data.windowDays}d</text>`,
	);

	if (shown.length === 0) {
		parts.push(
			`<text x="${contentX}" y="${panelY + 140}" font-family="${FONT}" font-size="14" fill="${COLORS.muted}">No repository activity in window.</text>`,
		);
		return { svg: parts.join(''), bottom: panelY + 158 };
	}

	let y = panelY + 136;
	for (const repo of shown) {
		const name = truncate(repo.name, innerRight - contentX - 90, 14);
		parts.push(
			repoGlyph(contentX, y - 10),
			`<text x="${contentX + 24}" y="${y}" font-family="${FONT}" font-size="14" fill="${COLORS.muted}">${escapeXml(name)}</text>`,
			`<text x="${innerRight}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">${repo.events} ev</text>`,
		);
		if (repo.events > 0) {
			const barW = Math.max(4, Math.round((repo.events / maxEvents) * MOBILE_BAR_MAX));
			parts.push(
				`<rect x="${contentX + 24}" y="${y + 7}" width="${barW}" height="6" rx="3" fill="${COLORS.ok}" opacity="0.85"/>`,
			);
		}
		y += MOBILE_ROW_H;
	}
	let bottom = y - MOBILE_ROW_H + 22;
	if (activeRepos.length > shown.length) {
		parts.push(
			`<text x="${contentX}" y="${y + 2}" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">+${activeRepos.length - shown.length} more repositories</text>`,
		);
		bottom = y + 16;
		y += 26;
	}
	if (data.privateCount > 0) {
		const privateLine = `${data.privateCount} private ${data.privateCount === 1 ? 'repo' : 'repos'} (aggregated): ${data.privateTotals.commits.toLocaleString('en-US')} commits · ${data.privateTotals.prs.toLocaleString('en-US')} PRs`;
		parts.push(
			`<text x="${contentX}" y="${y + 2}" font-family="${FONT}" font-size="12" fill="${COLORS.faint}">${escapeXml(truncate(privateLine, MOBILE_PANEL_W - 56, 12))}</text>`,
		);
		bottom = y + 16;
	}
	return { svg: parts.join(''), bottom };
}

function renderFeedRowsMobile(
	data: ActivityData,
	panelX: number,
	panelY: number,
): { svg: string; bottom: number } {
	const parts: string[] = [];
	const contentX = panelX + 28;
	const innerRight = panelX + MOBILE_PANEL_W - 28;
	const labelW = MOBILE_PANEL_W - 56 - 130;
	let y = panelY + 62;
	if (data.feed.length === 0) {
		parts.push(
			`<text x="${contentX}" y="${y + 8}" font-family="${FONT}" font-size="14" fill="${COLORS.muted}">No public feed items in window.</text>`,
		);
		return { svg: parts.join(''), bottom: y + 24 };
	}
	for (const item of data.feed.slice(0, MOBILE_MAX_FEED_ROWS)) {
		const when = formatJstCompact(item.at);
		const lines = wrapText(item.label, labelW, 14, 1);
		const glyph = feedGlyph(item.type);
		parts.push(
			feedGlyphSvg(glyph, contentX + 2, y - 4),
			`<text x="${contentX + 22}" y="${y}" font-family="${FONT}" font-size="14" font-weight="600" fill="${COLORS.text}">${escapeXml(lines[0])}</text>`,
			`<text x="${innerRight}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="12" fill="${COLORS.muted}">${escapeXml(when)}</text>`,
		);
		y += MOBILE_ROW_H;
	}
	return { svg: parts.join(''), bottom: y - MOBILE_ROW_H + 22 };
}

/** Stacked single-column variant for narrow viewports (`?layout=mobile`). */
export function renderActivityMobileSvg(payload: unknown): string {
	const data = aggregate(payload);
	const parts: string[] = [];

	if (!data) {
		const h = 240;
		parts.push(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${ACTIVITY_MOBILE_WIDTH}" height="${h}" viewBox="0 0 ${ACTIVITY_MOBILE_WIDTH} ${h}" role="img" aria-label="GitHub activity">`,
			`<rect width="${ACTIVITY_MOBILE_WIDTH}" height="${h}" rx="16" fill="${COLORS.bg}" stroke="${COLORS.panelStroke}" stroke-width="1"/>`,
			panelChrome(MOBILE_PAD, 64, MOBILE_PANEL_W, 'GITHUB ACTIVITY', COLORS.offline, 120),
			`<text x="${MOBILE_PAD + 28}" y="${64 + 72}" font-family="${FONT}" font-size="18" fill="${COLORS.muted}">GitHub activity snapshot unavailable.</text>`,
			panelFooter(MOBILE_PAD, 64, MOBILE_PANEL_W, 'rebuildup.dev/github-profile', 120),
			`<text x="${MOBILE_PAD}" y="${h - 16}" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">rebuildup.dev</text>`,
			'</svg>',
		);
		return parts.join('');
	}

	const windowLabel = activityWindowLabel(data);
	const repoPanelY = 64;
	const repoRows = renderRepoRowsMobile(data, MOBILE_PAD, repoPanelY);
	const repoPanelH = repoRows.bottom - repoPanelY + 30;
	const feedPanelY = repoPanelY + repoPanelH + 16;
	const feedRows = renderFeedRowsMobile(data, MOBILE_PAD, feedPanelY);
	const feedPanelH = feedRows.bottom - feedPanelY + 30;
	const height = feedPanelY + feedPanelH + 34;

	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ACTIVITY_MOBILE_WIDTH}" height="${height}" viewBox="0 0 ${ACTIVITY_MOBILE_WIDTH} ${height}" role="img" aria-label="GitHub activity">`,
		`<rect width="${ACTIVITY_MOBILE_WIDTH}" height="${height}" rx="16" fill="${COLORS.bg}" stroke="${COLORS.panelStroke}" stroke-width="1"/>`,
		`<text x="${MOBILE_PAD}" y="46" font-family="${FONT}" font-size="24" font-weight="800" fill="${COLORS.text}">GitHub activity</text>`,
		`<text x="${ACTIVITY_MOBILE_WIDTH - MOBILE_PAD}" y="44" text-anchor="end" font-family="${FONT}" font-size="14" fill="${COLORS.faint}">${escapeXml(windowLabel)}</text>`,
		panelChrome(
			MOBILE_PAD,
			repoPanelY,
			MOBILE_PANEL_W,
			'EVENTS BY REPOSITORY',
			COLORS.ok,
			repoPanelH,
		),
		repoRows.svg,
		panelFooter(MOBILE_PAD, repoPanelY, MOBILE_PANEL_W, 'bars: public repos only', repoPanelH),
		panelChrome(
			MOBILE_PAD,
			feedPanelY,
			MOBILE_PANEL_W,
			'RECENT ACTIVITY',
			COLORS.accent,
			feedPanelH,
		),
		feedRows.svg,
		panelFooter(MOBILE_PAD, feedPanelY, MOBILE_PANEL_W, 'times in JST', feedPanelH),
	);
	const footerBits: string[] = [];
	if (data.observedAt) footerBits.push(`observed ${formatJst(data.observedAt)}`);
	footerBits.push('rebuildup.dev');
	parts.push(
		`<text x="${MOBILE_PAD}" y="${height - 14}" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">${escapeXml(footerBits.join(' · '))}</text>`,
		'</svg>',
	);
	return parts.join('');
}
