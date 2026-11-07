import type { PortfolioProject } from '../schema';
import { type ReadSnapshot, parseSnapshot } from './contract';
import snapshotDocument from './generated/snapshot.json';
import { hasPublishedMediaKey, publicProjects } from './publish';

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
 * The committed snapshot used to be an **empty, `unavailable`** placeholder,
 * so a checkout that had never run the sync contributed zero projects. On
 * 2026-11-05 the owner published every page in the authoring database and
 * the ingest ran against it, so what ships now is the real record set. The
 * properties that made the placeholder safe still hold, and are what the
 * contract tests pin: the file is validated by the same gate the Worker
 * applies, a record that fails it publishes nothing (`null` → empty), and
 * only `published` + `public` records ever leave `publicProjects`. A
 * contributor with no token still needs no token: the file is committed,
 * not fetched at build time. The `unavailable` / reason pair stays carried
 * in the snapshot rather than being flattened into "zero records", so a
 * surface that wants to say so can; no shipped surface renders it yet,
 * because that is a public-copy change (ADR-0018 §2.5).
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

/**
 * May this `portfolio/notion/…` object be served right now?
 *
 * The CMS half of the `/media/<key>` approval (Issue #889): a
 * content-addressed image has no D1 `portfolio_media` row, so the D1
 * query cannot be what approves it. The bundled snapshot is the only
 * input, and the decision is `hasPublishedMediaKey` — the publication
 * rule the page already uses. There is still no fetch, no token and no
 * provider host here (see `runtime-boundary.test.ts`): the snapshot is a
 * committed file Vite inlines.
 */
export function isPublishedNotionMediaKey(key: string): boolean {
	return hasPublishedMediaKey(PARSED, key);
}
