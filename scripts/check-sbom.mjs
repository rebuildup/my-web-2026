#!/usr/bin/env node
/**
 * SBOM drift gate (Issue #471 — supply chain).
 *
 * This gate turns the Issue's completion criteria into a mechanical
 * check instead of a promise:
 *
 *   1. the SBOM's npm inventory is **exactly** the `name@version` set
 *      the current `pnpm-lock.yaml` resolves to — no missing package,
 *      no extra package;
 *   2. every declared SHA-512 equals the lockfile integrity for that
 *      `name@version`, and every purl / bom-ref agrees with the name
 *      and version it claims to describe;
 *   3. the Tool Registry components agree with `src/tools/manifest.json`
 *      (slug, pinned SHA, declared license, canonical repo);
 *   4. every `dependencies[].ref` / `dependsOn` entry resolves to a
 *      component in the same document (no dangling graph edges);
 *   5. the document contains **no secret**. Proven twice: structurally
 *      (every string traces to the tracked files recorded in
 *      `metadata.properties#my-web-2026:source-digests`, whose digest
 *      *values* are compared against the files on disk) and by a
 *      denylist scan for high-signal credential shapes plus every
 *      runtime-secret *name* in the repository's secret contract;
 *   6. every component only carries properties the CycloneDX 1.6
 *      schema defines (see `CYCLONEDX_COMPONENT_PROPERTIES`), so a
 *      self-consistent but non-conformant document still fails closed.
 *
 * Secret posture (AGENTS.md section 4)
 * ------------------------------------
 * The secret names come from `scripts/_cloudflare-contract.mjs`, the
 * one module that owns them (`cloudflare.config.ts` derives the
 * Worker's binding names from the same array). This script consumes
 * names only: it never resolves a secret *value* — no Infisical call,
 * no Wrangler secret invocation, no `.dev.vars`, no environment dump,
 * and no deployment-config read. The scan reports the offending token
 * inside the document under inspection, which is a public artifact
 * anyway; there is no code path that could obtain a real value.
 *
 * Usage:
 *   node scripts/check-sbom.mjs                 # generate in memory, then check
 *   node scripts/check-sbom.mjs --bom=<path>    # check a specific document
 *   node scripts/check-sbom.mjs --release-artifact
 *
 * `--release-artifact` additionally compares the staged
 * `release-assets/supply-chain/<version>/sbom.cdx.json` against a
 * freshly generated document (ignoring `serialNumber` and
 * `metadata.timestamp`, which are build-time identity, not content).
 *
 * Exit codes: 0 = consistent, 1 = drift / violation, 2 = bad input.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIT_ONLY_SECRETS, REQUIRED_RUNTIME_SECRETS } from './_cloudflare-contract.mjs';
import {
	BOM_FORMAT,
	SBOM_FILE_NAME,
	SPEC_VERSION,
	collectLockPackages,
	collectPatchedDependencies,
	generateSbom,
	identityKey,
	integrityToCycloneDxHash,
	npmPurl,
	packageIdentityFromLockKey,
	parseYamlDocuments,
	sbomDirFor,
	serializeSbom,
	sha256Hex,
} from './generate-sbom.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..');

/**
 * Secret names the SBOM must never mention, taken from the
 * repository's single secret-name contract. Audit-only names are
 * included too: they are retained as a recovery trail and are just as
 * wrong to print in a public artifact as the uploaded ones.
 */
export const SECRET_NAMES = Object.freeze([...REQUIRED_RUNTIME_SECRETS, ...AUDIT_ONLY_SECRETS]);

/** Where those names come from, for failure messages and docs. */
export const SECRET_NAME_SOURCE = 'scripts/_cloudflare-contract.mjs';

/**
 * Credential shapes that cannot legitimately appear in a package
 * inventory. Integrity digests are carried as hex (not base64) and
 * registry URLs are the only URLs present, so these have no false
 * positives against a real document.
 */
export const SECRET_VALUE_PATTERNS = Object.freeze([
	{ label: 'PEM private key', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
	{ label: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{ label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
	{ label: 'GitHub fine-grained PAT', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
	{ label: 'OpenAI-style secret key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
	{ label: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
	{
		label: 'JSON Web Token',
		pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
	},
	{
		label: 'inline credential assignment',
		pattern: /"(?:api[_-]?key|secret|token|password|passwd)"\s*:\s*"[^"]{16,}"/i,
	},
]);

/**
 * Property names `definitions.component` accepts in the CycloneDX
 * {@link SPEC_VERSION} schema, which also sets
 * `additionalProperties: false`.
 *
 * The gate deliberately does not vendor the full published JSON Schema
 * (that is a separate open decision, recorded in
 * `docs/runbook/sbom.md` section 8), but the defect a vendored schema
 * would have caught is cheap to prevent: emitting a field the format
 * does not define makes the **whole** document invalid for every
 * schema-conformant consumer while every consistency check here still
 * passes. Keep this list in step with `SPEC_VERSION`.
 */
export const CYCLONEDX_COMPONENT_PROPERTIES = Object.freeze([
	'$comment',
	'author',
	'authors',
	'bom-ref',
	'components',
	'copyright',
	'cpe',
	'cryptoProperties',
	'data',
	'description',
	'evidence',
	'externalReferences',
	'group',
	'hashes',
	'licenses',
	'manufacturer',
	'mime-type',
	'modelCard',
	'modified',
	'name',
	'omniborId',
	'pedigree',
	'properties',
	'publisher',
	'purl',
	'releaseNotes',
	'scope',
	'signature',
	'supplier',
	'swhid',
	'swid',
	'tags',
	'type',
	'version',
]);

/**
 * Report every component in the document that either carries a field
 * the format does not define (`additionalProperties: false`, so one
 * unknown key invalidates the whole document for a schema-conformant
 * consumer) or omits a required one. Never throws: a malformed
 * document is a finding, not an exception.
 */
export function componentSchemaFindings(bom) {
	const findings = [];
	const subjects = [];
	if (bom?.metadata?.component) subjects.push(['metadata.component', bom.metadata.component]);
	const metadataTools = bom?.metadata?.tools?.components;
	if (Array.isArray(metadataTools)) {
		metadataTools.forEach((c, i) => subjects.push([`metadata.tools.components[${i}]`, c]));
	}
	if (Array.isArray(bom?.components)) {
		bom.components.forEach((c, i) => subjects.push([`components[${i}]`, c]));
	}
	for (const [where, component] of subjects) {
		if (component === null || typeof component !== 'object') continue;
		for (const key of Object.keys(component)) {
			if (!CYCLONEDX_COMPONENT_PROPERTIES.includes(key)) {
				findings.push(`${where}: "${key}" is not a CycloneDX ${SPEC_VERSION} component property`);
			}
		}
		for (const key of ['type', 'name']) {
			if (component[key] === undefined) {
				findings.push(`${where}: required CycloneDX ${SPEC_VERSION} property "${key}" is missing`);
			}
		}
	}
	return findings;
}

/**
 * Find secret-shaped content in the serialized document.
 *
 * `secretNames` covers the *names* this repository declares as runtime
 * secrets; `patterns` covers credential *values*. Both are reported as
 * `{ kind, detail }` so a failure message names the problem without
 * ever needing to print a real value.
 */
export function findSecretLikeFindings(
	text,
	{ secretNames = SECRET_NAMES, patterns = SECRET_VALUE_PATTERNS } = {},
) {
	const findings = [];
	for (const name of secretNames) {
		if (text.includes(name)) {
			findings.push({
				kind: 'runtime-secret-name',
				detail: `the runtime secret name "${name}" (${SECRET_NAME_SOURCE}) appears in the SBOM; the inventory describes software, never credentials`,
			});
		}
	}
	for (const { label, pattern } of patterns) {
		const match = pattern.exec(text);
		if (match) {
			findings.push({
				kind: 'secret-value-shape',
				// The matched text is from the SBOM under inspection, not
				// from an environment. It is reported so the finding is
				// actionable, and the SBOM is a public artifact anyway.
				detail: `content matching ${label} appears in the SBOM: ${JSON.stringify(match[0].slice(0, 40))}`,
			});
		}
	}
	return findings;
}

/** Drop the two build-identity fields so two builds can be compared. */
export function canonicalComparable(bom) {
	const clone = structuredClone(bom);
	clone.serialNumber = undefined;
	if (clone.metadata) clone.metadata.timestamp = undefined;
	return clone;
}

function purlParts(purl) {
	const match = /^pkg:npm\/(.+)@([^@]+)$/.exec(purl ?? '');
	if (!match) return null;
	return { name: match[1], version: match[2] };
}

/**
 * Compare one SBOM document against the current repository inputs.
 * Returns `{ ok, errors }`; never throws on drift.
 */
export function checkSbom({
	bom,
	packageJsonText,
	lockfileText,
	workspaceText,
	toolsManifestText,
}) {
	const errors = [];
	const packageJson = JSON.parse(packageJsonText);
	const toolsManifest = JSON.parse(toolsManifestText);

	if (bom?.bomFormat !== BOM_FORMAT) {
		errors.push(`bomFormat: expected "${BOM_FORMAT}", got ${JSON.stringify(bom?.bomFormat)}`);
	}
	if (bom?.specVersion !== SPEC_VERSION) {
		errors.push(`specVersion: expected "${SPEC_VERSION}", got ${JSON.stringify(bom?.specVersion)}`);
	}
	if (!/^urn:uuid:[0-9a-f-]{36}$/.test(bom?.serialNumber ?? '')) {
		errors.push(
			`serialNumber: expected a urn:uuid value, got ${JSON.stringify(bom?.serialNumber)}`,
		);
	}
	if (Number.isNaN(Date.parse(bom?.metadata?.timestamp ?? ''))) {
		errors.push(
			`metadata.timestamp: not an ISO-8601 timestamp, got ${JSON.stringify(bom?.metadata?.timestamp)}`,
		);
	}
	if (bom?.metadata?.component?.version !== packageJson.version) {
		errors.push(
			`metadata.component.version: SBOM says ${JSON.stringify(bom?.metadata?.component?.version)}, package.json says ${packageJson.version}`,
		);
	}

	const documents = parseYamlDocuments(lockfileText);
	const lockPackages = collectLockPackages(documents);
	const patchedKeys = collectPatchedDependencies(documents, workspaceText);
	const components = Array.isArray(bom?.components) ? bom.components : [];
	const npmComponents = components.filter((c) => c.purl?.startsWith('pkg:npm/'));
	const toolComponents = components.filter((c) =>
		c.purl?.startsWith('pkg:generic/my-web-2026-tool/'),
	);

	// 1 + 2. npm inventory equality, per component.
	const seen = new Set();
	for (const component of npmComponents) {
		const parts = purlParts(component.purl);
		if (parts === null) {
			errors.push(`${component.purl}: purl is not pkg:npm/<name>@<version>`);
			continue;
		}
		if (parts.name !== component.name || parts.version !== component.version) {
			errors.push(
				`${component.purl}: purl disagrees with name/version (${component.name}@${component.version})`,
			);
		}
		if (component['bom-ref'] !== component.purl) {
			errors.push(`${component.purl}: bom-ref must equal purl, got ${component['bom-ref']}`);
		}
		const key = identityKey(parts.name, parts.version);
		if (seen.has(key)) {
			errors.push(
				`${key}: duplicate component; the inventory must be deduplicated by name@version`,
			);
			continue;
		}
		seen.add(key);
		const record = lockPackages.get(key);
		if (!record) {
			errors.push(`${key}: present in the SBOM but absent from pnpm-lock.yaml`);
			continue;
		}
		const expected = integrityToCycloneDxHash(record.integrity);
		const declared = Array.isArray(component.hashes) ? component.hashes[0] : undefined;
		if (!expected) {
			if (declared) {
				errors.push(
					`${key}: declares hash ${declared.content?.slice(0, 16)}… but the lockfile records no sha512 integrity`,
				);
			}
		} else if (!declared || declared.alg !== 'SHA-512' || declared.content !== expected.content) {
			errors.push(
				`${key}: SHA-512 does not match the lockfile integrity (expected ${expected.content.slice(0, 16)}…, got ${declared?.content?.slice(0, 16) ?? 'none'})`,
			);
		}
		const isPatched = patchedKeys.has(key);
		const marksPatched = component.properties?.some((p) => p.name === 'my-web-2026:patched');
		if (isPatched && !marksPatched) {
			errors.push(
				`${key}: is patched via pnpm patchedDependencies but the component does not say so`,
			);
		}
	}

	for (const key of lockPackages.keys()) {
		if (!seen.has(key)) {
			errors.push(`${key}: resolved by pnpm-lock.yaml but missing from the SBOM`);
		}
	}

	// 3. Tool Registry components.
	const expectedTools = new Map(
		(toolsManifest.tools ?? []).map((tool) => [
			tool.slug,
			{
				sha: tool.source?.pinned_sha,
				repo: tool.source?.canonical_repo,
				license: tool.license,
			},
		]),
	);
	const seenTools = new Set();
	for (const component of toolComponents) {
		const slug = component.properties?.find((p) => p.name === 'my-web-2026:tool-slug')?.value;
		const expectedTool = expectedTools.get(slug);
		if (!expectedTool) {
			errors.push(`tool "${component.name}": not declared in src/tools/manifest.json`);
			continue;
		}
		seenTools.add(slug);
		if (component.version !== expectedTool.sha) {
			errors.push(
				`tool "${slug}": pinned SHA mismatch (manifest ${expectedTool.sha}, SBOM ${component.version})`,
			);
		}
		const declaredRepo = component.externalReferences?.find((r) => r.type === 'vcs')?.url;
		if (declaredRepo !== expectedTool.repo) {
			errors.push(
				`tool "${slug}": canonical repo mismatch (manifest ${expectedTool.repo}, SBOM ${declaredRepo})`,
			);
		}
		const declaredLicense = component.licenses?.[0]?.license?.name;
		const expectedLicense =
			typeof expectedTool.license === 'string' && expectedTool.license.trim() !== ''
				? expectedTool.license.trim()
				: 'NOASSERTION';
		if (declaredLicense !== expectedLicense) {
			errors.push(
				`tool "${slug}": license mismatch (manifest ${expectedLicense}, SBOM ${declaredLicense})`,
			);
		}
	}
	for (const slug of expectedTools.keys()) {
		if (!seenTools.has(slug)) {
			errors.push(`tool "${slug}": declared in src/tools/manifest.json but missing from the SBOM`);
		}
	}

	// 4. Dependency graph integrity.
	const refs = new Set(components.map((c) => c['bom-ref']));
	const rootRef = bom?.metadata?.component?.['bom-ref'];
	if (rootRef !== npmPurl(packageJson.name, packageJson.version)) {
		errors.push(
			`metadata.component bom-ref: expected ${npmPurl(packageJson.name, packageJson.version)}, got ${rootRef}`,
		);
	}
	for (const entry of Array.isArray(bom?.dependencies) ? bom.dependencies : []) {
		const owner = entry.ref === rootRef ? 'metadata.component' : entry.ref;
		if (entry.ref !== rootRef && !refs.has(entry.ref)) {
			errors.push(`${owner}: dependencies[].ref points at an unknown component`);
		}
		for (const target of entry.dependsOn ?? []) {
			if (!refs.has(target)) {
				errors.push(`${owner}: dependsOn points at an unknown component ${target}`);
			}
		}
	}

	// 5. No secret content.
	const serialized = serializeSbom(bom);
	const findings = findSecretLikeFindings(serialized);
	for (const finding of findings) {
		errors.push(`${finding.kind}: ${finding.detail}`);
	}
	// The recorded provenance must cover every tracked input the
	// generator reads, and must agree with the file on disk — a
	// document that omits the record cannot be audited, and a document
	// whose digests were written by hand cannot be believed.
	const provenance = bom?.metadata?.properties?.find(
		(p) => p.name === 'my-web-2026:source-digests',
	)?.value;
	const recordedDigests = new Map(
		(provenance ?? '')
			.split(/\s+/)
			.filter((token) => token !== '')
			.map((token) => {
				const at = token.indexOf('=');
				return at === -1 ? [token, ''] : [token.slice(0, at), token.slice(at + 1)];
			}),
	);
	for (const [file, text] of [
		['pnpm-lock.yaml', lockfileText],
		['pnpm-workspace.yaml', workspaceText],
		['src/tools/manifest.json', toolsManifestText],
	]) {
		const recorded = recordedDigests.get(file);
		if (recorded === undefined || !recorded.startsWith('sha256:')) {
			errors.push(`metadata.properties: missing input digest for ${file}`);
			continue;
		}
		const actual = `sha256:${sha256Hex(text)}`;
		if (recorded !== actual) {
			errors.push(
				`metadata.properties: recorded digest for ${file} does not match the file on disk ` +
					`(recorded ${recorded.slice(0, 16)}…, actual ${actual.slice(0, 16)}…)`,
			);
		}
	}

	// 6. The document must be describable as CycloneDX 1.6, not merely
	// self-consistent with the lockfile.
	for (const finding of componentSchemaFindings(bom)) {
		errors.push(`component-shape: ${finding}`);
	}

	return { ok: errors.length === 0, errors };
}

/**
 * Check a document that lives on disk.
 *
 * `root` locates the document under test and may be any directory;
 * `inputRoot` locates the repository the document is checked against
 * and defaults to this repository. The two are separate so a staged
 * artifact can be read from a scratch directory without pretending it
 * is the repository root.
 */
export function checkSbomFile({ bomPath, root = repoRoot, inputRoot = repoRoot }) {
	const full = resolve(root, bomPath);
	if (!existsSync(full)) return { ok: false, errors: [`SBOM file not found: ${bomPath}`] };
	let bom;
	try {
		bom = JSON.parse(readFileSync(full, 'utf8'));
	} catch (error) {
		return { ok: false, errors: [`SBOM file is not valid JSON: ${bomPath} (${error.message})`] };
	}
	return checkSbom({ bom, ...readInputs(inputRoot) });
}

/** Read the tracked inputs the gate compares against. */
export function readInputs(root = repoRoot) {
	return {
		packageJsonText: readFileSync(resolve(root, 'package.json'), 'utf8'),
		lockfileText: readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'),
		workspaceText: readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8'),
		toolsManifestText: readFileSync(resolve(root, 'src/tools/manifest.json'), 'utf8'),
	};
}

function parseArg(argv, name) {
	const prefix = `--${name}=`;
	const found = argv.find((value) => value.startsWith(prefix));
	return found ? found.slice(prefix.length) : null;
}

function remedy() {
	return (
		'Remedy: regenerate with `pnpm run sbom:build` (SOURCE_DATE_EPOCH pins a reproducible ' +
		'timestamp). A mismatch means the committed document and the real dependency inventory ' +
		'diverged, which is the exact condition a supply-chain SBOM exists to surface — do not ' +
		'edit the SBOM by hand. See docs/runbook/sbom.md.'
	);
}

function main() {
	const argv = process.argv.slice(2);
	const inputs = readInputs();
	const version = JSON.parse(inputs.packageJsonText).version;
	const documentPath = parseArg(argv, 'bom');

	if (documentPath) {
		const result = checkSbomFile({ bomPath: documentPath });
		if (!result.ok) {
			console.error(`[check-sbom] FAIL: ${documentPath} does not describe this repository.`);
			for (const error of result.errors) console.error(`  - ${error}`);
			console.error(remedy());
			process.exit(1);
		}
		console.log(`[check-sbom] OK: ${documentPath} matches pnpm-lock.yaml and carries no secret.`);
		return;
	}

	const { bom, version: generatedVersion } = generateSbom();
	const result = checkSbom({ bom, ...inputs });
	if (!result.ok) {
		console.error('[check-sbom] FAIL: the generated SBOM is not consistent with this repository.');
		for (const error of result.errors) console.error(`  - ${error}`);
		console.error(remedy());
		process.exit(1);
	}

	// Optional: the staged release artifact, when it exists, must be
	// byte-identical to a fresh generation (modulo build identity).
	const stagedRelative = `${sbomDirFor(generatedVersion)}/${SBOM_FILE_NAME}`;
	const stagedAbsolute = resolve(repoRoot, stagedRelative);
	let stagedNote = `${stagedRelative} not staged (expected before a release cut)`;
	if (existsSync(stagedAbsolute)) {
		let staged;
		try {
			staged = JSON.parse(readFileSync(stagedAbsolute, 'utf8'));
		} catch (error) {
			console.error(
				`[check-sbom] FAIL: staged release artifact is not valid JSON: ${error.message}`,
			);
			console.error(remedy());
			process.exit(1);
		}
		const fresh = canonicalComparable(bom);
		const stagedBody = canonicalComparable(staged);
		if (JSON.stringify(fresh) !== JSON.stringify(stagedBody)) {
			console.error(
				`[check-sbom] FAIL: ${stagedRelative} differs from a freshly generated SBOM (ignoring serialNumber and metadata.timestamp).`,
			);
			console.error(remedy());
			process.exit(1);
		}
		const stagedResult = checkSbom({ bom: staged, ...inputs });
		if (!stagedResult.ok) {
			console.error(`[check-sbom] FAIL: ${stagedRelative} is not consistent with this repository.`);
			for (const error of stagedResult.errors) console.error(`  - ${error}`);
			console.error(remedy());
			process.exit(1);
		}
		stagedNote = `${stagedRelative} matches a fresh generation`;
	}

	console.log(
		`[check-sbom] OK: ${bom.components.length} components match pnpm-lock.yaml (version ${version}), ` +
			`no secret content found; ${stagedNote}.`,
	);
}

// ESM main-module guard: importing this file for testing must not run
// the gate (same pattern as scripts/check-release-assets.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		main();
	} catch (error) {
		console.error(`[check-sbom] FAIL: ${error.message}`);
		process.exit(1);
	}
}
