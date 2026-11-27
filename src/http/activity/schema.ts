import { z } from 'zod';

/**
 * GitHub activity ingest — wire schema (Issues #316 / #319 / #932).
 *
 * This is the HTTP boundary's contract for
 * `PUT /api/v1/activity/github`: the exact JSON document
 * `scripts/sync-github-activity.mjs --push` sends and the only shape
 * that may be stored in D1 `github_activity_snapshot`.
 *
 * The schema is deliberately STRICT and allowlisted, mirroring
 * `src/http/presence/schema.ts`: `.strict()` rejects unknown keys,
 * every field is bounded, and private-kind entries are pinned to the
 * anonymous contract — `private-<hmac12>` id, the generic display
 * name, and NO `repoFullName`/`htmlUrl`/description/owner/branch
 * fields. A document that tries to smuggle a private identifier is
 * refused before D1. The public read path
 * (`src/home/activity/snapshot.ts`) re-validates the stored document
 * independently — this schema guards the WRITE, the reader guards
 * the READ.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const ANON_ID = /^private-[0-9a-f]{12}$/;
const PUBLIC_REPO_ID = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const SourceState = z
	.object({
		status: z.enum(['ok', 'unconfigured', 'failed']),
		observedAt: z.string().regex(RFC3339).max(64).optional(),
	})
	.strict();

const ActivityCounts = z
	.object({
		events: z.number().int().min(0).max(100_000),
		commits: z.number().int().min(0).max(100_000).optional(),
		prs: z.number().int().min(0).max(100_000).optional(),
		windowDays: z.number().int().min(1).max(365),
	})
	.strict();

const PublicRepo = z
	.object({
		id: z.string().regex(PUBLIC_REPO_ID).max(200),
		kind: z.literal('public'),
		name: z.string().min(1).max(200),
		summaryJa: z.string().max(500).optional(),
		repoFullName: z.string().max(200).optional(),
		htmlUrl: z.string().url().max(500).optional(),
		// Attribution scope (data contract §2.1, Issue #1245): how the
		// repo entered the directory. Public repos only — private
		// entries never carry it (PrivateRepo stays scope-free).
		scope: z.enum(['owned', 'org-member', 'collaborator', 'external-public']).optional(),
		lastActiveAt: z.string().max(64).optional(),
		weightLevel: z.enum(['primary', 'active', 'side', 'paused']).optional(),
		activity: ActivityCounts.optional(),
	})
	.strict();

const PrivateRepo = z
	.object({
		id: z.string().regex(ANON_ID),
		kind: z.literal('private'),
		// The generator only ever writes the generic alias; an authored
		// display name is applied by `overrides.ts` at read time, never
		// stored in the snapshot. Anything else is refused.
		name: z.literal('非公開プロジェクト'),
		lastActiveAt: z.string().max(64).optional(),
		activity: ActivityCounts.optional(),
	})
	.strict();

// The optional Issue/PR reference a feed item may carry (Issue #334).
// Strict and allowlisted like every other block: an unknown key, kind
// or state is refused at the write boundary.
const FeedItemRef = z
	.object({
		kind: z.enum(['issue', 'pull']),
		number: z.number().int().min(1).max(1_000_000),
		state: z.enum(['open', 'closed', 'merged']).optional(),
	})
	.strict();

const FeedItem = z
	.object({
		id: z.string().min(1).max(64),
		kind: z.enum(['public', 'private']),
		repoId: z.string().min(1).max(200),
		type: z.string().min(1).max(64),
		at: z.string().regex(RFC3339).max(64),
		ref: FeedItemRef.optional(),
	})
	.strict();

export const GitHubActivitySnapshotBody = z
	.object({
		schemaVersion: z.literal(1),
		generatedOn: z.string().regex(ISO_DATE),
		headSha: z.string().max(64).optional(),
		windowDays: z.number().int().min(1).max(365),
		sources: z
			.object({
				public: SourceState,
				private: SourceState,
			})
			.strict(),
		repos: z.array(z.discriminatedUnion('kind', [PublicRepo, PrivateRepo])).max(200),
		feed: z.array(FeedItem).max(100),
	})
	.strict();

export type GitHubActivitySnapshotValue = z.infer<typeof GitHubActivitySnapshotBody>;
