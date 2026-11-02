import { z } from 'zod';
import { PORTFOLIO_LINK_KINDS } from '../schema';
import { FacetSchema, PORTFOLIO_FACETS, SlugSchema } from '../schema';

/**
 * Notion CMS snapshot contract (Issue #765).
 *
 * The Worker never calls Notion. A one-off build-time step reads the
 * database, maps each page to a record here, and writes
 * `generated/snapshot.json`, which the reader validates before any of it
 * can reach a public surface. Three rules make that safe:
 *
 *   1. **The reader is the gate, not the writer.** The ingest script is a
 *      convenience; a stale, hand-edited or partially-written file must
 *      still fail closed here. Every structural problem is a refusal to
 *      publish, never a default value.
 *   2. **The record is narrower than the page.** Like
 *      `src/projects/types.ts`, this type deliberately expresses only
 *      what a public surface renders. A Notion property that is not in
 *      this contract does not travel — and a property that *is* here but
 *      has an unknown value is an error, because "unknown option" is a
 *      missing decision, not a variant of "other".
 *   3. **Publication authority stays local.** `status` and `visibility`
 *      are carried as *inputs* from Notion; `src/portfolio/notion/publish.ts`
 *      decides what a public caller may see, and it is the only module
 *      that does (ADR-0018 §2.6).
 *
 * Rights are baked into the snapshot rather than read at request time:
 * `quality/asset-license-inventory.json` is a repository artefact, not a
 * Worker binding, so the sync script consults it offline and records the
 * verdict per asset. The reader accepts exactly `recorded` and refuses
 * everything else (AGENTS.md §3 legal, fail-closed). Issue #811 revisits
 * that premise on the owner's authority; until its ADR lands, this is
 * what the code does.
 */

export const NOTION_SNAPSHOT_SCHEMA = 'portfolio-notion-snapshot.v1';

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const isoInstant = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
	message: 'not an ISO 8601 instant',
});

/** The six narrative sections the public page renders, in page order. */
export const NOTION_SECTIONS = [
	'motivation',
	'architecture',
	'constraints',
	'implementation',
	'evidence',
	'retrospective',
] as const;

export const NotionLinkSchema = z.object({
	// The vocabulary is `src/portfolio/schema.ts#PORTFOLIO_LINK_KINDS`, not a
	// second list: a Notion link kind this surface cannot render is an error
	// at map time rather than a silently mislabelled link at render time.
	kind: z.enum(PORTFOLIO_LINK_KINDS),
	label: z.string().max(200).nullable(),
	url: z.string().url(),
	displayOrder: z.number().int().min(0),
});

/**
 * One media reference. `rights` is the offline verdict, not a permission
 * the snapshot grants: `unrecorded` is rendered as "no URL", never as a
 * hint to try.
 */
export const NotionMediaSchema = z.object({
	r2Key: z.string().min(1).max(512),
	contentType: z.string().min(3).max(128),
	width: z.number().int().positive().nullable(),
	height: z.number().int().positive().nullable(),
	alt: z.string().max(500),
	caption: z.string().max(500).nullable(),
	isCover: z.boolean(),
	displayOrder: z.number().int().min(0),
	rights: z.enum(['recorded', 'unrecorded']),
});

export const NotionRecordSchema = z.object({
	/** Notion page id. The stable join key; the slug may be re-authored. */
	pageId: z.string().min(1).max(64),
	slug: SlugSchema,
	title: z.string().min(1).max(300),
	summary: z.string().max(2000),
	role: z.string().max(200),
	periodStart: z.number().int().min(1900).max(2200),
	periodEnd: z.number().int().min(1900).max(2200).nullable(),
	periodLabel: z.string().max(80).nullable(),
	facets: z.array(FacetSchema).max(PORTFOLIO_FACETS.length),
	technologies: z.array(z.string().max(80)).max(64),
	/** Inputs only — `publish.ts` decides whether they mean "public". */
	status: z.enum(['draft', 'published', 'archived']),
	visibility: z.enum(['public', 'unlisted', 'draft']),
	pinned: z.boolean(),
	displayOrder: z.number().int().min(0),
	sections: z.object({
		motivation: z.string(),
		architecture: z.string().nullable(),
		constraints: z.string().nullable(),
		implementation: z.string().nullable(),
		evidence: z.string().nullable(),
		retrospective: z.string().nullable(),
	}),
	links: z.array(NotionLinkSchema).max(32),
	media: z.array(NotionMediaSchema).max(32),
	/** Notion's `last_edited_time`. Drives the "last synced" display. */
	editedAt: isoInstant,
});

export const NotionSnapshotSchema = z.object({
	schema: z.literal(NOTION_SNAPSHOT_SCHEMA),
	source: z.object({
		/**
		 * The configured Notion object id — a database id or a data source id
		 * (`idKind` says which). Never the workspace id, never a token.
		 */
		databaseId: z.string().min(1).max(64),
		/**
		 * Which kind `databaseId` names (Issue #765). Notion's data-source
		 * model gives an operator two ids for one portfolio table, and the
		 * value people copy is usually the data source. Absent means the
		 * snapshot predates this field or was hand-authored — never that it
		 * names a database: an unknown kind is recorded as unknown, never guessed.
		 */
		idKind: z.enum(['database', 'data_source']).optional(),
		/** Capabilities actually exercised, so the ledger can be measured. */
		capabilities: z.array(z.enum(['read_content', 'read_user_information'])).max(4),
		fetchedAt: isoInstant,
		/** Where the content came from, for a human reading a stale page. */
		sourceUrl: z.string().url().nullable(),
	}),
	/** `unavailable` keeps the last known records but says so out loud. */
	availability: z.enum(['public', 'unavailable']),
	unavailableReason: z.string().max(200).nullable(),
	observedAt: isoInstant,
	contentDigest: digest,
	records: z.array(NotionRecordSchema).max(500),
});

export type NotionMedia = z.infer<typeof NotionMediaSchema>;
export type NotionRecord = z.infer<typeof NotionRecordSchema>;
export type NotionSnapshot = z.infer<typeof NotionSnapshotSchema>;

/**
 * What the reader hands back. A snapshot that does not validate is
 * `null` — the same shape `src/projects/snapshot.ts` uses, and for the
 * same reason: a caller that gets an empty list cannot tell "no CMS
 * records" from "the CMS file is broken", and the two must not render
 * the same way.
 */
export interface ReadSnapshot {
	readonly availability: NotionSnapshot['availability'];
	readonly unavailableReason: string | null;
	readonly fetchedAt: string;
	readonly observedAt: string;
	readonly records: readonly NotionRecord[];
}

/**
 * Validate an unknown value as a snapshot.
 *
 * `null` means "cannot be trusted" — wrong schema version, malformed
 * field, an unknown facet. It never means "use the defaults": every
 * default in this contract is a published decision, and a broken file
 * must not inherit one.
 */
export function parseSnapshot(value: unknown): ReadSnapshot | null {
	const parsed = NotionSnapshotSchema.safeParse(value);
	if (!parsed.success) return null;
	const snapshot = parsed.data;
	// `unavailable` without a reason is a state nobody can act on, and a
	// reason without `unavailable` would render an explanation for a state
	// the page is not in.
	if (snapshot.availability === 'unavailable' && snapshot.unavailableReason === null) return null;
	if (snapshot.availability === 'public' && snapshot.unavailableReason !== null) return null;
	return {
		availability: snapshot.availability,
		unavailableReason: snapshot.unavailableReason,
		fetchedAt: snapshot.source.fetchedAt,
		observedAt: snapshot.observedAt,
		records: snapshot.records,
	};
}
