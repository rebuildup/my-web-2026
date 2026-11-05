#!/usr/bin/env node
/**
 * Downloaded Build Output artifact check (Issue #816).
 *
 *   node scripts/check-build-output-artifact.mjs \
 *     --artifact-dir=<downloaded artifact root> \
 *     --manifest=<artifact-attestation.json>
 *
 * What it proves
 * --------------
 * A CI run uploads two artifacts: the attestation manifest and the
 * Build Output the manifest describes. The owner decision (Issue #816,
 * 2026-11-02) makes the byte comparison between them a MANDATORY
 * release gate: the bytes that come back out of the artifact store
 * must be the bytes the run produced, or the release stops.
 *
 * This script is the artifact-side half of that gate. It answers two
 * questions about a DOWNLOADED artifact, both fail-closed:
 *
 *   1. BYTES    — do the retained bytes still match the manifest's
 *                 record of that run's build output (per-file sha-256,
 *                 file count, total bytes, aggregate digest, and the
 *                 set of paths)?
 *   2. SECRETS  — does the retained artifact carry a secret shape?
 *                 The artifact lives in a PUBLIC repository's artifact
 *                 store for 90 days, so the bytes a downloader receives
 *                 are the bytes that must be safe to keep.
 *
 * Status-only by construction. The output carries paths, counts,
 * digests and reason codes — never a file's content, never a matched
 * credential (AGENTS.md section 4; the same disclosure invariant
 * `scripts/_secret-scan.mjs` keeps). A finding names the file, the
 * detector id, the value length and a SHA-256 prefix, exactly like the
 * repository's other secret scanner.
 *
 * The byte comparison itself is not re-implemented here: the digest
 * computation comes from `scripts/_artifact-attestation.mjs`, the same
 * module the generator and the canonical verifier use, so the three
 * tools cannot drift apart.
 *
 * Exit codes: 0 = pass, 1 = mismatch / finding, 2 = bad input.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
	AttestationError,
	collectArtifactFiles,
	digestFromFiles,
} from './_artifact-attestation.mjs';
import { describeMatch, isScannableText, scanContent } from './_secret-scan.mjs';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');

/**
 * Files above this size are not read for the secret scan. The
 * repository's bundle scan uses the same bound; a file bigger than
 * this is reported as skipped rather than silently dropped, so the
 * coverage claim stays honest.
 */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

/** Reason codes. Stable strings: a runbook may cite them. */
export const REASONS = Object.freeze({
	ARTIFACT_UNREADABLE: 'ARTIFACT_UNREADABLE',
	MANIFEST_UNREADABLE: 'MANIFEST_UNREADABLE',
	SHAPE_MISMATCH: 'SHAPE_MISMATCH',
	PATH_SET_MISMATCH: 'PATH_SET_MISMATCH',
	FILE_DIGEST_MISMATCH: 'FILE_DIGEST_MISMATCH',
	AGGREGATE_DIGEST_MISMATCH: 'AGGREGATE_DIGEST_MISMATCH',
	SYMLINK_PRESENT: 'SYMLINK_PRESENT',
	SECRET_SHAPE_DETECTED: 'SECRET_SHAPE_DETECTED',
});

function parseArgs(argv) {
	const options = {
		artifactDir: null,
		manifest: null,
		json: false,
		help: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		// `pnpm run <script> -- <args>` forwards the literal separator.
		if (arg === '--') continue;
		if (arg === '--help' || arg === '-h') options.help = true;
		else if (arg === '--json') options.json = true;
		else if (arg.startsWith('--artifact-dir=')) options.artifactDir = arg.slice(15);
		else if (arg.startsWith('--manifest=')) options.manifest = arg.slice(11);
		else if (arg === '--artifact-dir' || arg === '--manifest') {
			const key = arg === '--artifact-dir' ? 'artifactDir' : 'manifest';
			const value = argv[index + 1];
			if (value === undefined) throw new Error(`missing value for ${arg}`);
			options[key] = value;
			index += 1;
		} else throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

const USAGE = `Downloaded Build Output artifact check (Issue #816)

  node scripts/check-build-output-artifact.mjs --artifact-dir=<dir> --manifest=<path>

Options:
  --artifact-dir=<dir>   the downloaded artifact root (required)
  --manifest=<path>      the attestation manifest of that run (required)
  --json                 print the verdict as JSON
  --help                 this text

Exit codes: 0 = pass, 1 = mismatch / finding, 2 = bad input.`;

/**
 * Compare the downloaded bytes with the manifest's record of the run's
 * build output.
 *
 * Every difference is a reason code, never a diff of content: the
 * artifact's bytes must not be rendered.
 */
export function compareBytes({ files, subject }) {
	const reasons = [];
	const recorded = new Map(subject.files.map((file) => [file.path, file]));
	const actual = new Map(files.map((file) => [file.path, file]));

	const missing = subject.files
		.map((file) => file.path)
		.filter((path) => !actual.has(path))
		.sort();
	const extra = files
		.map((file) => file.path)
		.filter((path) => !recorded.has(path))
		.sort();
	if (missing.length > 0 || extra.length > 0) {
		reasons.push({
			code: REASONS.PATH_SET_MISMATCH,
			detail: `${missing.length} missing, ${extra.length} extra`,
			paths: [
				...missing.map((path) => `missing: ${path}`),
				...extra.map((path) => `extra: ${path}`),
			],
		});
	}

	const digestMismatches = [];
	for (const file of files) {
		const expected = recorded.get(file.path);
		if (!expected) continue;
		if (expected.sha256 !== file.sha256 || expected.bytes !== file.bytes) {
			digestMismatches.push(file.path);
		}
	}
	if (digestMismatches.length > 0) {
		reasons.push({
			code: REASONS.FILE_DIGEST_MISMATCH,
			detail: `${digestMismatches.length} of ${files.length} file(s) differ`,
			paths: digestMismatches.sort(),
		});
	}

	const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
	if (files.length !== subject.file_count || totalBytes !== subject.total_bytes) {
		reasons.push({
			code: REASONS.SHAPE_MISMATCH,
			detail: `files ${files.length} vs recorded ${subject.file_count}, bytes ${totalBytes} vs recorded ${subject.total_bytes}`,
			paths: [],
		});
	}

	const aggregate = digestFromFiles(files);
	if (aggregate !== subject.digest.value) {
		reasons.push({
			code: REASONS.AGGREGATE_DIGEST_MISMATCH,
			detail: `aggregate sha256 ${aggregate} vs recorded ${subject.digest.value}`,
			paths: [],
		});
	}

	return {
		reasons,
		fileCount: files.length,
		totalBytes,
		aggregate,
		ok: reasons.length === 0,
	};
}

/**
 * Scan the retained bytes for secret shapes.
 *
 * The detector engine is the repository's own (`scripts/_secret-scan.mjs`)
 * in `bundle` mode: minified output spells variables `t`, `n`, `e`, so
 * the context rules stay off and only self-anchored shapes run.
 */
export async function scanArtifactFiles(root, files) {
	const violations = [];
	let scanned = 0;
	let skipped = 0;
	for (const file of files) {
		if (file.bytes > MAX_SCAN_BYTES) {
			skipped += 1;
			continue;
		}
		const buffer = readFileSync(join(root, file.path));
		if (!isScannableText(file.path, buffer)) {
			skipped += 1;
			continue;
		}
		scanned += 1;
		violations.push(...(await scanContent(file.path, buffer, { mode: 'bundle' })));
	}
	return { violations, scanned, skipped };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log(USAGE);
		return 0;
	}
	if (!options.artifactDir || !options.manifest) {
		console.error(
			'[build-output-artifact] FAIL: --artifact-dir and --manifest are both required. ' +
				'Without the manifest there is no recorded build output to compare the bytes against.',
		);
		return 2;
	}

	const artifactDir = resolve(REPO_ROOT, options.artifactDir);
	const manifestPath = resolve(REPO_ROOT, options.manifest);
	if (!existsSync(artifactDir)) {
		console.error(
			`[build-output-artifact] FAIL: ${REASONS.ARTIFACT_UNREADABLE}: artifact directory not found: ${artifactDir}\nDownload it first (gh run download <run-id> -n cf-build-output-<sha> -D <dir>).`,
		);
		return 2;
	}
	if (!existsSync(manifestPath)) {
		console.error(
			`[build-output-artifact] FAIL: ${REASONS.MANIFEST_UNREADABLE}: manifest not found: ${manifestPath}`,
		);
		return 2;
	}

	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch (error) {
		console.error(`[build-output-artifact] FAIL: ${REASONS.MANIFEST_UNREADABLE}: ${error.message}`);
		return 2;
	}
	const subject = manifest?.subject;
	if (!subject || !Array.isArray(subject.files) || typeof subject.digest?.value !== 'string') {
		console.error(
			`[build-output-artifact] FAIL: ${REASONS.MANIFEST_UNREADABLE}: the manifest declares no subject (files + digest), so it names no build output to compare the bytes against.`,
		);
		return 2;
	}

	let files;
	try {
		files = collectArtifactFiles(artifactDir);
	} catch (error) {
		const code =
			error instanceof AttestationError && error.message.includes('symlink')
				? REASONS.SYMLINK_PRESENT
				: REASONS.ARTIFACT_UNREADABLE;
		console.error(`[build-output-artifact] FAIL: ${code}: ${error.message}`);
		return 1;
	}

	const bytes = compareBytes({ files, subject });
	const scan = await scanArtifactFiles(artifactDir, files);
	const secretReasons =
		scan.violations.length > 0
			? [
					{
						code: REASONS.SECRET_SHAPE_DETECTED,
						detail: `${scan.violations.length} finding(s) in ${scan.scanned} scanned file(s)`,
						paths: scan.violations.map((violation) => describeMatch(violation)),
					},
				]
			: [];

	const reasons = [...bytes.reasons, ...secretReasons];
	const result = {
		artifactDir,
		manifestPath,
		bytes: {
			fileCount: bytes.fileCount,
			totalBytes: bytes.totalBytes,
			aggregate: bytes.aggregate,
			match: bytes.ok,
		},
		secrets: {
			scanned: scan.scanned,
			skipped: scan.skipped,
			findings: scan.violations.length,
		},
		reasons: reasons.map((reason) => reason.code),
		status: reasons.length === 0 ? 'PASS' : 'FAIL',
	};

	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`[build-output-artifact] artifact: ${artifactDir}`);
		console.log(`[build-output-artifact] manifest: ${manifestPath}`);
		if (bytes.ok) {
			console.log(
				`[build-output-artifact] BYTES    match — ${bytes.fileCount} file(s), ${bytes.totalBytes} byte(s), aggregate sha256 ${bytes.aggregate}`,
			);
		} else {
			console.log(
				`[build-output-artifact] BYTES    MISMATCH — ${bytes.fileCount} file(s), ${bytes.totalBytes} byte(s), aggregate sha256 ${bytes.aggregate}`,
			);
		}
		for (const reason of reasons) {
			console.log(`[build-output-artifact]   ${reason.code}: ${reason.detail}`);
			for (const line of reason.paths.slice(0, 20)) {
				console.log(`[build-output-artifact]     ${line}`);
			}
		}
		if (scan.violations.length === 0) {
			console.log(
				`[build-output-artifact] SECRETS  clean — ${scan.scanned} file(s) scanned, ${scan.skipped} skipped as non-text or oversized`,
			);
		}
		console.log(`[build-output-artifact] ${result.status}`);
	}

	return result.status === 'PASS' ? 0 : 1;
}

try {
	process.exitCode = await main();
} catch (error) {
	console.error(`[build-output-artifact] FAIL: ${error?.message ?? error}`);
	process.exitCode = 2;
}
