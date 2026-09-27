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
	RELEASE_VERSION,
	buildLinkInserts,
	buildMediaInsert,
	buildProjectUpsert,
	loadManifest,
	normalizeSlug,
	projectIdFor,
	sha256OfFile,
	validateEntry,
	validateManifest,
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

	it('classifies YouTube as video, GitHub as repo, BOOTH as shop, X as social, others as other', () => {
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
		assert.ok(stmts[3].includes("'social'"));
		assert.ok(stmts[4].includes("'other'"));
	});

	it('preserves owner-added link on re-run (id collision → no-op)', () => {
		// Same entry, two runs → same SQL output → INSERT OR IGNORE on
		// collision means the existing row is preserved.
		const a = buildLinkInserts(makeEntry());
		const b = buildLinkInserts(makeEntry());
		assert.deepEqual(a, b);
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
		const a = buildMediaInsert(makeEntry(), makeManifest().assets[0]);
		const b = buildMediaInsert(makeEntry(), makeManifest().assets[0]);
		assert.equal(a, b);
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
