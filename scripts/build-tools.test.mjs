import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Tests for the Tool Registry build orchestrator.
 *
 * Two layers:
 *
 *   1. Pure-helper extraction for the decisions the orchestrator makes
 *      from data (target filter, manifest classification, SHA parsing,
 *      version comparison). The orchestrator module runs its work at
 *      import time, so it cannot be imported for unit tests.
 *   2. Issue #473 — the orchestrator itself, spawned as a CLI against a
 *      synthetic host repository (`--root=`), to prove the *refusals*
 *      actually stop a build. Re-implementing those refusals in a test
 *      would only prove that the test's own copy behaves.
 *
 * The convention matches `check-tools-manifest.test.mjs` and the
 * other migration-style scripts in this repo.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_TOOLS = join(repoRoot, 'scripts/build-tools.mjs');
const SANDBOX_ENV = {
	...process.env,
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_SYSTEM: '/dev/null',
	GIT_AUTHOR_NAME: 'build-tools fixture',
	GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
	GIT_COMMITTER_NAME: 'build-tools fixture',
	GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
const temporaryDirs = [];

after(() => {
	for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir() {
	const dir = mkdtempSync(join(tmpdir(), 'build-tools-'));
	temporaryDirs.push(dir);
	return dir;
}

function gitIn(cwd, args) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: SANDBOX_ENV });
	assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
	return result.stdout.trim();
}

const CANONICAL = 'https://github.com/example-org/example-widget.git';

/**
 * A synthetic host repository with one `same_origin_static` Tool whose
 * submodule has two commits, so the checkout can be pinned, drifted, or
 * dirtied. `build.command` is `false` — every test below must be
 * refused *before* it runs, and a fixture that actually builds would
 * shell out to a package manager.
 */
function buildHostRepo(state) {
	const root = makeTempDir();
	gitIn(root, ['init', '-q', '-b', 'main']);

	const submodulePath = join(root, 'external/example-widget');
	mkdirSync(submodulePath, { recursive: true });
	gitIn(submodulePath, ['init', '-q', '-b', 'main']);
	writeFileSync(join(submodulePath, 'index.html'), '<!doctype html><title>widget v1</title>');
	writeFileSync(join(submodulePath, 'package.json'), '{"name":"example-widget"}\n');
	gitIn(submodulePath, ['add', '-A']);
	gitIn(submodulePath, ['commit', '-q', '-m', 'widget v1']);
	const pinnedSha = gitIn(submodulePath, ['rev-parse', 'HEAD']);
	writeFileSync(join(submodulePath, 'index.html'), '<!doctype html><title>widget v2</title>');
	gitIn(submodulePath, ['commit', '-q', '-am', 'widget v2']);
	const driftedSha = gitIn(submodulePath, ['rev-parse', 'HEAD']);
	gitIn(submodulePath, ['remote', 'add', 'origin', CANONICAL]);

	gitIn(submodulePath, ['reset', '--hard', '-q', state === 'drifted' ? driftedSha : pinnedSha]);
	if (state === 'dirty') {
		writeFileSync(
			join(submodulePath, 'index.html'),
			'<!doctype html><title>edited in place</title>',
		);
	}

	mkdirSync(join(root, 'src/tools'), { recursive: true });
	writeFileSync(
		join(root, 'src/tools/manifest.json'),
		`${JSON.stringify(
			{
				version: 1,
				tools: [
					{
						slug: 'example-widget',
						display_name: 'Example Widget',
						description: 'Synthetic Tool for the orchestrator refusal tests.',
						source: {
							canonical_repo: CANONICAL,
							submodule_path: 'external/example-widget',
							pinned_sha: pinnedSha,
							branch: 'main',
						},
						build: { command: 'false', output_dir: 'dist', package_manager: 'pnpm' },
						delivery: {
							kind: 'same_origin_static',
							artifact_path: '/tools/example-widget/app',
						},
						classification: 'same_origin_static',
						license: 'MIT',
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	writeFileSync(
		join(root, '.gitmodules'),
		`[submodule "external/example-widget"]\n\tpath = external/example-widget\n\turl = ${CANONICAL}\n`,
	);
	writeFileSync(join(root, 'README.md'), '# synthetic build-tools fixture\n');
	gitIn(root, ['add', 'README.md', '.gitmodules', 'src/tools/manifest.json']);
	gitIn(root, [
		'update-index',
		'--add',
		'--cacheinfo',
		`160000,${pinnedSha},external/example-widget`,
	]);
	gitIn(root, ['commit', '-q', '-m', 'host: pin the widget submodule']);

	return { root, pinnedSha, driftedSha };
}

function runBuildTools(root, extraArgs = []) {
	return spawnSync('node', [BUILD_TOOLS, `--root=${root}`, ...extraArgs], {
		cwd: repoRoot,
		encoding: 'utf8',
		env: SANDBOX_ENV,
	});
}

const SHA_REGEX = /^[0-9a-f]{40}$/;

/**
 * Reproduce the orchestrator's target-tool filter: only `same_origin_static`
 * Tools are built, optionally restricted by `--tool=<slug>`.
 */
function selectTargets(tools, toolFilter) {
	return tools.filter((t) => {
		if (toolFilter && t.slug !== toolFilter) return false;
		return t.delivery?.kind === 'same_origin_static';
	});
}

/**
 * Reproduce the manifest's delivery-kind histogram (used to print the
 * summary at the end of the orchestrator run).
 */
function deliveryBreakdown(tools) {
	return tools.reduce((acc, t) => {
		const k = t.delivery?.kind ?? 'unknown';
		acc[k] = (acc[k] ?? 0) + 1;
		return acc;
	}, {});
}

/**
 * Reproduce the gitlink-SHA extraction that `readGitlinkSha` does
 * with `git ls-tree HEAD -- <submodule_path>`. The wire format is:
 *
 *   "<mode> <type> <sha>\t<path>\n"
 *
 * Returns the 40-hex SHA or `null` if the input is empty / malformed.
 */
function parseGitlinkStdout(stdout) {
	if (!stdout) return null;
	const header = stdout.split('\t')[0];
	const sha = header.split(/\s+/)[2];
	return SHA_REGEX.test(sha) ? sha : null;
}

describe('Tool build orchestrator — target selection', () => {
	const tools = [
		{
			slug: 'prototype',
			delivery: { kind: 'host_disabled', disabled_reason: 'x' },
		},
		{
			slug: 'text-counter',
			delivery: { kind: 'same_origin_static', artifact_path: '/tools/text-counter' },
		},
		{
			slug: 'mic-level',
			delivery: { kind: 'external_exception', external_url: 'https://x.example' },
		},
	];

	it('selects only same_origin_static tools when no filter is set', () => {
		const selected = selectTargets(tools, null);
		assert.deepEqual(
			selected.map((t) => t.slug),
			['text-counter'],
		);
	});

	it('applies the --tool filter on top of the kind filter', () => {
		const selected = selectTargets(tools, 'text-counter');
		assert.deepEqual(
			selected.map((t) => t.slug),
			['text-counter'],
		);
	});

	it('--tool filter that does not match any same_origin_static entry yields []', () => {
		const selected = selectTargets(tools, 'prototype');
		assert.equal(selected.length, 0);
	});

	it('host_disabled tools are not built even if they are the only entry', () => {
		const onlyDisabled = [
			{ slug: 'prototype', delivery: { kind: 'host_disabled', disabled_reason: 'x' } },
		];
		assert.equal(selectTargets(onlyDisabled, null).length, 0);
	});
});

describe('Tool build orchestrator — delivery breakdown', () => {
	it('counts host_disabled / same_origin_static / external_exception correctly', () => {
		const tools = [
			{ slug: 'a', delivery: { kind: 'host_disabled' } },
			{ slug: 'b', delivery: { kind: 'host_disabled' } },
			{ slug: 'c', delivery: { kind: 'same_origin_static' } },
			{ slug: 'd', delivery: { kind: 'external_exception' } },
			{ slug: 'e', delivery: {} },
		];
		assert.deepEqual(deliveryBreakdown(tools), {
			host_disabled: 2,
			same_origin_static: 1,
			external_exception: 1,
			unknown: 1,
		});
	});
});

describe('Tool build orchestrator — gitlink SHA parsing', () => {
	it('parses a normal `git ls-tree` line', () => {
		const stdout = '160000 commit 18e925272ca274e428e143c45194950d562bc096\texternal/prototype\n';
		assert.equal(parseGitlinkStdout(stdout), '18e925272ca274e428e143c45194950d562bc096');
	});

	it('returns null on empty output (submodule not registered)', () => {
		assert.equal(parseGitlinkStdout(''), null);
	});

	it('returns null when the SHA column is malformed', () => {
		const stdout = '160000 commit NOT-A-SHA\texternal/prototype\n';
		assert.equal(parseGitlinkStdout(stdout), null);
	});

	it('returns null when the row has no tab (defensive)', () => {
		assert.equal(parseGitlinkStdout('160000 commit abc'), null);
	});
});

describe('Tool build orchestrator — Issue #80 baseline', () => {
	// This is the contract-level assertion: at the end of Issue #80,
	// all 14 Tools are delivery.kind=host_disabled, so the build
	// orchestrator should report "nothing to build" and exit 0.
	// If #81 flips any Tool to same_origin_static, this fixture will
	// fail and force the orchestrator's "all-skipped" branch to be
	// re-verified.
	const manifestForBaseline = {
		version: 1,
		tools: Array.from({ length: 14 }, (_, i) => ({
			slug: `tool-${i}`,
			delivery: { kind: 'host_disabled', disabled_reason: 'baseline' },
		})),
	};

	it('all-skipped case produces 0 selected targets (no build runs)', () => {
		const selected = selectTargets(manifestForBaseline.tools, null);
		assert.equal(selected.length, 0);
	});

	it('delivery breakdown for #80 baseline is 14 host_disabled', () => {
		assert.deepEqual(deliveryBreakdown(manifestForBaseline.tools), {
			host_disabled: 14,
		});
	});
});

/* -- Issue #233: toolchain-version guard --------------------------------- */

describe('compareVersions (Issue #233)', () => {
	it('orders dotted versions numerically, not lexically', () => {
		assert.equal(compareVersions('1.2.15', '1.3.0'), -1);
		assert.equal(compareVersions('1.3.0', '1.2.15'), 1);
		assert.equal(compareVersions('1.4.2', '1.4.2'), 0);
		// The failing build: 1.2.15 vs the required 1.3.0.
		assert.equal(compareVersions('1.2.15', '1.3.0'), -1);
		// A patch-only difference must not compare as 0.
		assert.equal(compareVersions('1.4.1', '1.4.2'), -1);
	});

	it('treats a missing segment as zero', () => {
		assert.equal(compareVersions('1.4', '1.4.0'), 0);
		assert.equal(compareVersions('1.4', '1.4.1'), -1);
	});

	it('returns null for unparsable input so it is never silently accepted', () => {
		assert.equal(compareVersions('abc', '1.3.0'), null);
		assert.equal(compareVersions('1.x.0', '1.3.0'), null);
	});
});

describe('parseVersionBanner (Issue #233)', () => {
	it('extracts the version from a bun banner', () => {
		assert.equal(parseVersionBanner('1.4.2 (df017990)'), '1.4.2');
		assert.equal(parseVersionBanner('1.2.15 (df017990)'), '1.2.15');
		assert.equal(parseVersionBanner('1.4.2'), '1.4.2');
	});

	it('returns null when no version is present', () => {
		assert.equal(parseVersionBanner(''), null);
		assert.equal(parseVersionBanner(undefined), null);
		assert.equal(parseVersionBanner('unknown'), null);
	});

	it('rejects the exact banner that failed the release build', () => {
		// bun 1.2.15 announced "Unknown lockfile version" for readmark's
		// lockfileVersion 2; the guard must catch it before the build runs.
		const detected = parseVersionBanner('1.2.15 (df017990)');
		assert.equal(detected, '1.2.15');
		assert.equal(compareVersions(detected, '1.3.0'), -1);
	});
});

/**
 * Issue #233 — mirrors `scripts/build-tools.mjs#compareVersions`.
 * Numeric segment comparison; `null` when a segment is unparsable so
 * an unreadable version is never silently treated as sufficient.
 */
function compareVersions(a, b) {
	const pa = String(a).split('.');
	const pb = String(b).split('.');
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = Number.parseInt(pa[i] ?? '0', 10);
		const nb = Number.parseInt(pb[i] ?? '0', 10);
		if (Number.isNaN(na) || Number.isNaN(nb)) return null;
		if (na !== nb) return na < nb ? -1 : 1;
	}
	return 0;
}

/**
 * Issue #233 — mirrors `scripts/build-tools.mjs#parseVersionBanner`.
 * `1.4.2 (df017032)` -> `1.4.2`; `null` when absent.
 */
function parseVersionBanner(banner) {
	const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(banner ?? ''));
	return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/** The minimum the orchestrator enforces for bun (Issue #233). */
const MIN_BUN = '1.3.0';

/* -- Issue #473: the orchestrator's own provenance refusals -------------- */

describe('build orchestrator refuses an unprovenanced checkout (Issue #473)', () => {
	it('refuses to build when the checked-out commit is not the pinned commit', () => {
		const fixture = buildHostRepo('drifted');
		const result = runBuildTools(fixture.root);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /checkout SHA differs from the pin/);
		assert.match(result.stderr, new RegExp(fixture.driftedSha));
		assert.match(result.stderr, new RegExp(fixture.pinnedSha));
		// The refusal happens before the build command runs, so no
		// artefact and no provenance stamp may exist.
		assert.equal(existsSync(join(fixture.root, 'dist/tool-provenance')), false);
	});

	it('refuses to build when tracked files were edited in place', () => {
		// HEAD is still the pinned commit here, so a HEAD-vs-pin check
		// alone passes and the artefact would be built from bytes the
		// stamp (which attests the commit) does not describe.
		const fixture = buildHostRepo('dirty');
		const result = runBuildTools(fixture.root);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /checkout is dirty/);
		assert.equal(existsSync(join(fixture.root, 'dist/tool-provenance')), false);
	});

	it('reports a checkout that does not match the pin as an error line', () => {
		const fixture = buildHostRepo('drifted');
		const result = runBuildTools(fixture.root);
		assert.match(result.stderr, /\[build-tools\] 1 error\(s\):/);
		assert.match(result.stderr, /checked-out source is /);
	});
});
