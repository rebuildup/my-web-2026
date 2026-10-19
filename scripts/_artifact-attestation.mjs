/**
 * Artifact attestation core (Issue #476).
 *
 * One manifest ties a built deployment artifact to the source commit,
 * the dependency set and (when available) the Cloudflare build /
 * deploy identity that produced it.
 *
 * What this module deliberately is NOT
 * ------------------------------------
 * It is an **integrity record**, not a signature. No signing key is
 * configured in this repository, so the manifest carries
 * `signature: { status: "unsigned", ... }` and verification rejects any
 * document that claims a signature without one. Rendering an empty
 * signature block as if it proved authorship would be worse than
 * rendering nothing, so "unsigned" is stated explicitly and every
 * signature field is `null`.
 *
 * The Cloudflare deploy id is recorded only when the caller supplies
 * it. This module never calls the Cloudflare API, never reads a
 * credential, and never contacts a production host: a status-only
 * record must stay reproducible in CI and safe to paste into a PR.
 *
 * The manifest also states which bytes it covers. It hashes the
 * artifact directory it is given — in CI the GitHub Actions
 * production-mode Build Output — and records
 * `coverage.deployed_bytes_attested: false` because the bytes
 * Cloudflare Workers Builds deploys are not compared here. That
 * limitation is a recorded owner decision (2026-10-19): the attested
 * scope of Issue #476 is this CI production-mode Build Output, so the
 * limitation is a field of the document rather than a paragraph
 * someone may skip.
 *
 * Determinism
 * -----------
 * The manifest carries no timestamp. The same artifact bytes, source
 * commit and dependency inputs always produce the same document, which
 * is what makes "compare the release manifest with the artifact you
 * hold" a meaningful check instead of a diff of build noise.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKER_NAME } from './_cloudflare-identity.mjs';
import {
	collectLockPackages,
	collectPackageManager,
	parseYamlDocuments,
} from './generate-sbom.mjs';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Manifest schema identity. A change to the shape must bump this. */
export const SCHEMA = 'my-web-2026/artifact-attestation/v1';
export const DIGEST_ALGORITHM = 'sha-256';
export const MANIFEST_FILE_NAME = 'artifact-attestation.json';
export const DEFAULT_ARTIFACT_DIR = '.cloudflare/output/v0';
export const DEFAULT_MANIFEST_ROOT = 'release-assets/supply-chain';
export const REPOSITORY_URL = 'https://github.com/rebuildup/my-web-2026';
export const LOCKFILE_PATH = 'pnpm-lock.yaml';

/** The only signature state this repository can honestly produce. */
export const UNSIGNED_SIGNATURE = Object.freeze({
	status: 'unsigned',
	algorithm: null,
	key_id: null,
	value: null,
});

/**
 * Which bytes a manifest produced by this tool covers.
 *
 * The generator can only hash the artifact directory it is pointed at —
 * in CI, the GitHub Actions production-mode Build Output. It cannot hash
 * what Cloudflare Workers Builds builds and deploys, so the manifest
 * says so itself: the coverage travels with the published document, and
 * a `PASS` line can never be read as "the deployed bytes are attested".
 * Verification fails closed on a manifest claiming coverage this tool
 * cannot back, exactly as it does for an unverifiable signature.
 */
export const ARTIFACT_ORIGIN = 'github-actions-production-build-output';
export const UNATTESTED_DEPLOYED_BYTES = Object.freeze({
	artifact_origin: ARTIFACT_ORIGIN,
	deployed_bytes_attested: false,
});

const COMMIT_RE = /^[0-9a-f]{40}$/;

/**
 * Release tags are `v<package.json#version>` (`gh release create
 * v<version>`, skills/github-delivery/SKILL.md). The version is read
 * out of the tag name rather than guessed, so a tag that names another
 * release can never be used to vouch for this manifest.
 */
const RELEASE_TAG_RE = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * The release version a tag name declares, or null when the name is not
 * a `v<version>` release tag. Null is a hard input error at the CLI: an
 * unrecognised tag must not silently skip the comparison.
 */
export function releaseTagVersion(name) {
	const match = RELEASE_TAG_RE.exec(String(name ?? ''));
	return match ? match[1] : null;
}

export class AttestationError extends Error {}

export function sha256Bytes(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Text(text) {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

function compareCodeUnits(a, b) {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

function sortedObject(value) {
	const out = {};
	for (const key of Object.keys(value ?? {}).sort(compareCodeUnits)) out[key] = value[key];
	return out;
}

/**
 * Walk the artifact once, recording every regular file.
 *
 * Paths are relative and `/`-separated, so a manifest generated on CI
 * (Linux) and verified on a laptop (macOS) describes the same bytes.
 * A symlink is rejected: recording only its target would leave the
 * bytes reachable through the link unhashed, and following it could
 * hash a file outside the artifact and claim it was shipped. A Build
 * Output is expected to contain regular files only.
 */
export function collectArtifactFiles(dir) {
	if (!existsSync(dir)) {
		throw new AttestationError(`artifact directory does not exist: ${dir}`);
	}
	if (!statSync(dir).isDirectory()) {
		throw new AttestationError(`artifact path is not a directory: ${dir}`);
	}

	const files = [];
	const walk = (current) => {
		const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
			compareCodeUnits(a.name, b.name),
		);
		for (const entry of entries) {
			const full = join(current, entry.name);
			const rel = relative(dir, full).split('\\').join('/');
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isSymbolicLink()) {
				throw new AttestationError(
					`artifact contains a symlink (${rel}); record a regular file so the reachable bytes are hashed`,
				);
			} else if (entry.isFile()) {
				const bytes = readFileSync(full);
				files.push({
					path: rel,
					kind: 'file',
					bytes: bytes.byteLength,
					sha256: sha256Bytes(bytes),
				});
			} else {
				throw new AttestationError(`unsupported artifact entry: ${full}`);
			}
		}
	};
	walk(dir);
	return files.sort((a, b) => compareCodeUnits(a.path, b.path));
}

const SHA256_RE = /^[0-9a-f]{64}$/;

/** A manifest per-file entry must have the shape the generator emits. */
export function isArtifactFileRecord(file) {
	return (
		Boolean(file) &&
		typeof file === 'object' &&
		typeof file.path === 'string' &&
		file.path.length > 0 &&
		// Only regular files are accepted, because only regular files are
		// generated: a manifest entry the generator can never emit is an
		// unverifiable claim about bytes it never hashed.
		file.kind === 'file' &&
		Number.isInteger(file.bytes) &&
		file.bytes >= 0 &&
		typeof file.sha256 === 'string' &&
		SHA256_RE.test(file.sha256)
	);
}

/** Aggregate digest over the canonical per-file record. */
export function digestFromFiles(files) {
	if (!Array.isArray(files) || !files.every(isArtifactFileRecord)) {
		throw new AttestationError('per-file record contains an invalid entry');
	}
	const canonical = files
		.map((file) => `${file.kind}\t${file.path}\t${file.bytes}\t${file.sha256}`)
		.join('\n');
	return sha256Text(canonical);
}

/** Aggregate digest over the canonical per-file record. */
export function artifactDigest({ dir }) {
	const files = collectArtifactFiles(dir);
	const digest = digestFromFiles(files);
	const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
	return { files, file_count: files.length, total_bytes: totalBytes, digest };
}

/**
 * Dependency facts as they exist in the working tree: the declared
 * ranges in `package.json`, the resolved package count from the
 * lockfile, and the lockfile digest itself.
 */
export function readDependencyFacts({ root = REPO_ROOT } = {}) {
	const packageJsonPath = join(root, 'package.json');
	const lockfilePath = join(root, LOCKFILE_PATH);
	let pkg;
	let lockfileText;
	try {
		pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	} catch (error) {
		throw new AttestationError(`cannot read package.json: ${error.message}`);
	}
	try {
		lockfileText = readFileSync(lockfilePath, 'utf8');
	} catch (error) {
		throw new AttestationError(`cannot read ${LOCKFILE_PATH}: ${error.message}`);
	}

	let packages;
	let lockPackageManager;
	try {
		const documents = parseYamlDocuments(lockfileText);
		packages = collectLockPackages(documents).size;
		lockPackageManager = collectPackageManager(documents);
	} catch (error) {
		throw new AttestationError(`cannot parse ${LOCKFILE_PATH}: ${error.message}`);
	}

	return {
		project: {
			name: pkg.name,
			version: pkg.version,
		},
		package_manager: pkg.packageManager ?? lockPackageManager ?? null,
		lockfile: {
			path: LOCKFILE_PATH,
			sha256: sha256Text(lockfileText),
			packages,
		},
		declared: {
			dependencies: sortedObject(pkg.dependencies),
			devDependencies: sortedObject(pkg.devDependencies),
			optionalDependencies: sortedObject(pkg.optionalDependencies),
		},
	};
}

/** Manifest location for a release version. */
export function manifestPathFor(version, { root = REPO_ROOT } = {}) {
	if (typeof version !== 'string' || version.length === 0) {
		throw new AttestationError('a project version is required to name the manifest');
	}
	return join(root, DEFAULT_MANIFEST_ROOT, version, MANIFEST_FILE_NAME);
}

function assertCommit(commit) {
	if (typeof commit !== 'string' || !COMMIT_RE.test(commit)) {
		throw new AttestationError(
			`source commit must be a 40-character lowercase git SHA, got ${JSON.stringify(commit)}`,
		);
	}
}

/**
 * Build the manifest. Pure with respect to git and Cloudflare: the
 * caller supplies the observed source and deploy identity, so tests and
 * the verification report never need a particular repository state.
 */
export function buildManifest({
	artifactDir,
	artifactRoot = null,
	root = REPO_ROOT,
	sourceCommit,
	sourceBranch = null,
	treeState = 'clean',
	buildUuid = null,
	deployId = null,
} = {}) {
	assertCommit(sourceCommit);
	if (!['clean', 'dirty'].includes(treeState)) {
		throw new AttestationError(`treeState must be "clean" or "dirty"`);
	}
	const facts = readDependencyFacts({ root });
	const artifact = artifactDigest({ dir: artifactDir });
	const subjectRoot = artifactRoot ?? (relative(root, artifactDir).split('\\').join('/') || '.');

	return {
		schema: SCHEMA,
		project: facts.project,
		source: {
			repository: REPOSITORY_URL,
			commit: sourceCommit,
			branch: sourceBranch,
			tree: treeState,
		},
		dependencies: {
			package_manager: facts.package_manager,
			lockfile: facts.lockfile,
			declared: facts.declared,
		},
		subject: {
			kind: 'cloudflare-build-output',
			root: subjectRoot,
			digest: { algorithm: DIGEST_ALGORITHM, value: artifact.digest },
			file_count: artifact.file_count,
			total_bytes: artifact.total_bytes,
			files: artifact.files,
		},
		cloudflare: {
			provider: 'cloudflare-workers-builds',
			worker: WORKER_NAME,
			build_uuid: buildUuid,
			// This is a *record*, not an authenticated fact. It is null
			// unless the caller obtained it through an authorized path.
			deploy_id: deployId,
		},
		coverage: { ...UNATTESTED_DEPLOYED_BYTES },
		signature: { ...UNSIGNED_SIGNATURE },
	};
}

export function serializeManifest(manifest) {
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

function sameJson(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}

function finding(code, message, remedy) {
	return { code, message, remedy };
}

/**
 * Verify a manifest against the artifact and dependency facts on disk.
 *
 * `expectedSourceCommit` is never taken from the manifest itself: doing
 * so would make "the release commit matches the artifact" a tautology.
 * The caller supplies the commit it expects (a git HEAD, a release tag
 * target, or `WORKERS_CI_COMMIT_SHA`).
 */
export function verifyManifest({
	manifest,
	artifactDir,
	root = REPO_ROOT,
	expectedSourceCommit,
	requireClean = true,
	treeState = 'clean',
	releaseTag = null,
} = {}) {
	const findings = [];
	const checks = [];

	const pass = (id, detail) => checks.push({ id, status: 'PASS', detail });
	const fail = (id, detail, code, remedy) => {
		checks.push({ id, status: 'FAIL', detail });
		findings.push(finding(code, detail, remedy));
	};

	if (!manifest || typeof manifest !== 'object') {
		return {
			status: 'FAIL',
			checks,
			findings: [
				finding(
					'MANIFEST_UNREADABLE',
					'manifest is not a JSON object',
					'Regenerate it with the artifact-attestation generator.',
				),
			],
		};
	}

	if (manifest.schema !== SCHEMA) {
		fail(
			'Schema',
			`manifest schema is ${JSON.stringify(manifest.schema)}, expected ${SCHEMA}`,
			'SCHEMA_UNSUPPORTED',
			'Regenerate the manifest with this repository version of the tool.',
		);
	} else {
		pass('Schema', SCHEMA);
	}

	const facts = readDependencyFacts({ root });
	const artifact = artifactDigest({ dir: artifactDir });

	if (artifact.file_count === 0) {
		fail(
			'Artifact present',
			'the artifact directory contains no files',
			'ARTIFACT_EMPTY',
			'Build the deployment artifact before attesting. An empty subject proves nothing.',
		);
	}

	const digestOk =
		manifest.subject?.digest?.algorithm === DIGEST_ALGORITHM &&
		manifest.subject?.digest?.value === artifact.digest &&
		manifest.subject?.file_count === artifact.file_count &&
		manifest.subject?.total_bytes === artifact.total_bytes;

	if (manifest.subject?.digest?.algorithm !== DIGEST_ALGORITHM) {
		fail(
			'Digest algorithm',
			`manifest algorithm is ${JSON.stringify(manifest.subject?.digest?.algorithm)}`,
			'DIGEST_ALGORITHM_UNSUPPORTED',
			'Only sha-256 manifests are accepted. Regenerate with the current tool.',
		);
	} else if (manifest.subject?.digest?.value !== artifact.digest) {
		fail(
			'Artifact digest',
			`artifact is ${artifact.digest}, manifest records ${manifest.subject?.digest?.value}`,
			'ARTIFACT_DIGEST_MISMATCH',
			'The bytes do not belong to the recorded build. Rebuild from the recorded source; never deploy or publish the drifted artifact.',
		);
	} else if (
		manifest.subject?.file_count !== artifact.file_count ||
		manifest.subject?.total_bytes !== artifact.total_bytes
	) {
		fail(
			'Artifact shape',
			`artifact has ${artifact.file_count} file(s) / ${artifact.total_bytes} bytes, manifest records ${manifest.subject?.file_count} / ${manifest.subject?.total_bytes}`,
			'ARTIFACT_SHAPE_MISMATCH',
			'The file set changed even though the aggregate digest matched — regenerate the manifest.',
		);
	}

	const manifestFiles = manifest.subject?.files;
	const filesShapeValid = Array.isArray(manifestFiles) && manifestFiles.every(isArtifactFileRecord);
	if (!filesShapeValid || manifestFiles.length !== artifact.file_count) {
		fail(
			'Manifest file list',
			`manifest carries ${Array.isArray(manifestFiles) ? manifestFiles.length : 'no'} file record(s), artifact has ${artifact.file_count}`,
			'MANIFEST_FILES_INVALID',
			'Regenerate the manifest so its per-file record matches the artifact it describes.',
		);
	} else {
		const declaredFileDigest = digestFromFiles(manifestFiles);
		if (declaredFileDigest !== manifest.subject?.digest?.value) {
			fail(
				'Manifest file list',
				'per-file record does not hash to the manifest aggregate digest',
				'MANIFEST_FILE_DIGEST_MISMATCH',
				'The document was edited after generation. Regenerate it instead of hand-editing.',
			);
		} else {
			pass('Manifest file list', `${manifestFiles.length} file record(s) agree with the aggregate`);
		}
	}

	if (typeof expectedSourceCommit !== 'string' || !COMMIT_RE.test(expectedSourceCommit)) {
		throw new AttestationError(
			'verifyManifest requires an explicit 40-character expectedSourceCommit',
		);
	}
	if (manifest.source?.commit !== expectedSourceCommit) {
		fail(
			'Source commit',
			`manifest records ${manifest.source?.commit}, expected ${expectedSourceCommit}`,
			'SOURCE_COMMIT_MISMATCH',
			'The artifact was not built from the release / workflow commit. Stop the release, check out the recorded commit and rebuild.',
		);
	} else {
		pass('Source commit', expectedSourceCommit);
	}

	// The release tag is the second half of "this artifact is the one
	// the release names": `source.commit` alone only proves the manifest
	// describes *some* commit. Both facts are checked, and a tag that
	// disagrees fails the gate instead of downgrading the claim.
	if (releaseTag) {
		const { name, commit, version } = releaseTag;
		if (manifest.source?.commit !== commit) {
			fail(
				'Release tag',
				`release tag ${name} points at ${commit}, manifest records ${manifest.source?.commit}`,
				'RELEASE_TAG_COMMIT_MISMATCH',
				'The published release names a different commit than the manifest was built from. Do not attach this manifest to that release; rebuild at the tagged commit.',
			);
		} else {
			pass('Release tag', `${name} -> ${commit}`);
		}
		if (manifest.project?.version !== version) {
			fail(
				'Release tag version',
				`release tag ${name} names version ${version}, manifest records ${manifest.project?.version}`,
				'RELEASE_TAG_VERSION_MISMATCH',
				'The manifest belongs to another release version. Regenerate it from the tagged commit.',
			);
		} else {
			pass('Release tag version', `${name} declares ${version}`);
		}
	}

	if (requireClean && manifest.source?.tree !== 'clean') {
		fail(
			'Source tree',
			`manifest records tree state ${JSON.stringify(manifest.source?.tree)}`,
			'SOURCE_TREE_DIRTY',
			'An attestation from a dirty tree does not describe a commit. Commit the source and rebuild.',
		);
	} else {
		pass(
			'Source tree',
			requireClean ? 'clean' : `${manifest.source?.tree ?? 'unknown'} (not enforced)`,
		);
	}

	if (treeState === 'dirty' && requireClean) {
		fail(
			'Working tree',
			'tracked files are modified; the artifact cannot be attributed to HEAD',
			'WORKTREE_DIRTY',
			'Commit or stash the change, then rebuild and regenerate the manifest.',
		);
	}

	if (manifest.project?.version !== facts.project.version) {
		fail(
			'Project version',
			`manifest records ${manifest.project?.version}, package.json is ${facts.project.version}`,
			'PROJECT_VERSION_MISMATCH',
			'A manifest from another release version cannot attest this tree. Regenerate it at the release commit.',
		);
	} else if (manifest.project?.name !== facts.project.name) {
		fail(
			'Project identity',
			`manifest records ${manifest.project?.name}, package.json is ${facts.project.name}`,
			'PROJECT_IDENTITY_MISMATCH',
			'Regenerate the manifest from this repository.',
		);
	} else {
		pass('Project', `${facts.project.name}@${facts.project.version}`);
	}

	if (manifest.dependencies?.lockfile?.sha256 !== facts.lockfile.sha256) {
		fail(
			'Lockfile digest',
			`manifest records ${manifest.dependencies?.lockfile?.sha256}, current ${LOCKFILE_PATH} is ${facts.lockfile.sha256}`,
			'LOCKFILE_DIGEST_MISMATCH',
			'The resolved dependency set differs from the recorded one. Restore the lockfile or regenerate and re-review the manifest.',
		);
	} else if (manifest.dependencies?.lockfile?.packages !== facts.lockfile.packages) {
		fail(
			'Lockfile inventory',
			`manifest records ${manifest.dependencies?.lockfile?.packages} package(s), lockfile resolves ${facts.lockfile.packages}`,
			'LOCKFILE_INVENTORY_MISMATCH',
			'Regenerate the manifest from the current lockfile.',
		);
	} else {
		pass(
			'Lockfile digest',
			`${facts.lockfile.sha256} (${facts.lockfile.packages} resolved package version(s))`,
		);
	}

	if (!sameJson(manifest.dependencies?.declared, facts.declared)) {
		fail(
			'Declared dependencies',
			'package.json dependency ranges differ from the manifest',
			'DECLARED_DEPENDENCIES_MISMATCH',
			'Regenerate the manifest from the release commit; a dependency-range change is a different build input.',
		);
	} else {
		pass('Declared dependencies', 'package.json dependency ranges agree');
	}

	if (manifest.dependencies?.package_manager !== facts.package_manager) {
		fail(
			'Package manager',
			`manifest records ${JSON.stringify(manifest.dependencies?.package_manager)}, package.json declares ${JSON.stringify(facts.package_manager)}`,
			'PACKAGE_MANAGER_MISMATCH',
			'Regenerate the manifest; the build toolchain is part of the attested input.',
		);
	} else {
		pass('Package manager', facts.package_manager ?? '(not declared)');
	}

	if (manifest.cloudflare?.worker !== WORKER_NAME) {
		fail(
			'Worker identity',
			`manifest records worker ${JSON.stringify(manifest.cloudflare?.worker)}, expected ${WORKER_NAME}`,
			'WORKER_IDENTITY_MISMATCH',
			'Regenerate the manifest from this repository; it does not describe this Worker.',
		);
	} else {
		pass('Worker identity', WORKER_NAME);
	}

	// The manifest states its own scope, so the published document
	// carries the limitation instead of leaving it to a reader's memory.
	const coverage = manifest.coverage;
	if (coverage == null || typeof coverage !== 'object') {
		fail(
			'Attested scope',
			'manifest does not state which bytes it attests',
			'COVERAGE_UNDECLARED',
			'Regenerate the manifest with the current tool. A document that does not state its own scope cannot be read as an attestation of anything in particular.',
		);
	} else if (
		coverage.artifact_origin !== ARTIFACT_ORIGIN ||
		coverage.deployed_bytes_attested !== false
	) {
		fail(
			'Attested scope',
			`manifest claims artifact_origin ${JSON.stringify(coverage.artifact_origin)} with deployed_bytes_attested ${JSON.stringify(coverage.deployed_bytes_attested)}`,
			'COVERAGE_UNSUPPORTED',
			'This tool hashes the artifact it is given (the GitHub Actions production-mode Build Output) and cannot attest the bytes Cloudflare Workers Builds deploys. Accept such a manifest only from a tool that can back the claim.',
		);
	} else {
		pass('Attested scope', `${ARTIFACT_ORIGIN} hashed; Cloudflare-deployed bytes NOT attested`);
	}

	const signature = manifest.signature;
	if (signature?.status !== 'unsigned') {
		fail(
			'Signature',
			`manifest claims signature status ${JSON.stringify(signature?.status)}; this repository has no signing key and cannot verify it`,
			'SIGNATURE_UNSUPPORTED',
			'Do not display or accept a signature this repository cannot produce. Regenerate an unsigned manifest, or add a real signing authority first.',
		);
	} else if (
		signature.algorithm !== null ||
		signature.key_id !== null ||
		signature.value !== null
	) {
		fail(
			'Signature',
			'manifest says "unsigned" but carries signature fields',
			'SIGNATURE_INCONSISTENT',
			'Clear the signature fields. An honest unsigned manifest is acceptable; a fabricated signature is not.',
		);
	} else {
		pass('Signature', 'unsigned (no signature claimed)');
	}

	let cloudflareIdOk = true;
	for (const key of ['build_uuid', 'deploy_id']) {
		const value = manifest.cloudflare?.[key];
		if (value !== null && (typeof value !== 'string' || value.length === 0)) {
			cloudflareIdOk = false;
			fail(
				'Cloudflare identity',
				`cloudflare.${key} must be a non-empty string or null`,
				'CLOUDFLARE_IDENTITY_INVALID',
				'Record only an id you actually obtained; leave it null otherwise.',
			);
		}
	}
	if (cloudflareIdOk) {
		pass('Cloudflare deploy id', manifest.cloudflare?.deploy_id ?? 'not provided (no id invented)');
	}

	if (digestOk) {
		pass(
			'Artifact digest',
			`${DIGEST_ALGORITHM}:${artifact.digest} (${artifact.file_count} file(s), ${artifact.total_bytes} bytes)`,
		);
	}

	return {
		status: findings.length === 0 ? 'PASS' : 'FAIL',
		checks,
		findings,
		summary: {
			source_commit: manifest.source?.commit ?? null,
			project_version: manifest.project?.version ?? null,
			release_tag: releaseTag?.name ?? null,
			release_tag_commit: releaseTag?.commit ?? null,
			artifact_digest: artifact.digest,
			artifact_files: artifact.file_count,
			artifact_bytes: artifact.total_bytes,
			lockfile_sha256: facts.lockfile.sha256,
			lockfile_packages: facts.lockfile.packages,
			signature_status: signature?.status ?? null,
			deploy_id: manifest.cloudflare?.deploy_id ?? null,
			artifact_origin: manifest.coverage?.artifact_origin ?? null,
			deployed_bytes_attested: manifest.coverage?.deployed_bytes_attested ?? null,
		},
	};
}

/** Human-readable, status-only verification output. */
export function formatVerification(result, { manifestPath = null } = {}) {
	const lines = [];
	if (manifestPath) lines.push(`manifest  ${manifestPath}`);
	for (const check of result.checks) {
		lines.push(`${check.status === 'PASS' ? 'PASS' : 'FAIL'}  ${check.id}: ${check.detail}`);
	}
	for (const item of result.findings) {
		lines.push(`\n${item.code}: ${item.message}`);
		lines.push(`  remedy: ${item.remedy}`);
	}
	lines.push(`\nstatus: ${result.status}`);
	return lines.join('\n');
}
