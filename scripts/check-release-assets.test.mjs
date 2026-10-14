import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
	checkReleaseAssets,
	manifestRelativePathFor,
	releaseVersionFromPackageJson,
	remedyText,
	versionDirFor,
} from './check-release-assets.mjs';

// Fixture versions deliberately avoid the `0.x.y` release-literal shape
// so scripts/check-release-version.mjs never flags this file.
const FIXTURE_VERSION = '9.9.9';

function stageFixture({ assets = ['img/cover.jpg'] } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'check-release-assets-'));
	const dir = join(root, versionDirFor(FIXTURE_VERSION));
	mkdirSync(dir, { recursive: true });
	for (const rel of assets) {
		const full = join(dir, rel);
		mkdirSync(join(full, '..'), { recursive: true });
		writeFileSync(full, 'bytes');
	}
	writeFileSync(
		join(dir, 'manifest.json'),
		JSON.stringify({
			release: FIXTURE_VERSION,
			assets: assets.map((asset_relative_path) => ({ asset_relative_path })),
		}),
	);
	return root;
}

describe('check-release-assets — version/dir derivation', () => {
	it('derives the manifest path from the version', () => {
		assert.equal(
			manifestRelativePathFor(FIXTURE_VERSION),
			`release-assets/portfolio/${FIXTURE_VERSION}/manifest.json`,
		);
	});

	it('derives the version directory from the version', () => {
		assert.equal(versionDirFor(FIXTURE_VERSION), `release-assets/portfolio/${FIXTURE_VERSION}`);
	});

	it('reads the version from package.json text', () => {
		assert.equal(
			releaseVersionFromPackageJson(JSON.stringify({ version: FIXTURE_VERSION })),
			FIXTURE_VERSION,
		);
	});
});

describe('check-release-assets — present manifest passes', () => {
	it('exits ok when the manifest and every listed asset exist', () => {
		const root = stageFixture();
		try {
			const result = checkReleaseAssets({ root, version: FIXTURE_VERSION });
			assert.equal(result.ok, true);
			assert.equal(result.error, null);
			assert.deepEqual(result.missingAssets, []);
			assert.equal(result.relativePath, manifestRelativePathFor(FIXTURE_VERSION));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('check-release-assets — missing manifest fails direct', () => {
	it('fails with the absent path and the canonical remedy', () => {
		const root = mkdtempSync(join(tmpdir(), 'check-release-assets-empty-'));
		try {
			const result = checkReleaseAssets({ root, version: FIXTURE_VERSION });
			assert.equal(result.ok, false);
			assert.ok(
				result.error.includes(manifestRelativePathFor(FIXTURE_VERSION)),
				'error must name the absent manifest path',
			);
			assert.ok(
				result.error.includes('stage the release assets at cut time'),
				'error must state the cut-time staging remedy',
			);
			assert.ok(result.error.includes('docs/release.md'), 'error must point at the cut procedure');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails when a manifest-listed asset file is absent', () => {
		const root = stageFixture({ assets: ['img/cover.jpg', 'img/missing.jpg'] });
		// Remove one listed file after staging to simulate a partial stage.
		rmSync(join(root, versionDirFor(FIXTURE_VERSION), 'img/missing.jpg'));
		try {
			const result = checkReleaseAssets({ root, version: FIXTURE_VERSION });
			assert.equal(result.ok, false);
			assert.deepEqual(result.missingAssets, ['img/missing.jpg']);
			assert.ok(result.error.includes('img/missing.jpg'));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('remedy text names the version dir without hashing anything', () => {
		const text = remedyText(FIXTURE_VERSION);
		assert.ok(text.includes(versionDirFor(FIXTURE_VERSION)));
		assert.ok(!text.toLowerCase().includes('sha'));
	});
});
