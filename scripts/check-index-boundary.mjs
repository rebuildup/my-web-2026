#!/usr/bin/env node
/**
 * check-index-boundary — the index boundary gate (Issue #423).
 *
 * Verifies that the three surfaces which decide search-engine index
 * state agree with each other, and that each is individually sane:
 *
 *   1. `public/robots.txt`    — crawl instructions (Disallow) + the
 *                               canonical `Sitemap:` directive.
 *   2. `public/sitemap.xml`   — the set of URLs offered for indexing.
 *   3. the route modules' own `<meta name="robots">` — per-page
 *                               noindex, which is the ONLY mechanism
 *                               that actually de-indexes a URL.
 *
 * The contract lives in `scripts/_index-boundary.mjs`; this file is the
 * filesystem adapter and the CLI. Exit codes:
 *
 *   0  boundary consistent
 *   1  at least one violation (one line per violation, code + message)
 *   2  bad input (missing file, unreadable route tree)
 *
 * Usage:
 *   node scripts/check-index-boundary.mjs            # verify (gate mode)
 *   node scripts/check-index-boundary.mjs --write    # regenerate the artefacts
 *   node scripts/check-index-boundary.mjs --report   # print the intent table
 *
 * `--write` is a maintenance command, not a validation step: the gate
 * always runs in verify mode (`pnpm run index:boundary:check`).
 *
 * Route inventory source: the COMMITTED `src/routeTree.gen.ts`. The
 * TanStack Vite plugin regenerates that file during `pnpm run build`,
 * and `validate:integration` runs this gate inside `validate:fast`,
 * i.e. BEFORE the build. The gate therefore validates the inventory
 * that is under version control, which is the point (a route added to
 * `src/routes/**` but not committed has not shipped), and a plugin
 * output change surfaces as the normal `routeTree.gen.ts` diff.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CANONICAL_ORIGIN,
	buildRobotsTxt,
	buildSitemapXml,
	classifyRoutes,
	evaluateIndexBoundary,
	parseRouteTree,
	routeModuleCandidates,
} from './_index-boundary.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PATHS = {
	routeTree: join(REPO_ROOT, 'src/routeTree.gen.ts'),
	server: join(REPO_ROOT, 'src/server.ts'),
	robots: join(REPO_ROOT, 'public/robots.txt'),
	sitemap: join(REPO_ROOT, 'public/sitemap.xml'),
};

function readOrExit(path) {
	try {
		return readFileSync(path, 'utf8');
	} catch (error) {
		process.stderr.write(`check-index-boundary: cannot read ${path}: ${error.message}\n`);
		process.exit(2);
	}
}

function readRouteFile(specifier) {
	// `src/routeTree.gen.ts` imports route modules without an extension;
	// resolve the first existing candidate so the static meta / canonical
	// checks read the same file the bundler does.
	for (const candidate of routeModuleCandidates(specifier)) {
		try {
			return readFileSync(join(REPO_ROOT, candidate), 'utf8');
		} catch {
			// try the next candidate
		}
	}
	throw new Error(
		`no route module for ${specifier} (tried ${routeModuleCandidates(specifier).join(', ')})`,
	);
}

function report(classified) {
	const rows = classified.map((route) => [
		route.path,
		route.intent.zone,
		route.intent.crawl,
		route.intent.index,
		route.metaFile,
	]);
	const header = ['route', 'zone', 'crawl', 'index', 'meta owner'];
	const widths = header.map((cell, column) =>
		Math.max(cell.length, ...rows.map((row) => row[column].length)),
	);
	const line = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ');
	process.stdout.write(`${line(header)}\n`);
	process.stdout.write(`${line(widths.map((width) => '-'.repeat(width)))}\n`);
	for (const row of rows) process.stdout.write(`${line(row)}\n`);
}

function main() {
	const args = process.argv.slice(2);
	const write = args.includes('--write');
	const showReport = args.includes('--report');

	const routeTreeSource = readOrExit(PATHS.routeTree);
	const serverSource = readOrExit(PATHS.server);

	if (write) {
		const { routes } = parseRouteTree(routeTreeSource);
		const { classified, violations } = classifyRoutes(routes);
		if (violations.length > 0) {
			for (const violation of violations) {
				process.stderr.write(`[${violation.code}] ${violation.message}\n`);
			}
			process.stderr.write(
				'check-index-boundary: refusing to generate artefacts from an incomplete contract.\n',
			);
			process.exit(1);
		}
		mkdirSync(dirname(PATHS.robots), { recursive: true });
		writeFileSync(PATHS.robots, buildRobotsTxt(classified, CANONICAL_ORIGIN));
		writeFileSync(PATHS.sitemap, buildSitemapXml(classified, CANONICAL_ORIGIN));
		process.stdout.write(
			`index boundary: regenerated public/robots.txt and public/sitemap.xml from ${classified.length} routes\n`,
		);
		if (showReport) report(classified);
		return 0;
	}

	const robotsTxt = readOrExit(PATHS.robots);
	const sitemapXml = readOrExit(PATHS.sitemap);

	const result = evaluateIndexBoundary({
		routeTreeSource,
		serverSource,
		robotsTxt,
		sitemapXml,
		readRouteFile,
	});

	if (showReport) report(result.classified);

	if (result.violations.length > 0) {
		for (const violation of result.violations) {
			process.stderr.write(`[${violation.code}] ${violation.message}\n`);
		}
		process.stderr.write(
			`check-index-boundary: ${result.violations.length} violation(s); the index boundary is NOT consistent.\n`,
		);
		return 1;
	}

	const { summary } = result;
	process.stdout.write(
		`index boundary OK: ${summary.routes} routes (${summary.indexable} indexable), ` +
			`${summary.sitemapEntries} sitemap entries, ${summary.disallowRules} Disallow rules, ` +
			`noindex meta on ${summary.noindexRoutes.join(', ') || '<none>'} @ ${summary.origin}\n`,
	);
	return 0;
}

process.exit(main());
