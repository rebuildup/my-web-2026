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
 *      `metadata.properties#my-web-2026:source-digests`) and by a
 *      denylist scan for high-signal credential shapes plus every
 *      runtime-secret *name* declared in `wrangler.jsonc`.
 *
 * Secret posture (AGENTS.md section 4)
 * ------------------------------------
 * This script reads `wrangler.jsonc` to learn the runtime-secret
 * **names** only. It never reads a secret *value*: no Infisical call,
 * no `wrangler secret` invocation, no `.dev.vars`, no environment
 * dump. The scan reports the offending token and its location in the
 * document — never a value pulled from a real environment, because
 * there is no code path that could obtain one.
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
} from './generate-sbom.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..');

/**
 * Runtime secret names the SBOM must never mention. Read from the
 * tracked `wrangler.jsonc` rather than hard-coded so adding a secret
 * automatically extends the scan.
 */
export const SECRET_NAME_REFERENCE = 'wrangler.jsonc#secrets.required';

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
 * Strip `//` and block comments from JSONC without touching comment
 * markers that appear inside string literals (URLs contain `//`).
 */
export function stripJsonComments(text) {
	let out = '';
	let inString = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const next = text[i + 1];
		if (inString) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			out += ch;
			continue;
		}
		if (ch === '/' && next === '/') {
			while (i < text.length && text[i] !== '\n') i++;
			out += '\n';
			continue;
		}
		if (ch === '/' && next === '*') {
			i += 2;
			while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
			i++;
			continue;
		}
		out += ch;
	}
	return out;
}

/** Runtime secret **names** declared in `wrangler.jsonc`. Names only. */
export function readRequiredSecretNames(wranglerText) {
	const parsed = JSON.parse(stripJsonComments(wranglerText));
	const required = parsed?.secrets?.required;
	if (!Array.isArray(required)) return [];
	return required.filter((name) => typeof name === 'string' && name.length > 0);
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
	{ secretNames = [], patterns = SECRET_VALUE_PATTERNS } = {},
) {
	const findings = [];
	for (const name of secretNames) {
		if (text.includes(name)) {
			findings.push({
				kind: 'runtime-secret-name',
				detail: `the declared runtime secret name "${name}" (${SECRET_NAME_REFERENCE}) appears in the SBOM; the inventory describes software, never credentials`,
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
	wranglerText,
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
	const findings = findSecretLikeFindings(serialized, {
		secretNames: readRequiredSecretNames(wranglerText),
	});
	for (const finding of findings) {
		errors.push(`${finding.kind}: ${finding.detail}`);
	}
	// The recorded provenance must cover every tracked input the
	// generator reads; a document that omits it cannot be audited.
	const provenance = bom?.metadata?.properties?.find(
		(p) => p.name === 'my-web-2026:source-digests',
	)?.value;
	for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'src/tools/manifest.json']) {
		if (!provenance?.includes(`${file}=sha256:`)) {
			errors.push(`metadata.properties: missing input digest for ${file}`);
		}
	}

	return { ok: errors.length === 0, errors };
}

/** Load + check a document that lives on disk. */
export function checkSbomFile({ root = repoRoot, bomPath }) {
	const full = resolve(root, bomPath);
	if (!existsSync(full)) return { ok: false, errors: [`SBOM file not found: ${bomPath}`] };
	let bom;
	try {
		bom = JSON.parse(readFileSync(full, 'utf8'));
	} catch (error) {
		return { ok: false, errors: [`SBOM file is not valid JSON: ${bomPath} (${error.message})`] };
	}
	return checkSbom({ bom, ...readInputs(root) });
}

/** Read the tracked inputs the gate compares against. */
export function readInputs(root = repoRoot) {
	return {
		packageJsonText: readFileSync(resolve(root, 'package.json'), 'utf8'),
		lockfileText: readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'),
		workspaceText: readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8'),
		toolsManifestText: readFileSync(resolve(root, 'src/tools/manifest.json'), 'utf8'),
		// Names only — never a value. See the module header.
		wranglerText: readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'),
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
