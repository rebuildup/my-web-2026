import { isFacetDerivedRole } from './kind-labels';
import type { PortfolioMedia, PortfolioProject } from './schema';
import { type PortfolioVideo, selectPortfolioVideo } from './video-facade';

/**
 * Exhibition views for `/portfolio` (Issue #1048).
 *
 * The my-web-2025 predecessor shipped three gallery presentations —
 * `develop` (alternating editorial rows), `video` (thumbnail grid with
 * inline playback) and `video&design` (variable-span tile grid) — plus
 * an `all` card index. This module is the 2026 decision seam for the
 * same contract.
 *
 * View selection vs. project mapping
 * ---------------------------------
 * Two different questions live here, and they are deliberately
 * separate:
 *
 *   1. **Which view is showing** — a visitor choice carried by the
 *      `?view=` search param (`all` | `develop` | `video` | `design`).
 *      It is ORTHOGONAL to `?facets=`: facets filter the catalogue,
 *      the view decides how the filtered set is exhibited. No project
 *      "belongs" to a view, so no schema field was added — the
 *      predecessor's per-category pages are reproduced as
 *      presentations of the same rows.
 *
 *   2. **How one project renders inside a view** — derived from data
 *      the schema already carries, never stored twice:
 *      - cover media (`media[].isCover`) decides whether a view shows
 *        a frame or the honest `no media` placeholder;
 *      - `selectPortfolioVideo(links)` (the Issue #870 facade) decides
 *        whether the video view offers inline playback — a project
 *        with no validated YouTube link renders as a still tile that
 *        links to its detail page, exactly like before;
 *      - the cover's intrinsic `width / height` (and `pinned`) decide
 *        the design view's tile span, replacing the predecessor's
 *        `Math.random`-weighted sizing, which could not survive SSR.
 *
 * Everything in this file is pure (no React, no DOM) so the mapping
 * rules are pinned by `views.test.ts` in the workerd pool.
 */

export const PORTFOLIO_VIEWS = ['all', 'develop', 'video', 'design'] as const;
export type PortfolioView = (typeof PORTFOLIO_VIEWS)[number];

/** The view `/portfolio` renders when `?view=` is absent or invalid. */
export const DEFAULT_PORTFOLIO_VIEW: PortfolioView = 'all';

/**
 * Parse the `?view=` search param into a known view. Unknown values
 * fall back to `all` — the same fail-closed posture the route takes
 * for malformed facets (an unreadable view must not 404 the page).
 */
export function parsePortfolioView(raw: string | undefined | null): PortfolioView {
	if (typeof raw !== 'string') return DEFAULT_PORTFOLIO_VIEW;
	return (PORTFOLIO_VIEWS as readonly string[]).includes(raw)
		? (raw as PortfolioView)
		: DEFAULT_PORTFOLIO_VIEW;
}

/**
 * The project's representative still: the row flagged `isCover`, or
 * the first media row when none is flagged. The same selection rule
 * `ProjectCard` and `PortfolioDetail` already apply — one definition
 * per surface family so a view cannot disagree with the card about
 * which image is "the" cover.
 */
export function projectCover(project: PortfolioProject): PortfolioMedia | null {
	return project.media.find((m) => m.isCover) ?? project.media[0] ?? null;
}

/**
 * The project's playable video facade, or `null`.
 *
 * Reuses `selectPortfolioVideo` rather than re-implementing the
 * YouTube URL grammar: the video view's play affordance exists
 * exactly when the detail page would mount `PortfolioVideoFacade`,
 * so the two surfaces can never disagree about which links are
 * playable.
 */
export function projectVideo(project: PortfolioProject): PortfolioVideo | null {
	return selectPortfolioVideo(project.links);
}

/**
 * Aspect ratio (`width / height`) of a media row, or `null` when the
 * row does not declare a usable intrinsic size. Mirrors the guard in
 * `PortfolioMedia.tsx`: only positive integers count, so a corrupt
 * row degrades to the un-sized rendering instead of a bogus ratio.
 */
export function mediaAspectRatio(media: PortfolioMedia | null): number | null {
	if (media === null) return null;
	const { width, height } = media;
	if (width === null || height === null) return null;
	if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
	if (width <= 0 || height <= 0) return null;
	return width / height;
}

/**
 * Cover aspect ratio for span decisions, or `null`.
 */
export function projectAspectRatio(project: PortfolioProject): number | null {
	return mediaAspectRatio(projectCover(project));
}

/**
 * Wide covers at or above this ratio earn a two-column tile in the
 * design view — the deterministic successor of the predecessor's
 * aspect-ratio boost (`aspectRatio > 1.5` widened `2x1` odds in
 * `grid-layout-utils.ts`). 1.5 is the cinematic / ultrawide boundary
 * the predecessor already used, kept so migrated corpora span the
 * same way they did.
 */
export const WIDE_TILE_ASPECT_RATIO = 1.5;

/** Tile span in the design view's column grid. */
export interface DesignTileSpan {
	/** Columns the tile occupies in the `md`+ three-column grid. */
	readonly columnSpan: 1 | 2;
}

/**
 * Which span a project gets in the design view.
 *
 * Deterministic by construction — the predecessor rolled
 * `Math.random()`-weighted sizes client-side, which cannot survive
 * SSR/hydration and made the same catalogue render differently per
 * visit. The 2026 rule is a pure function of stored facts:
 *
 *   - `pinned` projects always span two columns — the editorial
 *     "featured" signal the schema already carries, and the honest
 *     successor of the predecessor's `priority >= 80` large-size
 *     bias;
 *   - a wide cover (`projectAspectRatio >= 1.5`) spans two columns;
 *   - everything else — including tall covers and projects with no
 *     media — spans one.
 *
 * Row spans were considered and rejected: a tile's media box reserves
 * its aspect ratio from the first paint (the Issue #486 CLS contract
 * `PortfolioMediaFigure` implements), so stretching a tile across a
 * two-row track would leave dead space the image cannot fill.
 * Column spans alone still produce the irregular, content-shaped
 * grid the predecessor's `video&design` gallery was known for.
 */
export function designTileSpan(project: PortfolioProject): DesignTileSpan {
	if (project.pinned) return { columnSpan: 2 };
	const ratio = projectAspectRatio(project);
	if (ratio !== null && ratio >= WIDE_TILE_ASPECT_RATIO) return { columnSpan: 2 };
	return { columnSpan: 1 };
}

/**
 * Frame ratio passed to `PortfolioMediaFigure` for a design tile.
 *
 * One ratio per span keeps the grid's rows level: a one-column tile
 * is `4 / 3`, a two-column tile is `2 / 1`, so a wide tile is roughly
 * 1.3× the height of its neighbours rather than the full row height
 * its column share would otherwise imply. The intrinsic `width` /
 * `height` attributes still travel from the media row, so the
 * reservation contract is unchanged.
 */
export function designTileFrameRatio(span: DesignTileSpan): string {
	return span.columnSpan === 2 ? '2 / 1' : '4 / 3';
}

/**
 * Whether a recorded `role` is a person's role worth printing.
 *
 * Same guard `ProjectCard` / `PortfolioDetail` apply inline: non-empty
 * AND not one of the facet-derived kind words the legacy migration
 * stored (`isFacetDerivedRole`, Issue #813). Centralised here so the
 * three exhibition views cannot drift from the card.
 */
export function hasRecordedRole(project: PortfolioProject): boolean {
	return project.role !== null && project.role.trim() !== '' && !isFacetDerivedRole(project.role);
}

/**
 * Whether `periodLabel` carries anything printable — the same
 * non-empty rule the card and detail surfaces apply (Issue #767).
 */
export function hasPeriodLabel(project: PortfolioProject): boolean {
	return project.periodLabel !== null && project.periodLabel.trim() !== '';
}
