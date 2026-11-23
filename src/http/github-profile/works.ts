/**
 * GitHub profile works — curated selection manifest (Issue #1196,
 * ADR-0025).
 *
 * The `rebuildup/rebuildup` profile README shows real portfolio works
 * as independent, individually linked images. Which works appear is an
 * authored decision recorded in `works.json` (slug + layout role); this
 * module resolves each slug against the committed public portfolio
 * snapshot so a work that leaves the published set simply drops out —
 * the manifest annotates, it never invents (same rule as
 * `FEATURED_SLUGS` in `model.ts`).
 *
 * Display copy (title / summary) is read from the portfolio project
 * itself; the README captions are authored on the profile side.
 */

import { notionProjects } from '../../portfolio/notion/reader';
import type { PortfolioProject } from '../../portfolio/schema';
import manifest from './works.json';

export type GithubProfileWorkRole = 'hero' | 'grid';

export interface GithubProfileWork {
	readonly slug: string;
	readonly role: GithubProfileWorkRole;
	readonly title: string;
	readonly summary: string;
	/** Public case-study URL on the canonical origin. */
	readonly portfolioUrl: string;
	/** Same-origin static asset path (`public/github-profile/works/`). */
	readonly assetPath: string;
}

interface WorksManifestEntry {
	readonly slug: string;
	readonly role: GithubProfileWorkRole;
}

const ENTRIES = (manifest as { works: readonly WorksManifestEntry[] }).works;

/** Public origin of the portfolio detail route (`src/routes/portfolio/$slug.tsx`). */
const PORTFOLIO_ORIGIN = 'https://rebuildup.dev';

/** Directory under `public/` that Static Assets serves verbatim. */
export const WORK_ASSET_DIR = '/github-profile/works';

function toWork(project: PortfolioProject, role: GithubProfileWorkRole): GithubProfileWork {
	return {
		slug: project.slug,
		role,
		title: project.title,
		summary: project.role ?? project.summary,
		portfolioUrl: `${PORTFOLIO_ORIGIN}/portfolio/${project.slug}`,
		assetPath: `${WORK_ASSET_DIR}/${project.slug}.webp`,
	};
}

/**
 * Resolve the curated works against the public snapshot. Entries whose
 * slug is absent or unpublished are skipped — fail-closed, never a
 * placeholder (the README simply shows fewer works).
 */
export function githubProfileWorks(
	projects: readonly PortfolioProject[] = notionProjects(),
): readonly GithubProfileWork[] {
	const bySlug = new Map(projects.map((project) => [project.slug, project]));
	const works: GithubProfileWork[] = [];
	for (const entry of ENTRIES) {
		const project = bySlug.get(entry.slug);
		if (project) works.push(toWork(project, entry.role));
	}
	return works;
}
