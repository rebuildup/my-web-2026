import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	buildMediaId,
	buildMediaSql,
	buildR2Key,
	deriveSlug,
	DELIVERABLE_CONTENT_TYPES,
	findRefRoot,
	formatReport,
	INSERTABLE_CLASSES,
	normalizeTarget,
	parseArgs,
	planMedia,
	portfolioMediaPrefixGuard,
	projectIdForSlug,
	resolveAlt,
	resolveContentType,
	safeFilename,
	selectInsertableProjects,
	sqlLiteral,
} from './migrate-legacy-media.mjs';

/**
 * `migrate-legacy-media.mjs` unit tests (Issue #850).
 *
 * The `--apply` path shells out to the `cf` CLI (R2 PUT + D1 batch), so
 * the pure decision layer is asserted directly instead: what the script
 * plans, which bytes it uploads once, which row it writes, and which
 * row it refuses to write.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The deliverable media types the Worker route actually serves. */
function routerDeliverableTypes() {
	const source = readFileSync(join(repoRoot, 'src/http/media/router.ts'), 'utf8');
	const block = source.match(/const DELIVERABLE_CONTENT_TYPES[^=]*=\s*new Set\(\[(.*?)\]\)/s);
	if (!block) {
		throw new Error(
			'the media router no longer declares DELIVERABLE_CONTENT_TYPES in the expected shape',
		);
	}
	return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/**
 * The normalisation chain of a `deriveSlug` implementation, read from
 * a source file.
 *
 * The text migration calls `main()` at module load, so its slug rule
 * cannot be imported — the media migration keeps its own copy, and this
 * comparison is what keeps the two copies from drifting.
 */
function slugReplaceChain(source) {
	const body = source.match(/function deriveSlug\([^)]*\)\s*\{([\s\S]*?)\n\}/);
	if (!body) throw new Error('the source no longer declares deriveSlug in the expected shape');
	return [...body[1].matchAll(/\.replace\(([^)]*)\)/g)].map((match) =>
		match[1].replace(/\s+/g, ' '),
	);
}

/** One legacy media row, in the shape the planner consumes. */
function media(overrides = {}) {
	return {
		projectId: 'legacy_alpha',
		mediaId: 'media_1',
		filename: 'shot.png',
		mimeType: 'image/png',
		width: null,
		height: null,
		alt: null,
		description: null,
		createdAt: '2025-01-01 00:00:00',
		createdAtMs: 1735689600000,
		sha256: 'a'.repeat(64),
		bytes: 10,
		dbFile: 'content-alpha.db',
		unattributed: false,
		...overrides,
	};
}

/** A project scope, in the shape the planner consumes. */
function projects(entries = [['legacy_alpha', { slug: 'alpha', legacyContentId: 'alpha' }]]) {
	return new Map(entries);
}

describe('parseArgs', () => {
	it('is a dry run unless --apply is given', () => {
		const options = parseArgs([]);
		assert.equal(options.dryRun, true);
		assert.equal(options.apply, false);
		assert.equal(options.target, 'local');
		assert.equal(options.execute, false);
	});

	it('reads --apply, --target, --execute and --source', () => {
		const options = parseArgs(['--apply', '--target=production', '--execute', '--source=/tmp/x']);
		assert.equal(options.apply, true);
		assert.equal(options.dryRun, false);
		assert.equal(options.target, 'production');
		assert.equal(options.execute, true);
		assert.equal(options.source, '/tmp/x');
	});

	it('never treats an omitted flag as an execute', () => {
		assert.equal(parseArgs(['--apply', '--target', 'production']).execute, false);
	});
});

describe('normalizeTarget', () => {
	it('keeps the canonical names', () => {
		assert.equal(normalizeTarget('local'), 'local');
		assert.equal(normalizeTarget('production'), 'production');
	});

	it('normalises the remote alias to production', () => {
		assert.equal(normalizeTarget('remote'), 'production');
	});

	it('refuses any other remote', () => {
		assert.equal(normalizeTarget('staging'), null);
		assert.equal(normalizeTarget(''), null);
	});
});

describe('slug and project id rules', () => {
	it('derives the same slug as the text migration', () => {
		assert.equal(deriveSlug('Homura_02'), 'homura-02');
		assert.equal(deriveSlug('my-web-2025'), 'my-web-2025');
		assert.equal(projectIdForSlug('my-web-2025'), 'legacy_my-web-2025');
	});

	it('refuses an id that cannot become a slug', () => {
		assert.throws(() => deriveSlug('---'), /cannot derive slug/);
	});

	it('uses the same rule as the text migration', () => {
		const textMigration = readFileSync(
			join(repoRoot, 'scripts/migrate-portfolio-from-2025.mjs'),
			'utf8',
		);
		const own = readFileSync(join(repoRoot, 'scripts/migrate-legacy-media.mjs'), 'utf8');
		assert.deepEqual(slugReplaceChain(own), slugReplaceChain(textMigration));
		assert.ok(textMigration.includes('derived slug exceeds 127 chars'));
		assert.ok(own.includes('derived slug exceeds 127 chars'));
	});
});

describe('safeFilename', () => {
	it('keeps ASCII names and their extension', () => {
		assert.equal(safeFilename('shot.png'), 'shot.png');
	});

	it('replaces spaces and non-ASCII characters', () => {
		assert.equal(safeFilename('Web 1920 – 2.png'), 'Web-1920-2.png');
		assert.equal(safeFilename('スクリーンショット 2025-12-13.png'), '2025-12-13.png');
	});

	it('never returns an empty segment', () => {
		assert.equal(safeFilename(''), 'media');
		assert.equal(safeFilename('***'), 'media');
	});

	it('strips path segments', () => {
		assert.equal(safeFilename('../../etc/passwd'), 'passwd');
	});
});

describe('resolveAlt', () => {
	it('prefers the legacy alt', () => {
		assert.equal(resolveAlt({ alt: 'A', description: 'B', filename: 'c.png' }), 'A');
	});

	it('falls back to the description', () => {
		assert.equal(resolveAlt({ alt: '   ', description: 'B', filename: 'c.png' }), 'B');
	});

	it('falls back to the file name without its extension', () => {
		assert.equal(resolveAlt({ alt: null, description: null, filename: 'c.png' }), 'c');
	});

	it('refuses to publish an empty alt', () => {
		assert.equal(resolveAlt({ alt: null, description: '', filename: '' }), null);
	});
});

describe('resolveContentType', () => {
	it('accepts a deliverable type', () => {
		assert.deepEqual(resolveContentType('image/png'), { contentType: 'image/png', reason: null });
	});

	it('normalises the legacy value', () => {
		assert.equal(resolveContentType('IMAGE/PNG; charset=binary').contentType, 'image/png');
	});

	it('fails closed on a missing type', () => {
		assert.equal(resolveContentType('').reason, 'content_type_missing');
		assert.equal(resolveContentType(null).reason, 'content_type_missing');
	});

	it('fails closed on a type the delivery route refuses', () => {
		assert.equal(resolveContentType('image/svg+xml').reason, 'content_type_not_deliverable');
		assert.equal(resolveContentType('text/html').reason, 'content_type_not_deliverable');
	});

	it('mirrors the deliverable list of the media route', () => {
		assert.deepEqual([...DELIVERABLE_CONTENT_TYPES], routerDeliverableTypes());
	});
});

describe('key and row id', () => {
	it('builds the deterministic key', () => {
		assert.equal(
			buildR2Key({
				slug: 'alpha',
				legacyContentId: 'alpha',
				mediaId: 'media_1',
				filename: 'shot.png',
			}),
			'portfolio/alpha/alpha/media_1-shot.png',
		);
	});

	it('builds the deterministic row id', () => {
		assert.equal(buildMediaId('legacy_alpha', 'media_1'), 'legacy_media_legacy_alpha_media_1');
	});

	it('keeps every key inside the public portfolio namespace', () => {
		portfolioMediaPrefixGuard(
			buildR2Key({
				slug: 'alpha',
				legacyContentId: 'alpha',
				mediaId: 'media_1',
				filename: 'shot.png',
			}),
		);
	});
});

describe('selectInsertableProjects', () => {
	const classification = {
		classified: [
			{ id: 'Alpha', migration_class: 'eligible', publication: 'pending_owner' },
			{ id: 'Beta', migration_class: 'rewrite_required', publication: 'pending_owner' },
			{ id: 'Gamma', migration_class: 'mechanical_drop', publication: 'pending_owner' },
			{ id: 'Delta', migration_class: 'new_candidate', publication: 'pending_owner' },
			{ id: 'Epsilon', migration_class: 'eligible', publication: 'rejected' },
		],
	};

	it('keeps only the classes the text migration inserts', () => {
		const selected = selectInsertableProjects(classification, { publication_overrides: [] });
		assert.deepEqual([...selected.keys()].sort(), ['legacy_alpha', 'legacy_beta']);
	});

	it('never inserts a rejected item', () => {
		const selected = selectInsertableProjects(classification, { publication_overrides: [] });
		assert.equal(selected.has('legacy_epsilon'), false);
	});

	it('honours an owner publication override', () => {
		const selected = selectInsertableProjects(classification, {
			publication_overrides: [{ legacy_id: 'Alpha', publication: 'rejected' }],
		});
		assert.equal(selected.has('legacy_alpha'), false);
		assert.equal(selected.has('legacy_beta'), true);
	});

	it('names the insertable classes it accepts', () => {
		assert.deepEqual([...INSERTABLE_CLASSES], ['eligible', 'rewrite_required']);
	});
});

describe('planMedia', () => {
	it('creates one row per media row and one upload per distinct bytes', () => {
		const plan = planMedia({
			mediaRows: [
				media({ mediaId: 'media_1', sha256: 'a'.repeat(64) }),
				media({ mediaId: 'media_2', sha256: 'a'.repeat(64) }),
				media({ mediaId: 'media_3', sha256: 'b'.repeat(64) }),
			],
			projects: projects(),
		});
		assert.equal(plan.rows.length, 3);
		assert.equal(plan.uploads.length, 2);
		assert.equal(plan.rows[0].r2Key, plan.rows[1].r2Key);
		assert.notEqual(plan.rows[0].r2Key, plan.rows[2].r2Key);
	});

	it('uploads the same bytes separately in two projects', () => {
		const plan = planMedia({
			mediaRows: [
				media({ mediaId: 'media_1', sha256: 'a'.repeat(64) }),
				media({ projectId: 'legacy_beta', mediaId: 'media_2', sha256: 'a'.repeat(64) }),
			],
			projects: projects([
				['legacy_alpha', { slug: 'alpha', legacyContentId: 'alpha' }],
				['legacy_beta', { slug: 'beta', legacyContentId: 'beta' }],
			]),
		});
		assert.equal(plan.rows.length, 2);
		assert.equal(plan.uploads.length, 2);
	});

	it('marks exactly one cover per project, on the first row', () => {
		const plan = planMedia({
			mediaRows: [
				media({ mediaId: 'media_2', createdAt: '2025-02-01 00:00:00' }),
				media({ mediaId: 'media_1', createdAt: '2025-01-01 00:00:00' }),
			],
			projects: projects(),
		});
		assert.equal(plan.rows.length, 2);
		assert.equal(plan.rows[0].mediaId, 'media_1');
		assert.equal(plan.rows[0].isCover, 1);
		assert.equal(plan.rows[1].isCover, 0);
		assert.deepEqual(
			plan.rows.map((row) => row.displayOrder),
			[0, 1],
		);
	});

	it('counts a row whose project is not migrated', () => {
		const plan = planMedia({
			mediaRows: [media({ projectId: 'legacy_missing' })],
			projects: projects(),
		});
		assert.equal(plan.rows.length, 0);
		assert.deepEqual(plan.skips, { project_not_migrated: 1 });
	});

	it('counts a row whose type is not deliverable', () => {
		const plan = planMedia({
			mediaRows: [media({ mimeType: 'image/svg+xml' })],
			projects: projects(),
		});
		assert.equal(plan.rows.length, 0);
		assert.deepEqual(plan.skips, { content_type_not_deliverable: 1 });
	});

	it('counts a row whose alt cannot be composed', () => {
		const plan = planMedia({
			mediaRows: [media({ alt: null, description: null, filename: '' })],
			projects: projects(),
		});
		assert.equal(plan.rows.length, 0);
		assert.deepEqual(plan.skips, { alt_unavailable: 1 });
	});

	it('counts a row that belongs to no content', () => {
		const plan = planMedia({
			mediaRows: [media({ projectId: null, unattributed: true })],
			projects: projects(),
		});
		assert.equal(plan.rows.length, 0);
		assert.deepEqual(plan.skips, { project_unattributable: 1 });
	});

	it('counts a row whose key the visibility boundary refuses', () => {
		const plan = planMedia({
			mediaRows: [media({ filename: 'a..b.png' })],
			projects: projects(),
		});
		assert.equal(plan.rows.length, 0);
		assert.deepEqual(plan.skips, { key_not_publishable: 1 });
	});
});

describe('buildMediaSql', () => {
	it('releases the previous cover before the new one is written', () => {
		const statements = buildMediaSql([
			{
				id: 'legacy_media_legacy_alpha_media_1',
				projectId: 'legacy_alpha',
				r2Key: 'portfolio/alpha/alpha/media_1-shot.png',
				contentType: 'image/png',
				width: null,
				height: null,
				alt: 'shot',
				caption: null,
				isCover: 1,
				displayOrder: 0,
				createdAt: 0,
			},
		]);
		assert.match(
			statements[0],
			/^UPDATE portfolio_media SET is_cover = 0 WHERE project_id = 'legacy_alpha'/,
		);
		assert.match(statements[1], /^INSERT INTO portfolio_media /);
		assert.match(statements[1], /ON CONFLICT\(id\) DO UPDATE SET/);
	});

	it('escapes a quote in the alt text', () => {
		const statements = buildMediaSql([
			{
				id: 'legacy_media_legacy_alpha_media_1',
				projectId: 'legacy_alpha',
				r2Key: 'portfolio/alpha/alpha/media_1-shot.png',
				contentType: 'image/png',
				width: null,
				height: null,
				alt: "it's a shot",
				caption: null,
				isCover: 1,
				displayOrder: 0,
				createdAt: 0,
			},
		]);
		assert.ok(statements[1].includes("'it''s a shot'"));
	});

	it('escapes a SQL literal', () => {
		assert.equal(sqlLiteral(null), 'NULL');
		assert.equal(sqlLiteral("a'b"), "'a''b'");
	});
});

describe('report', () => {
	it('reports counts only', () => {
		const report = formatReport({
			corpus: {
				databases: 151,
				rows: 297,
				bytes: 114953553,
				uniqueSha: new Set(['a']),
				attributedFromDatabase: 25,
			},
			plan: { rows: [1], uploads: [1], skips: { project_not_migrated: 166 } },
			projects: new Map([['legacy_alpha', {}]]),
			applied: false,
			target: 'local',
		});
		assert.match(report, /media rows\s+297 \(114953553 bytes\)/);
		assert.match(report, /project_not_migrated=166/);
		assert.ok(!report.includes('data:'));
	});
});

describe('findRefRoot', () => {
	it('returns null when the corpus is not there', () => {
		assert.equal(findRefRoot('/tmp', '/tmp'), null);
	});
});
