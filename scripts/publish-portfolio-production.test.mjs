/**
 * Tests for scripts/publish-portfolio-production.mjs (Issue #123).
 *
 * These tests exercise the SQL builders, manifest validation, asset
 * hash verification, and the 4 operations' pre/post-conditions.
 *
 * They do NOT spawn wrangler — they use the script's exported pure
 * helpers. The wrangler spawn wrapper is implicitly tested via the
 * dry-run path (default = dry-run, no spawn).
 *
 * Test framework: `node:test` + `node:assert/strict` (matches the
 * convention used by `scripts/migrate-portfolio-from-2025.test.mjs`).
 *
 * The version is imported from the script, which itself derives it
 * from package.json#version — never hard-coded here, per
 * AGENTS.md §1.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	ALLOWED_CANDIDATE_IDS,
	ENTRIES,
	RELEASE_VERSION,
	buildLinkInserts,
	buildMediaInsert,
	buildProjectUpsert,
	buildR2GetArgs,
	buildR2PutArgs,
	buildUnpublishSql,
	fetchPublicR2Object,
	linkIdFor,
	linkKindFromUrl,
	loadManifest,
	mediaIdFor,
	normalizeSlug,
	projectIdFor,
	publicationContextDigest,
	readVerifyRows,
	sha256OfFile,
	validateEntry,
	validateManifest,
	validateR2Evidence,
	verifyD1Content,
} from './publish-portfolio-production.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

// Path to the shipped release manifest, derived from the current
// package.json#version. Used by the integration tests below.
const SHIPPED_MANIFEST_PATH = `release-assets/portfolio/${RELEASE_VERSION}/manifest.json`;
const SHIPPED_ASSETS_ROOT = join(REPO_ROOT, 'release-assets', 'portfolio', RELEASE_VERSION);

// -----------------------------------------------------------------------
// Test fixtures.
// -----------------------------------------------------------------------

function makeEntry(overrides = {}) {
	return {
		legacyId: 'multislicer',
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
		mediaAlt: 'MultiSlicer 動作スクリーンショット',
		mediaCaption: null,
		markdown: {
			motivation_md: 'motivation content',
			architecture_md: 'architecture content',
			constraints_md: 'constraints content',
			implementation_md: 'implementation content',
			evidence_md: 'evidence content',
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
				label: 'BOOTH — MultiSlicer',
				order: 2,
			},
		],
		...overrides,
	};
}

function makeManifest(overrides = {}) {
	return {
		release: RELEASE_VERSION,
		r2_bucket: 'my-web-2026',
		assets: [
			{
				candidate_id: 'legacy_multislicer',
				slug: 'multislicer',
				title: 'MultiSlicer',
				asset_filename: '20250503_multi.jpg',
				asset_relative_path: 'multislicer/20250503_multi.jpg',
				r2_key: 'portfolio/multislicer/20250503_multi.jpg',
				content_type: 'image/jpeg',
				byte_size: 100,
				width: 1920,
				height: 1920,
				sha256: 'e2ca41283cde9e87222f103f6588471ce1f2e1a17a87f28ba4a5b338c7f9cb7e',
				alt: 'MultiSlicer 動作スクリーンショット',
				is_cover: true,
			},
		],
		...overrides,
	};
}

// -----------------------------------------------------------------------
// 1. SQL builders.
// -----------------------------------------------------------------------

describe('buildProjectUpsert', () => {
	it('produces INSERT ... ON CONFLICT(id) DO UPDATE SET <content_only>', () => {
		const sql = buildProjectUpsert(makeEntry());
		assert.match(sql, /^INSERT INTO portfolio_project /);
		assert.match(sql, /ON CONFLICT\(id\) DO UPDATE SET/);
	});

	it('excludes owner-managed columns from UPDATE SET', () => {
		const sql = buildProjectUpsert(makeEntry());
		assert.doesNotMatch(sql, /visibility\s*=\s*excluded\.visibility/);
		assert.doesNotMatch(sql, /status\s*=\s*excluded\.status/);
		assert.doesNotMatch(sql, /created_at\s*=\s*excluded\.created_at/);
		assert.doesNotMatch(sql, /pinned\s*=\s*excluded\.pinned/);
		assert.doesNotMatch(sql, /display_order\s*=\s*excluded\.display_order/);
	});

	it('overwrites updated_at so audit timestamps reflect latest write', () => {
		const sql = buildProjectUpsert(makeEntry());
		assert.match(sql, /updated_at\s*=\s*excluded\.updated_at/);
	});

	it('escapes single quotes in markdown sections (SQL injection guard)', () => {
		const sql = buildProjectUpsert(
			makeEntry({
				markdown: {
					motivation_md: "it's a test",
					architecture_md: 'a',
					constraints_md: 'b',
					implementation_md: 'c',
					evidence_md: 'd',
					retrospective_md: '',
				},
			}),
		);
		assert.ok(sql.includes("'it''s a test'"));
	});

	it('produces deterministic id = legacy_<normalized-slug>', () => {
		const sql = buildProjectUpsert(makeEntry());
		assert.ok(sql.includes("'legacy_multislicer'"));
	});

	it('inserts with visibility=draft on first insert (DO UPDATE excludes visibility)', () => {
		const sql = buildProjectUpsert(makeEntry());
		assert.match(sql, /VALUES\s*\([^)]*,\s*'draft',\s*'published'/);
	});
});

describe('buildLinkInserts', () => {
	it('produces INSERT OR IGNORE (preserves owner-added rows)', () => {
		const stmts = buildLinkInserts(makeEntry());
		assert.equal(stmts.length, 2);
		for (const stmt of stmts) {
			assert.match(stmt, /^INSERT OR IGNORE INTO portfolio_link /);
		}
	});

	it('uses stable link ids derived from project_id + link.legacyId', () => {
		const stmts = buildLinkInserts(makeEntry());
		assert.ok(stmts[0].includes("'legacy_link_legacy_multislicer_youtube_pv'"));
		assert.ok(stmts[1].includes("'legacy_link_legacy_multislicer_booth_item'"));
	});

	it('classifies YouTube as video, GitHub as repo, BOOTH as shop, X as other, others as other', () => {
		const entry = makeEntry({
			links: [
				{ legacyId: 'yt', href: 'https://www.youtube.com/watch?v=abc', label: 'yt', order: 1 },
				{ legacyId: 'gh', href: 'https://github.com/x/y', label: 'gh', order: 2 },
				{ legacyId: 'booth', href: 'https://361do.booth.pm/items/1', label: 'booth', order: 3 },
				{ legacyId: 'x', href: 'https://x.com/u/status/1', label: 'x', order: 4 },
				{ legacyId: 'o', href: 'https://example.com/x', label: 'o', order: 5 },
			],
		});
		const stmts = buildLinkInserts(entry);
		assert.ok(stmts[0].includes("'video'"));
		assert.ok(stmts[1].includes("'repo'"));
		assert.ok(stmts[2].includes("'shop'"));
		assert.ok(stmts[3].includes("'other'"));
		assert.ok(stmts[4].includes("'other'"));
	});

	it('preserves owner-added link on re-run (id collision → no-op)', () => {
		// The operation boundary owns wall-clock time; pure SQL builders
		// receive it explicitly so equality never depends on a 1 ms race.
		const timestamp = 1_759_000_000_000;
		const a = buildLinkInserts(makeEntry(), timestamp);
		const b = buildLinkInserts(makeEntry(), timestamp);
		assert.deepEqual(a, b);
		assert.ok(a.every((sql) => sql.includes(`, ${timestamp});`)));
	});
});

describe('linkKindFromUrl schema alignment', () => {
	it('keeps every emitted link kind inside portfolio_link.kind closed enum', () => {
		// The closed enum mirrors `migrations/0007_portfolio.sql#portfolio_link.kind`
		// (`CHECK (kind IN ('repo', 'demo', 'release', 'article', 'shop', 'video', 'other'))`).
		// We deliberately do NOT regex-parse the migration SQL here: that couples
		// the test to whitespace/quoting drift and is the kind of fragility the
		// Issue #128 review explicitly removed. If the migration enum changes,
		// update BOTH this literal and the migration in the same diff.
		const schemaKinds = new Set(['repo', 'demo', 'release', 'article', 'shop', 'video', 'other']);

		const cases = [
			['https://x.com/u/status/1', 'other'],
			['https://twitter.com/u/status/1', 'other'],
			['https://t.co/abc', 'other'],
			['https://www.youtube.com/watch?v=abc', 'video'],
			['https://github.com/rebuildup/example', 'repo'],
			['https://361do.booth.pm/items/1', 'shop'],
			['https://booth.pm/items/1', 'shop'],
			['https://qiita.com/example/items/1', 'other'],
		];

		for (const [url, expected] of cases) {
			const actual = linkKindFromUrl(url);
			assert.equal(actual, expected, url);
			assert.ok(
				schemaKinds.has(actual),
				`${url}: ${actual} is outside portfolio_link.kind enum (${[...schemaKinds].join(', ')})`,
			);
		}
	});
});

describe('release runbook ordering alignment', () => {
	it('cross-references canonical release surfaces and keeps attach before verify', () => {
		const driver = readFileSync(
			join(REPO_ROOT, 'scripts', 'publish-portfolio-production.mjs'),
			'utf8',
		);
		assert.ok(driver.includes('Canonical co-owned runbook: Issue #82 §C + PR #91 body §B.'));
		const prepare = driver.indexOf('2. driver `prepare --execute --environment=prod`');
		const attach = driver.indexOf('3. R2 custom-domain attachment');
		const verify = driver.indexOf('4. driver `verify --environment=prod --execute`');
		assert.ok(prepare >= 0 && attach > prepare && verify > attach);
	});
});

describe('buildMediaInsert', () => {
	it('produces INSERT OR IGNORE INTO portfolio_media', () => {
		const sql = buildMediaInsert(makeEntry(), makeManifest().assets[0]);
		assert.match(sql, /^INSERT OR IGNORE INTO portfolio_media /);
	});

	it('uses deterministic media id derived from project_id + manifest_slug + filename', () => {
		const sql = buildMediaInsert(makeEntry(), makeManifest().assets[0]);
		assert.ok(sql.includes("'legacy_media_legacy_multislicer_multislicer_20250503_multi.jpg'"));
	});

	it('uses R2 key from manifest, not local file path', () => {
		const sql = buildMediaInsert(makeEntry(), makeManifest().assets[0]);
		assert.ok(sql.includes("'portfolio/multislicer/20250503_multi.jpg'"));
		assert.ok(!sql.includes('portfolio-extracts/'));
	});

	it('preserves owner-added media on re-run (id collision → no-op)', () => {
		const timestamp = 1_759_000_000_000;
		const a = buildMediaInsert(makeEntry(), makeManifest().assets[0], timestamp);
		const b = buildMediaInsert(makeEntry(), makeManifest().assets[0], timestamp);
		assert.equal(a, b);
		assert.ok(a.includes(`, ${timestamp});`));
	});
});

// -----------------------------------------------------------------------
// 2. Slug + id derivation.
// -----------------------------------------------------------------------

describe('normalizeSlug', () => {
	it('lowercases + replaces _ with - + strips non-allowed', () => {
		assert.equal(normalizeSlug('MultiSlicer'), 'multislicer');
		assert.equal(normalizeSlug('aulymo_v02'), 'aulymo-v02');
		assert.equal(normalizeSlug('aulymo-v01'), 'aulymo-v01');
		// @ and ! are STRIPPED (not replaced with -), so consecutive dashes
		// do not form. The function preserves internal - in the input.
		assert.equal(normalizeSlug('kosen-procon@pv!'), 'kosen-proconpv');
		assert.equal(normalizeSlug('Kosen_Procon_PV'), 'kosen-procon-pv');
	});

	it('produces a slug that matches /^[a-z0-9][a-z0-9-]{0,127}$/', () => {
		const inputs = [
			'MultiSlicer',
			'aulymo_v02',
			'aulymo-v01',
			'kosen-procon@pv!',
			'Kosen_Procon_PV',
		];
		for (const input of inputs) {
			assert.match(normalizeSlug(input), /^[a-z0-9][a-z0-9-]{0,127}$/);
		}
	});
});

describe('projectIdFor', () => {
	it('returns legacy_<normalized-slug>', () => {
		assert.equal(projectIdFor({ legacyId: 'MultiSlicer' }), 'legacy_multislicer');
		assert.equal(projectIdFor({ legacyId: 'aulymo_v02' }), 'legacy_aulymo-v02');
	});

	it('result is always in ALLOWED_CANDIDATE_IDS for legitimate entries', () => {
		assert.ok(ALLOWED_CANDIDATE_IDS.has(projectIdFor({ legacyId: 'MultiSlicer' })));
		assert.ok(ALLOWED_CANDIDATE_IDS.has(projectIdFor({ legacyId: 'aulymo_v02' })));
		assert.ok(ALLOWED_CANDIDATE_IDS.has(projectIdFor({ legacyId: 'aulymo_v01' })));
	});
});

describe('ALLOWED_CANDIDATE_IDS', () => {
	it('contains exactly the 3 expected ids', () => {
		assert.equal(ALLOWED_CANDIDATE_IDS.size, 3);
		assert.ok(ALLOWED_CANDIDATE_IDS.has('legacy_multislicer'));
		assert.ok(ALLOWED_CANDIDATE_IDS.has('legacy_aulymo-v01'));
		assert.ok(ALLOWED_CANDIDATE_IDS.has('legacy_aulymo-v02'));
	});

	it('does NOT contain aulymo-v03 (deferred per operator decision)', () => {
		assert.ok(!ALLOWED_CANDIDATE_IDS.has('legacy_aulymo-v03'));
	});
});

// -----------------------------------------------------------------------
// 3. Entry validation (pre-mutation gate).
// -----------------------------------------------------------------------

describe('validateEntry', () => {
	it('returns no errors for a well-formed entry', () => {
		assert.deepEqual(validateEntry(makeEntry()), []);
	});

	it('rejects facet outside closed enum', () => {
		const errors = validateEntry(makeEntry({ facets: ['develop', 'unknown'] }));
		assert.ok(errors.some((e) => e.includes('facet')));
	});

	it('rejects empty markdown section', () => {
		const errors = validateEntry(
			makeEntry({
				markdown: {
					motivation_md: '',
					architecture_md: 'a',
					constraints_md: 'b',
					implementation_md: 'c',
					evidence_md: 'd',
					retrospective_md: '',
				},
			}),
		);
		assert.ok(errors.some((e) => e.includes('motivation_md')));
	});

	it('rejects empty links array', () => {
		const errors = validateEntry(makeEntry({ links: [] }));
		assert.ok(errors.some((e) => e.includes('at least one link')));
	});

	it('rejects legacyId that produces a non-allowed project id', () => {
		const errors = validateEntry(makeEntry({ legacyId: 'something-else' }));
		assert.ok(errors.some((e) => e.includes('allowlist')));
	});
});

// -----------------------------------------------------------------------
// 4. Manifest validation.
// -----------------------------------------------------------------------

describe('validateManifest', () => {
	it('passes a well-formed 1-asset manifest', () => {
		assert.deepEqual(validateManifest(makeManifest()), []);
	});

	it('rejects wrong release version', () => {
		// Use a non-`0.x.x` string to avoid version:check flagging the literal.
		const errors = validateManifest(makeManifest({ release: '1.0.0' }));
		assert.ok(errors.some((e) => e.includes('release')));
	});

	it('rejects wrong r2 bucket', () => {
		const errors = validateManifest(makeManifest({ r2_bucket: 'other-bucket' }));
		assert.ok(errors.some((e) => e.includes('r2_bucket')));
	});

	it('rejects assets with non-allowed candidate_id', () => {
		const manifest = makeManifest();
		manifest.assets.push({
			...manifest.assets[0],
			candidate_id: 'legacy_aulymo-v03',
		});
		const errors = validateManifest(manifest);
		assert.ok(errors.some((e) => e.includes('allowlist')));
	});

	it('rejects duplicate candidate_id', () => {
		const manifest = makeManifest();
		manifest.assets.push({ ...manifest.assets[0] });
		const errors = validateManifest(manifest);
		assert.ok(errors.some((e) => e.includes('duplicate')));
	});

	it('rejects non-hex sha256', () => {
		const manifest = makeManifest();
		manifest.assets[0].sha256 = 'not-hex';
		const errors = validateManifest(manifest);
		assert.ok(errors.some((e) => e.includes('sha256')));
	});

	it('rejects missing required fields', () => {
		const manifest = makeManifest();
		// Build a fresh asset without the sha256 key so the validator's
		// `if (!(required in a))` check fires. Assigning `undefined` keeps
		// the key in the object and bypasses the presence check.
		const assetWithoutSha = { ...manifest.assets[0] };
		Reflect.deleteProperty(assetWithoutSha, 'sha256');
		manifest.assets = [assetWithoutSha];
		const errors = validateManifest(manifest);
		assert.ok(errors.some((e) => e.includes('sha256')));
	});

	it('rejects empty assets array', () => {
		const errors = validateManifest(makeManifest({ assets: [] }));
		assert.ok(errors.length > 0);
	});
});

// -----------------------------------------------------------------------
// 5. sha256OfFile.
// -----------------------------------------------------------------------

describe('sha256OfFile', () => {
	let tmpDir;

	it('computes correct sha256 for known content', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'publish-sha-'));
		const content = Buffer.from('hello world');
		const path = join(tmpDir, 'sample.bin');
		writeFileSync(path, content);
		const expected = createHash('sha256').update(content).digest('hex');
		const actual = await sha256OfFile(path);
		assert.equal(actual, expected);
		rmSync(tmpDir, { recursive: true, force: true });
	});
});

// -----------------------------------------------------------------------
// 6. release-assets/portfolio/${version}/manifest.json integration.
// -----------------------------------------------------------------------

describe('release-assets manifest integration', () => {
	it('loads and validates the shipped manifest', () => {
		const manifest = loadManifest(SHIPPED_MANIFEST_PATH);
		assert.equal(manifest.release, RELEASE_VERSION);
		assert.equal(manifest.r2_bucket, 'my-web-2026');
		assert.equal(manifest.assets.length, 3);
		const ids = manifest.assets.map((a) => a.candidate_id).sort();
		assert.deepEqual(ids, ['legacy_aulymo-v01', 'legacy_aulymo-v02', 'legacy_multislicer']);
	});

	it('every shipped asset file exists on disk', () => {
		const manifest = loadManifest(SHIPPED_MANIFEST_PATH);
		for (const asset of manifest.assets) {
			const full = join(SHIPPED_ASSETS_ROOT, asset.asset_relative_path);
			assert.doesNotThrow(() => readFileSync(full), `missing asset file: ${full}`);
		}
	});

	it('every shipped asset sha256 matches its file content', async () => {
		const manifest = loadManifest(SHIPPED_MANIFEST_PATH);
		for (const asset of manifest.assets) {
			const full = join(SHIPPED_ASSETS_ROOT, asset.asset_relative_path);
			const buf = readFileSync(full);
			const actual = createHash('sha256').update(buf).digest('hex');
			assert.equal(actual, asset.sha256, `hash mismatch for ${asset.asset_relative_path}`);
		}
	});

	it('every shipped asset byte_size matches', () => {
		const manifest = loadManifest(SHIPPED_MANIFEST_PATH);
		for (const asset of manifest.assets) {
			const full = join(SHIPPED_ASSETS_ROOT, asset.asset_relative_path);
			const buf = readFileSync(full);
			assert.equal(buf.length, asset.byte_size, `size mismatch for ${asset.asset_relative_path}`);
		}
	});
});

// -----------------------------------------------------------------------
// 7. argv / stdout sensitive data check.
// -----------------------------------------------------------------------

describe('no sensitive data in argv / stdout', () => {
	it('does not log secret values or token shapes', () => {
		// The script reads no environment variables related to secrets;
		// verify the source contains no obvious token patterns.
		const source = readFileSync(
			join(REPO_ROOT, 'scripts', 'publish-portfolio-production.mjs'),
			'utf8',
		);
		assert.ok(!/process\.env\.INFISICAL_TOKEN/.test(source));
		assert.ok(!/process\.env\.CLOUDFLARE_API_TOKEN/.test(source));
		assert.ok(!/process\.env\.WRANGLER_API_TOKEN/.test(source));
		// argv / stdout paths: log lines should not contain any string
		// that resembles a plaintext secret.
		const secretLikePatterns = [
			/[a-f0-9]{64}/i, // SHA-256-like (hex string)
			/bearer\s+[a-z0-9._-]{20,}/i,
			/sk_[a-z0-9]{16,}/i,
		];
		for (const pattern of secretLikePatterns) {
			assert.ok(!pattern.test(source), `source contains secret-like pattern ${pattern}`);
		}
	});
});

// -----------------------------------------------------------------------
// 8. Production driver hardening / review blockers.
// -----------------------------------------------------------------------

function buildExpectedVerificationRows(manifest, visibility = 'draft') {
	const projectRows = ENTRIES.map((entry) => ({
		id: projectIdFor({ legacyId: entry.legacyId }),
		slug: normalizeSlug(entry.legacyId),
		title: entry.title,
		role: entry.role,
		visibility,
		status: 'published',
		motivation_md: entry.markdown.motivation_md,
		architecture_md: entry.markdown.architecture_md,
		constraints_md: entry.markdown.constraints_md,
		implementation_md: entry.markdown.implementation_md,
		evidence_md: entry.markdown.evidence_md,
	}));
	const linkRows = ENTRIES.flatMap((entry) => {
		const projectId = projectIdFor({ legacyId: entry.legacyId });
		return entry.links.map((link) => ({
			id: linkIdFor(projectId, link),
			project_id: projectId,
			kind: linkKindFromUrl(link.href),
			label: link.label ?? null,
			url: link.href,
			display_order: link.order ?? 0,
		}));
	});
	const mediaRows = ENTRIES.map((entry) => {
		const projectId = projectIdFor({ legacyId: entry.legacyId });
		const asset = manifest.assets.find((candidate) => candidate.slug === entry.manifestSlug);
		assert.ok(asset, `manifest asset missing for ${entry.manifestSlug}`);
		return {
			id: mediaIdFor(projectId, entry.manifestSlug, entry.mediaFilename),
			project_id: projectId,
			r2_key: asset.r2_key,
			content_type: asset.content_type,
			width: asset.width,
			height: asset.height,
			alt: entry.mediaAlt,
			caption: entry.mediaCaption,
			is_cover: 1,
			display_order: 1,
		};
	});
	return { projectRows, linkRows, mediaRows };
}

describe('production config coupling', () => {
	it('passes the canonical production config to every prod Wrangler surface', () => {
		// Issue #247: D1 no longer builds a Wrangler argv — it goes
		// through the cf driver, which addresses the database by ID and
		// carries its own production gate. R2 still uses Wrangler and is
		// covered until the secrets/cleanup slices move it.
		for (const args of [
			buildR2PutArgs('prod', 'portfolio/a.jpg', '/tmp/a.jpg', 'image/jpeg'),
			buildR2GetArgs('prod', 'portfolio/a.jpg', '/tmp/a.jpg'),
		]) {
			const configIndex = args.indexOf('-c');
			assert.notEqual(configIndex, -1);
			assert.equal(args[configIndex + 1], 'wrangler.production.jsonc');
		}
	});

	it('uses manifest Content-Type on R2 PUT instead of inference', () => {
		const args = buildR2PutArgs('prod', 'portfolio/a.jpg', '/tmp/a.jpg', 'image/jpeg');
		const index = args.indexOf('--content-type');
		assert.notEqual(index, -1);
		assert.equal(args[index + 1], 'image/jpeg');
		assert.equal(args.includes('inherit'), false);
	});
});

describe('verify flow consumes normalised D1 rows (Issue #247)', () => {
	/*
	 * REGRESSION GUARD.
	 *
	 * `runD1Select` returned `{ parsed: queryRows(...) }` while `verify`
	 * read `result.status` / `result.stdout`. `status` was `undefined`, so
	 * the failure check `undefined !== 0` was always true and `verify`
	 * exited 1 on its first D1 read — production portfolio verification
	 * could not succeed at all. Every test in this file exercised a
	 * helper, never the wiring between the read and the check, so the
	 * mismatch stayed invisible.
	 *
	 * These tests run the actual read→verify path with a fake selector.
	 */

	it('returns the three row sets directly, with no subprocess envelope', () => {
		const seen = [];
		const rows = readVerifyRows('dev', ['a', 'b'], {
			select: (_env, sql) => {
				seen.push(sql);
				return [{ id: 'row' }];
			},
		});
		// The rows ARE the result: no `stdout`, `status`, or `stderr`.
		assert.deepEqual(rows, {
			projectRows: [{ id: 'row' }],
			linkRows: [{ id: 'row' }],
			mediaRows: [{ id: 'row' }],
		});
		for (const key of Object.keys(rows)) {
			assert.ok(Array.isArray(rows[key]), `${key} must be an array of object rows`);
		}
		assert.equal(seen.length, 3, 'verify performs exactly three SELECTs');
	});

	it('feeds readVerifyRows output straight into verifyD1Content with no errors', () => {
		// The end-to-end shape: read → verify. With the old envelope this
		// would have handed `verifyD1Content` three `undefined`s.
		const manifest = loadManifest(SHIPPED_MANIFEST_PATH);
		const expected = buildExpectedVerificationRows(manifest);
		const byTable = {
			portfolio_project: expected.projectRows,
			portfolio_link: expected.linkRows,
			portfolio_media: expected.mediaRows,
		};
		const read = readVerifyRows(
			'dev',
			ENTRIES.map((e) => e.legacyId),
			{
				select: (_env, sql) => {
					for (const [table, rows] of Object.entries(byTable)) {
						if (sql.includes(`FROM ${table}`)) return rows;
					}
					throw new Error(`unexpected SELECT: ${sql}`);
				},
			},
		);
		assert.deepEqual(verifyD1Content({ ...read, manifest, expectedVisibility: 'draft' }), []);
	});

	it('surfaces a content mismatch, rather than exiting on an undefined status', () => {
		const manifest = loadManifest(SHIPPED_MANIFEST_PATH);
		const expected = buildExpectedVerificationRows(manifest);
		const rows = readVerifyRows(
			'dev',
			ENTRIES.map((e) => e.legacyId),
			{
				select: (_env, sql) => {
					if (sql.includes('FROM portfolio_project')) {
						return [{ ...expected.projectRows[0], slug: 'wrong-slug' }];
					}
					if (sql.includes('FROM portfolio_link')) return expected.linkRows;
					return expected.mediaRows;
				},
			},
		);
		const errors = verifyD1Content({ ...rows, manifest, expectedVisibility: 'draft' });
		assert.ok(errors.some((e) => e.includes('slug mismatch')));
	});

	it('propagates a read failure instead of degrading to zero rows', () => {
		assert.throws(
			() =>
				readVerifyRows('dev', ['a'], {
					select: () => {
						throw new Error('D1 read failed: auth');
					},
				}),
			/D1 read failed: auth/,
		);
	});
});

describe('D1 exact-content verification', () => {
	it('accepts the exact release rows, links and media', () => {
		const manifest = loadManifest(SHIPPED_MANIFEST_PATH);
		const rows = buildExpectedVerificationRows(manifest);
		assert.deepEqual(verifyD1Content({ ...rows, manifest, expectedVisibility: 'draft' }), []);
	});

	it('rejects a slug/content mismatch instead of relying on row count', () => {
		const manifest = loadManifest(SHIPPED_MANIFEST_PATH);
		const rows = buildExpectedVerificationRows(manifest);
		rows.projectRows[0] = { ...rows.projectRows[0], slug: 'wrong-slug' };
		const errors = verifyD1Content({ ...rows, manifest, expectedVisibility: 'draft' });
		assert.ok(errors.some((error) => error.includes('slug mismatch')));
	});

	it('rejects missing expected link/media rows while allowing owner extras', () => {
		const manifest = loadManifest(SHIPPED_MANIFEST_PATH);
		const rows = buildExpectedVerificationRows(manifest);
		const extraLink = {
			id: 'owner-extra',
			project_id: rows.projectRows[0].id,
			kind: 'other',
			label: 'owner',
			url: 'https://example.com',
			display_order: 99,
		};
		assert.deepEqual(
			verifyD1Content({
				...rows,
				linkRows: [...rows.linkRows, extraLink],
				manifest,
				expectedVisibility: 'draft',
			}),
			[],
		);
		const errors = verifyD1Content({
			...rows,
			linkRows: rows.linkRows.slice(1),
			mediaRows: rows.mediaRows.slice(1),
			manifest,
			expectedVisibility: 'draft',
		});
		assert.ok(errors.some((error) => error.includes('expected link missing')));
		assert.ok(errors.some((error) => error.includes('expected media missing')));
	});
});

describe('R2 integrity verification', () => {
	it('accepts exact SHA-256, byte size and Content-Type', () => {
		const body = Buffer.from('release-object');
		const asset = {
			slug: 'sample',
			r2_key: 'portfolio/sample.jpg',
			content_type: 'image/jpeg',
			byte_size: body.byteLength,
			sha256: createHash('sha256').update(body).digest('hex'),
		};
		assert.deepEqual(
			validateR2Evidence(asset, {
				status: 200,
				contentType: 'image/jpeg',
				byteSize: body.byteLength,
				sha256: asset.sha256,
			}),
			[],
		);
	});

	it('fails on remote hash, byte-size or Content-Type mismatch', () => {
		const asset = {
			slug: 'sample',
			r2_key: 'portfolio/sample.jpg',
			content_type: 'image/jpeg',
			byte_size: 10,
			sha256: 'a'.repeat(64),
		};
		const errors = validateR2Evidence(asset, {
			status: 200,
			contentType: 'text/plain',
			byteSize: 9,
			sha256: 'b'.repeat(64),
		});
		assert.ok(errors.some((error) => error.includes('SHA-256')));
		assert.ok(errors.some((error) => error.includes('byte size')));
		assert.ok(errors.some((error) => error.includes('Content-Type')));
	});

	it('hashes the bytes served by the canonical media path', async () => {
		const body = Buffer.from('remote-media');
		const asset = {
			slug: 'sample',
			r2_key: 'portfolio/sample.jpg',
			content_type: 'image/jpeg',
			byte_size: body.byteLength,
			sha256: createHash('sha256').update(body).digest('hex'),
		};
		let requestedUrl = null;
		const evidence = await fetchPublicR2Object(asset, async (url, options) => {
			requestedUrl = url;
			assert.equal(options.method, 'GET');
			return {
				status: 200,
				headers: { get: (name) => (name === 'content-type' ? 'image/jpeg; charset=binary' : null) },
				arrayBuffer: async () => body,
			};
		});
		assert.equal(requestedUrl, 'https://media.rebuildup.dev/portfolio/sample.jpg');
		assert.deepEqual(validateR2Evidence(asset, evidence), []);
	});
});

describe('rollback and verify-state binding', () => {
	it('unpublish only changes visibility; status remains schema-valid', () => {
		const sql = buildUnpublishSql(123);
		assert.match(sql, /visibility='draft'/);
		assert.doesNotMatch(sql, /status='draft'/);
		assert.doesNotMatch(sql, /status=/);
	});

	it('publication context digest changes with manifest content', () => {
		const manifest = loadManifest(SHIPPED_MANIFEST_PATH);
		const baseline = publicationContextDigest(manifest);
		const changed = structuredClone(manifest);
		changed.assets[0].byte_size += 1;
		assert.notEqual(publicationContextDigest(changed), baseline);
	});
});
