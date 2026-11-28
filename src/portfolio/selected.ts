import type { PortfolioProject } from './schema';

/**
 * The editorial selection — which published works the site treats as
 * its proof (Issue #1295, Epic #1266, `docs/visual/site-concept-2026.md` §5).
 *
 * This is a COMMITTED artefact, the same pattern as
 * `src/home/current/roster.ts`: the owner edits this file in the
 * repository, so the selection is reviewable in a diff, versioned
 * with the site, and needs no Notion write. It deliberately does NOT
 * reuse the `pinned` column — pinning is a data-layer flag with its
 * own history, while this list is a presentation decision about
 * which works deserve the site's editorial emphasis.
 *
 * Rules for entries:
 *   - slug must name a `published` + `public` project in the snapshot
 *   - order in this array IS the display order (most important first)
 *   - a slug that no longer resolves is skipped, never rendered as a
 *     broken slot — remove it here when the work is unpublished
 *   - aim for facet balance across develop / video / design; the
 *     selection is a portfolio of the portfolio, not a ranking
 *
 * Selection criteria used for the initial list (2026-11-28): cover
 * media present, substantive case-study body, facet coverage, and
 * range across the three exhibition axes. Owner may reorder or
 * replace entries freely — the surfaces read only this file.
 */
export const SELECTED_WORK_SLUGS = [
	'kosen-fes-2025',
	'multislicer',
	'my-web-2026',
	'foldlayers',
	'pomodoroom',
	'ae-devtools',
	'seishun',
	'ch4nge',
	'tegaki-anime',
	'ube-kosen-map',
] as const;

/**
 * Resolve the selection against a project collection, preserving the
 * authored order and skipping slugs that are absent or not public.
 * Returns at most `limit` entries (default: the whole selection).
 */
export function resolveSelectedWorks(
	projects: readonly PortfolioProject[],
	limit?: number,
): PortfolioProject[] {
	const bySlug = new Map(projects.map((project) => [project.slug, project]));
	const resolved: PortfolioProject[] = [];
	for (const slug of SELECTED_WORK_SLUGS) {
		const project = bySlug.get(slug);
		if (project) resolved.push(project);
		if (limit !== undefined && resolved.length >= limit) break;
	}
	return resolved;
}
