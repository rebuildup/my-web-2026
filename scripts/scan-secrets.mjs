#!/usr/bin/env node
/**
 * `scan-secrets.mjs` — deterministic pre-merge credential gate
 * (Issue #475).
 *
 * What this closes
 * ----------------
 * The repository's only credential gate was GitHub Push Protection,
 * which `quality/profile.yaml#security_gates.secret_scanning` records as
 * `mode: asynchronous`: the review happens after the push lands. A public
 * repository whose runtime secret SoT is Infisical (ADR-0015 §1) and
 * whose delivery is Cloudflare Workers Builds needs the check to run
 * BEFORE the merge, in the same job as `validate:integration`, so a
 * credential in a diff is a red PR rather than a post-hoc incident.
 *
 * What it scans
 * -------------
 *   1. every tracked source file (`git ls-files`) — a superset of the
 *      PR's changed files, so a credential cannot be smuggled in by
 *      being "not changed";
 *   2. the build bundle (Vite client output, the cf Build Output, the
 *      staged bundle copy) when those directories exist — a secret can
 *      enter the shipped artifact through build-time inlining even when
 *      no source file matches.
 *
 * Both scans are pure-local: no network, no env reads, no remote calls.
 *
 * Usage
 * -----
 *   node scripts/scan-secrets.mjs                 # source + bundle if present
 *   node scripts/scan-secrets.mjs --bundle        # bundle artifacts only
 *   node scripts/scan-secrets.mjs --self-test     # dummy-credential proof
 *   node scripts/scan-secrets.mjs --report=<path> # write the HTML report
 *   node scripts/scan-secrets.mjs --json          # machine-readable findings
 *
 * Exit codes: 0 = clean, 1 = findings, 2 = the scan could not run.
 *
 * The disclosure invariant (AGENTS.md §4)
 * --------------------------------------
 * This script never prints a matched value. Findings are emitted through
 * `_secret-scan.mjs#describeMatch`: path, line, detector id, value
 * length, SHA-256 prefix. `--json` carries the same fields. A scanner
 * whose log line contains the credential it just found is a credential
 * exfiltration primitive with extra steps, so the report format is part
 * of the security contract, not a cosmetic choice.
 *
 * The `--self-test` mode is the Issue #475 completion evidence: it
 * builds SYNTHETIC fixtures (repeated-character dummies, e.g.
 * `mk_home_` followed by 32 `D`s — recognisable as fake at a glance),
 * asserts the gate goes red on them and green on the clean fixture, and
 * never touches a tracked file.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	ALLOWLIST,
	DETECTORS,
	describeMatch,
	partition,
	renderHtmlReport,
	scanContent,
} from './_secret-scan.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Build artifact roots, scanned when they exist. */
const BUNDLE_DIRS = ['dist', '.cloudflare/output', 'dist-cloudflare'];

/**
 * Files above this size are skipped in the bundle scan and reported as
 * skipped. Minified bundles are large but bounded; an unbounded read is
 * a memory risk, and silently skipping would make the gate lie about
 * coverage.
 */
const MAX_BYTES = 8 * 1024 * 1024;

function parseArgs(argv) {
	const options = {
		bundleOnly: false,
		selfTest: false,
		json: false,
		report: null,
		quiet: false,
	};
	for (const arg of argv) {
		if (arg === '--bundle') options.bundleOnly = true;
		else if (arg === '--self-test') options.selfTest = true;
		else if (arg === '--json') options.json = true;
		else if (arg === '--quiet') options.quiet = true;
		else if (arg.startsWith('--report=')) options.report = resolve(arg.slice('--report='.length));
		else if (arg === '--report') {
			const index = argv.indexOf(arg);
			options.report = resolve(argv[index + 1] ?? 'secret-scan-report.html');
		} else if (arg === '--help' || arg === '-h') options.help = true;
		else throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

/**
 * Repository source surface, NUL-separated so a path with a space cannot
 * break parsing.
 *
 * `untracked` is the other half of that surface: files that are not yet in
 * the index but are also not ignored. A credential sitting in a worktree
 * file that is one `git add` away from being committed is worth catching
 * while the operator is still looking at it, and `--exclude-standard` is
 * what keeps `.dev.vars`, `dist/`, `.tmp/` and every other gitignored path
 * out of the scan by construction — no second ignore list to maintain.
 */
function repoFiles() {
	const list = (args) => {
		try {
			return execFileSync('git', args, {
				cwd: REPO_ROOT,
				encoding: 'utf8',
				maxBuffer: 32 * 1024 * 1024,
			})
				.split('\0')
				.filter(Boolean);
		} catch (error) {
			throw new Error(
				`git ${args.join(' ')} failed in ${REPO_ROOT} (${error.message}). The scan needs a git worktree; it does not guess a file set.`,
			);
		}
	};
	return {
		tracked: list(['ls-files', '-z']),
		untracked: list(['ls-files', '--others', '--exclude-standard', '-z']),
	};
}

function walk(directory) {
	const entries = readdirSync(directory, { withFileTypes: true });
	const nested = entries.map((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return walk(path);
		return entry.isFile() ? [path] : [];
	});
	return nested.flat();
}

/** Bundle files that exist right now, with the per-file skip notes. */
function bundleFiles() {
	const files = [];
	const skipped = [];
	const missing = [];
	for (const dir of BUNDLE_DIRS) {
		const absolute = join(REPO_ROOT, dir);
		if (!existsSync(absolute)) {
			missing.push(dir);
			continue;
		}
		for (const path of walk(absolute)) {
			const size = statSync(path).size;
			if (size > MAX_BYTES) {
				skipped.push(`${dir}/${relative(REPO_ROOT, path).split(sep).join('/')} (${size} bytes)`);
				continue;
			}
			files.push(path);
		}
	}
	return { files, skipped, missing };
}

async function scanTracked(mode) {
	const { tracked, untracked } = repoFiles();
	const violations = [];
	let scanned = 0;
	let trackedCount = 0;
	let untrackedCount = 0;
	for (const [paths, isTracked] of [
		[tracked, true],
		[untracked, false],
	]) {
		for (const relativePath of paths) {
			const absolute = join(REPO_ROOT, relativePath);
			// A gitlink (submodule entry, e.g. `external/readmark`) is listed by
			// `git ls-files` but is a directory here — and in a checkout without
			// submodules it may not exist at all. Neither is scannable.
			if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
			scanned++;
			if (isTracked) trackedCount++;
			else untrackedCount++;
			violations.push(...(await scanContent(relativePath, readFileSync(absolute), { mode })));
		}
	}
	return { violations, scanned, trackedCount, untrackedCount };
}

async function scanBundles() {
	const { files, skipped, missing } = bundleFiles();
	const violations = [];
	for (const absolute of files) {
		const relativePath = relative(REPO_ROOT, absolute).split(sep).join('/');
		violations.push(
			...(await scanContent(relativePath, readFileSync(absolute), { mode: 'bundle' })),
		);
	}
	return { violations, scanned: files.length, skipped, missing };
}

/**
 * Synthetic fixtures for the `--self-test` proof.
 *
 * Every value is a repeated dummy character so it is obviously fake and
 * cannot be confused with an issued credential. They are written to an
 * OS temp directory and deleted by the caller; nothing is written into
 * the repository and nothing is committed.
 */
export function selfTestFixtures() {
	const dummyHex = '0'.repeat(48);
	return {
		// NB: the fixture VALUES avoid placeholder vocabulary on purpose
		// (`dummy`, `fake`, `example`, … are exactly what
		// `looksLikeCredentialValue` is designed to reject), so a passing
		// self-test proves the VALUE filter is not doing the detecting.
		clean: [
			{
				path: 'src/example/clean.ts',
				content: [
					'// A credential-NAME reference is not a credential.',
					'const token = env.MY_WEB_2026_CONSUMER_API_KEY;',
					'const marker = "mk_home_placeholder";',
					'const sample = "BETTER_AUTH_SECRETS=1:abc";',
					'',
				].join('\n'),
			},
		],
		dirty: [
			{
				path: 'src/example/leaked-key.ts',
				content: [
					'// Synthetic fixture for the Issue #475 detector test.',
					'const key = "mk_home_DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";',
					'',
				].join('\n'),
			},
			{
				path: 'config/local.env',
				content: [
					'// Synthetic fixture for the Issue #475 assignment test.',
					'INFISICAL_TOKEN=InfsclSyntheticFixtureValueAAA000000',
					'',
				].join('\n'),
			},
			{
				path: 'scripts/r2-key.mjs',
				content: [
					'// Synthetic fixture for the Issue #475 R2-key test.',
					'const r2 = { aws_secret_access_key: "R2SynteticAccessKeyMaterial00A" };',
					'',
				].join('\n'),
			},
			{
				path: '.dev.vars',
				content: [`BETTER_AUTH_SECRETS="1:${dummyHex}"`, ''].join('\n'),
			},
			{
				path: 'src/example/versioned-secret.ts',
				content: [
					'// Synthetic fixture for the Issue #475 versioned-secret test.',
					`const raw = "1:${dummyHex}";`,
					'',
				].join('\n'),
			},
		],
	};
}

/**
 * Prove the gate is red on dummy credentials and green on clean input.
 *
 * Returns `{ cleanFailures, dummyFailures, perFixture }`. The assertion
 * is two-sided on purpose: a scanner that flags everything "detects"
 * nothing, so the clean fixture must stay silent.
 */
export async function runSelfTest() {
	const fixtures = selfTestFixtures();
	const perFixture = [];
	const cleanFailures = [];
	const dummyFailures = [];

	for (const fixture of fixtures.clean) {
		const { failures } = partition(
			await scanContent(fixture.path, fixture.content, { mode: 'source' }),
		);
		cleanFailures.push(...failures);
		perFixture.push({ path: fixture.path, expect: 'clean', failures: failures.length });
	}
	for (const fixture of fixtures.dirty) {
		const { failures } = partition(
			await scanContent(fixture.path, fixture.content, { mode: 'source' }),
		);
		dummyFailures.push(...failures);
		perFixture.push({ path: fixture.path, expect: 'red', failures: failures.length });
	}

	return { cleanFailures, dummyFailures, perFixture, allFixtures: fixtures };
}

function printSelfTest(result) {
	console.log(
		'[scan-secrets] self-test — synthetic dummy fixtures only, no repository file is touched',
	);
	for (const row of result.perFixture) {
		const state =
			row.expect === 'red'
				? row.failures > 0
					? 'DETECTED'
					: 'MISSED  '
				: row.failures === 0
					? 'clean   '
					: 'FALSE+  ';
		console.log(`  [${state}] ${row.path} (${row.failures} finding(s))`);
	}
	for (const failure of result.dummyFailures) {
		console.log(`  ${describeMatch(failure)}`);
	}
	console.log(
		`[scan-secrets] self-test: ${result.dummyFailures.length} finding(s) on dummy credentials, ${result.cleanFailures.length} on clean input`,
	);
}

function printReport(report, options) {
	if (options.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	console.log(
		`[scan-secrets] ${report.target} — ${report.scannedFiles} file(s) scanned, ${report.failures.length} blocking finding(s), ${report.waived.length} waived`,
	);
	if (report.mode !== 'bundle') {
		console.log(
			`[scan-secrets] source surface: ${report.trackedFiles} tracked + ${report.untrackedFiles} untracked-not-ignored`,
		);
	}
	for (const failure of report.failures) console.log(`  ${describeMatch(failure)}`);
	for (const waiver of report.waived) {
		console.log(`  ${describeMatch(waiver)}`);
		console.log(`      waived: ${waiver.allowlistReason}`);
	}
	for (const skip of report.skipped) console.log(`  [skipped] ${skip}`);
	if (report.waived.length > 0) {
		console.log(
			`[scan-secrets] ${report.waived.length} waiver(s) in _secret-scan.mjs ALLOWLIST (${ALLOWLIST.length} entries, each with a reason)`,
		);
	}
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`[scan-secrets] ${error.message}\n`);
		return 2;
	}
	if (options.help) {
		console.log(
			[
				'Usage: node scripts/scan-secrets.mjs [--bundle] [--self-test] [--json] [--report=<path>]',
				'',
				'  (no flag)     scan tracked + untracked-not-ignored files, plus build artifacts when present',
				'  --bundle      scan build artifacts only (used after `pnpm run build:production`)',
				'  --self-test   prove the gate on synthetic dummy credentials (never touches the repo)',
				'  --json        machine-readable findings (same status-only fields)',
				'  --report=<p>  write the self-contained HTML report to <p>',
			].join('\n'),
		);
		return 0;
	}

	if (options.selfTest) {
		const result = await runSelfTest();
		printSelfTest(result);
		const proven =
			result.dummyFailures.length >= result.allFixtures.dirty.length &&
			result.cleanFailures.length === 0;
		if (options.report) {
			mkdirSync(dirname(options.report), { recursive: true });
			writeFileSync(
				options.report,
				renderHtmlReport({
					target:
						'synthetic dummy-credential fixtures (self-test; no repository file is read or written)',
					mode: 'self-test',
					generatedAt: new Date().toISOString(),
					scannedFiles: result.perFixture.length,
					failures: result.dummyFailures,
					waived: [],
					skipped: [],
					disclosureNote:
						'Every value on this page is synthetic (repeated dummy characters), generated by ' +
						'`node scripts/scan-secrets.mjs --self-test`. It exists to prove the gate turns the ' +
						'PR red when a credential-shaped string is present.',
				}),
			);
			console.log(`[scan-secrets] report written to ${options.report}`);
		}
		if (!proven) {
			process.stderr.write(
				'[scan-secrets] self-test FAILED: every dummy fixture must be detected and every clean fixture must stay silent\n',
			);
			return 1;
		}
		return 0;
	}

	const violations = [];
	let scanned = 0;
	let trackedCount = 0;
	let untrackedCount = 0;
	const skipped = [];
	const missing = [];

	if (!options.bundleOnly) {
		const source = await scanTracked('source');
		violations.push(...source.violations);
		scanned += source.scanned;
		trackedCount = source.trackedCount;
		untrackedCount = source.untrackedCount;
	}
	const bundle = await scanBundles();
	violations.push(...bundle.violations);
	scanned += bundle.scanned;
	skipped.push(...bundle.skipped);
	for (const dir of bundle.missing) {
		if (options.bundleOnly) missing.push(dir);
		else skipped.push(`${dir} (not built in this run)`);
	}

	const { failures, waived } = partition(violations);
	const report = {
		target: options.bundleOnly ? 'build artifacts' : 'tracked files + build artifacts',
		mode: options.bundleOnly ? 'bundle' : 'source+bundle',
		generatedAt: new Date().toISOString(),
		scannedFiles: scanned,
		trackedFiles: trackedCount,
		untrackedFiles: untrackedCount,
		failures,
		waived,
		skipped,
		missing,
		detectors: DETECTORS.map((rule) => ({ id: rule.id, mode: rule.mode })),
	};
	if (!options.quiet) printReport(report, options);
	if (options.report) {
		mkdirSync(dirname(options.report), { recursive: true });
		writeFileSync(options.report, renderHtmlReport(report));
		// stderr, so `--json` stdout stays parseable as one JSON document.
		process.stderr.write(`[scan-secrets] report written to ${options.report}\n`);
	}
	return failures.length === 0 ? 0 : 1;
}

try {
	process.exit(await main());
} catch (error) {
	process.stderr.write(`[scan-secrets] ${error.message}\n`);
	process.exit(2);
}
