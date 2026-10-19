/**
 * Artifact attestation tests (Issue #476).
 *
 * The gate's value comes from failing on the right inputs, so every
 * abnormal case here is a real mutation of the artifact / source /
 * dependency facts — not a mocked verdict.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
	AttestationError,
	SCHEMA,
	artifactDigest,
	buildManifest,
	readDependencyFacts,
	serializeManifest,
	sha256Text,
	verifyManifest,
} from './_artifact-attestation.mjs';

const SOURCE = '0123456789abcdef0123456789abcdef01234567';
const OTHER_SOURCE = 'fedcba9876543210fedcba9876543210fedcba98';

const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      left-pad:
        specifier: ^1.3.0
        version: 1.3.0
    packageManagerDependencies:
      pnpm:
        version: 12.3.4

packages:

  left-pad@1.3.0: {}

snapshots:

  left-pad@1.3.0: {}
`;

function makeRoot() {
	const root = mkdtempSync(join(tmpdir(), 'artifact-attestation-'));
	writeFileSync(
		join(root, 'package.json'),
		`${JSON.stringify(
			{
				name: 'fixture-app',
				version: '1.2.3',
				packageManager: 'pnpm@12.3.4',
				dependencies: { 'left-pad': '^1.3.0' },
				devDependencies: {},
			},
			null,
			2,
		)}\n`,
	);
	writeFileSync(join(root, 'pnpm-lock.yaml'), LOCKFILE);
	return root;
}

function makeArtifact(root) {
	const dir = join(root, 'build-output');
	mkdirSync(join(dir, 'workers', 'default', 'bundle'), { recursive: true });
	mkdirSync(join(dir, 'workers', 'default', 'assets', 'app'), { recursive: true });
	writeFileSync(
		join(dir, 'config.json'),
		'{"accountId":"fixture","buildContext":{"mode":"production"}}\n',
	);
	writeFileSync(join(dir, 'workers', 'default', 'worker.config.json'), '{"name":"my-web-2026"}\n');
	writeFileSync(join(dir, 'workers', 'default', 'bundle', 'worker.js'), 'export default {};\n');
	writeFileSync(join(dir, 'workers', 'default', 'assets', 'app', 'index.js'), 'console.log(1);\n');
	return dir;
}

function setup() {
	const root = makeRoot();
	const artifactDir = makeArtifact(root);
	const manifest = buildManifest({
		artifactDir,
		root,
		sourceCommit: SOURCE,
		sourceBranch: 'release-fixture',
		treeState: 'clean',
	});
	return { root, artifactDir, manifest };
}

function codes(result) {
	return result.findings.map((item) => item.code);
}

describe('artifact digest', () => {
	it('is deterministic and changes when a byte changes', (t) => {
		const root = makeRoot();
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const dir = makeArtifact(root);

		const first = artifactDigest({ dir });
		const second = artifactDigest({ dir });
		assert.equal(first.digest, second.digest);
		assert.equal(first.file_count, 4);
		assert.ok(first.files.some((file) => file.path === 'workers/default/bundle/worker.js'));

		writeFileSync(join(dir, 'workers', 'default', 'bundle', 'worker.js'), 'export default 2;\n');
		const tampered = artifactDigest({ dir });
		assert.notEqual(tampered.digest, first.digest);
		assert.equal(tampered.file_count, first.file_count);
	});

	it('refuses a missing artifact directory', (t) => {
		const root = makeRoot();
		t.after(() => rmSync(root, { recursive: true, force: true }));
		assert.throws(() => artifactDigest({ dir: join(root, 'absent') }), AttestationError);
	});
});

describe('manifest generation', () => {
	it('records source, dependency facts, an unsigned signature and no invented ids', (t) => {
		const { root, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));

		assert.equal(manifest.schema, SCHEMA);
		assert.equal(manifest.source.commit, SOURCE);
		assert.equal(manifest.source.tree, 'clean');
		assert.equal(manifest.project.version, '1.2.3');
		assert.equal(manifest.dependencies.package_manager, 'pnpm@12.3.4');
		assert.equal(manifest.dependencies.lockfile.packages, 1);
		assert.equal(manifest.dependencies.declared.dependencies['left-pad'], '^1.3.0');
		assert.equal(manifest.cloudflare.worker, 'my-web-2026');
		assert.equal(manifest.cloudflare.build_uuid, null);
		assert.equal(manifest.cloudflare.deploy_id, null);
		assert.deepEqual(manifest.signature, {
			status: 'unsigned',
			algorithm: null,
			key_id: null,
			value: null,
		});
	});

	it('serializes deterministically', (t) => {
		const { root, artifactDir, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const again = buildManifest({
			artifactDir,
			root,
			sourceCommit: SOURCE,
			sourceBranch: 'release-fixture',
		});
		assert.equal(serializeManifest(manifest), serializeManifest(again));
	});

	it('rejects a non-commit source and an empty artifact', (t) => {
		const root = makeRoot();
		const empty = join(root, 'empty');
		mkdirSync(empty, { recursive: true });
		t.after(() => rmSync(root, { recursive: true, force: true }));

		assert.throws(
			() => buildManifest({ artifactDir: empty, root, sourceCommit: 'HEAD' }),
			AttestationError,
		);

		const manifest = buildManifest({ artifactDir: empty, root, sourceCommit: SOURCE });
		const result = verifyManifest({
			manifest,
			artifactDir: empty,
			root,
			expectedSourceCommit: SOURCE,
		});
		assert.equal(result.status, 'FAIL');
		assert.ok(codes(result).includes('ARTIFACT_EMPTY'));
	});

	it('preserves a supplied deploy id and build uuid verbatim', (t) => {
		const { root, artifactDir } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const manifest = buildManifest({
			artifactDir,
			root,
			sourceCommit: SOURCE,
			buildUuid: 'fixture-build-uuid',
			deployId: 'fixture-deploy-id',
		});
		assert.equal(manifest.cloudflare.build_uuid, 'fixture-build-uuid');
		assert.equal(manifest.cloudflare.deploy_id, 'fixture-deploy-id');
	});
});

describe('manifest verification', () => {
	it('passes when artifact, source, lockfile and version agree', (t) => {
		const { root, artifactDir, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));

		const result = verifyManifest({
			manifest,
			artifactDir,
			root,
			expectedSourceCommit: SOURCE,
		});
		assert.equal(result.status, 'PASS');
		assert.equal(result.findings.length, 0);
		assert.ok(result.checks.some((check) => check.id === 'Lockfile digest'));
		assert.ok(
			result.checks.some(
				(check) => check.id === 'Signature' && check.detail === 'unsigned (no signature claimed)',
			),
		);
	});

	it('fails when the artifact bytes drift', (t) => {
		const { root, artifactDir, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));

		writeFileSync(join(artifactDir, 'workers', 'default', 'bundle', 'worker.js'), 'tampered\n');
		const result = verifyManifest({
			manifest,
			artifactDir,
			root,
			expectedSourceCommit: SOURCE,
		});
		assert.equal(result.status, 'FAIL');
		assert.ok(codes(result).includes('ARTIFACT_DIGEST_MISMATCH'));
	});

	it('fails when the expected source commit differs', (t) => {
		const { root, artifactDir, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));

		const result = verifyManifest({
			manifest,
			artifactDir,
			root,
			expectedSourceCommit: OTHER_SOURCE,
		});
		assert.equal(result.status, 'FAIL');
		assert.ok(codes(result).includes('SOURCE_COMMIT_MISMATCH'));
	});

	it('fails when the lockfile digest or inventory changes', (t) => {
		const { root, artifactDir, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));

		writeFileSync(
			join(root, 'pnpm-lock.yaml'),
			LOCKFILE.replace('left-pad@1.3.0: {}', 'left-pad@1.3.0: {}\n  right-pad@1.0.0: {}'),
		);
		const result = verifyManifest({
			manifest,
			artifactDir,
			root,
			expectedSourceCommit: SOURCE,
		});
		assert.equal(result.status, 'FAIL');
		assert.ok(codes(result).includes('LOCKFILE_DIGEST_MISMATCH'));
	});

	it('fails when a declared dependency range changes', (t) => {
		const { root, artifactDir, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));

		const pkg = JSON.parse(JSON.stringify(manifest.dependencies.declared));
		pkg.dependencies['left-pad'] = '^2.0.0';
		manifest.dependencies.declared = pkg;
		// The manifest is self-consistent but no longer describes the tree.
		const result = verifyManifest({
			manifest,
			artifactDir,
			root,
			expectedSourceCommit: SOURCE,
		});
		assert.equal(result.status, 'FAIL');
		assert.ok(codes(result).includes('DECLARED_DEPENDENCIES_MISMATCH'));
	});

	it('fails when the manifest file list was edited without regenerating', (t) => {
		const { root, artifactDir, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));

		manifest.subject.files[0].bytes += 1;
		const result = verifyManifest({
			manifest,
			artifactDir,
			root,
			expectedSourceCommit: SOURCE,
		});
		assert.equal(result.status, 'FAIL');
		assert.ok(codes(result).includes('MANIFEST_FILE_DIGEST_MISMATCH'));
	});

	it('fails when a dirty tree is attested as clean', (t) => {
		const { root, artifactDir, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));

		manifest.source.tree = 'dirty';
		const result = verifyManifest({
			manifest,
			artifactDir,
			root,
			expectedSourceCommit: SOURCE,
		});
		assert.equal(result.status, 'FAIL');
		assert.ok(codes(result).includes('SOURCE_TREE_DIRTY'));
	});

	it('fails closed on a signature it cannot verify, or an unsigned document with signature fields', (t) => {
		const { root, artifactDir, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));

		const claimed = structuredClone(manifest);
		claimed.signature = { status: 'signed', algorithm: 'ed25519', key_id: 'k', value: 'abc' };
		const claimedResult = verifyManifest({
			manifest: claimed,
			artifactDir,
			root,
			expectedSourceCommit: SOURCE,
		});
		assert.equal(claimedResult.status, 'FAIL');
		assert.ok(codes(claimedResult).includes('SIGNATURE_UNSUPPORTED'));

		const inconsistent = structuredClone(manifest);
		inconsistent.signature.value = 'deadbeef';
		const inconsistentResult = verifyManifest({
			manifest: inconsistent,
			artifactDir,
			root,
			expectedSourceCommit: SOURCE,
		});
		assert.equal(inconsistentResult.status, 'FAIL');
		assert.ok(codes(inconsistentResult).includes('SIGNATURE_INCONSISTENT'));
	});

	it('rejects an unsupported schema and a non-object manifest', (t) => {
		const { root, artifactDir, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));

		manifest.schema = 'some-other/v0';
		const result = verifyManifest({
			manifest,
			artifactDir,
			root,
			expectedSourceCommit: SOURCE,
		});
		assert.equal(result.status, 'FAIL');
		assert.ok(codes(result).includes('SCHEMA_UNSUPPORTED'));

		const unreadable = verifyManifest({
			manifest: null,
			artifactDir,
			root,
			expectedSourceCommit: SOURCE,
		});
		assert.equal(unreadable.status, 'FAIL');
		assert.ok(codes(unreadable).includes('MANIFEST_UNREADABLE'));
	});

	it('requires an explicit expected commit', (t) => {
		const { root, artifactDir, manifest } = setup();
		t.after(() => rmSync(root, { recursive: true, force: true }));
		assert.throws(() => verifyManifest({ manifest, artifactDir, root }), AttestationError);
	});
});

describe('dependency facts', () => {
	it('reads the declared ranges, lock digest and resolved package count', (t) => {
		const root = makeRoot();
		t.after(() => rmSync(root, { recursive: true, force: true }));

		const facts = readDependencyFacts({ root });
		assert.equal(facts.project.name, 'fixture-app');
		assert.equal(facts.project.version, '1.2.3');
		assert.equal(facts.package_manager, 'pnpm@12.3.4');
		assert.equal(facts.lockfile.path, 'pnpm-lock.yaml');
		assert.equal(facts.lockfile.sha256, sha256Text(LOCKFILE));
		assert.equal(facts.lockfile.packages, 1);
		assert.deepEqual(facts.declared.devDependencies, {});
	});
});
