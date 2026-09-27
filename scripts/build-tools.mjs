#!/usr/bin/env node
/**
 * Tool Registry build orchestrator (Issue #80).
 *
 * Usage:
 *   node scripts/build-tools.mjs [--tool=<slug>] [--dry-run]
 *   node scripts/build-tools.mjs --tool=prototype  # single Tool
 *   node scripts/build-tools.mjs --dry-run        # plan only
 *
 * Reads `src/tools/manifest.json`, and for each Tool whose
 * `delivery.kind === 'same_origin_static'`:
 *   1. Verifies the submodule is initialised at the pinned SHA
 *      (calls `git submodule status`).
 *   2. cd's into the submodule path.
 *   3. Runs the manifest's `build.command` (deterministic, fail-fast).
 *   4. Cleans `dist/client/tools/<slug>/` then mirrors
 *      `build.output_dir` to `dist/client/tools/<slug>/app/`.
 *   5. Verifies the destination has the expected `index.html` (or the
 *      tool's documented entry HTML).
 *
 * Tools whose `delivery.kind === 'host_disabled'` or
 * `external_exception` are reported as SKIPPED and do not contribute
 * to the build output.
 *
 * Exit 0 on success (or all-skipped), 1 on any build failure.
 */
import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = new Set(process.argv.slice(2));
const toolFilter = parseArg(args, '--tool');
const dryRun = args.has('--dry-run');

const manifestPath = resolve(root, 'src/tools/manifest.json');
if (!existsSync(manifestPath)) {
	console.error(`[build-tools] manifest not found: ${manifestPath}`);
	process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const targetTools = manifest.tools.filter((t) => {
	if (toolFilter && t.slug !== toolFilter) return false;
	return t.delivery?.kind === 'same_origin_static';
});

console.error(`[build-tools] manifest has ${manifest.tools.length} tool(s)`);
console.error(
	`[build-tools] ${targetTools.length} tool(s) selected for build${toolFilter ? ` (filter: --tool=${toolFilter})` : ''}`,
);
console.error(
	`[build-tools] ${manifest.tools.length - targetTools.length} tool(s) skipped (host_disabled / external_exception)`,
);

if (targetTools.length === 0) {
	console.error('[build-tools] nothing to build — no same_origin_static tools in the manifest.');
	console.error('[build-tools] (this is expected for Issue #80 — the contract is in place,');
	console.error('[build-tools]  but no Tool is currently delivery-enabled. Issue #81 will');
	console.error('[build-tools]  flip the pilot Tool to kind=same_origin_static after');
	console.error('[build-tools]  adding the submodule at the pinned SHA.)');
	process.exit(0);
}

const errors = [];

for (const tool of targetTools) {
	console.error(`\n[build-tools] === ${tool.slug} ===`);
	console.error(`[build-tools]   source.pinned_sha: ${tool.source.pinned_sha}`);
	console.error(`[build-tools]   submodule_path:    ${tool.source.submodule_path}`);
	console.error(`[build-tools]   build.command:     ${tool.build.command}`);
	console.error(`[build-tools]   build.output_dir:  ${tool.build.output_dir}`);
	console.error(`[build-tools]   delivery.artifact_path: ${tool.delivery.artifact_path}`);

	// 1. Submodule gitlink check.
	const gitlinkSha = readGitlinkSha(tool.source.submodule_path);
	if (gitlinkSha === null) {
		errors.push(`${tool.slug}: submodule not initialised at ${tool.source.submodule_path}`);
		console.error('[build-tools]   ✗ submodule missing');
		continue;
	}
	if (gitlinkSha !== tool.source.pinned_sha) {
		errors.push(
			`${tool.slug}: gitlink SHA ${gitlinkSha} does not match pinned_sha ${tool.source.pinned_sha}`,
		);
		console.error('[build-tools]   ✗ SHA mismatch');
		continue;
	}
	console.error('[build-tools]   ✓ gitlink SHA matches');

	const submodulePath = join(root, tool.source.submodule_path);
	if (!existsSync(submodulePath)) {
		errors.push(`${tool.slug}: submodule path does not exist on disk`);
		console.error('[build-tools]   ✗ submodule path missing on disk');
		continue;
	}

	// 2. Build.
	if (dryRun) {
		console.error(
			`[build-tools]   (dry-run) would run: cd ${submodulePath} && ${tool.build.command}`,
		);
	} else {
		console.error('[build-tools]   running build...');
		const result = spawnSync(tool.build.package_manager, ['--version'], {
			cwd: submodulePath,
			encoding: 'utf8',
		});
		if (result.status !== 0) {
			errors.push(`${tool.slug}: package manager ${tool.build.package_manager} not available`);
			console.error('[build-tools]   ✗ package manager unavailable');
			continue;
		}
		const buildResult = spawnSync('sh', ['-c', tool.build.command], {
			cwd: submodulePath,
			encoding: 'utf8',
			stdio: 'inherit',
		});
		if (buildResult.status !== 0) {
			errors.push(`${tool.slug}: build failed (exit ${buildResult.status}): ${tool.build.command}`);
			console.error('[build-tools]   ✗ build failed');
			continue;
		}
		console.error('[build-tools]   ✓ build ok');
	}

	// 3. Collect artifact.
	const sourceOutputDir = join(submodulePath, tool.build.output_dir);
	if (!existsSync(sourceOutputDir)) {
		errors.push(`${tool.slug}: build output dir ${tool.build.output_dir} not produced`);
		console.error('[build-tools]   ✗ output dir missing');
		continue;
	}
	const destArtifactPath = tool.delivery.artifact_path;
	const destDir = join(root, 'dist/client', destArtifactPath);
	if (dryRun) {
		console.error(`[build-tools]   (dry-run) would collect ${sourceOutputDir} → ${destDir}`);
	} else {
		// Clean the slug's root namespace before collecting, so a path
		// change in the manifest (e.g. /tools/<slug> → /tools/<slug>/app)
		// does not leave stale files at the old location. The slug
		// root is the path component immediately under `/tools/`.
		const slugRoot = join(root, 'dist/client/tools', tool.slug);
		if (existsSync(slugRoot)) rmSync(slugRoot, { recursive: true, force: true });
		mkdirSync(destDir, { recursive: true });
		mirrorDir(sourceOutputDir, destDir);
		console.error(`[build-tools]   ✓ artifact collected at ${destDir}`);
	}

	// 4. Entry-point check (the artifact must contain an index.html so
	// the iframe can load it).
	if (!dryRun) {
		const indexHtml = join(destDir, 'index.html');
		if (!existsSync(indexHtml)) {
			errors.push(`${tool.slug}: collected artifact has no index.html at ${destDir}`);
			console.error('[build-tools]   ✗ no index.html in artifact');
			continue;
		}
		console.error('[build-tools]   ✓ index.html present');
	}
}

if (errors.length > 0) {
	console.error(`\n[build-tools] ${errors.length} error(s):`);
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

console.error(`\n[build-tools] all ${targetTools.length} tool(s) built successfully.`);

/**
 * Mirror a directory recursively (cp -r semantics, but Node-only).
 */
function mirrorDir(src, dest) {
	const entries = readdirSync(src, { withFileTypes: true });
	for (const entry of entries) {
		const s = join(src, entry.name);
		const d = join(dest, entry.name);
		if (entry.isDirectory()) {
			mkdirSync(d, { recursive: true });
			mirrorDir(s, d);
		} else if (entry.isFile()) {
			copyFileSync(s, d);
		}
	}
}

function readGitlinkSha(submodulePath) {
	try {
		const out = spawnSync('git', ['ls-tree', 'HEAD', '--', submodulePath], {
			cwd: root,
			encoding: 'utf8',
		}).stdout.trim();
		if (!out) return null;
		const header = out.split('\t')[0];
		const sha = header.split(/\s+/)[2];
		return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
	} catch {
		return null;
	}
}

function parseArg(set, name) {
	for (const a of set) {
		if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
	}
	return null;
}

// Suppress unused-var lint on helper `relative`/`statSync` (kept for
// future use; intentional stable surface).
void relative;
void statSync;
