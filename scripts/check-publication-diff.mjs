#!/usr/bin/env node
/**
 * check-publication-diff — pre-publication snapshot gate (Issue #505).
 *
 * Two modes, both deterministic and read-only with respect to the
 * source tree:
 *
 *   node scripts/check-publication-diff.mjs            # check (CI)
 *   node scripts/check-publication-diff.mjs --write    # record the
 *                                                      # proposed surface
 *
 * Check mode fails closed when any of these hold:
 *
 *   1. an invariant finding (undeclared route file, loopback URL,
 *      credential-bearing URL, http:// on a dereferenced host),
 *   2. a public URL disappeared since the committed snapshot,
 *   3. a surface was reclassified in either direction,
 *   4. a new external host appears in shipped source,
 *   5. no snapshot is committed yet,
 *   6. the committed report no longer matches the surface — i.e.
 *      the surface changed and nobody re-recorded the evidence.
 *
 * Rule 2 is the DoD's "review required" state: additions are
 * reviewable information (W004), removals are an error, because a
 * silently disappearing page is exactly the failure mode a
 * pre-publication comparison exists to catch.
 *
 * Exit codes: 0 = pass / review, 1 = fail, 2 = bad input.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ROUTE_DIR_INERT_FILES,
	SCAN_EXTENSIONS,
	SCAN_ROOTS,
	buildSurface,
	canonicalOriginFromSource,
	diffSurfaces,
	invariantFindings,
	parseSnapshot,
	renderHtmlReport,
	renderMarkdownReport,
	serializeSnapshot,
	serializeSurfaceCore,
	transitionOf,
	verdictOf,
} from './publication-surface.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Tracked artefacts. Both are pure functions of the surface, so `--check` byte-compares them. */
export const SNAPSHOT_RELATIVE_PATH = 'docs/verification/content/publication-surface.snapshot.json';
export const REPORT_RELATIVE_PATH = 'docs/verification/content/publication-diff-report.md';

const ORIGIN_SOURCE_RELATIVE_PATH = 'src/editorial/nav/route-labels.ts';
const WORKER_ENTRY_RELATIVE_PATH = 'src/server.ts';
const PORTFOLIO_SEED_RELATIVE_PATH = 'src/portfolio/seed.ts';
const TOOLS_MANIFEST_RELATIVE_PATH = 'src/tools/manifest.json';

function walk(dir, onFile) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, onFile);
		else onFile(full);
	}
}

/** Repo-relative POSIX path. */
const rel = (full) => relative(repoRoot, full).split('\\').join('/');

/** Every file the auto-router could turn into a route. */
export function collectRouteFiles() {
	const routesRoot = join(repoRoot, 'src/routes');
	if (!existsSync(routesRoot)) return [];
	const files = [];
	walk(routesRoot, (full) => {
		const name = rel(full);
		if (name.endsWith('.d.ts')) return;
		if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return;
		if (ROUTE_DIR_INERT_FILES.includes(name)) return;
		if (name.includes('.test.')) return;
		files.push(name);
	});
	return files.sort();
}

/**
 * Shipped source files scanned for absolute URLs. Test files are
 * excluded — a fixture URL is not a published URL, and including
 * them would make every new test a diff.
 */
export function collectSourceFiles() {
	const files = [];
	for (const scanRoot of SCAN_ROOTS) {
		const full = join(repoRoot, scanRoot);
		if (!existsSync(full)) continue;
		walk(full, (file) => {
			const name = rel(file);
			if (!SCAN_EXTENSIONS.some((ext) => name.endsWith(ext))) return;
			if (name.includes('.test.')) return;
			files.push({ path: name, text: readFileSync(file, 'utf8') });
		});
	}
	return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Compute the publication surface of the working tree. */
export function readCurrentSurface() {
	return buildSurface({
		routeFiles: collectRouteFiles(),
		sourceFiles: collectSourceFiles(),
		origin: canonicalOriginFromSource(
			readFileSync(join(repoRoot, ORIGIN_SOURCE_RELATIVE_PATH), 'utf8'),
		),
		portfolioSeedSource: readFileSync(join(repoRoot, PORTFOLIO_SEED_RELATIVE_PATH), 'utf8'),
		toolsManifest: JSON.parse(readFileSync(join(repoRoot, TOOLS_MANIFEST_RELATIVE_PATH), 'utf8')),
		workerEntrySource: readFileSync(join(repoRoot, WORKER_ENTRY_RELATIVE_PATH), 'utf8'),
	});
}

/** The committed snapshot, or `null` when none exists yet. */
export function readBaseline(root = repoRoot) {
	const full = resolve(root, SNAPSHOT_RELATIVE_PATH);
	if (!existsSync(full)) return null;
	return parseSnapshot(readFileSync(full, 'utf8'));
}

function parseArgs(argv) {
	const write = argv.includes('--write');
	const htmlIndex = argv.indexOf('--html');
	const htmlPath = htmlIndex >= 0 ? argv[htmlIndex + 1] : null;
	if (htmlIndex >= 0 && !htmlPath) {
		throw new Error('--html requires an output path');
	}
	if (argv.some((arg) => arg.startsWith('--') && !['--write', '--html'].includes(arg))) {
		throw new Error('unknown argument (expected only --write / --html <path>)');
	}
	return { write, htmlPath };
}

/** Print findings; errors go to stderr so CI surfaces them. */
function reportFindings(findings) {
	for (const finding of findings) {
		const line = `[check-publication-diff] ${finding.severity.toUpperCase()} ${finding.code} ${finding.message}`;
		if (finding.severity === 'error') console.error(line);
		else console.log(line);
	}
}

/** A delta finding re-labelled as "approved transition" for write mode. */
function toApprovedTransition(finding) {
	return { ...finding, severity: 'approved' };
}

/** Shared tail: verdict line + exit code. */
function finish(blockingFindings, diff, current) {
	const verdict = verdictOf(blockingFindings);
	console.log(
		`[check-publication-diff] ${verdict.toUpperCase()}: ${current.sitemap.length} public URLs, +${diff.addedPublicUrls.length}/-${diff.removedPublicUrls.length}, external hosts +${diff.addedExternalHosts.length}/-${diff.removedExternalHosts.length}`,
	);
	if (verdict === 'fail') {
		process.exitCode = 1;
		return;
	}
	console.log(
		`[check-publication-diff] evidence: ${SNAPSHOT_RELATIVE_PATH}, ${REPORT_RELATIVE_PATH}`,
	);
}

function main(argv) {
	const { write, htmlPath } = parseArgs(argv);
	const current = readCurrentSurface();
	const baseline = readBaseline();
	const baselineSurface = baseline ? baseline.surface : null;
	const diff = diffSurfaces({ baseline: baselineSurface, current });
	const invariant = invariantFindings(current);

	// The report describes the surface that is being published plus the
	// transition that was approved to reach it. On a first run there is
	// no snapshot yet, so it describes the surface with an empty delta.
	const reported = baselineSurface ?? current;
	const transition = baseline
		? baseline.approvedTransition
		: transitionOf({ ...diff, findings: diff.findings.filter((f) => f.code !== 'E010') });
	const reportText = renderMarkdownReport({ surface: reported, transition });

	if (htmlPath) {
		writeFileSync(resolve(repoRoot, htmlPath), renderHtmlReport({ surface: reported, transition }));
		console.log(`[check-publication-diff] HTML report written: ${htmlPath}`);
	}

	if (write) {
		// On the very first record there is no previous snapshot, so the
		// E010 "snapshot missing" delta finding is the expected outcome,
		// not a finding worth printing or storing as evidence.
		const recordedTransition = transitionOf({
			...diff,
			findings: baseline === null ? diff.findings.filter((f) => f.code !== 'E010') : diff.findings,
		});
		writeFileSync(
			resolve(repoRoot, SNAPSHOT_RELATIVE_PATH),
			serializeSnapshot(current, recordedTransition),
		);
		writeFileSync(resolve(repoRoot, REPORT_RELATIVE_PATH), reportText);
		console.log(
			`[check-publication-diff] recorded: ${current.sitemap.length} sitemap targets, ${current.externalHosts.length} external hosts, ${current.firstPartyHosts.length} first-party hosts`,
		);
		// Recording IS the approval act, so the delta findings are what
		// the author just approved — they are reported, not blocking.
		// Only the surface invariants (undeclared route file, loopback /
		// credential-bearing / insecure URL) still fail a write, because
		// recording a broken surface must not be a way to make it green.
		reportFindings([...invariant, ...recordedTransition.findings.map(toApprovedTransition)]);
		finish(invariant, diff, current);
		return;
	}

	const findings = [...invariant, ...diff.findings];

	// Rule 6: the committed evidence must describe the surface that is
	// actually shipping. `--write` already put the fresh text on disk, so
	// this comparison passes by construction for the writer and stays
	// meaningful for CI.
	const surfaceStale =
		baselineSurface === null ||
		serializeSurfaceCore(current) !== serializeSurfaceCore(baselineSurface);
	const reportPath = resolve(repoRoot, REPORT_RELATIVE_PATH);
	const reportStale = !existsSync(reportPath) || readFileSync(reportPath, 'utf8') !== reportText;
	// E010 already names the remedy when no snapshot exists yet; do not
	// repeat it as E011 on the very first run.
	if ((surfaceStale || reportStale) && baseline !== null) {
		findings.push({
			code: 'E011 stale-report',
			severity: 'error',
			message: `The recorded publication evidence is stale (snapshot: ${surfaceStale ? 'stale' : 'current'}, report: ${reportStale ? 'stale' : 'current'}). The surface changed without re-recording it — run \`pnpm run publication:write\` and commit ${SNAPSHOT_RELATIVE_PATH} + ${REPORT_RELATIVE_PATH}.`,
		});
	}

	reportFindings(findings);
	finish(findings, diff, current);
}

try {
	main(process.argv.slice(2));
} catch (error) {
	process.stderr.write(`[check-publication-diff] unusable input: ${error.message}\n`);
	process.exitCode = 2;
}
