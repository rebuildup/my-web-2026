#!/usr/bin/env node

/**
 * Documentation/tool-output contamination gate (Issue #1038).
 *
 * Why this gate exists
 * --------------------
 * During the a recent release freeze, three committed verification documents
 * picked up agent tool-call serialisation fragments at EOF (bracket-
 * pipe control envelopes and bare serialisation tokens naming message
 * boundaries / model switches / tool invocations). `tail`-based
 * inspection missed them
 * because the fragments were concatenated onto the last text line
 * without a newline; only byte-level inspection found them. A human
 * reviewer skimming the rendered document would never see them either.
 *
 * The failure mode is a WRITE-path accident, not a code defect, so the
 * gate scans committed TEXT content for marker byte sequences rather
 * than checking behaviour. One hit fails the run.
 *
 * Scope
 * -----
 * Every file `git ls-files` reports, filtered to plausible text
 * (no NUL byte in the first 8 KiB, size <= 2 MiB). Binary assets are
 * skipped by construction. Submodule gitlinks (mode 160000) carry no
 * text bytes and are skipped by mode. **Every other tracked path
 * that cannot be read FAILS the gate** — a file `git ls-files`
 * reports but the worktree cannot supply (deleted, dangling
 * symlink, denied permission) is reported, never silently passed:
 * "I could not look" must never read as "I looked and it was
 * clean".
 *
 * Markers live in ONE place — {@link CONTAMINATION_MARKERS} and
 * {@link CONTAMINATION_PATTERNS} — so a future serialisation format
 * adds a line, not a second scanner.
 *
 * Exit codes: 0 = clean, 1 = at least one contaminated file,
 * 2 = the repository could not be scanned.
 *
 * Usage:
 *   node scripts/check-doc-contamination.mjs [--json=FILE] [--quiet]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The prohibited marker byte sequences, in ONE place.
 *
 * Each entry is a literal substring (UTF-8). They name serialisation
 * control tokens only — prose that merely discusses them (this file,
 * Issue #1038, runbooks) does not appear because the gate scans for
 * the byte sequences, and the checker's own source is excluded by the
 * binary/text filter? No — it IS scanned; the markers below are
 * written as concatenated fragments so this file does not match
 * itself.
 */
export const CONTAMINATION_MARKERS = [
	// bracket-pipe control envelope begin forms (truncated fragments
	// still match: the incident bytes were concatenated mid-token)
	'<' + '|' + 'end' + '_message',
	'<' + '|' + 'message' + '_model',
	'<' + '|' + 'content' + '_invoke',
	// bare serialisation tokens seen in the incident
	'end' + '_message',
	'message' + '_model',
	'content' + '_invoke_tool_json',
];

/**
 * Generic bracket-pipe envelope patterns, for serialisation tokens
 * this incident did not name (a future end-turn-style token must
 * fail the same way the three observed ones did). The example
 * envelope is deliberately NOT spelled out: this file is itself a
 * tracked text file, and writing the byte sequence here would trip
 * the gate it implements.
 *
 * The inner token is a single snake_case identifier — the shape
 * every observed serialisation envelope used. The regex SOURCE
 * spells the brackets with escapes, so this file does not match
 * its own patterns.
 */
export const CONTAMINATION_PATTERNS = [
	/<\|[A-Za-z_][A-Za-z0-9_]*\|>/,
	/\[ ?\|[A-Za-z_][A-Za-z0-9_]* ?\| ?\]/,
];

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;
const GITLINK_MODE = '160000';

/**
 * The tracked file list, from git itself — never a hand-maintained
 * glob, so a new file type is covered the day it is committed.
 * `git ls-files -s` also reports the index MODE, which is how the
 * scanner tells a submodule gitlink (160000 — a directory, no text
 * bytes) apart from a real file that failed to read.
 */
export function listTrackedEntries(root = ROOT) {
	const out = execFileSync('git', ['ls-files', '-s', '-z'], {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	return out
		.split('\0')
		.filter((record) => record.length > 0)
		.map((record) => {
			const tab = record.indexOf('\t');
			const mode = record.slice(0, tab).split(' ')[0];
			return { mode, path: record.slice(tab + 1) };
		});
}

/** Repo-relative paths of every tracked entry (gitlinks included). */
export function listTrackedFiles(root = ROOT) {
	return listTrackedEntries(root).map((entry) => entry.path);
}

/** True when the buffer looks like text (no NUL in the sniff window). */
export function isProbableText(buffer) {
	const sniff = buffer.subarray(0, Math.min(buffer.length, BINARY_SNIFF_BYTES));
	return !sniff.includes(0);
}

/**
 * Scan one file's bytes; returns the list of markers found.
 * `relPath` is used only for reporting.
 */
export function scanBuffer(buffer, relPath) {
	const text = buffer.toString('utf8');
	const hits = [];
	for (const marker of CONTAMINATION_MARKERS) {
		if (buffer.includes(Buffer.from(marker, 'utf8'))) hits.push({ relPath, marker });
	}
	for (const pattern of CONTAMINATION_PATTERNS) {
		const match = pattern.exec(text);
		if (match) hits.push({ relPath, marker: `pattern:${pattern.source}` });
	}
	return hits;
}

/**
 * Scan the whole tree. Returns `{ hits, unreadable, scanned,
 * skipped }`.
 *
 * `unreadable` is a FAILURE list, not a skip list: a tracked path
 * that is not a submodule gitlink but cannot be read (deleted from
 * the worktree, dangling symlink, denied permission) means the gate
 * could not inspect committed text — the one outcome this gate
 * exists to prevent. Only gitlinks (mode 160000) and readable
 * binary/oversize/empty files land in `skipped`.
 *
 * Throws when git itself cannot be read (exit 2 upstream).
 */
export function scanRepository(root = ROOT) {
	const entries = listTrackedEntries(root);
	const hits = [];
	const unreadable = [];
	let scanned = 0;
	let skipped = 0;
	for (const { mode, path: relPath } of entries) {
		if (mode === GITLINK_MODE) {
			// A submodule is a directory of someone else's commits;
			// it carries no text bytes this gate can contaminate.
			skipped += 1;
			continue;
		}
		const abs = resolve(root, relPath);
		let buffer;
		try {
			buffer = readFileSync(abs);
		} catch (error) {
			unreadable.push({ relPath, reason: error.code ?? String(error.message) });
			continue;
		}
		if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES || !isProbableText(buffer)) {
			skipped += 1;
			continue;
		}
		scanned += 1;
		hits.push(...scanBuffer(buffer, relPath));
	}
	return { hits, unreadable, scanned, skipped };
}

function parseArgs(argv) {
	const args = { json: null, quiet: false };
	for (const arg of argv) {
		if (arg === '--quiet') args.quiet = true;
		else if (arg.startsWith('--json=')) args.json = arg.slice('--json='.length);
		else throw new Error(`unknown option: ${arg}`);
	}
	return args;
}

export function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	const { hits, unreadable, scanned, skipped } = scanRepository();
	if (args.json) {
		writeFileSync(
			args.json,
			`${JSON.stringify({ hits, unreadable, scanned, skipped }, null, 2)}\n`,
		);
	}
	const failed = hits.length > 0 || unreadable.length > 0;
	if (!failed) {
		if (!args.quiet) {
			console.log(
				`[doc-contamination] clean — ${scanned} file(s) scanned, ${skipped} skipped (binary/oversize/gitlink)`,
			);
		}
		return 0;
	}
	for (const hit of hits) {
		console.error(`[doc-contamination] FAIL ${hit.relPath}: prohibited marker present`);
	}
	for (const entry of unreadable) {
		console.error(
			`[doc-contamination] FAIL ${entry.relPath}: tracked file unreadable (${entry.reason})`,
		);
	}
	console.error(
		`[doc-contamination] ${hits.length} contaminated file hit(s), ${unreadable.length} unreadable tracked file(s) in ${scanned} scanned file(s)`,
	);
	return 1;
}

// realpath on both sides: temp dirs on macOS live under /var, a
// symlink to /private/var, so a lexical compare reports "not direct"
// and the gate would exit 0 having scanned nothing.
const invokedDirectly =
	process.argv[1] &&
	realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	try {
		process.exit(main());
	} catch (error) {
		console.error(`[doc-contamination] repository could not be scanned: ${error.message}`);
		process.exit(2);
	}
}
