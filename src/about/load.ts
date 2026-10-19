import { createD1PortfolioLoader } from '../portfolio/load';
import type { PortfolioEnv, PortfolioLoader } from '../portfolio/contract';
import type { PortfolioProject } from '../portfolio/schema';
import { ABOUT_DATA } from './data';
import type { AboutData, AboutPageData } from './types';

/**
 * `about` loader — the only thing the route reaches for when it
 * needs `/about` data.
 *
 * The narrative copy (`identity` / `interests` / `current` /
 * `future` / `externalHandles`) is repo-controlled (see
 * `data.ts`). The `experience` subset flows from the canonical
 * portfolio loader so the public-visibility boundary enforced
 * there is preserved by construction — unlisted / draft /
 * archived rows never reach the about page even when their slug
 * is listed in `ABOUT_DATA.experienceSlugs`.
 *
 * DI seam: `loadAbout(env, data)` takes the env-like object as
 * its first argument so tests can construct a fake env without
 * pulling `cloudflare:workers`. This mirrors the portfolio
 * loader's DI seam and the home reactions pattern.
 *
 * The function accepts an optional `data` override so tests can
 * swap the repo-controlled copy without monkey-patching the
 * module. Production callers always omit it.
 */

export interface AboutEnv {
	DB?: D1Database;
	MEDIA?: R2Bucket;
	MEDIA_PUBLIC_BASE_URL?: string;
}

export type AboutLoader = (env: AboutEnv, data?: AboutData) => Promise<AboutPageData>;

/**
 * Resolve the `experience` subset of portfolio projects in
 * narrative order. The canonical sort (`pinned DESC,
 * display_order ASC, updated_at DESC, id ASC`) is NOT honoured
 * here — the order is defined by `data.experienceSlugs`, which is
 * the story arc the visitor should read.
 *
 * Slugs that resolve to `null` (unknown / non-public) are
 * silently dropped. The visitor page must not surface a
 * affordance the data layer no longer backs.
 *
 * `loader.loadPortfolioProject` is called sequentially because
 * the narrative subset is bounded (single-digit count at this version);
 * parallelising would inflate complexity for no gain. If the
 * subset ever grows past ~10 items, switch to a single batched
 * query.
 */
async function resolveExperience(
	loader: PortfolioLoader,
	slugs: readonly string[],
): Promise<readonly PortfolioProject[]> {
	const out: PortfolioProject[] = [];
	for (const slug of slugs) {
		const project = await loader.loadPortfolioProject(slug);
		if (project) out.push(project);
	}
	return out;
}

/**
 * Default loader — reads portfolio through D1 via the existing
 * `createD1PortfolioLoader` seam.
 */
export const loadAbout: AboutLoader = async (env, data = ABOUT_DATA) => {
	const loader = createD1PortfolioLoader(env as PortfolioEnv);
	const experience = await resolveExperience(loader, data.experienceSlugs);
	return {
		identity: data.identity,
		interests: data.interests,
		experience,
		current: data.current,
		future: data.future,
		externalHandles: data.externalHandles,
	};
};
