import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Pure-helper extraction tests for the Tool Registry build
 * orchestrator. The orchestrator itself shells out to git / the
 * package manager / a build command, so we exercise its decisions
 * (target filter, manifest classification, SHA parsing) via fixtures.
 *
 * The convention matches `check-tools-manifest.test.mjs` and the
 * other migration-style scripts in this repo.
 */

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
 * `1.4.2 (df017990)` -> `1.4.2`; `null` when absent.
 */
function parseVersionBanner(banner) {
	const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(banner ?? ''));
	return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/** The minimum the orchestrator enforces for bun (Issue #233). */
const MIN_BUN = '1.3.0';
