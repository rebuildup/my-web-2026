#!/usr/bin/env node
/**
 * Conditional D1 repair — my-web-2026 portfolio storage contract (Issue #1008).
 *
 * WHY THIS EXISTS
 * ---------------
 * Issue #1008's production audit concluded the reported gaps are NOTION
 * AUTHORING gaps, not D1 storage corruption: empty `role` is a legal
 * state (Issue #813), empty media/links are content absences the CMS
 * merge already covers or cannot invent (ADR-0018 §2.11, ADR-0019), and
 * `scripts/verify-portfolio.mjs` splits the STORAGE contract from the
 * PUBLIC contract for exactly that reason. **No production repair is
 * currently indicated.**
 *
 * This script is the contingency: IF a future `verify-portfolio.mjs
 * --target=production` run reports STORAGE-contract violations that
 * have a deterministic, non-invented fix, this tool generates — and,
 * only under explicit flags, applies — the minimal UPDATE statements.
 * It never DELETEs, never INSERTs, and never writes a value the
 * contract does not already define.
 *
 * What it repairs (the ONLY violation kinds with a safe fix):
 *
 *   1. `facet-derived-role` — a public+published row stores a
 *      facet-kind label (`kind-labels.ts`, e.g. "Development") in
 *      `role`. Issue #813: that is not a recorded role. Fix:
 *      `role = ''` — the column's documented "no role recorded"
 *      encoding (`schema.ts`; `rowToProject` maps '' → null).
 *
 *   2. `facets-not-json` / `facets-unknown-values` — `facets` is not a
 *      JSON array, or holds values outside the closed enum. Fix:
 *      rewrite to the valid subset (order preserved, de-duplicated);
 *      `'[]'` when nothing valid remains. Never invents a facet.
 *
 *   3. `duplicate-cover-media` — more than one `is_cover = 1` row per
 *      project (the partial UNIQUE index should prevent this; a row
 *      set that predates it or bypassed it can still carry it). Fix:
 *      keep the cover with the lowest `display_order` (ties: lowest
 *      `id`) and set `is_cover = 0` on the rest.
 *
 * What it does NOT repair — reported under `manualFindings`, no SQL:
 *   * empty title / summary / period_start = 0 (identity the merge
 *     cannot supply — needs an owner decision, not a guess);
 *   * invalid link URLs / unknown link kinds;
 *   * empty media `alt` / malformed `r2_key`;
 *   * slug grammar / non-deterministic legacy ids (the id is a PK
 *     referenced by child rows — renaming is a migration, not a repair);
 *   * empty role, empty media, empty links — LEGAL states (#813,
 *     ADR-0019), never violations.
 *
 * Usage:
 *   node scripts/repair-portfolio-d1.mjs [--target=local|production]
 *   node scripts/repair-portfolio-d1.mjs --apply --execute [--target=…]
 *   node scripts/repair-portfolio-d1.mjs --rollback=<snapshot.json> [--execute]
 *
 * Modes:
 *   default            DRY-RUN. Read-only. Prints the diff report and
 *                      writes `repair-report.{json,md}` under
 *                      `--out-dir` (default `.tmp/portfolio-d1-repair/`).
 *   --apply            Requires --execute as well; without it exits 2.
 *                      With both: snapshots every touched row, writes
 *                      the forward batch + rollback SQL, executes the
 *                      batch through `_d1.mjs#executeBatch` (the same
 *                      production write gate every other mutation
 *                      uses), then re-runs detection as a post-check.
 *   --rollback=<file>  Reads a snapshot written by --apply and emits
 *                      the compensating UPDATEs. Dry-run by default;
 *                      --execute performs the write.
 *
 * Credentials: a production read needs `CLOUDFLARE_D1_API_TOKEN`
 * (D1-scoped; `_d1.mjs` enforces it and never falls back to the Worker
 * deploy token). Local needs none. Missing credentials fail closed with
 * the driver's own error — this script adds no credential path of its
 * own.
 *
 * Exit codes: 0 = clean (or applied successfully), 1 = violations
 * remain / apply refused, 2 = bad usage or unreadable input.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeBatch, queryRows } from './_d1.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// The SAME vocabulary the Worker ships. `kind-labels.ts` is a
// type-only-import leaf (`import type` from schema), so Node's type
// stripping loads it without the schema module's runtime graph — the
// same reason `verify-portfolio.mjs` imports it directly.
const { isFacetDerivedRole } = await import('../src/portfolio/kind-labels.ts');

// Closed enums, mirrored from `src/portfolio/schema.ts`. The verify
// script keeps its own copies for the same reason (the schema module
// pulls in Zod); if either enum changes, BOTH verifiers go red — which
// is the intended drift signal.
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
const R2_KEY_REGEX = /^[a-z0-9][a-z0-9._/-]{0,255}$/i;

// ---------------------------------------------------------------------------
// Pure core — everything below the CLI boundary is unit-testable with
// fixture rows; no D1, no credentials, no filesystem.
// ---------------------------------------------------------------------------

/** SQL literal for a batch statement (params are inlined; values are script-generated). */
export function sqlLiteral(value) {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`refusing non-finite number literal: ${value}`);
		return String(value);
	}
	return `'${String(value).replaceAll("'", "''")}'`;
}

/** Short content hash for the diff report — proves WHAT changed without pasting payloads. */
export function valueDigest(value) {
	return createHash('sha256')
		.update(String(value ?? ''))
		.digest('hex')
		.slice(0, 12);
}

/** Truncate a stored value for human-readable diff output. */
export function summariseValue(value, max = 80) {
	const text = String(value ?? '');
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function isPublicPublished(project) {
	return project.status === 'published' && project.visibility === 'public';
}

/**
 * Detect every repairable storage-contract violation plus the
 * non-repairable ones (reported, never fixed).
 *
 * @param {object} input
 * @param {Array<object>} input.projects  `portfolio_project` rows (snake_case)
 * @param {Array<object>} input.links     `portfolio_link` rows
 * @param {Array<object>} input.media     `portfolio_media` rows
 * @returns {{ repairs: Array<object>, manualFindings: Array<object> }}
 *
 * Repair entries carry `statements` — UPDATE-only SQL, one per changed
 * column/row. `current`/`proposed` are report summaries, not the full
 * payload.
 */
export function detectPortfolioViolations({ projects, links, media }) {
	const repairs = [];
	const manualFindings = [];

	const mediaByProject = new Map();
	for (const row of media) {
		const list = mediaByProject.get(row.project_id) ?? [];
		list.push(row);
		mediaByProject.set(row.project_id, list);
	}
	const projectById = new Map(projects.map((p) => [p.id, p]));

	for (const project of projects) {
		const publicRow = isPublicPublished(project);
		const slug = project.slug ?? project.id;

		// --- Repairable: facet-derived role (public surface only) -------
		if (publicRow && project.role && isFacetDerivedRole(project.role)) {
			repairs.push({
				kind: 'facet-derived-role',
				table: 'portfolio_project',
				rowId: project.id,
				slug,
				current: { role: project.role, digest: valueDigest(project.role) },
				proposed: { role: '' },
				rationale:
					'Issue #813: a facet-kind label is not a recorded role; "" is the documented "no role recorded" encoding.',
				statements: [`UPDATE portfolio_project SET role = '' WHERE id = ${sqlLiteral(project.id)}`],
			});
		}

		// --- Repairable: facets column ----------------------------------
		// Verify's scope is EVERY portfolio_project row (draft included):
		// a malformed facets value is malformed regardless of visibility.
		const facetsRepair = planFacetsRepair(project);
		if (facetsRepair) repairs.push(facetsRepair);

		// --- Manual: identity fields the merge cannot supply ------------
		if (publicRow) {
			if (!project.title || String(project.title).trim() === '') {
				manualFindings.push({
					kind: 'empty-title',
					table: 'portfolio_project',
					rowId: project.id,
					slug,
					detail: 'public+published row has an empty title; the CMS merge cannot invent one',
				});
			}
			if (!project.summary || String(project.summary).trim() === '') {
				manualFindings.push({
					kind: 'empty-summary',
					table: 'portfolio_project',
					rowId: project.id,
					slug,
					detail: 'public+published row has an empty summary; the CMS merge cannot invent one',
				});
			}
			if (!project.period_start || project.period_start === 0) {
				manualFindings.push({
					kind: 'zero-period-start',
					table: 'portfolio_project',
					rowId: project.id,
					slug,
					detail: 'public+published row has period_start = 0 (no known date)',
				});
			}
		}

		// --- Manual: slug / legacy id shape ------------------------------
		if (project.slug && !SLUG_REGEX.test(project.slug)) {
			manualFindings.push({
				kind: 'invalid-slug',
				table: 'portfolio_project',
				rowId: project.id,
				slug,
				detail: `slug "${summariseValue(project.slug)}" violates the slug grammar`,
			});
		}
		if (typeof project.id === 'string' && project.id.startsWith('legacy_')) {
			const expected = `legacy_${String(project.slug ?? '').replace(/[^a-z0-9-]/g, '_')}`;
			if (project.id !== expected) {
				manualFindings.push({
					kind: 'non-deterministic-legacy-id',
					table: 'portfolio_project',
					rowId: project.id,
					slug,
					detail: `legacy id "${project.id}" does not match deterministic "${expected}"; the id is a PK referenced by child rows — a migration, not a repair`,
				});
			}
		}
	}

	// --- Repairable: more than one cover per project -------------------
	for (const [projectId, rows] of mediaByProject) {
		const covers = rows.filter((row) => row.is_cover === 1 || row.is_cover === true);
		if (covers.length <= 1) continue;
		// Keeper: lowest display_order, ties broken by lowest id — the same
		// deterministic order `ORDER BY display_order, id` would surface.
		const sorted = [...covers].sort(
			(a, b) =>
				Number(a.display_order ?? 0) - Number(b.display_order ?? 0) ||
				String(a.id).localeCompare(String(b.id)),
		);
		const keeper = sorted[0];
		const project = projectById.get(projectId);
		for (const demoted of sorted.slice(1)) {
			repairs.push({
				kind: 'duplicate-cover-media',
				table: 'portfolio_media',
				rowId: demoted.id,
				slug: project?.slug ?? projectId,
				current: { is_cover: 1, display_order: demoted.display_order ?? 0 },
				proposed: { is_cover: 0 },
				rationale: `project already has a cover (kept media id ${keeper.id}); at most one is_cover = 1 per project`,
				statements: [
					`UPDATE portfolio_media SET is_cover = 0 WHERE id = ${sqlLiteral(demoted.id)}`,
				],
			});
		}
	}

	// --- Manual: links ---------------------------------------------------
	for (const link of links) {
		try {
			const url = new URL(link.url);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				manualFindings.push({
					kind: 'non-http-link-url',
					table: 'portfolio_link',
					rowId: link.id,
					projectId: link.project_id,
					slug: projectById.get(link.project_id)?.slug,
					detail: `url uses ${url.protocol}, not http(s)`,
				});
			}
		} catch {
			manualFindings.push({
				kind: 'unparseable-link-url',
				table: 'portfolio_link',
				rowId: link.id,
				projectId: link.project_id,
				slug: projectById.get(link.project_id)?.slug,
				detail: `url is unparseable: ${summariseValue(link.url)}`,
			});
		}
		if (!PORTFOLIO_LINK_KINDS.has(link.kind)) {
			manualFindings.push({
				kind: 'unknown-link-kind',
				table: 'portfolio_link',
				rowId: link.id,
				projectId: link.project_id,
				slug: projectById.get(link.project_id)?.slug,
				detail: `kind "${link.kind}" is not in the closed enum`,
			});
		}
	}

	// --- Manual: media alt / r2_key on public+published projects ---------
	for (const row of media) {
		const project = projectById.get(row.project_id);
		if (!project || !isPublicPublished(project)) continue;
		if (!row.alt || String(row.alt).trim() === '') {
			manualFindings.push({
				kind: 'empty-media-alt',
				table: 'portfolio_media',
				rowId: row.id,
				projectId: row.project_id,
				slug: project.slug,
				detail: 'public+published media row has an empty alt',
			});
		}
		if (!row.r2_key || !R2_KEY_REGEX.test(row.r2_key)) {
			manualFindings.push({
				kind: 'invalid-media-r2-key',
				table: 'portfolio_media',
				rowId: row.id,
				projectId: row.project_id,
				slug: project.slug,
				detail: `r2_key "${summariseValue(row.r2_key)}" violates the <bucket>/<key> grammar`,
			});
		}
	}

	return { repairs, manualFindings };
}

/**
 * Plan the `facets` column repair for one project row, or null when the
 * stored value already satisfies the contract.
 *
 * Legal stored shapes: a JSON array whose members are all strings drawn
 * from `PORTFOLIO_FACETS` (duplicates tolerated — the loader treats it
 * as a set; we still normalise them away only when OTHER values forced a
 * rewrite, to keep the diff minimal).
 */
function planFacetsRepair(project) {
	const raw = project.facets;
	let parsed;
	try {
		parsed = JSON.parse(raw ?? '[]');
	} catch {
		return facetsViolation(
			project,
			'facets-not-json',
			raw,
			'[]',
			'facets is not valid JSON; rewritten to the empty array — no facet is invented',
		);
	}
	if (!Array.isArray(parsed)) {
		return facetsViolation(
			project,
			'facets-not-json',
			raw,
			'[]',
			'facets is not a JSON array; rewritten to the empty array',
		);
	}
	const kept = [];
	const seen = new Set();
	let dropped = 0;
	for (const value of parsed) {
		if (typeof value === 'string' && PORTFOLIO_FACETS.has(value)) {
			// Valid facet — kept once, in first-seen order. A duplicate is
			// legal (the loader treats facets as a set) and is NOT a
			// dropped member, so it never triggers a rewrite by itself.
			if (!seen.has(value)) {
				seen.add(value);
				kept.push(value);
			}
		} else {
			dropped += 1;
		}
	}
	if (dropped === 0) return null; // already a clean array of valid facets
	const proposedJson = JSON.stringify(kept);
	// Defensive: if the stored text already equals the proposal there is
	// nothing to write (unreachable today — dropped > 0 implies the
	// stored array held an invalid member the proposal lacks).
	if (raw === proposedJson) return null;
	return facetsViolation(
		project,
		'facets-unknown-values',
		raw,
		proposedJson,
		`${dropped} member(s) outside the closed facet enum removed; valid facets preserved in order`,
	);
}

function facetsViolation(project, kind, raw, proposedJson, rationale) {
	return {
		kind,
		table: 'portfolio_project',
		rowId: project.id,
		slug: project.slug ?? project.id,
		current: { facets: summariseValue(raw), digest: valueDigest(raw) },
		proposed: { facets: proposedJson },
		rationale,
		statements: [
			`UPDATE portfolio_project SET facets = ${sqlLiteral(proposedJson)} WHERE id = ${sqlLiteral(project.id)}`,
		],
	};
}

/**
 * Columns snapshotted before apply, per table. The rollback restores
 * exactly these — nothing else is touched, so nothing else needs
 * restoring.
 */
export const SNAPSHOT_COLUMNS = Object.freeze({
	portfolio_project: ['id', 'slug', 'role', 'facets'],
	portfolio_media: ['id', 'project_id', 'is_cover'],
});

/** SELECT statement fetching the snapshot columns for the affected ids. */
export function snapshotSelectStatement(repairs) {
	const byTable = new Map();
	for (const repair of repairs) {
		const list = byTable.get(repair.table) ?? new Set();
		list.add(repair.rowId);
		byTable.set(repair.table, list);
	}
	const parts = [];
	for (const [table, ids] of byTable) {
		const cols = SNAPSHOT_COLUMNS[table].join(', ');
		const idList = [...ids].map((id) => sqlLiteral(id)).join(', ');
		parts.push(`SELECT ${cols} FROM ${table} WHERE id IN (${idList})`);
	}
	return parts;
}

/**
 * Build the compensating UPDATEs for a snapshot document produced by
 * `writeSnapshot`. Pure — the rollback path is testable without D1.
 */
export function buildRollbackStatements(snapshot) {
	const statements = [];
	for (const entry of snapshot.rows ?? []) {
		const cols = SNAPSHOT_COLUMNS[entry.table];
		if (!cols) continue;
		const setClause = cols
			.filter((col) => col !== 'id')
			.map((col) => `${col} = ${sqlLiteral(entry.values[col] ?? null)}`)
			.join(', ');
		statements.push(
			`UPDATE ${entry.table} SET ${setClause} WHERE id = ${sqlLiteral(entry.values.id)}`,
		);
	}
	return statements;
}

/** Render the human-readable markdown diff report. */
export function renderMarkdownReport({ target, repairs, manualFindings }) {
	const lines = [];
	lines.push(`# portfolio D1 repair report — target: ${target}`);
	lines.push('');
	lines.push(
		`Generated by \`scripts/repair-portfolio-d1.mjs\` (dry-run analysis). ` +
			`Repairs are UPDATE-only; nothing is deleted or invented.`,
	);
	lines.push('');
	lines.push(`## Repairable violations (${repairs.length})`);
	lines.push('');
	if (repairs.length === 0) {
		lines.push('None.');
	} else {
		for (const repair of repairs) {
			lines.push(`### ${repair.kind} — ${repair.table} \`${repair.rowId}\``);
			lines.push('');
			lines.push(`- slug: \`${repair.slug ?? '-'}\``);
			lines.push(`- current: \`${JSON.stringify(repair.current)}\``);
			lines.push(`- proposed: \`${JSON.stringify(repair.proposed)}\``);
			lines.push(`- rationale: ${repair.rationale}`);
			for (const statement of repair.statements) {
				lines.push(`- \`\`\`sql\n  ${statement}\n  \`\`\``);
			}
			lines.push('');
		}
	}
	lines.push(`## Manual findings — reported, NOT auto-repaired (${manualFindings.length})`);
	lines.push('');
	if (manualFindings.length === 0) {
		lines.push('None.');
	} else {
		lines.push('| kind | table | row | slug | detail |');
		lines.push('| --- | --- | --- | --- | --- |');
		for (const finding of manualFindings) {
			lines.push(
				`| ${finding.kind} | ${finding.table} | \`${finding.rowId}\` | ${finding.slug ?? '-'} | ${finding.detail} |`,
			);
		}
	}
	lines.push('');
	return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// CLI boundary
// ---------------------------------------------------------------------------

function parseArg(set, name) {
	for (const arg of set) {
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return null;
}

function loadRows(target) {
	// Same read surface as verify-portfolio.mjs: `_d1.mjs#queryRows`,
	// which enforces the canonical identity and the D1-scoped credential.
	return {
		projects: queryRows('SELECT * FROM portfolio_project', { target }),
		links: queryRows('SELECT * FROM portfolio_link', { target }),
		media: queryRows('SELECT * FROM portfolio_media', { target }),
	};
}

function runDetection(target) {
	const { projects, links, media } = loadRows(target);
	return detectPortfolioViolations({ projects, links, media });
}

function writeArtifacts(outDir, target, detection, stamp) {
	mkdirSync(outDir, { recursive: true });
	const jsonPath = join(outDir, `repair-report-${stamp}.json`);
	const mdPath = join(outDir, `repair-report-${stamp}.md`);
	const sqlPath = join(outDir, `repair-${stamp}.sql`);
	const batchPath = join(outDir, `repair-${stamp}.batch.json`);
	const document = {
		version: 1,
		target,
		generatedAt: new Date().toISOString(),
		summary: {
			repairCount: detection.repairs.length,
			statementCount: detection.repairs.reduce((n, r) => n + r.statements.length, 0),
			manualCount: detection.manualFindings.length,
		},
		repairs: detection.repairs,
		manualFindings: detection.manualFindings,
	};
	writeFileSync(jsonPath, `${JSON.stringify(document, null, '\t')}\n`, { mode: 0o600 });
	writeFileSync(mdPath, renderMarkdownReport({ target, ...detection }), { mode: 0o600 });
	const statements = detection.repairs.flatMap((r) => r.statements);
	writeFileSync(sqlPath, `${statements.join(';\n')}\n`, { mode: 0o600 });
	writeFileSync(
		batchPath,
		`${JSON.stringify(
			statements.map((sql) => ({ sql, params: [] })),
			null,
			'\t',
		)}\n`,
		{ mode: 0o600 },
	);
	return { jsonPath, mdPath, sqlPath, batchPath, statements };
}

/**
 * Read the current values of every column a repair touches, for every
 * affected row. Runs immediately before apply so the snapshot reflects
 * the database as it is NOW, not as the diff saw it.
 */
function captureSnapshot(target, repairs, stamp) {
	const selects = snapshotSelectStatement(repairs);
	const rows = [];
	for (const sql of selects) {
		for (const row of queryRows(sql, { target })) {
			rows.push({
				table: sql.includes('portfolio_media') ? 'portfolio_media' : 'portfolio_project',
				values: row,
			});
		}
	}
	return {
		version: 1,
		createdAt: new Date().toISOString(),
		stamp,
		rows,
	};
}

function stamp() {
	return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
	const args = new Set(process.argv.slice(2));
	const target = parseArg(args, '--target') ?? 'local';
	const outDir = parseArg(args, '--out-dir') ?? join(root, '.tmp', 'portfolio-d1-repair');
	const apply = args.has('--apply');
	const execute = args.has('--execute');
	const rollbackPath = parseArg(args, '--rollback');

	if (target !== 'local' && target !== 'production') {
		process.stderr.write(`--target must be 'local' or 'production', got: ${target}\n`);
		return 2;
	}

	if (rollbackPath) {
		return runRollback({ rollbackPath, target, outDir, execute });
	}

	if (apply && !execute) {
		process.stderr.write(
			'[repair] --apply requires --execute. Without --execute this tool is dry-run only;\n' +
				'        nothing is written. Re-run with both flags to perform the repair.\n',
		);
		return 2;
	}

	const detection = runDetection(target);
	const ts = stamp();
	const artifacts = writeArtifacts(outDir, target, detection, ts);

	process.stdout.write(renderMarkdownReport({ target, ...detection }));
	process.stdout.write(
		`[repair] ${detection.repairs.length} repairable violation(s), ` +
			`${detection.manualFindings.length} manual finding(s) ` +
			`(${artifacts.statements.length} statement(s)).\n` +
			`[repair] artifacts: ${artifacts.jsonPath}\n`,
	);

	if (detection.repairs.length === 0) {
		process.stdout.write('[repair] nothing to repair — storage contract holds.\n');
		return detection.manualFindings.length > 0 ? 1 : 0;
	}

	if (!apply) {
		process.stdout.write(
			'[repair] DRY-RUN: no writes performed. Review the diff, then re-run with\n' +
				'        --apply --execute (and --target=production for production).\n',
		);
		return 1;
	}

	// --- apply -----------------------------------------------------------
	if (target === 'production') {
		process.stderr.write(
			'[repair] WARNING: applying UPDATE statements to PRODUCTION D1.\n' +
				'        This requires operator credentials and owner authorization\n' +
				'        (docs/runbook/portfolio-d1-repair.md §2). Continuing because\n' +
				'        --apply --execute were both passed explicitly.\n',
		);
	}

	const snapshotDoc = captureSnapshot(target, detection.repairs, ts);
	const snapshotPath = join(outDir, `snapshot-${ts}.json`);
	const rollbackSqlPath = join(outDir, `rollback-${ts}.sql`);
	writeFileSync(snapshotPath, `${JSON.stringify(snapshotDoc, null, '\t')}\n`, { mode: 0o600 });
	const rollbackStatements = buildRollbackStatements(snapshotDoc);
	writeFileSync(`${rollbackStatements.join(';\n')}\n`, { mode: 0o600 });
	writeFileSync(rollbackSqlPath, `${rollbackStatements.join(';\n')}\n`, { mode: 0o600 });
	process.stdout.write(
		`[repair] snapshot written: ${snapshotPath}\n` +
			`[repair] rollback SQL:     ${rollbackSqlPath}\n`,
	);

	try {
		executeBatch(artifacts.batchPath, { target, execute: true });
	} catch (error) {
		process.stderr.write(`[repair] apply failed: ${error.message}\n`);
		process.stderr.write(
			`[repair] snapshot preserved at ${snapshotPath} — use --rollback to compensate.\n`,
		);
		return 1;
	}

	// Post-check: the same detection must now report zero repairs.
	const after = runDetection(target);
	if (after.repairs.length > 0) {
		process.stderr.write(
			`[repair] POST-CHECK FAILED: ${after.repairs.length} violation(s) remain after apply.\n` +
				`        Snapshot: ${snapshotPath}\n`,
		);
		return 1;
	}
	process.stdout.write(
		`[repair] applied ${artifacts.statements.length} statement(s); post-check clean.\n` +
			`[repair] rollback if needed: node scripts/repair-portfolio-d1.mjs --rollback=${snapshotPath} --execute\n`,
	);
	return after.manualFindings.length > 0 ? 1 : 0;
}

function runRollback({ rollbackPath, target, outDir, execute }) {
	if (!existsSync(rollbackPath)) {
		process.stderr.write(`[repair] rollback snapshot not found: ${rollbackPath}\n`);
		return 2;
	}
	const snapshotDoc = JSON.parse(readFileSync(rollbackPath, 'utf8'));
	const statements = buildRollbackStatements(snapshotDoc);
	if (statements.length === 0) {
		process.stderr.write('[repair] snapshot contains no rows — nothing to roll back.\n');
		return 2;
	}
	const ts = stamp();
	mkdirSync(outDir, { recursive: true });
	const batchPath = join(outDir, `rollback-${ts}.batch.json`);
	writeFileSync(
		batchPath,
		`${JSON.stringify(
			statements.map((sql) => ({ sql, params: [] })),
			null,
			'\t',
		)}\n`,
		{ mode: 0o600 },
	);
	process.stdout.write(
		`[repair] rollback: ${statements.length} compensating UPDATE(s) from ${rollbackPath}\n` +
			statements.map((s) => `  ${s}`).join('\n') +
			'\n',
	);
	if (!execute) {
		process.stdout.write('[repair] DRY-RUN: pass --execute to perform the rollback write.\n');
		return 1;
	}
	if (target === 'production') {
		process.stderr.write(
			'[repair] WARNING: rolling back PRODUCTION D1 — operator credentials and owner\n' +
				'        authorization required (docs/runbook/portfolio-d1-repair.md).\n',
		);
	}
	try {
		executeBatch(batchPath, { target, execute: true });
	} catch (error) {
		process.stderr.write(`[repair] rollback failed: ${error.message}\n`);
		return 1;
	}
	process.stdout.write('[repair] rollback applied.\n');
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main()
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			// Fail closed: a D1 read/write failure (missing
			// CLOUDFLARE_D1_API_TOKEN, unreachable local state, cf error)
			// surfaces as a clean message, never a partial write — apply
			// snapshots before executing and reports the snapshot path on
			// failure.
			process.stderr.write(`[repair] ${error.message}\n`);
			process.exitCode = 2;
		});
}
