import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	SBOM_SOURCE_FILES,
	SPEC_VERSION,
	UnsupportedYamlError,
	buildSbom,
	collectDirectDependencies,
	collectLockEdges,
	collectLockPackages,
	generateSbom,
	identityKey,
	integrityToCycloneDxHash,
	licenseChoices,
	npmDistributionUrl,
	packageIdentityFromLockKey,
	parseYamlDocuments,
	resolveTimestamp,
	sbomDirFor,
	serializeSbom,
	sha256Hex,
} from './generate-sbom.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(repoRoot, 'scripts/generate-sbom.mjs');

/** Run the generator CLI exactly as `pnpm run sbom:build` would. */
function runCli(args) {
	return execFileSync(process.execPath, [cli, ...args], {
		cwd: repoRoot,
		encoding: 'utf8',
		// `--stdout` emits the whole document, which is around a
		// megabyte for this repository — well past the 1 MB default.
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, SOURCE_DATE_EPOCH: '1767225600' },
	});
}

/**
 * A syntactically valid `sha512-<base64>` integrity for a synthetic
 * 64-byte tarball. Built rather than pasted so a transcription slip
 * cannot silently produce a 61-byte "sha512" that the generator
 * correctly refuses to publish.
 */
function fixtureIntegrity(byte) {
	return `sha512-${Buffer.from(String(byte).repeat(64), 'utf8').toString('base64')}`;
}

const INTEGRITY_A = fixtureIntegrity('a');
const INTEGRITY_B = fixtureIntegrity('b');
const INTEGRITY_C = fixtureIntegrity('c');

/**
 * Fixture lockfiles deliberately use a non-existent package name and
 * non-release version literals so they can never be confused with the
 * real inventory (and so scripts/check-release-version.mjs does not
 * read them as a release claim).
 */
const FIXTURE_LOCKFILE = `---
lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      left-pad:
        specifier: ^9.9.9
        version: 9.9.9

packages:

  '@scope/with-peer@9.9.9':
    resolution: {integrity: ${INTEGRITY_A}}
    peerDependencies:
      '@scope/other': 9.9.9
    engines: {node: '>=20'}

  '@scope/other@9.9.9':
    resolution: {integrity: ${INTEGRITY_B}}

  left-pad@9.9.9:
    resolution: {integrity: ${INTEGRITY_C}}
    deprecated: this fixture is synthetic

snapshots:

  '@scope/with-peer@9.9.9(@scope/other@9.9.9)':
    dependencies:
      '@scope/other': 9.9.9

  '@scope/other@9.9.9': {}

  left-pad@9.9.9:
    optionalDependencies:
      '@scope/other': 9.9.9
    transitivePeerDependencies:
      - '@scope/other'
`;

const FIXTURE_PACKAGE_JSON = { name: 'my-web-2026', version: '9.9.9', license: 'MIT' };

const FIXTURE_WORKSPACE = `patchedDependencies:
  left-pad@9.9.9: patches/left-pad@9.9.9.patch
`;

const FIXTURE_TOOLS = JSON.stringify({
	version: 1,
	tools: [
		{
			slug: 'fixture-tool',
			source: {
				canonical_repo: 'https://github.com/example/fixture-tool.git',
				submodule_path: 'external/fixture-tool',
				pinned_sha: '0123456789abcdef0123456789abcdef01234567',
				branch: 'main',
			},
			build: { command: 'pnpm run build', output_dir: 'dist', package_manager: 'pnpm' },
			delivery: { kind: 'host_disabled', disabled_reason: 'fixture' },
			classification: 'needs_tool_side_fix',
			license: 'MIT',
		},
	],
});

function fixtureBom(overrides = {}) {
	return buildSbom({
		packageJson: FIXTURE_PACKAGE_JSON,
		lockfileText: FIXTURE_LOCKFILE,
		workspaceText: FIXTURE_WORKSPACE,
		toolsManifestText: FIXTURE_TOOLS,
		licenseIndex: new Map([['left-pad@9.9.9', 'MIT']]),
		timestamp: '2026-01-01T00:00:00.000Z',
		...overrides,
	});
}

describe('generate-sbom — YAML subset parser', () => {
	it('parses block mappings, flow mappings and quoted keys', () => {
		const [doc] = parseYamlDocuments(FIXTURE_LOCKFILE);
		assert.equal(doc.lockfileVersion, '9.0');
		assert.equal(doc.importers['.'].dependencies['left-pad'].version, '9.9.9');
		assert.equal(doc.packages['@scope/with-peer@9.9.9'].resolution.integrity, INTEGRITY_A);
	});

	it('parses multi-document text as separate documents', () => {
		const docs = parseYamlDocuments('---\na: 1\n\n---\nb: 2\nc: [x, y]\n');
		assert.equal(docs.length, 2);
		assert.equal(docs[0].a, '1');
		assert.deepEqual(docs[1].c, ['x', 'y']);
	});

	it('fails closed on YAML anchors instead of silently dropping them', () => {
		assert.throws(
			() => parseYamlDocuments('packages:\n  a@1.0.0: &anchor\n    resolution: {}\n'),
			UnsupportedYamlError,
		);
	});

	it('fails closed on block scalars', () => {
		assert.throws(
			() => parseYamlDocuments('packages:\n  a@1.0.0:\n    description: |\n      text\n'),
			UnsupportedYamlError,
		);
	});

	it('fails closed on a sequence-of-mapping entry', () => {
		assert.throws(
			() => parseYamlDocuments('snapshots:\n  a@1.0.0:\n    - name: x\n'),
			UnsupportedYamlError,
		);
	});

	it('parses the real pnpm-lock.yaml without unsupported constructs', () => {
		const lockfileText = readFileSync(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8');
		const documents = parseYamlDocuments(lockfileText);
		assert.ok(documents.length >= 1);
		assert.equal(documents[0].lockfileVersion, '9.0');
	});
});

describe('generate-sbom — lockfile identity', () => {
	it('splits scoped and peer-suffixed keys', () => {
		assert.deepEqual(packageIdentityFromLockKey('@babel/core@7.29.7'), {
			name: '@babel/core',
			version: '7.29.7',
			peerSuffix: '',
		});
		assert.deepEqual(packageIdentityFromLockKey("'@babel/core@7.29.7(supports-color@10.2.2)'"), {
			name: '@babel/core',
			version: '7.29.7',
			peerSuffix: '(supports-color@10.2.2)',
		});
		assert.deepEqual(packageIdentityFromLockKey('hono@4.13.7'), {
			name: 'hono',
			version: '4.13.7',
			peerSuffix: '',
		});
	});

	it('rejects a key with no version', () => {
		assert.throws(() => packageIdentityFromLockKey('nameless'), UnsupportedYamlError);
	});

	it('deduplicates peer resolutions into one name@version record', () => {
		const lockfileText = `${FIXTURE_LOCKFILE}`;
		const packages = collectLockPackages(parseYamlDocuments(lockfileText));
		assert.deepEqual([...packages.keys()].sort(), [
			'@scope/other@9.9.9',
			'@scope/with-peer@9.9.9',
			'left-pad@9.9.9',
		]);
	});

	it('collects dependency edges without peer suffixes', () => {
		const edges = collectLockEdges(parseYamlDocuments(FIXTURE_LOCKFILE));
		assert.deepEqual(edges.get('@scope/with-peer@9.9.9'), ['@scope/other@9.9.9']);
		assert.deepEqual(edges.get('left-pad@9.9.9'), ['@scope/other@9.9.9']);
	});

	it('collects the direct dependency set', () => {
		const direct = collectDirectDependencies(parseYamlDocuments(FIXTURE_LOCKFILE));
		assert.deepEqual([...direct.keys()], ['left-pad@9.9.9']);
	});

	it('converts base64 sha512 integrity into CycloneDX hex', () => {
		const hash = integrityToCycloneDxHash(INTEGRITY_A);
		assert.equal(hash.alg, 'SHA-512');
		assert.equal(hash.content.length, 128);
		assert.match(hash.content, /^[0-9a-f]{128}$/);
	});

	it('returns null for an absent or non-sha512 integrity instead of guessing', () => {
		assert.equal(integrityToCycloneDxHash(undefined), null);
		assert.equal(integrityToCycloneDxHash('sha1-abc'), null);
	});

	it('builds the registry tarball URL for scoped and unscoped packages', () => {
		assert.equal(
			npmDistributionUrl('@scope/name', '1.2.3'),
			'https://registry.npmjs.org/@scope/name/-/name-1.2.3.tgz',
		);
		assert.equal(
			npmDistributionUrl('hono', '4.13.7'),
			'https://registry.npmjs.org/hono/-/hono-4.13.7.tgz',
		);
	});
});

describe('generate-sbom — license honesty', () => {
	it('reports NOASSERTION when nothing was read', () => {
		assert.deepEqual(licenseChoices(null), [{ license: { name: 'NOASSERTION' } }]);
		assert.deepEqual(licenseChoices('   '), [{ license: { name: 'NOASSERTION' } }]);
	});

	it('carries the verbatim upstream string rather than a guessed SPDX id', () => {
		assert.deepEqual(licenseChoices('MIT'), [{ license: { name: 'MIT' } }]);
		assert.deepEqual(licenseChoices('Apache-2.0 OR MIT'), [
			{ license: { name: 'Apache-2.0 OR MIT' } },
		]);
	});

	it('distinguishes "not installed here" from "upstream declares none"', () => {
		const bom = fixtureBom();
		const leftPad = bom.components.find((c) => c.name === 'left-pad');
		const resolution = (name) => leftPad.properties.find((p) => p.name === name)?.value;
		assert.equal(resolution('my-web-2026:license-resolution'), 'declared');
		assert.deepEqual(leftPad.licenses, [{ license: { name: 'MIT' } }]);

		const notInstalled = bom.components.find((c) => c.name === '@scope/other');
		assert.equal(
			notInstalled.properties.find((p) => p.name === 'my-web-2026:license-resolution').value,
			'not-installed',
		);
		assert.deepEqual(notInstalled.licenses, [{ license: { name: 'NOASSERTION' } }]);
	});
});

describe('generate-sbom — document shape', () => {
	it('emits CycloneDX 1.6 with a root component and both inventories', () => {
		const bom = fixtureBom();
		assert.equal(bom.bomFormat, 'CycloneDX');
		assert.equal(bom.specVersion, '1.6');
		assert.match(bom.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
		assert.equal(bom.metadata.component.name, 'my-web-2026');
		assert.equal(bom.metadata.component.version, '9.9.9');
		const names = bom.components.map((c) => c.name).sort();
		assert.deepEqual(names, ['@scope/other', '@scope/with-peer', 'fixture-tool', 'left-pad']);
	});

	it('uses the purl as the bom-ref and keeps the digest', () => {
		const bom = fixtureBom();
		const leftPad = bom.components.find((c) => c.name === 'left-pad');
		assert.equal(leftPad['bom-ref'], 'pkg:npm/left-pad@9.9.9');
		assert.equal(leftPad.hashes[0].alg, 'SHA-512');
		assert.equal(leftPad.deprecated, 'this fixture is synthetic');
		assert.equal(leftPad.externalReferences[0].url, npmDistributionUrl('left-pad', '9.9.9'));
	});

	it('marks patched dependencies declared in pnpm-workspace.yaml', () => {
		const bom = fixtureBom();
		const leftPad = bom.components.find((c) => c.name === 'left-pad');
		assert.ok(
			leftPad.properties.some((p) => p.name === 'my-web-2026:patched' && p.value === 'true'),
		);
	});

	it('represents Tool Registry artifacts as pinned-SHA components', () => {
		const bom = fixtureBom();
		const tool = bom.components.find((c) => c.name === 'fixture-tool');
		assert.equal(tool.type, 'application');
		assert.equal(tool.version, '0123456789abcdef0123456789abcdef01234567');
		assert.equal(tool.externalReferences[0].type, 'vcs');
		assert.deepEqual(tool.licenses, [{ license: { name: 'MIT' } }]);
	});

	it('emits a resolvable dependency graph rooted at the application', () => {
		const bom = fixtureBom();
		const refs = new Set(bom.components.map((c) => c['bom-ref']));
		for (const entry of bom.dependencies) {
			assert.ok(
				entry.ref === bom.metadata.component['bom-ref'] || refs.has(entry.ref),
				`dangling ref ${entry.ref}`,
			);
			for (const target of entry.dependsOn) assert.ok(refs.has(target), `dangling ${target}`);
		}
		const root = bom.dependencies.find((d) => d.ref === bom.metadata.component['bom-ref']);
		assert.ok(root.dependsOn.includes('pkg:npm/left-pad@9.9.9'));
		assert.ok(
			root.dependsOn.includes(
				'pkg:generic/my-web-2026-tool/fixture-tool@0123456789abcdef0123456789abcdef01234567',
			),
		);
	});

	it('records a sha256 digest for every tracked input', () => {
		const bom = fixtureBom();
		const provenance = bom.metadata.properties.find(
			(p) => p.name === 'my-web-2026:source-digests',
		).value;
		assert.ok(provenance.includes(`pnpm-lock.yaml=sha256:${sha256Hex(FIXTURE_LOCKFILE)}`));
		assert.ok(provenance.includes(`src/tools/manifest.json=sha256:${sha256Hex(FIXTURE_TOOLS)}`));
	});

	it('is byte-reproducible for a fixed timestamp and differs only in identity otherwise', () => {
		const first = fixtureBom();
		const second = fixtureBom();
		assert.equal(serializeSbom(first), serializeSbom(second));
		// Different input, same timestamp -> different serial number.
		const other = fixtureBom({ workspaceText: 'patchedDependencies: {}\n' });
		assert.notEqual(other.serialNumber, first.serialNumber);
		assert.equal(other.metadata.timestamp, first.metadata.timestamp);
	});
});

describe('generate-sbom — SOURCE_DATE_EPOCH', () => {
	it('derives the timestamp from SOURCE_DATE_EPOCH', () => {
		assert.equal(resolveTimestamp({ SOURCE_DATE_EPOCH: '0' }), '1970-01-01T00:00:00.000Z');
		assert.equal(resolveTimestamp({ SOURCE_DATE_EPOCH: '1767225600' }), '2026-01-01T00:00:00.000Z');
	});

	it('leaves the timestamp unset when SOURCE_DATE_EPOCH is absent', () => {
		assert.equal(resolveTimestamp({}), undefined);
		assert.equal(resolveTimestamp({ SOURCE_DATE_EPOCH: '' }), undefined);
	});

	it('rejects a non-numeric SOURCE_DATE_EPOCH rather than defaulting', () => {
		assert.throws(() => resolveTimestamp({ SOURCE_DATE_EPOCH: 'yesterday' }), /non-negative/);
	});
});

describe('generate-sbom — real repository inputs', () => {
	it('generates an inventory that covers every resolved package', () => {
		const { bom, version } = generateSbom();
		assert.equal(
			version,
			JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version,
		);
		const packages = collectLockPackages(
			parseYamlDocuments(readFileSync(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8')),
		);
		const declared = bom.components
			.filter((c) => c.purl.startsWith('pkg:npm/'))
			.map((c) => identityKey(c.name, c.version));
		assert.deepEqual(declared.sort(), [...packages.keys()].sort());
		assert.ok(bom.components.some((c) => c.purl.startsWith('pkg:generic/my-web-2026-tool/')));
	});

	it('reads only the declared tracked source files', () => {
		for (const file of SBOM_SOURCE_FILES) {
			assert.doesNotThrow(() => readFileSync(resolve(repoRoot, file), 'utf8'));
		}
		assert.deepEqual([...SBOM_SOURCE_FILES].sort(), [
			'package.json',
			'pnpm-lock.yaml',
			'pnpm-workspace.yaml',
			'src/tools/manifest.json',
		]);
	});

	it('derives the release artifact directory from the version', () => {
		assert.equal(sbomDirFor('9.9.9'), 'release-assets/supply-chain/9.9.9');
	});
});

describe('generate-sbom — CLI contract', () => {
	it('writes a parseable document to an explicit --out path', () => {
		const dir = mkdtempSync(join(tmpdir(), 'generate-sbom-cli-'));
		try {
			const relative = join(dir, 'nested', 'sbom.json');
			const stdout = runCli([`--out=${relative}`]);
			assert.match(stdout, /^\[generate-sbom\] OK: \d+ components \(\d+ npm, \d+ tools\) -> /);
			const bom = JSON.parse(readFileSync(relative, 'utf8'));
			assert.equal(bom.specVersion, SPEC_VERSION);
			assert.equal(bom.metadata.timestamp, '2026-01-01T00:00:00.000Z');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('prints the document on stdout for --stdout', () => {
		const bom = JSON.parse(runCli(['--stdout']));
		assert.equal(bom.bomFormat, 'CycloneDX');
	});

	it('is byte-reproducible under a pinned SOURCE_DATE_EPOCH', () => {
		const dir = mkdtempSync(join(tmpdir(), 'generate-sbom-cli-'));
		try {
			const first = join(dir, 'a.json');
			const second = join(dir, 'b.json');
			runCli([`--out=${first}`]);
			runCli([`--out=${second}`]);
			assert.equal(readFileSync(first, 'utf8'), readFileSync(second, 'utf8'));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('rejects --out together with --stdout rather than guessing', () => {
		assert.throws(() => runCli(['--out=/tmp/ignored.json', '--stdout']), /mutually exclusive/);
	});
});
