#!/usr/bin/env node
/**
 * check-index-boundary — the index boundary gate (Issue #423).
 *
 * Verifies that the three surfaces which decide search-engine index
 * state agree with each other, and that each is individually sane:
 *
 *   1. `GET /robots.txt`     — crawl instructions (Disallow) + the
 *                              canonical `Sitemap:` directive. Served by
 *                              `src/http/seo/router.ts` (Issue #420);
 *                              this gate reads the exact body that route
 *                              renders, so there is no second copy to
 *                              drift.
 *   2. `GET /sitemap.xml`    — the set of URLs offered for indexing
 *                              (static inventory; the portfolio project's
 *                              published rows are appended at request
 *                              time and belong to `src/portfolio`).
 *   3. the route modules' own `<meta name="robots">` — per-page
 *      noindex, which is the ONLY mechanism that actually de-indexes a
 *      URL.
 *
 * The intent contract lives in `scripts/_index-boundary.mjs`; this file
 * is the filesystem adapter and the CLI. Exit codes:
 *
 *   0  boundary consistent
 *   1  at least one violation (one line per violation, code + message)
 *   2  bad input (missing file, unreadable route tree)
 *
 * Usage:
 *   node scripts/check-index-boundary.mjs            # verify (gate mode)
 *   node scripts/check-index-boundary.mjs --report   # print the intent table
 *
 * There is no `--write`: this gate never writes a crawler-facing
 * document. `src/http/seo/` owns delivery (see the module header of
 * `scripts/_index-boundary.mjs` for why a committed `public/robots.txt`
 * would shadow that route instead of complementing it).
 *
 * Route inventory source: the COMMITTED `src/routeTree.gen.ts`. The
 * TanStack Vite plugin regenerates that file during `pnpm run build`,
 * and `validate:integration` runs this gate inside `validate:fast`,
 * i.e. BEFORE the build. The gate therefore validates the inventory
 * that is under version control, which is the point (a route added to
 * `src/routes/**` but not committed has not shipped), and a plugin
 * output change surfaces as the normal `routeTree.gen.ts` diff.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateIndexBoundary, routeModuleCandidates } from './_index-boundary.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PATHS = {
	routeTree: join(REPO_ROOT, 'src/routeTree.gen.ts'),
	server: join(REPO_ROOT, 'src/server.ts'),
};

function readOrExit(path) {
	try {
		return readFileSync(path, 'utf8');
	} catch (error) {
		process.stderr.write(`check-index-boundary: cannot read ${path}: ${error.message}\n`);
		process.exit(2);
	}
}

/**
 * The crawler documents as the SEO router renders them.
 *
 * `src/http/seo/sitemap.ts` is deliberately import-free (it has to stay
 * unit-testable without workerd, D1 or the Worker bundle), which is
 * exactly what makes it safe to read from here: this is the owner's
 * real output, not a transcription of it. Node's type stripping is what
 * lets a plain script consume the TypeScript source — the same trick
 * `scripts/check-sitemap-route-coverage.test.mjs` uses, and the reason
 * the package.json script carries `--experimental-strip-types`.
 */
async function servedDocuments() {
	const modulePath = join(REPO_ROOT, 'src/http/seo/sitemap.ts');
	try {
		const seo = await import(pathToFileURL(modulePath).href);
		return {
			robotsTxt: seo.renderRobotsTxt(),
			sitemapPaths: seo.SITEMAP_ENTRIES.map((entry) => entry.path),
			sitemapOrigin: seo.SITEMAP_ORIGIN,
		};
	} catch (error) {
		process.stderr.write(
			`check-index-boundary: cannot read the served crawler documents from ${modulePath}: ${error.message}\nRun this script with \`node --experimental-strip-types\` (see package.json#index:boundary:check).\n`,
		);
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

async function main() {
	const args = process.argv.slice(2);
	const showReport = args.includes('--report');
	if (args.includes('--write')) {
		process.stderr.write(
			'check-index-boundary: --write was removed. The crawler documents are rendered by ' +
				'`src/http/seo/router.ts`; edit that module, not a generated file.\n',
		);
		return 2;
	}

	const routeTreeSource = readOrExit(PATHS.routeTree);
	const serverSource = readOrExit(PATHS.server);
	const documents = await servedDocuments();

	const result = evaluateIndexBoundary({
		routeTreeSource,
		serverSource,
		robotsTxt: documents.robotsTxt,
		sitemapPaths: documents.sitemapPaths,
		sitemapOrigin: documents.sitemapOrigin,
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

process.exit(await main());
