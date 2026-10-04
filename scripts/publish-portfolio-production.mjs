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
 * Canonical co-owned runbook: Issue #82 §C + PR #91 body §B.
 *
 *   1. production D1 portfolio migration (existing)
 *   2. driver `prepare --execute --environment=prod`
 *   3. R2 custom-domain attachment (separate operator task)
 *   4. driver `verify --environment=prod --execute` (read-only remote state;
 *      local verify-state write only). This verifies public R2 bytes,
 *      SHA-256 and Content-Type through the custom domain.
 *   5. 0.5 Worker deploy
 *   6. production smoke
 *   7. driver `publish --execute --environment=prod`
 *   8. final portfolio E2E / optional `verify --expect-visibility=public`
 *   9. #78 / #82 close readiness
 */

import { spawn, spawnSync } from 'node:child_process';
import { executeSqlFile, queryRows } from './_d1.mjs';
import { createHash } from 'node:crypto';
import {
	createReadStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
const WRANGLER_PRODUCTION_CONFIG = 'wrangler.production.jsonc';
const MEDIA_PUBLIC_BASE_URL = 'https://media.rebuildup.dev';

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
export const ENTRIES = [
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
		expectVisibility: 'draft',
	};
	for (const a of argv) {
		if (a.startsWith('--operation=')) {
			out.operation = a.slice('--operation='.length);
		} else if (a.startsWith('--environment=')) {
			out.environment = a.slice('--environment='.length);
		} else if (a.startsWith('--manifest=')) {
			out.manifestPath = a.slice('--manifest='.length);
		} else if (a.startsWith('--expect-visibility=')) {
			out.expectVisibility = a.slice('--expect-visibility='.length);
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

export function linkIdFor(projectId, link) {
	return `legacy_link_${projectId}_${link.legacyId}`;
}

export function mediaIdFor(projectId, manifestSlug, filename) {
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
export function buildProjectUpsert(entry, timestamp = nowMs()) {
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
		timestamp,
		timestamp,
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
export function buildLinkInserts(entry, timestamp = nowMs()) {
	const projectId = projectIdFor(entry);
	const stmts = [];
	for (const link of entry.links) {
		const linkId = linkIdFor(projectId, link);
		const kind = linkKindFromUrl(link.href);
		stmts.push(
			`INSERT OR IGNORE INTO portfolio_link (id, project_id, kind, label, url, display_order, created_at) VALUES (${sqlEscape(linkId)}, ${sqlEscape(projectId)}, ${sqlEscape(kind)}, ${sqlEscape(link.label ?? null)}, ${sqlEscape(link.href)}, ${link.order ?? 0}, ${timestamp});`,
		);
	}
	return stmts;
}

/** INSERT OR IGNORE for portfolio_media. Id is deterministic from
 * (project_id, manifest_slug, filename) so re-running never overwrites
 * owner-added rows. */
export function buildMediaInsert(entry, manifestAsset, timestamp = nowMs()) {
	const projectId = projectIdFor(entry);
	const mediaId = mediaIdFor(projectId, entry.manifestSlug, entry.mediaFilename);
	return `INSERT OR IGNORE INTO portfolio_media (id, project_id, r2_key, content_type, width, height, alt, caption, is_cover, display_order, created_at) VALUES (${sqlEscape(mediaId)}, ${sqlEscape(projectId)}, ${sqlEscape(manifestAsset.r2_key)}, ${sqlEscape(manifestAsset.content_type)}, ${manifestAsset.width}, ${manifestAsset.height}, ${sqlEscape(entry.mediaAlt)}, ${sqlEscape(entry.mediaCaption)}, 1, 1, ${timestamp});`;
}

export function linkKindFromUrl(href) {
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

/** Default Wrangler spawner. D1 no longer uses this — it goes through the
 * shared cf driver. R2 still does (`wrangler r2 object put/get`) and moves in
 * the secrets/cleanup slices.
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

function productionConfigArgs(env) {
	return env === 'prod' ? ['-c', WRANGLER_PRODUCTION_CONFIG] : [];
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
	if (!cfg.includes(`"MEDIA_PUBLIC_BASE_URL": "${MEDIA_PUBLIC_BASE_URL}"`)) {
		throw new Error(
			`${wranglerConfigName}#vars.MEDIA_PUBLIC_BASE_URL is not ${MEDIA_PUBLIC_BASE_URL}; refusing production verification`,
		);
	}
}

/** Parse Wrangler D1 --json output. Wrangler returns an array of result
 * envelopes; fail closed on any other shape. */
export function parseD1Rows(stdout) {
	let parsed;
	try {
		parsed = JSON.parse(stdout || '[]');
	} catch {
		throw new Error('D1 output is not valid JSON');
	}
	if (!Array.isArray(parsed) || parsed.length !== 1) {
		throw new Error('D1 output must be a single-result envelope array');
	}
	const first = parsed[0];
	if (!first || typeof first !== 'object' || !Array.isArray(first.results)) {
		throw new Error('D1 output first envelope must contain results[]');
	}
	return first.results;
}

/**
 * Issue #247: D1 goes through the shared cf driver.
 *
 * `DB_NAME` + a target FLAG is the old addressing; the driver
 * addresses the database by canonical ID with an explicit
 * local/production target, and routes production writes through the
 * lowest-layer execute gate. R2 still goes through Wrangler here and
 * moves in the secrets/cleanup slices.
 */
function d1Target(env) {
	return env === 'prod' ? 'production' : 'local';
}

function runD1(env, sqlPath) {
	executeSqlFile(sqlPath, { target: d1Target(env), execute: true });
}

/** Upload an R2 object via wrangler. Content-Type is explicit; never use
 * Wrangler inference for release assets. */
export function buildR2PutArgs(env, key, filePath, contentType) {
	const targetFlag = env === 'prod' ? '--remote' : '--local';
	const bucketKey = `${R2_BUCKET}/${key}`;
	return [
		'r2',
		'object',
		'put',
		bucketKey,
		targetFlag,
		'--file',
		filePath,
		'--content-type',
		contentType,
		...productionConfigArgs(env),
	];
}

function runR2Put(env, key, filePath, contentType) {
	return defaultWranglerSpawn(buildR2PutArgs(env, key, filePath, contentType));
}

/** Download an R2 object via Wrangler for local verification. Production
 * integrity verification uses the custom-domain HTTPS path so HTTP metadata
 * (especially Content-Type) is verified together with bytes. */
export function buildR2GetArgs(env, key, filePath) {
	const targetFlag = env === 'prod' ? '--remote' : '--local';
	const bucketKey = `${R2_BUCKET}/${key}`;
	return [
		'r2',
		'object',
		'get',
		bucketKey,
		targetFlag,
		'--file',
		filePath,
		...productionConfigArgs(env),
	];
}

function runR2Get(env, key, filePath) {
	return defaultWranglerSpawn(buildR2GetArgs(env, key, filePath));
}

function runD1Select(env, sqlText) {
	// A read: no execute gate, result shape already normalised.
	return { parsed: queryRows(sqlText, { target: d1Target(env) }) };
}

function publicMediaUrl(key) {
	const encodedPath = key
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
	return `${MEDIA_PUBLIC_BASE_URL}/${encodedPath}`;
}

/** Fetch the production R2 object through its canonical custom domain.
 * This is intentionally a full GET: the assets are small and hashing the
 * returned bytes provides stronger integrity evidence than object presence. */
export async function fetchPublicR2Object(asset, fetchImpl = globalThis.fetch) {
	if (typeof fetchImpl !== 'function') {
		throw new Error('global fetch is unavailable');
	}
	const response = await fetchImpl(publicMediaUrl(asset.r2_key), {
		method: 'GET',
		redirect: 'error',
	});
	const body = Buffer.from(await response.arrayBuffer());
	return {
		status: response.status,
		contentType: (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase(),
		byteSize: body.byteLength,
		sha256: createHash('sha256').update(body).digest('hex'),
	};
}

/** Compare remote/local object evidence with the immutable manifest. */
export function validateR2Evidence(asset, evidence) {
	const errors = [];
	if (evidence.status !== 200 && evidence.status !== 0) {
		errors.push(`${asset.slug}: object fetch failed (status=${evidence.status})`);
	}
	if (evidence.sha256 !== asset.sha256) {
		errors.push(`${asset.slug}: SHA-256 mismatch`);
	}
	if (evidence.byteSize !== asset.byte_size) {
		errors.push(
			`${asset.slug}: byte size mismatch (expected=${asset.byte_size}, actual=${evidence.byteSize})`,
		);
	}
	if (
		typeof evidence.contentType === 'string' &&
		evidence.contentType.length > 0 &&
		evidence.contentType !== asset.content_type.toLowerCase()
	) {
		errors.push(
			`${asset.slug}: Content-Type mismatch (expected=${asset.content_type}, actual=${evidence.contentType})`,
		);
	}
	return errors;
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

export function publicationContextDigest(manifest) {
	const payload = {
		release: RELEASE_VERSION,
		candidate_ids: [...ALLOWED_CANDIDATE_IDS].sort(),
		manifest,
		entries: ENTRIES.map((entry) => ({
			id: projectIdFor({ legacyId: entry.legacyId }),
			slug: normalizeSlug(entry.legacyId),
			title: entry.title,
			role: entry.role,
			markdown: entry.markdown,
			links: entry.links,
			manifestSlug: entry.manifestSlug,
			mediaFilename: entry.mediaFilename,
			mediaAlt: entry.mediaAlt,
		})),
	};
	return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function verifyD1Content({
	projectRows,
	linkRows,
	mediaRows,
	manifest,
	expectedVisibility,
}) {
	const errors = [];
	if (projectRows.length !== ALLOWED_CANDIDATE_IDS.size) {
		errors.push(
			`project row count mismatch: expected=${ALLOWED_CANDIDATE_IDS.size}, actual=${projectRows.length}`,
		);
	}
	for (const entry of ENTRIES) {
		const id = projectIdFor({ legacyId: entry.legacyId });
		const project = projectRows.find((row) => row.id === id);
		if (!project) {
			errors.push(`${id}: project row missing`);
			continue;
		}
		const expectedProject = {
			slug: normalizeSlug(entry.legacyId),
			title: entry.title,
			role: entry.role,
			visibility: expectedVisibility,
			status: 'published',
		};
		for (const [key, expected] of Object.entries(expectedProject)) {
			if (project[key] !== expected) {
				errors.push(`${id}: ${key} mismatch`);
			}
		}
		for (const section of REQUIRED_MD_SECTIONS) {
			if (project[section] !== entry.markdown[section]) {
				errors.push(`${id}: ${section} content mismatch`);
			}
		}

		for (const link of entry.links) {
			const expectedLinkId = linkIdFor(id, link);
			const actual = linkRows.find((row) => row.id === expectedLinkId);
			if (!actual) {
				errors.push(`${id}: expected link missing (${expectedLinkId})`);
				continue;
			}
			if (
				actual.project_id !== id ||
				actual.kind !== linkKindFromUrl(link.href) ||
				actual.url !== link.href ||
				actual.label !== (link.label ?? null) ||
				Number(actual.display_order) !== Number(link.order ?? 0)
			) {
				errors.push(`${id}: expected link content mismatch (${expectedLinkId})`);
			}
		}

		const asset = manifestAssetFor(manifest, entry.manifestSlug);
		const expectedMediaId = mediaIdFor(id, entry.manifestSlug, entry.mediaFilename);
		const media = mediaRows.find((row) => row.id === expectedMediaId);
		if (!media) {
			errors.push(`${id}: expected media missing (${expectedMediaId})`);
			continue;
		}
		if (
			media.project_id !== id ||
			media.r2_key !== asset.r2_key ||
			media.content_type !== asset.content_type ||
			Number(media.width) !== Number(asset.width) ||
			Number(media.height) !== Number(asset.height) ||
			media.alt !== entry.mediaAlt ||
			Number(media.is_cover) !== 1 ||
			Number(media.display_order) !== 1
		) {
			errors.push(`${id}: expected media content mismatch (${expectedMediaId})`);
		}
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
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function clearVerifyState(env) {
	const path = verifyStatePath(env);
	if (existsSync(path)) unlinkSync(path);
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
		assertProductionIdentity(WRANGLER_PRODUCTION_CONFIG);
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

	// 3. Build SQL bundle. Capture one wall-clock value at the operation
	// boundary and inject it into every SQL builder. This keeps the bundle
	// coherent and makes the pure builders deterministic under test.
	const timestamp = nowMs();
	const sqlBundle = [];
	for (const entry of ENTRIES) {
		sqlBundle.push(buildProjectUpsert(entry, timestamp));
		sqlBundle.push(...buildLinkInserts(entry, timestamp));
		const manifestAsset = verifiedAssets.get(entry.manifestSlug).manifestAsset;
		sqlBundle.push(buildMediaInsert(entry, manifestAsset, timestamp));
	}
	const fullSql = sqlBundle.join('\n');

	// 4. Write the SQL bundle to a temp file (avoid arg-list length limits).
	const tmpDir = process.env.TMPDIR || '/tmp';
	const fs = await import('node:fs');
	const tmpFile = resolve(
		tmpDir,
		`publish-portfolio-${env}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`,
	);
	writeFileSync(tmpFile, fullSql, { mode: 0o600 });
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
			: runR2Put(
					env,
					verified.manifestAsset.r2_key,
					verified.path,
					verified.manifestAsset.content_type,
				);
		r2Results.push({ slug, status: r2Result.status, stderr: r2Result.stderr });
	}

	// 7. Cleanup.
	try {
		unlinkSync(tmpFile);
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

async function operationVerify(parsed, manifest) {
	const env = parsed.environment;
	console.error(
		`[publish-portfolio] --operation=verify --environment=${env} READ-ONLY expected_visibility=${parsed.expectVisibility}`,
	);

	if (env === 'prod') {
		assertProductionIdentity(WRANGLER_PRODUCTION_CONFIG);
	}

	const ids = [...ALLOWED_CANDIDATE_IDS];
	const idList = ids.map((id) => sqlEscape(id)).join(',');
	const projectSql = `SELECT id, slug, title, role, visibility, status, motivation_md, architecture_md, constraints_md, implementation_md, evidence_md FROM portfolio_project WHERE id IN (${idList}) ORDER BY id;`;
	const linkSql = `SELECT id, project_id, kind, label, url, display_order FROM portfolio_link WHERE project_id IN (${idList}) ORDER BY project_id, display_order, id;`;
	const mediaSql = `SELECT id, project_id, r2_key, content_type, width, height, alt, caption, is_cover, display_order FROM portfolio_media WHERE project_id IN (${idList}) ORDER BY project_id, display_order, id;`;

	const projectResult = runD1Select(env, projectSql);
	const linkResult = runD1Select(env, linkSql);
	const mediaResult = runD1Select(env, mediaSql);
	for (const [label, result] of [
		['project', projectResult],
		['link', linkResult],
		['media', mediaResult],
	]) {
		if (result.status !== 0) {
			console.error(`[publish-portfolio] verify: D1 ${label} SELECT failed`);
			console.error(result.stderr);
			process.exit(result.status || 1);
		}
	}

	let projectRows;
	let linkRows;
	let mediaRows;
	try {
		projectRows = parseD1Rows(projectResult.stdout);
		linkRows = parseD1Rows(linkResult.stdout);
		mediaRows = parseD1Rows(mediaResult.stdout);
	} catch (error) {
		console.error(`[publish-portfolio] verify: ${error.message}`);
		process.exit(1);
	}

	const d1Errors = verifyD1Content({
		projectRows,
		linkRows,
		mediaRows,
		manifest,
		expectedVisibility: parsed.expectVisibility,
	});

	const r2States = [];
	const r2Errors = [];
	for (const asset of manifest.assets) {
		let evidence;
		if (env === 'prod') {
			try {
				evidence = await fetchPublicR2Object(asset);
			} catch (error) {
				evidence = {
					status: -1,
					contentType: '',
					byteSize: -1,
					sha256: '',
				};
				r2Errors.push(`${asset.slug}: public R2 fetch failed (${error.message})`);
			}
		} else {
			const localDir = mkdtempSync(resolve(tmpdir(), 'publish-portfolio-r2-verify-'));
			const localPath = resolve(localDir, 'object.bin');
			try {
				const result = runR2Get(env, asset.r2_key, localPath);
				if (result.status !== 0) {
					evidence = {
						status: result.status,
						contentType: asset.content_type,
						byteSize: -1,
						sha256: '',
					};
				} else {
					const body = readFileSync(localPath);
					evidence = {
						status: 0,
						contentType: asset.content_type,
						byteSize: body.byteLength,
						sha256: createHash('sha256').update(body).digest('hex'),
					};
				}
			} finally {
				rmSync(localDir, { recursive: true, force: true });
			}
		}
		const errors = validateR2Evidence(asset, evidence);
		r2Errors.push(...errors);
		r2States.push({
			slug: asset.slug,
			r2_key: asset.r2_key,
			status: evidence.status,
			content_type: evidence.contentType,
			byte_size: evidence.byteSize,
			sha256_match: evidence.sha256 === asset.sha256,
			content_type_match: evidence.contentType === asset.content_type.toLowerCase(),
			byte_size_match: evidence.byteSize === asset.byte_size,
		});
	}

	const contextDigest = publicationContextDigest(manifest);
	const allContentValid = d1Errors.length === 0;
	const allR2Valid = r2Errors.length === 0;
	const state = {
		environment: env,
		verified_at: new Date().toISOString(),
		expected_visibility: parsed.expectVisibility,
		context_digest: contextDigest,
		d1_rows: projectRows,
		r2_objects: r2States,
		all_content_valid: allContentValid,
		all_r2_valid: allR2Valid,
	};

	if (parsed.execute && allContentValid && allR2Valid && parsed.expectVisibility === 'draft') {
		writeVerifyState(env, state);
	}

	console.log(JSON.stringify(state, null, 2));
	for (const error of [...d1Errors, ...r2Errors]) {
		console.error(`[publish-portfolio] verify FAIL: ${error}`);
	}
	if (!allContentValid || !allR2Valid) {
		process.exit(2);
	}
	console.error('[publish-portfolio] verify PASS');
}

function operationPublish(parsed, manifest) {
	const env = parsed.environment;
	if (!parsed.execute) {
		console.error('[publish-portfolio] publish requires --execute');
		process.exit(2);
	}
	if (env === 'prod') {
		assertProductionIdentity(WRANGLER_PRODUCTION_CONFIG);
	}
	const state = readVerifyState(env);
	if (!state) {
		console.error(
			`[publish-portfolio] no verify state for environment=${env}; run verify --execute first`,
		);
		process.exit(2);
	}
	const ageMs = Date.now() - new Date(state.verified_at).getTime();
	if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > VERIFY_STATE_MAX_AGE_MS) {
		console.error('[publish-portfolio] verify state is stale or invalid; re-run verify');
		process.exit(2);
	}
	const currentDigest = publicationContextDigest(manifest);
	if (
		state.context_digest !== currentDigest ||
		state.expected_visibility !== 'draft' ||
		!state.all_content_valid ||
		!state.all_r2_valid
	) {
		console.error('[publish-portfolio] verify state does not match current publication context');
		process.exit(2);
	}

	const ids = [...ALLOWED_CANDIDATE_IDS];
	const sql = `UPDATE portfolio_project SET visibility='public', status='published', updated_at=${nowMs()} WHERE id IN (${ids.map((i) => `'${i}'`).join(',')});`;
	console.error(`[publish-portfolio] publish: ${ids.length} candidates → public`);

	const tmpDir = process.env.TMPDIR || '/tmp';
	const tmpFile = resolve(
		tmpDir,
		`publish-portfolio-publish-${env}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`,
	);
	writeFileSync(tmpFile, sql, { mode: 0o600 });

	const result = runD1(env, tmpFile);
	try {
		unlinkSync(tmpFile);
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

export function buildUnpublishSql(timestamp = nowMs()) {
	const ids = [...ALLOWED_CANDIDATE_IDS];
	return `UPDATE portfolio_project SET visibility='draft', updated_at=${timestamp} WHERE id IN (${ids.map((i) => `'${i}'`).join(',')});`;
}

function operationUnpublish(parsed /* , manifest */) {
	const env = parsed.environment;
	if (!parsed.execute) {
		console.error('[publish-portfolio] unpublish requires --execute');
		process.exit(2);
	}
	if (env === 'prod') {
		assertProductionIdentity(WRANGLER_PRODUCTION_CONFIG);
	}
	const ids = [...ALLOWED_CANDIDATE_IDS];
	const sql = buildUnpublishSql();
	console.error(`[publish-portfolio] unpublish: ${ids.length} candidates → draft (rollback)`);

	const tmpDir = process.env.TMPDIR || '/tmp';
	const tmpFile = resolve(
		tmpDir,
		`publish-portfolio-unpublish-${env}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`,
	);
	writeFileSync(tmpFile, sql, { mode: 0o600 });

	const result = runD1(env, tmpFile);
	try {
		unlinkSync(tmpFile);
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
			'Usage: node scripts/publish-portfolio-production.mjs --operation=prepare|verify|publish|unpublish --environment=local|prod [--execute] [--expect-visibility=draft|public]',
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
	if (!['draft', 'public'].includes(parsed.expectVisibility)) {
		console.error(`--expect-visibility must be draft|public, got ${parsed.expectVisibility}`);
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
			await operationVerify(parsed, manifest);
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
