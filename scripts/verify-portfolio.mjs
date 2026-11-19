#!/usr/bin/env node
/**
 * Completeness verifier — my-web-2026 portfolio (D1 + CMS snapshot).
 *
 * Usage:
 *   node scripts/verify-portfolio.mjs [--target=local|production] [--strict-content]
 *
 * TWO contracts are verified separately (Issue #1008). They are NOT the
 * same contract and conflating them is what let #1008 hide:
 *
 *   A. STORAGE contract — the D1 rows themselves. D1 owns identity
 *      (slug / title / summary / period / visibility / ordering /
 *      evidence status), so a public row MUST carry those fields, and
 *      its `role` column must never hold a facet-derived kind label
 *      (Issue #813 — such a value is not a recorded role).
 *
 *   B. PUBLIC contract — what `/portfolio` and `/portfolio/<slug>`
 *      actually render, i.e. the D1 row AFTER `mergeCmsAuthoring`
 *      with the committed Notion snapshot (ADR-0018 §2.7/§2.11). The
 *      merge runs the SAME `src/portfolio/cms-merge.ts` code the
 *      Worker runs — this script does not restate the rules. The
 *      #78-era acceptance fields are checked here: title / summary /
 *      period_start, a legal role, ≥1 link, ≥1 media.
 *
 *      `role` EMPTY IS LEGAL (Issue #813): most works have no recorded
 *      person role, and a facet-derived label must never be printed.
 *      Links and media are CONTENT completeness, not a publication
 *      gate (ADR-0019: the owner publishes the works that exist): a
 *      public project with none is reported under "content gaps" with
 *      the slug list every run, and fails the run only under
 *      `--strict-content` (release-freeze QA).
 *
 * What it asserts:
 *
 *   STORAGE (D1):
 *   1. Every public row has non-empty title, summary, non-zero
 *      period_start — identity fields the merge cannot supply.
 *   2. No public row's `role` is a facet-kind label
 *      (`kind-labels.ts`) — a stored derived value would print under
 *      `Role` for any slug the CMS does not cover.
 *
 *   PUBLIC (merged view):
 *   3. Same identity fields, plus: a printed `role` is never a
 *      facet-kind label (the CMS projection suppresses them; a D1
 *      value can still leak through when the CMS role is empty).
 *   4. Content gaps: merged links = 0 or merged media = 0, reported
 *      per slug. Non-blocking unless `--strict-content`.
 *
 *   WELL-FORMEDNESS (unchanged, both stores where applicable):
 *   5. At most one `is_cover = 1` media row per project.
 *   6. Every `portfolio_link.url` is a valid http(s) URL; every
 *      `kind` is in the closed enum.
 *   7. Every `facets` JSON array is a subset of `PORTFOLIO_FACETS`.
 *   8. Every slug matches the slug grammar; every `legacy_*` id is
 *      deterministic.
 *   9. Every public+published D1 media row has non-empty `alt` and an
 *      `r2_key` matching the `<bucket>/<key>` grammar.
 *
 * Output:
 *   * exit 0 — no contract violations (content gaps may be reported).
 *   * exit 1 — at least one violation, or `--strict-content` with gaps.
 *   * exit 2 — bad usage / unreadable input.
 *
 * Reads D1 through the repository's shared `_d1.mjs` driver, the same
 * surface the seed scripts and the migration path use, so the local and
 * production read surfaces are identical and neither can bypass the
 * canonical identity check.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryRows } from './_d1.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = new Set(process.argv.slice(2));
const target = parseArg(args, '--target') ?? 'local';
const strictContent = args.has('--strict-content');
// 'production', never 'remote': the only remote database is production,
// so naming it states the scope instead of hiding it behind a transport
// detail. This matches `_d1.mjs#resolveTarget`.
if (target !== 'local' && target !== 'production') {
	console.error(`--target must be 'local' or 'production', got: ${target}`);
	process.exit(2);
}

// The SAME modules the Worker bundle runs. `publish.ts` projects the
// snapshot records (publication predicate + role suppression),
// `cms-merge.ts` is the field merge `load.ts` applies, and
// `kind-labels.ts` owns the derived-role vocabulary. All three are
// leaf-safe under Node's type stripping (type-only or `.ts`-explicit
// imports), which is why the verifier cannot drift from the runtime.
const { publicProjects } = await import('../src/portfolio/notion/publish.ts');
const { mergeCmsAuthoring } = await import('../src/portfolio/cms-merge.ts');
const { isFacetDerivedRole } = await import('../src/portfolio/kind-labels.ts');

const snapshotDocument = JSON.parse(
	readFileSync(resolve(root, 'src/portfolio/notion/generated/snapshot.json'), 'utf8'),
);
// `publicProjects` reads only `records`; the rest of the envelope is the
// snapshot contract the Worker already validated at build time.
const cmsProjects = publicProjects({ records: snapshotDocument.records });
const cmsBySlug = new Map(cmsProjects.map((project) => [project.slug, project]));

const PORTFOLIO_FACETS = new Set(['develop', 'video', 'design', 'other']);
const PORTFOLIO_LINK_KINDS = new Set([
	'repo',
	'demo',
	'release',
	'article',
	'shop',
	'video',
	'other',
]);
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;

function parseArg(set, name) {
	for (const a of set) {
		if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
	}
	return null;
}

/**
 * Query D1 and return normalised object rows.
 *
 * Issue #247: through `_d1.mjs`, so this shares the canonical database
 * ID, the canonical local persistence path, and — for a production
 * read — the D1-scoped credential. The previous hand-rolled parser
 * shelled out to `wrangler d1 execute --remote`, which bypassed the
 * repository's read identity check entirely and used whichever token
 * the ambient environment happened to carry.
 */
function d1Query(sql) {
	return queryRows(sql, { target });
}

const checks = [];
const contentGaps = [];

function check(name, fn) {
	const failures = [];
	try {
		fn(failures);
	} catch (err) {
		failures.push(`unexpected error: ${err.message}`);
	}
	checks.push({ name, failures });
}

/**
 * Load the public D1 rows plus their links / media once, then build
 * the merged public view with the SAME `mergeCmsAuthoring` the loader
 * runs. Returns `{ storage, publicView }`:
 *
 *   storage   — one entry per public D1 row (raw stored fields)
 *   publicView— one entry per publicly reachable project: the merged
 *               D1 row, or the CMS-only project when D1 does not hold
 *               the slug (the loader's collision rule, mirrored).
 */
function loadPublicSurface() {
	const rows = d1Query(
		`SELECT * FROM portfolio_project WHERE status = 'published' AND visibility = 'public'`,
	);
	if (rows.length === 0) return { storage: [], publicView: [...cmsProjects] };
	const ids = rows.map((row) => row.id);
	// `queryRows` takes SQL text only — ids are inlined, quote-escaped.
	const idList = ids.map((id) => `'${String(id).replaceAll("'", "''")}'`).join(', ');
	const linkRows = d1Query(
		`SELECT project_id, kind, label, url, display_order FROM portfolio_link
		 WHERE project_id IN (${idList}) ORDER BY project_id ASC, display_order ASC`,
	).map((row) => ({
		id: `${row.project_id}:${row.display_order}`,
		kind: row.kind,
		label: row.label,
		url: row.url,
		displayOrder: row.display_order,
	}));
	const mediaRows = d1Query(
		`SELECT project_id, r2_key FROM portfolio_media
		 WHERE project_id IN (${idList})`,
	).map((row) => ({ r2Key: row.r2_key }));
	const linksByProject = new Map();
	for (const link of linkRows) {
		const list = linksByProject.get(link.project_id) ?? [];
		list.push(link);
		linksByProject.set(link.project_id, list);
	}
	const mediaByProject = new Map();
	for (const media of mediaRows) {
		const list = mediaByProject.get(media.project_id) ?? [];
		list.push(media);
		mediaByProject.set(media.project_id, list);
	}

	const storage = [];
	const publicView = [];
	const d1Slugs = new Set();
	for (const row of rows) {
		d1Slugs.add(row.slug);
		// The subset of `PortfolioProject` the merge and the checks read.
		// `rowToProject`'s '' → null role rule is applied here so the
		// merged view sees what the loader would produce.
		const d1View = {
			slug: row.slug,
			title: row.title,
			summary: row.summary,
			role: row.role === '' ? null : row.role,
			periodStart: row.period_start,
			motivationMd: row.motivation_md,
			architectureMd: row.architecture_md,
			constraintsMd: row.constraints_md,
			implementationMd: row.implementation_md,
			evidenceMd: row.evidence_md,
			retrospectiveMd: row.retrospective_md,
			links: linksByProject.get(row.id) ?? [],
			media: mediaByProject.get(row.id) ?? [],
		};
		storage.push(d1View);
		const cms = cmsBySlug.get(row.slug);
		publicView.push(cms ? mergeCmsAuthoring(d1View, cms) : d1View);
	}
	for (const project of cmsProjects) {
		if (!d1Slugs.has(project.slug)) publicView.push(project);
	}
	return { storage, publicView };
}

const { storage, publicView } = loadPublicSurface();

// --- Contract A: D1 storage -------------------------------------------

check('storage: public rows carry identity fields (title/summary/period_start)', (failures) => {
	for (const row of storage) {
		if (!row.title || row.title.trim() === '') failures.push(`${row.slug}: empty title`);
		if (!row.summary || row.summary.trim() === '') failures.push(`${row.slug}: empty summary`);
		if (!row.periodStart || row.periodStart === 0)
			failures.push(`${row.slug}: period_start = 0 (no known date)`);
	}
});

check('storage: no public row stores a facet-kind label as role (Issue #813)', (failures) => {
	for (const row of storage) {
		if (row.role && isFacetDerivedRole(row.role)) {
			failures.push(
				`${row.slug}: role "${row.role}" is a facet-derived kind label, not a recorded role`,
			);
		}
	}
});

// --- Contract B: merged public view ------------------------------------

check('public: merged view carries identity fields', (failures) => {
	for (const project of publicView) {
		if (!project.title || project.title.trim() === '')
			failures.push(`${project.slug}: empty title`);
		if (!project.summary || project.summary.trim() === '')
			failures.push(`${project.slug}: empty summary`);
		if (!project.periodStart || project.periodStart === 0)
			failures.push(`${project.slug}: period_start = 0 (no known date)`);
	}
});

check('public: a printed role is never a facet-kind label', (failures) => {
	for (const project of publicView) {
		if (project.role && isFacetDerivedRole(project.role)) {
			failures.push(`${project.slug}: merged role "${project.role}" is a facet-derived kind label`);
		}
	}
});

// Content completeness is reported, not gated (see header): these are
// absences in the authoring source, not defects the code can fill.
for (const project of publicView) {
	const missing = [];
	if (!project.links || project.links.length === 0) missing.push('links');
	if (!project.media || project.media.length === 0) missing.push('media');
	if (missing.length > 0) contentGaps.push({ slug: project.slug, missing });
}

// --- Well-formedness (unchanged) ---------------------------------------

check('each project has at most one is_cover = 1 media row', (failures) => {
	const rows = d1Query(
		`SELECT project_id, COUNT(*) AS cover_count
			 FROM portfolio_media WHERE is_cover = 1
			 GROUP BY project_id HAVING cover_count > 1`,
	);
	for (const row of rows) {
		failures.push(`${row.project_id}: ${row.cover_count} is_cover rows (max 1)`);
	}
});

check('every portfolio_link.url is a valid http(s) URL', (failures) => {
	const rows = d1Query('SELECT id, project_id, url FROM portfolio_link');
	for (const row of rows) {
		try {
			const u = new URL(row.url);
			if (u.protocol !== 'http:' && u.protocol !== 'https:') {
				failures.push(`${row.id} (${row.project_id}): url uses ${u.protocol}, not http(s)`);
			}
		} catch {
			failures.push(`${row.id} (${row.project_id}): url is unparseable: ${row.url}`);
		}
	}
});

check('every portfolio_link.kind is in the closed enum', (failures) => {
	const rows = d1Query('SELECT id, project_id, kind FROM portfolio_link');
	for (const row of rows) {
		if (!PORTFOLIO_LINK_KINDS.has(row.kind)) {
			failures.push(`${row.id} (${row.project_id}): kind "${row.kind}" not in closed enum`);
		}
	}
});

check('every portfolio_project.facets is a subset of the closed enum', (failures) => {
	const rows = d1Query('SELECT id, slug, facets FROM portfolio_project');
	for (const row of rows) {
		let facets;
		try {
			facets = JSON.parse(row.facets ?? '[]');
		} catch (err) {
			failures.push(`${row.slug}: facets is not valid JSON: ${row.facets}`);
			continue;
		}
		if (!Array.isArray(facets)) {
			failures.push(`${row.slug}: facets is not an array: ${row.facets}`);
			continue;
		}
		for (const facet of facets) {
			if (!PORTFOLIO_FACETS.has(facet)) {
				failures.push(`${row.slug}: facet "${facet}" not in closed enum`);
			}
		}
	}
});

check('every portfolio_project.slug matches /^[a-z0-9][a-z0-9-]{0,127}$/', (failures) => {
	const rows = d1Query('SELECT id, slug FROM portfolio_project');
	for (const row of rows) {
		if (!SLUG_REGEX.test(row.slug)) {
			failures.push(`${row.id}: slug "${row.slug}" violates regex`);
		}
	}
});

check('every legacy_* project has a deterministic id of the shape legacy_<slug>', (failures) => {
	const rows = d1Query(`SELECT id, slug FROM portfolio_project WHERE id LIKE 'legacy_%'`);
	for (const row of rows) {
		const expectedSuffix = row.slug.replace(/[^a-z0-9-]/g, '_');
		const expected = `legacy_${expectedSuffix}`;
		if (row.id !== expected) {
			failures.push(`${row.slug}: id "${row.id}" does not match expected "${expected}"`);
		}
	}
});

check('public+published media rows: alt non-empty + r2_key matches <bucket>/<key>', (failures) => {
	const rows = d1Query(
		`SELECT m.id, m.project_id, m.r2_key, m.alt,
				p.visibility, p.status
			 FROM portfolio_media m JOIN portfolio_project p ON p.id = m.project_id
			 WHERE p.visibility = 'public' AND p.status = 'published'`,
	);
	const R2_KEY_REGEX = /^[a-z0-9][a-z0-9._/-]{0,255}$/i;
	for (const row of rows) {
		if (!row.alt || row.alt.trim() === '')
			failures.push(`${row.id} (${row.project_id}): empty alt`);
		if (!row.r2_key || !R2_KEY_REGEX.test(row.r2_key))
			failures.push(`${row.id} (${row.project_id}): r2_key "${row.r2_key}" violates grammar`);
	}
});

let totalFailures = 0;
for (const c of checks) {
	const status = c.failures.length === 0 ? '✓' : '✗';
	console.log(`${status} ${c.name}`);
	for (const f of c.failures) console.log(`    - ${f}`);
	totalFailures += c.failures.length;
}

console.log('');
console.log('content gaps (merged public view — authoring-source absences, #1008):');
if (contentGaps.length === 0) {
	console.log('  none');
} else {
	for (const gap of contentGaps) {
		console.log(`  - ${gap.slug}: no ${gap.missing.join(' / ')}`);
	}
	console.log(`  ${contentGaps.length} project(s) — non-blocking unless --strict-content`);
}

console.error('');
console.error(
	`[verify] ${checks.length - checks.filter((c) => c.failures.length > 0).length}/${checks.length} checks passed, ${totalFailures} failure(s), ${contentGaps.length} content gap(s)`,
);

const failed = totalFailures > 0 || (strictContent && contentGaps.length > 0);
process.exit(failed ? 1 : 0);
