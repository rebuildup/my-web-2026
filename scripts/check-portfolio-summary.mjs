#!/usr/bin/env node
/**
 * Summary-only check for the migrated portfolio bodies (Issue #811).
 *
 * Usage:
 *   node scripts/check-portfolio-summary.mjs
 *   node scripts/check-portfolio-summary.mjs --target=production
 *   node scripts/check-portfolio-summary.mjs --json
 *
 * What it checks
 * --------------
 * The owner's rule: 「要約はしていいが、加筆してはならない。内容が嘘ばかりになる」
 * — a summary is allowed, an ADDITION is not. The mechanical half of
 * that rule is: every clause the migrated body carries must exist in the
 * legacy body it came from, and every number it carries must exist in
 * the legacy text too.
 *
 * A sentence-level comparison is used rather than a word-level
 * subsequence, because a word-level subsequence passes sentences whose
 * words were rearranged — which is exactly the "嘘ばかりになる" failure
 * the owner named. The unit is a CLAUSE (a line, or a sentence ended by
 * 。/！/？), and a migrated clause must be either
 *
 *   - one legacy clause, or
 *   - the concatenation of a RUN of consecutive legacy clauses
 *     (that is what a summary is: fewer clauses, same words).
 *
 * What it cannot decide
 * ----------------------
 * Whether a summary still MEANS what the original meant. That is a
 * judgement, not a computation, so this script does not pretend to make
 * it. It reports the rows it could not decide as `undecidable`, with a
 * count, so they are never silently passed.
 *
 * Exit codes: 0 = no addition found, 1 = an addition was found (or an
 * undecidable row exists — it is reported, and it is the operator's
 * call, so it does NOT fail the run), 2 = unusable input.
 *
 * Status-only: it prints counts and the offending clauses (operator
 * output). It never prints a credential, and it reads the legacy corpus
 * read-only.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { queryRows } from './_d1.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** The committed classification: legacy id → legacy database file. */
const CLASSIFICATION_PATH = 'docs/migration/portfolio-2025-to-2026-classification.json';

/**
 * Find the legacy corpus.
 *
 * The migration script has its own lookup (`.reference/my-web-2025`
 * under the repository root, or `MY_WEB_2025_REF`). The same rules
 * apply here, so the two scripts read the same corpus.
 */
function findRefRoot(startDir) {
	const isRefRoot = (dir) =>
		existsSync(resolve(dir, 'data/contents')) && existsSync(resolve(dir, 'package.json'));
	const cwdCandidate = resolve(process.cwd(), '.reference/my-web-2025');
	if (isRefRoot(cwdCandidate)) return cwdCandidate;
	let cur = startDir;
	for (let depth = 0; depth < 6; depth += 1) {
		const candidate = resolve(cur, '.reference/my-web-2025');
		if (isRefRoot(candidate)) return candidate;
		const parent = dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}
	const worktreeMatch = startDir.match(/^(.+)\.worktrees\/[^/]+$/);
	if (worktreeMatch) {
		const siblingCandidate = resolve(worktreeMatch[1], '.reference/my-web-2025');
		if (isRefRoot(siblingCandidate)) return siblingCandidate;
	}
	return null;
}

/** The slug the migration derives from a legacy id. */
function deriveSlug(legacyId) {
	return legacyId
		.toLowerCase()
		.replace(/_/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

/** The project id the migration writes for a legacy id. */
function projectIdFor(legacyId) {
	return `legacy_${deriveSlug(legacyId).replace(/[^a-z0-9-]/g, '_')}`;
}

/**
 * Normalise a clause for comparison.
 *
 * Only whitespace and punctuation VARIANTS are folded; no word is
 * changed, because a changed word is exactly what the owner forbade.
 */
export function normalizeClause(text) {
	return text
		.replace(/\s+/gu, '')
		.replace(/[。．｡]/gu, '。')
		.replace(/[，,]/gu, '、')
		.replace(/[！!]/gu, '！')
		.replace(/[？?]/gu, '？')
		.replace(/[「『]/gu, '「')
		.replace(/[」』]/gu, '」')
		.replace(/[（(]/gu, '（')
		.replace(/[）)]/gu, '）')
		.replace(/[・･]/gu, '・')
		.replace(/[：:]/gu, '：')
		.replace(/[；;]/gu, '；')
		.trim();
}

/**
 * Split a body into comparable clauses.
 *
 * Headings are dropped (they are structure, not prose, and the migrated
 * section carries the heading verbatim — the section split is checked
 * separately). Empty clauses are dropped.
 */
export function splitClauses(text) {
	if (!text) return [];
	const clauses = [];
	for (const rawLine of String(text).split('\n')) {
		const line = rawLine.trim();
		if (line === '') continue;
		if (line.startsWith('#')) continue;
		// A line may hold several sentences.
		const parts = line.match(/[^。！？!?]+[。！？!?]?/gu) ?? [line];
		for (const part of parts) {
			const clause = normalizeClause(part);
			if (clause !== '') clauses.push(clause);
		}
	}
	return clauses;
}

/** Every number a text carries (years, counts, sizes). */
export function numbersIn(text) {
	return [...String(text).matchAll(/\d+(?:[.,]\d+)*/gu)].map((match) => match[0]);
}

/**
 * Is a migrated clause present in the legacy clauses?
 *
 * Three forms are accepted, in this order:
 *
 *   1. it IS one legacy clause;
 *   2. it is the concatenation of a RUN of consecutive legacy clauses
 *      (ADR-0019 §2.7 — the compressed form a summary takes);
 *   3. it is the concatenation of an ORDERED SUBSEQUENCE of the legacy
 *      clauses (a summary that keeps the first and the last sentence and
 *      drops the ones between them).
 *
 * All three keep the same promise: every word comes from the legacy text,
 * in the legacy order. A word the source never carried, or a sentence
 * whose words were rearranged, matches none of them.
 */
export function clauseIsDerived(clause, legacyClauses) {
	for (const legacy of legacyClauses) {
		if (legacy === clause) return true;
	}
	for (let start = 0; start < legacyClauses.length; start += 1) {
		let joined = '';
		for (let end = start; end < legacyClauses.length && end - start < 8; end += 1) {
			joined += legacyClauses[end];
			if (joined === clause) return true;
			if (joined.length > clause.length) break;
		}
	}
	// Ordered subsequence: walk the legacy clauses and take the ones the
	// migrated clause is built from, in order.
	let cursor = 0;
	let built = '';
	for (const legacy of legacyClauses) {
		if (cursor >= clause.length) break;
		if (clause.startsWith(legacy, cursor)) {
			built += legacy;
			cursor += legacy.length;
			if (built === clause) return true;
		}
	}
	return false;
}

// `node:sqlite` is stable in Node >= 22.5; the migration script has the
// same requirement, so the two agree on the runtime contract.
const NODE_MAJOR = Number.parseInt(process.versions.node.split('.')[0], 10);
if (NODE_MAJOR < 22) {
	console.error(
		`[check-summary] node:sqlite requires Node >= 22; this environment is ${process.versions.node}.`,
	);
	process.exit(2);
}
const { DatabaseSync } = await import('node:sqlite');

/** Read the legacy row (title, summary, body) for one content id. */
function readLegacyRow(dbPath) {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const contents = db.prepare('SELECT title, summary FROM contents LIMIT 1').get();
		const markdown = db
			.prepare(
				'SELECT body FROM markdown_pages WHERE content_id = (SELECT id FROM contents LIMIT 1) ORDER BY updated_at DESC LIMIT 1',
			)
			.get();
		return {
			title: contents?.title ?? '',
			summary: contents?.summary ?? '',
			body: markdown?.body ?? '',
		};
	} finally {
		db.close();
	}
}

/**
 * Compare one migrated project against its legacy source.
 *
 * Returns the clauses that are not derivable from the legacy text
 * (`additions`), and the numbers that are not (`newNumbers`).
 */
export function compareProject({ legacy, migrated }) {
	const legacyText = [legacy.title, legacy.summary, legacy.body].join('\n');
	const legacyClauses = splitClauses(legacyText);
	const migratedText = [
		migrated.title,
		migrated.summary,
		migrated.motivation_md,
		migrated.architecture_md,
		migrated.constraints_md,
		migrated.implementation_md,
		migrated.evidence_md,
		migrated.retrospective_md,
	]
		.filter((value) => typeof value === 'string' && value !== '')
		.join('\n');

	const additions = [];
	for (const clause of splitClauses(migratedText)) {
		if (!clauseIsDerived(clause, legacyClauses)) additions.push(clause);
	}

	const legacyNumbers = new Set(numbersIn(legacyText));
	const newNumbers = [];
	for (const number of numbersIn(migratedText)) {
		if (!legacyNumbers.has(number)) newNumbers.push(number);
	}

	return { additions, newNumbers, legacyClauses: legacyClauses.length };
}

function parseArgs(argv) {
	const options = { target: 'local', json: false };
	for (const arg of argv) {
		if (arg.startsWith('--target=')) options.target = arg.slice('--target='.length);
		else if (arg === '--json') options.json = true;
		else throw new Error(`unknown option: ${arg}`);
	}
	return options;
}

export async function main(argv = process.argv.slice(2)) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		return 2;
	}

	const refRoot = process.env.MY_WEB_2025_REF
		? resolve(process.env.MY_WEB_2025_REF)
		: findRefRoot(root);
	if (refRoot === null) {
		process.stderr.write(
			'[check-summary] cannot locate .reference/my-web-2025; set MY_WEB_2025_REF.\n',
		);
		return 2;
	}

	const classificationPath = join(root, CLASSIFICATION_PATH);
	if (!existsSync(classificationPath)) {
		process.stderr.write(`[check-summary] classification file missing: ${CLASSIFICATION_PATH}\n`);
		return 2;
	}
	const classification = JSON.parse(readFileSync(classificationPath, 'utf8'));
	const dbByProjectId = new Map();
	for (const row of classification.classified ?? []) {
		if (!row.db) continue;
		dbByProjectId.set(projectIdFor(row.id), row.db);
	}

	let rows;
	try {
		rows = queryRows(
			`SELECT id, slug, title, summary, motivation_md, architecture_md, constraints_md,
			        implementation_md, evidence_md, retrospective_md, visibility, status, evidence_status
			 FROM portfolio_project WHERE id LIKE 'legacy\\_%' ESCAPE '\\' ORDER BY id`,
			{ target: options.target === 'production' ? 'production' : 'local' },
		);
	} catch (error) {
		process.stderr.write(`[check-summary] D1 read failed: ${error.message}\n`);
		return 2;
	}
	if (rows.length === 0) {
		process.stderr.write('[check-summary] no migrated rows found; run the migration first.\n');
		return 2;
	}

	const report = {
		rows: rows.length,
		checked: 0,
		verbatim: 0,
		withAdditions: 0,
		withNewNumbers: 0,
		undecidable: 0,
		additions: [],
		newNumbers: [],
		undecidableRows: [],
	};

	for (const row of rows) {
		const dbFile = dbByProjectId.get(row.id);
		if (dbFile === undefined) {
			report.undecidable += 1;
			report.undecidableRows.push({ id: row.id, reason: 'no legacy row in the classification' });
			continue;
		}
		const dbPath = join(refRoot, 'data/contents', dbFile);
		if (!existsSync(dbPath)) {
			report.undecidable += 1;
			report.undecidableRows.push({ id: row.id, reason: 'legacy database file is missing' });
			continue;
		}
		const legacy = readLegacyRow(dbPath);
		const migrated = {
			title: row.title,
			summary: row.summary,
			motivation_md: row.motivation_md,
			architecture_md: row.architecture_md,
			constraints_md: row.constraints_md,
			implementation_md: row.implementation_md,
			evidence_md: row.evidence_md,
			retrospective_md: row.retrospective_md,
		};
		const result = compareProject({ legacy, migrated });
		report.checked += 1;
		if (result.additions.length === 0 && result.newNumbers.length === 0) report.verbatim += 1;
		if (result.additions.length > 0) {
			report.withAdditions += 1;
			for (const clause of result.additions) {
				report.additions.push({ id: row.id, slug: row.slug, clause });
			}
		}
		if (result.newNumbers.length > 0) {
			report.withNewNumbers += 1;
			for (const number of result.newNumbers) {
				report.newNumbers.push({ id: row.id, slug: row.slug, number });
			}
		}
	}

	if (options.json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		process.stdout.write(
			[
				`portfolio summary check — ${report.withAdditions === 0 ? 'no addition found' : 'ADDITION FOUND'}`,
				`migrated rows: ${report.rows}`,
				`checked: ${report.checked} / derivable verbatim: ${report.verbatim}`,
				`rows with an added clause: ${report.withAdditions}`,
				`rows with a number the source does not carry: ${report.withNewNumbers}`,
				`rows this script could not decide: ${report.undecidable}`,
				'',
			].join('\n'),
		);
		for (const item of report.additions) {
			process.stdout.write(`  ADDED  ${item.id} (${item.slug}): ${item.clause}\n`);
		}
		for (const item of report.newNumbers) {
			process.stdout.write(`  NUMBER ${item.id} (${item.slug}): ${item.number}\n`);
		}
		for (const item of report.undecidableRows) {
			process.stdout.write(`  ??     ${item.id}: ${item.reason}\n`);
		}
	}

	return report.withAdditions > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(await main());
}
