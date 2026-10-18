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
 *      values the site has not shipped yet.
 *
 * The drift scan has to tell an HSTS directive from a cookie's
 * `Max-Age` and from Cache-Control's `max-age`, which are different
 * headers with the same token name. It therefore matches on
 * CONTEXT, not on the token:
 *
 *   - in a `_headers` file, a line whose header name is
 *     `Strict-Transport-Security:`;
 *   - anywhere else, a quoted string that contains a token named
 *     exactly `max-age` (lowercase — the cookie attribute is
 *     `Max-Age`, so a cookie literal is never mistaken for one).
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
 *   - The scan reports the FIRST `max-age=<n>` literal per file. A
 *     file that declares two different values is still reported, so
 *     the limit costs nothing in practice.
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

/** A quoted string, single / double / backtick, without escapes. */
const QUOTED = /(?:'([^'\\\n]*)'|"([^"\\\n]*)")/g;

/**
 * A quoted literal is treated as an HSTS declaration only when it carries a
 * `max-age=<value>` part AND every `;`-separated part is a directive RFC 6797
 * §6.1.1 defines. The two halves answer different questions:
 *
 *   - the `max-age=<value>` part separates a policy from a bare directive
 *     NAME. `src/http/middleware/cache-policy.ts` and this Issue's own
 *     fixtures quote `'max-age'` and `'includeSubDomains'` as words, and
 *     `'max-age'` on its own states no lifetime at all;
 *   - the sibling-directive test separates a policy from a Cache-Control or
 *     cookie value that happens to carry a `max-age`: `'public,
 *     max-age=31536000, immutable'` and `'…; Max-Age=31536000; Path=/'` are
 *     not HSTS policies because `public` / `immutable` / `Path` are not
 *     directives RFC 6797 defines.
 *
 * The canonical value can never grow a part outside `KNOWN_DIRECTIVES` —
 * `policyViolations` refuses unknown directives — so this test cannot hide a
 * legitimate drift site.
 */
function isHstsLiteral(literal) {
	const parts = literal
		.split(';')
		.map((part) => part.trim())
		.filter((part) => part !== '');
	if (parts.length === 0) return false;
	if (!parts.some((part) => /^max-age=\d+$/i.test(part))) return false;
	return parts.every((part) => KNOWN_DIRECTIVES.has(part.split('=')[0].trim().toLowerCase()));
}

/** A `Strict-Transport-Security:` header line inside `_headers`. */
const HSTS_HEADER_LINE = /^\s*strict-transport-security\s*:\s*(.+)$/i;

/** Directives RFC 6797 §6.1.1 defines, lower-cased. */
const KNOWN_DIRECTIVES = new Set(['max-age', 'includesubdomains', 'preload']);

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
	for (const match of source.matchAll(QUOTED)) {
		const literal = match[1] ?? match[2] ?? '';
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
				if (normalizeDirective(literal) !== expected) {
					violations.push(
						`${file}: "${normalizeDirective(literal)}" differs from the shipped directive ${expected}.`,
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
