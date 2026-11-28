import type { CurrentProjectRecord } from '../../home/current/types';
import { getCurrentProjects } from '../../home/public';
import { loadPortfolioProject } from '../../portfolio/public';
import type { PortfolioProject } from '../../portfolio/schema';
import {
	NOW_FOCUS_LIMIT,
	NOW_FOCUS_PORTFOLIO_SLUGS,
	type NowFocusItem,
	selectNowFocus,
} from './focus';

/**
 * `/now` loader (Issue #1316).
 *
 * Two reads, kept honest about their contracts:
 *
 *   - the current-projects records come from `getCurrentProjects` —
 *     committed artefacts only, the same data obligation the page
 *     has always had;
 *   - the focus band's covers come from `loadPortfolioProject`, the
 *     portfolio obligation's PUBLIC server function. That read CAN
 *     fail (D1), and a cover is evidence, not the record — so each
 *     lookup is fail-soft: a rejected or unresolved slug yields
 *     `cover: null` and the band renders its typographic plate
 *     instead of taking the whole page down with it.
 */
export interface NowRouteData {
	readonly projects: readonly CurrentProjectRecord[];
	readonly today: string;
	readonly focus: readonly NowFocusItem[];
}

/** The cover a case study offers the band: its cover media, or its first media. */
function coverMediaOf(project: PortfolioProject) {
	return project.media.find((media) => media.isCover) ?? project.media[0] ?? null;
}

async function resolveCover(record: CurrentProjectRecord): Promise<NowFocusItem['cover']> {
	const slug = NOW_FOCUS_PORTFOLIO_SLUGS[record.id];
	if (slug === undefined) return null;
	try {
		const project = await loadPortfolioProject({ data: { slug } });
		if (project === null) return null;
		return { slug: project.slug, title: project.title, media: coverMediaOf(project) };
	} catch {
		// Evidence is fail-soft by contract (see the module header): the
		// record still renders, only its illustration is missing.
		return null;
	}
}

export async function getNowRouteData(): Promise<NowRouteData> {
	const today = new Date().toISOString().slice(0, 10);
	const projects = await getCurrentProjects({ data: { today } });
	const focusRecords = selectNowFocus(projects);
	// C-8 — the band is bounded: `selectNowFocus` caps the selection and
	// the slice below keeps the bound visible at the composition site.
	const focus = await Promise.all(
		focusRecords
			.slice(0, NOW_FOCUS_LIMIT)
			.map(async (record) => ({
				record,
				cover: await resolveCover(record),
			})),
		// C-8 — the rendered set is bounded by the focus limit above.
	);
	return { projects, today, focus };
}
