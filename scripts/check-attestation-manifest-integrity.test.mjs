/**
 * Attestation manifest internal-integrity tests (Issue #816).
 *
 * The point of the check is the verdict it refuses to give, so the
 * important assertions are that a PASS still reports
 * `bytes_verified=false` and that a document which disagrees with its own
 * file list fails. Every abnormal case is a real mutation of a manifest
 * document, not a mocked verdict.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { DIGEST_ALGORITHM, REPO_ROOT, SCHEMA, digestFromFiles } from './_artifact-attestation.mjs';
import { inspectManifest } from './check-attestation-manifest-integrity.mjs';

const CLI_PATH = join(REPO_ROOT, 'scripts', 'check-attestation-manifest-integrity.mjs');

const FILES = [
	{ path: 'config.json', kind: 'file', bytes: 103, sha256: 'a'.repeat(64) },
	{ path: 'workers/default/bundle/worker.js', kind: 'file', bytes: 4096, sha256: 'b'.repeat(64) },
];

/** A manifest that agrees with itself. */
function manifest(overrides = {}) {
	const digest = digestFromFiles(FILES);
	return {
		schema: SCHEMA,
		// A fixture version, never a release. `version:check` forbids a real
		// release literal in a script or test surface.
		project: { name: 'my-web-2026', version: '9.9.9' },
		source: {
			repository: 'https://github.com/rebuildup/my-web-2026',
			commit: '93b999dd4562a1a8f61f6a73d1e9510f08ede075',
			branch: 'main',
			tree: 'clean',
		},
		subject: {
			kind: 'cloudflare-build-output',
			root: '.cloudflare/output/v0',
			digest: { algorithm: DIGEST_ALGORITHM, value: digest },
			file_count: FILES.length,
			total_bytes: FILES.reduce((sum, file) => sum + file.bytes, 0),
			files: FILES,
		},
		coverage: { artifact_origin: 'github-actions-production-build-output' },
		...overrides,
	};
}

const tempRoots = [];
function writeTemp(document) {
	const dir = mkdtempSync(join(tmpdir(), 'attestation-integrity-'));
	tempRoots.push(dir);
	const path = join(dir, 'artifact-attestation.json');
	writeFileSync(path, JSON.stringify(document));
	return path;
}

after(() => {
	for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

describe('inspectManifest', () => {
	it('passes a manifest that agrees with its own file record', () => {
		const result = inspectManifest(manifest());
		assert.equal(result.status, 'PASS');
		assert.deepEqual(result.findings, []);
		assert.equal(result.fileCount, FILES.length);
		assert.equal(result.recomputedDigest, result.recordedDigest);
	});

	it('never claims the bytes were verified, even on PASS', () => {
		// The whole reason this check exists: "internally consistent" is
		// not "the published bytes match". A release whose artifact was
		// never retained (Issue #816) can only be reported this way.
		assert.equal(inspectManifest(manifest()).bytesVerified, false);
	});

	it('fails when the aggregate digest disagrees with the file list', () => {
		const document = manifest();
		document.subject = {
			...document.subject,
			digest: { algorithm: DIGEST_ALGORITHM, value: 'c'.repeat(64) },
		};
		const result = inspectManifest(document);
		assert.equal(result.status, 'FAIL');
		assert.equal(result.findings[0].code, 'MANIFEST_FILE_DIGEST_MISMATCH');
	});

	it('fails when a file record is not a regular file with a digest', () => {
		const document = manifest();
		document.subject = {
			...document.subject,
			files: [...FILES, { path: 'assets', kind: 'directory', bytes: 0 }],
		};
		const result = inspectManifest(document);
		assert.equal(result.status, 'FAIL');
		assert.equal(result.findings[0].code, 'MANIFEST_FILES_INVALID');
		assert.match(result.findings[0].detail, /1 of 3 per-file records/);
	});

	it('fails when the declared file count does not match the record', () => {
		const document = manifest();
		document.subject = { ...document.subject, file_count: FILES.length + 1 };
		const result = inspectManifest(document);
		assert.equal(result.status, 'FAIL');
		assert.match(result.findings[0].detail, /declares 3 files but records 2/);
	});

	it('fails when the declared total bytes do not match the record', () => {
		const document = manifest();
		document.subject = { ...document.subject, total_bytes: 1 };
		const result = inspectManifest(document);
		assert.equal(result.status, 'FAIL');
		assert.match(result.findings[0].detail, /declares 1 bytes but its files sum to 4199/);
	});

	it('fails an empty file list, which would agree with itself perfectly', () => {
		const document = manifest();
		document.subject = {
			...document.subject,
			files: [],
			file_count: 0,
			total_bytes: 0,
			digest: { algorithm: DIGEST_ALGORITHM, value: digestFromFiles([]) },
		};
		const result = inspectManifest(document);
		assert.equal(result.status, 'FAIL');
		assert.equal(result.findings[0].code, 'ARTIFACT_EMPTY');
	});

	it('fails a document with no per-file record at all', () => {
		const document = manifest();
		document.subject = { ...document.subject, files: undefined };
		const result = inspectManifest(document);
		assert.equal(result.status, 'FAIL');
		assert.equal(result.findings[0].code, 'MANIFEST_FILES_INVALID');
	});

	it('fails a non-sha-256 manifest', () => {
		const document = manifest();
		document.subject = {
			...document.subject,
			digest: { algorithm: 'sha-1', value: 'd'.repeat(40) },
		};
		const result = inspectManifest(document);
		assert.equal(result.status, 'FAIL');
		assert.ok(result.findings.some((finding) => finding.code === 'DIGEST_ALGORITHM_UNSUPPORTED'));
	});

	it('fails an unknown schema', () => {
		const result = inspectManifest(manifest({ schema: 'my-web-2026/artifact-attestation/v0' }));
		assert.equal(result.status, 'FAIL');
		assert.ok(result.findings.some((finding) => finding.code === 'SCHEMA_UNSUPPORTED'));
	});

	it('fails a document that is not an object', () => {
		const result = inspectManifest([1, 2, 3]);
		assert.equal(result.status, 'FAIL');
		assert.equal(result.findings[0].code, 'MANIFEST_UNREADABLE');
	});
});

describe('CLI', () => {
	it('exits 0 on a consistent manifest and prints that no bytes were verified', () => {
		const path = writeTemp(manifest());
		const result = spawnSync('node', [CLI_PATH, `--manifest=${path}`], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /PASS {2}the manifest is internally consistent/);
		assert.match(result.stdout, /bytes_verified=false/);
	});

	it('exits 1 on a manifest that disagrees with itself', () => {
		const document = manifest();
		document.subject = { ...document.subject, total_bytes: 1 };
		const path = writeTemp(document);
		const result = spawnSync('node', [CLI_PATH, `--manifest=${path}`], { encoding: 'utf8' });
		assert.equal(result.status, 1);
		assert.match(result.stdout, /FAIL {2}the manifest does not agree with its own per-file record/);
	});

	it('exits 2 when the manifest cannot be read', () => {
		const result = spawnSync('node', [CLI_PATH, '--manifest=/nonexistent/manifest.json'], {
			encoding: 'utf8',
		});
		assert.equal(result.status, 2);
		assert.match(result.stderr, /cannot read manifest/);
	});

	it('exits 2 when --manifest is missing', () => {
		const result = spawnSync('node', [CLI_PATH], { encoding: 'utf8' });
		assert.equal(result.status, 2);
		assert.match(result.stderr, /--manifest=<path> is required/);
	});
});
