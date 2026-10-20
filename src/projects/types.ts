/**
 * Public project-introduction contract (Issue #621).
 *
 * A project introduction is a committed SNAPSHOT of a limited,
 * allowlisted view of a public upstream README. The snapshot is
 * produced offline by `scripts/sync-project-introductions.mjs`; the
 * Worker never calls GitHub for this page.
 *
 * The schema below is the reader half of that contract. It is
 * intentionally narrower than the upstream document: setup commands,
 * the secret model, machine-local identity and generated configuration
 * are not representable here at all.
 */

/** Snapshot shape version accepted by this reader. */
export const SUPPORTED_SNAPSHOT_SCHEMA_VERSION = 1;

/** A snapshot older than this is displayed as "not current". */
export const MAX_AGE_HOURS = 14 * 24;

/**
 * One inline run of extracted text, optionally a link.
 *
 * The snapshot never contains an HTML string. Every node is plain text
 * plus an already-validated absolute URL, so the page can render it as
 * React children without an HTML sink.
 */
export interface RichTextNode {
	readonly text: string;
	readonly href?: string;
	/** True when the upstream Markdown was an image. The page links to it. */
	readonly image?: boolean;
}

/** Closed set of reasons why the source could not be used. */
export interface UnavailableState {
	readonly reason: string;
	readonly observedAt: string;
}

/** Provenance of the README revision the snapshot was built from. */
export interface ProjectSourceProvenance {
	readonly id: string;
	readonly owner: string;
	readonly repo: string;
	readonly ref: string;
	readonly commitSha: string;
	readonly committedAt: string;
	readonly readmePath: string;
	readonly readmeBlobSha: string;
	readonly canonicalUrl: string;
	readonly readmeUrl: string;
}

/** One allowlisted README section. */
export interface IntroductionSection {
	readonly id: string;
	readonly heading: string;
	readonly anchor: string;
	readonly sourceUrl: string;
	readonly summary: readonly RichTextNode[] | null;
	readonly points: readonly (readonly RichTextNode[])[];
	readonly structure: readonly string[];
}

/** One related repository named by the upstream README. */
export interface RelatedRepository {
	readonly repo: string;
	readonly url: string;
	readonly label: string;
}

/** The extracted introduction, independent of provenance. */
export interface ProjectIntroduction {
	readonly title: string;
	readonly lead: readonly RichTextNode[];
	readonly sections: readonly IntroductionSection[];
	readonly relatedRepositories: readonly RelatedRepository[];
}

/** A committed snapshot as written by the sync script. */
export interface ProjectIntroductionSnapshot {
	readonly schemaVersion: number;
	readonly source: ProjectSourceProvenance;
	readonly availability: 'public' | 'unavailable';
	readonly unavailable: UnavailableState | null;
	readonly verifiedAt: string;
	readonly appliedAt: string;
	readonly contentDigest: string;
	readonly introduction: ProjectIntroduction;
}

/** How the page must present the snapshot's currency. */
export type FreshnessState = 'current' | 'stale' | 'unavailable' | 'unknown';

/** What the page receives after validation and freshness evaluation. */
export interface ProjectIntroductionView {
	readonly snapshot: ProjectIntroductionSnapshot | null;
	readonly freshness: FreshnessState;
	/** Why the snapshot is unavailable / unknown, for the operator-facing copy. */
	readonly reason: string | null;
}
