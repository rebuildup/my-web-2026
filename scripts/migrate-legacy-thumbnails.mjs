#!/usr/bin/env node
/**
 * Legacy thumbnail migration — my-web-2025 `contents.thumbnails` → R2 `MEDIA`
 * + `portfolio_media` cover rows (Issue #913).
 *
 * Usage:
 *   node scripts/migrate-legacy-thumbnails.mjs                       # dry-run (local plan)
 *   node scripts/migrate-legacy-thumbnails.mjs --apply --target=local
 *   node scripts/migrate-legacy-thumbnails.mjs --apply --target=production --execute
 *
 * What this script is FOR
 * -----------------------
 * The legacy site's LIST card image is `contents.thumbnails.image.src`
 * (measured: `content-m5_clock.db` → an URL of the legacy media API). No
 * script in this repository reads that column:
 *
 *   - `scripts/migrate-legacy-media.mjs` (Issue #850) migrates the `media`
 *     BLOB table only — 130 rows across 23 of the 60 published projects;
 *   - `scripts/upload-portfolio-media.mjs` reads `content_assets` only, and
 *     the corpus's 44 asset rows are all external VIDEO URLs.
 *
 * The result on the public surface (measured 2026-11-05): 35 of the 60
 * published projects have zero `portfolio_media` rows and render no `<img>`
 * anywhere — every one of those 35 carries an EXTERNAL thumbnail URL
 * (img.youtube.com / booth.pximg.net / pbs.twimg.com). This script closes
 * that gap under the contract Issue #913 states: an expiring external URL
 * is never the canonical source — the bytes are FETCHED AT INGEST TIME into
 * R2, and only the R2 key is referenced afterwards.
 *
 * Scope and skips
 * ---------------
 *   * Same project scope as the media migration: `migration_class` in
 *     {`eligible`, `rewrite_required`}, `publication != rejected`. A project
 *     that already has ANY `portfolio_media` row already displays an image
 *     (the loader falls back to the first row when no cover is set), so its
 *     external thumbnail is skipped (`media_rows_exist`) — replacing a
 *     published cover with the thumbnail is an owner decision, not this
 *     script's.
 *   * A thumbnail src that names a legacy `media` id (`…/api/cms/media?…&id=…`)
 *     is skipped (`media_blob_source`): those bytes belong to the media
 *     migration, and every project carrying one already has its rows.
 *   * A fetch that fails, exceeds the byte ceiling, or sniffs to a
 *     non-deliverable content type is a COUNTED skip, never a broken row.
 *
 * Determinism / idempotency
 * -------------------------
 *   * R2 key: `portfolio/<slug>/thumbnail/<sha256>.<ext>` — content
 *     addressed, so a re-run re-uploads identical bytes to the same key.
 *   * Row id: `legacy_thumb_<slug>`; the write is an upsert on that id.
 *   * `alt` is the project title (the image is the project's
 *     representative image); `caption` stays NULL.
 *
 * Output
 * ------
 *   Status only: counts and skip-reason codes. No URL, no object key,
 *   no byte, no credential (AGENTS.md §4).
 *
 * Exit codes: 0 = plan produced / applied, 2 = bad input, 3 = preflight
 * refusal (a project row is missing in the target D1).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { executeSqlFile, queryRows } from './_d1.mjs';
import { putObject } from './_r2.mjs';
import {
	DELIVERABLE_CONTENT_TYPES,
	findRefRoot,
	parseArgs,
	portfolioMediaPrefixGuard,
	projectIdForSlug,
	selectInsertableProjects,
	sqlLiteral,
	normalizeTarget,
} from './migrate-legacy-media.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const EXIT = { OK: 0, INPUT: 2, PREFLIGHT: 3 };

/** One thumbnail over this is an anomaly, not a photo. */
export const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024;

/** Fetch budget per URL. */
export const FETCH_TIMEOUT_MS = 30_000;

/** Content types a thumbnail row may carry (images the media route serves). */
export const THUMBNAIL_CONTENT_TYPES = Object.freeze([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'image/avif',
]);

const EXT_BY_CONTENT_TYPE = Object.freeze({
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/avif': 'avif',
});

/**
 * Classify one `thumbnails.image.src`.
 *
 * - `media_blob` — the src is the legacy media API naming a `media` table
 *   id; those bytes belong to `migrate-legacy-media.mjs` (#850).
 * - `external` — an absolute http(s) URL to fetch into R2 at ingest time.
 * - `unsupported` — anything else (empty, non-http scheme).
 */
export function classifyThumbnailSrc(src, mediaIds) {
	if (typeof src !== 'string' || src.trim().length === 0) {
		return { kind: 'unsupported', reason: 'no_thumbnail' };
	}
	let url;
	try {
		url = new URL(src);
	} catch {
		return { kind: 'unsupported', reason: 'unparseable_src' };
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return { kind: 'unsupported', reason: 'non_http_scheme' };
	}
	const mediaId = url.searchParams.get('id');
	if (mediaId && mediaIds.has(decodeURIComponent(mediaId))) {
		return { kind: 'media_blob', reason: 'media_blob_source' };
	}
	return { kind: 'external' };
}

/** Magic-byte sniff (declared headers are not trusted for a row's content_type). */
export function sniffImageContentType(bytes) {
	if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString('latin1') === 'PNG') {
		return 'image/png';
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}
	const gif = bytes.subarray(0, 6).toString('latin1');
	if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
	if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF') {
		const kind = bytes.subarray(8, 12).toString('latin1');
		if (kind === 'WEBP') return 'image/webp';
	}
	if (bytes.length >= 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp') {
		const brand = bytes.subarray(8, 12).toString('latin1');
		if (brand === 'avif' || brand === 'avis') return 'image/avif';
	}
	return null;
}

/**
 * Intrinsic size for the CLS reservation (`PortfolioMediaFigure` emits
 * width/height only when the row carries a positive size). PNG IHDR,
 * JPEG SOFn scan, GIF logical screen — the three formats the corpus's
 * thumbnails use (measured: 34 jpeg + 1 png). Anything else is `null`,
 * which the figure already handles.
 */
export function parseImageDimensions(bytes) {
	if (
		bytes.length >= 24 &&
		bytes[0] === 0x89 &&
		bytes.subarray(1, 4).toString('latin1') === 'PNG'
	) {
		return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
	}
	if (bytes.length >= 10 && bytes.subarray(0, 3).toString('latin1') === 'GIF') {
		return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
	}
	if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) {
				offset += 1;
				continue;
			}
			const marker = bytes[offset + 1];
			if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
				offset += 2;
				continue;
			}
			const length = bytes.readUInt16BE(offset + 2);
			const isSof =
				marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
			if (isSof) {
				return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
			}
			offset += 2 + length;
		}
	}
	return null;
}

/** Content-addressed key under the portfolio namespace. */
export function buildThumbnailR2Key(slug, sha256, contentType) {
	const ext = EXT_BY_CONTENT_TYPE[contentType];
	return `portfolio/${slug}/thumbnail/${sha256}.${ext}`;
}

/**
 * Read the thumbnail source of every in-scope legacy item.
 *
 * The classification ledger names each item's `db` file, so the read is
 * per-project, not a corpus walk. `mediaIds` is read alongside so a
 * media-API src can be recognised as a #850 byte source.
 */
export async function readThumbnailSources(refRoot, projects) {
	const { DatabaseSync } = await import('node:sqlite');
	const contentsDir = join(refRoot, 'data/contents');
	const sources = [];
	const problems = [];
	for (const project of projects.values()) {
		if (!project.db) continue;
		const dbPath = join(contentsDir, project.db);
		if (!existsSync(dbPath)) {
			problems.push({ project: project.slug, reason: 'db_missing' });
			continue;
		}
		let db;
		try {
			db = new DatabaseSync(dbPath, { readOnly: true });
			const content = db
				.prepare(
					'select id, title, visibility, status, thumbnails, created_at from contents limit 1',
				)
				.get();
			if (!content) {
				problems.push({ project: project.slug, reason: 'empty_contents' });
				continue;
			}
			const mediaIds = new Set(
				db.prepare("select name from sqlite_master where type = 'table' and name = 'media'").get()
					? db
							.prepare('select id from media')
							.all()
							.map((row) => row.id)
					: [],
			);
			let thumbnail = null;
			try {
				thumbnail = JSON.parse(content.thumbnails ?? 'null');
			} catch {
				problems.push({ project: project.slug, reason: 'thumbnails_unparseable' });
				continue;
			}
			sources.push({
				slug: project.slug,
				projectId: projectIdForSlug(project.slug),
				title: content.title ?? '',
				visibility: content.visibility,
				status: content.status,
				createdAtMs: Date.parse(content.created_at ?? '') || 0,
				src: thumbnail?.image?.src ?? null,
				mediaIds,
			});
		} catch (error) {
			problems.push({ project: project.slug, reason: String(error?.message ?? error) });
		} finally {
			db?.close();
		}
	}
	return { sources, problems };
}

/**
 * Fetch one external thumbnail. Returns the bytes, or a skip reason.
 * The GET is read-only and happens in BOTH modes: the R2 key is
 * content-addressed, so the plan needs the bytes too.
 */
export async function fetchThumbnail(src) {
	let response;
	try {
		response = await fetch(src, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	} catch {
		return { ok: false, reason: 'fetch_failed' };
	}
	if (!response.ok) return { ok: false, reason: `http_${response.status}` };
	const declared = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
	if (declared.startsWith('video/')) return { ok: false, reason: 'non_image' };
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.length > MAX_THUMBNAIL_BYTES) return { ok: false, reason: 'too_large' };
	const sniffed = sniffImageContentType(bytes);
	if (sniffed === null || !THUMBNAIL_CONTENT_TYPES.includes(sniffed)) {
		return { ok: false, reason: 'content_type_refused' };
	}
	return { ok: true, bytes, contentType: sniffed };
}

/** One planned row. */
export function planThumbnails({ sources, mediaRowCounts }) {
	const uploads = [];
	const skips = {};
	const skip = (reason) => {
		skips[reason] = (skips[reason] ?? 0) + 1;
	};
	for (const source of sources) {
		const existing = mediaRowCounts.get(source.projectId) ?? 0;
		if (existing > 0) {
			skip('media_rows_exist');
			continue;
		}
		const classified = classifyThumbnailSrc(source.src, source.mediaIds);
		if (classified.kind === 'unsupported') {
			skip(classified.reason);
			continue;
		}
		if (classified.kind === 'media_blob') {
			skip(classified.reason);
			continue;
		}
		uploads.push(source);
	}
	return { uploads, skips };
}

/** The SQL bundle: release our own cover first, then upsert the row. */
export function buildThumbnailSql(rows) {
	const statements = [];
	const seen = new Set();
	for (const row of rows) {
		if (seen.has(row.projectId)) continue;
		seen.add(row.projectId);
		statements.push(
			`UPDATE portfolio_media SET is_cover = 0 WHERE project_id = ${sqlLiteral(row.projectId)} AND id LIKE 'legacy_thumb_%' AND id <> ${sqlLiteral(row.id)};`,
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
			'NULL',
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

/** Status-only report. Never a URL, never a key, never a byte. */
export function formatReport({ counts, applied, target }) {
	const lines = [];
	if (target) lines.push(`[legacy-thumbnails] target           ${target}`);
	lines.push(`[legacy-thumbnails] scoped projects  ${counts.scopedProjects}`);
	lines.push(`[legacy-thumbnails] thumbnails       ${counts.sources}`);
	lines.push(`[legacy-thumbnails] fetches          ${counts.fetched}`);
	lines.push(`[legacy-thumbnails] uploads          ${counts.uploads}`);
	lines.push(`[legacy-thumbnails] portfolio_media  ${counts.rows}`);
	const skipEntries = Object.entries(counts.skips).sort(([left], [right]) =>
		left.localeCompare(right),
	);
	lines.push(
		skipEntries.length === 0
			? '[legacy-thumbnails] skips            0'
			: `[legacy-thumbnails] skips            ${skipEntries
					.map(([reason, count]) => `${reason}=${count}`)
					.join(' ')}`,
	);
	if (applied) lines.push('[legacy-thumbnails] applied          yes');
	return lines.join('\n');
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const target = normalizeTarget(options.target);
	if (!target) {
		process.stderr.write(
			`[legacy-thumbnails] refusing target ${JSON.stringify(options.target)}: expected 'local' or 'production' (alias 'remote').\n`,
		);
		return EXIT.INPUT;
	}
	if (options.apply && target === 'production' && !options.execute) {
		process.stderr.write(
			'[legacy-thumbnails] refusing a production apply: --execute is required. ' +
				'A production apply writes the R2 bucket and the D1 rows of the live site. ' +
				'Re-run with --execute only after explicit operator authorisation.\n',
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
			'[legacy-thumbnails] cannot locate the legacy corpus (.reference/my-web-2025). Pass --source=<clone> or set MY_WEB_2025_REF.\n',
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
			process.stderr.write(`[legacy-thumbnails] required input missing: ${path}\n`);
			return EXIT.INPUT;
		}
	}
	const classification = JSON.parse(readFileSync(classificationPath, 'utf8'));
	const roleOverrides = JSON.parse(readFileSync(overridesPath, 'utf8'));
	const projects = selectInsertableProjects(classification, roleOverrides);

	const { sources, problems } = await readThumbnailSources(refRoot, projects);
	if (problems.length > 0) {
		for (const problem of problems) {
			process.stderr.write(
				`[legacy-thumbnails] unreadable: ${problem.project} (${problem.reason})\n`,
			);
		}
		process.stderr.write('[legacy-thumbnails] nothing was written.\n');
		return EXIT.INPUT;
	}

	// Target state: which projects already carry media rows. One narrow
	// aggregate; a project with any row already displays an image.
	const mediaRowCounts = new Map(
		queryRows('SELECT project_id, COUNT(*) AS n FROM portfolio_media GROUP BY project_id', {
			target,
		}).map((row) => [row.project_id, row.n]),
	);

	const { uploads, skips } = planThumbnails({ sources, mediaRowCounts });

	// Fetch. Content-addressed keys need the bytes in both modes.
	const tempDir = mkdtempSync(join(tmpdir(), 'legacy-thumbnails-'));
	const rows = [];
	const fetchSkips = {};
	try {
		for (const source of uploads) {
			const result = await fetchThumbnail(source.src);
			if (!result.ok) {
				fetchSkips[result.reason] = (fetchSkips[result.reason] ?? 0) + 1;
				continue;
			}
			const sha256 = createHash('sha256').update(result.bytes).digest('hex');
			const r2Key = buildThumbnailR2Key(source.slug, sha256, result.contentType);
			try {
				portfolioMediaPrefixGuard(r2Key);
			} catch {
				fetchSkips.key_not_publishable = (fetchSkips.key_not_publishable ?? 0) + 1;
				continue;
			}
			const dimensions = parseImageDimensions(result.bytes);
			const filePath = join(tempDir, `${sha256}.bin`);
			writeFileSync(filePath, result.bytes);
			rows.push({
				id: `legacy_thumb_${source.slug}`,
				projectId: source.projectId,
				r2Key,
				contentType: result.contentType,
				width: dimensions && dimensions.width > 0 ? dimensions.width : null,
				height: dimensions && dimensions.height > 0 ? dimensions.height : null,
				alt: source.title,
				isCover: 1,
				displayOrder: 0,
				createdAt: source.createdAtMs,
				filePath,
			});
		}

		const counts = {
			scopedProjects: projects.size,
			sources: sources.length,
			fetched: rows.length,
			uploads: options.apply ? rows.length : 0,
			rows: options.apply ? rows.length : 0,
			skips: { ...skips, ...fetchSkips },
		};

		if (!options.apply) {
			process.stdout.write(`${formatReport({ counts, applied: false, target })}\n`);
			process.stdout.write(
				'[legacy-thumbnails] dry-run: nothing was uploaded and no row was written (the fetches above were read-only GETs).\n',
			);
			return EXIT.OK;
		}

		// Preflight: every project the rows reference must exist in the
		// target D1 (the foreign key would refuse the write anyway).
		const projectIds = [...new Set(rows.map((row) => row.projectId))];
		if (projectIds.length > 0) {
			const existing = queryRows(
				`SELECT id FROM portfolio_project WHERE id IN (${projectIds.map((id) => sqlLiteral(id)).join(', ')})`,
				{ target },
			).map((row) => row.id);
			const missing = projectIds.filter((id) => !existing.includes(id));
			if (missing.length > 0) {
				process.stderr.write(
					`[legacy-thumbnails] refusing to write: ${missing.length} project row(s) are missing in the ${target} D1. Run scripts/migrate-portfolio-from-2025.mjs --apply --target=${target === 'production' ? 'remote' : 'local'} first.\n`,
				);
				return EXIT.PREFLIGHT;
			}
		}

		let uploaded = 0;
		for (const row of rows) {
			putObject(row.r2Key, row.filePath, {
				target,
				contentType: row.contentType,
				execute: options.execute,
			});
			uploaded += 1;
		}

		const sqlPath = join(tempDir, 'portfolio-thumbnails.sql');
		writeFileSync(sqlPath, `${buildThumbnailSql(rows).join('\n')}\n`, { mode: 0o600 });
		executeSqlFile(sqlPath, { target, execute: options.execute });

		counts.uploads = uploaded;
		process.stdout.write(`${formatReport({ counts, applied: true, target })}\n`);
		process.stdout.write(`[legacy-thumbnails] objects uploaded ${uploaded}\n`);
		process.stdout.write(`[legacy-thumbnails] rows written      ${rows.length}\n`);
		return EXIT.OK;
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main().then((code) => {
		process.exitCode = code;
	});
}
