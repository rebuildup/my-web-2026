#!/usr/bin/env node
/**
 * Artifact attestation check (Issue #476).
 *
 *   node scripts/check-artifact-attestation.mjs
 *       generate a manifest for `.cloudflare/output/v0/`, verify it
 *       against the same artifact, and write it to
 *       `release-assets/supply-chain/<version>/artifact-attestation.json`
 *
 *   node scripts/check-artifact-attestation.mjs --artifact-dir=<dir>
 *   node scripts/check-artifact-attestation.mjs --manifest=<path>
 *       verify an existing manifest against the artifact on disk
 *
 *   node scripts/check-artifact-attestation.mjs --manifest=<path> --source-sha=<sha>
 *       name the commit the artifact is expected to describe. This is
 *       a verification-only option: generation always attests the
 *       checked-out HEAD and refuses a caller-supplied commit.
 *
 *   node scripts/check-artifact-attestation.mjs --manifest=<path> --release-tag=v<version>
 *       verify a published manifest against the release tag itself:
 *       the tag must resolve to the manifest's source commit and name
 *       the manifest's package version. Verification-only, like
 *       `--source-sha`.
 *
 * Why this exists
 * ---------------
 * A release must be able to answer three questions without reading a
 * dashboard:
 *
 *   1. Which exact bytes did we ship?      -> artifact sha-256 digest
 *   2. Which source produced them?         -> git commit + tree state
 *   3. Which dependency set resolved?      -> lockfile digest + inventory
 *
 * The manifest records all three, plus the Cloudflare build UUID /
 * deploy id when the caller actually has one. It is not a signature:
 * no signing key exists here, so it states `unsigned` and every
 * signature field is null. The gate fails closed if a manifest claims a
 * signature it cannot back.
 *
 * Status-only by construction: the script prints paths, digests,
 * counts and verdicts. It never reads a secret value, never calls the
 * Cloudflare API, and never contacts a production host. See
 * docs/security/supply-chain-artifact-attestation.md.
 *
 * Exit codes: 0 = pass, 1 = mismatch / finding, 2 = bad input.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
	DEFAULT_ARTIFACT_DIR,
	REPO_ROOT,
	buildManifest,
	formatVerification,
	manifestPathFor,
	readDependencyFacts,
	releaseTagVersion,
	serializeManifest,
	verifyManifest,
} from './_artifact-attestation.mjs';

function parseArgs(argv) {
	const options = {
		artifactDir: null,
		manifest: null,
		out: null,
		sourceSha: null,
		releaseTag: null,
		branch: null,
		buildUuid: null,
		deployId: null,
		allowDirty: false,
		json: false,
		help: false,
	};
	for (const arg of argv) {
		// `pnpm run <script> -- <args>` forwards the literal separator.
		// Accept it so the documented form works with pnpm and npm alike.
		if (arg === '--') continue;
		if (arg === '--help' || arg === '-h') options.help = true;
		else if (arg === '--allow-dirty') options.allowDirty = true;
		else if (arg === '--json') options.json = true;
		else if (arg.startsWith('--artifact-dir=')) options.artifactDir = arg.slice(15);
		else if (arg.startsWith('--manifest=')) options.manifest = arg.slice(11);
		else if (arg.startsWith('--out=')) options.out = arg.slice(6);
		else if (arg.startsWith('--source-sha=')) options.sourceSha = arg.slice(13);
		else if (arg.startsWith('--release-tag=')) options.releaseTag = arg.slice(14);
		else if (arg.startsWith('--branch=')) options.branch = arg.slice(9);
		else if (arg.startsWith('--build-uuid=')) options.buildUuid = arg.slice(13);
		else if (arg.startsWith('--deploy-id=')) options.deployId = arg.slice(12);
		else throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

const USAGE = `Artifact attestation (Issue #476)

  node scripts/check-artifact-attestation.mjs [options]

Options:
  --artifact-dir=<dir>   artifact to hash (default: ${DEFAULT_ARTIFACT_DIR})
  --manifest=<path>      verify an existing manifest instead of generating one
  --out=<path>           where to write a generated manifest
  --source-sha=<sha>     expected source commit for --manifest verification only
                         (generation always attests the checked-out HEAD)
  --release-tag=<name>   verify a --manifest against a local release tag: the tag
                         must resolve to the manifest's source commit and name its
                         version (v<package.json#version>)
  --branch=<name>        branch recorded in a generated manifest
  --build-uuid=<id>      Cloudflare Workers Builds UUID, when obtained
  --deploy-id=<id>       Cloudflare deploy id, when obtained
  --allow-dirty          generate from a dirty tracked tree (never accepted by CI)
  --json                 print the verification result as JSON
  --help                 this text

Exit codes: 0 = pass, 1 = mismatch / finding, 2 = bad input.`;

function git(args) {
	return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/**
 * Resolve a release tag to the commit it names.
 *
 * Only local git state is read — no remote query, no credential — so
 * the check is reproducible offline. An unresolvable tag is an input
 * error (exit 2), never a silent pass.
 */
function resolveReleaseTag(name) {
	let commit;
	try {
		commit = git(['rev-list', '-n', '1', `${name}^{commit}`]);
	} catch {
		console.error(
			`[artifact-attestation] cannot resolve release tag ${name} in this checkout. Fetch the tags (\`git fetch --tags\`) and retry.`,
		);
		return null;
	}
	const version = releaseTagVersion(name);
	if (version === null) {
		console.error(
			`[artifact-attestation] FAIL: ${name} is not a v<version> release tag, so it names no version to compare. Use the tag created for this release.`,
		);
		return null;
	}
	return { name, commit, version };
}

function readGitFacts() {
	const head = git(['rev-parse', 'HEAD']);
	const ciHead = process.env.WORKERS_CI_COMMIT_SHA || null;
	const branchRef = process.env.WORKERS_CI_BRANCH || git(['rev-parse', '--abbrev-ref', 'HEAD']);
	const branch = branchRef === 'HEAD' ? null : branchRef;
	const dirty = git(['status', '--porcelain=v1', '--untracked-files=no']).length > 0;
	return { head, ciHead, branch, dirty };
}

function printResult(result, { manifestPath = null, json = false } = {}) {
	if (json) {
		console.log(JSON.stringify({ manifest: manifestPath, ...result }, null, 2));
		return;
	}
	console.log(formatVerification(result, { manifestPath }));
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log(USAGE);
		return 0;
	}

	const artifactDir = resolve(REPO_ROOT, options.artifactDir ?? DEFAULT_ARTIFACT_DIR);
	if (!existsSync(artifactDir)) {
		console.error(
			`[artifact-attestation] artifact directory not found: ${artifactDir}\nRun \`pnpm run build:production\` first (or pass --artifact-dir).`,
		);
		return 2;
	}

	const gitFacts = readGitFacts();

	if (options.manifest) {
		let releaseTag = null;
		if (options.releaseTag) {
			releaseTag = resolveReleaseTag(options.releaseTag);
			if (!releaseTag) return 2;
			if (options.sourceSha && options.sourceSha !== releaseTag.commit) {
				console.error(
					`[artifact-attestation] FAIL: --source-sha ${options.sourceSha} disagrees with release tag ${releaseTag.name} (${releaseTag.commit}). State one expectation, not two.`,
				);
				return 2;
			}
		}
		// The release tag names the commit the release actually shipped,
		// so it is the expectation to verify against when it is given;
		// WORKERS_CI_COMMIT_SHA and the local HEAD are the weaker
		// fallbacks.
		const expectedSourceCommit =
			releaseTag?.commit ?? options.sourceSha ?? gitFacts.ciHead ?? gitFacts.head;
		const manifestPath = resolve(REPO_ROOT, options.manifest);
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		} catch (error) {
			console.error(
				`[artifact-attestation] cannot read manifest ${manifestPath}: ${error.message}`,
			);
			return 2;
		}
		const result = verifyManifest({
			manifest,
			artifactDir,
			root: REPO_ROOT,
			expectedSourceCommit,
			requireClean: !options.allowDirty,
			treeState: gitFacts.dirty ? 'dirty' : 'clean',
			releaseTag,
		});
		printResult(result, { manifestPath, json: options.json });
		return result.status === 'PASS' ? 0 : 1;
	}

	// Generation must describe the checked-out commit. A caller-supplied
	// SHA would let a manifest claim source the artifact was never built
	// from, so accept it only when verifying an existing document.
	if (options.sourceSha || options.releaseTag) {
		console.error(
			'[artifact-attestation] FAIL: --source-sha / --release-tag are only valid with --manifest. ' +
				'Generation always attests the checked-out HEAD.',
		);
		return 2;
	}
	if (gitFacts.ciHead && gitFacts.ciHead !== gitFacts.head) {
		console.error(
			`[artifact-attestation] FAIL: WORKERS_CI_COMMIT_SHA ${gitFacts.ciHead} does not match ` +
				`the checked-out HEAD ${gitFacts.head}. Check out the commit being attested and retry.`,
		);
		return 2;
	}

	if (gitFacts.dirty && !options.allowDirty) {
		console.error(
			'[artifact-attestation] FAIL: tracked files are modified. An attestation from a dirty ' +
				'tree does not describe a commit. Commit/stash the change, or pass --allow-dirty for a ' +
				'local observation (never for CI).',
		);
		return 1;
	}

	const manifest = buildManifest({
		artifactDir,
		root: REPO_ROOT,
		sourceCommit: gitFacts.head,
		sourceBranch: options.branch ?? gitFacts.branch,
		treeState: gitFacts.dirty ? 'dirty' : 'clean',
		buildUuid: options.buildUuid ?? process.env.WORKERS_CI_BUILD_UUID ?? null,
		deployId: options.deployId,
	});
	const version = readDependencyFacts({ root: REPO_ROOT }).project.version;
	const outPath = resolve(REPO_ROOT, options.out ?? manifestPathFor(version));
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, serializeManifest(manifest));

	const result = verifyManifest({
		manifest,
		artifactDir,
		root: REPO_ROOT,
		expectedSourceCommit: gitFacts.head,
		requireClean: !options.allowDirty,
		treeState: gitFacts.dirty ? 'dirty' : 'clean',
	});
	printResult(result, { manifestPath: outPath, json: options.json });
	return result.status === 'PASS' ? 0 : 1;
}

try {
	process.exitCode = main();
} catch (error) {
	console.error(`[artifact-attestation] ${error?.message ?? error}`);
	process.exitCode = 2;
}
