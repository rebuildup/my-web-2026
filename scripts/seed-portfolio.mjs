#!/usr/bin/env node
/**
 * Seed script — `portfolio_project` + `portfolio_link` +
 * `portfolio_media` skeleton rows from `src/portfolio/seed.ts`.
 *
 * Usage:
 *   node scripts/seed-portfolio.mjs
 *   node scripts/seed-portfolio.mjs --dry-run   # print SQL only
 *
 * Target: local D1 (uses `wrangler d1 execute --local`).
 * For production use `wrangler d1 execute --remote` against the
 * `my-web-2026` database.
 *
 * Idempotency: INSERT OR IGNORE keyed on `portfolio_project.slug`
 * and `portfolio_link.id` / `portfolio_media.id`. Re-running on a
 * populated DB is a no-op.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const dryRun = process.argv.includes('--dry-run');

/** Load the seed entry list by reading the TS file and regex-extracting slug + title. */
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
	return { slugs, titles };
}

const { slugs, titles } = loadSeedEntries();
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
	const id = `seed_${slug.replace(/[^a-z0-9-]/g, '_')}`;
	const now = Date.now();
	// period_start / period_end come from the seed module — we
	// can't decode them via regex without parsing the whole TS.
	// For the foundation we record slug + title + created_at only;
	// the rest of the body is filled in via subsequent admin / PR
	// updates (or by the #78 migration ticket).
	sqlStatements.push(
		`INSERT OR IGNORE INTO portfolio_project (id, slug, title, summary, role, period_start, period_end, period_label, motivation_md, facets, technologies, visibility, status, pinned, display_order, created_at, updated_at) VALUES ('${id}', '${slug}', '${escapeSingleQuote(title)}', '', 'Solo developer', ${now}, NULL, NULL, '', '[]', '[]', 'public', 'published', 0, 100, ${now}, ${now});`,
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
	const result = spawnSync(
		'pnpm',
		['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--file', sqlPath],
		{
			cwd: root,
			stdio: 'inherit',
			env: process.env,
		},
	);
	if (result.status !== 0) {
		console.error('[seed-portfolio] wrangler d1 execute failed');
		process.exit(result.status ?? 1);
	}
	console.log(`[seed-portfolio] inserted ${slugs.length} project(s) (idempotent)`);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

function escapeSingleQuote(s) {
	return s.replace(/'/g, "''");
}

void existsSync; // silence unused-import warning under node 22 strict
