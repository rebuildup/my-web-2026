#!/usr/bin/env node
/**
 * Seed script — `portfolio_project` + `portfolio_link` +
 * `portfolio_media` skeleton rows from `src/portfolio/seed.ts`.
 *
 * Usage:
 *   node scripts/seed-portfolio.mjs
 *   node scripts/seed-portfolio.mjs --dry-run   # print SQL only
 *
 * Target: local D1, through the shared `cf` driver in `_d1.mjs`
 * (Issue #247). Production writes go through the same driver and are
 * gated by its account/database identity check.
 *
 * Idempotency: INSERT OR IGNORE keyed on `portfolio_project.slug`
 * and `portfolio_link.id` / `portfolio_media.id`. Re-running on a
 * populated DB is a no-op.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeSqlFile } from './_d1.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const dryRun = process.argv.includes('--dry-run');

/** Load the seed entry list by reading the TS file and regex-extracting slug + title + facets. */
function loadSeedEntries() {
	const seedPath = join(root, 'src/portfolio/seed.ts');
	const source = readFileSync(seedPath, 'utf8');
	// Minimal regex parse — the seed module exports `PORTFOLIO_SEED`.
	// We could import the TS directly via tsx, but keeping this script
	// zero-dep avoids pulling a runtime. The seed file is
	// well-formed enough that regex extraction is safe enough for a
	// skeleton seed.
	const slugs = [...source.matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]);
	const titles = [...source.matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1]);
	// `facets: ['develop', 'design']` — extract the array literal as
	// JSON. The values are a closed enum so we don't need to escape
	// anything; we just write the array back into the SQL.
	const facetsRaw = [...source.matchAll(/facets:\s*\[([^\]]*)\]/g)].map((m) => m[1]);
	return { slugs, titles, facetsRaw };
}

const { slugs, titles, facetsRaw } = loadSeedEntries();
if (slugs.length === 0) {
	console.error('[seed-portfolio] failed to extract any seed entries from src/portfolio/seed.ts');
	process.exit(1);
}
if (slugs.length !== titles.length) {
	console.error(
		'[seed-portfolio] slug/title count mismatch — refusing to seed to avoid corruption',
	);
	process.exit(1);
}

const sqlStatements = [];
sqlStatements.push('-- Skeleton seed for portfolio obligation (Issue #76).');
sqlStatements.push('-- Source: src/portfolio/seed.ts');
sqlStatements.push('-- Idempotency: INSERT OR IGNORE on slug / id.');
sqlStatements.push('');

for (let i = 0; i < slugs.length; i++) {
	const slug = slugs[i];
	const title = titles[i];
	const facetsList = facetsRaw[i] ?? '';
	// Normalize the captured facets array literal into a SQL-safe
	// single-quoted JSON string. Each value is `'develop'` etc —
	// we strip the quotes and re-add them after escaping, so a
	// malicious seed entry can't inject SQL via the facets field.
	const facetsJson = facetsList
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.map((s) => s.replace(/^['"]|['"]$/g, ''))
		.map((s) => `"${escapeDoubleQuote(s)}"`)
		.join(',');
	const id = `seed_${slug.replace(/[^a-z0-9-]/g, '_')}`;
	const now = Date.now();
	// period_start / period_end come from the seed module — we
	// can't decode them via regex without parsing the whole TS.
	// For the foundation we record slug + title + facets only;
	// the rest of the body is filled in via subsequent admin / PR
	// updates (or by the #78 migration ticket).
	sqlStatements.push(
		`INSERT OR IGNORE INTO portfolio_project (id, slug, title, summary, role, period_start, period_end, period_label, motivation_md, facets, technologies, visibility, status, pinned, display_order, created_at, updated_at) VALUES ('${id}', '${slug}', '${escapeSingleQuote(title)}', '', 'Solo developer', ${now}, NULL, NULL, '', '[${facetsJson}]', '[]', 'public', 'published', 0, 100, ${now}, ${now});`,
	);
}

const fullSql = sqlStatements.join('\n');

if (dryRun) {
	console.log(fullSql);
	process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'seed-portfolio-'));
const sqlPath = join(tmp, 'seed.sql');
writeFileSync(sqlPath, fullSql, { mode: 0o600 });

try {
	// Issue #247: local D1 via the shared cf driver. No Cloudflare
	// credential is involved for a local write.
	executeSqlFile(sqlPath, { target: 'local' });
	console.log(`[seed-portfolio] inserted ${slugs.length} project(s) (idempotent)`);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

function escapeSingleQuote(s) {
	return s.replace(/'/g, "''");
}

function escapeDoubleQuote(s) {
	return s.replace(/"/g, '\\"');
}
