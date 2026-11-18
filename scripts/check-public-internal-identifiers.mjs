#!/usr/bin/env node
/**
 * Issue #837 (O-8) — public-copy internal identifier gate.
 *
 * Visitor-facing copy must not leak repository internals: repo paths
 * (`src/contact/channels.json`), internal schema field names
 * (`verified_at`, `disabled_reason`), internal Issue/PR references
 * (`Issue #123`) and release branch names. The known live violation
 * this gate exists for was `/contact`'s empty state printing
 * `src/contact/channels.json` and `active: true` to visitors.
 *
 * Scope: every file the copy-editorial surface declaration
 * (`quality/copy-editorial-surfaces.json`) calls public copy — the
 * SAME declaration the editorial-approval gate uses, so "public copy"
 * means one thing across gates. Only visitor-facing text is scanned:
 * string literals and JSX text nodes; comments and code identifiers
 * are not copy.
 *
 * Precision rules (Issue #994 follow-up):
 *   - JS/TS comments never contribute candidates. `isCommentLine`
 *     only recognises comment-ONLY lines, so a `//` trailing comment,
 *     a JSX brace-wrapped block comment or a JSDoc block used to leak its text
 *     into the scan. `stripJsComments` removes comments with a small
 *     string/template-aware state machine before candidates are
 *     extracted (it applies to .ts/.tsx/.js/.jsx only — JSON and MDX
 *     have no line-comment syntax).
 *   - URLs never contribute candidates. A repo-path-shaped segment
 *     inside `https://…` is a URL path, not a repository reference
 *     (the Google structured-data docs URL was the live false
 *     positive). `findIdentifiers` blanks `http(s)://…` spans first.
 *   - files named `fixtures.ts` are excluded at the surface
 *     declaration: a fixture module is test data, not visitor copy
 *     (the Discord presence fixtures are imported only by tests).
 *
 * Exceptions are deliberate and reviewable: an entry in
 * `quality/public-internal-identifier-exceptions.json` suppresses a
 * finding ONLY when it names the same file + rule + matched text AND
 * carries `ownerConfirmation: "confirmed"` with a reason and an owner
 * reference. An unconfirmed or reason-less exception does not
 * suppress — the finding still fails, and the ledger entry itself is
 * reported so the gap is visible rather than silent.
 *
 * The baseline (`quality/public-internal-identifier-baseline.json`)
 * records the findings that existed when this gate was introduced and
 * are still awaiting owner triage (deliberate citations, provenance
 * fields, unrendered literals). A baselined finding is reported as
 * PENDING-REVIEW, never as approved: it does not fail the gate, but it
 * also does not pretend to be an exception. Any finding that is
 * neither excepted nor baselined is a violation — that is the
 * negative control. `--update-baseline` regenerates the ledger from
 * the current tree (run by a maintainer, reviewed in the same PR).
 *
 * Offline, read-only, no secret: reads the working tree plus two JSON
 * files. Exit codes: 0 pass, 1 violations, 2 undecidable input.
 *
 * Usage:
 *   node scripts/check-public-internal-identifiers.mjs
 *   node scripts/check-public-internal-identifiers.mjs --root=<dir>
 *   node scripts/check-public-internal-identifiers.mjs --case=<fixture.json>
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFile, isCommentLine, stringLiterals } from './_copy-japanese-diff.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

export const SURFACES_PATH = 'quality/copy-editorial-surfaces.json';
export const EXCEPTIONS_PATH = 'quality/public-internal-identifier-exceptions.json';
export const BASELINE_PATH = 'quality/public-internal-identifier-baseline.json';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.mdx']);

/**
 * The detection rules. Each rule produces `{ rule, match }` where
 * `match` is the exact offending substring — the unit an exception
 * entry pins.
 */
export const RULES = [
	{
		id: 'repo-path',
		pattern: /\b(?:src|scripts|docs|test|quality|external|\.github)\/[A-Za-z0-9_./-]+/g,
	},
	{
		id: 'field-name',
		pattern:
			/\b(?:verified_at|disabled_reason|published_surface|delivery_kind|build_command|last_rotated_at|owner_confirmation)\b/g,
	},
	{
		id: 'issue-ref',
		pattern: /\b(?:Issue|issue|PR|pull request)\s*#\d{1,4}\b/g,
	},
	{
		id: 'release-ref',
		pattern: /\brelease-\d+-\d+-\d+\b/g,
	},
];

/**
 * Visitor-facing text candidates on one line: string literal contents
 * plus JSX text nodes (`>text<`). Comments never contribute — a
 * Japanese/ASCII code comment is documentation, not copy.
 */
export function textCandidates(line) {
	if (isCommentLine(line)) return [];
	const candidates = [...stringLiterals(line)];
	// JSX text nodes: `>…<` runs that are not `=>` arrows or tags.
	for (const match of line.matchAll(/>([^<>{}]+)</g)) {
		const text = match[1].trim();
		if (text.length > 0 && !text.startsWith('=')) candidates.push(text);
	}
	return candidates;
}

const JS_FAMILY_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/**
 * Remove JS/TS comments from one line, preserving string and template
 * literal contents verbatim.
 *
 * `isCommentLine` only recognises lines that ARE comments; this is the
 * line-level complement for the three comment forms that leak text
 * into `textCandidates` today:
 *
 *   - trailing `// …` (a path mentioned in a line-end comment),
 *   - JSX brace-wrapped block comments (block comments inside `{ }`),
 *   - JSDoc blocks whose continuation lines do not start with `*`.
 *
 * `state` carries `{ block, template }` across lines: a block comment
 * or a template literal may span lines, and a `'…'`/`"…"` string may
 * not (an unterminated quote copies the rest of the line verbatim —
 * the same fail-toward-detection posture `stringLiterals` documents).
 * A `//` immediately after `:` is NOT a comment (it is the `//` of a
 * URL such as `https://…` in JSX text). Regex literals are not
 * recognised: a `/…//` sequence can truncate the line, which fails
 * toward a missed finding rather than a wrong one.
 */
export function stripJsComments(line, state = { block: false, template: false }) {
	let out = '';
	let i = 0;
	const text = String(line);
	while (i < text.length) {
		if (state.block) {
			const end = text.indexOf('*/', i);
			if (end === -1) return out;
			state.block = false;
			i = end + 2;
			continue;
		}
		if (state.template) {
			const ch = text[i];
			out += ch;
			if (ch === '\\' && i + 1 < text.length) {
				out += text[i + 1];
				i += 2;
				continue;
			}
			if (ch === '`') state.template = false;
			i += 1;
			continue;
		}
		const ch = text[i];
		const next = text[i + 1];
		if (ch === '/' && next === '/' && text[i - 1] !== ':') return out;
		if (ch === '/' && next === '*') {
			state.block = true;
			i += 2;
			continue;
		}
		if (ch === '"' || ch === "'") {
			let j = i + 1;
			let closed = false;
			while (j < text.length) {
				if (text[j] === '\\') {
					j += 2;
					continue;
				}
				if (text[j] === ch) {
					closed = true;
					break;
				}
				j += 1;
			}
			if (!closed) return out + text.slice(i);
			out += text.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		if (ch === '`') {
			state.template = true;
			out += ch;
			i += 1;
			continue;
		}
		out += ch;
		i += 1;
	}
	return out;
}

/** `http(s)://…` spans are URLs, never repository references. */
const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * Find internal identifiers in one candidate text.
 * Pure — returns `{ rule, match }` pairs (match = offending substring).
 */
export function findIdentifiers(text) {
	const found = [];
	const scanText = String(text).replace(URL_PATTERN, ' ');
	for (const rule of RULES) {
		rule.pattern.lastIndex = 0;
		for (const match of scanText.matchAll(rule.pattern)) {
			found.push({ rule: rule.id, match: match[0] });
		}
	}
	return found;
}

/**
 * Scan one file's content. Returns findings
 * `{ line, rule, match, excerpt }` — excerpt is the candidate text,
 * truncated, so the report shows WHAT a visitor would read.
 */
export function scanContent(path, content) {
	const findings = [];
	const lines = String(content).split(/\r?\n/);
	const stripComments = JS_FAMILY_EXTENSIONS.has(extname(path));
	const commentState = { block: false, template: false };
	for (const [index, line] of lines.entries()) {
		const code = stripComments ? stripJsComments(line, commentState) : line;
		for (const candidate of textCandidates(code)) {
			for (const hit of findIdentifiers(candidate)) {
				findings.push({
					file: path,
					line: index + 1,
					rule: hit.rule,
					match: hit.match,
					excerpt: candidate.length > 120 ? `${candidate.slice(0, 117)}...` : candidate,
				});
			}
		}
	}
	return findings;
}

/**
 * Load and validate the exceptions ledger.
 * Returns `{ exceptions, errors }` — errors are undecidable-input
 * problems (exit 2 territory), not findings.
 */
export function loadExceptions(json, sourcePath = EXCEPTIONS_PATH) {
	const errors = [];
	const exceptions = [];
	if (json === null || typeof json !== 'object') {
		return { exceptions, errors: [`${sourcePath}: not an object`] };
	}
	const list = Array.isArray(json.exceptions) ? json.exceptions : null;
	if (list === null) {
		return { exceptions, errors: [`${sourcePath}: "exceptions" must be an array`] };
	}
	for (const [index, entry] of list.entries()) {
		const label = `exceptions[${index}]`;
		for (const field of ['id', 'file', 'rule', 'match', 'reason', 'ownerConfirmation']) {
			if (typeof entry?.[field] !== 'string' || entry[field].trim() === '') {
				errors.push(`${label}.${field}: missing or empty`);
			}
		}
		if (entry?.ownerConfirmation !== 'confirmed' && entry?.ownerConfirmation !== 'unconfirmed') {
			errors.push(`${label}.ownerConfirmation: must be "confirmed" or "unconfirmed"`);
		}
		if (
			typeof entry?.reason === 'string' &&
			entry.reason.trim().length > 0 &&
			entry.reason.trim().length < 20
		) {
			errors.push(`${label}.reason: too short to be a reviewable reason`);
		}
		if (entry?.ownerConfirmation === 'confirmed') {
			if (typeof entry?.ownerReference !== 'string' || entry.ownerReference.trim() === '') {
				errors.push(`${label}.ownerReference: required when ownerConfirmation is "confirmed"`);
			}
		}
		if (!RULES.some((rule) => rule.id === entry?.rule)) {
			errors.push(`${label}.rule: unknown rule id`);
		}
		exceptions.push(entry);
	}
	return { exceptions, errors };
}

/**
 * Partition findings into violations and suppressed.
 * A finding is suppressed ONLY by a confirmed exception matching
 * file + rule + (matched text contains the exception's `match`).
 * Unconfirmed exceptions never suppress; they are reported separately
 * so a pending owner decision cannot masquerade as coverage.
 */
export function evaluateFindings(findings, exceptions, baseline = []) {
	const violations = [];
	const suppressed = [];
	const baselined = [];
	const baselineKeys = new Set();
	for (const entry of baseline) {
		baselineKeys.add(`${entry?.file}${entry?.rule}${entry?.match}`);
	}
	const usedBaseline = new Set();
	const staleExceptions = new Set(exceptions.map((entry) => entry?.id).filter(Boolean));
	for (const finding of findings) {
		const cover = exceptions.find(
			(entry) =>
				entry?.file === finding.file &&
				entry?.rule === finding.rule &&
				entry?.ownerConfirmation === 'confirmed' &&
				typeof entry?.match === 'string' &&
				finding.match.includes(entry.match),
		);
		if (cover) {
			suppressed.push({ ...finding, exceptionId: cover.id });
			staleExceptions.delete(cover.id);
			continue;
		}
		const key = `${finding.file}${finding.rule}${finding.match}`;
		if (baselineKeys.has(key)) {
			baselined.push(finding);
			usedBaseline.add(key);
		} else {
			violations.push(finding);
		}
	}
	const staleBaseline = [...baselineKeys].filter((key) => !usedBaseline.has(key));
	return {
		violations,
		suppressed,
		baselined,
		unmatchedExceptions: [...staleExceptions],
		staleBaseline,
	};
}

/**
 * Project findings into baseline entries `{file, rule, match}` —
 * deduplicated, sorted. Line numbers and excerpts are deliberately
 * NOT part of the key: copy edits shift lines constantly, and the
 * question the baseline answers is "is this identifier still present",
 * not "where exactly".
 */
export function toBaselineEntries(findings) {
	const seen = new Map();
	for (const finding of findings) {
		const key = `${finding.file}${finding.rule}${finding.match}`;
		if (!seen.has(key)) {
			seen.set(key, { file: finding.file, rule: finding.rule, match: finding.match });
		}
	}
	return [...seen.values()].sort((a, b) =>
		`${a.file}${a.rule}${a.match}`.localeCompare(`${b.file}${b.rule}${b.match}`),
	);
}

/* ------------------------------------------------------------------ */
/* Tree walk                                                          */
/* ------------------------------------------------------------------ */

function walkFiles(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === '.git' || name === 'dist' || name.startsWith('.')) {
			continue;
		}
		const path = join(dir, name);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			walkFiles(path, out);
		} else {
			out.push(path);
		}
	}
	return out;
}

function publicCopyFiles(root, surfaces) {
	const roots = [join(root, 'src'), join(root, 'copy')];
	const files = [];
	for (const dir of roots) {
		for (const path of walkFiles(dir)) {
			const rel = relative(root, path).split('\\').join('/');
			if (!SOURCE_EXTENSIONS.has(extname(rel))) continue;
			if (classifyFile(rel, surfaces).public) files.push(rel);
		}
	}
	return files.sort();
}

function extname(path) {
	const dot = path.lastIndexOf('.');
	return dot === -1 ? '' : path.slice(dot);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
	const opts = { root: REPO_ROOT, format: 'text', updateBaseline: false };
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			console.log(
				'Usage: check-public-internal-identifiers.mjs [--root=<dir>] [--format=text|json] [--update-baseline]',
			);
			process.exit(0);
		}
		if (arg === '--update-baseline') {
			opts.updateBaseline = true;
			continue;
		}
		const eq = arg.indexOf('=');
		if (eq <= 0) throw new Error(`unknown argument: ${arg}`);
		const key = arg.slice(0, eq);
		const value = arg.slice(eq + 1);
		if (key === '--root') opts.root = resolve(value);
		else if (key === '--format' && (value === 'text' || value === 'json')) opts.format = value;
		else throw new Error(`unknown argument: ${key}`);
	}
	return opts;
}

function collectFindings(root, surfaces) {
	const findings = [];
	const files = publicCopyFiles(root, surfaces);
	for (const rel of files) {
		const content = readFileSync(join(root, rel), 'utf8');
		findings.push(...scanContent(rel, content));
	}
	return { files, findings };
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const surfacesPath = join(opts.root, SURFACES_PATH);
	const exceptionsPath = join(opts.root, EXCEPTIONS_PATH);
	const baselinePath = join(opts.root, BASELINE_PATH);
	for (const required of [surfacesPath, exceptionsPath]) {
		if (!existsSync(required)) {
			console.error(`UNDECIDABLE: missing ${relative(opts.root, required) || required}`);
			process.exit(2);
		}
	}
	const surfaces = JSON.parse(readFileSync(surfacesPath, 'utf8'));
	const exceptionsJson = JSON.parse(readFileSync(exceptionsPath, 'utf8'));
	const { exceptions, errors } = loadExceptions(exceptionsJson);
	if (errors.length > 0) {
		for (const error of errors) console.error(`UNDECIDABLE: ${error}`);
		process.exit(2);
	}

	const { files, findings } = collectFindings(opts.root, surfaces);

	if (opts.updateBaseline) {
		// Baseline covers findings NOT suppressed by a confirmed
		// exception: an excepted finding needs no pending-review row.
		const { suppressed } = evaluateFindings(findings, exceptions, []);
		const exceptedKeys = new Set(suppressed.map((f) => `${f.file}${f.rule}${f.match}`));
		const pending = findings.filter((f) => !exceptedKeys.has(`${f.file}${f.rule}${f.match}`));
		const entries = toBaselineEntries(pending);
		const document = {
			$comment:
				'Issue #837 baseline: internal-identifier findings present when the gate was introduced, awaiting owner triage. NOT approvals — a baselined finding is pending review, and a new finding outside this list fails the gate. Regenerate with --update-baseline in the same PR that changes the copy.',
			version: 1,
			findings: entries,
		};
		writeFileSync(baselinePath, `${JSON.stringify(document, null, '\t')}\n`);
		console.log(
			`[check-public-internal-identifiers] baseline updated: ${entries.length} entrie(s) -> ${BASELINE_PATH}`,
		);
		return;
	}

	if (!existsSync(baselinePath)) {
		console.error(`UNDECIDABLE: missing ${BASELINE_PATH} (run --update-baseline once)`);
		process.exit(2);
	}
	const baselineJson = JSON.parse(readFileSync(baselinePath, 'utf8'));
	const baseline = Array.isArray(baselineJson?.findings) ? baselineJson.findings : [];

	const { violations, suppressed, baselined, unmatchedExceptions, staleBaseline } =
		evaluateFindings(findings, exceptions, baseline);
	const unconfirmed = exceptions.filter((entry) => entry?.ownerConfirmation !== 'confirmed');

	if (opts.format === 'json') {
		console.log(
			JSON.stringify(
				{
					filesScanned: files.length,
					findings: findings.length,
					violations,
					suppressed,
					baselinedCount: baselined.length,
					unmatchedExceptions,
					staleBaseline,
					unconfirmedExceptions: unconfirmed.map((entry) => entry?.id),
				},
				null,
				2,
			),
		);
	} else {
		console.log(
			`[check-public-internal-identifiers] files=${files.length} findings=${findings.length} violations=${violations.length} baselined(pending-review)=${baselined.length} excepted=${suppressed.length}`,
		);
		for (const finding of violations) {
			console.log(
				`  VIOLATION ${finding.file}:${finding.line} [${finding.rule}] match="${finding.match}" :: ${finding.excerpt}`,
			);
		}
		for (const entry of unconfirmed) {
			console.log(
				`  UNCONFIRMED-EXCEPTION ${entry?.id} (${entry?.file} [${entry?.rule}]) — does not suppress findings`,
			);
		}
		for (const id of unmatchedExceptions) {
			console.log(`  STALE-EXCEPTION ${id} — no current finding matches`);
		}
		for (const key of staleBaseline) {
			console.log(
				`  STALE-BASELINE ${key} — finding no longer present; remove on next --update-baseline`,
			);
		}
	}
	process.exit(violations.length > 0 ? 1 : 0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	try {
		main();
	} catch (error) {
		console.error(
			`check-public-internal-identifiers: ${error instanceof Error ? error.message : 'failed'}`,
		);
		process.exit(2);
	}
}
