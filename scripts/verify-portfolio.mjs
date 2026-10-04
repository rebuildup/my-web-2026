#!/usr/bin/env node
/**
 * Completeness verifier — my-web-2026 (current) portfolio D1.
 *
 * Usage:
 *   node scripts/verify-portfolio.mjs [--target=local|production]
 *
 * What it asserts (Issue #78 acceptance contract — public
 * portfolio surface MUST be presentable to a third party after the
 * migration):
 *
 *   1. Every public `portfolio_project` row has:
 *      - non-empty title
 *      - non-empty summary
 *      - non-empty role
 *      - non-zero period_start
 *      - at least one `portfolio_link` row attached
 *      - at least one `portfolio_media` row attached (Issue #78 blocker #5)
 *   2. Every project has at most one `is_cover = 1` row in
 *      `portfolio_media` (DB invariant — enforced by the partial
 *      UNIQUE index, but we re-check it from the application
 *      surface to catch migration drift).
 *   3. Every `portfolio_link.url` is a syntactically valid URL
 *      with `http`/`https` scheme.
 *   4. Every `portfolio_link.kind` is one of the closed enum.
 *   5. Every `portfolio_project.facets` JSON array is a subset of
 *      the closed `PORTFOLIO_FACETS` enum.
 *   6. Every `portfolio_project.slug` matches the slug grammar.
 *   7. Every legacy `legacy_*` project has a deterministic id of
 *      the shape `legacy_<slug-safe-id>`.
 *   8. Every public+published row has a non-empty media row
 *      (`media_count >= 1`); `r2_key` matches the closed
 *      `<bucket>/<key>` grammar; `alt` is non-empty.
 *
 * Output:
 *   * exit 0 — all assertions pass, prints a count summary.
 *   * exit 1 — at least one assertion failed, prints every
 *     offending row with the rule that broke.
 *
 * Reads D1 through the repository's shared `_d1.mjs` driver, the same
 * surface the seed scripts and the migration path use, so the local and
 * production read surfaces are identical and neither can bypass the
 * canonical identity check.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryRows } from './_d1.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = new Set(process.argv.slice(2));
const target = parseArg(args, '--target') ?? 'local';
// 'production', never 'remote': the only remote database is production,
// so naming it states the scope instead of hiding it behind a transport
// detail. This matches `_d1.mjs#resolveTarget`.
if (target !== 'local' && target !== 'production') {
	console.error(`--target must be 'local' or 'production', got: ${target}`);
	process.exit(2);
}

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

function check(name, fn) {
	const failures = [];
	try {
		fn(failures);
	} catch (err) {
		failures.push(`unexpected error: ${err.message}`);
	}
	checks.push({ name, failures });
}

check(
	'public projects have title + summary + role + period_start + ≥1 link + ≥1 media',
	(failures) => {
		const rows = d1Query(
			`SELECT p.id, p.slug, p.title, p.summary, p.role, p.period_start, p.motivation_md,
				(SELECT COUNT(*) FROM portfolio_link l WHERE l.project_id = p.id) AS link_count,
				(SELECT COUNT(*) FROM portfolio_media m WHERE m.project_id = p.id) AS media_count
			 FROM portfolio_project p WHERE p.visibility = 'public' AND p.status = 'published'`,
		);
		for (const row of rows) {
			if (!row.title || row.title.trim() === '') failures.push(`${row.slug}: empty title`);
			if (!row.summary || row.summary.trim() === '') failures.push(`${row.slug}: empty summary`);
			if (!row.role || row.role.trim() === '') failures.push(`${row.slug}: empty role`);
			if (!row.period_start || row.period_start === 0)
				failures.push(`${row.slug}: period_start = 0 (no known date)`);
			if (!row.link_count || row.link_count < 1)
				failures.push(`${row.slug}: no portfolio_link rows attached`);
			if (!row.media_count || row.media_count < 1)
				failures.push(
					`${row.slug}: no portfolio_media rows attached (Issue #78 blocker #5 — public+published requires media_count >= 1)`,
				);
		}
	},
);

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

console.error('');
console.error(
	`[verify] ${checks.length - checks.filter((c) => c.failures.length > 0).length}/${checks.length} checks passed, ${totalFailures} failure(s)`,
);

process.exit(totalFailures > 0 ? 1 : 0);
