#!/usr/bin/env node
/**
 * Legacy media migration — my-web-2025 `media` table → R2 `MEDIA` bucket
 * + `portfolio_media` rows (Issue #850).
 *
 * Usage:
 *   node scripts/migrate-legacy-media.mjs --dry-run
 *   node scripts/migrate-legacy-media.mjs --dry-run --target=production
 *   node scripts/migrate-legacy-media.mjs --apply --target=local
 *   node scripts/migrate-legacy-media.mjs --apply --target=production --execute
 *
 * What this script is FOR
 * -----------------------
 * The legacy site (`my-web-2025`) kept the body of its portfolio in a
 * `media` table whose `data` column is a BLOB — 297 files / 114,953,553
 * bytes across 151 SQLite databases. The existing upload helper
 * (`scripts/upload-portfolio-media.mjs`) reads `content_assets.src` and
 * only handles a local FILE PATH; it never reads a BLOB, so nothing was
 * ever moved. This script closes that gap: it reads the BLOB, hashes it,
 * uploads it under a deterministic key, and emits the `portfolio_media`
 * row that makes the asset visible to the portfolio surface.
 *
 * Relationship to the other migration scripts
 * --------------------------------------------
 *   `scripts/migrate-portfolio-from-2025.mjs` owns the TEXT migration
 *   (`portfolio_project` / `portfolio_link`). It skips two classes of
 *   legacy item on purpose: `mechanical_drop` (never inserted) and
 *   `new_candidate` (never auto-inserted). This script follows the
 *   SAME rule, because `portfolio_media.project_id` REFERENCES
 *   `portfolio_project(id)` and D1 enforces foreign keys (measured:
 *   `PRAGMA foreign_keys` = 1 on the local database). A media row for
 *   a project that will never exist cannot be written, and writing one
 *   for a dropped item would publish test fixtures as portfolio work.
 *
 *   So the scope of this script is exactly the items the text migration
 *   inserts: `migration_class` in {`eligible`, `rewrite_required`} and
 *   `publication` != `rejected`. Everything else is reported as a
 *   counted skip (`project_not_migrated`), never silently dropped.
 *
 * Determinism
 * -----------
 *   * R2 key: `portfolio/<slug>/<legacy-content-id>/<media-id>-<safe-name>`
 *   * Row id: `legacy_media_<project-id>_<legacy-media-id>`
 *   * project id: `legacy_<slug>` — the same rule as the text migration
 *   * cover: the first media row of a project (by `created_at`, then id)
 *
 *   Re-running the script overwrites the same keys with the same bytes
 *   and upserts the same rows, so it is safe to run twice.
 *
 * Byte duplicates
 * ---------------
 *   The legacy corpus contains byte-identical files (the same
 *   screenshot listed twice in one item, the same fixture in another
 *   item). Within ONE project the bytes are uploaded ONCE and every
 *   media row is still created — a duplicate row is a fact about the
 *   legacy item, and this script does not delete facts (the count of
 *   reused objects is reported). Across projects the bytes are
 *   uploaded per project, because the R2 key namespace is per project
 *   (`portfolio/<slug>/…`) and each row owns its key.
 *
 * Output
 * ------
 *   Status only: counts, byte totals and skip reasons. No media byte,
 *   no row body, no credential is ever printed (AGENTS.md §4).
 *
 * Exit codes: 0 = plan produced / applied, 2 = bad input, 3 = preflight
 * refusal (a project row is missing in the target D1).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_MEDIA_PREFIXES, isPublicMediaKey } from '../src/cloudflare/media-visibility.ts';
import { executeSqlFile, queryRows } from './_d1.mjs';
import { putObject } from './_r2.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const EXIT = { OK: 0, INPUT: 2, PREFLIGHT: 3 };

/**
 * Media types the public delivery route actually serves.
 *
 * Mirrors `DELIVERABLE_CONTENT_TYPES` in `src/http/media/router.ts`.
 * The list is duplicated on purpose: this script is an offline operator
 * tool that must not import the Worker runtime, and the rule it needs
 * is the exact opposite of the router's — the router REFUSES a type
 * it does not serve, so an object of that type could never be
 * delivered, and a `portfolio_media` row pointing at it is a row whose
 * image is permanently broken. Fail closed: skip it and count it.
 *
 * The duplication is pinned by `scripts/migrate-legacy-media.test.mjs`,
 * which reads the router's source and fails when the two lists drift.
 */
export const DELIVERABLE_CONTENT_TYPES = Object.freeze([
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'image/avif',
	'video/mp4',
	'video/webm',
]);

/**
 * The public namespace this script writes into.
 *
 * The allowlist itself is NOT redeclared here: it is read from
 * `PUBLIC_MEDIA_PREFIXES` (the SoT in
 * `src/cloudflare/media-visibility.ts`), so a namespace that stops
 * being public stops this script instead of silently writing into a
 * private bucket.
 */
export const PORTFOLIO_MEDIA_PREFIX = 'portfolio/';

/** Migration classes whose legacy items the text migration inserts. */
export const INSERTABLE_CLASSES = Object.freeze(['eligible', 'rewrite_required']);

/**
 * Parse the CLI boundary.
 *
 * `--dry-run` is the default: a script that mutates D1 / R2 must not
 * mutate anything because a flag was forgotten.
 */
export function parseArgs(argv) {
	const flags = new Map();
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith('--')) continue;
		const eq = token.indexOf('=');
		if (eq !== -1) {
			flags.set(token.slice(2, eq), token.slice(eq + 1));
			continue;
		}
		const next = argv[index + 1];
		if (next !== undefined && !next.startsWith('--')) {
			flags.set(token.slice(2), next);
			index += 1;
			continue;
		}
		flags.set(token.slice(2), true);
	}
	const apply = flags.get('apply') === true;
	const explicitDryRun = flags.get('dry-run') === true;
	return {
		apply,
		dryRun: explicitDryRun || !apply,
		target: String(flags.get('target') ?? 'local'),
		execute: flags.get('execute') === true,
		source: flags.get('source') === undefined ? null : String(flags.get('source')),
	};
}

/**
 * The slug rule of `scripts/migrate-portfolio-from-2025.mjs`.
 *
 * Duplicated on purpose: that script calls `main()` at module load, so
 * it cannot be imported without running the whole text migration. The
 * two copies must agree (the media key and the project id are derived
 * from this slug), and `scripts/migrate-legacy-media.test.mjs` pins the
 * shared cases against the corpus the text migration produced.
 */
export function deriveSlug(legacyId) {
	const slug = String(legacyId)
		.toLowerCase()
		.replace(/_/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	if (!slug) throw new Error(`cannot derive slug from legacy id: ${JSON.stringify(legacyId)}`);
	if (slug.length > 127) throw new Error(`derived slug exceeds 127 chars: ${slug}`);
	return slug;
}

/** The project id rule of `scripts/migrate-portfolio-from-2025.mjs`. */
export function projectIdForSlug(slug) {
	return `legacy_${slug.replace(/[^a-z0-9-]/g, '_')}`;
}

/**
 * A filename that is safe inside an R2 object key.
 *
 * The legacy filenames contain spaces, Japanese characters and dashes
 * (`Web 1920 – 2.png`, `スクリーンショット 2025-12-13 145044.png`). A key
 * may hold them, but an unnormalised name makes the key shape
 * unpredictable and the URL hard to read, so every character outside
 * `[A-Za-z0-9._-]` becomes `-`. The media id in front of it keeps the
 * key unique, so the sanitised name never has to be.
 */
export function safeFilename(name) {
	const base = basename(String(name ?? ''));
	const cleaned = base
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^[-.]+/, '')
		.replace(/-+$/, '');
	return cleaned.length > 0 ? cleaned : 'media';
}

/**
 * The alt text of a media row.
 *
 * `media.alt` → `media.description` → the file name without its
 * extension. An empty alt is never published: the schema requires a
 * non-empty `alt`, and a screen-reader-less image is a defect, not a
 * style choice. When none of the three sources yields text the row is
 * skipped instead of being published with an empty alt.
 */
export function resolveAlt({ alt, description, filename }) {
	for (const candidate of [alt, description]) {
		if (typeof candidate === 'string' && candidate.trim().length > 0) {
			return candidate.trim();
		}
	}
	const name = String(filename ?? '').trim();
	if (name.length === 0) return null;
	const ext = extname(name);
	const stem = ext.length > 0 ? name.slice(0, -ext.length) : name;
	return stem.trim().length > 0 ? stem.trim() : null;
}

/**
 * The content type of a media row.
 *
 * `media.mime_type` is used AS IS (the legacy site recorded the real
 * type). A missing or non-deliverable type is a fail-closed skip.
 */
export function resolveContentType(mimeType) {
	if (typeof mimeType !== 'string' || mimeType.trim().length === 0) {
		return { contentType: null, reason: 'content_type_missing' };
	}
	const normalized = mimeType.trim().toLowerCase().split(';')[0]?.trim() ?? '';
	if (!DELIVERABLE_CONTENT_TYPES.includes(normalized)) {
		return { contentType: null, reason: 'content_type_not_deliverable' };
	}
	return { contentType: normalized, reason: null };
}

/** The deterministic R2 key of one media row. */
export function buildR2Key({ slug, legacyContentId, mediaId, filename }) {
	const contentSegment = safeFilename(legacyContentId);
	const nameSegment = safeFilename(filename);
	return `${PORTFOLIO_MEDIA_PREFIX}${slug}/${contentSegment}/${mediaId}-${nameSegment}`;
}

/** The deterministic `portfolio_media.id` of one legacy media row. */
export function buildMediaId(projectId, legacyMediaId) {
	return `legacy_media_${projectId}_${legacyMediaId}`;
}

/**
 * Refuse a key that is not inside the public portfolio namespace.
 *
 * The namespace IS the publication boundary
 * (`src/cloudflare/media-visibility.ts`): a key outside a declared
 * public prefix is not servable, and a key inside one is served to
 * anyone who knows it. This script writes only into `portfolio/`, so
 * the guard is a fail-closed assertion on the key it is about to
 * upload — a key built from an unexpected slug can never leave this
 * process.
 *
 * The allowlist is read from the SoT, not restated: if `portfolio/`
 * stops being a declared public prefix, this script refuses to write
 * instead of putting an object into a namespace nobody may fetch.
 */
export function portfolioMediaPrefixGuard(key) {
	if (typeof key !== 'string' || !key.startsWith(PORTFOLIO_MEDIA_PREFIX)) {
		throw new Error(`refusing an R2 key outside ${PORTFOLIO_MEDIA_PREFIX}: ${JSON.stringify(key)}`);
	}
	if (!PUBLIC_MEDIA_PREFIXES.includes(PORTFOLIO_MEDIA_PREFIX)) {
		throw new Error(
			`refusing to write: ${PORTFOLIO_MEDIA_PREFIX} is not a declared public media prefix (${PUBLIC_MEDIA_PREFIXES.join(', ')})`,
		);
	}
	if (!isPublicMediaKey(key)) {
		throw new Error(
			`refusing an R2 key the visibility boundary does not publish: ${JSON.stringify(key)}`,
		);
	}
	if (key.includes('..') || key.includes('//')) {
		throw new Error(`refusing an R2 key with a path traversal: ${JSON.stringify(key)}`);
	}
	return key;
}

/**
 * Which legacy items the text migration inserts.
 *
 * Reads the same two artefacts the text migration reads:
 * `docs/migration/portfolio-2025-to-2026-classification.json` (the
 * technical class) and `docs/migration/portfolio-2025-role-overrides.json`
 * (the owner's publication decision). A `rejected` publication is never
 * inserted, whatever its technical class.
 */
export function selectInsertableProjects(classification, roleOverrides) {
	const publicationById = new Map(
		(roleOverrides?.publication_overrides ?? []).map((row) => [row.legacy_id, row.publication]),
	);
	const selected = new Map();
	for (const row of classification?.classified ?? []) {
		if (typeof row?.id !== 'string' || row.id.length === 0) continue;
		if (!INSERTABLE_CLASSES.includes(row.migration_class)) continue;
		const publication = publicationById.get(row.id) ?? row.publication ?? 'pending_owner';
		if (publication === 'rejected') continue;
		const slug = deriveSlug(row.id);
		selected.set(projectIdForSlug(slug), {
			projectId: projectIdForSlug(slug),
			slug,
			legacyContentId: row.id,
			db: typeof row.db === 'string' ? row.db : null,
		});
	}
	return selected;
}

/**
 * Turn raw legacy media rows into an upload + row plan.
 *
 * Pure: the caller supplies the rows and the project scope. Every
 * media row produces EXACTLY ONE outcome — a row, or a counted skip.
 * Nothing is dropped silently.
 */
export function planMedia({ mediaRows, projects }) {
	const rows = [];
	const uploads = [];
	const skips = {};
	const uploadedShaByProject = new Map();

	const skip = (reason) => {
		skips[reason] = (skips[reason] ?? 0) + 1;
	};

	// Deterministic order: project, then the legacy creation order.
	const ordered = [...mediaRows].sort((left, right) => {
		const byProject = String(left.projectId).localeCompare(String(right.projectId), 'en');
		if (byProject !== 0) return byProject;
		const byCreated = String(left.createdAt ?? '').localeCompare(
			String(right.createdAt ?? ''),
			'en',
		);
		if (byCreated !== 0) return byCreated;
		return String(left.mediaId).localeCompare(String(right.mediaId), 'en');
	});

	const displayOrderByProject = new Map();

	for (const media of ordered) {
		if (media.unattributed) {
			// The row carries no `content_id` and its database holds no
			// single content, so no project can be named for it.
			skip('project_unattributable');
			continue;
		}
		const project = projects.get(media.projectId);
		if (!project) {
			skip('project_not_migrated');
			continue;
		}

		const { contentType, reason: typeReason } = resolveContentType(media.mimeType);
		if (contentType === null) {
			skip(typeReason);
			continue;
		}

		const alt = resolveAlt({
			alt: media.alt,
			description: media.description,
			filename: media.filename,
		});
		if (alt === null) {
			skip('alt_unavailable');
			continue;
		}

		const sha256 = media.sha256;
		const projectSha = uploadedShaByProject.get(media.projectId) ?? new Map();
		const existing = projectSha.get(sha256);
		let r2Key;
		if (existing) {
			// Same bytes already uploaded for this project: reuse the
			// object, but still create the row (the legacy item listed
			// the file more than once).
			r2Key = existing;
		} else {
			r2Key = buildR2Key({
				slug: project.slug,
				legacyContentId: project.legacyContentId,
				mediaId: media.mediaId,
				filename: media.filename,
			});
			// A key the visibility boundary would refuse (a path
			// traversal, a character the key grammar rejects) must not
			// reach the bucket. It is counted as a skip, not thrown:
			// one unusable file must not abort the whole migration.
			try {
				portfolioMediaPrefixGuard(r2Key);
			} catch {
				skip('key_not_publishable');
				continue;
			}
			projectSha.set(sha256, r2Key);
			uploadedShaByProject.set(media.projectId, projectSha);
			uploads.push({ r2Key, sha256, bytes: media.bytes, contentType, media });
		}

		const displayOrder = displayOrderByProject.get(media.projectId) ?? 0;
		displayOrderByProject.set(media.projectId, displayOrder + 1);

		rows.push({
			id: buildMediaId(media.projectId, media.mediaId),
			projectId: media.projectId,
			r2Key,
			contentType,
			width: typeof media.width === 'number' ? media.width : null,
			height: typeof media.height === 'number' ? media.height : null,
			alt,
			caption: null,
			isCover: displayOrder === 0 ? 1 : 0,
			displayOrder,
			createdAt: media.createdAtMs ?? 0,
			dbFile: media.dbFile,
			mediaId: media.mediaId,
			sha256,
		});
	}

	return { rows, uploads, skips };
}

/** A SQL literal. */
export function sqlLiteral(value) {
	if (value === null || value === undefined) return 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * The SQL bundle for the planned rows.
 *
 * The cover reset runs first: `idx_portfolio_media_one_cover` allows
 * at most one `is_cover = 1` row per project, so a row that used to
 * hold the cover must be released before the new cover is written.
 * The reset is limited to the rows this script owns (`legacy_media_%`)
 * and to the projects this script writes, so an owner-curated row of
 * another project is never touched.
 */
export function buildMediaSql(rows) {
	const statements = [];
	const coverByProject = new Map();
	for (const row of rows) {
		if (row.isCover === 1 && !coverByProject.has(row.projectId)) {
			coverByProject.set(row.projectId, row.id);
		}
	}
	for (const [projectId, coverId] of coverByProject) {
		statements.push(
			`UPDATE portfolio_media SET is_cover = 0 WHERE project_id = ${sqlLiteral(projectId)} AND id LIKE 'legacy_media_%' AND id <> ${sqlLiteral(coverId)};`,
		);
	}
	for (const row of rows) {
		const columns =
			'id, project_id, r2_key, content_type, width, height, alt, caption, is_cover, display_order, created_at';
		const values = [
			sqlLiteral(row.id),
			sqlLiteral(row.projectId),
			sqlLiteral(row.r2Key),
			sqlLiteral(row.contentType),
			row.width === null ? 'NULL' : String(row.width),
			row.height === null ? 'NULL' : String(row.height),
			sqlLiteral(row.alt),
			row.caption === null ? 'NULL' : sqlLiteral(row.caption),
			String(row.isCover),
			String(row.displayOrder),
			String(row.createdAt),
		].join(', ');
		const refresh = [
			'project_id',
			'r2_key',
			'content_type',
			'width',
			'height',
			'alt',
			'caption',
			'is_cover',
			'display_order',
		]
			.map((column) => `${column} = excluded.${column}`)
			.join(', ');
		statements.push(
			`INSERT INTO portfolio_media (${columns}) VALUES (${values}) ON CONFLICT(id) DO UPDATE SET ${refresh};`,
		);
	}
	return statements;
}

/** Locate the legacy clone (same search order as the text migration). */
export function findRefRoot(startDir, cwd = process.cwd()) {
	const isRefRoot = (dir) =>
		existsSync(resolve(dir, 'data/contents')) && existsSync(resolve(dir, 'package.json'));
	const cwdCandidate = resolve(cwd, '.reference/my-web-2025');
	if (isRefRoot(cwdCandidate)) return cwdCandidate;
	let current = startDir;
	for (let depth = 0; depth < 6; depth += 1) {
		const candidate = resolve(current, '.reference/my-web-2025');
		if (isRefRoot(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const worktreeMatch = startDir.match(/^(.+)\.worktrees\/[^/]+$/);
	if (worktreeMatch) {
		const siblingCandidate = resolve(worktreeMatch[1], '.reference/my-web-2025');
		if (isRefRoot(siblingCandidate)) return siblingCandidate;
	}
	return null;
}

/**
 * Read every legacy media row.
 *
 * The BLOB is hashed here and NOT kept: the upload phase re-reads the
 * one row it needs, so the peak memory is one database (33 MB at the
 * largest), not the whole corpus (115 MB).
 */
export async function readLegacyMedia(refRoot, projects) {
	const { DatabaseSync } = await import('node:sqlite');
	const { readdirSync } = await import('node:fs');
	const contentsDir = join(refRoot, 'data/contents');
	const dbFiles = readdirSync(contentsDir)
		.filter((name) => name.startsWith('content-') && name.endsWith('.db'))
		.sort((left, right) => left.localeCompare(right, 'en'));

	const mediaRows = [];
	const problems = [];
	const corpus = {
		databases: 0,
		rows: 0,
		bytes: 0,
		uniqueSha: new Set(),
		attributedFromDatabase: 0,
	};

	for (const dbFile of dbFiles) {
		corpus.databases += 1;
		let db;
		try {
			db = new DatabaseSync(join(contentsDir, dbFile), { readOnly: true });
			const hasMedia = db
				.prepare("select name from sqlite_master where type = 'table' and name = 'media'")
				.get();
			if (!hasMedia) {
				db.close();
				continue;
			}
			const contents = db.prepare('select id from contents').all();
			const dbContentId = contents.length === 1 ? contents[0].id : null;
			const records = db
				.prepare(
					'select id, content_id, filename, mime_type, size, width, height, alt, description, created_at, data from media',
				)
				.all();
			for (const record of records) {
				const bytes = record.data?.length ?? 0;
				const sha256 = createHash('sha256')
					.update(record.data ?? Buffer.alloc(0))
					.digest('hex');
				corpus.rows += 1;
				corpus.bytes += bytes;
				corpus.uniqueSha.add(sha256);
				// A legacy row may carry no `content_id`; the database it
				// lives in holds exactly one content, so the attribution
				// is a fact of the corpus, not a guess. It is counted.
				const contentId = record.content_id ?? dbContentId;
				if (!record.content_id && contentId) corpus.attributedFromDatabase += 1;
				if (!contentId) {
					mediaRows.push({
						projectId: null,
						mediaId: record.id,
						filename: record.filename,
						mimeType: record.mime_type,
						width: record.width,
						height: record.height,
						alt: record.alt,
						description: record.description,
						createdAt: record.created_at,
						createdAtMs: Date.parse(record.created_at ?? '') || 0,
						sha256,
						bytes,
						dbFile,
						unattributed: true,
					});
					continue;
				}
				mediaRows.push({
					projectId: projectIdForSlug(deriveSlug(contentId)),
					mediaId: record.id,
					filename: record.filename,
					mimeType: record.mime_type,
					width: record.width,
					height: record.height,
					alt: record.alt,
					description: record.description,
					createdAt: record.created_at,
					createdAtMs: Date.parse(record.created_at ?? '') || 0,
					sha256,
					bytes,
					dbFile,
					unattributed: false,
				});
			}
			db.close();
		} catch (error) {
			problems.push({ db: dbFile, reason: String(error?.message ?? error) });
			try {
				db?.close();
			} catch {
				/* the read already failed; the close failure adds nothing */
			}
		}
	}
	return { mediaRows, problems, corpus };
}

/** Format the status report. Status only — never a byte, never a secret. */
export function formatReport({ corpus, plan, projects, applied, target }) {
	const lines = [];
	if (target) lines.push(`[legacy-media] target           ${target}`);
	lines.push(`[legacy-media] databases        ${corpus.databases}`);
	lines.push(`[legacy-media] media rows       ${corpus.rows} (${corpus.bytes} bytes)`);
	lines.push(`[legacy-media] unique sha256    ${corpus.uniqueSha.size}`);
	lines.push(`[legacy-media] attributed rows  ${corpus.attributedFromDatabase}`);
	lines.push(`[legacy-media] scoped projects  ${projects.size}`);
	lines.push(`[legacy-media] uploads          ${plan.uploads.length}`);
	lines.push(`[legacy-media] portfolio_media  ${plan.rows.length}`);
	const skipEntries = Object.entries(plan.skips).sort(([left], [right]) =>
		left.localeCompare(right),
	);
	if (skipEntries.length === 0) {
		lines.push('[legacy-media] skips            0');
	} else {
		lines.push(
			`[legacy-media] skips            ${skipEntries
				.map(([reason, count]) => `${reason}=${count}`)
				.join(' ')}`,
		);
	}
	if (applied) {
		lines.push('[legacy-media] applied          yes');
	}
	return lines.join('\n');
}

/**
 * Canonical target name.
 *
 * `remote` is the alias the sibling text migration
 * (`scripts/migrate-portfolio-from-2025.mjs`) uses for the production
 * target; both names mean the same canonical account. Any other name
 * is refused: this repository owns exactly one remote D1 / R2 pair,
 * and it must be named.
 */
export function normalizeTarget(target) {
	if (target === 'remote') return 'production';
	if (target === 'local' || target === 'production') return target;
	return null;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));

	const target = normalizeTarget(options.target);
	if (!target) {
		process.stderr.write(
			`[legacy-media] refusing target ${JSON.stringify(options.target)}: expected 'local' or 'production' (alias 'remote'). There is no other remote D1 / R2 this repository owns, and the only remote one is production and it must be named.\n`,
		);
		return EXIT.INPUT;
	}
	if (options.apply && target === 'production' && !options.execute) {
		process.stderr.write(
			'[legacy-media] refusing a production apply: --execute is required. ' +
				'A production apply writes the R2 bucket and the D1 rows of the live site, so the ' +
				'flag must be explicit. Re-run with --execute only after the operator authorisation ' +
				'in docs/runbook/legacy-media-migration.md.\n',
		);
		return EXIT.INPUT;
	}

	const major = Number.parseInt(process.versions.node.split('.')[0], 10);
	if (major < 22) {
		process.stderr.write(
			`[legacy-media] node:sqlite requires Node ≥ 22; this environment is ${process.versions.node}.\n`,
		);
		return EXIT.INPUT;
	}

	const refRoot = options.source
		? resolve(options.source)
		: process.env.MY_WEB_2025_REF
			? resolve(process.env.MY_WEB_2025_REF)
			: findRefRoot(root);
	if (!refRoot || !existsSync(join(refRoot, 'data/contents'))) {
		process.stderr.write(
			'[legacy-media] cannot locate the legacy corpus (.reference/my-web-2025). Pass --source=<clone> or set MY_WEB_2025_REF.\n',
		);
		return EXIT.INPUT;
	}

	const classificationPath = join(
		root,
		'docs/migration/portfolio-2025-to-2026-classification.json',
	);
	const overridesPath = join(root, 'docs/migration/portfolio-2025-role-overrides.json');
	for (const path of [classificationPath, overridesPath]) {
		if (!existsSync(path)) {
			process.stderr.write(`[legacy-media] required input missing: ${path}\n`);
			return EXIT.INPUT;
		}
	}
	const { readFileSync } = await import('node:fs');
	const classification = JSON.parse(readFileSync(classificationPath, 'utf8'));
	const roleOverrides = JSON.parse(readFileSync(overridesPath, 'utf8'));
	const projects = selectInsertableProjects(classification, roleOverrides);

	const { mediaRows, problems, corpus } = await readLegacyMedia(refRoot, projects);
	if (problems.length > 0) {
		for (const problem of problems) {
			process.stderr.write(`[legacy-media] unreadable: ${problem.db} (${problem.reason})\n`);
		}
		process.stderr.write('[legacy-media] nothing was written.\n');
		return EXIT.INPUT;
	}

	const plan = planMedia({ mediaRows, projects });

	if (options.dryRun) {
		process.stdout.write(`${formatReport({ corpus, plan, projects, applied: false, target })}\n`);
		process.stdout.write('[legacy-media] dry-run: nothing was uploaded and no row was written.\n');
		return EXIT.OK;
	}

	// Preflight: every project the rows reference must exist in the
	// target D1 (the foreign key would refuse the write anyway, and a
	// clear refusal beats a batch error half way through).
	const projectIds = [...new Set(plan.rows.map((row) => row.projectId))];
	const existing = queryRows(
		`SELECT id FROM portfolio_project WHERE id IN (${projectIds.map((id) => sqlLiteral(id)).join(', ')})`,
		{ target },
	).map((row) => row.id);
	const missing = projectIds.filter((id) => !existing.includes(id));
	if (missing.length > 0) {
		process.stderr.write(
			`[legacy-media] refusing to write: ${missing.length} project row(s) are missing in the ${target} D1 (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}). Run scripts/migrate-portfolio-from-2025.mjs --apply --target=${target === 'production' ? 'remote' : 'local'} first.\n`,
		);
		return EXIT.PREFLIGHT;
	}

	// Upload. One object per distinct (project, bytes) pair.
	const { DatabaseSync } = await import('node:sqlite');
	const tempDir = mkdtempSync(join(tmpdir(), 'legacy-media-'));
	let uploaded = 0;
	try {
		for (const upload of plan.uploads) {
			const dbPath = join(refRoot, 'data/contents', upload.media.dbFile);
			const db = new DatabaseSync(dbPath, { readOnly: true });
			const record = db.prepare('select data from media where id = ?').get(upload.media.mediaId);
			db.close();
			if (!record) {
				throw new Error(
					`legacy media row vanished: ${upload.media.dbFile}/${upload.media.mediaId}`,
				);
			}
			const filePath = join(tempDir, `${upload.sha256}.bin`);
			writeFileSync(filePath, record.data);
			portfolioMediaPrefixGuard(upload.r2Key);
			putObject(upload.r2Key, filePath, {
				target,
				contentType: upload.contentType,
				execute: options.execute,
			});
			rmSync(filePath, { force: true });
			uploaded += 1;
		}

		// Rows.
		const statements = buildMediaSql(plan.rows);
		const sqlPath = join(tempDir, 'portfolio-media.sql');
		writeFileSync(sqlPath, `${statements.join('\n')}\n`, { mode: 0o600 });
		executeSqlFile(sqlPath, { target, execute: options.execute });
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}

	process.stdout.write(`${formatReport({ corpus, plan, projects, applied: true, target })}\n`);
	process.stdout.write(`[legacy-media] objects uploaded ${uploaded}\n`);
	process.stdout.write(`[legacy-media] rows written      ${plan.rows.length}\n`);
	return EXIT.OK;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main().then((code) => {
		process.exitCode = code;
	});
}
