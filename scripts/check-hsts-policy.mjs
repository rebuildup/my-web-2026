#!/usr/bin/env node

/**
 * HSTS policy gate (Issue #446).
 *
 * Why this gate exists
 * --------------------
 * `test/integration/hsts-transport-security.test.ts` proves that the
 * responses it exercises carry the intended directive. What it cannot
 * do is stop somebody from widening that directive in a way the
 * Issue explicitly refuses:
 *
 *   - `includeSubDomains` extends the policy to every hostname under
 *     the zone. The zone has more than one hostname today
 *     (`media.rebuildup.dev`, the R2 custom domain declared in
 *     `wrangler.production.jsonc`), and a subdomain that cannot serve
 *     HTTPS becomes unreachable for the whole `max-age` window.
 *     No test in this repository can observe a subdomain's HTTPS
 *     posture, so the gate is the only place that can hold the line.
 *   - `preload` submits the zone to the browser preload list, where
 *     removal takes months.
 *
 * Both are *operator* decisions that require a per-subdomain HTTPS
 * audit first (recorded in `docs/security.md`). Until that audit is
 * written down, adding either directive is a build failure rather
 * than a code review question.
 *
 * What the gate checks
 * --------------------
 *   1. **One declaration.** The directive has a single source of
 *      truth: the `HSTS_DIRECTIVE` string literal in the Worker entry
 *      (`src/server.ts`). Zero declarations or two declarations both
 *      fail — the first means the policy moved, the second means a
 *      second copy is drifting.
 *   2. **Grammar and band.** Exactly one `max-age` directive, with a
 *      decimal-seconds value inside the band this project allows
 *      (see `MIN_MAX_AGE_SECONDS` / `MAX_MAX_AGE_SECONDS`). An
 *      unrecognised directive fails: the header is a browser-facing
 *      contract, and a token nobody recognises is a silent no-op.
 *   3. **No subdomain or preload scope.** See above.
 *   4. **No drift.** Every HSTS directive written anywhere in `src/`,
 *      `test/`, `e2e/`, `scripts/` and `public/` — the test's
 *      restated contract, a `_headers` rule, a future report
 *      generator — must carry the canonical directive. This is what
 *      keeps those from disagreeing with the runtime. Prose in
 *      `docs/` is out of scope on purpose: the ramp ladder documents
 *      values the site has not shipped yet, and prose inside a source
 *      comment is blanked before the scan for the same reason.
 *
 * The drift scan has to tell an HSTS directive from a cookie's
 * `Max-Age` and from Cache-Control's `max-age`, which are different
 * headers with the same token name. It therefore matches on
 * CONTEXT, not on the token:
 *
 *   - in a `_headers` file, a line whose header name is
 *     `Strict-Transport-Security:`;
 *   - anywhere else, a string literal — single-quoted, double-quoted
 *     OR a template literal — whose parts include a `max-age` part and
 *     no token that belongs to another header's grammar (see
 *     `OTHER_HEADER_TOKENS`). Template literals count because a
 *     directive written as `` c.header(HSTS_HEADER, `…`) `` is the
 *     natural way to widen the policy, and a gate that cannot read it
 *     cannot refuse it.
 *
 * A literal that carries a `max-age` part together with a token RFC
 * 6797 does not define is STILL a candidate: it is reported as drift,
 * and the undefined token is reported on its own line. Dropping such a
 * string (because "not every part is a known directive") is exactly
 * how `max-age=31536000; includeSubDomains; report-uri=x` would slip
 * through — the widest scope directive in the string, unreported.
 *
 * Test files are skipped, as in the D1 gate: they plant violations on
 * purpose as fixtures, and a fixture is not a declaration site. Drift
 * between the shipped value and the contract the runtime suite
 * restates is caught where it actually matters — by comparing the
 * observed response header against that restated literal inside
 * `test/integration/hsts-transport-security.test.ts`.
 *
 * Scope limits (documented, not hidden)
 * --------------------------------------
 *   - The canonical value is read from source text, not from a
 *     compiled artefact, so `node scripts/check-hsts-policy.mjs` is
 *     enough to run it. A hand-written character match is used rather
 *     than an AST dependency for the same reason as
 *     `scripts/check-d1-sql-binding.mjs`.
 *   - The scan reports EVERY candidate literal in a file, not the first
 *     one, and reports what it cannot verify: a template literal with
 *     an interpolation (`max-age=${n}`) is a violation naming the
 *     canonical constant to build the value from, because its runtime
 *     value is invisible to a source scan.
 *   - Comments are blanked (same length, so line numbers survive) by a
 *     small hand-written scanner rather than an AST pass. It tracks
 *     strings, template literals and regex literals, so `'https://…'`,
 *     `/['"]/` and `/\/\//` are never mistaken for comment syntax.
 *   - One documented blind spot: a literal that mixes a `max-age` part
 *     with a token that belongs to another header's grammar
 *     (`OTHER_HEADER_TOKENS`) is attributed to that other header. That
 *     is what keeps `public, max-age=31536000, immutable` out of the
 *     report, and the list is the price of that decision.
 *
 * Exit codes: 0 = policy holds, 1 = violation, 2 = bad input.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The Worker entry — owner of the HSTS delivery policy (Issue #446). */
const POLICY_FILE = join('src', 'server.ts');

/** The declaration that carries the single canonical directive. */
const DECLARATION = /export const HSTS_DIRECTIVE\s*=\s*'([^']*)'/g;

/**
 * A string literal: single-quoted, double-quoted, or a template literal.
 * The backtick alternative exists because a directive written as a template
 * (`c.header(HSTS_HEADER, `max-age=31536000; includeSubDomains`)`) is a
 * declaration site like any other. Interpolations are deliberately NOT
 * excluded: `stripComments` already keeps template bodies intact, and a
 * template whose value cannot be compared statically is reported rather than
 * ignored.
 */
const QUOTED = /'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\\n]*)`/g;

/** A `Strict-Transport-Security:` header line inside `_headers`. */
const HSTS_HEADER_LINE = /^\s*strict-transport-security\s*:\s*(.+)$/i;

/** Directives RFC 6797 §6.1.1 defines, lower-cased. */
const KNOWN_DIRECTIVES = new Set(['max-age', 'includesubdomains', 'preload']);

/**
 * Tokens that belong to another header's grammar, so a literal carrying one of
 * them is that header's value and not an HSTS policy:
 *
 *   - Cache-Control directives (RFC 9111 §5.2), which is how this repository
 *     spells its own cache lifetimes — `scripts/build-cache-isolation-report.mjs`
 *     carries `'public, max-age=31536000, immutable'` in code;
 *   - Set-Cookie attributes (RFC 6265 §4.1), which is why the cookie literal
 *     `'Max-Age=31536000; Path=/; HttpOnly; Secure'` is not a policy.
 *
 * This list is the gate's only deliberate blind spot and it is documented as
 * such in the module comment above.
 */
const OTHER_HEADER_TOKENS = new Set([
	// Cache-Control (RFC 9111 §5.2)
	'public',
	'private',
	'no-cache',
	'no-store',
	'no-transform',
	'must-revalidate',
	'proxy-revalidate',
	'immutable',
	'stale-while-revalidate',
	's-maxage',
	// Set-Cookie attributes (RFC 6265 §4.1)
	'expires',
	'path',
	'domain',
	'secure',
	'httponly',
	'samesite',
	'priority',
	'partitioned',
]);

/**
 * The directive parts of a literal, split on both separators RFC 9111 and
 * RFC 6797 use. HSTS is `;`-separated; splitting on `,` as well only makes
 * the scan read `public, max-age=1` the way the cache header spells it.
 */
function directiveParts(literal) {
	return literal
		.split(/[;,]/)
		.map((part) => part.trim())
		.filter((part) => part !== '');
}

/**
 * Is this part the policy's lifetime, spelled the way RFC 6797 §6.1.1 spells
 * it? `Max-Age` is deliberately a different shape: that is the Set-Cookie
 * attribute spelling, which `src/home/reactions/cookie.ts` uses for the actor
 * cookie, so a cookie literal is never read as a policy.
 */
function isMaxAgePart(part) {
	return /^max-age=/.test(part.replace(/\s*=\s*/, '='));
}

/**
 * A string literal is treated as an HSTS declaration when it carries a
 * `max-age` part AND no token that belongs to another header's grammar. The
 * two halves answer different questions:
 *
 *   - the `max-age` part separates a policy from a bare directive NAME.
 *     `src/http/middleware/cache-policy.ts` and this Issue's own fixtures
 *     quote `'max-age'` and `'includeSubDomains'` as words, and `'max-age'`
 *     on its own states no lifetime at all. The VALUE is not matched, so an
 *     interpolated or non-numeric one still counts as a policy — the literal is
 *     then reported as unverifiable rather than skipped;
 *   - the `OTHER_HEADER_TOKENS` test separates a policy from a Cache-Control
 *     or cookie value that happens to carry a `max-age`: `'public,
 *     max-age=31536000, immutable'` and `'…; Max-Age=31536000; Path=/'` are
 *     not HSTS policies.
 *
 * A part that is neither a known directive nor another header's token is NOT
 * grounds for skipping the literal. `undefinedParts` reports it, and the drift
 * check reports the string, so `max-age=31536000; includeSubDomains;
 * report-uri=x` fails the gate instead of disappearing from the scan.
 */
function isHstsLiteral(literal) {
	const parts = directiveParts(literal);
	if (!parts.some(isMaxAgePart)) return false;
	return !parts.some((part) => OTHER_HEADER_TOKENS.has(part.split('=')[0].trim().toLowerCase()));
}

/** Parts of a candidate literal that RFC 6797 §6.1.1 does not define. */
export function undefinedParts(literal) {
	return directiveParts(literal).filter(
		(part) => !KNOWN_DIRECTIVES.has(part.split('=')[0].trim().toLowerCase()),
	);
}

/** A template literal whose value is composed at runtime. */
function hasInterpolation(literal) {
	return literal.includes('${');
}

/** Keywords that can be followed by a regex literal. */
const REGEX_KEYWORDS = new Set([
	'await',
	'case',
	'delete',
	'do',
	'else',
	'in',
	'instanceof',
	'new',
	'of',
	'return',
	'typeof',
	'void',
	'yield',
]);

/**
 * Blank out comment bodies, keeping every other character (and therefore every
 * offset and line number) in place.
 *
 * Prose is not a declaration site. `src/http/middleware/cache-policy.ts`
 * explains its cache rule with `` `max-age=0` `` in a doc comment, and once
 * template literals are scanned that markdown would read as a header value.
 * Comments are therefore removed before the literal scan, which also keeps a
 * quoted policy quoted inside a comment from failing the gate.
 *
 * Strings, template literals (including `${…}` holes) and regex literals are
 * tracked so their contents are never read as comment syntax: `'https://…'`,
 * `` `https://…` ``, `/['"]/` and `/\/\//` all survive intact. A `/` between
 * two operands is division, not a regex start; the usual "previous significant
 * character" heuristic decides, which is the same hand-written trade-off the
 * canonical-directive match makes.
 */
export function stripComments(source) {
	const out = source.split('');
	/** Last significant character seen in code, and the identifier before it. */
	let previous = '';
	let previousWord = '';

	const blank = (from, to) => {
		for (let at = from; at < to; at += 1) {
			if (source[at] !== '\n' && source[at] !== '\r') out[at] = ' ';
		}
	};

	const opensRegex = () => {
		// A value on the left (`x`, `)`, `]`, a closing quote) means division,
		// unless the value is a keyword that can precede a regex.
		if (previous === '') return true;
		if (/[A-Za-z0-9_$)\]}'"]/.test(previous)) return REGEX_KEYWORDS.has(previousWord);
		return true;
	};

	let at = 0;
	while (at < source.length) {
		const char = source[at];
		const next = source[at + 1];

		if (char === '/' && next === '/') {
			const lineEnd = source.indexOf('\n', at);
			const stop = lineEnd === -1 ? source.length : lineEnd;
			blank(at, stop);
			at = stop;
			continue;
		}
		if (char === '/' && next === '*') {
			const blockEnd = source.indexOf('*/', at + 2);
			const stop = blockEnd === -1 ? source.length : blockEnd + 2;
			blank(at, stop);
			at = stop;
			continue;
		}
		if (char === "'" || char === '"') {
			at = skipQuoted(source, at, char);
			previous = char;
			previousWord = '';
			continue;
		}
		if (char === '`') {
			at = skipTemplate(source, at);
			previous = char;
			previousWord = '';
			continue;
		}
		if (char === '/' && opensRegex()) {
			at = skipRegex(source, at);
			previous = char;
			previousWord = '';
			continue;
		}
		if (/\s/.test(char)) {
			at += 1;
			continue;
		}
		if (/[A-Za-z0-9_$]/.test(char)) {
			let end = at;
			while (end < source.length && /[A-Za-z0-9_$]/.test(source[end])) end += 1;
			previousWord = source.slice(at, end);
			previous = source[end - 1];
			at = end;
			continue;
		}
		previous = char;
		previousWord = '';
		at += 1;
	}
	return out.join('');
}

/** Index just past a `'`/`"` string that starts at `start`. */
function skipQuoted(source, start, quote) {
	let at = start + 1;
	while (at < source.length) {
		const char = source[at];
		if (char === '\\') {
			at += 2;
			continue;
		}
		if (char === quote) return at + 1;
		// An unterminated literal must not swallow the rest of the file.
		if (char === '\n') return at;
		at += 1;
	}
	return source.length;
}

/** Index just past a template literal that starts at `start`, holes included. */
function skipTemplate(source, start) {
	let at = start + 1;
	while (at < source.length) {
		const char = source[at];
		if (char === '\\') {
			at += 2;
			continue;
		}
		if (char === '`') return at + 1;
		if (char === '$' && source[at + 1] === '{') {
			at += 2;
			let depth = 1;
			while (at < source.length && depth > 0) {
				const inner = source[at];
				if (inner === '{') depth += 1;
				else if (inner === '}') depth -= 1;
				else if (inner === "'" || inner === '"') {
					at = skipQuoted(source, at, inner);
					continue;
				} else if (inner === '`') {
					at = skipTemplate(source, at);
					continue;
				}
				at += 1;
			}
			continue;
		}
		at += 1;
	}
	return source.length;
}

/** Index just past a regex literal that starts at `start`. */
function skipRegex(source, start) {
	let at = start + 1;
	let inCharacterClass = false;
	while (at < source.length) {
		const char = source[at];
		if (char === '\\') {
			at += 2;
			continue;
		}
		if (char === '[') inCharacterClass = true;
		else if (char === ']') inCharacterClass = false;
		else if (char === '/' && !inCharacterClass) {
			at += 1;
			while (at < source.length && /[a-z]/.test(source[at])) at += 1;
			return at;
		} else if (char === '\n') {
			return at;
		}
		at += 1;
	}
	return source.length;
}

/**
 * Directives that stay OFF until a per-subdomain HTTPS audit exists
 * (`docs/security.md` → "Ramping `includeSubDomains` and `preload`").
 * Checked lower-cased against each directive's name.
 */
const SCOPE_DIRECTIVES = Object.freeze(['includesubdomains', 'preload']);

/**
 * The band the shipped `max-age` must stay inside.
 *
 *   - floor 86 400 s (1 day): below this the guarantee is over before
 *     a visitor's second session, which buys nothing.
 *   - ceiling 63 072 000 s (2 years): the value browsers require for
 *     preload submission. Two years is the longest commitment this
 *     project is willing to make about a hostname it does not fully
 *     own, and the zone-level setting must not exceed it either.
 */
const MIN_MAX_AGE_SECONDS = 86_400;
const MAX_MAX_AGE_SECONDS = 63_072_000;

/** Trees scanned for `max-age` drift. Prose trees are excluded. */
const SCAN_ROOTS = ['src', 'test', 'e2e', 'scripts', 'public'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.headers']);
/** This file documents the band; it is not a declaration site. */
const SELF = 'scripts/check-hsts-policy.mjs';

/** Fixture files plant violations on purpose; they are not declarations. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function sourceFiles(directory) {
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		if (SCAN_EXTENSIONS.has(extname(entry.name)) || entry.name === '_headers') {
			return statSync(path).isFile() ? [path] : [];
		}
		return [];
	});
}

/**
 * The canonical directive, read from the Worker entry.
 *
 * Returns every violation rather than throwing, so the CLI can report
 * a moved or duplicated declaration in one run.
 */
export function readCanonicalDirective({ root = REPO_ROOT } = {}) {
	const file = join(root, POLICY_FILE);
	let source;
	try {
		source = readFileSync(file, 'utf8');
	} catch {
		return {
			file: POLICY_FILE,
			directive: null,
			violations: [`${POLICY_FILE} could not be read — the HSTS policy has no source of truth.`],
		};
	}

	const declared = [...source.matchAll(DECLARATION)].map((match) => match[1]);
	const violations = [];
	if (declared.length === 0) {
		violations.push(
			`${POLICY_FILE} declares no \`export const HSTS_DIRECTIVE = '…'\` — the HSTS policy lost its source of truth.`,
		);
	}
	if (declared.length > 1) {
		violations.push(
			`${POLICY_FILE} declares HSTS_DIRECTIVE ${declared.length} times (${declared
				.map((value) => `"${value}"`)
				.join(', ')}) — one declaration owns the policy; the others are drift.`,
		);
	}
	return { file: POLICY_FILE, directive: declared[0] ?? null, violations };
}

/**
 * Directive-level rules: grammar, band, and the two scope directives.
 */
export function policyViolations(directive) {
	if (directive === null || directive === undefined || directive.trim() === '') {
		return ['the HSTS directive is empty — a header with no directive is inert.'];
	}

	const violations = [];
	const names = [];
	let maxAgeCount = 0;

	for (const raw of directive.split(';')) {
		const part = raw.trim();
		if (part === '') continue;
		const [rawName, ...rest] = part.split('=');
		const name = rawName.trim().toLowerCase();
		names.push(name);

		if (!KNOWN_DIRECTIVES.has(name)) {
			violations.push(
				`"${part}" is not a directive RFC 6797 §6.1.1 defines — a browser ignores it, so shipping it claims a guarantee that does not exist.`,
			);
			continue;
		}
		if (SCOPE_DIRECTIVES.includes(name)) {
			violations.push(
				`"${name}" extends the policy beyond this host. It requires the per-subdomain HTTPS audit recorded in docs/security.md first; until that audit exists, the answer is no.`,
			);
			continue;
		}

		maxAgeCount += 1;
		const value = rest.join('=').trim();
		if (name === 'max-age' && !/^\d+$/.test(value)) {
			violations.push(
				`max-age must be decimal seconds, got "${value}". (No quoted form, no unit suffix.)`,
			);
			continue;
		}
		const seconds = Number(value);
		if (seconds < MIN_MAX_AGE_SECONDS || seconds > MAX_MAX_AGE_SECONDS) {
			violations.push(
				`max-age=${seconds} is outside the allowed band ${MIN_MAX_AGE_SECONDS}–${MAX_MAX_AGE_SECONDS} s (1 day – 2 years).`,
			);
		}
	}

	if (maxAgeCount !== 1) {
		violations.push(
			`the directive must carry exactly one max-age, found ${maxAgeCount}${names.length ? ` (${names.join(', ')})` : ''}.`,
		);
	}
	return violations;
}

/**
 * Directive text, whitespace-normalised: `max-age=1; includeSubDomains`
 * and `max-age=1;includeSubDomains` are the same policy.
 */
export function normalizeDirective(value) {
	return value
		.split(';')
		.map((part) => part.trim().replace(/\s*=\s*/, '='))
		.filter((part) => part !== '')
		.join(';');
}

/** Every HSTS directive in one file, in source order. */
export function hstsDirectivesIn(path, source) {
	const directives = [];
	if (path.endsWith('_headers')) {
		for (const line of source.split('\n')) {
			const match = HSTS_HEADER_LINE.exec(line);
			if (match) directives.push(match[1]);
		}
		return directives;
	}
	// Comments are prose, not declaration sites — see `stripComments`.
	const code = stripComments(source);
	for (const match of code.matchAll(QUOTED)) {
		const literal = match[1] ?? match[2] ?? match[3] ?? '';
		if (isHstsLiteral(literal)) directives.push(literal);
	}
	return directives;
}

/** Every HSTS directive in the scanned trees that differs from the canonical one. */
export function driftedDirectives({ root = REPO_ROOT, canonical }) {
	const expected = normalizeDirective(canonical);
	const violations = [];
	for (const scanRoot of SCAN_ROOTS) {
		for (const path of sourceFiles(join(root, scanRoot))) {
			const file = relative(root, path).split(sep).join('/');
			if (file === SELF || TEST_FILE.test(file)) continue;
			for (const literal of hstsDirectivesIn(file, readFileSync(path, 'utf8'))) {
				const normalized = normalizeDirective(literal);
				if (normalized === expected) continue;
				violations.push(`${file}: "${normalized}" differs from the shipped directive ${expected}.`);
				for (const part of undefinedParts(literal)) {
					violations.push(
						`${file}: "${part}" is not a directive RFC 6797 §6.1.1 defines — a browser ignores it, so the gate reports the whole literal rather than dropping it.`,
					);
				}
				if (hasInterpolation(literal)) {
					violations.push(
						`${file}: "${normalized}" is composed at runtime, so the gate cannot compare it with ${expected}. Build the header value from HSTS_DIRECTIVE instead of assembling it.`,
					);
				}
			}
		}
	}
	return violations;
}

/** All gate violations for a repository tree. */
export function runGate({ root = REPO_ROOT } = {}) {
	const { directive, violations: declarationViolations } = readCanonicalDirective({ root });
	const violations = [...declarationViolations];
	if (directive === null) return { directive: null, violations };
	return {
		directive,
		violations: [
			...violations,
			...policyViolations(directive),
			...driftedDirectives({ root, canonical: directive }),
		],
	};
}

function main(argv) {
	if (argv.includes('--root')) {
		const flag = argv.indexOf('--root');
		if (flag === argv.length - 1) {
			process.stderr.write('--root needs a directory\n');
			return 2;
		}
	}

	const root = argv.includes('--root') ? resolve(argv[argv.indexOf('--root') + 1]) : REPO_ROOT;
	const { directive, violations } = runGate({ root });

	if (violations.length === 0) {
		process.stdout.write(
			`hsts policy OK: ${directive} (host-scoped; no includeSubDomains, no preload)\n`,
		);
		return 0;
	}

	process.stderr.write(`${violations.length} HSTS policy violation(s):\n`);
	for (const violation of violations) process.stderr.write(`  - ${violation}\n`);
	process.stderr.write(
		'\nThe policy is host-scoped on purpose. Before adding includeSubDomains or\n' +
			'preload, record the per-subdomain HTTPS audit in docs/security.md and\n' +
			'update the ramp ladder there; the gate then encodes that decision\n' +
			'instead of forbidding it.\n',
	);
	return 1;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main(process.argv.slice(2)));
}
