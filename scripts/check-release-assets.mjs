#!/usr/bin/env node
/**
 * Fail-closed release-asset staging gate (Issue #308).
 *
 * Release cuts bump `package.json#version` without staging
 * `release-assets/portfolio/<version>/`, so the cut commit is born red:
 * `scripts/publish-portfolio-production.test.mjs` derives its shipped
 * manifest path from the version and fails closed, producing a cascade
 * of downstream failures that mask the single direct cause. This gate
 * runs in `pnpm run validate:fast` BEFORE `version:check` so the absent
 * path and its canonical remedy print first.
 *
 * What it checks (cheap by design — no hashing; hash verification
 * belongs to the existing publish-portfolio-production test):
 *
 *   1. `release-assets/portfolio/<version>/manifest.json` exists, where
 *      `<version>` is derived from `package.json#version` (the sole
 *      version source per AGENTS.md section 1 — never hard-coded here).
 *   2. Every `asset_relative_path` listed in that manifest exists on
 *      disk under the same version directory.
 *
 * Exit codes: 0 = staged, 1 = missing manifest / asset / unreadable
 * manifest. Every failure prints the absent path plus the canonical
 * remedy (stage release assets at cut time) directly — no test
 * cascade is needed to diagnose it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// Follow-up staging commits that repaired version-only cuts. Referenced
// so the failure message points at the established pattern.
const STAGING_PRECEDENTS = ['d026899', '6c9f74a'];

/** Derive the release version from raw `package.json` text. */
export function releaseVersionFromPackageJson(packageJsonText) {
	const pkg = JSON.parse(packageJsonText);
	if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
		throw new Error('package.json has no usable version field');
	}
	return pkg.version;
}

/** Repo-relative manifest path for a release version. */
export function manifestRelativePathFor(version) {
	return `release-assets/portfolio/${version}/manifest.json`;
}

/** Repo-relative directory holding a release version's staged assets. */
export function versionDirFor(version) {
	return `release-assets/portfolio/${version}`;
}

/** Canonical remedy text shared by every failure shape of this gate. */
export function remedyText(version) {
	return `Remedy: stage the release assets at cut time — the cut commit that bumps package.json#version must also stage ${versionDirFor(version)}/ (same pattern as commits ${STAGING_PRECEDENTS.join(' / ')}). When the portfolio itself is unchanged, copy the previous version directory and swap the version references. See docs/release.md Sprint cycle.`;
}

/**
 * Run the gate against an explicit repo root + version (pure seam for
 * tests; production calls it with the real root and the
 * `package.json`-derived version).
 */
export function checkReleaseAssets({ root, version }) {
	const relativePath = manifestRelativePathFor(version);
	const fullPath = resolve(root, relativePath);
	if (!existsSync(fullPath)) {
		return {
			ok: false,
			relativePath,
			missingAssets: [],
			error: `[check-release-assets] FAIL: release asset manifest missing: ${relativePath} (package.json#version=${version}). The release cut bumped the version without staging the assets, so the publish-portfolio-production manifest check cannot pass. ${remedyText(version)}`,
		};
	}
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(fullPath, 'utf8'));
	} catch (error) {
		return {
			ok: false,
			relativePath,
			missingAssets: [],
			error: `[check-release-assets] FAIL: release asset manifest unreadable: ${relativePath} (${error.message}). ${remedyText(version)}`,
		};
	}
	const listed = Array.isArray(manifest.assets) ? manifest.assets : [];
	const missingAssets = listed
		.map((asset) => asset?.asset_relative_path)
		.filter((p) => typeof p === 'string' && p.length > 0)
		.filter((p) => !existsSync(resolve(root, versionDirFor(version), p)));
	if (missingAssets.length > 0) {
		return {
			ok: false,
			relativePath,
			missingAssets,
			error: `[check-release-assets] FAIL: ${missingAssets.length} manifest-listed asset(s) missing under ${versionDirFor(version)}/:\n${missingAssets.map((p) => `  - ${p}`).join('\n')}\n${remedyText(version)}`,
		};
	}
	return { ok: true, relativePath, missingAssets: [], error: null };
}

function main() {
	const version = releaseVersionFromPackageJson(
		readFileSync(resolve(repoRoot, 'package.json'), 'utf8'),
	);
	const result = checkReleaseAssets({ root: repoRoot, version });
	if (!result.ok) {
		console.error(result.error);
		process.exit(1);
	}
	console.log(
		`[check-release-assets] OK: ${result.relativePath} staged with all listed assets present.`,
	);
}

// ESM main-module guard: importing this file for testing must not run
// the gate (same pattern as scripts/publish-portfolio-production.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
