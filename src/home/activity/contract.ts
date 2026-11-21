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

/**
 * The Issue/PR a feed event belongs to (Issue #334 residual).
 *
 * Present only on event types whose GitHub payload carries the
 * object — `IssuesEvent`, `IssueCommentEvent`, `PullRequestEvent`,
 * `PullRequestReviewEvent`, `PullRequestReviewCommentEvent`. The
 * permalink is NOT stored: it is derived at projection time from the
 * public repo identity, so the snapshot never carries a URL the
 * generator did not verify.
 */
export interface ActivityFeedItemRef {
	readonly kind: 'issue' | 'pull';
	readonly number: number;
	/**
	 * `merged` is a PR-only state GitHub reports through
	 * `pull_request.merged` / `merged_at`; `open` / `closed` are the
	 * shared issue/PR states. Absent means the payload did not carry
	 * a state — the card then prints no state claim.
	 */
	readonly state?: 'open' | 'closed' | 'merged';
}

/** The recent-activity feed items for the status card (#319). */
export interface ActivityFeedItem {
	readonly id: string;
	readonly kind: 'public' | 'private';
	readonly repoId: string;
	readonly type: string;
	readonly at: string;
	/** The specific Issue/PR the event touched, when the payload had one. */
	readonly ref?: ActivityFeedItemRef;
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

/**
 * A feed item projected for the status card (#319 / #334): the public
 * feed entry plus the link target the snapshot can prove. When the
 * item carries `ref`, `href` is the event permalink
 * (`…/issues/<n>` / `…/pull/<n>`); otherwise it is the public repo
 * `htmlUrl`. The target is always derived from a public repo
 * identity — never a private identity, never a fabricated event URL.
 */
export interface HomeGitHubActivityFeedItem extends ActivityFeedItem {
	readonly href?: string;
}

/**
 * One public repository's MEASURED contribution inside the window
 * (#967): authored commits / PRs from the contribution search, not
 * the feed event count. Only repos whose measurement ran appear —
 * "not measured" is absent, never zero.
 */
export interface HomeGitHubActivityRepoMeasure {
	readonly id: string;
	readonly name: string;
	readonly href?: string;
	readonly commits: number;
	readonly pullRequests?: number;
	readonly windowDays: number;
}

/** The public projection the status card renders (#319). */
export interface HomeGitHubActivity {
	readonly generatedOn: string;
	readonly windowDays: number;
	readonly sources: GitHubActivitySnapshot['sources'];
	/** Public-repo feed items only — private items never leave the snapshot. */
	readonly feed: readonly HomeGitHubActivityFeedItem[];
	/**
	 * The top public repos by measured contribution (#967) — the
	 * semantic aggregate the card surfaces INSTEAD of asking the
	 * reader to decode a raw event enumeration. Empty when no public
	 * repo was measured; the card then renders no claims, not zeros.
	 */
	readonly topRepos: readonly HomeGitHubActivityRepoMeasure[];
	readonly repoCount: { readonly public: number; readonly private: number };
}
