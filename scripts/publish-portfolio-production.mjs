#!/usr/bin/env node
/**
 * Repository-owned production publication driver for the current
 * release's portfolio publication flip window (Issue #78 Path A —
 * 3 candidates).
 *
 * This script exists because the generic production deploy surface
 * (`scripts/run-deploy-inner.mjs`) does NOT touch portfolio project /
 * link / media data or R2 media objects. The #120 supplementary seed
 * (`scripts/seed-portfolio-path-a.mjs`) is explicitly local-only (rejects
 * `--target=remote`). This driver closes the gap.
 *
 * Usage:
 *
 *   node scripts/publish-portfolio-production.mjs \
 *     --operation=prepare|verify|publish|unpublish \
 *     --environment=local|prod \
 *     [--execute]
 *
 * Default is **dry-run**. Production mutation requires `--execute` AND
 * an explicit `--environment=prod`. The driver is gated by [[release-merge-human-gate]]
 * + [[issue-99-driver-incident]]: agents MUST NOT pass `--execute
 * --environment=prod` without explicit operator authorization in the
 * current interaction.
 *
 * 4 operations:
 *
 *   prepare   — UPSERT project / link / media for the 3 candidates;
 *               R2 PUT the 3 manifest assets; visibility stays 'draft'.
 *   verify    — read-only check: 3 rows exist, content matches,
 *               R2 objects exist with correct SHA-256 + content type.
 *   publish   — exact 3 IDs: visibility='public' + status='published'.
 *               Requires a recent successful verify (state file).
 *   unpublish — rollback: exact 3 IDs: visibility='draft'.
 *
 * Invariants (same as #121):
 *
 *   - INSERT OR REPLACE forbidden (would destroy owner-added rows via
 *     ON DELETE CASCADE on portfolio_link / portfolio_media).
 *   - INSERT ... ON CONFLICT(id) DO UPDATE SET <content_only> for
 *     portfolio_project; UPDATE SET excludes visibility / status /
 *     created_at / pinned / display_order.
 *   - INSERT OR IGNORE for portfolio_link / portfolio_media.
 *   - owner-managed visibility / status preserved across re-runs.
 *
 * Media source:
 *
 *   3 immutable release assets under release-assets/portfolio/${version}/,
 *   described by manifest.json. Production execution never re-downloads
 *   from external sources; assets are committed to the repo.
 *
 * Production mutation order (operator-gated window):
 *
 *   1. production D1 portfolio migration (existing)
 *   2. driver `prepare --execute --environment=prod`
 *   3. driver `verify --environment=prod` (read-only)
 *   4. R2 custom-domain attachment (separate operator task)
 *   5. known media URL 200 / content-type check
 *   6. 0.5 Worker deploy
 *   7. production smoke
 *   8. driver `publish --execute --environment=prod`
 *   9. final portfolio E2E
 *  10. #78 / #82 close readiness
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// Canonical version source: package.json#version (per AGENTS.md §1).
// Never hard-code the current version in this script.
const RELEASE_VERSION = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version;
const DEFAULT_MANIFEST_PATH = `release-assets/portfolio/${RELEASE_VERSION}/manifest.json`;

const ALLOWED_CANDIDATE_IDS = new Set([
	'legacy_multislicer',
	'legacy_aulymo-v01',
	'legacy_aulymo-v02',
]);
export { ALLOWED_CANDIDATE_IDS, RELEASE_VERSION };

const DB_NAME = 'my-web-2026';
const R2_BUCKET = 'my-web-2026';

const VERIFY_STATE_FILENAME = '.verify-state.json';
const VERIFY_STATE_MAX_AGE_MS = 30 * 60 * 1000; // 30 min

const PORTFOLIO_FACETS = new Set(['develop', 'video', 'design', 'other']);
const REQUIRED_MD_SECTIONS = [
	'motivation_md',
	'architecture_md',
	'constraints_md',
	'implementation_md',
	'evidence_md',
];

// ---------------------------------------------------------------------------
// Per-candidate seed entries.
//
//
// These duplicate the inline ENTRIES from `scripts/seed-portfolio-path-a.mjs`
// (the local-only seed for #121). The duplication is intentional — the
// production driver must be self-contained at the publication moment so the
// operator can read and audit the exact content that will land on
// rebuildup.dev without jumping files. Keep the two in sync; if you change
// one, change the other.
//
// Markdown is grounded to: docs/personal/domain.md §8 + GitHub READMEs +
// YouTube descriptions + BOOTH listings + legacy SQLite
// (contents / content_links / content_tags / media BLOB).
// ---------------------------------------------------------------------------
const ENTRIES = [
	{
		legacyId: 'MultiSlicer',
		slug: 'multislicer',
		title: 'MultiSlicer',
		summary: 'Aeで画像をスライスするエフェクトプラグインです',
		role: 'Plugin developer',
		periodStart: '2025-05-02T03:00:00.000Z',
		periodLabel: '2025-05-02',
		facets: ['design', 'develop', 'video'],
		technologies: ['C++', 'After Effects SDK', 'Visual Studio', 'AfterEffects'],
		manifestSlug: 'multislicer',
		mediaFilename: '20250503_multi.jpg',
		mediaContentType: 'image/jpeg',
		mediaAlt: 'MultiSlicer 動作スクリーンショット (2025-05-03 撮影)',
		mediaCaption: null,
		markdown: {
			motivation_md:
				'After Effects で画像スライス処理を行うエフェクトプラグイン。' +
				'プロジェクト owner が公開・配布した成果物として、native plugin ' +
				'development の実践を兼ねる。\n\n' +
				'公開チャネル: YouTube (`X7XddKpTolw` / "Ae版MultiSlicer PV")、' +
				'BOOTH (`6872180` / "【Aeエフェクトプラグイン】Ae版MultiSlicer")、' +
				'X (`361do_sleep/status/1918615732939575763`)。',
			architecture_md:
				'C++ + After Effects SDK による effect plugin 実装。\n\n' +
				'GitHub `rebuildup/Ae_MultiSlicer` リポジトリのソース構成:\n\n' +
				'- `MultiSlicer.cpp` (35,979 bytes) — plugin エントリポイント\n' +
				'- `MultiSlicer.h` (4,151 bytes) — header\n' +
				'- `MultiSlicerPiPL.r` (1,259 bytes) — PiPL resource\n' +
				'- `MultiSlicer_Strings.cpp` / `.h` — 文字列リソース\n' +
				'- `Mac/` / `Win/` ディレクトリ — プラットフォーム別ビルド\n' +
				'- `assets/` — 動作デモ用 MP4 / JPEG (`20250503_multi.jpg`)\n',
			constraints_md:
				'After Effects SDK + native C++ コンパイル環境 + Visual Studio ' +
				'(Windows) または Xcode (macOS) が必要。配布は BOOTH 経由 ' +
				'(個人開発者向け同人流通)。',
			implementation_md:
				'docs/personal/domain.md §8 の記述:\n\n' +
				'> MultiSlicer — C++ / After Effects SDK を使った effect plugin。' +
				'公開・配布を通して native plugin development を実践\n\n' +
				'legacy my-web-2025 の content_tags にも C++ / AfterEffects / ' +
				'VisualStudio / プラグイン が登録されており、上記 grounding と一致。',
			evidence_md:
				'**配布・公開の証拠**:\n\n' +
				'- YouTube auto-generated thumbnail + "Ae版MultiSlicer PV" 動画\n' +
				'- BOOTH 商品ページ `361do.booth.pm/items/6872180`\n' +
				'- X 告知 `x.com/361do_sleep/status/1918615732939575763`\n' +
				'- GitHub ソース `github.com/rebuildup/Ae_MultiSlicer`\n' +
				'- legacy media BLOB `20250503_multi.jpg` (image/jpeg, 417,357 bytes、' +
				'撮影日 2025-05-03) — R2 `portfolio/multislicer/` へ保存\n',
			retrospective_md: '',
		},
		links: [
			{
				legacyId: 'youtube_pv',
				href: 'https://www.youtube.com/watch?v=X7XddKpTolw',
				label: 'YouTube — Ae版MultiSlicer PV',
				order: 1,
			},
			{
				legacyId: 'booth_item',
				href: 'https://361do.booth.pm/items/6872180',
				label: 'BOOTH — 【Aeエフェクトプラグイン】Ae版MultiSlicer',
				order: 2,
			},
			{
				legacyId: 'x_status',
				href: 'https://x.com/361do_sleep/status/1918615732939575763',
				label: 'X 告知',
				order: 3,
			},
			{
				legacyId: 'github_repo',
				href: 'https://github.com/rebuildup/Ae_MultiSlicer',
				label: 'GitHub — rebuildup/Ae_MultiSlicer',
				order: 4,
			},
		],
	},
	{
		legacyId: 'aulymo-v01',
		slug: 'aulymo-v01',
		title: 'Aulymo',
		summary: 'Aeのスクリプトです　簡単にリリックモーションを作れます',
		role: 'Tool developer',
		periodStart: '2024-12-13T03:00:00.000Z',
		periodLabel: '2024-12-13',
		facets: ['develop'],
		technologies: ['AfterEffects', 'ExtendScript', 'VSCode'],
		manifestSlug: 'aulymo-v01',
		mediaFilename: 'aulymo-v01-maxres.jpg',
		mediaContentType: 'image/jpeg',
		mediaAlt: 'Aulymo v1 動作 PV (YouTube SewXH0Bbm-c auto-generated thumbnail)',
		mediaCaption: null,
		markdown: {
			motivation_md:
				'After Effects で全自動リリックモーションを作る ExtendScript ' +
				'スクリプト。\n\n' +
				'`docs/personal/domain.md` §8:\n\n' +
				'> Aulymo — After Effects で lyric motion を作るための tool。' +
				'配布・販売を通じ、実装だけでなく productization / support / update を経験\n\n' +
				'公開チャネル: YouTube (`SewXH0Bbm-c`)、BOOTH (`6403113`)。',
			architecture_md:
				'ExtendScript (.jsx) 単一ファイル。Ae の scripting API 上で ' +
				'lyric motion を生成するスクリプト。',
			constraints_md:
				'After Effects の ExtendScript 実行環境 + ExtendScript 編集環境 ' +
				'(legacy data の `content_tags` には `VSCode` も登録されている)。',
			implementation_md:
				'docs/personal/domain.md §8 Tool / plugin development に ' +
				'登録された tool の一つ。productization / support / update を ' +
				'通じて tool owner の責務を経験した成果物。',
			evidence_md:
				'**配布・公開の証拠**:\n\n' +
				'- YouTube `SewXH0Bbm-c` (auto-generated thumbnail を R2 ' +
				'`portfolio/aulymo-v01/` へ保存)\n' +
				'- BOOTH 商品ページ `361do.booth.pm/items/6403113`\n',
			retrospective_md: '',
		},
		links: [
			{
				legacyId: 'youtube_pv',
				href: 'https://www.youtube.com/watch?v=SewXH0Bbm-c',
				label: 'YouTube — Aulymo v1 動作 PV',
				order: 1,
			},
			{
				legacyId: 'booth_item',
				href: 'https://361do.booth.pm/items/6403113',
				label: 'BOOTH — Aulymo',
				order: 2,
			},
		],
	},
	{
		legacyId: 'aulymo-v02',
		slug: 'aulymo-v02',
		title: 'Aeスクリプト Aulymo',
		summary:
			'Ae全自動リリックモーション「Aulymo」v2の動作説明動画です。' +
			'PremiereProを初めてまともに使いました。あと、コンピュータ部のMacBookを借りました。',
		role: 'Tool developer',
		periodStart: '2024-12-20T03:00:00.000Z',
		periodLabel: '2024-12-20',
		facets: ['develop'],
		technologies: ['AfterEffects', 'VSCode'],
		manifestSlug: 'aulymo-v02',
		mediaFilename: 'aulymo-v02-maxres.jpg',
		mediaContentType: 'image/jpeg',
		mediaAlt: 'Aulymo v2 動作説明動画 (YouTube EbtybmiN5pM auto-generated thumbnail)',
		mediaCaption: null,
		markdown: {
			motivation_md:
				'Aulymo v2 の動作説明動画。v1 からの差分は、Premiere Pro を ' +
				'初めてまともに使ったこと、コンピュータ部の MacBook を ' +
				'借りたこと (legacy my-web-2025 の markdown body に記述あり)。',
			architecture_md:
				'v1 と同じ ExtendScript 単一ファイル構造。v2 としての差分は ' +
				'Premiere Pro 側の動画編集工程のみで、Ae スクリプト本体は ' +
				'v1 を継続。',
			constraints_md:
				'After Effects + Premiere Pro + 借用 MacBook (コンピュータ部所有)。' +
				'legacy my-web-2025 の `content_tags` には `AfterEffects` / `VSCode`。',
			implementation_md:
				'docs/personal/domain.md §8 Tool / plugin development の ' +
				'Aulymo 系統の v2 リリース。実装そのものは v1 を継続し、' +
				'動画制作工程のみが v2 で拡張された。',
			evidence_md:
				'**配布・公開の証拠**:\n\n' +
				'- YouTube `EbtybmiN5pM` (v2 動作説明動画、' +
				'auto-generated thumbnail を R2 `portfolio/aulymo-v02/` へ保存)\n' +
				'- BOOTH 商品ページ `361do.booth.pm/items/6403113` (v1/v2 共通)\n',
			retrospective_md: '',
		},
		links: [
			{
				legacyId: 'youtube_pv',
				href: 'https://www.youtube.com/watch?v=EbtybmiN5pM',
				label: 'YouTube — Aulymo v2 動作説明動画',
				order: 1,
			},
			{
				legacyId: 'booth_item',
				href: 'https://361do.booth.pm/items/6403113',
				label: 'BOOTH — Aulymo',
				order: 2,
			},
		],
	},
];

// ---------------------------------------------------------------------------
// CLI arg parsing.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
	const args = new Set(argv);
	const out = {
		execute: args.has('--execute'),
		operation: null,
		environment: null,
		manifestPath: null,
	};
	for (const a of argv) {
		if (a.startsWith('--operation=')) {
			out.operation = a.slice('--operation='.length);
		} else if (a.startsWith('--environment=')) {
			out.environment = a.slice('--environment='.length);
		} else if (a.startsWith('--manifest=')) {
			out.manifestPath = a.slice('--manifest='.length);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// SQL primitives.
// ---------------------------------------------------------------------------
function sqlEscape(value) {
	if (value === null || value === undefined) return 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlStrOrEmpty(value) {
	return sqlEscape(value ?? '');
}

function nowMs() {
	return Date.now();
}

/** Normalize a legacy id to a valid slug — same algorithm as
 * `scripts/seed-portfolio-path-a.mjs#normalizeSlug`. */
export function normalizeSlug(legacyId) {
	return legacyId
		.toLowerCase()
		.replace(/_/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

/** Stable, human-readable id derived from a legacy id.
 * Same algorithm as `scripts/seed-portfolio-path-a.mjs` — keeps the
 * migrate + seed + publish drivers aligned on id space. */
export function projectIdFor(entry) {
	const slug = normalizeSlug(entry.legacyId);
	entry.slug = slug;
	return `legacy_${slug.replace(/[^a-z0-9-]/g, '_')}`;
}

function linkIdFor(projectId, link) {
	return `legacy_link_${projectId}_${link.legacyId}`;
}

function mediaIdFor(projectId, manifestSlug, filename) {
	return `legacy_media_${projectId.replace(/[^a-z0-9-]/g, '_')}_${manifestSlug.replace(/[^a-z0-9-]/g, '_')}_${filename.replace(/[^a-z0-9._-]/g, '_')}`;
}

/** INSERT ... ON CONFLICT(id) DO UPDATE SET <content_only> for portfolio_project.
 *
 * `id` is the conflict target (preserved). UPDATE SET excludes
 * `visibility` / `status` / `created_at` / `pinned` / `display_order`
 * — those are owner-managed and must NOT silently revert on re-run.
 * `updated_at` IS overwritten so audit timestamps reflect the latest
 * write.
 */
export function buildProjectUpsert(entry) {
	const id = projectIdFor(entry);
	const cols =
		'id, slug, title, summary, role, period_start, period_end, period_label, motivation_md, architecture_md, constraints_md, implementation_md, evidence_md, retrospective_md, facets, technologies, visibility, status, pinned, display_order, created_at, updated_at';
	const values = [
		sqlEscape(id),
		sqlEscape(entry.slug),
		sqlEscape(entry.title),
		sqlEscape(entry.summary),
		sqlEscape(entry.role),
		`${Date.parse(entry.periodStart)}`,
		'NULL',
		sqlEscape(entry.periodLabel),
		sqlStrOrEmpty(entry.markdown.motivation_md),
		sqlStrOrEmpty(entry.markdown.architecture_md),
		sqlStrOrEmpty(entry.markdown.constraints_md),
		sqlStrOrEmpty(entry.markdown.implementation_md),
		sqlStrOrEmpty(entry.markdown.evidence_md),
		sqlStrOrEmpty(entry.markdown.retrospective_md),
		sqlEscape(JSON.stringify(entry.facets)),
		sqlEscape(JSON.stringify(entry.technologies)),
		// INSERT-only values for visibility / status. These are
		// immediately overwritten by the DO UPDATE SET's exclusion —
		// the row's first visibility / status will be set to 'draft'
		// on insert, and the first publish step will flip them via a
		// dedicated UPDATE.
		sqlEscape('draft'),
		sqlEscape('published'),
		0,
		100,
		nowMs(),
		nowMs(),
	].join(', ');
	const updateCols = [
		'slug',
		'title',
		'summary',
		'role',
		'period_start',
		'period_end',
		'period_label',
		'motivation_md',
		'architecture_md',
		'constraints_md',
		'implementation_md',
		'evidence_md',
		'retrospective_md',
		'facets',
		'technologies',
		'updated_at',
	]
		.map((c) => `${c} = excluded.${c}`)
		.join(', ');
	return `INSERT INTO portfolio_project (${cols}) VALUES (${values}) ON CONFLICT(id) DO UPDATE SET ${updateCols};`;
}

/** INSERT OR IGNORE for portfolio_link. Preserves owner-added rows on
 * re-run (id collision is a no-op). */
export function buildLinkInserts(entry) {
	const projectId = projectIdFor(entry);
	const stmts = [];
	for (const link of entry.links) {
		const linkId = linkIdFor(projectId, link);
		const kind = linkKindFromUrl(link.href);
		stmts.push(
			`INSERT OR IGNORE INTO portfolio_link (id, project_id, kind, label, url, display_order, created_at) VALUES (${sqlEscape(linkId)}, ${sqlEscape(projectId)}, ${sqlEscape(kind)}, ${sqlEscape(link.label ?? null)}, ${sqlEscape(link.href)}, ${link.order ?? 0}, ${nowMs()});`,
		);
	}
	return stmts;
}

/** INSERT OR IGNORE for portfolio_media. Id is deterministic from
 * (project_id, manifest_slug, filename) so re-running never overwrites
 * owner-added rows. */
export function buildMediaInsert(entry, manifestAsset) {
	const projectId = projectIdFor(entry);
	const mediaId = mediaIdFor(projectId, entry.manifestSlug, entry.mediaFilename);
	return `INSERT OR IGNORE INTO portfolio_media (id, project_id, r2_key, content_type, width, height, alt, caption, is_cover, display_order, created_at) VALUES (${sqlEscape(mediaId)}, ${sqlEscape(projectId)}, ${sqlEscape(manifestAsset.r2_key)}, ${sqlEscape(manifestAsset.content_type)}, ${manifestAsset.width}, ${manifestAsset.height}, ${sqlEscape(entry.mediaAlt)}, ${sqlEscape(entry.mediaCaption)}, 1, 1, ${nowMs()});`;
}

function linkKindFromUrl(href) {
	const u = new URL(href);
	const host = u.hostname.toLowerCase();
	if (
		host === 'youtube.com' ||
		host === 'www.youtube.com' ||
		host === 'youtu.be' ||
		host === 'm.youtube.com' ||
		host === 'vimeo.com' ||
		host === 'nicovideo.jp' ||
		host === 'www.nicovideo.jp'
	) {
		return 'video';
	}
	if (host === 'github.com' || host === 'gitlab.com') {
		return 'repo';
	}
	if (host === 'twitter.com' || host === 'x.com' || host === 't.co') {
		return 'social';
	}
	if (host.endsWith('booth.pm') || host.endsWith('booth.pm')) {
		return 'shop';
	}
	return 'other';
}

// ---------------------------------------------------------------------------
// Manifest validation.
// ---------------------------------------------------------------------------
export function validateManifest(manifest) {
	const errors = [];
	if (!manifest || typeof manifest !== 'object') {
		return ['manifest must be a JSON object'];
	}
	if (manifest.release !== RELEASE_VERSION) {
		errors.push(
			`manifest.release must be ${RELEASE_VERSION}, got ${JSON.stringify(manifest.release)}`,
		);
	}
	if (manifest.r2_bucket !== R2_BUCKET) {
		errors.push(
			`manifest.r2_bucket must be ${R2_BUCKET}, got ${JSON.stringify(manifest.r2_bucket)}`,
		);
	}
	if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
		errors.push('manifest.assets must be a non-empty array');
		return errors;
	}
	const seenIds = new Set();
	const seenR2Keys = new Set();
	for (const [i, a] of manifest.assets.entries()) {
		if (!ALLOWED_CANDIDATE_IDS.has(a.candidate_id)) {
			errors.push(
				`manifest.assets[${i}].candidate_id ${JSON.stringify(a.candidate_id)} is not in the publication allowlist ${JSON.stringify([...ALLOWED_CANDIDATE_IDS])}`,
			);
		}
		if (seenIds.has(a.candidate_id)) {
			errors.push(`manifest.assets[${i}].candidate_id duplicate: ${a.candidate_id}`);
		}
		seenIds.add(a.candidate_id);
		if (seenR2Keys.has(a.r2_key)) {
			errors.push(`manifest.assets[${i}].r2_key duplicate: ${a.r2_key}`);
		}
		seenR2Keys.add(a.r2_key);
		for (const required of [
			'candidate_id',
			'slug',
			'title',
			'asset_filename',
			'asset_relative_path',
			'r2_key',
			'content_type',
			'byte_size',
			'width',
			'height',
			'sha256',
			'alt',
			'is_cover',
		]) {
			if (!(required in a)) {
				errors.push(`manifest.assets[${i}] missing required field: ${required}`);
			}
		}
		if (typeof a.sha256 === 'string' && !/^[a-f0-9]{64}$/.test(a.sha256)) {
			errors.push(
				`manifest.assets[${i}].sha256 must be 64 lowercase hex chars, got ${JSON.stringify(a.sha256)}`,
			);
		}
	}
	return errors;
}

/** Load + validate the manifest from disk. Throws on validation failure. */
export function loadManifest(manifestPath) {
	const fullPath = resolve(repoRoot, manifestPath);
	if (!existsSync(fullPath)) {
		throw new Error(`manifest not found at ${fullPath}`);
	}
	const raw = JSON.parse(readFileSync(fullPath, 'utf8'));
	const errors = validateManifest(raw);
	if (errors.length > 0) {
		throw new Error(`manifest validation failed:\n  ${errors.join('\n  ')}`);
	}
	return raw;
}

function manifestAssetFor(manifest, slug) {
	for (const a of manifest.assets) {
		if (a.slug === slug) return a;
	}
	throw new Error(`manifest has no asset for slug ${JSON.stringify(slug)}`);
}

// ---------------------------------------------------------------------------
// Hash verification.
// ---------------------------------------------------------------------------
export async function sha256OfFile(filePath) {
	return new Promise((resolveHash, rejectHash) => {
		const hash = createHash('sha256');
		const stream = createReadStream(filePath);
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolveHash(hash.digest('hex')));
		stream.on('error', rejectHash);
	});
}

/** Verify an asset file's SHA-256 matches the manifest. Fails closed on
 * mismatch. */
export async function verifyAssetHash(assetRelativePath, expectedSha256) {
	const fullPath = resolve(
		repoRoot,
		'release-assets',
		'portfolio',
		RELEASE_VERSION,
		assetRelativePath,
	);
	if (!existsSync(fullPath)) {
		throw new Error(`asset missing: ${fullPath}`);
	}
	const actual = await sha256OfFile(fullPath);
	if (actual !== expectedSha256) {
		throw new Error(
			`asset hash mismatch at ${assetRelativePath}: expected ${expectedSha256}, got ${actual}`,
		);
	}
	return { path: fullPath, sha256: actual };
}

// ---------------------------------------------------------------------------
// Wrangler spawn wrappers (IO). Injected for tests.
// ---------------------------------------------------------------------------

/** Default wrangler spawner. Uses `wrangler d1 execute` / `wrangler r2
 * object put` via spawnSync so the driver can be invoked from a one-shot
 * terminal command. Returns { stdout, stderr, status }. */
function defaultWranglerSpawn(args, opts) {
	const fullArgs = ['wrangler', ...args];
	if (process.env.PUBLISH_PORTFOLIO_VERBOSE) {
		console.error(`[spawn] ${fullArgs.join(' ')}`);
	}
	const result = spawnSync(fullArgs[0], fullArgs.slice(1), {
		cwd: repoRoot,
		env: process.env,
		stdio: ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
		...opts,
	});
	return {
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		status: result.status ?? -1,
	};
}

/** Validate the wrangler config identity (account_id, db name, r2 bucket)
 * matches the operator-known production identity. */
function assertProductionIdentity(wranglerConfigName) {
	const cfgPath = resolve(repoRoot, wranglerConfigName);
	if (!existsSync(cfgPath)) {
		throw new Error(`wrangler config not found: ${cfgPath}`);
	}
	const cfg = readFileSync(cfgPath, 'utf8');
	if (!cfg.includes(`"database_name": "${DB_NAME}"`)) {
		throw new Error(
			`${wranglerConfigName}#database_name is not ${DB_NAME}; refusing to mutate production`,
		);
	}
	if (!cfg.includes(`"bucket_name": "${R2_BUCKET}"`)) {
		throw new Error(
			`${wranglerConfigName}#r2_buckets.bucket_name is not ${R2_BUCKET}; refusing to mutate production`,
		);
	}
	if (!cfg.includes('"account_id": "c6ab6651a5d4d6d0d07686bbd3c3d56f"')) {
		throw new Error(
			`${wranglerConfigName}#account_id is not the canonical production account; refusing to mutate production`,
		);
	}
}

/** Run a D1 SQL script via wrangler. Returns spawn result. */
function runD1(env, sqlPathOrStdin, opts = {}) {
	const targetFlag = env === 'prod' ? '--remote' : '--local';
	const args = ['d1', 'execute', DB_NAME, targetFlag, '--file', sqlPathOrStdin];
	return defaultWranglerSpawn(args, opts);
}

/** Upload an R2 object via wrangler. Returns spawn result. */
function runR2Put(env, key, filePath) {
	const targetFlag = env === 'prod' ? '--remote' : '--local';
	const bucketKey = `${R2_BUCKET}/${key}`;
	const args = [
		'r2',
		'object',
		'put',
		bucketKey,
		targetFlag,
		'--file',
		filePath,
		'--content-type',
		'inherit',
	];
	return defaultWranglerSpawn(args);
}

/** Read an R2 object's metadata via wrangler. Returns spawn result. */
function runR2Head(env, key) {
	const targetFlag = env === 'prod' ? '--remote' : '--local';
	const bucketKey = `${R2_BUCKET}/${key}`;
	const args = ['r2', 'object', 'head', bucketKey, targetFlag];
	return defaultWranglerSpawn(args);
}

/** Read D1 row(s) by id via wrangler. Returns spawn result. */
function runD1Select(env, sqlText) {
	const args =
		env === 'prod'
			? ['d1', 'execute', DB_NAME, '--remote', '--command', sqlText, '--json']
			: ['d1', 'execute', DB_NAME, '--local', '--command', sqlText, '--json'];
	return defaultWranglerSpawn(args);
}

// ---------------------------------------------------------------------------
// Entry-level content validation (pre-mutation).
// ---------------------------------------------------------------------------
export function validateEntry(entry) {
	const errors = [];
	if (!ALLOWED_CANDIDATE_IDS.has(projectIdFor({ legacyId: entry.legacyId }))) {
		errors.push(`entry ${entry.legacyId}: derived id not in allowlist`);
	}
	for (const facet of entry.facets) {
		if (!PORTFOLIO_FACETS.has(facet)) {
			errors.push(`entry ${entry.legacyId}: facet ${facet} not in closed enum`);
		}
	}
	for (const section of REQUIRED_MD_SECTIONS) {
		if (!entry.markdown[section] || entry.markdown[section].trim() === '') {
			errors.push(`entry ${entry.legacyId}: markdown section ${section} is empty`);
		}
	}
	const slug = normalizeSlug(entry.legacyId);
	if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(slug)) {
		errors.push(`entry ${entry.legacyId}: slug ${slug} fails /^[a-z0-9][a-z0-9-]{0,127}$/`);
	}
	if (entry.links.length === 0) {
		errors.push(`entry ${entry.legacyId}: must have at least one link`);
	}
	return errors;
}

// ---------------------------------------------------------------------------
// Verify state file (for publish gating).
// ---------------------------------------------------------------------------
function verifyStatePath(env) {
	return resolve(repoRoot, '.tmp', `publish-portfolio-${env}-${VERIFY_STATE_FILENAME}`);
}

function readVerifyState(env) {
	const path = verifyStatePath(env);
	if (!existsSync(path)) return null;
	try {
		const raw = JSON.parse(readFileSync(path, 'utf8'));
		return raw;
	} catch {
		return null;
	}
}

function writeVerifyState(env, state) {
	const path = verifyStatePath(env);
	const fs = require('node:fs');
	fs.mkdirSync(dirname(path), { recursive: true });
	fs.writeFileSync(path, JSON.stringify(state, null, 2));
}

function clearVerifyState(env) {
	const path = verifyStatePath(env);
	const fs = require('node:fs');
	if (existsSync(path)) fs.unlinkSync(path);
}

// ---------------------------------------------------------------------------
// Operations.
// ---------------------------------------------------------------------------
async function operationPrepare(parsed, manifest) {
	const env = parsed.environment;
	const execute = parsed.execute;
	const dryRun = !execute;

	console.error(
		`[publish-portfolio] --operation=prepare --environment=${env} ${dryRun ? 'DRY-RUN' : 'EXECUTE'}`,
	);

	if (env === 'prod') {
		assertProductionIdentity('wrangler.production.jsonc');
	}

	// 1. Validate all entries up front.
	const entryErrors = ENTRIES.flatMap(validateEntry);
	if (entryErrors.length > 0) {
		console.error('[publish-portfolio] entry validation failed:');
		for (const e of entryErrors) console.error(`  - ${e}`);
		process.exit(2);
	}

	// 2. Verify asset SHA-256 for every candidate.
	const verifiedAssets = new Map();
	for (const entry of ENTRIES) {
		const manifestAsset = manifestAssetFor(manifest, entry.manifestSlug);
		const verified = await verifyAssetHash(manifestAsset.asset_relative_path, manifestAsset.sha256);
		verifiedAssets.set(entry.manifestSlug, { ...verified, manifestAsset });
		console.error(
			`[publish-portfolio] asset OK: ${entry.manifestSlug} sha256=${verified.sha256.slice(0, 12)}…`,
		);
	}

	// 3. Build SQL bundle.
	const sqlBundle = [];
	for (const entry of ENTRIES) {
		sqlBundle.push(buildProjectUpsert(entry));
		sqlBundle.push(...buildLinkInserts(entry));
		const manifestAsset = verifiedAssets.get(entry.manifestSlug).manifestAsset;
		sqlBundle.push(buildMediaInsert(entry, manifestAsset));
	}
	const fullSql = sqlBundle.join('\n');

	// 4. Write the SQL bundle to a temp file (avoid arg-list length limits).
	const tmpDir = process.env.TMPDIR || '/tmp';
	const fs = await import('node:fs');
	const tmpFile = resolve(
		tmpDir,
		`publish-portfolio-${env}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`,
	);
	fs.writeFileSync(tmpFile, fullSql, { mode: 0o600 });
	console.error(`[publish-portfolio] SQL bundle written to ${tmpFile} (${sqlBundle.length} stmts)`);

	// 5. Spawn wrangler.
	let d1Result = { stdout: '', stderr: '[dry-run] no spawn', status: 0 };
	if (!dryRun) {
		d1Result = runD1(env, tmpFile);
	}

	// 6. R2 PUT for each asset.
	const r2Results = [];
	for (const [slug, verified] of verifiedAssets.entries()) {
		const r2Result = dryRun
			? { stdout: '[dry-run] no spawn', stderr: '', status: 0 }
			: runR2Put(env, verified.manifestAsset.r2_key, verified.path);
		r2Results.push({ slug, status: r2Result.status, stderr: r2Result.stderr });
	}

	// 7. Cleanup.
	try {
		fs.unlinkSync(tmpFile);
	} catch {
		/* ignore */
	}

	// 8. Report.
	const summary = {
		operation: 'prepare',
		environment: env,
		execute: !dryRun,
		sql_statements: sqlBundle.length,
		r2_objects: verifiedAssets.size,
		d1_status: d1Result.status,
		r2_statuses: r2Results.map((r) => `${r.slug}:${r.status}`),
	};
	console.log(JSON.stringify(summary, null, 2));

	if (d1Result.status !== 0 || r2Results.some((r) => r.status !== 0)) {
		console.error('[publish-portfolio] prepare failed; see status above');
		process.exit(d1Result.status || 1);
	}
}

function operationVerify(parsed, manifest) {
	const env = parsed.environment;
	console.error(`[publish-portfolio] --operation=verify --environment=${env} READ-ONLY`);

	if (env === 'prod') {
		assertProductionIdentity('wrangler.production.jsonc');
	}

	const ids = [...ALLOWED_CANDIDATE_IDS];
	const sqlSelect = `SELECT id, slug, title, role, visibility, status, motivation_md IS NOT NULL AS has_motivation, architecture_md IS NOT NULL AS has_architecture, constraints_md IS NOT NULL AS has_constraints, implementation_md IS NOT NULL AS has_implementation, evidence_md IS NOT NULL AS has_evidence FROM portfolio_project WHERE id IN (${ids.map((i) => `'${i}'`).join(',')});`;

	const d1Result = runD1Select(env, sqlSelect);
	if (d1Result.status !== 0) {
		console.error('[publish-portfolio] verify: D1 SELECT failed');
		console.error(d1Result.stderr);
		process.exit(d1Result.status);
	}

	let parsedRows = [];
	try {
		const out = JSON.parse(d1Result.stdout || '[]');
		parsedRows = Array.isArray(out) ? out : (out?.[0] ?? []);
	} catch (err) {
		console.error('[publish-portfolio] verify: cannot parse D1 SELECT output as JSON');
		console.error(d1Result.stdout);
		process.exit(1);
	}

	const stateRows = [];
	for (const row of parsedRows) {
		stateRows.push(row);
	}

	// R2 object head for each manifest asset.
	const r2States = [];
	for (const asset of manifest.assets) {
		const result = runR2Head(env, asset.r2_key);
		r2States.push({
			slug: asset.slug,
			r2_key: asset.r2_key,
			expected_sha256: asset.sha256,
			expected_byte_size: asset.byte_size,
			expected_content_type: asset.content_type,
			status: result.status,
		});
	}

	const allRowsPresent = stateRows.length === ids.length;
	const allR2Present = r2States.every((r) => r.status === 0);
	const state = {
		environment: env,
		verified_at: new Date().toISOString(),
		d1_rows: stateRows,
		r2_objects: r2States,
		all_rows_present: allRowsPresent,
		all_r2_present: allR2Present,
	};

	if (parsed.execute) {
		writeVerifyState(env, state);
	}

	console.log(JSON.stringify(state, null, 2));

	if (!allRowsPresent) {
		console.error(
			`[publish-portfolio] verify FAIL: expected ${ids.length} rows, got ${stateRows.length}`,
		);
		process.exit(2);
	}
	if (!allR2Present) {
		console.error('[publish-portfolio] verify FAIL: not all R2 objects present');
		process.exit(2);
	}
	console.error('[publish-portfolio] verify PASS');
}

function operationPublish(parsed /* , manifest */) {
	const env = parsed.environment;
	if (!parsed.execute) {
		console.error('[publish-portfolio] publish requires --execute');
		process.exit(2);
	}
	if (env === 'prod') {
		assertProductionIdentity('wrangler.production.jsonc');
	}
	const state = readVerifyState(env);
	if (!state) {
		console.error(
			`[publish-portfolio] no verify state for environment=${env}; run verify --execute first`,
		);
		process.exit(2);
	}
	const ageMs = Date.now() - new Date(state.verified_at).getTime();
	if (ageMs > VERIFY_STATE_MAX_AGE_MS) {
		console.error(
			`[publish-portfolio] verify state is ${Math.round(ageMs / 1000)}s old (max ${VERIFY_STATE_MAX_AGE_MS / 1000}s); re-run verify`,
		);
		process.exit(2);
	}
	if (!state.all_rows_present || !state.all_r2_present) {
		console.error('[publish-portfolio] verify state is incomplete; re-run verify');
		process.exit(2);
	}

	const ids = [...ALLOWED_CANDIDATE_IDS];
	const sql = `UPDATE portfolio_project SET visibility='public', status='published', updated_at=${nowMs()} WHERE id IN (${ids.map((i) => `'${i}'`).join(',')});`;
	console.error(`[publish-portfolio] publish: ${ids.length} candidates → public`);

	const tmpDir = process.env.TMPDIR || '/tmp';
	const fs = require('node:fs');
	const tmpFile = resolve(
		tmpDir,
		`publish-portfolio-publish-${env}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`,
	);
	fs.writeFileSync(tmpFile, sql, { mode: 0o600 });

	const result = runD1(env, tmpFile);
	try {
		fs.unlinkSync(tmpFile);
	} catch {
		/* ignore */
	}

	if (result.status !== 0) {
		console.error('[publish-portfolio] publish failed');
		console.error(result.stderr);
		process.exit(result.status);
	}
	clearVerifyState(env);
	console.error(`[publish-portfolio] publish OK; ${ids.length} candidates visibility=public`);
}

function operationUnpublish(parsed /* , manifest */) {
	const env = parsed.environment;
	if (!parsed.execute) {
		console.error('[publish-portfolio] unpublish requires --execute');
		process.exit(2);
	}
	if (env === 'prod') {
		assertProductionIdentity('wrangler.production.jsonc');
	}
	const ids = [...ALLOWED_CANDIDATE_IDS];
	const sql = `UPDATE portfolio_project SET visibility='draft', status='draft', updated_at=${nowMs()} WHERE id IN (${ids.map((i) => `'${i}'`).join(',')});`;
	console.error(`[publish-portfolio] unpublish: ${ids.length} candidates → draft (rollback)`);

	const tmpDir = process.env.TMPDIR || '/tmp';
	const fs = require('node:fs');
	const tmpFile = resolve(
		tmpDir,
		`publish-portfolio-unpublish-${env}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`,
	);
	fs.writeFileSync(tmpFile, sql, { mode: 0o600 });

	const result = runD1(env, tmpFile);
	try {
		fs.unlinkSync(tmpFile);
	} catch {
		/* ignore */
	}

	if (result.status !== 0) {
		console.error('[publish-portfolio] unpublish failed');
		console.error(result.stderr);
		process.exit(result.status);
	}
	clearVerifyState(env);
	console.error(`[publish-portfolio] unpublish OK; ${ids.length} candidates visibility=draft`);
}

// ---------------------------------------------------------------------------
// CLI dispatch.
// ---------------------------------------------------------------------------
async function main() {
	const parsed = parseArgs(process.argv.slice(2));

	if (!parsed.operation) {
		console.error(
			'Usage: node scripts/publish-portfolio-production.mjs --operation=prepare|verify|publish|unpublish --environment=local|prod [--execute]',
		);
		process.exit(2);
	}
	if (!parsed.environment) {
		console.error('--environment=local|prod is required');
		process.exit(2);
	}
	if (!['local', 'prod'].includes(parsed.environment)) {
		console.error(`--environment must be local|prod, got ${parsed.environment}`);
		process.exit(2);
	}
	if (!['prepare', 'verify', 'publish', 'unpublish'].includes(parsed.operation)) {
		console.error(`--operation must be prepare|verify|publish|unpublish, got ${parsed.operation}`);
		process.exit(2);
	}
	if (parsed.environment === 'prod' && parsed.execute) {
		console.error(
			'[publish-portfolio] WARNING: --execute --environment=prod is gated by [[release-merge-human-gate]].',
		);
		console.error(
			'  Agent MUST NOT pass --execute --environment=prod without explicit operator authorization in the current interaction.',
		);
		console.error('  See [[issue-99-driver-incident]] for prior incident details.');
	}

	const manifestPath = parsed.manifestPath ?? DEFAULT_MANIFEST_PATH;
	let manifest;
	try {
		manifest = loadManifest(manifestPath);
	} catch (err) {
		console.error(`[publish-portfolio] ${err.message}`);
		process.exit(2);
	}

	switch (parsed.operation) {
		case 'prepare':
			await operationPrepare(parsed, manifest);
			break;
		case 'verify':
			operationVerify(parsed, manifest);
			break;
		case 'publish':
			operationPublish(parsed, manifest);
			break;
		case 'unpublish':
			operationUnpublish(parsed, manifest);
			break;
		default:
			console.error(`unknown operation: ${parsed.operation}`);
			process.exit(2);
	}
}

// ---------------------------------------------------------------------------
// ESM main-module guard. Only invoke main() when the file is executed
// directly (not when imported for testing).
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error('[publish-portfolio] unhandled error:', err.stack || err.message);
		process.exit(1);
	});
}
