/**
 * Shared source scanner for the repository's `scripts/**` gates.
 *
 * Both `check-i18n-policy.mjs` (Issue #433) and
 * `check-reduced-motion.mjs` (Issue #403) need the same two things
 * before a rule can be trusted:
 *
 *   1. comments removed, so a rule cannot fire on prose. `src/**` is
 *      heavily commented, and a comment that NAMES a forbidden form
 *      ("see `animationName: counterDigitRoll`") is documentation, not
 *      a violation. The scanner is a small state machine rather than a
 *      regex because `'https://…'` must not be read as a line comment
 *      and `/re/.test(x)` must not be read as division.
 *   2. a line number that matches the file the developer opens, so a
 *      violation is reported where they will look for it. Block
 *      comments are replaced by the same number of newlines.
 *
 * The two gates are unrelated obligations (Unicode policy vs. motion
 * policy); they share this scanner only because copying an 80-line
 * state machine into both would make two places to fix the same bug.
 */

import { readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Suffixes the gates scan for source rules. */
export const SOURCE_SUFFIXES = ['.ts', '.tsx'];

/**
 * Remove comments from `source` while preserving line structure.
 * String and template literals (including their escapes) and regex
 * literals are copied through untouched.
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
			// Keep the line count so that a reported line number matches
			// the file the developer actually sees.
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

/** 1-based line number of `index` inside `source`. */
export function lineAt(source, index) {
	let line = 1;
	for (let i = 0; i < index && i < source.length; i += 1) {
		if (source[i] === '\n') line += 1;
	}
	return line;
}

/** Repo-relative POSIX path for an absolute path. */
export function toRepoPath(absolutePath, repoRoot = REPO_ROOT) {
	return relative(repoRoot, absolutePath).split(sep).join('/');
}

/**
 * Every source file under `directory` (recursive). Generated and
 * framework-owned files are the caller's decision — a gate that wants
 * them excluded passes its own `shouldSkip`.
 */
export function collectSourceFiles(directory, shouldSkip = () => false) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory()) {
			files.push(...collectSourceFiles(path, shouldSkip));
			continue;
		}
		if (!SOURCE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
		if (shouldSkip(toRepoPath(path))) continue;
		files.push(path);
	}
	return files;
}
