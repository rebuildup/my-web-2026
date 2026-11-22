/**
 * GitHub profile card — data assembly (Issue #1170, ADR-0024).
 *
 * Turns the already-public snapshots into the structural model
 * `card.ts` renders. Everything here is pure: payloads arrive as
 * `unknown`, validation goes through the HTTP boundary's OWN ingest
 * schemas (`../activity/schema`, `../presence/schema`) — the same
 * contracts that guarded the WRITE — because `http` may not import
 * `src/home/**` (AGENTS.md §3, `forbiddenOwnerDependencies`).
 *
 * Fail-closed rules mirror the home readers without importing them:
 *
 *   - an absent / unparsable / schema-invalid payload yields the
 *     `unavailable` variant — never a guessed value;
 *   - Discord presence additionally requires the stored `userId` to
 *     equal `env.DISCORD_PRESENCE_USER_ID` and `generatedAt` inside
 *     the freshness window below (the same 15 minutes
 *     `src/home/presence/load.ts` enforces — the constant is
 *     MIRRORED here on purpose; see ADR-0024 §2.3);
 *   - works come from `notionProjects()` — the committed, reviewed
 *     `published` + `public` set — so the card can never show a
 *     project the CMS snapshot does not publish.
 */

import { isPublicMediaKey } from '../../cloudflare/media-visibility';
import { notionProjects } from '../../portfolio/notion/reader';
import type { PortfolioMedia, PortfolioProject } from '../../portfolio/schema';
import { GitHubActivitySnapshotBody } from '../activity/schema';
import { PresenceSnapshotBody } from '../presence/schema';

/** Mirrored from `src/home/presence/load.ts` MAX_AGE_MS (ADR-0024 §2.3). */
export const PRESENCE_FRESHNESS_MS = 15 * 60 * 1000;

/** Raster formats the card embeds; SVG/GIF are skipped on purpose. */
const RASTER_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Authored showcase selection (ADR-0024 §2.3): slugs the owner picked
 * as representative works, in order. A slug absent from the public
 * snapshot simply does not render — the list annotates, it never
 * invents (same rule as `ACTIVITY_OVERRIDES`).
 */
export const FEATURED_SLUGS: readonly string[] = [
	'my-web-2025',
	'multislicer',
	'pomodoroom',
	'tegaki-anime',
];

/** How many work tiles the card renders. */
export const WORK_TILE_COUNT = 4;

/**
 * One servable cover candidate. SVG rendered through `<img>` (which is
 * how GitHub/Camo delivers it) forbids external subresources, so the
 * router embeds the bytes as a `data:` URI — the model therefore
 * carries the R2 identity, not a URL (ADR-0024 §2.3).
 */
export interface ProfileCardWorkMedia {
	readonly r2Key: string;
	readonly contentType: string;
}

export interface ProfileCardWork {
	readonly title: string;
	readonly summary: string;
	/** Ordered cover candidates (cover media first, then display order). */
	readonly media: readonly ProfileCardWorkMedia[];
	readonly alt: string;
	/** Filled by `embedWorkMedia` in the router; absent → placeholder. */
	readonly dataUri?: string;
}

export interface ProfileCardGitHub {
	readonly state: 'ok' | 'unavailable';
	/** Public-repo count observed by the snapshot (kind === 'public'). */
	readonly publicRepos: number;
	/** Private-repo count — an aggregate only, never an identity. */
	readonly privateRepos: number;
	readonly windowDays: number;
	/** Latest PUBLIC feed item, when one exists. */
	readonly latest?: {
		readonly repoId: string;
		readonly type: string;
		readonly at: string;
	};
	/** Newest source observation (`sources.*.observedAt`). */
	readonly observedAt?: string;
}

export type ProfileCardPresence =
	| {
			readonly state: 'ok';
			readonly statusLabel: string;
			/** Short status line: custom status or primary activity. */
			readonly detail: string | null;
			readonly observedAt: string;
	  }
	| {
			readonly state: 'stale' | 'unavailable';
			readonly observedAt: string | null;
	  };

export interface ProfileCardModel {
	readonly works: readonly ProfileCardWork[];
	readonly github: ProfileCardGitHub;
	readonly discord: ProfileCardPresence;
	/** Instant the card was composed (ISO). */
	readonly generatedAt: string;
}

/**
 * Pick the cover candidates for one project: the `isCover` raster media
 * first (display order), then any raster media. Only keys that pass the
 * public-media boundary (`isPublicMediaKey`) are kept — the card can
 * never embed a private object. `[]` when the project has no servable
 * raster cover — the tile falls back to a text-only panel, not a fake.
 */
function coverMediaCandidates(project: PortfolioProject): ProfileCardWorkMedia[] {
	const rasters = project.media.filter((media) => RASTER_CONTENT_TYPES.has(media.contentType));
	const ordered = [
		...rasters.filter((media) => media.isCover),
		...rasters.filter((media) => !media.isCover),
	].sort((a, b) => a.displayOrder - b.displayOrder);
	return ordered
		.filter((media) => isPublicMediaKey(media.r2Key))
		.map((media: PortfolioMedia) => ({
			r2Key: media.r2Key,
			contentType: media.contentType,
		}));
}

/** Deterministic fill order for non-featured slots: newest work first. */
function byRecency(a: PortfolioProject, b: PortfolioProject): number {
	const byPeriod = (b.periodStart ?? 0) - (a.periodStart ?? 0);
	if (byPeriod !== 0) return byPeriod;
	return a.slug.localeCompare(b.slug);
}

/**
 * Select the showcase works: `FEATURED_SLUGS` order first, then the
 * most recent remaining public projects, up to `WORK_TILE_COUNT`.
 * Only projects that resolve a servable raster cover are kept.
 */
export function selectShowcaseWorks(
	projects: readonly PortfolioProject[],
): readonly ProfileCardWork[] {
	const bySlug = new Map(projects.map((project) => [project.slug, project]));
	const picked: PortfolioProject[] = [];
	const seen = new Set<string>();
	for (const slug of FEATURED_SLUGS) {
		const project = bySlug.get(slug);
		if (project && !seen.has(project.id)) {
			seen.add(project.id);
			picked.push(project);
		}
	}
	for (const project of [...projects].sort(byRecency)) {
		if (picked.length >= WORK_TILE_COUNT) break;
		if (!seen.has(project.id)) {
			seen.add(project.id);
			picked.push(project);
		}
	}
	const works: ProfileCardWork[] = [];
	for (const project of picked.slice(0, WORK_TILE_COUNT)) {
		const media = coverMediaCandidates(project);
		if (media.length === 0) continue;
		works.push({
			title: project.title,
			summary: project.role ?? project.summary,
			media,
			alt: project.title,
		});
	}
	return works;
}

/**
 * Project the activity payload into the card's GitHub panel.
 * `null` payload or schema failure → `unavailable`.
 */
export function githubSummary(payload: unknown): ProfileCardGitHub {
	const parsed = GitHubActivitySnapshotBody.safeParse(payload);
	if (!parsed.success) {
		return { state: 'unavailable', publicRepos: 0, privateRepos: 0, windowDays: 0 };
	}
	const snapshot = parsed.data;
	const publicRepos = snapshot.repos.filter((repo) => repo.kind === 'public');
	const privateRepos = snapshot.repos.filter((repo) => repo.kind === 'private');
	const latest = snapshot.feed
		.filter((item) => item.kind === 'public')
		.slice()
		.sort((a, b) => (a.at < b.at ? 1 : -1))[0];
	const observedStamps = [
		snapshot.sources.public.observedAt,
		snapshot.sources.private.observedAt,
	].filter((stamp): stamp is string => typeof stamp === 'string');
	return {
		state: 'ok',
		publicRepos: publicRepos.length,
		privateRepos: privateRepos.length,
		windowDays: snapshot.windowDays,
		...(latest ? { latest: { repoId: latest.repoId, type: latest.type, at: latest.at } } : {}),
		...(observedStamps.length > 0 ? { observedAt: observedStamps.sort().at(-1) } : {}),
	};
}

const PRESENCE_STATUS_LABELS: Record<string, string> = {
	online: 'Online',
	idle: 'Idle',
	dnd: 'Do Not Disturb',
	offline: 'Offline',
	unknown: 'Unknown',
};

const ACTIVITY_TYPE_LABELS: Record<number, string> = {
	0: 'Playing',
	1: 'Streaming',
	2: 'Listening to',
	3: 'Watching',
	4: 'Custom status',
	5: 'Competing in',
};

/**
 * Mirror of the home reader's primary-activity pick
 * (`src/home/presence/reader.ts#projectToCard`): `isPrimary`, then the
 * first non-custom-status activity, then the first activity. The rule
 * is small enough that mirroring it — with this comment — is cheaper
 * than a new cross-owner edge (ADR-0024 §2.3).
 */
function presenceDetail(
	activities: readonly {
		type: number;
		name: string;
		details?: string;
		state?: string;
		isPrimary?: boolean;
	}[],
	customStatusText: string | undefined,
): string | null {
	if (customStatusText && customStatusText.trim() !== '') {
		return customStatusText.trim();
	}
	const primary =
		activities.find((a) => a.isPrimary === true) ??
		activities.find((a) => a.type !== 4) ??
		activities[0];
	if (!primary) return null;
	const label = ACTIVITY_TYPE_LABELS[primary.type] ?? 'Activity';
	const detail = primary.details ?? primary.state;
	const name = primary.name.trim();
	if (!name) return label;
	return detail ? `${label}: ${name} — ${detail}` : `${label}: ${name}`;
}

/**
 * Project the presence payload into the card's Discord panel.
 * `state: 'stale'` when the snapshot is valid but older than
 * `PRESENCE_FRESHNESS_MS`; `unavailable` for every other failure —
 * including the `userId` mismatch the home reader also enforces.
 */
export function discordSummary(
	payload: unknown,
	expectedUserId: string | undefined,
	now: number,
): ProfileCardPresence {
	if (!expectedUserId) {
		return { state: 'unavailable', observedAt: null };
	}
	const parsed = PresenceSnapshotBody.safeParse(payload);
	if (!parsed.success || parsed.data.userId !== expectedUserId) {
		return { state: 'unavailable', observedAt: null };
	}
	const snapshot = parsed.data;
	const generatedAtMs = Date.parse(snapshot.generatedAt);
	if (Number.isNaN(generatedAtMs)) {
		return { state: 'unavailable', observedAt: null };
	}
	if (now - generatedAtMs > PRESENCE_FRESHNESS_MS) {
		return { state: 'stale', observedAt: snapshot.generatedAt };
	}
	return {
		state: 'ok',
		statusLabel: PRESENCE_STATUS_LABELS[snapshot.status] ?? 'Unknown',
		detail: presenceDetail(snapshot.activities, snapshot.customStatusText),
		observedAt: snapshot.generatedAt,
	};
}

export interface ProfileCardModelInput {
	readonly activityPayload: unknown;
	readonly presencePayload: unknown;
	/** `env.DISCORD_PRESENCE_USER_ID`; absent → presence unavailable. */
	readonly expectedPresenceUserId?: string;
	/** Composition instant (ms epoch) — injected for deterministic tests. */
	readonly now: number;
	/** Project source; defaults to the committed public snapshot. */
	readonly projects?: readonly PortfolioProject[];
}

/** Assemble the full card model. Never throws on bad input. */
export function composeProfileCardModel(input: ProfileCardModelInput): ProfileCardModel {
	return {
		works: selectShowcaseWorks(input.projects ?? notionProjects()),
		github: githubSummary(input.activityPayload),
		discord: discordSummary(input.presencePayload, input.expectedPresenceUserId, input.now),
		generatedAt: new Date(input.now).toISOString(),
	};
}
