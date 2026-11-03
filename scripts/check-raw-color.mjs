#!/usr/bin/env node

/**
 * Raw-colour gate (Issue #764).
 *
 * Why this gate exists
 * --------------------
 * The editorial layer is only a contract if consumers *use* it. A
 * component that writes `color: '#0ea5e9'` or
 * `background: 'rgba(0, 0, 0, 0.45)'` compiles, ships and looks
 * right, and the semantic layer silently stops being the source of
 * truth: the value no longer follows the light / dark binding, no
 * longer appears in the contrast matrix, and no longer moves when the
 * palette moves.
 *
 * So the rule is structural: **a raw colour literal may appear only
 * in the palette owner (`src/editorial/tokens.ts`)**, and in the few
 * places listed in `ALLOWED_RAW_COLORS` with a written reason. The
 * allowlist is per literal, per file, with a required count — so a
 * new colour added to an already-allowlisted file still fails, and an
 * entry that no longer matches is reported as stale rather than kept
 * as silent permission.
 *
 * What counts as a raw colour
 * ---------------------------
 *   - a hex colour inside a string literal (`'#fff'`, `'#0f172a'`);
 *   - a colour function inside a string literal
 *     (`rgba(…)`, `hsl(…)`, `oklch(…)`, …).
 *
 * Scope boundaries (deliberate):
 *   - `src/editorial/tokens.ts` is exempt because it IS the palette.
 *     The exemption is that one file, not the directory: a new
 *     `src/editorial/raw.ts` that paints a hex must still fail.
 *   - `*.test.*` / `*.spec.*` / `*.stories.*` / `*.preview.*` are
 *     exempt: they assert *on* colours or demonstrate a document, and
 *     a preview is a demo surface (AGENTS.md §3). Test values are not
 *     shipped and a story is not a consumer.
 *   - Markdown (`*.md`), CSS and JSON are out of scope: the gate reads
 *     the TypeScript surface where a component makes a colour
 *     decision.
 *
 * Known limits: this is a static read of the text. A colour assembled
 * from parts (`'#' + 'fff'`), read from a variable, or interpolated
 * from a non-literal expression does not match. Type checking and
 * review remain the backstop for those.
 *
 * Exit codes: 0 = clean, 1 = at least one violation, 2 = bad input.
 */

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SRC_ROOT = join(ROOT, 'src');

/** The palette owner. Raw values are its subject, not its violation. */
export const PALETTE_OWNER = 'src/editorial/tokens.ts';

/** Files that are not shipped consumers of the token layer. */
const EXEMPT_FILE_PATTERN = /\.(test|spec|stories|preview)\.[cm]?[jt]sx?$/;

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** A quoted string on one line; the escape-aware back-reference is the point. */
const STRING_LITERAL_PATTERN = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** A hex colour standing alone as a CSS value. */
const HEX_VALUE_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * A hex colour inside a larger CSS value (`'1px solid #fff'`,
 * `'0 0 0 1px #0f172a'`). Delimited so an issue reference (`#764`) or
 * an anchor (`#top`) is not a hit.
 *
 * Only the 6- and 8-digit forms are matched inline. A 3- or 4-digit
 * short is indistinguishable from an issue number inside a message
 * (`'… (Issue #433): …'`), so a short hex counts as a colour only when
 * the literal IS the value (`HEX_VALUE_PATTERN`).
 */
const HEX_INLINE_PATTERN = /(?:^|[\s,:(])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?:$|[\s,;)])/;

/** A colour function with a numeric first argument (`rgba(0, …)`). */
const COLOUR_FUNCTION_PATTERN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(\s*[-0-9.]/;

/**
 * A prose sentence is not a colour value. A CSS value is short and
 * ASCII; the length and script guards keep documentation strings that
 * *mention* a hex (`'#ffffff / #f8fafc / …'` in a preview record) from
 * reading as a decision this layer made.
 */
const MAX_VALUE_LENGTH = 80;

/** True when every code point is ASCII (a CSS value, not prose). */
function isAscii(value) {
	for (const character of value) {
		if ((character.codePointAt(0) ?? 0) > 0x7f) return false;
	}
	return true;
}

/**
 * Raw colours this repository ships on purpose, each with the reason
 * it cannot be a token.
 *
 * The entry is `(file, literal, max)` — a count, not a blanket file
 * exemption. A second occurrence of the same literal, or any new
 * literal in the same file, is still a violation.
 */
export const ALLOWED_RAW_COLORS = [
	{
		file: 'src/home/mark.tsx',
		literal: '#ffd627',
		max: 1,
		reason:
			'brand identity asset: the SiteMark palette is the logo, ported verbatim from my-web-2025 (commit 27a2d028). A logo is not a status or content signal, so it does not take the signal layer.',
	},
	{
		file: 'src/home/mark.tsx',
		literal: '#fff',
		max: 1,
		reason:
			'brand identity asset: the second SiteMark fill, verbatim from the source artwork (see the #ffd627 entry).',
	},
	{
		file: 'src/home/mark.tsx',
		literal: '#000',
		max: 2,
		reason:
			'brand identity asset: the SiteMark outline fills, verbatim from the source artwork (see the #ffd627 entry).',
	},
	{
		file: 'src/home/reactions/widget.tsx',
		literal: 'rgba(0, 0, 0, 0.45)',
		max: 1,
		reason:
			'a dialog backdrop scrim: it dims whatever is behind the picker, so it must not follow a surface token into the dark appearance (a token would make it a page colour, not a dim layer). Appearance-independent by construction.',
	},
	{
		file: 'src/editorial/pet/PetSprite.tsx',
		literal: 'drop-shadow(0 4px 12px rgba(11, 16, 32, 0.28))',
		max: 1,
		reason:
			'the drag lift on the pet sprite: an alpha shadow used while a pointer holds the sprite, in both appearances. The shadow ramp is a box-shadow scale and cannot express a `drop-shadow()` colour, so it stays a literal at the one place that lifts.',
	},
	{
		file: 'src/routes/__root.tsx',
		literal: '#fcfcfd',
		max: 1,
		reason:
			'the light `theme-color` meta value: the browser paints its own chrome before CSS runs, and `content` cannot take a `var()`. The membership check lives in `scripts/check-app-icons.mjs`, which fails when this literal stops existing in the palette.',
	},
	{
		file: 'src/routes/__root.tsx',
		literal: '#0a0b0e',
		max: 1,
		reason:
			'the dark `theme-color` meta value: the dark counterpart of the #fcfcfd entry, admitted for the same reason and verified against the palette by `scripts/check-app-icons.mjs`.',
	},
];

/* ------------------------------------------------------------------ *
 * detection (pure)
 * ------------------------------------------------------------------ */

/**
 * True when a line is a comment (its own line). A trailing comment is
 * not stripped — a colour in one is still a colour a reader will copy.
 */
function isCommentLine(trimmed) {
	return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/**
 * True when a string literal holds a raw colour, by the rules above.
 */
export function isRawColorValue(value) {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_VALUE_LENGTH) return false;
	if (!isAscii(trimmed)) return false;
	if (HEX_VALUE_PATTERN.test(trimmed)) return true;
	if (HEX_INLINE_PATTERN.test(trimmed)) return true;
	return COLOUR_FUNCTION_PATTERN.test(trimmed);
}

/**
 * Every raw colour in one source string.
 *
 * Returns `[{ line, column, literal }]`, sorted by position. `line` is
 * 1-based and `column` is the offset of the literal's opening quote
 * inside the line.
 */
export function findRawColors(source) {
	const findings = [];
	const lines = source.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (isCommentLine(line.trim())) continue;
		STRING_LITERAL_PATTERN.lastIndex = 0;
		let match = STRING_LITERAL_PATTERN.exec(line);
		while (match !== null) {
			const value = match[2];
			if (isRawColorValue(value)) {
				findings.push({ line: index + 1, column: match.index, literal: value.trim() });
			}
			match = STRING_LITERAL_PATTERN.exec(line);
		}
	}
	return findings;
}

/* ------------------------------------------------------------------ *
 * filesystem walk
 * ------------------------------------------------------------------ */

function walk(dir, out) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		const path = join(dir, entry);
		let info;
		try {
			info = statSync(path);
		} catch {
			continue;
		}
		if (info.isDirectory()) {
			walk(path, out);
			continue;
		}
		if (!SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) continue;
		if (EXEMPT_FILE_PATTERN.test(entry)) continue;
		out.push(path);
	}
	return out;
}

/**
 * Scan a tree and return `{ findings, filesScanned }`. `root` defaults
 * to this repository's `src/`; tests pass a fixture directory.
 */
export function scanSource(root = SRC_ROOT) {
	const files = walk(root, []).sort();
	const findings = [];
	for (const path of files) {
		const relativePath = relative(ROOT, path).split('\\').join('/');
		if (relativePath === PALETTE_OWNER) continue;
		const source = readFileSync(path, 'utf8');
		for (const finding of findRawColors(source)) {
			findings.push({ ...finding, file: relativePath });
		}
	}
	return { findings, filesScanned: files.length };
}

/* ------------------------------------------------------------------ *
 * verdict
 * ------------------------------------------------------------------ */

/**
 * Compare findings against the allowlist.
 *
 * Returns `{ violations, stale, allowed }`:
 *   - `violations` — a finding no allowlist entry covers, or one that
 *     exceeds the entry's count;
 *   - `stale` — an allowlist entry that no longer matches, so the
 *     allowlist cannot accumulate permission for code that is gone.
 */
export function evaluateRawColors(findings, allowlist = ALLOWED_RAW_COLORS) {
	const counts = new Map();
	for (const finding of findings) {
		const key = `${finding.file}\u0000${finding.literal}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	const violations = [];
	const allowed = [];
	for (const [key, count] of counts) {
		const [file, literal] = key.split('\u0000');
		const entry = allowlist.find((item) => item.file === file && item.literal === literal);
		if (!entry) {
			violations.push({ file, literal, count, reason: 'no allowlist entry' });
		} else if (count > entry.max) {
			violations.push({
				file,
				literal,
				count,
				reason: `allowlist permits ${entry.max}, found ${count}`,
			});
		} else {
			allowed.push({ file, literal, count });
		}
	}

	const stale = allowlist.filter((entry) => !counts.has(`${entry.file}\u0000${entry.literal}`));

	return { violations, stale, allowed };
}

/**
 * Render the status-only report. File paths and literals are printed —
 * they are palette decisions, not values — and no source line is
 * dumped.
 */
export function renderReport({ filesScanned, violations, stale, allowed }) {
	const lines = [];
	lines.push(`raw-colour gate — ${filesScanned} source file(s) scanned`);
	lines.push(`  palette owner (exempt): ${PALETTE_OWNER}`);
	lines.push(
		`  allowlisted literal(s): ${allowed.length} (${allowed.reduce((sum, entry) => sum + entry.count, 0)} occurrence(s))`,
	);
	if (violations.length === 0) {
		lines.push('  violations: none');
	} else {
		lines.push(`  violations: ${violations.length}`);
		for (const violation of violations) {
			lines.push(
				`    ${violation.file} — ${JSON.stringify(violation.literal)} (${violation.count}×): ${violation.reason}`,
			);
		}
		lines.push(
			'  fix: use a semantic token (surface.* / text.* / border.* / signal.*); if the value genuinely cannot be a token, add an ALLOWED_RAW_COLORS entry with a reason.',
		);
	}
	if (stale.length > 0) {
		// Not a failure: a stale entry grants permission for code that no
		// longer exists, which is the safe direction. It is still printed
		// (and the shipped-tree test asserts none) so it cannot accumulate.
		lines.push(`  stale allowlist entries: ${stale.length}`);
		for (const entry of stale) {
			lines.push(`    ${entry.file} — ${JSON.stringify(entry.literal)} is no longer present`);
		}
	}
	return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * entrypoint
 * ------------------------------------------------------------------ */

function main() {
	let stat;
	try {
		stat = statSync(SRC_ROOT);
	} catch {
		process.stderr.write(`raw-colour gate: no source tree at ${SRC_ROOT}\n`);
		return 2;
	}
	if (!stat.isDirectory()) {
		process.stderr.write(`raw-colour gate: ${SRC_ROOT} is not a directory\n`);
		return 2;
	}

	const scanned = scanSource();
	const verdict = evaluateRawColors(scanned.findings);
	process.stdout.write(`${renderReport({ filesScanned: scanned.filesScanned, ...verdict })}\n`);
	return verdict.violations.length === 0 ? 0 : 1;
}

const isDirectRun = (() => {
	if (process.argv[1] === undefined) return false;
	try {
		// `realpath` because a temp directory (`/var/…`) and its real
		// path (`/private/var/…`) name the same file on macOS.
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
})();

if (isDirectRun) {
	// `exitCode` rather than `process.exit()` so the report flushes.
	process.exitCode = main();
}
