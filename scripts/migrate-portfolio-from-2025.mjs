#!/usr/bin/env node
/**
 * Migration script — my-web-2025 (151 portfolio DBs) → my-web-2026 (0.5.0 D1).
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
 *   agent-generated bucket assignment per legacy row.
 *
 *   * `KEEP` (agent automatic) → INSERT verbatim.
 *   * `KEEP+REWRITE (owner)`  → BLOCKED with a `OWNER_REQUIRED` notice. The
 *     script refuses to INSERT until the owner supplies the rewrite narrative
 *     in the override file (see `--owner-overrides`). Until then the row is
 *     counted in the dry-run summary as "skipped: owner required".
 *   * `DROP` (agent automatic) → skipped silently (reported in summary).
 *   * `NEW` (proposals, 8 rows) → NOT in the legacy DBs; the agent adds
 *     these via a separate `--new-proposals=path/to/new.json` flag once the
 *     owner confirms id + scope.
 *
 * Idempotency:
 *   Each INSERT uses `INSERT OR IGNORE` keyed on `portfolio_project.slug`.
 *   Re-runs are no-ops against a populated DB.
 *
 * Output:
 *   `--dry-run`         — prints SQL to stdout, never touches D1.
 *   `--apply --target=` — writes a temp `.sql` file and feeds it to
 *                         `wrangler d1 execute ... --file <tmp.sql>`. The
 *                         wrangler invocation is the same path `scripts/seed-portfolio.mjs`
 *                         uses, so the local / remote D1 surface is identical
 *                         to the seed.
 *
 * Field mapping (legacy `contents` / `markdown_pages` / `content_links` /
 * `content_assets` / `content_tags` → 0.5.0 schema):
 *
 *   portfolio_project:
 *     id            ← `legacy_<legacy_id>` (deterministic)
 *     slug          ← derived from legacy `id` (lowercase, dash-joined)
 *     title         ← contents.title
 *     summary       ← contents.summary (1 line)
 *     role          ← "Solo developer" (constant — no per-row role data)
 *     period_start  ← Date.parse(contents.published_at) → ms; or 0 (unknown)
 *     period_end    ← null (legacy has no end date — KEEP+REWRITE rows would
 *                       require owner input)
 *     period_label  ← contents.published_at (ISO date) — owner can override
 *     motivation_md ← markdown_pages.body (only the first heading block —
 *                       until #79 ships a richer extraction)
 *     facets        ← content_tags aggregated as JSON array, intersected
 *                       with the closed PortfolioFacet enum
 *     technologies  ← content_tags aggregated as JSON array (non-facet tags)
 *     visibility    ← 'public' (only KEEP rows are public+published; the
 *                       visibility boundary is preserved by the loader)
 *     status        ← 'published'
 *     pinned        ← 0 (agent default; owner can set pinned via override)
 *     display_order ← 100 (KEEP+REWRITE and NEW get owner-assigned)
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
 *     portfolio_project rows are populated).
 *
 * SQLite access:
 *   Uses `node:sqlite` (stable in Node ≥ 22.5). The runtime contract for the
 *   migration script is Node ≥ 22 (engines.pnpm 12.3 requires ≥ 20.18, but
 *   `node:sqlite` is gated to ≥ 22.5). The script checks the Node version
 *   at startup and exits with a clear error otherwise.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * Closed PortfolioFacet enum — the loader / schema rejects anything
 * outside this set, so we intersect legacy tags with it before INSERT.
 */
const PORTFOLIO_FACETS = new Set(['develop', 'video', 'design', 'other']);

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

/**
 * Deterministic slug derivation. The legacy `id` (e.g. `Border`,
 * `aulymo_v02`, `kosen-procon-pv`) is the source of truth; we normalise to
 * the 0.5.0 grammar `/^[a-z0-9][a-z0-9-]{0,127}$/`:
 *   * lowercase
 *   * `_` → `-`
 *   * strip any character outside `[a-z0-9-]`
 *   * collapse repeated `-`
 * If the result is empty (e.g. legacy id was all-underscores), we throw —
 * the owner must rename that row in the override file.
 */
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

/**
 * Parse ISO 8601 date string to Unix ms; return null on failure.
 *
 * `Date.parse` accepts many non-ISO formats (e.g. `2025/07/30` parses
 * fine in V8 but produces local-time-dependent values), so we gate
 * the input on the canonical ISO 8601 prefix: a 4-digit year followed
 * by `-`. Anything that fails this check returns null rather than a
 * timezone-dependent guess.
 */
function parseIsoMs(value) {
	if (typeof value !== 'string') return null;
	if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

/** Escape a SQL string literal value (single quote → double single quote). */
function sqlEscape(value) {
	if (value === null || value === undefined) return 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Read a source DB and extract one portfolio_project row (plus its
 * links). Returns null when the DB is unreadable.
 */
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
			}));

		const markdown = db
			.prepare(
				'SELECT body FROM markdown_pages WHERE content_id = ? ORDER BY updated_at DESC LIMIT 1',
			)
			.get(main.id);

		return {
			legacyId: main.id,
			title: main.title ?? '',
			summary: main.summary ?? '',
			publishedAt: main.published_at,
			createdAt: main.created_at,
			updatedAt: main.updated_at,
			facets,
			technologies,
			links,
			motivationMd: markdown?.body ?? '',
		};
	} finally {
		db.close();
	}
}

/** Build the INSERT statement for one portfolio_project row. */
function buildProjectSql(project) {
	const slug = deriveSlug(project.legacyId);
	const id = `legacy_${slug.replace(/[^a-z0-9-]/g, '_')}`;
	const periodStart = parseIsoMs(project.publishedAt) ?? parseIsoMs(project.createdAt) ?? 0;
	const periodEnd = 'NULL';
	const periodLabel = project.publishedAt ? `'${project.publishedAt.slice(0, 10)}'` : 'NULL';
	const createdAt = parseIsoMs(project.createdAt) ?? 0;
	const updatedAt = parseIsoMs(project.updatedAt) ?? createdAt;
	const facetsJson = JSON.stringify(project.facets).replace(/'/g, "''");
	const techJson = JSON.stringify(project.technologies).replace(/'/g, "''");
	const title = project.title.replace(/'/g, "''");
	const summary = project.summary.replace(/'/g, "''");
	const motivationMd = project.motivationMd.replace(/'/g, "''");

	const cols =
		'id, slug, title, summary, role, period_start, period_end, period_label, motivation_md, facets, technologies, visibility, status, pinned, display_order, created_at, updated_at';
	const values = [
		sqlEscape(id),
		sqlEscape(slug),
		sqlEscape(title),
		sqlEscape(summary),
		sqlEscape('Solo developer'),
		periodStart,
		periodEnd,
		periodLabel,
		sqlEscape(motivationMd),
		sqlEscape(facetsJson),
		sqlEscape(techJson),
		sqlEscape('public'),
		sqlEscape('published'),
		0,
		100,
		createdAt,
		updatedAt,
	].join(', ');

	return { id, slug, sql: `INSERT OR IGNORE INTO portfolio_project (${cols}) VALUES (${values});` };
}

/** Build INSERT statements for one project's links. */
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
			sql: `INSERT OR IGNORE INTO portfolio_link (${cols}) VALUES (${values});`,
		};
	});
}

function parseArg(set, name) {
	for (const a of set) {
		if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
	}
	return null;
}

/**
 * Main: read classification, walk KEEP rows, emit SQL.
 */
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
	const classified = data.classified;

	const summary = { KEEP: 0, 'KEEP+REWRITE (owner)': 0, DROP: 0, errors: 0 };
	const sqlStatements = [];
	const skippedOwner = [];
	const errors = [];

	for (const row of classified) {
		const cls = row.classification;
		summary[cls] = (summary[cls] ?? 0) + 1;

		if (cls !== 'KEEP') {
			if (cls === 'KEEP+REWRITE (owner)') skippedOwner.push(row.id ?? row.db);
			continue;
		}

		const dbPath = join(refRoot, 'data/contents', row.db);
		const source = readSourceRow(dbPath);
		if (source.error) {
			errors.push({ id: row.id ?? row.db, error: source.error });
			summary.errors++;
			continue;
		}

		try {
			const project = buildProjectSql(source);
			sqlStatements.push(`-- ${source.legacyId} (${row.db})`);
			sqlStatements.push(project.sql);

			const linkSqls = buildLinkSqls(project.id, source.links);
			for (const link of linkSqls) sqlStatements.push(link.sql);
		} catch (err) {
			errors.push({ id: row.id ?? row.db, error: err.message });
			summary.errors++;
		}
	}

	// Header banner
	const header = [
		`-- migrate-portfolio-from-2025.mjs — ${dryRun ? 'dry-run' : `apply to ${target} D1`}`,
		`-- generated: ${new Date().toISOString()}`,
		`-- KEEP:                     ${summary.KEEP}`,
		`-- KEEP+REWRITE (owner):     ${summary['KEEP+REWRITE (owner)'] ?? 0}  (BLOCKED — owner review required)`,
		`-- DROP:                     ${summary.DROP ?? 0}`,
		`-- errors:                   ${summary.errors}`,
		'--',
	];
	const fullSql = [...header, ...sqlStatements, ''].join('\n');

	if (dryRun) {
		process.stdout.write(fullSql);
		console.error('\n[migrate] dry-run complete:');
		console.error(`  KEEP rows → ${summary.KEEP} projects, ${sqlStatements.length} SQL statements`);
		console.error(
			`  KEEP+REWRITE owner-required → ${skippedOwner.length} (${skippedOwner.slice(0, 5).join(', ')}${skippedOwner.length > 5 ? ', …' : ''})`,
		);
		console.error(`  errors → ${errors.length}`);
		for (const e of errors) console.error(`    - ${e.id}: ${e.error}`);
		return;
	}

	// Apply: write tmp .sql + wrangler d1 execute --file
	const tmp = mkdtempSync(join(tmpdir(), 'migrate-portfolio-'));
	const sqlPath = join(tmp, 'migrate.sql');
	writeFileSync(sqlPath, fullSql, { mode: 0o600 });

	try {
		const cmdArgs = [
			'exec',
			'wrangler',
			'd1',
			'execute',
			'DB',
			target === 'local' ? '--local' : '--remote',
			'--file',
			sqlPath,
		];
		if (target === 'remote') {
			// Production deploy uses a different wrangler config. ADR-0014.
			cmdArgs.splice(cmdArgs.indexOf('DB'), 2, 'my-web-2026', '-c', 'wrangler.production.jsonc');
		}
		const result = spawnSync('pnpm', cmdArgs, { cwd: root, stdio: 'inherit', env: process.env });
		if (result.status !== 0) {
			console.error(`[migrate] wrangler exited with status ${result.status}`);
			process.exit(result.status ?? 1);
		}
		console.error(
			`[migrate] applied ${summary.KEEP} project(s) + ${sqlStatements.length} SQL statements to ${target} D1`,
		);
		if (skippedOwner.length > 0) {
			console.error(
				`[migrate] BLOCKED ${skippedOwner.length} KEEP+REWRITE rows (owner review required):`,
			);
			for (const id of skippedOwner) console.error(`  - ${id}`);
		}
		if (errors.length > 0) {
			console.error(`[migrate] ${errors.length} errors:`);
			for (const e of errors) console.error(`  - ${e.id}: ${e.error}`);
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

main();
