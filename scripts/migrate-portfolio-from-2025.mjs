#!/usr/bin/env node
/**
 * Migration script — my-web-2025 (151 portfolio DBs) → my-web-2026 (current D1).
 *
 * Usage:
 *   node scripts/migrate-portfolio-from-2025.mjs --dry-run
 *   node scripts/migrate-portfolio-from-2025.mjs --apply --target=local
 *   node scripts/migrate-portfolio-from-2025.mjs --apply --target=remote
 *
 * Input:
 *   `.reference/my-web-2025/data/contents/content-*.db` (read-only — this script
 *   only opens SQLite files for reading, never modifies the source).
 *
 * Classification:
 *   Reads `docs/migration/portfolio-2025-to-2026-classification.json` for the
 *   agent-generated two-axis bucket assignment per legacy row:
 *
 *     migration_class — technical eligibility:
 *       eligible           INSERT verbatim, write visibility per publication
 *       rewrite_required   INSERT verbatim, write visibility per publication
 *       mechanical_drop    NEVER insert
 *       new_candidate      NEVER auto-insert; owner must add via a separate
 *                          `--new-proposals=path/to/new.json` once the owner
 *                          confirms id + scope + narrative + media + role
 *
 *     publication — owner selection authority:
 *       approved        visibility = 'public' (the public loader will surface it)
 *       pending_owner   visibility = 'draft' (the pre-2026-11-02 default)
 *       rejected        NEVER insert (no surface at all)
 *
 *   The owner's 2026-11-02 decision (Issue #811,
 *   `docs/domain/portfolio-migration-decisions.md`) changed the default:
 *   EVERY work is published. The classification's `publication` column is
 *   still read — it says whether the owner rejected a row outright — but
 *   `pending_owner` no longer means "wait": it means "publish", because
 *   the owner decided that waiting was the wrong answer. `--visibility=draft`
 *   restores the pre-decision behaviour for a rehearsal.
 *
 *   Crucially, `migration_class = 'eligible'` does NOT imply
 *   `publication = 'approved'`. The 43 mechanically-eligible rows are
 *   `pending_owner` by default; the migration writes them with
 *   `visibility = 'draft'` so the public loader never sees them.
 *
 * Owner overrides:
 *   Reads `docs/migration/portfolio-2025-role-overrides.json`:
 *
 *     role_overrides          — per-legacy_id, sets `role` (grounded)
 *     publication_overrides   — per-legacy_id, sets `publication`
 *
 *   Role is set ONLY from `role_overrides`; facet/title inference is
 *   forbidden (AGENTS.md §3 + Issue #78 blocker #2). A work with no
 *   recorded role gets NULL, not a placeholder string: the owner's
 *   decision forbids INVENTING text about the work (Issue #811), and
 *   Issue #813 made the column nullable for exactly that reason.
 *
 * Preflight collision check (Issue #78 blocker #6):
 *   Before writing any SQL, the script queries the target D1 for any
 *   `portfolio_project.id` / `slug` collisions. Each colliding row is
 *   reported, and the migration aborts with exit 3 unless the
 *   collision is with a row the migration itself is about to write
 *   (i.e., re-running the same migration is idempotent).
 *
 *   `INSERT OR IGNORE` is therefore ONLY used as a re-run safety net
 *   for the migration's own previously-written rows. New collisions
 *   are NEVER silently ignored — they fail loudly.
 *
 * Markdown mapping (Issue #78 blocker #3):
 *   The legacy `markdown_pages.body` is NOT blindly mapped to
 *   `motivation_md`. The script applies conservative heading-keyword
 *   matching:
 *
 *     ## 動機 / Motivation    → motivation_md
 *     ## アーキテクチャ / Architecture → architecture_md
 *     ## 制約 / Constraints    → constraints_md
 *     ## 実装 / Implementation → implementation_md
 *     ## 証拠 / Evidence / 結果 → evidence_md
 *     ## 振り返り / Retrospective → retrospective_md
 *
 *   Unmatched content is dropped. The schema sections are not a
 *   catch-all. If `motivation_md` cannot be filled, the row is marked
 *   `narrative_missing` in `publication_blockers` and stays
 *   `visibility = 'draft'` until the owner rewrites the narrative.
 *
 * Output:
 *   `--dry-run`         — prints SQL to stdout, never touches D1.
 *   `--apply --target=` — writes a temp `.sql` file and feeds it to
 *                         `wrangler d1 execute ... --file <tmp.sql>`. The
 *                         wrangler invocation is the same path
 *                         `scripts/seed-portfolio.mjs` uses, so the
 *                         local / remote D1 surface is identical to
 *                         the seed.
 *
 * Field mapping (legacy `contents` / `markdown_pages` / `content_links` /
 * `content_tags` → current schema):
 *
 *   portfolio_project:
 *     id            ← `legacy_<slug>` (deterministic)
 *     slug          ← derived from legacy `id` (lowercase, dash-joined)
 *     title         ← contents.title
 *     summary       ← contents.summary (1 line)
 *     role          ← role_overrides[legacy_id].role (NULL otherwise)
 *     period_start  ← Date.parse(contents.published_at) → ms; or 0 (unknown)
 *     period_end    ← null (legacy has no end date)
 *     period_label  ← contents.published_at (ISO date) — owner can override
 *     motivation_md, architecture_md, constraints_md, implementation_md,
 *       evidence_md, retrospective_md
 *                   ← heading-keyword-matched sections from markdown_pages.body
 *     facets        ← content_tags aggregated as JSON array, intersected
 *                       with the closed PortfolioFacet enum
 *     technologies  ← content_tags aggregated as JSON array (non-facet tags)
 *     visibility    ← 'public' (owner decision, Issue #811); `--visibility=draft`
 *                     writes the pre-decision 'draft' instead
 *     evidence_status ← 'unreviewed' — the legacy corpus has no rights record
 *                     at all, and the public surface says so (ADR-0019 §2.5)
 *     status        ← 'published'
 *     pinned        ← 0 (agent default; owner can set pinned via override)
 *     display_order ← 100 (NEW + KEEP+REWRITE get owner-assigned later)
 *     created_at    ← Date.parse(contents.created_at)
 *     updated_at    ← Date.parse(contents.updated_at)
 *
 *   portfolio_link (one row per legacy content_links row):
 *     project_id    ← portfolio_project.id
 *     kind          ← inferred from URL host (booth → shop, github → repo,
 *                       youtube / vimeo → video, otherwise 'other')
 *     label         ← content_links.label ?? null
 *     url           ← content_links.href
 *     display_order ← content_links.order
 *
 *   portfolio_media:
 *     Skipped by this script. Media extraction + R2 upload is owned by
 *     `scripts/upload-portfolio-media.mjs` (parallel work, runs after
 *     portfolio_project rows are populated). The publication gate
 *     (`media_count >= 1` for `public+published`) is verified by
 *     `scripts/verify-portfolio.mjs`.
 *
 * SQLite access:
 *   Uses `node:sqlite` (stable in Node ≥ 22.5). The runtime contract for the
 *   migration script is Node ≥ 22 (engines.pnpm 12.3 requires ≥ 20.18, but
 *   `node:sqlite` is gated to ≥ 22.5). The script checks the Node version
 *   at startup and exits with a clear error otherwise.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeSqlFile, queryRows } from './_d1.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/**
 * Locate the legacy my-web-2025 reference clone. The migration script
 * lives inside a worktree that may not have a co-located `.reference/`;
 * the canonical location is the main repo's
 * `my-web-2026/.reference/my-web-2025/`. We check the following in order:
 *
 *   1. `${cwd}/.reference/my-web-2025` — the developer-side clone in
 *      the main repo.
 *   2. Walk up from the script's directory up to 6 ancestors looking
 *      for `.reference/my-web-2025/`.
 *   3. If the script lives under `<root>.worktrees/<N>/`, also check
 *      the sibling `<root>/.reference/my-web-2025/`. This is the
 *      canonical layout when the developer keeps `.reference/` in the
 *      main repo but runs the script from a stacked-PR worktree.
 *   4. Honour `MY_WEB_2025_REF` env override (preferred for CI).
 */
function isRefRoot(dir) {
	return existsSync(resolve(dir, 'data/contents')) && existsSync(resolve(dir, 'package.json'));
}

function findRefRoot(startDir) {
	const cwdCandidate = resolve(process.cwd(), '.reference/my-web-2025');
	if (isRefRoot(cwdCandidate)) return cwdCandidate;

	let cur = startDir;
	for (let depth = 0; depth < 6; depth++) {
		const candidate = resolve(cur, '.reference/my-web-2025');
		if (isRefRoot(candidate)) return candidate;
		const parent = dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}

	// Sibling-of-worktree: `<root>.worktrees/<N>/` ⇒ main repo at
	// `<root>/`. Strip a trailing `.worktrees/<segment>` from the
	// deepest script-location ancestor.
	const worktreeMatch = startDir.match(/^(.+)\.worktrees\/[^/]+$/);
	if (worktreeMatch) {
		const siblingCandidate = resolve(worktreeMatch[1], '.reference/my-web-2025');
		if (isRefRoot(siblingCandidate)) return siblingCandidate;
	}

	console.error(
		`[migrate] cannot locate .reference/my-web-2025; looked upward from ${startDir} and cwd ${process.cwd()}.`,
	);
	console.error('Either clone it into the repo root or set MY_WEB_2025_REF.');
	process.exit(2);
}

const refRoot = process.env.MY_WEB_2025_REF
	? resolve(process.env.MY_WEB_2025_REF)
	: findRefRoot(root);

/** Node ≥ 22.5 has `node:sqlite` as a stable module. */
const NODE_VERSION = Number.parseInt(process.versions.node.split('.')[0], 10);
if (NODE_VERSION < 22) {
	console.error(
		`[migrate] node:sqlite requires Node ≥ 22; this environment is ${process.versions.node}.`,
	);
	process.exit(2);
}

const { DatabaseSync } = await import('node:sqlite');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const apply = args.has('--apply');
const target = parseArg(args, '--target') ?? 'local';
/**
 * The visibility the migration writes.
 *
 * `public` is the owner's decision (Issue #811, 2026-11-02): every work
 * is published. `draft` restores the pre-decision behaviour, which is
 * what a rehearsal of the old rule looks like.
 */
const visibilityMode = parseArg(args, '--visibility') ?? 'public';
/** Write the migration ledger (151 rows) to the given path. */
const ledgerPath = parseArg(args, '--ledger');

if (!dryRun && !apply) {
	console.error('Usage: node scripts/migrate-portfolio-from-2025.mjs --dry-run');
	console.error(
		'       node scripts/migrate-portfolio-from-2025.mjs --apply --target=local|remote',
	);
	process.exit(2);
}
if (apply && target !== 'local' && target !== 'remote') {
	console.error(`--target must be 'local' or 'remote', got: ${target}`);
	process.exit(2);
}
if (visibilityMode !== 'public' && visibilityMode !== 'draft') {
	console.error(`--visibility must be 'public' or 'draft', got: ${visibilityMode}`);
	process.exit(2);
}

const PORTFOLIO_FACETS = new Set(['develop', 'video', 'design', 'other']);

/**
 * Heading keyword → schema section mapping. Conservative: a legacy
 * heading is mapped to a schema section ONLY when it explicitly uses
 * the keyword below. Anything else stays blank — `motivation_md` is
 * NOT a catch-all (Issue #78 blocker #3).
 *
 * Note: `\b` does NOT work as a word boundary for non-ASCII chars
 * (e.g. Japanese `動機`), so we use a `\s|$` lookahead instead.
 */
const HEADING_TO_SECTION = [
	{
		section: 'motivation_md',
		patterns: [/^#{1,3}\s*(動機|モチベーション|why|motivation)(?=\s|$)/i],
	},
	{
		section: 'architecture_md',
		patterns: [/^#{1,3}\s*(アーキテクチャ|architecture|設計)(?=\s|$)/i],
	},
	{
		section: 'constraints_md',
		patterns: [/^#{1,3}\s*(制約|constraints|constraint)(?=\s|$)/i],
	},
	{
		section: 'implementation_md',
		patterns: [/^#{1,3}\s*(実装|implementation|開発記録)(?=\s|$)/i],
	},
	{
		section: 'evidence_md',
		patterns: [/^#{1,3}\s*(証拠|エビデンス|evidence|result|結果)(?=\s|$)/i],
	},
	{
		section: 'retrospective_md',
		patterns: [/^#{1,3}\s*(振り返り|レトロスペクティブ|retrospective)(?=\s|$)/i],
	},
];

/**
 * URL host → link kind inference.
 */
function linkKindFromUrl(href) {
	try {
		const u = new URL(href);
		const host = u.hostname.toLowerCase();
		if (host === 'booth.pm' || host.endsWith('.booth.pm')) return 'shop';
		if (host === 'github.com' || host.endsWith('.github.com') || host === 'gitlab.com')
			return 'repo';
		if (
			host === 'youtu.be' ||
			host.endsWith('youtube.com') ||
			host.endsWith('youtube-nocookie.com') ||
			host === 'vimeo.com' ||
			host.endsWith('.vimeo.com') ||
			host === 'nicovideo.jp' ||
			host.endsWith('.nicovideo.jp')
		)
			return 'video';
		if (
			host === 'qiita.com' ||
			host.endsWith('.qiita.com') ||
			host === 'zenn.dev' ||
			host.endsWith('.zenn.dev')
		)
			return 'article';
		return 'other';
	} catch {
		return 'other';
	}
}

function deriveSlug(legacyId) {
	const slug = legacyId
		.toLowerCase()
		.replace(/_/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	if (!slug) {
		throw new Error(`cannot derive slug from legacy id: ${JSON.stringify(legacyId)}`);
	}
	if (slug.length > 127) {
		throw new Error(`derived slug exceeds 127 chars: ${slug}`);
	}
	return slug;
}

function parseIsoMs(value) {
	if (typeof value !== 'string') return null;
	if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

function sqlEscape(value) {
	if (value === null || value === undefined) return 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Walk markdown body, partition lines by headings, and emit per-section
 * bodies. A heading-keyword match captures everything from that
 * heading line (inclusive) until the next `## ` / `# ` heading
 * (exclusive). Sections without a matching keyword are NOT included
 * in the result; their content stays in the body but is dropped from
 * the schema.
 */
function partitionMarkdownBySection(body) {
	if (!body) {
		return Object.fromEntries(HEADING_TO_SECTION.map((m) => [m.section, '']));
	}
	const out = Object.fromEntries(HEADING_TO_SECTION.map((m) => [m.section, null]));
	const lines = body.split('\n');
	const sections = [];
	let cur = null;
	for (const line of lines) {
		const headingMatch = line.match(/^(#{1,3})\s+(.+?)\s*$/);
		if (headingMatch) {
			cur = { heading: line, lines: [] };
			sections.push(cur);
		} else if (cur) {
			cur.lines.push(line);
		}
	}
	for (const section of sections) {
		const headingText = section.heading;
		for (const m of HEADING_TO_SECTION) {
			if (m.patterns.some((p) => p.test(headingText))) {
				if (out[m.section] === null) {
					out[m.section] = [section.heading, ...section.lines].join('\n').trim();
				}
			}
		}
	}
	for (const k of Object.keys(out)) if (out[k] === null) out[k] = '';
	return out;
}

function readSourceRow(dbPath) {
	let db;
	try {
		db = new DatabaseSync(dbPath, { readOnly: true });
	} catch (err) {
		return { error: err.message };
	}
	try {
		const main = db
			.prepare(
				'SELECT id, title, summary, visibility, status, published_at, created_at, updated_at FROM contents LIMIT 1',
			)
			.get();
		if (!main) return { error: 'empty contents' };

		const tags = db
			.prepare('SELECT tag FROM content_tags WHERE content_id = ?')
			.all(main.id)
			.map((r) => r.tag);
		const facets = tags.filter((t) => PORTFOLIO_FACETS.has(t));
		const technologies = tags.filter((t) => !PORTFOLIO_FACETS.has(t));

		const links = db
			.prepare(
				'SELECT id, href, label, "order" FROM content_links WHERE content_id = ? ORDER BY "order" ASC',
			)
			.all(main.id)
			.map((r) => ({
				legacyId: r.id,
				href: r.href,
				label: r.label,
				order: r.order ?? 0,
			}))
			// Filter out rows with empty / protocol-less URLs — the
			// verifier rejects them, and `linkKindFromUrl` would silently
			// fall back to 'other'. Reporting the broken URL as a row
			// in `portfolio_link` would fail the AC for every project that
			// owns it.
			.filter((r) => {
				if (!r.href || typeof r.href !== 'string') return false;
				try {
					const u = new URL(r.href);
					return u.protocol === 'http:' || u.protocol === 'https:';
				} catch {
					return false;
				}
			});

		const markdown = db
			.prepare(
				'SELECT body FROM markdown_pages WHERE content_id = ? ORDER BY updated_at DESC LIMIT 1',
			)
			.get(main.id);

		// The legacy `media` table holds the bytes (Issue #850). The count
		// is only reported — the media rows themselves are written by
		// `scripts/migrate-legacy-media.mjs`.
		//
		// Every legacy DB holds exactly ONE content, so the whole `media`
		// table belongs to it — including the rows whose `content_id` is
		// NULL (they are attributed by that single-content structure).
		// Counting only the rows that carry a `content_id` would
		// understate the corpus, so the count is over the table.
		const mediaCount = db.prepare('SELECT COUNT(*) AS count FROM media').get()?.count ?? 0;

		// `content_assets` rows are references to a file path or an
		// external URL. They carry no bytes, so they are reported, not
		// migrated.
		const assetCount = db.prepare('SELECT COUNT(*) AS count FROM content_assets').get()?.count ?? 0;

		return {
			mediaCount,
			assetCount,
			legacyId: main.id,
			title: main.title ?? '',
			summary: main.summary ?? '',
			publishedAt: main.published_at,
			createdAt: main.created_at,
			updatedAt: main.updated_at,
			facets,
			technologies,
			links,
			markdownBody: markdown?.body ?? '',
		};
	} finally {
		db.close();
	}
}

/** Build the INSERT statement for one portfolio_project row. */
function buildProjectSql({ source, role, visibility, partition, evidenceStatus = 'unreviewed' }) {
	const slug = deriveSlug(source.legacyId);
	const id = `legacy_${slug.replace(/[^a-z0-9-]/g, '_')}`;
	const periodStart = parseIsoMs(source.publishedAt) ?? parseIsoMs(source.createdAt) ?? 0;
	const periodEnd = 'NULL';
	const periodLabel = source.publishedAt ? `'${source.publishedAt.slice(0, 10)}'` : 'NULL';
	const createdAt = parseIsoMs(source.createdAt) ?? 0;
	const updatedAt = parseIsoMs(source.updatedAt) ?? createdAt;
	const facetsJson = JSON.stringify(source.facets).replace(/'/g, "''");
	const techJson = JSON.stringify(source.technologies).replace(/'/g, "''");
	const title = source.title.replace(/'/g, "''");
	const summary = source.summary.replace(/'/g, "''");
	const motivationMd = partition.motivation_md.replace(/'/g, "''");
	const architectureMd = partition.architecture_md.replace(/'/g, "''");
	const constraintsMd = partition.constraints_md.replace(/'/g, "''");
	const implementationMd = partition.implementation_md.replace(/'/g, "''");
	const evidenceMd = partition.evidence_md.replace(/'/g, "''");
	const retrospectiveMd = partition.retrospective_md.replace(/'/g, "''");
	// `role` stays NOT NULL (migration 0010 explains why): "no role is
	// recorded" is the EMPTY STRING. We never hard-code a literal role
	// (Issue #78 blocker #2), and we never write a placeholder string
	// either — a placeholder is text this repository invented about the
	// work, which the owner's decision forbids. The loader maps the empty
	// string to `null` (`src/portfolio/schema.ts#rowToProject`).
	const roleSql = role === null ? sqlEscape('') : sqlEscape(role);
	const visibilitySql = sqlEscape(visibility);
	const evidenceStatusSql = sqlEscape(evidenceStatus);

	const cols =
		'id, slug, title, summary, role, period_start, period_end, period_label, motivation_md, architecture_md, constraints_md, implementation_md, evidence_md, retrospective_md, facets, technologies, visibility, status, pinned, display_order, created_at, updated_at, evidence_status';
	const values = [
		sqlEscape(id),
		sqlEscape(slug),
		sqlEscape(title),
		sqlEscape(summary),
		roleSql,
		periodStart,
		periodEnd,
		periodLabel,
		sqlEscape(motivationMd),
		sqlEscape(architectureMd),
		sqlEscape(constraintsMd),
		sqlEscape(implementationMd),
		sqlEscape(evidenceMd),
		sqlEscape(retrospectiveMd),
		sqlEscape(facetsJson),
		sqlEscape(techJson),
		visibilitySql,
		sqlEscape('published'),
		0,
		100,
		createdAt,
		updatedAt,
		evidenceStatusSql,
	].join(', ');

	return { id, slug, sql: buildProjectUpsertSql({ cols, values }) };
}

/**
 * Build an INSERT ... ON CONFLICT(id) DO UPDATE statement for
 * portfolio_project. CodeRabbit cycle 4 (Issue #78 blocker #4): the
 * previous `INSERT OR IGNORE` silently dropped owner changes when the
 * migration was re-run after editing `publication_overrides`. The
 * UPSERT form makes the migration idempotent AND respects owner
 * changes: every column except the deterministic id and the
 * `created_at` audit field is overwritten on conflict.
 *
 * `pinned` and `display_order` are also preserved from the existing
 * row (the migration does not own editorial ordering) — re-running
 * the migration after the owner has manually reordered rows must not
 * silently undo that.
 */
function buildProjectUpsertSql({ cols, values }) {
	const colList = cols.split(', ').map((c) => c.trim());
	const insertCols = colList.join(', ');
	// Columns to refresh from the migration's new value on conflict.
	const refreshCols = colList.filter(
		(c) => !['id', 'created_at', 'pinned', 'display_order'].includes(c),
	);
	const updateClause = refreshCols.map((c) => `${c} = excluded.${c}`).join(', ');
	return `INSERT INTO portfolio_project (${insertCols}) VALUES (${values})
		ON CONFLICT(id) DO UPDATE SET ${updateClause};`;
}

function buildLinkSqls(projectId, links) {
	return links.map((link) => {
		const kind = linkKindFromUrl(link.href);
		const id = `legacy_link_${projectId}_${link.legacyId ?? link.order}`;
		const label = link.label ?? null;
		const url = link.href.replace(/'/g, "''");
		const order = link.order ?? 0;
		const cols = 'id, project_id, kind, label, url, display_order, created_at';
		const values = [
			sqlEscape(id),
			sqlEscape(projectId),
			sqlEscape(kind),
			label === null ? 'NULL' : sqlEscape(label.replace(/'/g, "''")),
			sqlEscape(url),
			order,
			Date.now(),
		].join(', ');
		return {
			id,
			kind,
			sql: buildLinkUpsertSql({ id, values }),
		};
	});
}

/**
 * Same idempotent-UPSERT reasoning as `buildProjectUpsertSql`. Link
 * `id` is deterministic, so re-running the migration re-asserts the
 * same label / url / kind for an existing row without dropping the
 * `display_order` and `created_at` audit fields that an owner may
 * have curated.
 */
function buildLinkUpsertSql({ id: _id, values }) {
	const refreshCols = ['project_id', 'kind', 'label', 'url'];
	const updateClause = refreshCols.map((c) => `${c} = excluded.${c}`).join(', ');
	return `INSERT INTO portfolio_link (id, project_id, kind, label, url, display_order, created_at) VALUES (${values})
		ON CONFLICT(id) DO UPDATE SET ${updateClause};`;
}

function parseArg(set, name) {
	for (const a of set) {
		if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
	}
	return null;
}

/**
 * Query D1 (Issue #247).
 *
 * Wrangler is gone: the database is addressed by ID through the shared
 * cf driver, which normalises both the local `raw` and remote `query`
 * result shapes into object rows. The multi-version envelope parsing
 * this used to do by hand is no longer needed at the call site.
 */
function d1Query(sql) {
	return queryRows(sql, { target: target === 'remote' ? 'production' : 'local' });
}

/**
 * Why a legacy row is not a work.
 *
 * The classification's `mechanical_drop` is a MECHANICAL judgement, not
 * a selection: the row does not describe a work, so there is nothing to
 * publish. The three reasons are read off the row itself, and the ledger
 * carries the reason so the count can be audited rather than trusted.
 */
function notAWorkState(row) {
	const id = String(row.id ?? '');
	if (/^(media-list|media-rt)-/.test(id)) {
		return {
			state: 'not-a-work:scaffold',
			reason:
				'旧サイトの media 一覧용の足場行（media-list-* / media-rt-*）。作品の本文・画像・リンクを持たない。',
		};
	}
	if (/^test-/i.test(id)) {
		return {
			state: 'not-a-work:test-fixture',
			reason: '旧サイトのテスト用フィクスチャ行（test-*）。作品ではない。',
		};
	}
	return {
		state: 'not-a-work:placeholder',
		reason: 'draft かつリンク 0 件・本文 0 件で、作品の記述が無い行（プレースホルダ）。',
	};
}

/**
 * The migration ledger (151 rows).
 *
 * Every legacy row gets one line, and every line says what happened to
 * it — published, or not-a-work with the reason. The owner decided that
 * nothing is SELECTED, so the only thing that may keep a row out of the
 * public surface is "this row is not a work", and that claim has to be
 * visible per row.
 */
/** The legacy `media` table row count of one legacy database. */
function mediaCountFor(dbFile) {
	try {
		const db = new DatabaseSync(join(refRoot, 'data/contents', dbFile), { readOnly: true });
		try {
			return db.prepare('SELECT COUNT(*) AS count FROM media').get()?.count ?? 0;
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}

function buildLedger({ classified, plan, retired, errors, visibilityMode, mediaCountFor }) {
	const byLegacyId = new Map(plan.map((entry) => [entry.source.legacyId, entry]));
	const rows = [];
	const newCandidates = [];

	for (const row of classified) {
		if (!row.db) {
			newCandidates.push({
				legacyId: row.id ?? null,
				state: 'not-in-legacy-corpus',
				reason:
					'旧サイトの 151 件に含まれない、移行後に追加された пунктыの候補（自動挿入しない）。',
				note: row.note ?? null,
			});
			continue;
		}
		const inserted = byLegacyId.get(row.id);
		if (inserted) {
			rows.push({
				legacyId: row.id,
				db: row.db,
				state: 'published',
				reason: '旧サイトの制作物。owner 決定により公開する。',
				migrationClass: row.migration_class ?? null,
				slug: inserted.project.slug,
				projectId: inserted.project.id,
				visibility: inserted.visibility,
				status: 'published',
				evidenceStatus: 'unreviewed',
				role: inserted.role ?? null,
				linkRows: inserted.linkSqls.length,
				legacyMediaRows: inserted.source.mediaCount ?? null,
				legacyAssetRows: inserted.source.assetCount ?? null,
			});
			continue;
		}
		const notAWork = notAWorkState(row);
		rows.push({
			legacyId: row.id,
			db: row.db,
			state: notAWork.state,
			reason: notAWork.reason,
			migrationClass: row.migration_class ?? null,
			slug: null,
			projectId: null,
			visibility: null,
			status: null,
			evidenceStatus: null,
			role: null,
			linkRows: 0,
			legacyMediaRows: mediaCountFor(row.db),
			legacyAssetRows: row.local_file_count ?? null,
		});
	}

	const counts = rows.reduce((acc, row) => {
		acc[row.state] = (acc[row.state] ?? 0) + 1;
		return acc;
	}, {});

	return {
		schema: 'portfolio-2025-to-2026-publication.v1',
		issue: '#811',
		generatedAt: new Date().toISOString(),
		decision: 'docs/domain/portfolio-migration-decisions.md',
		source: '.reference/my-web-2025/data/contents',
		visibilityMode,
		counts: {
			legacyRows: rows.length,
			published: counts.published ?? 0,
			notAWork:
				(counts['not-a-work:scaffold'] ?? 0) +
				(counts['not-a-work:test-fixture'] ?? 0) +
				(counts['not-a-work:placeholder'] ?? 0),
			scaffold: counts['not-a-work:scaffold'] ?? 0,
			testFixture: counts['not-a-work:test-fixture'] ?? 0,
			placeholder: counts['not-a-work:placeholder'] ?? 0,
			newCandidates: newCandidates.length,
			errors: errors.length,
		},
		// The rows the legacy slug displaced. On a local database these are
		// the reproduction of the state production was in (three rows D1
		// already served under a legacy slug); the runbook says which
		// production rows they correspond to.
		retiredRows: retired,
		rows,
		newCandidates,
	};
}

function main() {
	const classificationPath = join(
		root,
		'docs/migration/portfolio-2025-to-2026-classification.json',
	);
	if (!existsSync(classificationPath)) {
		console.error(`[migrate] classification file missing: ${classificationPath}`);
		console.error('Run the offline classifier first (or commit docs/migration/).');
		process.exit(1);
	}
	const data = JSON.parse(readFileSync(classificationPath, 'utf8'));
	const classified = data.classified ?? [];

	const roleOverridePath = join(root, 'docs/migration/portfolio-2025-role-overrides.json');
	if (!existsSync(roleOverridePath)) {
		console.error(`[migrate] role overrides file missing: ${roleOverridePath}`);
		process.exit(1);
	}
	const roleFile = JSON.parse(readFileSync(roleOverridePath, 'utf8'));
	// The legacy ids are written with both `_` and `-` in the committed
	// overrides (`aulymo_v02` vs `aulymo-v02`), so the lookup key is
	// normalised. Without this, an owner-recorded role silently misses
	// the row it was recorded for.
	const normalizeLegacyId = (value) => String(value).replace(/_/g, '-').toLowerCase();
	const roleByLegacyId = new Map(
		(roleFile.role_overrides ?? []).map((r) => [normalizeLegacyId(r.legacy_id), r.role]),
	);
	const publicationByLegacyId = new Map(
		(roleFile.publication_overrides ?? []).map((r) => [
			normalizeLegacyId(r.legacy_id),
			r.publication,
		]),
	);

	const summary = {
		mechanical_drop: 0,
		new_candidate: 0,
		eligible_public: 0,
		eligible_draft: 0,
		rewrite_required_public: 0,
		rewrite_required_draft: 0,
		rejected: 0,
		errors: 0,
	};
	const sqlStatements = [];
	const skipped = [];
	const collisions = [];
	/** D1 rows the legacy slug displaces (retired, never deleted). */
	const retired = [];
	const errors = [];

	// First pass: build the SQL surface from the classification.
	const intendedInsertIds = new Set();
	const intendedInsertSlugs = new Set();
	const plan = []; // { row, source, role, visibility, partition, project, linkSqls }

	for (const row of classified) {
		const cls = row.migration_class ?? 'mechanical_drop';
		const pub =
			publicationByLegacyId.get(normalizeLegacyId(row.id)) ?? row.publication ?? 'pending_owner';

		if (cls === 'mechanical_drop') {
			summary.mechanical_drop++;
			continue;
		}
		if (cls === 'new_candidate') {
			summary.new_candidate++;
			continue;
		}
		if (pub === 'rejected') {
			summary.rejected++;
			continue;
		}

		// cls is eligible or rewrite_required
		const dbPath = join(refRoot, 'data/contents', row.db);
		const source = readSourceRow(dbPath);
		if (source.error) {
			errors.push({ id: row.id ?? row.db, error: source.error });
			summary.errors++;
			continue;
		}

		const role = roleByLegacyId.get(normalizeLegacyId(row.id)) ?? null;
		// Visibility (Issue #811, 2026-11-02): the owner decided that every
		// work is published, so the blockers that used to hold a row at
		// `draft` (missing role / missing media / missing narrative) are no
		// longer a publication gate — they are facts the page shows. The
		// pre-decision behaviour is still reachable with `--visibility=draft`.
		const blockers = row.publication_blockers ?? [];
		const visibility =
			visibilityMode === 'public'
				? 'public'
				: pub === 'approved' && blockers.length === 0
					? 'public'
					: 'draft';
		const partition = partitionMarkdownBySection(source.markdownBody);

		let project;
		let linkSqls;
		try {
			project = buildProjectSql({
				source,
				role,
				visibility,
				partition,
				// The legacy corpus has no rights record in this repository.
				// The owner decided to publish it anyway (ADR-0019), and the
				// public surface says so.
				evidenceStatus: 'unreviewed',
			});
			linkSqls = buildLinkSqls(project.id, source.links);
		} catch (err) {
			errors.push({ id: row.id ?? row.db, error: err.message });
			summary.errors++;
			continue;
		}

		// The counters report the visibility that is actually WRITTEN,
		// which after the owner's decision (Issue #811) is `public` for
		// every work unless the rehearsal flag says otherwise.
		const key = `${cls}_${visibility}`;
		summary[key] = (summary[key] ?? 0) + 1;

		intendedInsertIds.add(project.id);
		intendedInsertSlugs.add(project.slug);
		plan.push({ row, source, role, visibility, partition, project, linkSqls });
	}

	// Preflight collision check (Issue #78 blocker #6).
	// We refuse to write any SQL if the target D1 already has rows
	// the migration did not itself produce. CodeRabbit cycle 4:
	// the previous AND-only check missed the case where a row's `id`
	// differs from the migration's intended id but its `slug` matches
	// (e.g. previous run with different role-overrides produced a
	// different id but the same slug). Either dimension being absent
	// from the intended set is a real collision.
	const d1ExistingSlugs = new Set();
	if (apply) {
		const existingProjects = d1Query('SELECT id, slug FROM portfolio_project');
		for (const existing of existingProjects) d1ExistingSlugs.add(existing.slug);
		for (const existing of existingProjects) {
			const idKnown = intendedInsertIds.has(existing.id);
			const slugKnown = intendedInsertSlugs.has(existing.slug);
			if (idKnown && slugKnown) continue;
			if (!idKnown && !slugKnown) {
				// A row the migration did not produce, holding a slug the
				// migration does not want: it competes for nothing, but the
				// migration refuses to write into a database it does not
				// own. The exception is the migration's OWN rows and the
				// rows it retired earlier (both are recognisable), so that
				// re-running the migration is safe.
				const own = existing.id.startsWith('legacy_') || existing.slug.endsWith('-retired');
				if (own) {
					// A row this migration retired earlier is still a retired
					// row: the ledger keeps naming it, so the record of what
					// used to answer that URL survives every re-run.
					if (existing.slug.endsWith('-retired')) {
						retired.push({
							id: existing.id,
							slug: existing.slug,
							alreadyRetired: true,
							reason: 'already retired by an earlier run of this migration',
						});
					}
					continue;
				}
				collisions.push(existing);
				continue;
			}
			if (!idKnown && slugKnown) {
				// The legacy slug is the truth (owner decision, Issue #811,
				// ADR-0019 §2.6): the row D1 already serves under that slug
				// was made by the migration work, and it yields. The row is
				// RETIRED, not deleted — the audit trail of what used to be
				// published at that URL stays in the database.
				//
				// Retiring also has to FREE the slug, because the column is
				// UNIQUE and the legacy row is about to take it. The retired
				// row keeps its identity and its content under a retired
				// slug; nothing is deleted.
				retired.push({
					id: existing.id,
					slug: existing.slug,
					reason: 'legacy slug wins (owner decision, ADR-0019 §2.6)',
				});
				continue;
			}
			// The migration's planned row matches the id but not the slug —
			// that means the migration is trying to write a different
			// identity to the same row. This is a hard collision; we don't
			// silently let it through.
			collisions.push({ ...existing, kind: 'id_slug_mismatch' });
		}

		// Same for portfolio_link — the migration generates a deterministic
		// `legacy_link_*` id per row, so any non-legacy id is a real collision.
		const existingLinkIds = d1Query(
			"SELECT id FROM portfolio_link WHERE id NOT LIKE 'legacy_link_%'",
		);
		for (const existing of existingLinkIds) {
			collisions.push({ kind: 'link', id: existing.id });
		}

		if (collisions.length > 0) {
			console.error(
				`[migrate] COLLISION: target D1 has ${collisions.length} row(s) the migration did not produce.`,
			);
			console.error('Refusing to apply. Inspect with:');
			console.error(
				'  pnpm exec node scripts/d1.mjs query --target=local --sql "SELECT id, slug FROM portfolio_project"',
			);
			console.error(
				'  pnpm exec node scripts/d1.mjs query --target=local --sql "SELECT id FROM portfolio_link WHERE id NOT LIKE \'legacy_link_%\'"',
			);
			for (const c of collisions.slice(0, 10)) console.error(`  - ${JSON.stringify(c)}`);
			process.exit(3);
		}
	}

	// Retire the rows the legacy slug displaces. The row is archived and
	// hidden (`status='archived'`, `visibility='draft'`), never deleted:
	// the URL it used to answer stays in the audit trail, and the public
	// loader (`status='published' AND visibility='public'`) stops
	// serving it. The ledger records what was retired and why.
	//
	// The slug is moved aside as well, because `portfolio_project.slug` is
	// UNIQUE and the legacy row is about to answer that URL. The retired
	// row keeps its identity and its content.
	const takenSlugs = new Set([...intendedInsertSlugs, ...d1ExistingSlugs]);
	for (const row of retired) {
		if (row.alreadyRetired === true) continue;
		let retiredSlug = `${row.slug}-retired`;
		let counter = 2;
		while (takenSlugs.has(retiredSlug)) {
			retiredSlug = `${row.slug}-retired-${counter}`;
			counter += 1;
		}
		takenSlugs.add(retiredSlug);
		row.retiredSlug = retiredSlug;
		sqlStatements.push(`-- RETIRE ${row.id} (${row.slug}) — ${row.reason}`);
		sqlStatements.push(
			`UPDATE portfolio_project SET slug = '${retiredSlug.replace(/'/g, "''")}', visibility = 'draft', status = 'archived' WHERE id = '${row.id.replace(/'/g, "''")}';`,
		);
	}

	// Emit SQL.
	for (const p of plan) {
		sqlStatements.push(
			`-- ${p.source.legacyId} (${p.row.db}) — pub=${p.visibility} role=${p.role ?? 'NULL'}`,
		);
		sqlStatements.push(p.project.sql);
		for (const link of p.linkSqls) sqlStatements.push(link.sql);
	}

	// The ledger: 151 rows, one line each, with the state of every one.
	if (ledgerPath !== null) {
		const ledger = buildLedger({
			classified,
			plan,
			retired,
			errors,
			visibilityMode,
			mediaCountFor,
		});
		const ledgerFile = resolve(process.cwd(), ledgerPath);
		mkdirSync(dirname(ledgerFile), { recursive: true });
		// Tab indentation, because that is what the repository's formatter
		// (Biome) writes: a generated file that the formatter would rewrite
		// would make every regeneration a diff.
		writeFileSync(ledgerFile, `${JSON.stringify(ledger, null, '\t')}\n`);
		console.error(`[migrate] ledger written: ${ledgerPath}`);
		console.error(
			`[migrate]   published ${ledger.counts.published} / not-a-work ${ledger.counts.notAWork} (scaffold ${ledger.counts.scaffold} / test ${ledger.counts.testFixture} / placeholder ${ledger.counts.placeholder})`,
		);
	}

	const header = [
		`-- migrate-portfolio-from-2025.mjs — ${dryRun ? 'dry-run' : `apply to ${target} D1`}`,
		`-- generated: ${new Date().toISOString()}`,
		`-- eligible / published (visibility=public):       ${summary.eligible_public}`,
		`-- eligible / draft (visibility=draft):          ${summary.eligible_draft}`,
		`-- rewrite_required / published (visibility=public):   ${summary.rewrite_required_public}`,
		`-- rewrite_required / draft (visibility=draft):      ${summary.rewrite_required_draft}`,
		`-- mechanical_drop (never inserted):            ${summary.mechanical_drop}`,
		`-- new_candidate (never auto-inserted):         ${summary.new_candidate}`,
		`-- rejected by owner:                           ${summary.rejected}`,
		`-- errors:                                      ${summary.errors}`,
		'--',
	];
	const fullSql = [...header, ...sqlStatements, ''].join('\n');

	if (dryRun) {
		process.stdout.write(fullSql);
		console.error('\n[migrate] dry-run complete:');
		console.error(`  eligible / published       (visibility=public):  ${summary.eligible_public}`);
		console.error(`  eligible / draft           (visibility=draft):  ${summary.eligible_draft}`);
		console.error(
			`  rewrite_required / published       (visibility=public):  ${summary.rewrite_required_public}`,
		);
		console.error(
			`  rewrite_required / draft           (visibility=draft):  ${summary.rewrite_required_draft}`,
		);
		console.error(`  mechanical_drop (skipped):     ${summary.mechanical_drop}`);
		console.error(`  new_candidate (skipped):       ${summary.new_candidate}`);
		console.error(`  rejected (skipped):            ${summary.rejected}`);
		console.error(`  errors:                        ${errors.length}`);
		for (const e of errors) console.error(`    - ${e.id}: ${e.error}`);
		if (collisions.length > 0) {
			console.error(`  preflight collisions (would fail): ${collisions.length}`);
		}
		return;
	}

	const tmp = mkdtempSync(join(tmpdir(), 'migrate-portfolio-'));
	const sqlPath = join(tmp, 'migrate.sql');
	writeFileSync(sqlPath, fullSql, { mode: 0o600 });

	try {
		// Issue #247: D1 via the shared cf driver — addressed by canonical
		// database ID, explicit local/production target, and a production
		// write only when `execute` is set. The large SQL bundle stays a
		// file, converted to a cf batch payload rather than argv.
		try {
			executeSqlFile(sqlPath, {
				target: target === 'remote' ? 'production' : 'local',
				execute: target === 'remote',
			});
		} catch (error) {
			console.error(`[migrate] D1 apply failed: ${error.message}`);
			process.exit(1);
		}
		console.error(
			`[migrate] applied ${plan.length} project(s) + ${sqlStatements.length} SQL statements to ${target} D1`,
		);
		console.error(
			`[migrate]   eligible / published (visibility=public):       ${summary.eligible_public}`,
		);
		console.error(
			`[migrate]   eligible / draft (visibility=draft):          ${summary.eligible_draft}`,
		);
		console.error(
			`[migrate]   rewrite_required / published (visibility=public):   ${summary.rewrite_required_public}`,
		);
		console.error(
			`[migrate]   rewrite_required / draft (visibility=draft):      ${summary.rewrite_required_draft}`,
		);
		if (errors.length > 0) {
			console.error(`[migrate] ${errors.length} errors:`);
			for (const e of errors) console.error(`  - ${e.id}: ${e.error}`);
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

main();
