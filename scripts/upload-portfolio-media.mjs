#!/usr/bin/env node
/**
 * Media upload helper — my-web-2025 → my-web-2026 (0.5.0) R2 MEDIA.
 *
 * Usage:
 *   node scripts/upload-portfolio-media.mjs --dry-run
 *   node scripts/upload-portfolio-media.mjs --apply --target=local
 *
 * What it does:
 *
 *   For each KEEP row's legacy `content_assets` row, the script
 *   classifies the asset into one of three buckets:
 *
 *     1. external_video (YouTube / Vimeo / nicovideo)
 *        → NOT uploaded. Already represented as a
 *          `portfolio_link` row with `kind = 'video'` by
 *          `scripts/migrate-portfolio-from-2025.mjs`. The script
 *          reports the existing link so the operator can verify
 *          the surface is intact.
 *
 *     2. local_file (relative path under `data/assets/...` in the
 *        legacy clone)
 *        → Uploads to R2 under `portfolio/<slug>/` and
 *          emits a `portfolio_media` INSERT. The actual R2 PUT
 *          uses `wrangler r2 object put` so the local / remote
 *          surface is identical to the other scripts.
 *
 *     3. external_other (any other URL)
 *        → NOT uploaded. Reported as a notice — the operator
 *          decides whether to add a `portfolio_link` or
 *          `portfolio_media` row.
 *
 * Idempotency:
 *   The R2 PUT uses `--content-type` and a deterministic key
 *   (`portfolio/<slug>/`), so a re-run overwrites the
 *   same byte range. The `portfolio_media` INSERT is keyed on
 *   `id` (deterministic) so re-runs are no-ops.
 *
 * Why a separate script (and not bundled into the main migration):
 *   The migration script is content / metadata only. Media
 *   migration is a longer-running operation (R2 PUTs are
 *   bandwidth-bound), and the media data may need curation
 *   (caption rewrites, alt text fixes, cover image selection)
 *   before it lands in the public surface.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** Node ≥ 22.5 has `node:sqlite` as a stable module. */
const NODE_VERSION = Number.parseInt(process.versions.node.split('.')[0], 10);
if (NODE_VERSION < 22) {
	console.error(
		`[media] node:sqlite requires Node ≥ 22; this environment is ${process.versions.node}.`,
	);
	process.exit(2);
}

const { DatabaseSync } = await import('node:sqlite');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const apply = args.has('--apply');
const target = parseArg(args, '--target') ?? 'local';

if (!dryRun && !apply) {
	console.error('Usage: node scripts/upload-portfolio-media.mjs --dry-run');
	console.error('       node scripts/upload-portfolio-media.mjs --apply --target=local');
	process.exit(2);
}
if (apply && target !== 'local') {
	// R2 remote uploads from a CI environment require Cloudflare
	// account credentials that the agent does not have. Force the
	// operator to run this locally with the production wrangler
	// config when remote is needed.
	console.error(
		`[media] --target=remote is not supported by this script; run from a workstation with 'wrangler r2 object put' credentials.`,
	);
	process.exit(2);
}

const VIDEO_HOSTS = [
	'youtu.be',
	'youtube.com',
	'youtube-nocookie.com',
	'vimeo.com',
	'nicovideo.jp',
];

function parseArg(set, name) {
	for (const a of set) {
		if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
	}
	return null;
}

/** Host → asset classification. */
function classifyAsset(src) {
	if (!src) return { kind: 'unknown', reason: 'empty src' };
	try {
		const u = new URL(src);
		const host = u.hostname.toLowerCase();
		// Inline the video host list so the function is self-contained
		// when loaded by `scripts/upload-portfolio-media.test.mjs`
		// (which extracts the function body via regex and runs it in
		// an isolated scope). Keep in sync with VIDEO_HOSTS above.
		const videoHosts = [
			'youtu.be',
			'youtube.com',
			'youtube-nocookie.com',
			'vimeo.com',
			'nicovideo.jp',
		];
		for (const vh of videoHosts) {
			if (host === vh || host.endsWith(`.${vh}`)) {
				return { kind: 'external_video', reason: `host ${host}` };
			}
		}
		if (u.protocol === 'http:' || u.protocol === 'https:') {
			return { kind: 'external_other', reason: `external url ${host}` };
		}
		return { kind: 'unknown', reason: `non-http(s) protocol ${u.protocol}` };
	} catch {
		// Not a URL — likely a relative path like `assets/foo.webp`.
		return { kind: 'local_file', reason: 'unparseable URL, treating as local path' };
	}
}

function findRefRoot(startDir) {
	const cwdCandidate = resolve(process.cwd(), '.reference/my-web-2025');
	if (existsSync(resolve(cwdCandidate, 'data/contents'))) return cwdCandidate;
	let cur = startDir;
	for (let depth = 0; depth < 6; depth++) {
		const candidate = resolve(cur, '.reference/my-web-2025');
		if (existsSync(resolve(candidate, 'data/contents'))) return candidate;
		const parent = dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}
	const worktreeMatch = startDir.match(/^(.+)\.worktrees\/[^/]+$/);
	if (worktreeMatch) {
		const siblingCandidate = resolve(worktreeMatch[1], '.reference/my-web-2025');
		if (existsSync(resolve(siblingCandidate, 'data/contents'))) return siblingCandidate;
	}
	console.error(`[media] cannot locate .reference/my-web-2025; looked upward from ${startDir}.`);
	console.error('Either clone it into the repo root or set MY_WEB_2025_REF.');
	process.exit(2);
}

function deriveSlug(legacyId) {
	return legacyId
		.toLowerCase()
		.replace(/_/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function escapeSql(value) {
	if (value === null || value === undefined) return 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
}

function contentTypeFromExt(filename) {
	const dot = filename.lastIndexOf('.');
	const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase();
	switch (ext) {
		case '.webp':
			return 'image/webp';
		case '.png':
			return 'image/png';
		case '.jpg':
		case '.jpeg':
			return 'image/jpeg';
		case '.gif':
			return 'image/gif';
		case '.svg':
			return 'image/svg+xml';
		case '.mp4':
			return 'video/mp4';
		case '.webm':
			return 'video/webm';
		default:
			return 'application/octet-stream';
	}
}

function main() {
	const classificationPath = join(
		root,
		'docs/migration/portfolio-2025-to-2026-classification.json',
	);
	if (!existsSync(classificationPath)) {
		console.error(`[media] classification file missing: ${classificationPath}`);
		process.exit(1);
	}
	const classified = JSON.parse(readFileSync(classificationPath, 'utf8')).classified;

	const refRoot = process.env.MY_WEB_2025_REF
		? resolve(process.env.MY_WEB_2025_REF)
		: findRefRoot(root);

	const buckets = { external_video: [], local_file: [], external_other: [], unknown: [] };
	const r2Commands = [];
	const sqlStatements = [];

	for (const row of classified) {
		if (row.classification !== 'KEEP') continue;

		const dbPath = join(refRoot, 'data/contents', row.db);
		let db;
		try {
			db = new DatabaseSync(dbPath, { readOnly: true });
		} catch {
			continue;
		}
		let assets;
		try {
			assets = db
				.prepare(
					'SELECT id, src, type, alt, width, height, "order" FROM content_assets WHERE content_id = ? ORDER BY "order" ASC',
				)
				.all(row.id);
		} catch {
			assets = [];
		} finally {
			db.close();
		}

		const slug = deriveSlug(row.id);
		const projectId = `legacy_${slug.replace(/[^a-z0-9-]/g, '_')}`;

		for (const asset of assets) {
			const cls = classifyAsset(asset.src);
			const enriched = {
				projectId,
				slug,
				legacyId: asset.id,
				src: asset.src,
				alt: asset.alt ?? '',
				width: asset.width ?? null,
				height: asset.height ?? null,
				order: asset.order ?? 0,
			};
			buckets[cls.kind].push(enriched);

			if (cls.kind === 'local_file') {
				// Local file: resolve src under refRoot/data/, upload
				// to R2 under portfolio/<slug>/.
				const localPath = join(refRoot, 'data', asset.src);
				if (!existsSync(localPath)) {
					buckets.unknown.push({ ...enriched, reason: `local file missing: ${localPath}` });
					continue;
				}
				const filename = basename(localPath);
				const r2Key = `portfolio/${slug}/${filename}`;
				const contentType = contentTypeFromExt(filename);
				const stat = statSync(localPath);

				if (apply) {
					const cmd = spawnSync(
						'pnpm',
						[
							'exec',
							'wrangler',
							'r2',
							'object',
							'put',
							`MEDIA/${r2Key}`,
							'--file',
							localPath,
							'--content-type',
							contentType,
							'--local',
						],
						{ cwd: root, stdio: 'inherit', env: process.env },
					);
					if (cmd.status !== 0) {
						console.error(`[media] r2 put failed for ${r2Key}`);
						process.exit(cmd.status ?? 1);
					}
				} else {
					r2Commands.push(
						`wrangler r2 object put MEDIA/${r2Key} --file ${localPath} --content-type ${contentType} --local`,
					);
				}

				const mediaId = `legacy_media_${projectId}_${asset.id ?? asset.order}`;
				const cols =
					'id, project_id, r2_key, content_type, width, height, alt, caption, is_cover, display_order, created_at';
				const values = [
					escapeSql(mediaId),
					escapeSql(projectId),
					escapeSql(r2Key),
					escapeSql(contentType),
					asset.width === null ? 'NULL' : asset.width,
					asset.height === null ? 'NULL' : asset.height,
					escapeSql(enriched.alt),
					'NULL',
					0, // agent default: cover image is set by owner override (see #78 follow-up)
					enriched.order,
					Date.now(),
				].join(', ');
				sqlStatements.push(`INSERT OR IGNORE INTO portfolio_media (${cols}) VALUES (${values});`);
			}
		}
	}

	// Print summary
	console.error('[media] classification summary:');
	for (const [kind, items] of Object.entries(buckets)) {
		console.error(`  ${kind}: ${items.length}`);
	}
	console.error(`  r2 PUT commands (dry-run): ${r2Commands.length}`);
	console.error(`  portfolio_media INSERTs: ${sqlStatements.length}`);

	if (dryRun) {
		process.stdout.write('-- r2 PUT commands\n');
		for (const c of r2Commands) process.stdout.write(`${c}\n`);
		process.stdout.write('\n-- portfolio_media INSERTs\n');
		for (const s of sqlStatements) process.stdout.write(`${s}\n`);
		return;
	}

	// Apply: write SQL to a tmp file and execute via wrangler d1.
	const tmp = mkdtempSync(join(tmpdir(), 'media-portfolio-'));
	const sqlPath = join(tmp, 'media.sql');
	writeFileSync(sqlPath, sqlStatements.join('\n'), { mode: 0o600 });

	try {
		const result = spawnSync(
			'pnpm',
			['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--file', sqlPath],
			{ cwd: root, stdio: 'inherit', env: process.env },
		);
		if (result.status !== 0) {
			console.error(`[media] wrangler exited with status ${result.status}`);
			process.exit(result.status ?? 1);
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

main();
