#!/usr/bin/env node
/**
 * Tool Registry build orchestrator (Issue #80).
 *
 * Usage:
 *   node scripts/build-tools.mjs [--tool=<slug>] [--dry-run]
 *   node scripts/build-tools.mjs --tool=prototype  # single Tool
 *   node scripts/build-tools.mjs --dry-run        # plan only
 *   node scripts/build-tools.mjs --root=<dir>     # another host repo (tests)
 *
 * Reads `src/tools/manifest.json`, and for each Tool whose
 * `delivery.kind === 'same_origin_static'`:
 *   1. Verifies the submodule is initialised at the pinned SHA
 *      (calls `git submodule status`).
 *   1b. Verifies the *checked-out* commit equals the pinned SHA, that
 *       its tracked files are unmodified, and records the stamp that
 *       ties the collected artefact back to that commit (Issue #473).
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
	writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVENANCE_STAMP_DIR, observeCheckout } from './check-submodule-provenance.mjs';
import { rewriteAssetPaths } from './rewrite-asset-paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const toolFilter = parseArg(args, '--tool');
const dryRun = args.has('--dry-run');
// `--root` exists so `scripts/build-tools.test.mjs` can drive the real
// orchestrator against a synthetic host repository instead of
// re-implementing its decisions. Unset in every documented invocation.
const rootArg = parseArg(args, '--root');
const root = rootArg ? resolve(process.cwd(), rootArg) : resolve(here, '..');

const manifestPath = resolve(root, 'src/tools/manifest.json');
if (!existsSync(manifestPath)) {
	console.error(`[build-tools] manifest not found: ${manifestPath}`);
	process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/**
 * Issue #233 — minimum toolchain versions.
 *
 * `external/readmark` ships a Bun text lockfile (`bun.lock`) at
 * `lockfileVersion: 2`. Older Bun cannot parse it: it logs
 * `UnknownLockfileVersion`, silently IGNORES the lockfile, and then
 * `--frozen-lockfile` fails with the misleading "lockfile had
 * changes, but lockfile is frozen" — which reads like a dependency
 * problem and is not one.
 *
 * That is exactly how the production Workers Builds run died: the build
 * image ships Bun 1.2.15 while GitHub Actions provisions 1.4.2 via
 * `oven-sh/setup-bun`. Probing here turns a confusing mid-build
 * failure into an explicit error naming both the detected and the
 * required version.
 *
 * Keep in sync with `.github/workflows/ci.yml` (`oven-sh/setup-bun`
 * bun-version), the Workers Builds `BUN_VERSION` build variable, and
 * `docs/runbook/cloudflare-workers-builds.md` Build Variables.
 */
const MINIMUM_PACKAGE_MANAGER_VERSION = { bun: '1.3.0' };

/**
 * Compare dotted version strings. Returns -1/0/1, or `null` when a
 * segment is unparsable — the caller treats `null` as a mismatch so
 * a version we cannot read is never silently accepted.
 */
export function compareVersions(a, b) {
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
 * Extract `MAJOR.MINOR.PATCH` from a `bun --version` banner, e.g.
 * `1.4.2 (df017990)` -> `1.4.2`. Returns `null` when absent.
 */
export function parseVersionBanner(banner) {
	const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(banner ?? ''));
	return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

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

	// 1b. Issue #473 — the gitlink says which commit the parent tree
	// records; the checkout says which commit is actually on disk and
	// would actually be built. They can differ (a `git -C
	// external/<slug> checkout <other>` leaves the gitlink untouched),
	// and then the artefact no longer matches any recorded pin. Refuse
	// to build rather than ship it.
	const checkout = observeCheckout(root, tool.source.submodule_path);
	if (!checkout.initialised) {
		errors.push(
			`${tool.slug}: ${tool.source.submodule_path} is not an initialised submodule (its own git toplevel could not be confirmed)`,
		);
		console.error('[build-tools]   ✗ submodule checkout unreadable');
		continue;
	}
	if (checkout.head !== tool.source.pinned_sha) {
		errors.push(
			`${tool.slug}: checked-out source is ${checkout.head ?? 'unreadable'} but pinned_sha is ${tool.source.pinned_sha}`,
		);
		console.error(
			'[build-tools]   ✗ checkout SHA differs from the pin — the artefact would not match any recorded provenance',
		);
		continue;
	}
	// The HEAD comparison above cannot see an *in-place* edit: HEAD is
	// still the pinned commit while the bytes on disk are not. The same
	// is true of a dropped-in untracked file (a `public/` asset, an
	// auto-detected config file), which no tree comparison can see at
	// all. `observeCheckout().dirty` covers tracked modifications *and*
	// untracked files (porcelain's default mode still honours the Tool
	// repository's `.gitignore`, so `node_modules/` and `dist/` — the
	// directories this orchestrator itself fills — do not trip it). The
	// provenance gate reports this as `CHECKOUT_DIRTY` (warn), which
	// does not stop a build — and `pnpm run deploy:production` runs this
	// orchestrator directly, so an unreviewed local edit or file would
	// otherwise reach production behind a stamp that attests the pinned
	// commit. Refuse instead (ADR-0006 §4: the pin is a verified commit).
	// A failed `git status` is not a clean tree. `Boolean(status)` used to
	// collapse a non-zero exit into `dirty: false`, so a corrupt index
	// could still build and stamp the pinned commit. Refuse instead.
	if (checkout.statusReadable === false) {
		errors.push(
			`${tool.slug}: ${tool.source.submodule_path} is initialised but \`git status --porcelain\` failed — the worktree state could not be observed`,
		);
		console.error(
			'[build-tools]   ✗ checkout state unreadable — refusing to build over a worktree whose modifications were never observed',
		);
		continue;
	}
	if (checkout.dirty) {
		errors.push(
			`${tool.slug}: ${tool.source.submodule_path} has uncommitted changes or untracked files — the artefact would not be built from ${tool.source.pinned_sha}`,
		);
		console.error(
			'[build-tools]   ✗ checkout is dirty — the artefact would be built from modified or untracked bytes, not from the pinned commit',
		);
		continue;
	}
	console.error(`[build-tools]   ✓ checkout SHA ${checkout.head} matches the pin`);

	const submodulePath = join(root, tool.source.submodule_path);
	if (!existsSync(submodulePath)) {
		errors.push(`${tool.slug}: submodule path does not exist on disk`);
		console.error('[build-tools]   ✗ submodule path missing on disk');
		continue;
	}
	// Issue #269 — an empty submodule directory (uninitialised checkout /
	// fresh worktree) still satisfies existsSync(), so verify the submodule
	// is actually initialised before running its build. Otherwise the package
	// manager searches up to the repository root and re-runs this build.
	if (
		!existsSync(join(submodulePath, '.git')) ||
		!existsSync(join(submodulePath, 'package.json'))
	) {
		errors.push(
			`${tool.slug}: submodule at ${tool.source.submodule_path} is not initialised (missing .git or package.json) — run git submodule update --init`,
		);
		console.error('[build-tools]   ✗ submodule not initialised');
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
		// Issue #233 — fail fast, naming both versions, when the
		// available toolchain predates a Tool's lockfile format.
		const minimum = MINIMUM_PACKAGE_MANAGER_VERSION[tool.build.package_manager];
		if (minimum) {
			const detected = parseVersionBanner(result.stdout);
			const cmp = detected === null ? null : compareVersions(detected, minimum);
			if (cmp === null || cmp < 0) {
				errors.push(
					`${tool.slug}: ${tool.build.package_manager} ${detected ?? 'unparsable'} is older than the required ${minimum} for its lockfile format`,
				);
				console.error(
					`[build-tools]   ✗ ${tool.build.package_manager} ${detected ?? 'unparsable'} < required ${minimum} — set BUN_VERSION=${minimum} in Workers Builds and oven-sh/setup-bun in CI`,
				);
				continue;
			}
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
		writeProvenanceStamp(tool, checkout.head);
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

	// 5. Rewrite absolute asset paths in `index.html` so they resolve
	// against the artifact's URL namespace (`/tools/<slug>/app/`),
	// not the host origin. The Tool's Vite build emits root-absolute
	// paths like `/assets/index-XXX.js` (Vite default `base: '/'`).
	// When the artifact is served at `/tools/<slug>/app/index.html`,
	// the browser resolves `/assets/...` against the host origin and
	// 404s — the actual assets live at
	// `/tools/<slug>/app/assets/...`.
	//
	// The fix lives here (in the collection orchestrator) because the
	// Tool-side-fix policy reserves Tool repo edits to the Tool repo
	// (e.g. changing its own `vite.config.ts#base`). my-web-2026 owns
	// the path that delivers a Tool into `/tools/<slug>/app/`, so the
	// rewrite happens at collection time. External absolute URLs
	// (`https://...`, `http://...`, `data:`, etc.) are NOT touched.
	if (!dryRun) {
		const indexHtml = join(destDir, 'index.html');
		if (existsSync(indexHtml)) {
			const original = readFileSync(indexHtml, 'utf8');
			const rewritten = rewriteAssetPaths(original, destArtifactPath);
			if (rewritten !== original) {
				writeFileSync(indexHtml, rewritten);
				console.error(
					`[build-tools]   ✓ rewrote root-absolute asset paths to prefix /${destArtifactPath.replace(/^\/+/, '').replace(/\/+$/, '')}`,
				);
			}
		}
	}
}

if (errors.length > 0) {
	console.error(`\n[build-tools] ${errors.length} error(s):`);
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

console.error(`\n[build-tools] all ${targetTools.length} tool(s) built successfully.`);

/**
 * Issue #473 — record which commit produced the collected artefact.
 *
 * The stamp lives at `dist/tool-provenance/<slug>.json`, deliberately
 * OUTSIDE `dist/client/`: everything under `dist/client` is uploaded as
 * a public Static Asset, and this record is operator-facing evidence,
 * not part of the Tool's bundle. `scripts/check-submodule-provenance.mjs`
 * cross-checks it against the manifest pin, the gitlink, and the live
 * checkout, so a stale artefact left over from an earlier build is
 * reported as drift instead of being served silently.
 *
 * No timestamp is written on purpose: the stamp must be byte-stable
 * across two builds of the same commit, so it can be diffed.
 */
function writeProvenanceStamp(tool, checkoutSha) {
	const stamp = {
		schema: 1,
		slug: tool.slug,
		canonical_repo: tool.source.canonical_repo,
		submodule_path: tool.source.submodule_path,
		pinned_sha: tool.source.pinned_sha,
		checkout_sha: checkoutSha ?? tool.source.pinned_sha,
		artifact_path: tool.delivery.artifact_path,
		entry_html: tool.delivery.entry_html ?? `${tool.delivery.artifact_path}/index.html`,
	};
	const dir = join(root, PROVENANCE_STAMP_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${tool.slug}.json`), `${JSON.stringify(stamp, null, 2)}\n`);
	console.error(
		`[build-tools]   ✓ provenance stamp written at ${PROVENANCE_STAMP_DIR}/${tool.slug}.json`,
	);
}

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

export function isSubmoduleInitialised(submodulePath) {
	return existsSync(join(submodulePath, '.git')) && existsSync(join(submodulePath, 'package.json'));
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
