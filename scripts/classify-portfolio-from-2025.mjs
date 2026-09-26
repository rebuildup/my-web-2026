#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
/**
 * Classification — my-web-2025 portfolio DBs (Issue #78).
 *
 * Usage:
 *   node scripts/classify-portfolio-from-2025.mjs [--output=dir]
 *
 * Default output dir: `docs/migration/`
 *
 * Two-axis schema (Issue #78 cycle 3 semantic hardening):
 *
 *   migration_class — technical eligibility of the legacy row:
 *     `eligible`           published+public+rich legacy content
 *     `rewrite_required`   published+public but narrative/media thin
 *     `mechanical_drop`    placeholder / test / corrupt rows
 *     `new_candidate`      NEW proposal (id only, no legacy DB row)
 *
 *   publication — owner selection authority:
 *     `approved`        owner has signed off for public surface
 *     `pending_owner`   default; loader sees `visibility = 'draft'`
 *     `rejected`        owner has explicitly declined (not surfaced)
 *
 * Crucially, `migration_class = 'eligible'` does NOT imply
 * `publication = 'approved'`. The 43 mechanically-eligible rows
 * are all `pending_owner` until the owner signs each one off via
 * `docs/migration/portfolio-2025-role-overrides.json#publication_overrides`.
 *
 * Output files (overwritten):
 *   - portfolio-2025-to-2026-classification.json — machine-readable
 *   - portfolio-2025-to-2026-classification.csv  — 151-row table
 *   - portfolio-2025-to-2026-classification.md   — human-readable summary
 *   - portfolio-2025-owner-review.md             — owner decision surface
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = new Set(process.argv.slice(2));
const outputDir = parseArg(args, '--output') ?? join(root, 'docs/migration');

const NODE_VERSION = Number.parseInt(process.versions.node.split('.')[0], 10);
if (NODE_VERSION < 22) {
	console.error(
		`[classify] node:sqlite requires Node ≥ 22; this environment is ${process.versions.node}.`,
	);
	process.exit(2);
}

const PORTFOLIO_FACETS = new Set(['develop', 'video', 'design', 'other']);
const VIDEO_HOSTS = [
	'youtu.be',
	'youtube.com',
	'youtube-nocookie.com',
	'vimeo.com',
	'nicovideo.jp',
];

/**
 * Heading keyword → schema section mapping. Conservative: a legacy
 * heading is mapped to a schema section ONLY when it explicitly uses
 * the keyword below. Anything else stays blank — `motivation_md` is
 * NOT a catch-all (Issue #78 blocker #3).
 *
 * Note: `\b` does NOT work as a word boundary for non-ASCII chars
 * (e.g. Japanese `動機`), so we use a `\s|$` lookahead instead.
 */
const HEADING_TO_SECTION = [
	{
		section: 'motivation_md',
		patterns: [/^#{1,3}\s*(動機|モチベーション|why|motivation)(?=\s|$)/i],
	},
	{
		section: 'architecture_md',
		patterns: [/^#{1,3}\s*(アーキテクチャ|architecture|設計)(?=\s|$)/i],
	},
	{
		section: 'constraints_md',
		patterns: [/^#{1,3}\s*(制約|constraints|constraint)(?=\s|$)/i],
	},
	{
		section: 'implementation_md',
		patterns: [/^#{1,3}\s*(実装|implementation|開発記録)(?=\s|$)/i],
	},
	{
		section: 'evidence_md',
		patterns: [/^#{1,3}\s*(証拠|エビデンス|evidence|result|結果)(?=\s|$)/i],
	},
	{
		section: 'retrospective_md',
		patterns: [/^#{1,3}\s*(振り返り|レトロスペクティブ|retrospective)(?=\s|$)/i],
	},
];

function parseArg(set, name) {
	for (const a of set) {
		if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
	}
	return null;
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
	console.error(`[classify] cannot locate .reference/my-web-2025; looked upward from ${startDir}.`);
	process.exit(2);
}

function classifyAsset(src) {
	if (!src) return { kind: 'unknown', reason: 'empty src' };
	try {
		const u = new URL(src);
		const host = u.hostname.toLowerCase();
		for (const vh of VIDEO_HOSTS) {
			if (host === vh || host.endsWith(`.${vh}`)) return { kind: 'external_video' };
		}
		if (u.protocol === 'http:' || u.protocol === 'https:') return { kind: 'external_other' };
		return { kind: 'unknown', reason: `non-http(s) protocol ${u.protocol}` };
	} catch {
		return { kind: 'local_file', reason: 'unparseable URL, treating as local path' };
	}
}

function deriveSlug(legacyId) {
	return legacyId
		.toLowerCase()
		.replace(/_/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

/** Conservative: a legacy heading is mapped to a schema section only on explicit keyword match. */
function availableSectionsFromMarkdown(body) {
	if (!body) return [];
	const found = new Set();
	for (const line of body.split('\n')) {
		for (const m of HEADING_TO_SECTION) {
			if (m.patterns.some((p) => p.test(line.trim()))) found.add(m.section);
		}
	}
	return [...found];
}

function readLegacyRow(dbPath) {
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

		const links = db.prepare('SELECT href FROM content_links WHERE content_id = ?').all(main.id);
		const linkCount = links.length;

		const assets = db.prepare('SELECT src FROM content_assets WHERE content_id = ?').all(main.id);
		const assetClasses = assets.map((a) => classifyAsset(a.src));
		const externalVideoCount = assetClasses.filter((c) => c.kind === 'external_video').length;
		const localFileCount = assetClasses.filter((c) => c.kind === 'local_file').length;
		const otherAssetCount = assetClasses.filter(
			(c) => c.kind === 'external_other' || c.kind === 'unknown',
		).length;

		const markdownRow = db
			.prepare('SELECT body FROM markdown_pages WHERE content_id = ? LIMIT 1')
			.get(main.id);

		return {
			legacyId: main.id,
			title: main.title ?? '',
			summary: main.summary ?? '',
			visibility: main.visibility ?? 'draft',
			status: main.status ?? 'draft',
			publishedAt: main.published_at,
			createdAt: main.created_at,
			updatedAt: main.updated_at,
			facets,
			technologies,
			linkCount,
			externalVideoCount,
			localFileCount,
			otherAssetCount,
			markdownCount: markdownRow ? 1 : 0,
			markdownBody: markdownRow?.body ?? '',
		};
	} finally {
		db.close();
	}
}

/**
 * migration_class — derived from raw legacy metadata only.
 * This is mechanical and agent-deterministic. No inference from
 * facet/title; only structural facts.
 */
function deriveMigrationClass(row) {
	if (row.error) return 'mechanical_drop';
	const isTestId = /^test-/i.test(row.legacyId);
	const isMediaScaffold = /^(media-list|media-rt)-/.test(row.legacyId);
	const isPlaceholder =
		row.status === 'draft' &&
		row.linkCount === 0 &&
		(row.markdownCount === 0 || row.markdownBody.trim() === '');
	const hasRichContent =
		row.status === 'published' &&
		row.visibility === 'public' &&
		row.markdownCount >= 1 &&
		row.linkCount >= 1 &&
		row.title.trim() !== '';
	const hasPublicButThin =
		row.status === 'published' &&
		row.visibility === 'public' &&
		row.markdownCount >= 1 &&
		(row.linkCount < 1 || row.title.trim() === '');

	if (isTestId || isMediaScaffold || isPlaceholder) return 'mechanical_drop';
	if (hasRichContent) return 'eligible';
	if (hasPublicButThin) return 'rewrite_required';
	// Anything else (status=draft with content, or published+unlisted+content) is
	// rewrite_required at best; we surface it for owner decision.
	if (row.markdownCount >= 1) return 'rewrite_required';
	return 'mechanical_drop';
}

/**
 * publication_blockers — list of strings the owner must clear
 * before publication is approved. The migration reads this list
 * and emits `visibility = 'draft'` rows when any blocker remains.
 */
function derivePublicationBlockers(row, role) {
	const blockers = [];
	if (!role) blockers.push('role_missing');
	if (row.externalVideoCount === 0 && row.localFileCount === 0) blockers.push('media_missing');
	if (row.markdownCount === 0) blockers.push('narrative_missing');
	// No available schema sections means no meaningful narrative for
	// representative-project publication gate.
	const sections = availableSectionsFromMarkdown(row.markdownBody);
	if (sections.length === 0) blockers.push('no_mappable_section');
	return blockers;
}

function main() {
	const refRoot = process.env.MY_WEB_2025_REF
		? resolve(process.env.MY_WEB_2025_REF)
		: findRefRoot(root);

	const roleOverridePath = join(root, 'docs/migration/portfolio-2025-role-overrides.json');
	if (!existsSync(roleOverridePath)) {
		console.error(`[classify] role override file missing: ${roleOverridePath}`);
		process.exit(1);
	}
	const roleFile = JSON.parse(readFileSync(roleOverridePath, 'utf8'));
	const roleByLegacyId = new Map((roleFile.role_overrides ?? []).map((r) => [r.legacy_id, r.role]));
	const publicationByLegacyId = new Map(
		(roleFile.publication_overrides ?? []).map((r) => [r.legacy_id, r.publication]),
	);

	const contentsDir = join(refRoot, 'data/contents');
	const dbFiles = readdirSyncSync(contentsDir).filter(
		(f) => f.startsWith('content-') && f.endsWith('.db'),
	);

	const classified = [];
	const newCandidates = [
		{
			id: 'my-web-2026-foundation',
			title: 'my-web-2026 Foundation release',
			note: 'release-by-release candidate',
		},
		{
			id: 'my-web-2026-content',
			title: 'my-web-2026 Content release',
			note: 'release-by-release candidate',
		},
		{
			id: 'my-web-2026-home',
			title: 'my-web-2026 Home release',
			note: 'release-by-release candidate',
		},
		{
			id: 'my-web-2026-platform',
			title: 'my-web-2026 Platform release',
			note: 'release-by-release candidate',
		},
		{ id: 'tastile', title: 'Tastile (NEW)', note: 'verify availability' },
		{ id: 'ido-bata', title: 'Ido-bata (NEW)', note: 'verify availability' },
		{
			id: 'internship-sciencearts',
			title: 'ScienceArts internship (NEW)',
			note: 'NDA check required',
		},
		{ id: 'internship-optim', title: 'OPTiM internship (NEW)', note: 'NDA check required' },
	];
	for (const nc of newCandidates) {
		classified.push({
			id: nc.id,
			db: null,
			title: nc.title,
			summary: null,
			published_at: null,
			tags: [],
			asset_count: 0,
			link_count: 0,
			markdown_count: 0,
			migration_class: 'new_candidate',
			publication: 'pending_owner',
			publication_blockers: [
				'role_missing',
				'media_missing',
				'narrative_missing',
				'no_mappable_section',
			],
			available_sections: [],
			role: null,
			role_source: null,
			note: nc.note,
		});
	}

	for (const f of dbFiles) {
		const source = readLegacyRow(join(contentsDir, f));
		const migration_class = deriveMigrationClass(source);
		const role = roleByLegacyId.get(source.legacyId) ?? null;
		const publication = publicationByLegacyId.get(source.legacyId) ?? 'pending_owner';
		const available_sections = availableSectionsFromMarkdown(source.markdownBody);
		const publication_blockers =
			migration_class === 'mechanical_drop' ? [] : derivePublicationBlockers(source, role);

		classified.push({
			db: f,
			id: source.legacyId ?? basename(f, extname(f)).replace(/^content-/, ''),
			title: source.title,
			summary: source.summary,
			visibility: source.visibility,
			status: source.status,
			published_at: source.published_at,
			updated_at: source.updated_at,
			tags: [...(source.facets ?? []), ...(source.technologies ?? [])],
			facets: source.facets ?? [],
			technologies: source.technologies ?? [],
			link_count: source.linkCount ?? 0,
			external_video_count: source.externalVideoCount ?? 0,
			local_file_count: source.localFileCount ?? 0,
			other_asset_count: source.otherAssetCount ?? 0,
			markdown_count: source.markdownCount ?? 0,
			migration_class,
			publication: migration_class === 'mechanical_drop' ? null : publication,
			publication_blockers,
			available_sections,
			role,
			role_source: role ? 'role_overrides' : null,
		});
	}

	// Bucket counts for the header.
	const buckets = {};
	for (const r of classified) {
		const key = `${r.migration_class} / ${r.publication}`;
		buckets[key] = (buckets[key] ?? 0) + 1;
	}

	const out = {
		generated_at: new Date().toISOString(),
		schema: {
			migration_class: ['eligible', 'rewrite_required', 'mechanical_drop', 'new_candidate'],
			publication: ['approved', 'pending_owner', 'rejected'],
		},
		bucket_counts: buckets,
		total: classified.length,
		classified,
	};

	// JSON — biome wants alphabetical key order + tab indent +
	// single-line short arrays. We write a stable-keys JSON with
	// tab indent, then delegate the final whitespace / array layout
	// to `biome format` so the file matches the project's lint
	// expectations exactly.
	const jsonPath = join(outputDir, 'portfolio-2025-to-2026-classification.json');
	writeFileSync(jsonPath, `${JSON.stringify(sortKeys(out), null, '\t')}\n`);
	const biomeResult = spawnSync('pnpm', ['exec', 'biome', 'format', '--write', jsonPath], {
		cwd: root,
		encoding: 'utf8',
	});
	if (biomeResult.status !== 0) {
		console.error('[classify] biome format post-process failed (file still valid JSON):');
		console.error(biomeResult.stderr);
	}

	function sortKeys(value) {
		if (Array.isArray(value)) return value.map(sortKeys);
		if (value && typeof value === 'object') {
			const sorted = {};
			for (const k of Object.keys(value).sort()) sorted[k] = sortKeys(value[k]);
			return sorted;
		}
		return value;
	}

	// CSV
	const csvColumns = [
		'db',
		'id',
		'title',
		'migration_class',
		'publication',
		'role',
		'publication_blockers',
		'facets',
		'link_count',
		'external_video_count',
		'markdown_count',
		'available_sections',
		'published_at',
	];
	const csvLines = [csvColumns.join(',')];
	for (const r of classified) {
		const row = csvColumns.map((c) => {
			const v = r[c];
			if (v === null || v === undefined) return '';
			const s = Array.isArray(v) ? v.join('|') : String(v);
			// Quote anything with comma / quote / newline.
			return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
		});
		csvLines.push(row.join(','));
	}
	writeFileSync(
		join(outputDir, 'portfolio-2025-to-2026-classification.csv'),
		`${csvLines.join('\n')}\n`,
	);

	// MD summary
	const eligiblePending = classified.filter(
		(r) => r.migration_class === 'eligible' && r.publication === 'pending_owner',
	);
	const eligibleApproved = classified.filter(
		(r) => r.migration_class === 'eligible' && r.publication === 'approved',
	);
	const rewritePending = classified.filter(
		(r) => r.migration_class === 'rewrite_required' && r.publication === 'pending_owner',
	);
	const mechanicalDrop = classified.filter((r) => r.migration_class === 'mechanical_drop');
	const newPending = classified.filter((r) => r.migration_class === 'new_candidate');
	const totalInsertable = eligiblePending.length + eligibleApproved.length + rewritePending.length;

	const md = `# Portfolio 2025 → 2026 classification (Issue #78, cycle 3)

Two-axis classification. \`migration_class\` is technical eligibility
(mechanical, agent-deterministic); \`publication\` is owner selection
authority (only owner-approves rows become \`public\` on the loader).

| bucket | count |
| --- | --- |
| eligible / pending_owner  | ${eligiblePending.length} |
| eligible / approved (owner-signed-off) | ${eligibleApproved.length} |
| rewrite_required / pending_owner | ${rewritePending.length} |
| mechanical_drop (never inserted) | ${mechanicalDrop.length} |
| new_candidate (never auto-inserted) | ${newPending.length} |
| **total** | **${classified.length}** |
| **insertable** (eligible + rewrite_required) | **${totalInsertable}** |

## Publication blockers (eligible + rewrite_required only)

| blocker | meaning | count |
| --- | --- | --- |
| role_missing | \`role\` not in \`role_overrides\`; owner must add | ${classified.filter((r) => (r.migration_class === 'eligible' || r.migration_class === 'rewrite_required') && r.publication_blockers.includes('role_missing')).length} |
| media_missing | no \`content_assets\` rows; needs R2 upload before publication | ${classified.filter((r) => (r.migration_class === 'eligible' || r.migration_class === 'rewrite_required') && r.publication_blockers.includes('media_missing')).length} |
| narrative_missing | legacy markdown is empty | ${classified.filter((r) => (r.migration_class === 'eligible' || r.migration_class === 'rewrite_required') && r.publication_blockers.includes('narrative_missing')).length} |
| no_mappable_section | legacy markdown has no heading matching motivation/architecture/etc. | ${classified.filter((r) => (r.migration_class === 'eligible' || r.migration_class === 'rewrite_required') && r.publication_blockers.includes('no_mappable_section')).length} |

## Why no semantic fabrication

- \`role\` is set ONLY when \`docs/personal/domain.md\` (or comparable
  repository-grounded source) explicitly names the legacy \`id\` and
  the contribution context. Heuristic inference from facet or title
  is forbidden (AGENTS.md §3 + Issue #78 blocker #2).
- \`motivation_md\` / \`architecture_md\` / etc. are populated only
  when a legacy markdown heading explicitly matches one of the
  \`HEADING_TO_SECTION\` keywords. The schema sections are not a
  catch-all (Issue #78 blocker #3).
- \`media\` requires an actual \`portfolio_media\` row; YouTube URLs
  are \`portfolio_link\` with \`kind = 'video'\`. \`media_count >= 1\`
  for \`public+published\` rows is a hard verifier check
  (Issue #78 blocker #5).
- \`${eligiblePending.length + rewritePending.length}\` insertable rows are
  \`pending_owner\` by default; the migration writes them with
  \`visibility = 'draft'\` so the public loader never sees them
  until the owner signs off (Issue #78 blocker #1 + #4). The
  \`${eligibleApproved.length}\` owner-signed-off rows become
  \`visibility = 'public'\`, but still must satisfy \`media_count >= 1\`
  per the verifier.

## Files

- [\`portfolio-2025-to-2026-classification.json\`](./portfolio-2025-to-2026-classification.json) — machine-readable
- [\`portfolio-2025-to-2026-classification.csv\`](./portfolio-2025-to-2026-classification.csv) — 159-row table
- [\`portfolio-2025-role-overrides.json\`](./portfolio-2025-role-overrides.json) — role / publication owner-overrides
- [\`portfolio-2025-owner-review.md\`](./portfolio-2025-owner-review.md) — owner decision surface
`;

	writeFileSync(join(outputDir, 'portfolio-2025-to-2026-classification.md'), md);

	// Owner-review surface — every eligible + rewrite_required row,
	// grouped by blocker, so the owner can see "everything missing role"
	// as a single list.
	const ownerRows = classified.filter(
		(r) => r.migration_class === 'eligible' || r.migration_class === 'rewrite_required',
	);
	const grouped = new Map();
	for (const r of ownerRows) {
		for (const blocker of r.publication_blockers) {
			if (!grouped.has(blocker)) grouped.set(blocker, []);
			grouped.get(blocker).push(r);
		}
	}
	const ownerMd = `# Portfolio owner review (Issue #78)

This is the decision surface. Each row below is a legacy portfolio entry
that is technically eligible for migration but blocked on at least one
publication criterion. Owner approves / rewrites / rejects — the
migration script + verifier reflect that sign-off without changing the
classification script.

## How to approve a row

Edit \`docs/migration/portfolio-2025-role-overrides.json\`:

- add a \`publication_overrides\` entry for the \`legacy_id\`,
- set \`publication: "approved"\` and \`publication_visibility: "public"\`,
- if the row's role is not yet grounded, also add a \`role_overrides\`
  entry with the source citation,
- re-run \`scripts/migrate-portfolio-from-2025.mjs --apply --target=local\`.

## How to reject a row

Set \`publication: "rejected"\` in the override file. The migration
script skips the row entirely.

## Mechanical-drop rows (no owner action required)

${mechanicalDrop.length} rows fall into \`mechanical_drop\` and are
NEVER inserted. Most are \`media-list-*\` / \`media-rt-*\` UUID-named
CMS scaffold rows (empty summary / tags / assets / links / markdown)
or \`test-otu-*\` periodic status posts.

## Eligible + blocked (mechanical eligibility, owner authority pending)

${ownerRows.length} rows fall in this surface. Grouped by blocker:

${[...grouped.entries()]
	.map(([blocker, rows]) => {
		const header = `### \`${blocker}\` (${rows.length})\n\n`;
		const tableHeader =
			'| legacy id | title | migration_class | publication | role | publication_blockers | link_count | external_video | markdown | available_sections |\n';
		const tableSep = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n';
		const tableRows = rows
			.map(
				(r) =>
					`| \`${r.id}\` | ${(r.title ?? '').slice(0, 60)} | ${r.migration_class} | ${r.publication} | ${r.role ?? '∅'} | ${(r.publication_blockers ?? []).join(', ')} | ${r.link_count} | ${r.external_video_count} | ${r.markdown_count} | ${(r.available_sections ?? []).join(', ')} |`,
			)
			.join('\n');
		return `${header}${tableHeader}${tableSep}${tableRows}`;
	})
	.join('\n\n')}


## New candidates (no legacy DB row)

${newPending.length} entries are \`new_candidate\`. They are NOT in
\`data/contents/\`; each must be added by the owner with a fully
grounded narrative (motivation / architecture / evidence / retrospective)
+ media + role before publication is approved.

${newPending.map((r) => `- \`${r.id}\` — ${r.title} — ${r.note}`).join('\n')}
`;

	writeFileSync(join(outputDir, 'portfolio-2025-owner-review.md'), ownerMd);

	console.log('[classify] generated:');
	console.log(`  - portfolio-2025-to-2026-classification.json (${classified.length} rows)`);
	console.log('  - portfolio-2025-to-2026-classification.csv');
	console.log('  - portfolio-2025-to-2026-classification.md');
	console.log('  - portfolio-2025-owner-review.md');
	console.log('[classify] bucket counts:');
	for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v}`);
}

function readdirSyncSync(p) {
	return readdirSync(p);
}

main();
