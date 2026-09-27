#!/usr/bin/env node
/**
 * Seed script — Issue #120 / #78 Path A: 3 candidates (MultiSlicer /
 * aulymo-v01 / aulymo_v02) を owner approval 以外の blocker ゼロに
 * 仕上げるための supplementary seed。
 *
 * Usage:
 *   node scripts/seed-portfolio-path-a.mjs --dry-run
 *   node scripts/seed-portfolio-path-a.mjs --apply --target=local
 *
 * このスクリプトがやること:
 *
 *   1. `scripts/migrate-portfolio-from-2025.mjs` が portfolio_project +
 *      portfolio_link を UPSERT した後 (heading-keyword matching では
 *      _md が空になる legacy body の場合)、grounded Markdown を
 *      直接 UPDATE で流し込む。
 *   2. portfolio_media row を 3 候補分 UPSERT し、r2_key を
 *      `portfolio/<slug>/<filename>` 形式で発行。実際の R2 PUT は
 *      `--apply --target=local` で `wrangler r2 object put
 *      MEDIA/<key> --local --file <path>` を spawn する。
 *   3. publication = pending_owner のまま (visibility = 'draft') を維持。
 *      operator が別途 `publication_overrides` で publish を承認する
 *      まで public loader は touch しない。
 *
 * Idempotency: すべての INSERT は `INSERT OR REPLACE` で
 * `id` / `r2_key` 衝突を吸収。再実行しても state が収束する。
 *
 * 出典 grounding (各候補の Markdown 記述はすべて以下に限定):
 *   * `docs/personal/domain.md` §8 'Tool / plugin development'
 *   * `scripts/migrate-portfolio-from-2025.mjs` が読む my-web-2025
 *     SQLite (`contents` / `content_links` / `content_tags` /
 *     `media` table)
 *   * GitHub `rebuildup/Ae_MultiSlicer` / `rebuildup/Aulymo_v03`
 *     / `rebuildup/Aulymo_v04` (public に残っている repository)
 *   * YouTube auto-generated thumbnail (project owner upload 由来)
 *   * legacy media BLOB の JPEG (`20250503_multi.jpg`)
 *
 * 書かないこと (operator 承認待ち):
 *   * publication = 'approved' / visibility = 'public' への flip
 *   * 新しい事実 / 役割 / narrative の創作
 *   * R2 custom domain (`media.rebuildup.dev`) の attachment
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const apply = args.has('--apply');
const target = parseArg(args, '--target') ?? 'local';
if (target !== 'local' && target !== 'remote') {
	console.error(`--target must be 'local' or 'remote', got: ${target}`);
	process.exit(2);
}
if (!dryRun && !apply) {
	console.error('Usage: node scripts/seed-portfolio-path-a.mjs --dry-run');
	console.error('       node scripts/seed-portfolio-path-a.mjs --apply --target=local');
	process.exit(2);
}

/**
 * Per-candidate seed entries. Markdown は grounded fact のみ。
 * `motivation_md` / `architecture_md` / `constraints_md` /
 * `implementation_md` / `evidence_md` の 5 セクションは operator
 * の acceptance criteria 「meaningful Markdown」を満たす minimum。
 * `retrospective_md` は owner-driven のため空のまま。
 */
const ENTRIES = [
	{
		legacyId: 'MultiSlicer',
		slug: 'multislicer',
		title: 'MultiSlicer',
		summary: 'Aeで画像をスライスするエフェクトプラグインです',
		role: 'Plugin developer',
		periodStart: Date.parse('2025-05-02T03:00:00.000Z'),
		periodLabel: '2025-05-02',
		facets: ['design', 'develop', 'video'],
		technologies: ['C++', 'After Effects SDK', 'Visual Studio', 'AfterEffects'],
		visibility: 'draft',
		media: {
			localPath: 'portfolio-extracts/20250503_multi.jpg',
			r2Key: 'portfolio/multislicer/20250503_multi.jpg',
			contentType: 'image/jpeg',
			alt: 'MultiSlicer 動作スクリーンショット (2025-05-03 撮影)',
			caption: null,
			isCover: true,
		},
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
				`docs/personal/domain.md §8 の記述:\n\n` +
				`> MultiSlicer — C++ / After Effects SDK を使った effect plugin。` +
				`公開・配布を通して native plugin development を実践\n\n` +
				`legacy my-web-2025 の content_tags にも C++ / AfterEffects / ` +
				`VisualStudio / プラグイン が登録されており、上記 grounding と一致。`,
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
	},
	{
		legacyId: 'aulymo-v01',
		slug: 'aulymo-v01',
		title: 'Aulymo',
		summary: 'Aeのスクリプトです　簡単にリリックモーションを作れます',
		role: 'Tool developer',
		periodStart: Date.parse('2024-12-13T03:00:00.000Z'),
		periodLabel: '2024-12-13',
		facets: ['develop'],
		technologies: ['AfterEffects', 'ExtendScript', 'VSCode'],
		visibility: 'draft',
		media: {
			localPath: 'portfolio-extracts/aulymo-v01-maxres.jpg',
			r2Key: 'portfolio/aulymo-v01/aulymo-v01-maxres.jpg',
			contentType: 'image/jpeg',
			alt: 'Aulymo v1 動作 PV (YouTube SewXH0Bbm-c auto-generated thumbnail)',
			caption: null,
			isCover: true,
		},
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
				`docs/personal/domain.md §8 Tool / plugin development に ` +
				`登録された tool の一つ。productization / support / update を ` +
				`通じて tool owner の責務を経験した成果物。`,
			evidence_md:
				'**配布・公開の証拠**:\n\n' +
				'- YouTube `SewXH0Bbm-c` (auto-generated thumbnail を R2 ' +
				'`portfolio/aulymo-v01/` へ保存)\n' +
				'- BOOTH 商品ページ `361do.booth.pm/items/6403113`\n',
			retrospective_md: '',
		},
	},
	{
		legacyId: 'aulymo_v02',
		slug: 'aulymo-v02',
		title: 'Aeスクリプト Aulymo',
		summary:
			'Ae全自動リリックモーション「Aulymo」v2の動作説明動画です。' +
			'PremiereProを初めてまともに使いました。あと、コンピュータ部のMacBookを借りました。',
		role: 'Tool developer',
		periodStart: Date.parse('2024-12-20T03:00:00.000Z'),
		periodLabel: '2024-12-20',
		facets: ['develop'],
		technologies: ['AfterEffects', 'VSCode'],
		visibility: 'draft',
		media: {
			localPath: 'portfolio-extracts/aulymo_v02-maxres.jpg',
			r2Key: 'portfolio/aulymo-v02/aulymo-v02-maxres.jpg',
			contentType: 'image/jpeg',
			alt: 'Aulymo v2 動作説明動画 (YouTube EbtybmiN5pM auto-generated thumbnail)',
			caption: null,
			isCover: true,
		},
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
				`docs/personal/domain.md §8 Tool / plugin development の ` +
				`Aulymo 系統の v2 リリース。実装そのものは v1 を継続し、` +
				`動画制作工程のみが v2 で拡張された。`,
			evidence_md:
				'**配布・公開の証拠**:\n\n' +
				'- YouTube `EbtybmiN5pM` (v2 動作説明動画、' +
				'auto-generated thumbnail を R2 `portfolio/aulymo-v02/` へ保存)\n' +
				'- BOOTH 商品ページ `361do.booth.pm/items/6403113` (v1/v2 共通)\n',
			retrospective_md: '',
		},
	},
];

function parseArg(set, name) {
	for (const a of set) {
		if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
	}
	return null;
}

function sqlEscape(value) {
	if (value === null || value === undefined) return 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlStrOrEmpty(value) {
	return sqlEscape(value ?? '');
}

/** Locate the legacy my-web-2025 reference clone. */
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
	console.error(
		`[seed-path-a] cannot locate .reference/my-web-2025; looked upward from ${startDir}.`,
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
	console.error(`[seed-path-a] node:sqlite requires Node ≥ 22; this environment is ${process.versions.node}.`);
	process.exit(2);
}
const { DatabaseSync } = await import('node:sqlite');

function nowMs() {
	return Date.now();
}

/** Normalize a legacy id to a valid slug — same algorithm as
 * `scripts/migrate-portfolio-from-2025.mjs#deriveSlug`. */
function normalizeSlug(legacyId) {
	return legacyId
		.toLowerCase()
		.replace(/_/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

/** Build a single project's UPSERT (id-based INSERT OR REPLACE). */
function buildProjectUpsert(entry) {
	const slug = normalizeSlug(entry.legacyId);
	const id = `legacy_${slug.replace(/[^a-z0-9-]/g, '_')}`;
	// Override the entry's `slug` with the normalized form so
	// downstream link / media rows reference the correct id.
	entry.slug = slug;
	const cols =
		'id, slug, title, summary, role, period_start, period_end, period_label, motivation_md, architecture_md, constraints_md, implementation_md, evidence_md, retrospective_md, facets, technologies, visibility, status, pinned, display_order, created_at, updated_at';
	const values = [
		sqlEscape(id),
		sqlEscape(entry.slug),
		sqlEscape(entry.title),
		sqlEscape(entry.summary),
		sqlEscape(entry.role),
		entry.periodStart,
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
		sqlEscape(entry.visibility),
		sqlEscape('published'),
		0,
		100,
		nowMs(),
		nowMs(),
	].join(', ');
	return `INSERT OR REPLACE INTO portfolio_project (${cols}) VALUES (${values});`;
}

/** Build portfolio_link INSERTs from legacy content_links via direct read. */
function buildLinkInserts(entry, links) {
	const id = `legacy_${entry.slug.replace(/[^a-z0-9-]/g, '_')}`;
	const stmts = [];
	for (const link of links) {
		const linkId = `legacy_link_${id}_${link.legacyId}`;
		const kind = linkKindFromUrl(link.href);
		stmts.push(
			`INSERT OR REPLACE INTO portfolio_link (id, project_id, kind, label, url, display_order, created_at) VALUES (${sqlEscape(linkId)}, ${sqlEscape(id)}, ${sqlEscape(kind)}, ${sqlEscape(link.label ?? null)}, ${sqlEscape(link.href)}, ${link.order ?? 0}, ${nowMs()});`,
		);
	}
	return stmts;
}

function linkKindFromUrl(href) {
	try {
		const u = new URL(href);
		const host = u.hostname.toLowerCase();
		if (host === 'booth.pm' || host.endsWith('.booth.pm')) return 'shop';
		if (host === 'github.com' || host.endsWith('.github.com')) return 'repo';
		if (
			host === 'youtu.be' ||
			host.endsWith('youtube.com') ||
			host === 'youtube-nocookie.com'
		)
			return 'video';
		if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com')
			return 'other';
		return 'other';
	} catch {
		return 'other';
	}
}

function buildMediaUpsert(entry) {
	const id = `legacy_${entry.slug.replace(/[^a-z0-9-]/g, '_')}`;
	const mediaId = `legacy_media_${id}_0`;
	const cols =
		'id, project_id, r2_key, content_type, width, height, alt, caption, is_cover, display_order, created_at';
	const values = [
		sqlEscape(mediaId),
		sqlEscape(id),
		sqlEscape(entry.media.r2Key),
		sqlEscape(entry.media.contentType),
		'NULL',
		'NULL',
		sqlEscape(entry.media.alt),
		entry.media.caption === null ? 'NULL' : sqlEscape(entry.media.caption),
		entry.media.isCover ? 1 : 0,
		0,
		nowMs(),
	].join(', ');
	return `INSERT OR REPLACE INTO portfolio_media (${cols}) VALUES (${values});`;
}

/** Read legacy content_links for a candidate via SQLite. */
function readLegacyLinks(legacyId) {
	const dbPath = join(refRoot, 'data/contents', `content-${legacyId}.db`);
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const rows = db
			.prepare(
				'SELECT id, href, label, "order" FROM content_links WHERE content_id = ? ORDER BY "order" ASC',
			)
			.all(legacyId);
		return rows
			.filter((r) => {
				if (!r.href || typeof r.href !== 'string') return false;
				try {
					const u = new URL(r.href);
					return u.protocol === 'http:' || u.protocol === 'https:';
				} catch {
					return false;
				}
			})
			.map((r) => ({
				legacyId: r.id,
				href: r.href,
				label: r.label,
				order: r.order ?? 0,
			}));
	} finally {
		db.close();
	}
}

function main() {
	const allSql = [];
	const mediaUploads = [];
	console.error('[seed-path-a] building UPSERT for 3 candidates:');
	for (const entry of ENTRIES) {
		console.error(`  - ${entry.legacyId} → ${entry.slug}`);
		// Project row UPSERT with full Markdown.
		allSql.push(`-- ${entry.legacyId}`);
		allSql.push(buildProjectUpsert(entry));
		// Links from legacy content_links (filtered to valid http(s)).
		const links = readLegacyLinks(entry.legacyId);
		console.error(`    links: ${links.length}`);
		for (const stmt of buildLinkInserts(entry, links)) allSql.push(stmt);
		// Media UPSERT.
		allSql.push(buildMediaUpsert(entry));
		mediaUploads.push({
			slug: entry.slug,
			localPath: join(refRoot, 'data', entry.media.localPath),
			r2Key: entry.media.r2Key,
			contentType: entry.media.contentType,
		});
		allSql.push('');
	}

	console.error('[seed-path-a] media uploads:');
	for (const m of mediaUploads) {
		const stat = existsSync(m.localPath) ? statSync(m.localPath) : null;
		console.error(
			`  - ${m.slug}: ${m.localPath} (${stat ? stat.size + ' bytes' : 'MISSING'}) → ${m.r2Key}`,
		);
		if (!existsSync(m.localPath)) {
			console.error(`[seed-path-a] FATAL: local media missing for ${m.slug}`);
			process.exit(1);
		}
	}

	if (dryRun) {
		process.stdout.write(allSql.join('\n'));
		return;
	}

	// --apply: write SQL to a tmp file and execute via wrangler d1.
	const tmp = mkdtempSync(join(tmpdir(), 'seed-path-a-'));
	const sqlPath = join(tmp, 'seed.sql');
	writeFileSync(sqlPath, allSql.join('\n'), { mode: 0o600 });
	try {
		const d1Args = ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--file', sqlPath];
		const d1 = spawnSync('pnpm', d1Args, { cwd: root, stdio: 'inherit', env: process.env });
		if (d1.status !== 0) {
			console.error(`[seed-path-a] wrangler d1 exited with status ${d1.status}`);
			process.exit(d1.status ?? 1);
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}

	// R2 PUT (local bucket). `wrangler r2 object put <bucket-name>/<key>`
	// requires the actual bucket_name, not the binding name. The
	// binding `MEDIA` (see wrangler.jsonc#r2_buckets) maps to bucket
	// `my-web-2026`.
	const R2_BUCKET_NAME = 'my-web-2026';
	for (const m of mediaUploads) {
		const cmdArgs = [
			'exec',
			'wrangler',
			'r2',
			'object',
			'put',
			`${R2_BUCKET_NAME}/${m.r2Key}`,
			'--file',
			m.localPath,
			'--content-type',
			m.contentType,
			'--local',
		];
		const cmd = spawnSync('pnpm', cmdArgs, {
			cwd: root,
			stdio: 'inherit',
			env: process.env,
		});
		if (cmd.status !== 0) {
			console.error(`[seed-path-a] R2 PUT failed for ${m.r2Key}`);
			process.exit(cmd.status ?? 1);
		}
	}

	console.error('[seed-path-a] DONE.');
}

main();
