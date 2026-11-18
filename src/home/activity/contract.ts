/**
 * GitHub activity snapshot contract — the committed artefact the home
 * "現在地" sections read (Issues #316 / #319 / #932, Epic #928).
 *
 * Why a committed snapshot
 * ------------------------
 * Same rule as `src/home/current/git-facts.json` and
 * `src/projects/snapshots/`: a page render never calls GitHub. The
 * offline script `scripts/sync-github-activity.mjs` produces this
 * file; the Worker only reads and validates it. A value that changes
 * without a commit cannot be reviewed, and a GitHub outage can never
 * take the home page down.
 *
 * Privacy boundary (#932)
 * -----------------------
 * The snapshot is SPLIT into two projections at generation time:
 *
 *   - `public`  — facts about public repositories. Repo names, URLs
 *     and descriptions are publishable.
 *   - `private` — facts about private repositories, ALREADY anonymised
 *     by the generator: stable `private-<hmac>` ids, aggregate
 *     activity only. No name, owner, URL, branch, commit message,
 *     issue text or hash ever enters this file. The HMAC salt lives
 *     in the generator's environment, never in the repository, so the
 *     mapping cannot be reversed from published data.
 *
 * This module owns the TYPES and the fail-closed reader. Selection
 * rules live in `snapshot.ts`; overrides (hand-written copy,
 * exclusions, emphasis) live in `overrides.ts`.
 */

/** One repository's publishable activity facts. */
export interface ActivityRepoFacts {
	/**
	 * Public projects: `owner/name`. Private projects: the stable
	 * anonymous id `private-<12 hex>` — never the real name.
	 */
	readonly id: string;
	readonly kind: 'public' | 'private';
	/** Display name. Public: repo name. Private: authored alias only. */
	readonly name: string;
	/** One-line status, authored in `overrides.ts` or a safe default. */
	readonly summaryJa?: string;
	/** `owner/name` — public kind only. Never present for private. */
	readonly repoFullName?: string;
	/** `https://github.com/owner/name` — public kind only. */
	readonly htmlUrl?: string;
	/** ISO instant of the most recent observed activity. */
	readonly lastActiveAt?: string;
	/** Activity inside the counting window (see `windowDays`). */
	readonly activity?: {
		/** Public feed events observed for the repo in the window. */
		readonly events: number;
		/**
		 * Authored commits measured by the contribution search
		 * (Issue #967). Absent means "not measured" — never rendered
		 * as zero.
		 */
		readonly commits?: number;
		/** Authored pull requests updated inside the window. */
		readonly prs?: number;
		readonly windowDays: number;
	};
	/** Authored weight hint; absent = unsorted tail. */
	readonly weightLevel?: 'primary' | 'active' | 'side' | 'paused';
}

/** The recent-activity feed items for the status card (#319). */
export interface ActivityFeedItem {
	readonly id: string;
	readonly kind: 'public' | 'private';
	readonly repoId: string;
	readonly type: string;
	readonly at: string;
}

/** Source-level health: did the generator reach GitHub at all? */
export interface ActivitySourceState {
	readonly status: 'ok' | 'unconfigured' | 'failed';
	readonly observedAt?: string;
}

export interface GitHubActivitySnapshot {
	readonly schemaVersion: number;
	/** Day the snapshot was generated (`YYYY-MM-DD`). */
	readonly generatedOn: string;
	/** Commit the generator ran against, when run in CI. */
	readonly headSha?: string;
	/** The window `activity` counts were measured over, in days. */
	readonly windowDays: number;
	readonly sources: {
		readonly public: ActivitySourceState;
		readonly private: ActivitySourceState;
	};
	readonly repos: readonly ActivityRepoFacts[];
	readonly feed: readonly ActivityFeedItem[];
}

/** The public projection the status card renders (#319). */
export interface HomeGitHubActivity {
	readonly generatedOn: string;
	readonly windowDays: number;
	readonly sources: GitHubActivitySnapshot['sources'];
	/** Public-repo feed items only — private items never leave the snapshot. */
	readonly feed: readonly ActivityFeedItem[];
	readonly repoCount: { readonly public: number; readonly private: number };
}
