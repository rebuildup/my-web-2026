#!/usr/bin/env node

/**
 * D1 statement-shape gate (Issue #452).
 *
 * Why this gate exists
 * --------------------
 * `test/integration/d1-parameter-binding.test.ts` proves that the D1
 * statements exercised by user input bind that input. What it cannot
 * do is notice a statement nobody exercised — a new admin filter, a
 * new export, a future search — until a caller happens to reach it
 * with a quote in the payload. This gate closes that gap statically:
 * every `prepare()` / `exec()` / `batch()` argument in `src/**` must be
 * a literal or a template with **no interpolation**. Structure may be
 * selected by code; values may not be spliced in.
 *
 * The rule is deliberately narrow, because a gate that cries wolf gets
 * deleted:
 *
 *   - Only template-literal interpolation (`${`) inside a D1 call
 *     argument is a violation. A caller that builds its SQL in a
 *     variable (`const sql = cond ? 'A' : 'B'; db.prepare(sql)`) is
 *     out of scope — that is a dataflow judgement, not a scan.
 *   - Test files, Storybook stories and spec files are skipped: their
 *     interpolation is fixture setup, never a shipped statement.
 *   - An interpolation is allowable only through the `SQL_STRUCTURE_ALLOWLIST`
 *     below, which names the file and the identifier and states why
 *     the value is structure rather than data.
 *
 * Scanner limits (documented, not hidden): the argument reader is a
 * hand-written character scanner. A regex literal or a comment
 * containing unbalanced quotes inside a D1 call argument could confuse
 * it. That has never happened in this repository, and the alternative
 * — an AST dependency in a quality gate — is a larger change than the
 * risk.
 *
 * Exit codes: 0 = every D1 statement is literal / structure-only,
 * 1 = at least one interpolated statement, 2 = bad input.
 *
 * Authority: Issue #452 (SQL injection tests for user-facing D1
 * paths). Paired with `docs/security.md#d1-parameter-binding`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** D1 entry points whose argument is a SQL statement. */
const SQL_CALLS = ['prepare', 'exec', 'batch'];

/** File suffixes that never ship a statement to production. */
const SKIPPED_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx', '.stories.ts'];

/**
 * Interpolations that are structure, not data.
 *
 * Each entry must name the file (repo-relative, POSIX separators), the
 * interpolated identifier, and why the value cannot carry user input.
 * Adding an entry is a reviewable decision: it weakens the gate.
 */
export const SQL_STRUCTURE_ALLOWLIST = [
	{
		file: 'src/portfolio/load.ts',
		identifier: 'cursorPredicate',
		reason:
			'a fixed chain of `?` placeholders (or the empty string), chosen by whether a cursor ' +
			'decoded. Every cursor COMPONENT is still bound (see cursorBinds in the same file), ' +
			'so no user value reaches the statement text.',
	},
];

/**
 * Walk a directory, returning every source file path that the gate
 * should read.
 */
export function collectSourceFiles(directory) {
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(path);
				continue;
			}
			if (!['.ts', '.tsx'].includes(extname(entry.name))) continue;
			if (SKIPPED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
			out.push(path);
		}
	};
	walk(directory);
	return out.sort();
}

/**
 * Read a call's argument text starting at `openIndex` (the `(`).
 *
 * Returns the raw source between the parentheses, with the trailing
 * `)` excluded. Tracks string / template / comment state so a `)` or
 * a quote inside a literal does not terminate the scan early.
 */
export function readCallArgument(source, openIndex) {
	const stack = [{ kind: 'paren', quote: null, inTemplate: false }];
	let inComment = null;
	let i = openIndex + 1;
	for (; i < source.length && stack.length > 0; i++) {
		const ch = source[i];
		const next = source[i + 1];
		const top = stack[stack.length - 1];

		if (inComment === 'line') {
			if (ch === '\n') inComment = null;
			continue;
		}
		if (inComment === 'block') {
			if (ch === '*' && next === '/') {
				inComment = null;
				i++;
			}
			continue;
		}
		if (top.quote) {
			if (ch === '\\') {
				i++;
				continue;
			}
			if (ch === top.quote) {
				top.quote = null;
				top.inTemplate = false;
			}
			continue;
		}
		if (ch === '/' && next === '/') {
			inComment = 'line';
			i++;
			continue;
		}
		if (ch === '/' && next === '*') {
			inComment = 'block';
			i++;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') {
			top.quote = ch;
			top.inTemplate = ch === '`';
			continue;
		}
		if (ch === '{') {
			stack.push({ kind: 'brace', quote: null, inTemplate: false });
			continue;
		}
		if (ch === '}') {
			// Closing a `${ … }` interpolation returns to the template.
			if (top.kind === 'brace') {
				stack.pop();
				continue;
			}
			continue;
		}
		if (ch === '(' || ch === '[') {
			stack.push({ kind: 'paren', quote: null, inTemplate: false });
			continue;
		}
		if (ch === ')' || ch === ']') {
			stack.pop();
		}
	}
	return { text: source.slice(openIndex + 1, Math.max(openIndex + 1, i - 1)), end: i };
}

/**
 * `${ … }` expressions inside the template literals of an argument, as
 * raw identifier text.
 *
 * Template mode matters: SQL text inside a template routinely contains
 * single quotes (`WHERE k = '${value}'`), and treating those quotes as a
 * nested string literal would swallow the very interpolation the gate
 * is looking for.
 */
export function interpolationsIn(argumentText) {
	const found = [];
	let i = 0;
	while (i < argumentText.length) {
		const ch = argumentText[i];
		if (ch === '`') {
			i++;
			while (i < argumentText.length) {
				const t = argumentText[i];
				if (t === '\\') {
					i += 2;
					continue;
				}
				if (t === '`') {
					i++;
					break;
				}
				if (t === '$' && argumentText[i + 1] === '{') {
					let depth = 0;
					let j = i + 1;
					for (; j < argumentText.length; j++) {
						if (argumentText[j] === '{') depth++;
						else if (argumentText[j] === '}') {
							depth--;
							if (depth === 0) break;
						}
					}
					found.push(argumentText.slice(i + 2, j).trim());
					i = j + 1;
					continue;
				}
				i++;
			}
			continue;
		}
		i++;
	}
	return found;
}

/**
 * Every interpolated D1 statement under `srcDir`.
 *
 * Returns `{ file, line, method, expression, snippet }` records with
 * `file` relative to `root` in POSIX form.
 */
export function findInterpolatedSqlStatements({ root = REPO_ROOT, srcDir } = {}) {
	const absoluteSrc = resolve(root, srcDir ?? 'src');
	const violations = [];
	for (const file of collectSourceFiles(absoluteSrc)) {
		const source = readFileSync(file, 'utf8');
		const relFile = relative(root, file).split(sep).join('/');
		for (const method of SQL_CALLS) {
			let searchFrom = 0;
			for (;;) {
				const at = source.indexOf(`.${method}(`, searchFrom);
				if (at === -1) break;
				const openIndex = at + method.length + 1;
				const { text, end } = readCallArgument(source, openIndex);
				searchFrom = end;
				const expressions = interpolationsIn(text);
				for (const expression of expressions) {
					// The allowlist names the interpolated IDENTIFIER, so a
					// neighbouring `${userInput}` in the same statement is
					// still reported.
					if (
						SQL_STRUCTURE_ALLOWLIST.some(
							(entry) => entry.file === relFile && entry.identifier === expression,
						)
					) {
						continue;
					}
					violations.push({
						file: relFile,
						line: lineOf(source, at),
						method,
						expression,
						snippet: `${relFile}:${lineOf(source, at)} .${method}(…${expression}…)`,
					});
				}
			}
		}
	}
	return violations;
}

function lineOf(source, index) {
	return source.slice(0, index).split('\n').length;
}

function main(argv) {
	const root = argv.includes('--root') ? resolve(argv[argv.indexOf('--root') + 1]) : REPO_ROOT;
	const violations = findInterpolatedSqlStatements({ root });
	if (violations.length === 0) {
		process.stdout.write('d1 sql binding OK: no interpolated D1 statement in src/\n');
		return 0;
	}
	process.stderr.write(
		`${violations.length} D1 statement(s) interpolate a value into the statement text.\n`,
	);
	process.stderr.write('Bind it with a ? placeholder and .bind(...) instead:\n');
	for (const violation of violations) {
		process.stderr.write(`  - ${violation.snippet}\n`);
	}
	process.stderr.write(
		'\nIf an interpolation is SQL *structure* (never user data), add an entry to\n' +
			'SQL_STRUCTURE_ALLOWLIST in scripts/check-d1-sql-binding.mjs with the reason.\n',
	);
	return 1;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main(process.argv.slice(2)));
}
