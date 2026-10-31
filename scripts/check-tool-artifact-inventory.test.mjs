import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	evaluateToolForBuild,
	findLicenseFile,
	findLockfile,
	main,
	observeTool,
	renderHtmlReport,
	renderMarkdownReport,
	scanArtifactHosts,
} from './check-tool-artifact-inventory.mjs';
import { makeToolArtifactFixture } from './make-tool-artifact-fixture.mjs';

/**
 * Tests for the Tool artefact inventory gate (Issue #466).
 *
 * Two layers, following the convention of `check-submodule-provenance.test.mjs`:
 *
 *   1. Pure helpers: which file counts as license evidence, which counts
 *      as the lockfile, and what an artefact scan is allowed to print.
 *   2. The gate itself, driven over the synthetic fixture repository from
 *      `make-tool-artifact-fixture.mjs`. Re-implementing the refusals in a
 *      test would only prove the test's own copy behaves.
 *
 * The two properties worth protecting here are that a failure really is a
 * non-zero exit, and that the output stays status-only: the fixture writes a
 * credential-SHAPED url into a bundle precisely so a regression that echoes a
 * raw url instead of a hostname fails this suite.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirs = [];

after(() => {
	for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir() {
	const dir = mkdtempSync(join(tmpdir(), 'tool-artifact-'));
	temporaryDirs.push(dir);
	return dir;
}

function runGate(args, { cwd = repoRoot } = {}) {
	const result = spawnSync(
		'node',
		[join(repoRoot, 'scripts/check-tool-artifact-inventory.mjs'), ...args],
		{
			cwd,
			encoding: 'utf8',
		},
	);
	return result;
}

let fixtureRoot = null;
function fixture() {
	if (fixtureRoot === null) {
		fixtureRoot = makeToolArtifactFixture(makeTempDir(), { quiet: true });
	}
	return fixtureRoot;
}

describe('inventory helpers — license evidence', () => {
	it('takes the first candidate name that exists, in policy order', () => {
		const dir = makeTempDir();
		assert.equal(findLicenseFile(dir), null);
		writeFileSync(join(dir, 'LICENSE.md'), 'MIT\n');
		assert.equal(findLicenseFile(dir), 'LICENSE.md');
		writeFileSync(join(dir, 'LICENSE'), 'MIT\n');
		assert.equal(findLicenseFile(dir), 'LICENSE');
	});

	it('accepts the alternative names a Tool repository may use', () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, 'COPYING'), 'MIT License\n');
		assert.equal(findLicenseFile(dir), 'COPYING');
	});

	it('does not read a directory as a license file', () => {
		const dir = makeTempDir();
		mkdirSync(join(dir, 'LICENSE'));
		assert.equal(findLicenseFile(dir), null);
	});
});

describe('inventory helpers — lockfile evidence', () => {
	it('resolves the lockfile the declared package manager consumes', () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
		assert.equal(findLockfile(dir, 'pnpm'), 'pnpm-lock.yaml');
		assert.equal(findLockfile(dir, 'bun'), null);
	});

	it('accepts both bun lockfile shapes', () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, 'bun.lockb'), '');
		assert.equal(findLockfile(dir, 'bun'), 'bun.lockb');
		writeFileSync(join(dir, 'bun.lock'), '');
		assert.equal(findLockfile(dir, 'bun'), 'bun.lock');
	});
});

describe('inventory helpers — artefact scan', () => {
	it('reports "not collected" rather than "no hosts" when nothing is built', () => {
		assert.deepEqual(scanArtifactHosts(join(makeTempDir(), 'absent')), {
			present: false,
			hosts: [],
		});
	});

	it('reduces a credential-shaped url to a bare hostname', () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, 'app.js'),
			'fetch("https://user:pw-fixture@tracker.example.org:8443/collect?token=abc");\n',
		);
		const { present, hosts } = scanArtifactHosts(dir);
		assert.equal(present, true);
		assert.deepEqual(hosts, ['tracker.example.org']);
		assert.equal(
			hosts.some((host) => host.includes('@')),
			false,
		);
		assert.equal(
			hosts.some((host) => host.includes(':')),
			false,
		);
	});

	it('skips binary files instead of mining them for strings', () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x41]));
		assert.deepEqual(scanArtifactHosts(dir).hosts, []);
	});

	it('de-duplicates and sorts hosts across files', () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, 'a.html'), '<a href="https://b.example/x">');
		writeFileSync(join(dir, 'b.js'), 'const u = "https://a.example/y";');
		assert.deepEqual(scanArtifactHosts(dir).hosts, ['a.example', 'b.example']);
	});

	it('records wss and protocol-relative references too', () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, 'bundle.js'),
			'new WebSocket("wss://socket.example/ws"); const cdn = "//cdn.example/lib.js"; const file = "file:///tmp/x";\n',
		);
		assert.deepEqual(scanArtifactHosts(dir).hosts, ['cdn.example', 'socket.example']);
	});

	it('observes nothing before collection and the just-collected bytes after it', () => {
		const root = makeToolArtifactFixture(makeTempDir(), { quiet: true });
		const manifest = JSON.parse(readFileSync(join(root, 'src/tools/manifest.json'), 'utf8'));
		const tool = manifest.tools.find((entry) => entry.slug === 'verified-widget');
		const artifactDir = join(root, 'dist/client/tools/verified-widget/app');

		rmSync(artifactDir, { recursive: true, force: true });
		assert.deepEqual(observeTool(root, tool).outbound, { present: false, hosts: [] });

		mkdirSync(artifactDir, { recursive: true });
		writeFileSync(join(artifactDir, 'index.js'), 'fetch("https://collected.example/x");\n');
		assert.deepEqual(observeTool(root, tool).outbound, {
			present: true,
			hosts: ['collected.example'],
		});
	});
});

describe('the gate over the synthetic fixture', () => {
	it('fails on a license mismatch, a missing license file and dependency drift', () => {
		const result = runGate([`--root=${fixture()}`]);
		assert.equal(result.status, 1);
		for (const code of [
			'LICENSE_MISMATCH',
			'LICENSE_EVIDENCE_MISSING',
			'DEPENDENCY_DRIFT',
			'OUTBOUND_UNDECLARED',
		]) {
			assert.match(result.stderr, new RegExp(code), `expected ${code} in the gate output`);
		}
		assert.match(result.stderr, /relicensed-widget/);
		assert.match(result.stderr, /runtime dependencies added: right-pad/);
	});

	it('prints the undeclared host as a hostname, never as the url it came from', () => {
		const result = runGate([`--root=${fixture()}`]);
		assert.match(result.stderr, /metrics\.example\.org/);
		assert.doesNotMatch(result.stderr, /pw-fixture/);
		assert.doesNotMatch(result.stdout, /pw-fixture/);
	});

	it('names the inventory-only population once instead of per entry', () => {
		const result = runGate([`--root=${fixture()}`]);
		assert.equal(result.stderr.match(/INVENTORY_ONLY/g)?.length, 1);
		assert.match(result.stderr, /1 manifest entr\(y\/ies\)/);
	});

	it('verifies the healthy fixture entry and reports its verdict', () => {
		const result = runGate([`--root=${fixture()}`]);
		// A failing run writes its whole block to stderr, so the summary
		// and the per-slug verdicts are asserted there.
		assert.match(result.stderr, /5 tool\(s\) inspected/);
		assert.match(result.stderr, /1 pass, 0 warn, 3 fail, 1 inventory-only/);
		assert.match(result.stderr, /Result: FAIL/);
	});

	it('writes an html report containing every finding code', () => {
		const out = join(makeTempDir(), 'report.html');
		const result = runGate([`--root=${fixture()}`, '--report=html', `--report-out=${out}`]);
		assert.equal(result.status, 1);
		const html = readFileSync(out, 'utf8');
		assert.match(html, /LICENSE_MISMATCH/);
		assert.match(html, /OUTBOUND_UNDECLARED/);
		assert.doesNotMatch(html, /pw-fixture/);
	});

	it('writes a markdown report whose remedy names the regeneration command', () => {
		const root = fixture();
		const result = spawnSync(
			'node',
			[
				join(repoRoot, 'scripts/check-tool-artifact-inventory.mjs'),
				`--root=${root}`,
				'--report=markdown',
			],
			{ cwd: repoRoot, encoding: 'utf8' },
		);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /# Tool artefact license & dependency inventory report/);
		assert.match(result.stdout, /tools:artifact:update/);
	});

	it('is not bypassable by regenerating the record: a false license claim stays failed', () => {
		const root = fixture();
		const updated = runGate([`--root=${root}`, '--update']);
		assert.match(updated.stderr, /reviewed record written/);
		const after = runGate([`--root=${root}`]);
		// The drift the record could legitimately absorb is absorbed.
		assert.doesNotMatch(after.stderr, /DEPENDENCY_DRIFT/);
		assert.doesNotMatch(after.stderr, /OUTBOUND_UNDECLARED/);
		// The license claim is an observation, not drift: it stays failed.
		assert.match(after.stderr, /LICENSE_MISMATCH/);
		assert.equal(after.status, 1);
	});

	it('exits 2 with a fixed message when the manifest cannot be read', () => {
		const empty = makeTempDir();
		const result = runGate([`--root=${empty}`]);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /unusable input/);
		assert.match(result.stderr, /manifest not found/);
	});

	/**
	 * Issue #733 (V-2): "not observed" is not "observed and clean".
	 *
	 * The outbound rule can only be judged against the bytes that would be
	 * served. A gate that runs before the build observes nothing and says
	 * nothing, which reads like a pass. `--require-observed` makes the
	 * observation a precondition of the verdict.
	 */
	it('requires the artefact to be observed when it is asked to', () => {
		const root = fixture();
		rmSync(join(root, 'dist'), { recursive: true, force: true });

		const tolerant = runGate([`--root=${root}`]);
		assert.doesNotMatch(tolerant.stderr, /ARTEFACT_NOT_OBSERVED/);

		const strict = runGate([`--root=${root}`, '--require-observed']);
		assert.equal(strict.status, 1, 'an unobserved shipped Tool must fail the strict mode');
		assert.match(strict.stderr, /ARTEFACT_NOT_OBSERVED/);
		assert.match(strict.stderr, /verified-widget/);
	});
});

describe('report rendering', () => {
	it('escapes finding text instead of interpolating it into the page', () => {
		const result = {
			ok: false,
			counts: { error: 1, warn: 0, info: 0 },
			summary: {
				tools: 1,
				shipped: 1,
				passed: 0,
				warned: 0,
				failed: 1,
				inventoryOnly: 0,
			},
			rows: [
				{
					slug: 'x',
					delivery_kind: 'same_origin_static',
					shipped: true,
					checkout_present: true,
					pinned_sha: 'a'.repeat(40),
					reviewed_pin: null,
					license_status: 'unverified',
					license_declared: null,
					license_evidence: null,
					license_detected: [],
					dependencies_status: 'verified',
					lockfile: 'pnpm-lock.yaml',
					runtime_dependencies: 1,
					outbound_status: 'unobserved',
					outbound_reviewed: 0,
					outbound_new: [],
					verdict: 'FAIL',
				},
			],
			findings: [
				{
					code: 'LICENSE_EVIDENCE_MISSING',
					severity: 'error',
					subject: '<script>',
					message: 'a & b < c',
					remedy: 'read the file',
				},
			],
		};
		const html = renderHtmlReport(result);
		assert.doesNotMatch(html, /<script>/);
		assert.match(html, /&lt;script&gt;/);
		assert.match(html, /a &amp; b &lt; c/);
		assert.match(renderMarkdownReport(result), /LICENSE_EVIDENCE_MISSING/);
	});
});

describe('the gate over this repository', () => {
	// Submodules are only present when the tree was cloned with
	// `--recursive` (CI does; a fresh shallow clone may not), so the
	// steady-state assertion runs where the evidence can be read at all.
	const submodulesPresent =
		existsSync(join(repoRoot, 'external/prototype/.git')) &&
		existsSync(join(repoRoot, 'external/readmark/.git'));

	it(
		'reports every shipped Tool as verified against the reviewed record',
		{ skip: !submodulesPresent },
		() => {
			const result = runGate([]);
			assert.equal(result.status, 0, result.stderr);
			// A passing run writes its block to stdout.
			assert.match(result.stdout, /2 shipped/);
			assert.match(result.stdout, /2 pass/);
			assert.match(result.stdout, /Result: PASS/);
		},
	);

	it('has a reviewed record for every manifest entry', () => {
		const manifest = JSON.parse(readFileSync(join(repoRoot, 'src/tools/manifest.json'), 'utf8'));
		const record = JSON.parse(
			readFileSync(join(repoRoot, 'quality/tool-artifact-inventory.json'), 'utf8'),
		);
		for (const tool of manifest.tools) {
			assert.ok(record.tools[tool.slug], `no reviewed record for ${tool.slug}`);
			assert.equal(record.tools[tool.slug].pinned_sha, tool.source.pinned_sha);
		}
	});
});

describe('the build gate and the commit gate agree', () => {
	it('is driven by the same evaluation the gate reports', () => {
		const root = fixture();
		const manifest = JSON.parse(readFileSync(join(root, 'src/tools/manifest.json'), 'utf8'));
		const record = JSON.parse(
			readFileSync(join(root, 'quality/tool-artifact-inventory.json'), 'utf8'),
		);
		const unlicensed = manifest.tools.find((tool) => tool.slug === 'unlicensed-widget');

		// The orchestrator imports `evaluateToolForBuild`; a Tool the
		// gate refuses must produce error-severity findings there too,
		// otherwise `pnpm run build` would publish what the gate blocks.
		const findings = evaluateToolForBuild({ root, tool: unlicensed, record }).findings;
		assert.ok(
			findings.some(
				(item) => item.code === 'LICENSE_EVIDENCE_MISSING' && item.severity === 'error',
			),
		);
	});
});

/** Import the gate module's build-facing export in a way `node --test` accepts. */
function await_import() {
	return import('./check-tool-artifact-inventory.mjs');
}
