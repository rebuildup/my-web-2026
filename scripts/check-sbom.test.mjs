import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AUDIT_ONLY_SECRETS, REQUIRED_RUNTIME_SECRETS } from './_cloudflare-contract.mjs';
import {
	CYCLONEDX_COMPONENT_PROPERTIES,
	SECRET_NAMES,
	SECRET_NAME_SOURCE,
	SECRET_VALUE_PATTERNS,
	canonicalComparable,
	checkSbom,
	checkSbomFile,
	componentSchemaFindings,
	findSecretLikeFindings,
	readInputs,
} from './check-sbom.mjs';
import { generateSbom, identityKey } from './generate-sbom.mjs';

const inputs = readInputs();

/**
 * One real document, generated once and cloned per assertion. Every
 * test mutates only its own clone, so a shared base keeps the suite
 * fast without letting one mutation leak into another.
 */
let cachedBase = null;
function baseBom() {
	cachedBase ??= structuredClone(generateSbom().bom);
	return cachedBase;
}

/** A fresh clone of the real document for one assertion to mutate. */
function realBom() {
	return structuredClone(baseBom());
}

/** Run the gate against a (possibly mutated) document. */
function check(bom) {
	return checkSbom({ bom, ...inputs });
}

describe('check-sbom — runtime secret names', () => {
	it('takes its names from the repository secret contract, not a local copy', () => {
		// The literal pins what this repository actually declares, so a
		// secret added to the contract cannot land unnoticed.
		assert.deepEqual(SECRET_NAMES, [
			'BETTER_AUTH_SECRETS',
			'MY_WEB_2026_CONSUMER_API_KEY',
			'GOOGLE_ANALYTICS_MEASUREMENT_ID',
			'BETTER_AUTH_SECRET',
		]);
		// The derivation proves the gate re-exports the contract module
		// rather than a mirrored copy that can drift.
		assert.deepEqual(SECRET_NAMES, [...REQUIRED_RUNTIME_SECRETS, ...AUDIT_ONLY_SECRETS]);
		assert.equal(SECRET_NAME_SOURCE, 'scripts/_cloudflare-contract.mjs');
	});

	it('flags every declared name by default, including the audit-only one', () => {
		for (const name of SECRET_NAMES) {
			const findings = findSecretLikeFindings(`{"env": "${name}"}`);
			assert.ok(findings.length >= 1, `expected a finding for ${name}`);
			assert.ok(
				findings.some((f) => f.kind === 'runtime-secret-name' && f.detail.includes(name)),
				`expected a named finding for ${name}`,
			);
		}
	});

	it('flags credential shapes', () => {
		const cases = [
			'-----BEGIN RSA PRIVATE KEY-----',
			'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
			'sk-abcdefghijklmnopqrstuvwxyz0123',
			'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r',
			'"api_key": "abcdefghijklmnopqrstuvwxyz"',
		];
		for (const sample of cases) {
			assert.ok(
				findSecretLikeFindings(sample).length > 0,
				`expected a finding for: ${sample.slice(0, 24)}`,
			);
		}
	});

	it('does not flag ordinary inventory content.', () => {
		const clean = JSON.stringify({
			name: 'hono',
			version: '4.13.7',
			hashes: [{ alg: 'SHA-512', content: 'a'.repeat(128) }],
			externalReferences: [{ type: 'distribution', url: 'https://registry.npmjs.org/hono' }],
		});
		assert.deepEqual(findSecretLikeFindings(clean), []);
	});

	it('exposes a non-empty pattern table', () => {
		assert.ok(SECRET_VALUE_PATTERNS.length >= 5);
	});
});

describe('check-sbom — the generated document passes', () => {
	it('accepts the real SBOM for this repository', () => {
		const result = check(realBom());
		assert.deepEqual(result.errors, []);
		assert.equal(result.ok, true);
	});

	it('accepts the real SBOM again when the license enrichment is absent', () => {
		// A generator run without `node_modules` (a bare clone) still has
		// to describe the same inventory; only the license evidence moves
		// from `declared` to `not-installed`.
		const { bom } = generateSbom({ withLicenses: false });
		assert.deepEqual(checkSbom({ bom, ...inputs }).errors, []);
	});

	it('ignores build identity when comparing two builds', () => {
		const a = realBom();
		const b = realBom();
		b.serialNumber = 'urn:uuid:00000000-0000-4000-8000-000000000000';
		b.metadata.timestamp = '1999-01-01T00:00:00.000Z';
		assert.equal(JSON.stringify(canonicalComparable(a)), JSON.stringify(canonicalComparable(b)));
		assert.notEqual(a.serialNumber, b.serialNumber);
	});

	it('describes every component with CycloneDX 1.6 properties only', () => {
		assert.deepEqual(componentSchemaFindings(realBom()), []);
	});
});

describe('check-sbom — CycloneDX conformance', () => {
	it('rejects a component carrying a property the 1.6 schema does not define', () => {
		// The exact defect the format rejects: `component.deprecated`
		// does not exist in 1.6 and `component` forbids additional
		// properties, so the whole document becomes invalid even though
		// every lockfile comparison still passes.
		const bom = realBom();
		bom.components[0].deprecated = 'use of this package is discouraged';
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(
			result.errors.some(
				(e) => e.startsWith('component-shape:') && e.includes('"deprecated" is not a CycloneDX'),
			),
			result.errors.join('\n'),
		);
	});

	it('rejects a component missing a required property', () => {
		const bom = realBom();
		bom.components[0].type = undefined;
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('required CycloneDX 1.6 property "type"')));
	});

	it('accepts every property name it declares as known', () => {
		assert.ok(CYCLONEDX_COMPONENT_PROPERTIES.includes('bom-ref'));
		assert.ok(CYCLONEDX_COMPONENT_PROPERTIES.includes('properties'));
		assert.equal(CYCLONEDX_COMPONENT_PROPERTIES.includes('deprecated'), false);
	});
});

describe('check-sbom — inventory drift is rejected', () => {
	it('rejects a component whose declared version no longer matches its purl', () => {
		const bom = realBom();
		bom.components.find((c) => c.purl.startsWith('pkg:npm/hono@')).version = '9.9.9';
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('purl disagrees with name/version')));
	});

	it('rejects a component whose purl version is not the locked version', () => {
		const bom = realBom();
		const target = bom.components.find((c) => c.purl.startsWith('pkg:npm/hono@'));
		target.version = '9.9.9';
		target['bom-ref'] = target.purl = 'pkg:npm/hono@9.9.9';
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(
			result.errors.some((e) => e.startsWith('hono@9.9.9: present in the SBOM but absent')),
		);
		assert.ok(
			result.errors.some((e) =>
				e.startsWith('hono@4.13.7: resolved by pnpm-lock.yaml but missing'),
			),
		);
	});

	it('rejects a removed component', () => {
		const bom = realBom();
		bom.components = bom.components.filter((c) => c.purl !== 'pkg:npm/hono@4.13.7');
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.startsWith('hono@4.13.7: resolved by pnpm-lock.yaml')));
	});

	it('rejects an invented component', () => {
		const bom = realBom();
		bom.components.push({
			'bom-ref': 'pkg:npm/left-pad@1.3.0',
			type: 'library',
			name: 'left-pad',
			version: '1.3.0',
			purl: 'pkg:npm/left-pad@1.3.0',
			licenses: [{ license: { name: 'MIT' } }],
			properties: [],
		});
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(
			result.errors.some((e) => e.startsWith('left-pad@1.3.0: present in the SBOM but absent')),
		);
	});

	it('rejects a tampered integrity digest', () => {
		const bom = realBom();
		const target = bom.components.find((c) => c.name === 'hono');
		target.hashes[0].content = 'f'.repeat(128);
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.startsWith('hono@4.13.7: SHA-512 does not match')));
	});

	it('rejects a dropped integrity digest', () => {
		const bom = realBom();
		bom.components.find((c) => c.name === 'hono').hashes = undefined;
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('SHA-512 does not match')));
	});

	it('rejects a duplicated component', () => {
		const bom = realBom();
		const target = bom.components.find((c) => c.name === 'hono');
		bom.components.push(structuredClone(target));
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('duplicate component')));
	});

	it('rejects a purl that disagrees with the declared name/version', () => {
		const bom = realBom();
		bom.components.find((c) => c.name === 'hono').purl = 'pkg:npm/hono@9.9.9';
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('purl disagrees with name/version')));
	});

	it('rejects a bom-ref that is not the purl', () => {
		const bom = realBom();
		bom.components.find((c) => c.name === 'hono')['bom-ref'] = 'hono';
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('bom-ref must equal purl')));
	});

	it('rejects a dangling dependency edge', () => {
		const bom = realBom();
		bom.dependencies[0].dependsOn.push('pkg:npm/does-not-exist@1.0.0');
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('dependsOn points at an unknown component')));
	});

	it('rejects a document whose root version drifts from package.json', () => {
		const bom = realBom();
		bom.metadata.component.version = '9.9.9';
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.startsWith('metadata.component.version')));
	});

	it('rejects a wrong format or serial number', () => {
		const bom = realBom();
		bom.bomFormat = 'SPDX';
		bom.serialNumber = 'not-a-uuid';
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.startsWith('bomFormat')));
		assert.ok(result.errors.some((e) => e.startsWith('serialNumber')));
	});
});

describe('check-sbom — Tool Registry drift is rejected', () => {
	it('rejects a Tool whose pinned SHA was edited', () => {
		const bom = realBom();
		const tool = bom.components.find((c) => c.name === 'readmark');
		tool.version = 'f'.repeat(40);
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('pinned SHA mismatch')));
	});

	it('rejects a removed Tool', () => {
		const bom = realBom();
		bom.components = bom.components.filter((c) => c.name !== 'readmark');
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(
			result.errors.some((e) =>
				e.startsWith('tool "readmark": declared in src/tools/manifest.json but missing'),
			),
		);
	});

	it('rejects a Tool whose license was rewritten', () => {
		const bom = realBom();
		bom.components.find((c) => c.name === 'readmark').licenses = [
			{ license: { name: 'Apache-2.0' } },
		];
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('license mismatch')));
	});
});

describe('check-sbom — secret content is rejected', () => {
	it('rejects a document that names a runtime secret', () => {
		const bom = realBom();
		bom.components[0].externalReferences.push({
			type: 'other',
			url: 'https://example.invalid/BETTER_AUTH_SECRETS',
		});
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.startsWith('runtime-secret-name')));
	});

	it('rejects a document that carries credential-shaped content', () => {
		const bom = realBom();
		bom.components[0].properties.push({
			name: 'my-web-2026:note',
			value: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
		});
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.startsWith('secret-value-shape')));
	});

	it('rejects a document with no input provenance', () => {
		const bom = realBom();
		bom.metadata.properties = bom.metadata.properties.filter(
			(p) => p.name !== 'my-web-2026:source-digests',
		);
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(result.errors.some((e) => e.includes('missing input digest')));
	});

	it('rejects a hand-written provenance record whose digest is stale', () => {
		const bom = realBom();
		bom.metadata.properties = bom.metadata.properties.map((p) =>
			p.name === 'my-web-2026:source-digests'
				? { ...p, value: p.value.replace(/sha256:[0-9a-f]{64}/, `sha256:${'f'.repeat(64)}`) }
				: p,
		);
		const result = check(bom);
		assert.equal(result.ok, false);
		assert.ok(
			result.errors.some((e) =>
				e.includes('recorded digest for pnpm-lock.yaml does not match the file on disk'),
			),
			result.errors.join('\n'),
		);
	});
});

describe('check-sbom — on-disk documents', () => {
	it('reports a missing file rather than throwing', () => {
		const result = checkSbomFile({ bomPath: 'release-assets/supply-chain/9.9.9/sbom.cdx.json' });
		assert.equal(result.ok, false);
		assert.match(result.errors[0], /not found/);
	});

	it('reports invalid JSON rather than throwing', () => {
		const root = mkdtempSync(join(tmpdir(), 'check-sbom-'));
		try {
			writeFileSync(join(root, 'broken.json'), '{ not json');
			const result = checkSbomFile({ root, bomPath: 'broken.json' });
			assert.equal(result.ok, false);
			assert.match(result.errors[0], /not valid JSON/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('accepts a byte-identical staged artifact written from a fresh build', () => {
		const root = mkdtempSync(join(tmpdir(), 'check-sbom-'));
		try {
			const { bom } = generateSbom();
			writeFileSync(join(root, 'sbom.json'), `${JSON.stringify(bom, null, 2)}\n`);
			const result = checkSbomFile({ root, bomPath: 'sbom.json' });
			assert.deepEqual(result.errors, []);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('check-sbom — identity helpers', () => {
	it('keeps the lockfile identity helper aligned with the generator', () => {
		assert.equal(identityKey('hono', '4.13.7'), 'hono@4.13.7');
	});
});
