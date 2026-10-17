#!/usr/bin/env node
/**
 * Build the synthetic repository used to document the Tool submodule
 * provenance gate (Issue #473).
 *
 *   node scripts/make-provenance-fixture.mjs <fixtureDir> [reportOut]
 *   node scripts/make-provenance-fixture.mjs .tmp/supply-chain-fixture
 *   node scripts/make-provenance-fixture.mjs .tmp/supply-chain-fixture \
 *        .tmp/supply-chain-fixture/provenance.html
 *
 * With no `reportOut` the gate runs without `--report`, so its
 * status-only stderr output stands alone — that is the block quoted in
 * `docs/tools/runbook.md` §6.2, byte for byte on every machine. With a
 * `reportOut`, an HTML report of the same result is also written: the
 * material behind `docs/verification/supply-chain/submodule-provenance.webp`.
 *
 * Why it exists
 * -------------
 * Two things in `docs/tools/runbook.md` §6 have to be *observations*,
 * not illustrations:
 *
 *   1. §6.1 "Normal observation" — real output of this repository.
 *   2. §6.2 "Abnormal observation and repair" — output when a pinned
 *      submodule has drifted. This repository is (correctly) never in
 *      that state, so the observation has to be produced somewhere.
 *
 * This script builds a synthetic host repository with git plumbing
 * only — no network, no real Tool repository, no credential — that
 * holds one healthy Tool, one checkout past its pin, one Tool whose
 * `.gitmodules` tracks a branch, and one inventory-only entry, then
 * runs the real gate over it with `--root=` and prints its status-only
 * output. Commit dates are fixed, so the commit SHAs — and therefore
 * the pasted output in the runbook — are byte-reproducible.
 *
 * Safety
 * ------
 * The fixture is entirely synthetic (`example-org`, `fixture@example.invalid`),
 * `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` are neutralised so a developer's
 * own git config cannot change the result, and the script refuses to
 * write anywhere inside the repository except under a `.tmp/` path.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gate = join(repoRoot, 'scripts/check-submodule-provenance.mjs');

const fixtureArg = process.argv[2];
const reportArg = process.argv[3];
if (!fixtureArg) {
	process.stderr.write(
		'usage: node scripts/make-provenance-fixture.mjs <fixtureDir> [reportOut]\n',
	);
	process.exit(2);
}
const root = isAbsolute(fixtureArg) ? fixtureArg : resolve(process.cwd(), fixtureArg);
const reportOut = reportArg
	? isAbsolute(reportArg)
		? reportArg
		: resolve(process.cwd(), reportArg)
	: null;

// Never let a mistyped argument destroy this repository: inside the
// checkout, only a `.tmp/` path is an acceptable target (`.tmp/` is
// gitignored precisely because it is scratch space).
function refuseUnsafeTarget() {
	const rel = relative(repoRoot, root);
	const insideRepo = rel === '' || !rel.startsWith('..');
	if (insideRepo && rel.split(sep)[0] !== '.tmp') {
		process.stderr.write(
			`refusing to build a fixture at ${root}: inside the repository, only a .tmp/ path may be replaced\n`,
		);
		process.exit(2);
	}
}

refuseUnsafeTarget();

const env = {
	...process.env,
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_SYSTEM: '/dev/null',
	GIT_AUTHOR_NAME: 'provenance fixture',
	GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
	GIT_COMMITTER_NAME: 'provenance fixture',
	GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
	// Fixed dates: the commit SHAs below (and therefore every SHA printed
	// by the gate) are identical on every machine and every run.
	GIT_AUTHOR_DATE: '2026-01-01T00:00:00+00:00',
	GIT_COMMITTER_DATE: '2026-01-01T00:00:00+00:00',
};

const git = (cwd, args) => {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8', env });
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	return result.stdout.trim();
};

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
git(root, ['init', '-q', '-b', 'main']);

/**
 * One synthetic Tool repository with two commits, so its checkout can
 * legitimately sit at either one.
 */
function makeToolRepo(slug) {
	const path = join(root, `external/${slug}`);
	mkdirSync(path, { recursive: true });
	git(path, ['init', '-q', '-b', 'main']);
	writeFileSync(join(path, 'index.html'), `<!doctype html><title>${slug} v1</title>`);
	writeFileSync(join(path, 'package.json'), `{"name":"${slug}","private":true}\n`);
	git(path, ['add', '-A']);
	git(path, ['commit', '-q', '-m', `${slug} v1`]);
	const pinned = git(path, ['rev-parse', 'HEAD']);
	writeFileSync(join(path, 'index.html'), `<!doctype html><title>${slug} v2</title>`);
	git(path, ['commit', '-q', '-am', `${slug} v2`]);
	const moved = git(path, ['rev-parse', 'HEAD']);
	const canonical = `https://github.com/example-org/${slug}.git`;
	git(path, ['remote', 'add', 'origin', canonical]);
	return { slug, path, pinned, moved, canonical };
}

function entry(tool, delivery) {
	return {
		slug: tool.slug,
		display_name: tool.slug,
		description: `Synthetic ${tool.slug} used by the Issue #473 verification report.`,
		source: {
			canonical_repo: tool.canonical,
			submodule_path: `external/${tool.slug}`,
			pinned_sha: tool.pinned,
			branch: 'main',
		},
		build: { command: 'true', output_dir: 'dist', package_manager: 'pnpm' },
		delivery,
		classification: 'same_origin_static',
		license: 'MIT',
	};
}

const served = (slug) => ({
	kind: 'same_origin_static',
	artifact_path: `/tools/${slug}/app`,
	entry_html: `/tools/${slug}/app/index.html`,
	iframe: { sandbox: 'allow-scripts', referrer_policy: 'no-referrer' },
});

// 1. healthy: pin == gitlink == checkout HEAD, origin matches, stamp matches.
const widget = makeToolRepo('example-widget');
git(widget.path, ['reset', '--hard', '-q', widget.pinned]);

// 2. drifted: the worktree moved past the pin (the Issue #473 headline).
const gadget = makeToolRepo('other-gadget');
git(gadget.path, ['reset', '--hard', '-q', gadget.moved]);

// 3. branch-tracked: the checkout is healthy, but `.gitmodules` records a
//    branch, so `git submodule update --remote` would float the pin.
const tracker = makeToolRepo('third-tool');
git(tracker.path, ['reset', '--hard', '-q', tracker.pinned]);

const tools = [
	entry(widget, served('example-widget')),
	entry(gadget, served('other-gadget')),
	entry(tracker, served('third-tool')),
	{
		slug: 'text-summariser',
		display_name: 'Text Summariser',
		description: 'Inventory-only entry: recorded upstream SHA, no fetch source yet.',
		source: {
			canonical_repo: 'https://github.com/example-org/text-summariser.git',
			submodule_path: 'external/text-summariser',
			pinned_sha: 'c'.repeat(40),
			branch: 'main',
		},
		build: { command: 'true', output_dir: 'dist', package_manager: 'pnpm' },
		delivery: {
			kind: 'host_disabled',
			disabled_reason: 'Not integrable yet — inventory-only, no submodule.',
		},
		classification: 'needs_tool_side_fix',
		license: 'MIT',
	},
];

mkdirSync(join(root, 'src/tools'), { recursive: true });
writeFileSync(
	join(root, 'src/tools/manifest.json'),
	`${JSON.stringify({ version: 1, tools }, null, 2)}\n`,
);
writeFileSync(
	join(root, '.gitmodules'),
	[
		'[submodule "external/example-widget"]',
		'\tpath = external/example-widget',
		'\turl = https://github.com/example-org/example-widget.git',
		'[submodule "external/other-gadget"]',
		'\tpath = external/other-gadget',
		'\turl = https://github.com/example-org/other-gadget.git',
		'[submodule "external/third-tool"]',
		'\tpath = external/third-tool',
		'\turl = https://github.com/example-org/third-tool.git',
		'\tbranch = main',
		'',
	].join('\n'),
);
writeFileSync(join(root, 'README.md'), '# synthetic supply-chain fixture\n');
git(root, ['add', 'README.md', '.gitmodules', 'src/tools/manifest.json']);
for (const tool of [widget, gadget, tracker]) {
	git(root, [
		'update-index',
		'--add',
		'--cacheinfo',
		`160000,${tool.pinned},external/${tool.slug}`,
	]);
}
git(root, ['commit', '-q', '-m', 'fixture: pin three synthetic Tool submodules']);
for (const tool of [widget, gadget, tracker]) {
	git(root, ['config', `submodule.external/${tool.slug}.url`, tool.canonical]);
}

// One artefact stamp, for the healthy Tool only, so the report shows an
// artefact pin that agrees with the manifest next to two that do not.
mkdirSync(join(root, 'dist/tool-provenance'), { recursive: true });
writeFileSync(
	join(root, 'dist/tool-provenance/example-widget.json'),
	`${JSON.stringify(
		{
			schema: 1,
			slug: 'example-widget',
			canonical_repo: widget.canonical,
			submodule_path: 'external/example-widget',
			pinned_sha: widget.pinned,
			checkout_sha: widget.pinned,
			artifact_path: '/tools/example-widget/app',
			entry_html: '/tools/example-widget/app/index.html',
		},
		null,
		2,
	)}\n`,
);

const report = spawnSync(
	'node',
	[gate, `--root=${root}`, ...(reportOut ? ['--report=html', `--report-out=${reportOut}`] : [])],
	{
		cwd: repoRoot,
		encoding: 'utf8',
		env,
	},
);
// The gate's own status-only output is the artefact the runbook quotes;
// pass it through untouched (stdout: report path line, stderr: findings).
process.stdout.write(report.stdout);
process.stderr.write(report.stderr);
if (reportOut && !existsSync(reportOut)) {
	process.stderr.write(`[make-provenance-fixture] report was not written to ${reportOut}\n`);
	process.exit(report.status === null ? 1 : report.status);
}
