#!/usr/bin/env node
/**
 * Attestation manifest internal-integrity check (Issue #816).
 *
 *   node scripts/check-attestation-manifest-integrity.mjs --manifest=<path>
 *   node scripts/check-attestation-manifest-integrity.mjs --manifest=<path> --json
 *
 * Why this exists
 * ---------------
 * `scripts/check-artifact-attestation.mjs --manifest` answers the
 * question a release is supposed to answer: "are these bytes the bytes
 * this manifest describes?" It needs the bytes. When the artifact was
 * never retained (Issue #816 — the CI upload step pointed at a
 * directory no build produces), that question is unanswerable, and the
 * honest verdict is "not executed".
 *
 * But one question is still answerable without the bytes: is the
 * document internally consistent? A manifest carries the whole build's
 * per-file sha-256 list and an aggregate digest derived from it. If the
 * aggregate does not match its own list, or the recorded counts do not
 * match, the document cannot describe any artifact at all — and a
 * reader can know that without holding a single byte.
 *
 * This check NEVER passes a release. Its verdict is explicitly
 * `bytes_verified=false`: PASS means "the record agrees with itself",
 * which is a necessary condition, not a byte comparison. The tool that
 * compares bytes is `check-artifact-attestation.mjs`; this one exists
 * so that "not executed" can at least be narrowed to the part that is
 * genuinely unanswerable.
 *
 * Status-only by construction: it reads one JSON document the caller
 * names, prints counts, digests and verdicts, and touches no network,
 * no credential, no binding and no production host.
 *
 * Exit codes: 0 = internally consistent, 1 = finding, 2 = bad input.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	DIGEST_ALGORITHM,
	REPO_ROOT,
	SCHEMA,
	digestFromFiles,
	isArtifactFileRecord,
} from './_artifact-attestation.mjs';

const USAGE = `Attestation manifest internal integrity (Issue #816)

  node scripts/check-attestation-manifest-integrity.mjs --manifest=<path> [--json]

Options:
  --manifest=<path>  the manifest document to inspect
  --json             print the result as JSON
  --help             this text

This check does NOT compare bytes. PASS means the manifest's own
per-file record and aggregate digest agree; the bytes it describes
remain unverified until check-artifact-attestation.mjs verifies them.

Exit codes: 0 = consistent, 1 = finding, 2 = bad input.`;

function parseArgs(argv) {
	const options = { manifest: null, json: false, help: false };
	for (const arg of argv) {
		if (arg === '--') continue;
		if (arg === '--help' || arg === '-h') options.help = true;
		else if (arg === '--json') options.json = true;
		else if (arg.startsWith('--manifest=')) options.manifest = arg.slice(11);
		else throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

/**
 * Inspect one manifest document.
 *
 * Returns the same shape for a readable document and an unreadable one,
 * because the caller (and the test) only needs the verdict, the checks
 * and the findings — never the document's bytes.
 *
 * @param {unknown} manifest parsed JSON document
 */
export function inspectManifest(manifest) {
	const checks = [];
	const findings = [];
	const pass = (id, detail) => checks.push({ id, status: 'PASS', detail });
	const fail = (id, detail, code) => {
		checks.push({ id, status: 'FAIL', detail });
		findings.push({ code, detail });
	};

	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		fail('Document', 'manifest is not a JSON object', 'MANIFEST_UNREADABLE');
		return { status: 'FAIL', bytesVerified: false, checks, findings };
	}

	if (manifest.schema === SCHEMA) pass('Schema', SCHEMA);
	else
		fail(
			'Schema',
			`manifest schema is ${JSON.stringify(manifest.schema)}, expected ${SCHEMA}`,
			'SCHEMA_UNSUPPORTED',
		);

	const subject = manifest.subject;
	const files = subject?.files;
	const algorithm = subject?.digest?.algorithm;

	if (algorithm === DIGEST_ALGORITHM) pass('Digest algorithm', DIGEST_ALGORITHM);
	else
		fail(
			'Digest algorithm',
			`manifest algorithm is ${JSON.stringify(algorithm)}`,
			'DIGEST_ALGORITHM_UNSUPPORTED',
		);

	if (!Array.isArray(files)) {
		fail('Subject files', 'manifest carries no per-file record', 'MANIFEST_FILES_INVALID');
		return { status: 'FAIL', bytesVerified: false, checks, findings };
	}

	// A document with no files cannot describe an artifact. This is the
	// same reason `verifyManifest` fails an empty subject: an empty list
	// agrees with itself perfectly and proves nothing.
	if (files.length === 0) {
		fail(
			'Subject files',
			'the per-file record is empty, so the manifest describes no artifact',
			'ARTIFACT_EMPTY',
		);
		return { status: 'FAIL', bytesVerified: false, checks, findings };
	}

	const malformed = files.filter((file) => !isArtifactFileRecord(file));
	if (malformed.length === 0) {
		pass('Subject files', `${files.length} well-formed per-file records`);
	} else {
		fail(
			'Subject files',
			`${malformed.length} of ${files.length} per-file records are not a regular file with bytes + sha-256`,
			'MANIFEST_FILES_INVALID',
		);
	}

	if (malformed.length > 0) {
		// The aggregate cannot be recomputed from a list that is not a
		// list of file records; stop here rather than invent a digest.
		return { status: 'FAIL', bytesVerified: false, checks, findings };
	}

	const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
	if (subject.file_count === files.length) pass('File count', String(files.length));
	else
		fail(
			'File count',
			`manifest declares ${JSON.stringify(subject.file_count)} files but records ${files.length}`,
			'MANIFEST_FILES_INVALID',
		);

	if (subject.total_bytes === totalBytes) pass('Total bytes', String(totalBytes));
	else
		fail(
			'Total bytes',
			`manifest declares ${JSON.stringify(subject.total_bytes)} bytes but its files sum to ${totalBytes}`,
			'MANIFEST_FILES_INVALID',
		);

	const recomputed = digestFromFiles(files);
	if (subject.digest?.value === recomputed) pass('Aggregate digest', recomputed);
	else
		fail(
			'Aggregate digest',
			`recorded ${JSON.stringify(subject.digest?.value)} does not match the digest of the manifest's own file list ${recomputed}`,
			'MANIFEST_FILE_DIGEST_MISMATCH',
		);

	return {
		status: findings.length === 0 ? 'PASS' : 'FAIL',
		// Named so no reader can mistake this verdict for a byte
		// comparison. Always false, on purpose.
		bytesVerified: false,
		fileCount: files.length,
		totalBytes,
		recomputedDigest: recomputed,
		recordedDigest: subject.digest?.value ?? null,
		checks,
		findings,
	};
}

function format(result, { manifestPath }) {
	const lines = [`manifest: ${manifestPath}`];
	for (const check of result.checks) {
		lines.push(`  ${check.status}  ${check.id}: ${check.detail}`);
	}
	for (const finding of result.findings) {
		lines.push(`  FINDING ${finding.code}: ${finding.detail}`);
	}
	lines.push(
		result.status === 'PASS'
			? 'PASS  the manifest is internally consistent'
			: 'FAIL  the manifest does not agree with its own per-file record',
	);
	lines.push(
		'bytes_verified=false  this check compares no bytes; only check-artifact-attestation.mjs --artifact-dir does',
	);
	return lines.join('\n');
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log(USAGE);
		return 0;
	}
	if (!options.manifest) {
		console.error(`[attestation-integrity] --manifest=<path> is required.\n\n${USAGE}`);
		return 2;
	}

	const manifestPath = resolve(REPO_ROOT, options.manifest);
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch (error) {
		console.error(`[attestation-integrity] cannot read manifest ${manifestPath}: ${error.message}`);
		return 2;
	}

	const result = inspectManifest(manifest);
	if (options.json) {
		console.log(JSON.stringify({ manifest: manifestPath, ...result }, null, 2));
	} else {
		console.log(format(result, { manifestPath }));
	}
	return result.status === 'PASS' ? 0 : 1;
}

// Run only when invoked directly, so the test can import the pure part.
if (import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = main();
}
