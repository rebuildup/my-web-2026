/**
 * Activity timeline contract — the unified, read-only chronology of
 * the owner's published activity (Issue #352).
 *
 * What this obligation owns
 * -------------------------
 * The QUESTION "what did the owner publish, and when" answered across
 * heterogeneous sources: GitHub releases, published articles and
 * approved portfolio works. Each source keeps its own authority —
 * this module owns only the merged READ MODEL and the display
 * vocabulary, never the source data itself.
 *
 * Honest-data rules
 * -----------------
 *   - An item exists only when a source recorded a real event. Unknown
 *     dates are never interpolated: a work contributes its authored
 *     `periodStart`, labelled by its authored `periodLabel` — the
 *     portfolio model has NO publication-date field (`created_at` is
 *     the row-creation timestamp, not a publish date), so the
 *     timeline does not claim one.
 *   - `kind` is a closed union (`release` | `article` | `work`). A
 *     kind with no live source simply produces no items; the union
 *     exists so the contract does not change when Issue #323 lands
 *     the article source.
 *   - `href` is always a real permalink the source already carries —
 *     a repository URL for a GitHub release event, `/portfolio/<slug>`
 *     for a work. Nothing is fabricated when a source has no URL.
 *   - Source health is per-source (`ok` | `unconfigured` | `failed`),
 *     matching the GitHub activity card vocabulary: a failed source
 *     renders as 取得失敗, never as "no activity".
 *
 * Boundary
 * --------
 * This obligation imports NO peer owner. The mappers in `sources.ts`
 * accept narrow structural inputs, so the route layer (or a later
 * server function) adapts `HomeGitHubActivity` / `PortfolioProject`
 * without this module learning either contract.
 */

/** The event kinds the timeline can render. */
export const ACTIVITY_TIMELINE_KINDS = ['release', 'article', 'work'] as const;
export type ActivityTimelineKind = (typeof ACTIVITY_TIMELINE_KINDS)[number];

/**
 * The sources the timeline reads. `articles` is declared for the
 * contract's sake (Issue #323 owns the article source) — today no
 * adapter emits `article` items and the source reports `unconfigured`.
 */
export const ACTIVITY_TIMELINE_SOURCES = ['github', 'portfolio', 'articles'] as const;
export type ActivityTimelineSourceId = (typeof ACTIVITY_TIMELINE_SOURCES)[number];

/** Per-source health, mirroring the GitHub activity card vocabulary. */
export type ActivityTimelineSourceStatus = 'ok' | 'unconfigured' | 'failed';

export const ACTIVITY_SOURCE_STATUS_LABELS_JA: Readonly<
	Record<ActivityTimelineSourceStatus, string>
> = {
	ok: '観測中',
	unconfigured: '未接続',
	failed: '取得失敗',
};

/** Japanese reading of each kind badge. */
export const ACTIVITY_KIND_LABELS_JA: Readonly<Record<ActivityTimelineKind, string>> = {
	release: 'リリース',
	article: '記事',
	work: '作品',
};

/** Japanese label of each source (the 出典 column). */
export const ACTIVITY_SOURCE_LABELS_JA: Readonly<Record<ActivityTimelineSourceId, string>> = {
	github: 'GitHub',
	portfolio: 'Portfolio',
	articles: 'Content',
};

/**
 * The cover image a source recorded for an item (Issue #1297).
 *
 * Only the portfolio adapter fills this today — a work's published
 * cover is the one piece of MEDIA the timeline can honestly show,
 * and it gives the otherwise text-uniform chronology a visual way
 * to find "the works" at a glance. `url` is the composed absolute
 * media URL the portfolio loader already resolved; the item is
 * emitted only when a real URL exists, so the renderer never draws
 * a broken frame.
 */
export interface ActivityTimelineCover {
	readonly url: string;
	readonly alt: string;
	readonly width: number | null;
	readonly height: number | null;
}

/**
 * One chronology entry. `at` is the ISO instant the item SORTS by —
 * always a value a source recorded, never derived. `dateLabel`, when
 * present, is the authored display date (a portfolio `periodLabel`
 * like `2025-09 - present`); the component prints it instead of the
 * `at` day so coarse authored periods are not falsely rendered as
 * exact dates.
 */
export interface ActivityTimelineItem {
	/** Stable unique id within the timeline (`<source>:<sourceId>`). */
	readonly id: string;
	readonly kind: ActivityTimelineKind;
	readonly source: ActivityTimelineSourceId;
	/** The subject line — a repo id, a project title, an article title. */
	readonly title: string;
	/** ISO instant used for sorting and, absent `dateLabel`, display. */
	readonly at: string;
	/** Authored display date overriding the `at` day (e.g. period label). */
	readonly dateLabel?: string;
	/** Real permalink; absent when the source carries none. */
	readonly href?: string;
	/** Recorded cover media, when the source published one (Issue #1297). */
	readonly cover?: ActivityTimelineCover;
}

/** One source's health line for the timeline header. */
export interface ActivityTimelineSourceState {
	readonly id: ActivityTimelineSourceId;
	readonly status: ActivityTimelineSourceStatus;
	/** ISO instant the source was last observed, when known. */
	readonly observedAt?: string;
}

/**
 * The merged read model the timeline renders. `generatedAt` is when
 * the assembly ran (the route's clock); `sources` reports each
 * source's health so a partial outage is visible, and `items` is the
 * date-descending merged list.
 */
export interface ActivityTimeline {
	readonly generatedAt: string;
	readonly sources: readonly ActivityTimelineSourceState[];
	readonly items: readonly ActivityTimelineItem[];
}
