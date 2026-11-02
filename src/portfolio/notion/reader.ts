import type { PortfolioProject } from '../schema';
import { type ReadSnapshot, parseSnapshot } from './contract';
import snapshotDocument from './generated/snapshot.json';
import { publicProjects } from './publish';

/**
 * The snapshot the Worker bundles (Issue #765).
 *
 * Why a committed file rather than a fetch: the one-off build-time
 * ingest (`scripts/sync-portfolio-notion.mjs`) rewrites this file, Vite
 * inlines it at build time, and the request path reads it synchronously.
 * That is what makes "Notion is the authoring source of truth" compatible
 * with "the public site never depends on Notion being up" (ADR-0018 §§2.1,
 * 2.2). There is no runtime call and no scheduled job to keep the two
 * stores in step: a person runs the ingest when they mean to.
 *
 * The committed default is an **empty, `unavailable`** snapshot. That is
 * deliberate: a checkout that has never run the sync must contribute zero
 * projects and must not fail the build of a contributor who has no token.
 * The `unavailable` / reason pair is carried into the snapshot itself rather
 * than being flattened into "zero records", so a surface that wants to say
 * so can; no shipped surface renders it yet, because that is a public-copy
 * change (ADR-0018 §2.5) and not part of this ticket.
 *
 * Parsing happens once at module load. A snapshot that does not validate
 * becomes `null`, and every consumer treats `null` as "publish nothing
 * from the CMS" — the same fail-closed rule `src/projects/snapshot.ts`
 * applies to its own file.
 */

const PARSED: ReadSnapshot | null = parseSnapshot(snapshotDocument);

/**
 * Public projects the CMS contributes.
 *
 * Empty when the snapshot is absent or invalid. `unavailable` does *not*
 * empty it: the last known records stay published while the snapshot says
 * the source could not be reached, because deleting pages a visitor
 * bookmarked is a worse failure than showing yesterday's text
 * (ADR-0018 §2.5).
 */
export function notionProjects(): readonly PortfolioProject[] {
	return publicProjects(PARSED);
}
