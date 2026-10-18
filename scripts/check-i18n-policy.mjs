#!/usr/bin/env node

/**
 * check-i18n-policy — enforce the Unicode / slug policy on the shipped
 * surface (Issue #433).
 *
 * What this gate is for
 * ---------------------
 * `src/i18n/` states the policy; this gate is what stops the rest of
 * `src/` from quietly undoing it. Every rule below corresponds to a
 * decision recorded in `docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md`:
 *
 *   no-compatibility-fold      NFKC / NFKD are lossy (U+00B5 -> U+03BC,
 *                              U+FB01 -> "fi", U+2460 -> "1"), so they
 *                              are not used to build text or URLs.
 *   no-implicit-normalize      display text is stored and rendered as
 *                              authored; the only fold the platform
 *                              performs is the NFC comparison key inside
 *                              `src/i18n`.
 *   explicit-locale            `toLocaleString()` / `new Intl.X()`
 *                              without a locale argument inherits the
 *                              VISITOR's environment, which makes a
 *                              number or a date change meaning depending
 *                              on who is looking. Locale is opt-in, and
 *                              opt-in means named.
 *   no-lossy-derivation        no `slugify` / `deburr` /
 *                              `transliterate`-shaped helper: a slug is
 *                              authored, not derived from a title.
 *
 * Scope: `src/**` — the code that reaches the Worker bundle and the
 * visitor. `scripts/` is intentionally out of scope: the Issue #433
 * capture script has to contain a counterfactual "what a naive
 * slugifier would do" column, and a gate that flagged its own
 * evidence generator would only teach people to disable it.
 *
 * Test files are exempt: a test may build an NFD fixture or call a
 * locale API while proving that the shipped surface does not.
 *
 * Exit codes: 0 = clean, 1 = violations, 2 = bad input.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = join(REPO_ROOT, 'src');

/**
 * The obligation that owns the policy. Its own implementation may name
 * the forbidden forms in order to report them.
 */
const POLICY_OWNER = 'src/i18n';

/** Path fragments that are generated or framework-owned. */
const SKIP_SEGMENTS = ['routeTree.gen.ts'];

/** File suffixes exempt from the scan (see the scope note above). */
const EXEMPT_SUFFIXES = [
	'.test.ts',
	'.test.tsx',
	'.spec.ts',
	'.spec.tsx',
	'.stories.ts',
	'.stories.tsx',
];

/** Every rule, with the pattern that detects a violation. */
export const RULES = [
	{
		id: 'no-compatibility-fold',
		pattern: /(['"`])NFK[CD]\1/g,
		message:
			'compatibility normalization is refused (Issue #433): NFKC/NFKD rewrite letters, digits and units',
	},
	{
		id: 'no-implicit-normalize',
		pattern: /\.normalize\s*\(/g,
		message:
			'display text is preserved as authored; only src/i18n may fold (and only NFC, for comparison)',
	},
	{
		id: 'explicit-locale',
		pattern: /\btoLocale(?:String|DateString|TimeString)\s*\(\s*\)/g,
		message:
			'pass an explicit locale: a bare call inherits the visitor environment and changes what a number or date means',
	},
	{
		id: 'intl-without-locale',
		pattern: /\bnew\s+Intl\.[A-Za-z]+\s*\(\s*\)/g,
		message:
			'new Intl.X() needs an explicit locale argument (Issue #433): locale is opt-in, and opt-in means named',
	},
	{
		id: 'no-lossy-derivation',
		pattern: /\b(?:slugify|deburr|transliterate|unidecode|removeAccents|stripDiacritics)\s*\(/g,
		message:
			'URL slugs are authored, never derived from display text; a lossy derivation merges distinct words onto one URL',
	},
];

/**
 * Remove comments so a rule cannot fire on prose. `docs/` and source
 * comments are allowed to NAME the forbidden forms — that is how the
 * next reader learns why they are forbidden — while the code itself is
 * what has to obey.
 *
 * A small scanner rather than a regex: `'https://…'` must not be read
 * as a line comment. Newlines inside a block comment are preserved so
 * that a reported line number matches the file. Exported for unit
 * testing.
 */
export function stripComments(source) {
	let out = '';
	let i = 0;
	/** Last significant character emitted, used to tell regex from division. */
	let previous = '';
	while (i < source.length) {
		const char = source[i];
		const next = source[i + 1];
		if (char === '/' && next === '/') {
			while (i < source.length && source[i] !== '\n') i += 1;
			continue;
		}
		if (char === '/' && next === '*') {
			i += 2;
			let newlines = 0;
			while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
				if (source[i] === '\n') newlines += 1;
				i += 1;
			}
			i += 2;
			// Keep the line count so a violation is reported on the line
			// the developer actually sees in the file.
			out += '\n'.repeat(newlines);
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			const quote = char;
			out += char;
			i += 1;
			while (i < source.length) {
				out += source[i];
				if (source[i] === '\\') {
					out += source[i + 1] ?? '';
					i += 2;
					continue;
				}
				if (source[i] === quote) {
					i += 1;
					break;
				}
				i += 1;
			}
			previous = quote;
			continue;
		}
		if (char === '/' && /[(,=:[!&|?{};+\-*%^~<>]/.test(previous)) {
			// Regex literal: copy to the closing unescaped slash.
			out += char;
			i += 1;
			while (i < source.length) {
				out += source[i];
				if (source[i] === '\\') {
					out += source[i + 1] ?? '';
					i += 2;
					continue;
				}
				if (source[i] === '/') {
					i += 1;
					break;
				}
				if (source[i] === '\n') break;
				i += 1;
			}
			previous = '/';
			continue;
		}
		out += char;
		if (!/\s/.test(char)) previous = char;
		i += 1;
	}
	return out;
}

/** Repo-relative POSIX path for a scanned file. */
export function toScanPath(absolutePath) {
	return relative(REPO_ROOT, absolutePath).split(sep).join('/');
}

/** Whether a repo-relative path is scanned at all. */
export function isScanned(scanPath) {
	if (!scanPath.startsWith('src/')) return false;
	if (scanPath.startsWith(`${POLICY_OWNER}/`)) return false;
	if (SKIP_SEGMENTS.some((segment) => scanPath.endsWith(segment))) return false;
	if (EXEMPT_SUFFIXES.some((suffix) => scanPath.endsWith(suffix))) return false;
	return true;
}

/** 1-based line number of `index` inside `source`. */
export function lineAt(source, index) {
	let line = 1;
	for (let i = 0; i < index && i < source.length; i += 1) {
		if (source[i] === '\n') line += 1;
	}
	return line;
}

/** Scan one file's source; returns one violation per match. */
export function scanSource(scanPath, source) {
	if (!isScanned(scanPath)) return [];
	const code = stripComments(source);
	const violations = [];
	for (const rule of RULES) {
		const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
		let match = pattern.exec(code);
		while (match !== null) {
			violations.push({
				rule: rule.id,
				file: scanPath,
				line: lineAt(code, match.index),
				snippet: code
					.slice(match.index, match.index + 40)
					.split('\n')[0]
					.trim(),
				message: rule.message,
			});
			match = pattern.exec(code);
		}
	}
	return violations.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** Every scannable file under `src/`. */
export function collectScanFiles(directory = SRC_ROOT) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectScanFiles(path));
			continue;
		}
		if (!['.ts', '.tsx'].includes(path.slice(path.lastIndexOf('.')))) continue;
		files.push(path);
	}
	return files;
}

/** One human-readable line per violation. */
export function formatViolation(violation) {
	return `${violation.file}:${violation.line} [${violation.rule}] ${violation.message} — saw: ${violation.snippet}`;
}

/**
 * Load the shipped policy so the gate also reports the shared decision
 * table. Importing the product's own modules is the point: the fixture
 * evidence in CI is produced by the same code the Worker ships.
 */
export async function loadPolicy() {
	try {
		const [unicode, slugIdentity, fixtures, reactions, portfolio] = await Promise.all([
			import('../src/i18n/unicode.ts'),
			import('../src/i18n/slug-identity.ts'),
			import('../src/i18n/fixtures.ts'),
			import('../src/reactions/slug-regex.ts'),
			import('../src/portfolio/schema.ts'),
		]);
		return { unicode, slugIdentity, fixtures, reactions, portfolio };
	} catch (error) {
		throw new Error(
			`cannot load the shipped i18n policy (${error.message}). This gate imports the TypeScript sources directly, which needs Node >= 22.18 (the version in package.json#engines and in CI).`,
		);
	}
}

/** Classify every fixture row with the shipped grammars. */
export function summarizeFixtures(policy) {
	const grammars = {
		'emoji-slug': policy.reactions.EMOJI_SLUG_GRAMMAR,
		'portfolio-slug': policy.portfolio.PORTFOLIO_SLUG_GRAMMAR,
	};
	return policy.fixtures.UNICODE_FIXTURES.map((fixture) => ({
		id: fixture.id,
		subject: fixture.subject,
		displayForm: policy.unicode.describeUnicode(fixture.displayText).form,
		compatFoldRisk: policy.unicode.describeUnicode(fixture.displayText)
			.changesUnderCompatibilityFold,
		candidate: fixture.slugCandidate,
		verdicts: Object.entries(grammars).map(([name, grammar]) => {
			const verdict = policy.slugIdentity.classifySlugCandidate(fixture.slugCandidate, grammar);
			return {
				grammar: name,
				ok: verdict.ok,
				reason: verdict.ok ? null : verdict.reason,
				expected: fixture.expectations.find((entry) => entry.grammar === name),
			};
		}),
	}));
}

/** Fixture rows whose shipped verdict disagrees with the declared one. */
export function fixtureMismatches(rows) {
	const mismatches = [];
	for (const row of rows) {
		for (const verdict of row.verdicts) {
			const expected = verdict.expected;
			if (!expected) {
				mismatches.push(`${row.id}: ${verdict.grammar} has no declared expectation`);
				continue;
			}
			const actual = verdict.ok ? 'accepted' : 'rejected';
			if (actual !== expected.outcome || (verdict.reason ?? null) !== (expected.reason ?? null)) {
				mismatches.push(
					`${row.id} / ${verdict.grammar}: expected ${expected.outcome}${
						expected.reason ? `:${expected.reason}` : ''
					}, got ${actual}${verdict.reason ? `:${verdict.reason}` : ''}`,
				);
			}
		}
	}
	return mismatches;
}

function usage() {
	process.stderr.write(
		'usage: check-i18n-policy.mjs [--quiet]\n' +
			'  --quiet  print only violations and the final summary\n',
	);
}

/**
 * The fixture section of the gate output, as lines.
 *
 * Shared by the CLI and by the Issue #433 capture script so the report
 * and CI print the same evidence from the same data.
 */
export async function renderGateSummary() {
	const policy = await loadPolicy();
	const rows = summarizeFixtures(policy);
	const mismatches = fixtureMismatches(rows);
	const lines = ['[i18n:policy:check] shared decision table (src/i18n/fixtures.ts)'];
	for (const row of rows) {
		const verdicts = row.verdicts
			.map((verdict) =>
				verdict.ok ? `${verdict.grammar}: accept` : `${verdict.grammar}: refuse(${verdict.reason})`,
			)
			.join(' | ');
		lines.push(
			`  ${row.id.padEnd(32)} form=${row.displayForm.padEnd(4)} nfkc-risk=${String(row.compatFoldRisk).padEnd(5)} ${verdicts}`,
		);
	}
	lines.push('');
	lines.push(`[i18n:policy:check] ${rows.length} fixture rows classified with the shipped grammars`);
	if (mismatches.length > 0) {
		lines.push(`[i18n:policy:check] ${mismatches.length} fixture row(s) disagree with the shipped policy`);
	}
	return { lines, rows, mismatches };
}

/** Formatted violations across the whole `src/` tree (empty when clean). */
export function scanAllViolations() {
	const files = collectScanFiles();
	const violations = files.flatMap((file) =>
		scanSource(toScanPath(file), readFileSync(file, 'utf8')),
	);
	return violations.map(formatViolation);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.some((arg) => arg === '--help' || arg === '-h')) {
		usage();
		return 0;
	}
	if (args.some((arg) => arg !== '--quiet')) {
		usage();
		return 2;
	}
	const quiet = args.includes('--quiet');

	let srcStats;
	try {
		srcStats = statSync(SRC_ROOT);
	} catch {
		process.stderr.write(`missing src/ directory: ${SRC_ROOT}\n`);
		return 2;
	}
	if (!srcStats.isDirectory()) {
		process.stderr.write(`src/ is not a directory: ${SRC_ROOT}\n`);
		return 2;
	}

	const violations = scanAllViolations();
	const { lines, rows, mismatches } = await renderGateSummary();

	if (!quiet) {
		process.stdout.write(`${lines.join('\n')}\n`);
	}

	if (violations.length > 0) {
		process.stderr.write('\n[i18n:policy:check] policy violations in the shipped surface:\n');
		for (const violation of violations) process.stderr.write(`- ${violation}\n`);
	}
	if (mismatches.length > 0) {
		process.stderr.write('\n[i18n:policy:check] fixture rows disagree with the shipped policy:\n');
		for (const mismatch of mismatches) process.stderr.write(`- ${mismatch}\n`);
	}

	if (violations.length + mismatches.length > 0) {
		process.stderr.write(
			`\n[i18n:policy:check] FAILED: ${violations.length} source violation(s), ${mismatches.length} fixture mismatch(es) (Issue #433, ADR-0017)\n`,
		);
		return 1;
	}

	process.stdout.write(
		`[i18n:policy:check] OK: ${collectScanFiles().length} scanned file(s), no implicit normalization, no compatibility fold, every locale explicit\n`,
	);
	return 0;
}

// Imported by the Issue #433 capture script, which renders the same
// evidence; only the CLI invocation runs the gate.
const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
	process.exitCode = await main();
}