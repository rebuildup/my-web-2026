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
 * skipped by construction; a file that cannot be read is reported,
 * never silently passed.
 *
 * Markers live in ONE place — {@link CONTAMINATION_MARKERS} — so a
 * future serialisation format adds a line, not a second scanner.
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
	// bracket-pipe control envelope begin/end forms
	'<' + '|' + 'end' + '_message',
	'<' + '|' + 'message' + '_model',
	'<' + '|' + 'content' + '_invoke',
	// bare serialisation tokens seen in the incident
	'end' + '_message',
	'message' + '_model',
	'content' + '_invoke_tool_json',
];

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;

/**
 * The tracked file list, from git itself — never a hand-maintained
 * glob, so a new file type is covered the day it is committed.
 */
export function listTrackedFiles(root = ROOT) {
	const out = execFileSync('git', ['ls-files', '-z'], {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	return out.split('\0').filter((p) => p.length > 0);
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
	const hits = [];
	for (const marker of CONTAMINATION_MARKERS) {
		const needle = Buffer.from(marker, 'utf8');
		if (buffer.includes(needle)) hits.push({ relPath, marker });
	}
	return hits;
}

/**
 * Scan the whole tree. Returns `{ hits, scanned, skipped }`.
 * Throws when git or the filesystem cannot be read (exit 2 upstream).
 */
export function scanRepository(root = ROOT) {
	const files = listTrackedFiles(root);
	const hits = [];
	let scanned = 0;
	let skipped = 0;
	for (const relPath of files) {
		const abs = resolve(root, relPath);
		let buffer;
		try {
			buffer = readFileSync(abs);
		} catch {
			// A tracked path that cannot be read (e.g. a gitlink or a
			// broken symlink target) is skipped like a binary — it has
			// no text content to contaminate.
			skipped += 1;
			continue;
		}
		if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES || !isProbableText(buffer)) {
			skipped += 1;
			continue;
		}
		scanned += 1;
		hits.push(...scanBuffer(buffer, relPath));
	}
	return { hits, scanned, skipped };
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
	const { hits, scanned, skipped } = scanRepository();
	if (args.json) {
		writeFileSync(args.json, `${JSON.stringify({ hits, scanned, skipped }, null, 2)}\n`);
	}
	if (hits.length === 0) {
		if (!args.quiet) {
			console.log(
				`[doc-contamination] clean — ${scanned} file(s) scanned, ${skipped} skipped (binary/oversize/unreadable)`,
			);
		}
		return 0;
	}
	for (const hit of hits) {
		console.error(`[doc-contamination] FAIL ${hit.relPath}: prohibited marker present`);
	}
	console.error(`[doc-contamination] ${hits.length} hit(s) in ${scanned} scanned file(s)`);
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
