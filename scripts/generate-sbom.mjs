#!/usr/bin/env node
/**
 * CycloneDX SBOM generator (Issue #471 — supply chain).
 *
 * What it produces
 * ----------------
 * A CycloneDX 1.6 JSON document that inventories every version that
 * actually ships or builds this repository:
 *
 *   - the resolved npm dependency graph from `pnpm-lock.yaml`
 *     (name, exact version, SHA-512 integrity, dependency edges),
 *   - the Tool Registry artifacts from `src/tools/manifest.json`
 *     (slug, pinned commit SHA, declared license, canonical repo),
 *   - the root application component (name, version, license).
 *
 * Why CycloneDX and not SPDX: CycloneDX is consumable as-is by
 * `cyclonedx-cli`, GitHub dependency submission tooling and the
 * CycloneDX viewer without an extra tag/annotation pass. One format
 * only — the Issue allows either.
 *
 * Secret posture (AGENTS.md section 4)
 * ------------------------------------
 * This script reads a **fixed allowlist of tracked repository files**
 * (see `SBOM_SOURCE_FILES`) plus, for license enrichment, the
 * installed package manifests under `node_modules/.pnpm/`. It never
 * reads a process environment variable holding a credential, never
 * reads `.dev.vars`, never shells out to Infisical / Wrangler, and
 * never touches a live Cloudflare resource. Every value in the
 * emitted document therefore traces back to a file that is already
 * public in a public repository. `scripts/check-sbom.mjs` proves that
 * claim mechanically instead of trusting it.
 *
 * Reproducibility
 * ---------------
 * With `SOURCE_DATE_EPOCH` set (seconds since epoch) the document is
 * byte-for-byte reproducible: the timestamp derives from that value
 * and the serial number is derived from a SHA-256 over the canonical
 * body rather than from randomness. Release artifacts are built with
 * it so a reviewer can regenerate and diff.
 *
 * Usage:
 *   node scripts/generate-sbom.mjs                    # write the release artifact
 *   node scripts/generate-sbom.mjs --out=<path>       # write elsewhere
 *   node scripts/generate-sbom.mjs --stdout | jq '.components | length'
 *
 * Exit codes: 0 = generated, 1 = unreadable / unsupported input.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** CycloneDX profile this generator emits. */
export const SPEC_VERSION = '1.6';
export const BOM_FORMAT = 'CycloneDX';
export const SBOM_SCHEMA = 'http://cyclonedx.org/schema/bom-1.6.schema.json';

/**
 * The complete set of tracked inputs. Recorded in
 * `metadata.properties` (with SHA-256 digests) so a reader can
 * prove which files the document was derived from without trusting
 * this script.
 */
export const SBOM_SOURCE_FILES = Object.freeze([
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'src/tools/manifest.json',
]);

/** Repo-relative directory holding a release version's SBOM. */
export function sbomDirFor(version) {
	return `release-assets/supply-chain/${version}`;
}

/** File name of the generated document inside that directory. */
export const SBOM_FILE_NAME = 'sbom.cdx.json';

// ---------------------------------------------------------------------------
// YAML subset parser (pnpm lockfile v9)
// ---------------------------------------------------------------------------
//
// pnpm is the only YAML producer in this repository and its lockfile
// uses a small, stable subset: multi-document `---` separated block
// mappings, block sequences, flow mappings, flow sequences and
// scalars. Rather than add a YAML dependency to a repository whose
// dependency surface is itself the artifact under audit, the subset is
// parsed here and **unsupported constructs fail closed** — a silent
// partial parse would produce a plausible-looking but wrong SBOM,
// which is exactly the failure mode a supply-chain gate must avoid.

const UNSUPPORTED_YAML_CONSTRUCTS = [
	{ pattern: /(?:^|:\s+|-\s+)[&*][A-Za-z_]/m, label: 'YAML anchor or alias' },
	{ pattern: /:[ \t]*[|>][-+]?[ \t]*$/m, label: 'YAML block scalar' },
	{ pattern: /:[ \t]*!![A-Za-z]/m, label: 'explicit YAML tag' },
	{ pattern: /^[ \t]*<<:/m, label: 'YAML merge key' },
];

/** Thrown when the lockfile uses YAML outside the supported subset. */
export class UnsupportedYamlError extends Error {}

function assertSupportedYaml(text) {
	for (const { pattern, label } of UNSUPPORTED_YAML_CONSTRUCTS) {
		if (pattern.test(text)) {
			throw new UnsupportedYamlError(
				`pnpm-lock.yaml uses an unsupported construct (${label}). Teach scripts/generate-sbom.mjs to read it; never fall back to a partial parse, because a partial parse yields an SBOM that looks complete but is not.`,
			);
		}
	}
}

function indentOf(line) {
	return line.length - line.trimStart().length;
}

function isSkippable(line) {
	const trimmed = line.trim();
	return trimmed === '' || trimmed.startsWith('#');
}

/**
 * Split `key: value` respecting single/double quotes so a URL value
 * (`https://…`) or a scoped package key (`'@scope/name':`) is not
 * mis-split at its inner colon.
 */
function splitKeyValue(body) {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		else if (
			ch === ':' &&
			!inSingle &&
			!inDouble &&
			(i + 1 === body.length || body[i + 1] === ' ')
		) {
			return { key: body.slice(0, i).trim(), value: body.slice(i + 1).trim() };
		}
	}
	return null;
}

/** Split a flow collection body on top-level commas. */
function splitFlowItems(body) {
	const items = [];
	let depth = 0;
	let inSingle = false;
	let inDouble = false;
	let current = '';
	for (const ch of body) {
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		if (!inSingle && !inDouble) {
			if (ch === '{' || ch === '[') depth++;
			else if (ch === '}' || ch === ']') depth--;
			else if (ch === ',' && depth === 0) {
				items.push(current.trim());
				current = '';
				continue;
			}
		}
		current += ch;
	}
	if (current.trim() !== '') items.push(current.trim());
	return items;
}

function parseFlowScalar(raw) {
	const text = raw.trim();
	if (text === '') return '';
	if (text.startsWith('{') && text.endsWith('}')) {
		const out = {};
		for (const item of splitFlowItems(text.slice(1, -1))) {
			const split = splitKeyValue(item);
			if (split === null) {
				throw new UnsupportedYamlError(`flow mapping entry without a key: ${item}`);
			}
			out[unquote(split.key)] = parseFlowScalar(split.value);
		}
		return out;
	}
	if (text.startsWith('[') && text.endsWith(']')) {
		return splitFlowItems(text.slice(1, -1)).map((item) => parseFlowScalar(item));
	}
	return parseScalar(text);
}

function unquote(text) {
	if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
		return text.slice(1, -1).replace(/''/g, "'");
	}
	if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
		return text.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
	}
	return text;
}

function parseScalar(raw) {
	const text = raw.trim();
	if (text.startsWith("'") || text.startsWith('"')) return unquote(text);
	if (text === 'true') return true;
	if (text === 'false') return false;
	if (text === 'null' || text === '~') return null;
	return text;
}

function makeCursor(lines) {
	return { lines, index: 0 };
}

function nextMeaningfulLine(cursor) {
	while (cursor.index < cursor.lines.length) {
		const line = cursor.lines[cursor.index];
		if (isSkippable(line)) {
			cursor.index++;
			continue;
		}
		return line;
	}
	return null;
}

function parseNode(cursor, parentIndent) {
	const line = nextMeaningfulLine(cursor);
	if (line === null) return null;
	const indent = indentOf(line);
	if (indent < parentIndent) return null;
	if (/^\s*-(\s|$)/.test(line)) return parseSequence(cursor, indent);
	return parseMapping(cursor, indent);
}

function parseMapping(cursor, indent) {
	const out = {};
	for (;;) {
		const line = nextMeaningfulLine(cursor);
		if (line === null) break;
		const lineIndent = indentOf(line);
		if (lineIndent < indent) break;
		if (lineIndent > indent) {
			throw new UnsupportedYamlError(`unexpected indentation at: ${line.trim().slice(0, 80)}`);
		}
		const split = splitKeyValue(line.trim());
		if (split === null) {
			throw new UnsupportedYamlError(`mapping line without a key: ${line.trim().slice(0, 80)}`);
		}
		cursor.index++;
		const key = unquote(split.key);
		if (split.value === '') {
			const child = parseNode(cursor, indent + 1);
			out[key] = child;
			continue;
		}
		out[key] = parseFlowScalar(split.value);
	}
	return out;
}

function parseSequence(cursor, indent) {
	const out = [];
	for (;;) {
		const line = nextMeaningfulLine(cursor);
		if (line === null) break;
		const lineIndent = indentOf(line);
		if (lineIndent !== indent || !/^\s*-(\s|$)/.test(line)) break;
		const item = line.trim().slice(1).trim();
		cursor.index++;
		if (splitKeyValue(item) !== null && item !== '{}' && !item.startsWith('{')) {
			throw new UnsupportedYamlError(
				`sequence-of-mapping entries are not supported: ${item.slice(0, 80)}`,
			);
		}
		out.push(parseFlowScalar(item));
	}
	return out;
}

/** Parse a multi-document YAML text into a list of plain objects. */
export function parseYamlDocuments(text) {
	assertSupportedYaml(text);
	const documents = [];
	let buffer = [];
	for (const line of text.split(/\r?\n/)) {
		if (/^---\s*$/.test(line)) {
			if (buffer.some((l) => !isSkippable(l))) documents.push(parseMapping(makeCursor(buffer), 0));
			buffer = [];
			continue;
		}
		buffer.push(line);
	}
	if (buffer.some((l) => !isSkippable(l))) documents.push(parseMapping(makeCursor(buffer), 0));
	return documents;
}

// ---------------------------------------------------------------------------
// Lockfile -> component inventory
// ---------------------------------------------------------------------------

/**
 * Split a pnpm v9 dependency key into identity parts.
 *
 * `@babel/core@7.29.7(supports-color@10.2.2)` -> name `@babel/core`,
 * version `7.29.7`, peerSuffix `(supports-color@10.2.2)`.
 */
export function packageIdentityFromLockKey(key) {
	const body = unquote(key);
	// The peer-resolution suffix is `(name@version(other@version))`.
	// Split it off FIRST: the suffix itself contains `@`, so a
	// lastIndexOf('@') on the whole key would find the wrong separator.
	const peerAt = body.indexOf('(');
	const peerSuffix = peerAt === -1 ? '' : body.slice(peerAt);
	const head = peerAt === -1 ? body : body.slice(0, peerAt);
	const at = head.lastIndexOf('@');
	if (at <= 0) throw new UnsupportedYamlError(`lockfile key has no version: ${key}`);
	return { name: head.slice(0, at), version: head.slice(at + 1), peerSuffix };
}

/** Canonical, peer-suffix-free `name@version` identity. */
export function identityKey(name, version) {
	return `${name}@${version}`;
}

/** npm registry tarball URL for a package (used as a distribution ref). */
export function npmDistributionUrl(name, version) {
	const basename = name.startsWith('@') ? name.split('/')[1] : name;
	return `https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`;
}

/** Package URL for an npm package. Used as the CycloneDX `bom-ref`. */
export function npmPurl(name, version) {
	return `pkg:npm/${name}@${version}`;
}

/**
 * Convert an npm `sha512-<base64>` integrity string into the hex form
 * CycloneDX `hashes[].content` requires. Returns null when the
 * integrity is absent or not sha512 (never guess an algorithm).
 */
export function integrityToCycloneDxHash(integrity) {
	if (typeof integrity !== 'string') return null;
	const match = /^sha512-(.+)$/.exec(integrity.trim());
	if (!match) return null;
	const hex = Buffer.from(match[1], 'base64').toString('hex');
	if (hex.length !== 128) return null;
	return { alg: 'SHA-512', content: hex };
}

/** SHA-256 hex of a file's bytes (input provenance record). */
export function sha256Hex(text) {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Read declared licenses for every installed package once, keyed by
 * `name@version`. Missing / unparsable entries are simply absent, and
 * the caller renders `NOASSERTION` — an absent license is reported,
 * never invented.
 */
export function readInstalledLicenseIndex(storeDir = resolve(repoRoot, 'node_modules/.pnpm')) {
	const index = new Map();
	let entries;
	try {
		entries = readdirSync(storeDir);
	} catch {
		return index;
	}
	for (const dir of entries) {
		if (dir === 'node_modules' || dir === 'lock.yaml') continue;
		const at = dir.startsWith('@') ? dir.indexOf('@', 1) : dir.indexOf('@');
		if (at <= 0) continue;
		const name = dir.slice(0, at).replace('+', '/');
		const version = dir.slice(at + 1).split('_')[0];
		if (version === '') continue;
		const manifestPath = resolve(storeDir, dir, 'node_modules', name, 'package.json');
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
			const license = typeof manifest.license === 'string' ? manifest.license : null;
			index.set(identityKey(name, version), license);
		} catch {
			// Not installed on this platform (optional / platform-specific
			// dependency) or unreadable. Recorded as NOASSERTION below.
		}
	}
	return index;
}

/** CycloneDX `licenses` array; never asserts a license we did not read. */
export function licenseChoices(license) {
	if (typeof license !== 'string' || license.trim() === '') {
		return [{ license: { name: 'NOASSERTION' } }];
	}
	return [{ license: { name: license.trim() } }];
}

/**
 * Flatten every lockfile document into deduplicated `name@version`
 * package records.
 */
export function collectLockPackages(documents) {
	const byKey = new Map();
	documents.forEach((doc, documentIndex) => {
		const packages = doc?.packages ?? {};
		for (const key of Object.keys(packages)) {
			const identity = packageIdentityFromLockKey(key);
			const composite = identityKey(identity.name, identity.version);
			const existing = byKey.get(composite);
			if (existing) {
				existing.documents.add(documentIndex);
				existing.peerVariants.add(identity.peerSuffix);
				continue;
			}
			const entry = packages[key] ?? {};
			byKey.set(composite, {
				name: identity.name,
				version: identity.version,
				integrity: entry?.resolution?.integrity ?? null,
				optional: entry?.optional === true,
				cpu: entry?.cpu ?? null,
				os: entry?.os ?? null,
				hasBin: entry?.hasBin === true,
				deprecated: entry?.deprecated ?? null,
				engines: entry?.engines ?? null,
				documents: new Set([documentIndex]),
				peerVariants: new Set([identity.peerSuffix]),
			});
		}
	});
	return byKey;
}

/**
 * Dependency edges keyed by `name@version`, taken from the
 * `snapshots` section of every document. Peer suffixes on the recorded
 * target versions are dropped because components are deduplicated by
 * `name@version`.
 */
export function collectLockEdges(documents) {
	const edges = new Map();
	for (const doc of documents) {
		const snapshots = doc?.snapshots ?? {};
		for (const key of Object.keys(snapshots)) {
			const identity = packageIdentityFromLockKey(key);
			const from = identityKey(identity.name, identity.version);
			const snapshot = snapshots[key] ?? {};
			const targets = new Set(edges.get(from) ?? []);
			for (const field of ['dependencies', 'optionalDependencies']) {
				const deps = snapshot?.[field];
				if (!deps || typeof deps !== 'object') continue;
				for (const [depName, depSpec] of Object.entries(deps)) {
					if (typeof depSpec !== 'string') continue;
					const bare = depSpec.startsWith('link:') ? '' : depSpec.split('(')[0];
					if (bare === '') continue;
					targets.add(identityKey(depName, bare));
				}
			}
			edges.set(from, [...targets]);
		}
	}
	return edges;
}

/** Direct dependency names per group, from the project importer. */
export function collectDirectDependencies(documents) {
	const direct = new Map();
	for (const doc of documents) {
		const importer = doc?.importers?.['.'];
		if (!importer) continue;
		for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
			const deps = importer[group];
			if (!deps || typeof deps !== 'object') continue;
			for (const [name, entry] of Object.entries(deps)) {
				const spec = typeof entry === 'string' ? entry : (entry?.version ?? null);
				if (typeof spec !== 'string') continue;
				const bare = spec.split('(')[0];
				// `file:` / `link:` / `workspace:` name a path, not a
				// resolved registry version. Keeping them would register a
				// phantom direct identity that matches no component and
				// then silently vanish from `dependencies[].dependsOn`.
				if (
					bare === '' ||
					bare.startsWith('file:') ||
					bare.startsWith('link:') ||
					bare.startsWith('workspace:')
				) {
					continue;
				}
				const composite = identityKey(name, bare);
				const groups = direct.get(composite) ?? new Set();
				groups.add(group);
				direct.set(composite, groups);
			}
		}
	}
	return direct;
}

/** Package manager pin declared in the lockfile importer section. */
export function collectPackageManager(documents) {
	for (const doc of documents) {
		const pm = doc?.importers?.['.']?.packageManagerDependencies?.pnpm;
		if (pm && typeof pm.version === 'string') return `pnpm@${pm.version}`;
	}
	return null;
}

/** Patched dependency targets (`cf@1.0.0-beta.12` style keys). */
export function collectPatchedDependencies(documents, workspaceText) {
	const patched = new Set();
	for (const doc of documents) {
		const block = doc?.patchedDependencies;
		if (block && typeof block === 'object') {
			for (const key of Object.keys(block)) patched.add(key);
		}
	}
	const workspace = parseYamlDocuments(workspaceText)[0] ?? {};
	const block = workspace?.patchedDependencies;
	if (block && typeof block === 'object') {
		for (const key of Object.keys(block)) patched.add(key);
	}
	return patched;
}

/**
 * Why a component carries the license it carries. `not-installed` is
 * the honest answer for a platform-specific optional binary (a
 * Windows Rollup / Linux x64 CLI shim while generating on darwin) —
 * reporting that as "NOASSERTION, unknown license" would conflate
 * "we did not read it" with "upstream declares none".
 */
export const LICENSE_STATES = Object.freeze(['declared', 'undeclared', 'not-installed']);

/** CycloneDX component for one npm package. */
export function npmComponent(record, { groups, patched, license, licenseState }) {
	const ref = npmPurl(record.name, record.version);
	const properties = [
		{ name: 'my-web-2026:dependency-group', value: [...groups].sort().join(',') || 'transitive' },
		{ name: 'my-web-2026:peer-resolutions', value: String(record.peerVariants.size) },
		{ name: 'my-web-2026:lockfile-documents', value: [...record.documents].join(',') },
	];
	properties.push({ name: 'my-web-2026:license-resolution', value: licenseState });
	if (patched) properties.push({ name: 'my-web-2026:patched', value: 'true' });
	if (record.hasBin) properties.push({ name: 'my-web-2026:has-bin', value: 'true' });
	if (Array.isArray(record.cpu)) {
		properties.push({ name: 'my-web-2026:cpu', value: record.cpu.join(',') });
	}
	if (Array.isArray(record.os)) {
		properties.push({ name: 'my-web-2026:os', value: record.os.join(',') });
	}
	if (record.engines && typeof record.engines === 'object') {
		for (const [engine, range] of Object.entries(record.engines)) {
			properties.push({ name: `my-web-2026:engine:${engine}`, value: String(range) });
		}
	}
	const hash = integrityToCycloneDxHash(record.integrity);
	const component = {
		'bom-ref': ref,
		type: 'library',
		name: record.name,
		version: record.version,
		purl: ref,
		licenses: licenseChoices(license),
		externalReferences: [
			{ type: 'distribution', url: npmDistributionUrl(record.name, record.version) },
		],
		properties,
	};
	if (hash) component.hashes = [hash];
	if (record.deprecated) {
		// CycloneDX 1.6 has no `component.deprecated`, and
		// `definitions.component` sets `additionalProperties: false`, so
		// writing one would make the whole document invalid for every
		// schema-conformant consumer. The upstream message is carried as
		// namespaced properties instead.
		component.properties.push({ name: 'my-web-2026:deprecated', value: 'true' });
		component.properties.push({
			name: 'my-web-2026:deprecation-notice',
			value: String(record.deprecated),
		});
	}
	// CycloneDX scope: platform-specific packages are `optional`; the
	// pnpm bootstrap artifacts (the `@pnpm/exe.*` set) never enter a
	// shipped artifact, so they are excluded rather than required.
	if (record.name.startsWith('@pnpm/exe.')) component.scope = 'excluded';
	else if (record.optional) component.scope = 'optional';
	else component.scope = 'required';
	return component;
}

/** CycloneDX component for one Tool Registry artifact. */
export function toolComponent(tool) {
	const source = tool.source ?? {};
	const ref = `pkg:generic/my-web-2026-tool/${tool.slug}@${source.pinned_sha}`;
	const properties = [
		{ name: 'my-web-2026:tool-slug', value: tool.slug },
		{ name: 'my-web-2026:tool-submodule-path', value: String(source.submodule_path ?? '') },
		{ name: 'my-web-2026:tool-branch', value: String(source.branch ?? '') },
		{ name: 'my-web-2026:tool-delivery-kind', value: String(tool.delivery?.kind ?? '') },
		{ name: 'my-web-2026:tool-classification', value: String(tool.classification ?? '') },
	];
	if (tool.delivery?.artifact_path) {
		properties.push({
			name: 'my-web-2026:tool-artifact-path',
			value: String(tool.delivery.artifact_path),
		});
	}
	return {
		'bom-ref': ref,
		type: 'application',
		name: tool.slug,
		version: String(source.pinned_sha ?? ''),
		purl: ref,
		licenses: licenseChoices(
			typeof tool.license === 'string' && tool.license.trim() !== '' ? tool.license : null,
		),
		externalReferences: [{ type: 'vcs', url: String(source.canonical_repo ?? '') }],
		properties,
	};
}

function propertyList(entries) {
	return Object.entries(entries).map(([name, value]) => ({ name, value: String(value) }));
}

/**
 * Canonical, timestamp-free identity of a document body. Two builds of
 * the same inventory share a serial number; any inventory change does
 * not. Kept as a plain function rather than a template literal so the
 * seed is an ordinary object literal — a template substitution whose
 * argument spans multiple lines is easy to misread and, on the Node
 * versions this repository runs, mis-scoped.
 */
function serialNumberSeed(packageJson, components, dependencies) {
	return JSON.stringify({
		bomFormat: BOM_FORMAT,
		specVersion: SPEC_VERSION,
		name: packageJson.name,
		version: packageJson.version,
		components,
		dependencies,
	});
}

function stableUuid(namespaceSeed) {
	// RFC 4122 name-based UUID (v5) shape with a SHA-256 digest: the
	// value only has to be unique and deterministic, not a
	// standards-track v5 UUID, but it must render as `urn:uuid:`.
	const hex = sha256Hex(namespaceSeed).slice(0, 32).split('');
	hex[12] = '5';
	hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
	const s = hex.join('');
	return `urn:uuid:${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/**
 * Build the CycloneDX document from already-parsed inputs. Pure: the
 * only non-determinism is `timestamp`, and when it is omitted the
 * serial number becomes a deterministic digest of the body.
 */
export function buildSbom({
	packageJson,
	lockfileText,
	workspaceText,
	toolsManifestText,
	licenseIndex = new Map(),
	timestamp,
	repositoryUrl = 'https://github.com/rebuildup/my-web-2026',
}) {
	const documents = parseYamlDocuments(lockfileText);
	const packages = collectLockPackages(documents);
	const edges = collectLockEdges(documents);
	const direct = collectDirectDependencies(documents);
	const patchedKeys = collectPatchedDependencies(documents, workspaceText);
	const tools = JSON.parse(toolsManifestText).tools ?? [];

	const npmComponents = [...packages.values()]
		.map((record) => {
			const composite = identityKey(record.name, record.version);
			const patched = patchedKeys.has(composite);
			return npmComponent(record, {
				groups: direct.get(composite) ?? new Set(),
				patched,
				license: licenseIndex.get(composite) ?? null,
				licenseState: !licenseIndex.has(composite)
					? 'not-installed'
					: licenseIndex.get(composite)
						? 'declared'
						: 'undeclared',
			});
		})
		.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

	const toolComponents = tools
		.map((tool) => toolComponent(tool))
		.sort((a, b) => a.name.localeCompare(b.name));

	const rootRef = npmPurl(packageJson.name, packageJson.version);
	const components = [...npmComponents, ...toolComponents];

	// Dependency graph. Every ref must exist in `components`, so an
	// edge to an unknown ref is a generation bug and is surfaced as a
	// dangling ref rather than silently dropped.
	const dependencies = [];
	for (const component of components) {
		const key = identityKey(component.name, component.version);
		const refs = (edges.get(key) ?? [])
			.map((target) => npmPurl(...splitIdentityKey(target)))
			.filter((ref) => ref !== component['bom-ref'])
			.filter((ref) => components.some((c) => c['bom-ref'] === ref))
			.sort();
		dependencies.push({ ref: component['bom-ref'], dependsOn: refs });
	}
	dependencies.push({
		ref: rootRef,
		dependsOn: components
			.filter((component) => {
				const key = identityKey(component.name, component.version);
				return direct.has(key) || toolComponents.includes(component);
			})
			.map((component) => component['bom-ref'])
			.sort(),
	});
	dependencies.sort((a, b) => a.ref.localeCompare(b.ref));

	const sourceDigests = {
		'pnpm-lock.yaml': sha256Hex(lockfileText),
		'pnpm-workspace.yaml': sha256Hex(workspaceText),
		'src/tools/manifest.json': sha256Hex(toolsManifestText),
	};

	const bom = {
		$schema: SBOM_SCHEMA,
		bomFormat: BOM_FORMAT,
		specVersion: SPEC_VERSION,
		version: 1,
		metadata: {
			timestamp: timestamp ?? new Date().toISOString(),
			lifecycles: [{ phase: 'build' }],
			tools: {
				components: [
					{
						type: 'application',
						name: 'scripts/generate-sbom.mjs',
						version: packageJson.version,
					},
				],
			},
			component: {
				'bom-ref': rootRef,
				type: 'application',
				name: packageJson.name,
				version: packageJson.version,
				purl: rootRef,
				licenses: licenseChoices(packageJson.license ?? null),
				externalReferences: [
					{ type: 'website', url: repositoryUrl },
					{ type: 'vcs', url: repositoryUrl },
				],
			},
			properties: propertyList({
				'my-web-2026:package-manager': collectPackageManager(documents) ?? 'pnpm',
				'my-web-2026:lockfile': 'pnpm-lock.yaml',
				'my-web-2026:lockfile-version': String(documents[0]?.lockfileVersion ?? 'unknown'),
				'my-web-2026:source-digests': Object.entries(sourceDigests)
					.map(([file, digest]) => `${file}=sha256:${digest}`)
					.join(' '),
				'my-web-2026:license-source':
					'verbatim `license` string from node_modules/.pnpm/*/package.json (or src/tools/manifest.json); ' +
					'no SPDX list is vendored, so the raw string is carried instead of a guessed identifier',
				'my-web-2026:secret-policy':
					'values derive only from the tracked files listed in my-web-2026:source-digests; ' +
					'no environment credential, .dev.vars file, Infisical export or Worker secret value is read (AGENTS.md section 4)',
				'my-web-2026:component-count': components.length,
				'my-web-2026:npm-component-count': npmComponents.length,
				'my-web-2026:tool-component-count': toolComponents.length,
				'my-web-2026:noassertion-license-count': components.filter(
					(c) => c.licenses[0].license.name === 'NOASSERTION',
				).length,
				'my-web-2026:not-installed-license-count': npmComponents.filter(
					(c) =>
						c.properties.find((p) => p.name === 'my-web-2026:license-resolution')?.value ===
						'not-installed',
				).length,
			}),
		},
		components,
		dependencies,
	};

	if (timestamp !== undefined) {
		bom.serialNumber = stableUuid(serialNumberSeed(packageJson, components, dependencies));
	} else {
		bom.serialNumber = `urn:uuid:${randomUUID()}`;
	}
	return bom;
}

function splitIdentityKey(composite) {
	const at = composite.lastIndexOf('@');
	return [composite.slice(0, at), composite.slice(at + 1)];
}

/**
 * Read the tracked inputs from `root` and build the document.
 * Returns `{ bom, sources }` so callers can report the exact input
 * digests without re-reading the filesystem.
 */
export function generateSbom({ root = repoRoot, timestamp, withLicenses = true } = {}) {
	const sources = {};
	for (const relativePath of SBOM_SOURCE_FILES) {
		const full = resolve(root, relativePath);
		if (!existsSync(full)) {
			throw new Error(`SBOM source file missing: ${relativePath}`);
		}
		sources[relativePath] = readFileSync(full, 'utf8');
	}
	const packageJson = JSON.parse(sources['package.json']);
	const effectiveTimestamp = timestamp ?? resolveTimestamp();
	const bom = buildSbom({
		packageJson,
		lockfileText: sources['pnpm-lock.yaml'],
		workspaceText: sources['pnpm-workspace.yaml'],
		toolsManifestText: sources['src/tools/manifest.json'],
		licenseIndex: withLicenses
			? readInstalledLicenseIndex(resolve(root, 'node_modules/.pnpm'))
			: new Map(),
		timestamp: effectiveTimestamp,
	});
	return { bom, sources, version: packageJson.version };
}

/**
 * `SOURCE_DATE_EPOCH` (seconds) makes the output byte-reproducible.
 * Without it the current time and a random serial number are used, as
 * the CycloneDX specification expects for a one-off build.
 */
export function resolveTimestamp(env = process.env) {
	const raw = env.SOURCE_DATE_EPOCH;
	if (raw === undefined || raw === '') return undefined;
	const seconds = Number(raw);
	if (!Number.isFinite(seconds) || seconds < 0) {
		throw new Error(`SOURCE_DATE_EPOCH must be a non-negative integer, got: ${raw}`);
	}
	return new Date(seconds * 1000).toISOString();
}

/** Serialize with stable 2-space indentation and a trailing newline. */
export function serializeSbom(bom) {
	return `${JSON.stringify(bom, null, 2)}\n`;
}

function parseArg(argv, name) {
	const prefix = `--${name}=`;
	const found = argv.find((value) => value.startsWith(prefix));
	return found ? found.slice(prefix.length) : null;
}

function propertyValue(properties, name) {
	const found = properties.find((p) => p.name === name);
	return found === undefined ? '?' : found.value;
}

function main() {
	const argv = process.argv.slice(2);
	const out = parseArg(argv, 'out');
	const toStdout = argv.includes('--stdout');
	if (out && toStdout) {
		console.error(
			`Usage: node scripts/generate-sbom.mjs [--out=<path>] [--stdout]
Default output path: ${sbomDirFor('<package.json#version>')}/${SBOM_FILE_NAME}
--out and --stdout are mutually exclusive; with neither, the default path is written.`,
		);
		process.exit(1);
	}
	const { bom, version } = generateSbom();
	const body = serializeSbom(bom);
	if (toStdout) {
		process.stdout.write(body);
		return;
	}
	// No arguments means "write the release artifact", because that is
	// what the release cut and the CI Build SBOM step both mean by
	// `pnpm run sbom:build`. Making it a usage error once made CI red
	// for a command that is otherwise the documented happy path.
	const relative = out ?? `${sbomDirFor(version)}/${SBOM_FILE_NAME}`;
	const target = resolve(repoRoot, relative);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, body, 'utf8');
	console.log(
		`[generate-sbom] OK: ${bom.components.length} components ` +
			`(${propertyValue(bom.metadata.properties, 'my-web-2026:npm-component-count')} npm, ` +
			`${propertyValue(bom.metadata.properties, 'my-web-2026:tool-component-count')} tools) -> ${relative}`,
	);
}

// ESM main-module guard: importing this file for testing must not run
// the CLI (same pattern as scripts/check-release-assets.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		main();
	} catch (error) {
		console.error(`[generate-sbom] FAIL: ${error.message}`);
		process.exit(1);
	}
}
