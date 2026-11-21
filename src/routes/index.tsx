import { createFileRoute } from '@tanstack/react-router';
import type { HomeAdProject } from '../home/ads/placements';
import { getPrivacyNoticeData } from '../home/privacy/load';
import { getDiscordPresence } from '../home/public';
import {
	HOME_REACTIONS_TARGET,
	HomePage,
	KNOWN_INCIDENTS,
	SYSTEM_SERVICES,
	getCurrentProjects,
	getHomeCounter,
	getHomeDataSource,
	getHomeGitHubActivity,
	getHomeReactions,
	getHomeSystemStatus,
	recordHomeHit,
} from '../home/public';
import { listPortfolioProjects } from '../portfolio/public';
import type { PortfolioProject } from '../portfolio/schema';

/**
 * TanStack Start route binding for the canonical home surface.
 *
 * Routing is framework-owned here; page composition and its data
 * obligations live under src/home/.
 *
 * The loader records an access hit before reading the counter so the
 * tile reflects the current request, then pulls reactions + system
 * status in parallel. Record-then-read ordering on the counter is
 * part of the contract (per ADR-0012); `Promise.all` is only used
 * for the read paths.
 */
export const Route = createFileRoute('/')({
	loader: async () => {
		await recordHomeHit({ data: {} });
		// The base date the current-projects section computes every
		// derived value against. One `observedAt` serves both the status
		// tiles and the section, so "3 日前" and the status snapshot can
		// never disagree about which day they describe (Issue #316).
		const observedAt = new Date().toISOString();
		const today = observedAt.slice(0, 10);
		const [
			statuses,
			reactions,
			counter,
			dataSource,
			projects,
			portfolioProjects,
			githubActivity,
			discordPresence,
			privacyNotice,
		] = await Promise.all([
			getHomeSystemStatus(),
			getHomeReactions({ data: { target: HOME_REACTIONS_TARGET } }),
			getHomeCounter({ data: {} }),
			// Issue #377 — which data source this runtime reads. The
			// home renders an indicator for every mode except the
			// deployed production Worker.
			getHomeDataSource(),
			getCurrentProjects({ data: { today } }),
			// Issue #925 — the sponsored rail / carousel promote real
			// portfolio work through the SAME public read the
			// /portfolio index uses. A portfolio outage must not take
			// the home page down with it: the ad surface degrades to
			// its Tool-only roster.
			listPortfolioProjects({ data: { limit: 6 } })
				.then((page) => page.projects)
				.catch(() => null),
			// Issue #319 — the committed GitHub activity snapshot,
			// projected for the status card. Same committed-data rule
			// as the projects section: no runtime fetch.
			getHomeGitHubActivity({ data: {} }).catch(() => null),
			// Issue #320 — Discord presence card from the D1 snapshot
			// the operator-side Gateway script pushes via
			// PUT /api/v1/presence/discord. Degrades cleanly when the
			// row is missing/stale/invalid. No runtime fetch to
			// Discord from the Worker.
			getDiscordPresence(),
			// Issue #1009 — the published lifecycle wording, projected
			// server-side so the registry (pending entries, evidence
			// pointers) never enters the client bundle.
			getPrivacyNoticeData(),
		]);
		return {
			services: SYSTEM_SERVICES,
			statuses,
			observedAt,
			// Issue #502: the committed incident records. There is no
			// runtime fetch here on purpose — the published list is
			// exactly what the repository holds.
			incidents: KNOWN_INCIDENTS,
			reactions,
			counter,
			// Issue #316: the current-project records. Composed from
			// committed artefacts only (the owner's roster plus the
			// generated git snapshot) — the section makes a claim about
			// *now*, and a claim that changes without a commit cannot be
			// reviewed. There is no runtime fetch here.
			projects,
			githubActivity,
			dataSource,
			// Issue #925 — map the public portfolio rows into the narrow
			// shape the ad placements consume. Projects without a
			// resolvable cover image are skipped: an ad creative without
			// a visual is not a creative.
			adProjects: (portfolioProjects ?? [])
				.map(toHomeAdProject)
				.filter((project): project is HomeAdProject => project !== null)
				.slice(0, 4),
			// Issue #320 — Discord presence card from the D1 snapshot.
			// Optional: degrades to unavailable when missing/stale.
			discordPresence,
			privacyNotice,
		};
	},
	/**
	 * Home head metadata (Issue #418).
	 *
	 * The home route had no `head()`, so it inherited the root
	 * fallback title (`my-web-2026`) and declared no description and
	 * no canonical at all — the flagship URL of the site was the one
	 * page a crawler could not resolve to a canonical document. The
	 * public-route head gate (`test/integration/seo-head.test.ts`)
	 * now fails on that, which is the point of the gate.
	 *
	 * The description restates the page's hero self-introduction
	 * rather than inventing copy: `src/home/hero.tsx` says the same
	 * thing on the page, and every claim in it is grounded in
	 * `docs/personal/domain.md` §8–§9 and the published portfolio
	 * (`src/portfolio/seed.ts`).
	 *
	 * Canonical is the origin WITH its trailing slash — `/` is the
	 * home document and the gate derives the expected value from the
	 * route id, so `/` and `` must not disagree. The same link is
	 * also the sitemap entry's target (Issue #420): the sitemap
	 * contract is that every `<loc>` IS the page's canonical URL, and
	 * `scripts/check-sitemap-route-coverage.test.mjs` asserts this
	 * literal and the sitemap inventory agree, so the two cannot
	 * drift apart silently.
	 */
	head: () => {
		const title = 'my-web-2026 — rebuildup.dev';
		const description =
			'木村友亮 / samuido — ソフトウェアを作りながら、映像やデザインも作る developer / creator。After Effects 向けツールや Web アプリ、映像・デザインの制作物を公開しています。';
		const url = 'https://rebuildup.dev/';
		return {
			meta: [
				{ title },
				{ name: 'description', content: description },
				{ property: 'og:type', content: 'website' },
				{ property: 'og:title', content: title },
				{ property: 'og:description', content: description },
				{ property: 'og:url', content: url },
				{ name: 'twitter:card', content: 'summary' },
			],
			links: [{ rel: 'canonical', href: url }],
		};
	},
	component: HomeRoute,
});

function HomeRoute() {
	return <HomePage data={Route.useLoaderData()} />;
}

/**
 * Project row → the narrow ad-creative shape. The cover is the same
 * media the /portfolio index resolves (`isCover` first, then the
 * first media row); a project whose media has no composed URL is not
 * promotable and returns `null`.
 */
function toHomeAdProject(project: PortfolioProject): HomeAdProject | null {
	const media = project.media.find((m) => m.isCover) ?? project.media[0];
	if (!media?.url) return null;
	return {
		slug: project.slug,
		title: project.title,
		summary: project.summary,
		coverUrl: media.url,
		coverAlt: media.alt || project.title,
	};
}
