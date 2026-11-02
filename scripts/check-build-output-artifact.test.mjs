/**
 * Downloaded Build Output artifact check tests (Issue #816).
 *
 * The gate decides whether the bytes a downloader receives are the
 * bytes the run produced, so the tests build real directories on disk
 * and real manifests over them. A fabricated verdict would prove
 * nothing about the digest computation, the path comparison or the
 * secret detector.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import { digestFromFiles, sha256Bytes } from './_artifact-attestation.mjs';

const CLI_PATH = join(
	dirname(new URL(import.meta.url).pathname),
	'check-build-output-artifact.mjs',
);

const tempRoots = [];

function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempRoots.push(dir);
	return dir;
}

after(() => {
	for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

/**
 * A retained artifact plus the manifest that describes it.
 *
 * The manifest is built from the fixture files with the repository's
 * own digest function, so the "match" case is a real match and a
 * mutation is a real difference. The version is a fixture version, never
 * a release (`version:check` forbids a release literal in a test
 * surface).
 */
function fixture({ files = { 'workers/default/bundle/worker.js': 'export default {};\n' } } = {}) {
	const artifactDir = tempDir('build-output-artifact-');
	const entries = Object.entries(files);
	for (const [path, content] of entries) {
		const absolute = join(artifactDir, path);
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, content);
	}
	const records = entries
		.map(([path, content]) => ({
			path,
			kind: 'file',
			bytes: Buffer.byteLength(content),
			sha256: sha256Bytes(Buffer.from(content)),
		}))
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	const manifest = {
		schema: 'my-web-2026/artifact-attestation/v1',
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
			digest: { algorithm: 'sha-256', value: digestFromFiles(records) },
			file_count: records.length,
			total_bytes: records.reduce((sum, file) => sum + file.bytes, 0),
			files: records,
		},
		coverage: { artifact_origin: 'github-actions-production-build-output' },
		signature: { status: 'unsigned', algorithm: null, key_id: null, value: null },
	};
	const manifestPath = join(tempDir('build-output-manifest-'), 'artifact-attestation.json');
	writeFileSync(manifestPath, JSON.stringify(manifest));
	return { artifactDir, manifestPath, manifest };
}

function run(args) {
	return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: 'utf8' });
}

describe('check-build-output-artifact', () => {
	it('passes when the downloaded bytes are the bytes the manifest records', () => {
		const { artifactDir, manifestPath } = fixture();
		const result = run(['--artifact-dir', artifactDir, '--manifest', manifestPath]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /BYTES {4}match/);
		assert.match(result.stdout, /SECRETS {2}clean/);
		assert.match(result.stdout, /PASS/);
	});

	it('fails when a file of the artifact differs from the recorded byte', () => {
		const { artifactDir, manifestPath } = fixture();
		// Same length, different content: the per-file digest moves.
		writeFileSync(join(artifactDir, 'workers/default/bundle/worker.js'), 'export default {}\n');
		const result = run(['--artifact-dir', artifactDir, '--manifest', manifestPath]);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /FILE_DIGEST_MISMATCH/);
		assert.match(result.stdout, /AGGREGATE_DIGEST_MISMATCH/);
		assert.match(result.stdout, /FAIL/);
	});

	it('fails when the artifact is missing a recorded file', () => {
		const { artifactDir, manifestPath } = fixture();
		rmSync(join(artifactDir, 'workers/default/bundle/worker.js'));
		const result = run(['--artifact-dir', artifactDir, '--manifest', manifestPath]);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /PATH_SET_MISMATCH/);
		assert.match(result.stdout, /missing: workers\/default\/bundle\/worker\.js/);
	});

	it('fails when the artifact holds a file the manifest never hashed', () => {
		const { artifactDir, manifestPath } = fixture();
		writeFileSync(join(artifactDir, 'workers/default/bundle/extra.js'), 'export default 1;\n');
		const result = run(['--artifact-dir', artifactDir, '--manifest', manifestPath]);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /PATH_SET_MISMATCH/);
		assert.match(result.stdout, /extra: workers\/default\/bundle\/extra\.js/);
	});

	it('fails when the recorded shape does not match the artifact', () => {
		const { artifactDir, manifestPath, manifest } = fixture();
		manifest.subject.file_count = 9;
		writeFileSync(manifestPath, JSON.stringify(manifest));
		const result = run(['--artifact-dir', artifactDir, '--manifest', manifestPath]);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /SHAPE_MISMATCH/);
	});

	it('fails on a symlink, because a link resolves bytes the manifest never hashed', () => {
		const { artifactDir, manifestPath } = fixture();
		symlinkSync(
			join(artifactDir, 'workers/default/bundle/worker.js'),
			join(artifactDir, 'link.js'),
		);
		const result = run(['--artifact-dir', artifactDir, '--manifest', manifestPath]);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /SYMLINK_PRESENT/);
	});

	it('fails when the retained artifact carries a secret shape, without printing it', () => {
		const secret = `mk_home_${'a'.repeat(32)}`;
		const { artifactDir, manifestPath } = fixture({
			files: { 'workers/default/bundle/worker.js': `const k = "${secret}";\n` },
		});
		const result = run(['--artifact-dir', artifactDir, '--manifest', manifestPath]);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /SECRET_SHAPE_DETECTED/);
		assert.match(result.stdout, /home-consumer-api-key/);
		assert.ok(!result.stdout.includes(secret), 'the finding must not carry the value');
	});

	it('exits 2 when the artifact directory is absent', () => {
		const { manifestPath } = fixture();
		const result = run([
			'--artifact-dir',
			join(tmpdir(), 'definitely-absent-artifact-dir'),
			'--manifest',
			manifestPath,
		]);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /ARTIFACT_UNREADABLE/);
	});

	it('exits 2 when the manifest is absent', () => {
		const { artifactDir } = fixture();
		const result = run([
			'--artifact-dir',
			artifactDir,
			'--manifest',
			join(artifactDir, 'nope.json'),
		]);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /MANIFEST_UNREADABLE/);
	});

	it('exits 2 when the manifest is not JSON', () => {
		const { artifactDir } = fixture();
		const manifestPath = join(tempDir('build-output-manifest-'), 'artifact-attestation.json');
		writeFileSync(manifestPath, 'not json');
		const result = run(['--artifact-dir', artifactDir, '--manifest', manifestPath]);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /MANIFEST_UNREADABLE/);
	});

	it('exits 2 when the manifest names no subject', () => {
		const { artifactDir } = fixture();
		const manifestPath = join(tempDir('build-output-manifest-'), 'artifact-attestation.json');
		writeFileSync(manifestPath, JSON.stringify({ project: { name: 'my-web-2026' } }));
		const result = run(['--artifact-dir', artifactDir, '--manifest', manifestPath]);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /MANIFEST_UNREADABLE/);
	});

	it('exits 2 on an unknown argument', () => {
		const result = run(['--nope']);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /unknown argument/);
	});
});
