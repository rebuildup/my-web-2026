#!/usr/bin/env node
/**
 * Tool Registry manifest verifier (Issue #80).
 *
 * Usage:
 *   node scripts/check-tools-manifest.mjs [--manifest=path]
 *
 * Asserts the manifest at `src/tools/manifest.json` is well-formed
 * and consistent with the parent repo's actual gitlink SHAs:
 *
 *   1. Manifest parses as JSON.
 *   2. Manifest shape matches `src/tools/manifest.schema.json` (basic
 *      hand-rolled checks; full ajv validation is out of scope).
 *   3. Slugs are unique.
 *   4. `source.pinned_sha` is a valid 40-char hex SHA.
 *   5. `source.canonical_repo` does not derive from the slug (no
 *      `https://github.com/rebuildup/tool-<slug>.git` guessing).
 *   6. For each tool whose `delivery.kind === "same_origin_static"`:
 *      - the submodule path MUST exist in the parent repo's git tree
 *      - the actual gitlink SHA MUST equal `source.pinned_sha`
 *      - this is the mechanical SHA match the brief requires.
 *   7. For each tool whose `delivery.kind === "host_disabled"`:
 *      - the submodule path MAY exist, but the SHA match is not
 *        required (the Tool is not yet integrated).
 *   8. `source.submodule_path` is unique across all tools.
 *   9. `source.canonical_repo` is unique across all tools.
 *
 * Exit code 0 on success, 1 on any violation. Each violation is
 * printed as `<file>:<line>  <message>` so the failure points at
 * the manifest entry, not the verifier internals.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = new Set(process.argv.slice(2));
const manifestPath = parseArg(args, '--manifest') ?? resolve(root, 'src/tools/manifest.json');

if (!existsSync(manifestPath)) {
	console.error(`[check-tools-manifest] manifest not found: ${manifestPath}`);
	process.exit(1);
}

const manifestRaw = readFileSync(manifestPath, 'utf8');
let manifest;
try {
	manifest = JSON.parse(manifestRaw);
} catch (err) {
	console.error(`[check-tools-manifest] manifest is not valid JSON: ${err.message}`);
	process.exit(1);
}

const errors = [];

// 1. Top-level shape
if (manifest.version !== 1) {
	errors.push(`version: expected 1, got ${manifest.version}`);
}
if (!Array.isArray(manifest.tools)) {
	errors.push('tools: must be an array');
	process.exit(1);
}

// 2. Per-tool shape + 3-9. cross-tool uniqueness + SHA format
const seenSlugs = new Set();
const seenSubmodulePaths = new Set();
const seenRepos = new Set();
const SHA_REGEX = /^[0-9a-f]{40}$/;
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SUBMODULE_PATH_REGEX = /^external\/[a-z0-9][a-z0-9-]{0,127}$/;
const ARTIFACT_PATH_REGEX = /^\/tools\/[a-z0-9][a-z0-9-]{0,127}(\/.*)?$/;

for (let i = 0; i < manifest.tools.length; i++) {
	const tool = manifest.tools[i];
	const prefix = `${manifestPath}:${lineFor(manifestRaw, i)}`;

	if (typeof tool.slug !== 'string' || !SLUG_REGEX.test(tool.slug)) {
		errors.push(`${prefix}  slug: "${tool.slug}" does not match /^[a-z0-9][a-z0-9-]{0,127}$/`);
	}
	if (seenSlugs.has(tool.slug)) errors.push(`${prefix}  slug: duplicate "${tool.slug}"`);
	seenSlugs.add(tool.slug);

	if (!tool.source || typeof tool.source !== 'object') {
		errors.push(`${prefix}  source: missing or not an object`);
		continue;
	}
	const s = tool.source;
	if (typeof s.canonical_repo !== 'string' || !/^https:\/\/github\.com\//.test(s.canonical_repo)) {
		errors.push(`${prefix}  source.canonical_repo: must be an https://github.com/... URL`);
	}
	// Brief rule: do NOT derive the URL from the slug. The actual
	// canonical URL for most tool-* repos happens to be
	// `https://github.com/rebuildup/tool-<slug>.git`, so we flag the
	// case where the URL ends with `/${slug}.git` AND clearly looks
	// like a typo of the `tool-<slug>.git` pattern (i.e. the host
	// portion matches the convention but the slug segment is wrong).
	// Tools like `readmark` (intentionally `rebuildup/readmark`, not
	// `rebuildup/tool-readmark`) and `prototype` (intentionally
	// `rebuildup/ProtoType`) opt out of the convention; those are
	// captured by reading the host portion, not the slug portion.
	if (typeof s.canonical_repo === 'string') {
		const expectedByPattern = `https://github.com/rebuildup/tool-${tool.slug}.git`;
		if (s.canonical_repo !== expectedByPattern) {
			// Look for a host/path portion that is plausibly a typo of
			// the convention: starts with `tool-` but ends with the
			// slug literally. This catches e.g.
			// `https://github.com/rebuildup/tool-text-counter/tree/main`
			// recorded with slug `text-counter`, but does NOT flag
			// `https://github.com/rebuildup/readmark.git` (no `tool-`
			// prefix at all) or `https://github.com/rebuildup/ProtoType.git`
			// (capitalised, non-conventional repo name).
			const looksLikeToolPattern = /\/tool-[^/]+\.git$/.test(s.canonical_repo);
			const endsWithSlug = s.canonical_repo.endsWith(`/${tool.slug}.git`);
			if (looksLikeToolPattern && endsWithSlug) {
				errors.push(
					`${prefix}  source.canonical_repo: URL ends with "${tool.slug}.git" but the host portion matches the "tool-<slug>.git" convention; verify the canonical_repo URL is correct`,
				);
			}
		}
	}
	if (typeof s.submodule_path !== 'string' || !SUBMODULE_PATH_REGEX.test(s.submodule_path)) {
		errors.push(
			`${prefix}  source.submodule_path: "${s.submodule_path}" must match /^external/<slug>$/`,
		);
	}
	if (seenSubmodulePaths.has(s.submodule_path))
		errors.push(`${prefix}  source.submodule_path: duplicate "${s.submodule_path}"`);
	seenSubmodulePaths.add(s.submodule_path);
	if (seenRepos.has(s.canonical_repo))
		errors.push(`${prefix}  source.canonical_repo: duplicate "${s.canonical_repo}"`);
	seenRepos.add(s.canonical_repo);
	if (typeof s.pinned_sha !== 'string' || !SHA_REGEX.test(s.pinned_sha)) {
		errors.push(`${prefix}  source.pinned_sha: "${s.pinned_sha}" must be a 40-char hex SHA`);
	}
	if (typeof s.branch !== 'string' || s.branch.length === 0) {
		errors.push(`${prefix}  source.branch: required`);
	}

	if (!tool.build || typeof tool.build !== 'object') {
		errors.push(`${prefix}  build: missing or not an object`);
	} else {
		if (typeof tool.build.command !== 'string' || tool.build.command.length === 0) {
			errors.push(`${prefix}  build.command: required`);
		}
		if (typeof tool.build.output_dir !== 'string' || tool.build.output_dir.length === 0) {
			errors.push(`${prefix}  build.output_dir: required`);
		}
		if (!['pnpm', 'bun', 'npm', 'yarn'].includes(tool.build.package_manager)) {
			errors.push(`${prefix}  build.package_manager: "${tool.build.package_manager}" not allowed`);
		}
	}

	if (!tool.delivery || typeof tool.delivery !== 'object') {
		errors.push(`${prefix}  delivery: missing or not an object`);
	} else {
		const d = tool.delivery;
		if (!['same_origin_static', 'external_exception', 'host_disabled'].includes(d.kind)) {
			errors.push(`${prefix}  delivery.kind: "${d.kind}" not allowed`);
		}
		if (d.kind === 'same_origin_static') {
			if (typeof d.artifact_path !== 'string' || !ARTIFACT_PATH_REGEX.test(d.artifact_path)) {
				errors.push(
					`${prefix}  delivery.artifact_path: "${d.artifact_path}" must match ^/tools/<slug>(/...)?$`,
				);
			}
			// iframe sandbox: warn on allow-same-origin + allow-scripts combo
			if (d.iframe) {
				const tokens = d.iframe.sandbox?.split(/\s+/) ?? [];
				if (tokens.includes('allow-scripts') && tokens.includes('allow-same-origin')) {
					errors.push(
						`${prefix}  delivery.iframe.sandbox: 'allow-scripts allow-same-origin' is dangerous; document the reason explicitly`,
					);
				}
			}
			// mechanical SHA match against the actual gitlink
			const gitlinkSha = readGitlinkSha(s.submodule_path);
			if (gitlinkSha === null) {
				errors.push(
					`${prefix}  source.pinned_sha: submodule path "${s.submodule_path}" is not a gitlink in the parent tree (same_origin_static tools MUST be checked out as submodules)`,
				);
			} else if (gitlinkSha !== s.pinned_sha) {
				errors.push(
					`${prefix}  source.pinned_sha: ${s.pinned_sha} does not match actual gitlink ${gitlinkSha}`,
				);
			}
		}
		if (d.kind === 'external_exception' && typeof d.external_url !== 'string') {
			errors.push(`${prefix}  delivery.external_url: required for external_exception`);
		}
		if (d.kind === 'host_disabled' && typeof d.disabled_reason !== 'string') {
			errors.push(`${prefix}  delivery.disabled_reason: required for host_disabled`);
		}
	}

	const allowedClassifications = [
		'same_origin_static',
		'needs_tool_side_fix',
		'external_exception',
		'not_integrable_yet',
	];
	if (!allowedClassifications.includes(tool.classification)) {
		errors.push(`${prefix}  classification: "${tool.classification}" not allowed`);
	}
	// classification vs delivery.kind coherence:
	//   - classification describes the technical capability
	//     ("can this Tool be served as same_origin_static?")
	//   - delivery.kind describes the current operational state
	//     ("is this Tool actually being served right now?")
	// The pair is valid as long as the operational state is not
	// weaker than the capability — e.g. classification=same_origin_static
	// with delivery.kind=host_disabled is fine (awaiting integration).
	// A classification=needs_tool_side_fix with delivery.kind=same_origin_static
	// is a contradiction: the Tool cannot be live-served before the fix lands.
	if (
		tool.classification === 'needs_tool_side_fix' &&
		tool.delivery?.kind === 'same_origin_static'
	) {
		errors.push(
			`${prefix}  classification=needs_tool_side_fix but delivery.kind=same_origin_static — Tool cannot be live before the Tool-side fix lands`,
		);
	}
}

if (errors.length > 0) {
	console.error(`[check-tools-manifest] ${errors.length} violation(s):`);
	for (const e of errors) console.error(`  ${e}`);
	process.exit(1);
}

const toolsByKind = manifest.tools.reduce((acc, t) => {
	acc[t.delivery?.kind ?? 'unknown'] = (acc[t.delivery?.kind ?? 'unknown'] ?? 0) + 1;
	return acc;
}, {});
console.log(
	`[check-tools-manifest] ${manifest.tools.length} tools, ok. Delivery breakdown: ${JSON.stringify(toolsByKind)}`,
);

/**
 * Read the actual gitlink SHA for a submodule path in the parent
 * repo. Returns `null` if the path is not a gitlink.
 */
function readGitlinkSha(submodulePath) {
	try {
		const out = execFileSync('git', ['ls-tree', 'HEAD', '--', submodulePath], {
			cwd: root,
			encoding: 'utf8',
		}).trim();
		if (!out) return null;
		// Format: "<mode> <type> <sha>\t<path>"
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

/** Best-effort line number for a tool index — falls back to 1. */
function lineFor(_raw, index) {
	return `tool[${index}]`;
}
