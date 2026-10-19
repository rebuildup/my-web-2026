#!/usr/bin/env node
/**
 * check-seo-status-contract — the SEO HTTP status contract gate (Issue #419).
 *
 * Offline, read-only, and cheap: it reads three kinds of repository
 * state and compares them against each other.
 *
 *   1. `src/routeTree.gen.ts`  — the routes the Worker actually serves.
 *   2. `scripts/_seo-status-contract.mjs` — the declared status matrix.
 *   3. the proof files the matrix names (`test/integration/…`,
 *      `e2e/…`) — whether a case id is really exercised there.
 *
 * It makes NO request and starts no Worker: the runtime half of the
 * contract is proved by `test/integration/seo-status-contract.test.ts`
 * (workerd) and `e2e/seo-status.spec.ts` (a real browser), both of which
 * feed their observation back into the same evaluator. What this gate
 * owns is the property those two cannot express on their own: that the
 * matrix stays EXHAUSTIVE over the route tree and that no row is a claim
 * without evidence.
 *
 * Exit codes:
 *   0  contract consistent
 *   1  at least one violation (one line per violation, code + message)
 *   2  bad input (unreadable route tree / missing contract module)
 *
 * Usage:
 *   node scripts/check-seo-status-contract.mjs           # verify (gate mode)
 *   node scripts/check-seo-status-contract.mjs --report  # print the matrix
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRouteTree } from './_index-boundary.mjs';
import {
	HTTP_STATUS_EXPECTATIONS,
	checkProofWiring,
	checkRouteCoverage,
	openDecisions,
	summarize,
} from './_seo-status-contract.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ROUTE_TREE = join(REPO_ROOT, 'src/routeTree.gen.ts');

function readOrExit(path) {
	try {
		return readFileSync(path, 'utf8');
	} catch (error) {
		process.stderr.write(`check-seo-status-contract: cannot read ${path}: ${error.message}\n`);
		process.exit(2);
	}
}

/** Every file any row names as its proof, keyed by repo-relative path. */
function readProofFiles() {
	const sources = {};
	for (const entry of HTTP_STATUS_EXPECTATIONS) {
		for (const proof of entry.proves) {
			if (proof.file in sources) continue;
			try {
				sources[proof.file] = readFileSync(join(REPO_ROOT, proof.file), 'utf8');
			} catch {
				// Recorded as `unproven-case` by checkProofWiring; a missing
				// proof file is a violation, not a crash.
				sources[proof.file] = undefined;
			}
		}
	}
	return sources;
}

function report(expectations) {
	const header = ['case', 'route', 'status', 'robots', 'surface', 'sitemap', 'proof'];
	const rows = expectations.map((entry) => [
		entry.id,
		entry.route,
		Array.isArray(entry.expect.status)
			? entry.expect.status.join('|')
			: String(entry.expect.status),
		entry.expect.robots,
		entry.expect.surface,
		entry.sitemap,
		entry.proves.map((proof) => proof.layer).join('+'),
	]);
	const widths = header.map((cell, column) =>
		Math.max(cell.length, ...rows.map((row) => row[column].length)),
	);
	const line = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ');
	process.stdout.write(`${line(header)}\n`);
	process.stdout.write(`${line(widths.map((width) => '-'.repeat(width)))}\n`);
	for (const row of rows) process.stdout.write(`${line(row)}\n`);
	process.stdout.write('\n');
	for (const entry of openDecisions(expectations)) {
		process.stdout.write(`open decision — ${entry.id}: ${entry.openDecision}\n`);
	}
}

function main() {
	const args = process.argv.slice(2);
	if (args.includes('--help')) {
		process.stdout.write('usage: check-seo-status-contract [--report]\n');
		return 0;
	}

	const expectations = HTTP_STATUS_EXPECTATIONS;
	if (!Array.isArray(expectations) || expectations.length === 0) {
		process.stderr.write('check-seo-status-contract: the status matrix is empty.\n');
		return 2;
	}

	if (args.includes('--report')) report(expectations);

	const routeTreeSource = readOrExit(ROUTE_TREE);
	const { routes } = parseRouteTree(routeTreeSource);
	const routePaths = routes.map((route) => route.path);

	const violations = [
		...checkRouteCoverage(routePaths, expectations),
		...checkProofWiring(expectations, readProofFiles()),
	];

	if (violations.length > 0) {
		for (const violation of violations) {
			process.stderr.write(`[${violation.code}] ${violation.message}\n`);
		}
		process.stderr.write(
			`check-seo-status-contract: ${violations.length} violation(s); the HTTP status contract is NOT exhaustive.\n`,
		);
		return 1;
	}

	const { cases, byStatus, open } = summarize(expectations);
	const breakdown = Object.entries(byStatus)
		.sort(([a], [b]) => Number(a) - Number(b))
		.map(([status, count]) => `${status}×${count}`)
		.join(', ');
	process.stdout.write(
		`seo status contract OK: ${cases} cases (${breakdown}) over ${routePaths.length} routes, ` +
			`${open} row(s) with a recorded open decision\n`,
	);
	return 0;
}

process.exit(main());
