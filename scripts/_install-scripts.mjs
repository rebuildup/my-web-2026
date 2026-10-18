/**
 * Dependency install lifecycle script audit — pure logic (Issue #474).
 *
 * Why this exists
 * ---------------
 * Every `pnpm install` can execute third-party code before a single
 * line of this repository's own source is trusted. pnpm 12 is
 * default-deny for that: only packages listed in
 * `pnpm-workspace.yaml#onlyBuiltDependencies` (and the newer
 * `allowBuilds` map) get their `preinstall` / `install` /
 * `postinstall` scripts run. That deny-list is the security boundary,
 * but it is a *silent* boundary: nothing in CI records **why** each
 * entry is there, so an entry added to make one build pass keeps
 * running for every later install, and an entry that is no longer
 * needed is never removed.
 *
 * This module turns that boundary into a checkable contract:
 *
 *   - inventory every installed package manifest that declares a
 *     lifecycle hook,
 *   - split the hooks by when they actually fire (install-time vs
 *     publish-time vs root-project-only),
 *   - cross-check the inventory against both the pnpm execution
 *     allow-list and `quality/install-scripts.json` (the reviewed
 *     policy that carries the justification),
 *   - fail when the two disagree in either direction.
 *
 * Status-only by construction: the audit reads package manifests and
 * the two policy files. It never reads `.dev.vars`, Infisical, or any
 * Worker secret, and it prints package names, versions, hook names and
 * justifications — never a credential value.
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join as joinNodePath } from 'node:path';

/**
 * Hooks pnpm may execute for an installed dependency. `prepare` is
 * NOT here: pnpm does not run a *registry* dependency's `prepare`,
 * only the workspace root project's own. A **git-hosted** dependency
 * is the exception — pnpm prepares git-hosted packages while fetching
 * them (pnpm gates that with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`,
 * so the allow-list still governs it), which is why
 * `classifyHooks` promotes `prepare` to install-time for git specs.
 */
export const INSTALL_TIME_HOOKS = ['preinstall', 'install', 'postinstall'];

/** Hooks that run for the workspace ROOT project on `pnpm install`. */
export const ROOT_INSTALL_HOOKS = ['prepare'];

/**
 * Hooks that never run during `pnpm install` for a registry
 * dependency — they only run when the package itself is published or
 * packed. They are inventoried (a package migrating a hook from
 * `postinstall` to `prepublishOnly` is a real signal) but never
 * require a policy entry.
 */
export const PUBLISH_TIME_HOOKS = ['prepublish', 'prepublishOnly', 'prepack', 'postpack'];

/**
 * pnpm treats a package that ships a `binding.gyp` as buildable even
 * when its manifest declares no lifecycle script at all: an allowed
 * such package gets an implicit `node-gyp rebuild` (pnpm docs, "Build
 * dependencies"). The manifest therefore under-reports what can
 * execute, so the file itself is inventoried as a hook.
 */
export const IMPLICIT_BUILD_HOOK = 'implicit:binding.gyp';

export const KNOWN_HOOKS = [
	...INSTALL_TIME_HOOKS,
	...ROOT_INSTALL_HOOKS,
	...PUBLISH_TIME_HOOKS,
	IMPLICIT_BUILD_HOOK,
];

/** Policy decisions. Default is deny (see `parsePolicy`). */
export const DECISIONS = ['allow', 'block'];

/** Policy key for the workspace root project (`package.json` itself). */
export const ROOT_PACKAGE_KEY = '.';

export const POLICY_VERSION = 1;

/** `preinstall` runs before anything else; flag it in every report. */
export const ELEVATED_HOOKS = ['preinstall'];

/**
 * Dependency specifiers that resolve to a git checkout rather than a
 * registry tarball. pnpm builds those from source, which is why their
 * `prepare` hook executes at install time.
 */
const GIT_SPECIFIER =
	/^(?:git(?:\+[a-z]+)?:|github:|gitlab:|bitbucket:|ssh:\/\/|git@|https?:\/\/\S*\.git(?:#\S*)?$)/i;

/** Does this dependency specifier resolve to a git-hosted package? */
export function isGitSpecifier(specifier) {
	return typeof specifier === 'string' && GIT_SPECIFIER.test(specifier.trim());
}

/**
 * Names of git-hosted dependencies, discovered from the manifests
 * themselves (the root project's and every installed package's
 * dependency maps).
 *
 * A registry dependency is installed from a published tarball, so its
 * `prepare` never fires during `pnpm install`. A git dependency is
 * cloned and *prepared* (pnpm `git-fetcher`), so its `prepare` is
 * install-time code that must clear the same reviewed allow-list.
 * Without this distinction an unreviewed git dependency could run
 * arbitrary code with no policy record at all.
 */
export function collectGitHostedNames(manifests = [], rootManifest = null) {
	const names = new Set();
	const inspect = (manifest) => {
		if (!manifest) return;
		for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
			for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
				if (isGitSpecifier(specifier)) names.add(name);
			}
		}
	};
	inspect(rootManifest);
	for (const manifest of manifests) inspect(manifest);
	return names;
}

/**
 * Split a manifest's `scripts` map into the three firing classes.
 * Only hooks whose value is a non-empty string count — npm treats a
 * non-string / empty script as absent.
 *
 * `options.gitHosted` promotes `prepare` from root-only to
 * install-time (pnpm prepares git-hosted dependencies).
 */
export function classifyHooks(scripts, options = {}) {
	const source = scripts && typeof scripts === 'object' ? scripts : {};
	const installTime = [];
	const rootInstallTime = [];
	const publishTime = [];
	for (const hook of KNOWN_HOOKS) {
		const value = source[hook];
		if (typeof value !== 'string' || value.trim() === '') continue;
		if (INSTALL_TIME_HOOKS.includes(hook)) installTime.push(hook);
		else if (hook === 'prepare') {
			if (options.gitHosted) installTime.push(hook);
			else rootInstallTime.push(hook);
		} else publishTime.push(hook);
	}
	return { installTime, rootInstallTime, publishTime };
}

/**
 * Validate `quality/install-scripts.json`.
 *
 * Returns `{ policy, errors }` instead of throwing so a malformed
 * policy produces the complete list of problems at once.
 */
export function parsePolicy(rawText) {
	const errors = [];
	let parsed;
	try {
		parsed = JSON.parse(rawText);
	} catch (error) {
		return { policy: null, errors: [`policy is not valid JSON: ${error.message}`] };
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { policy: null, errors: ['policy must be a JSON object'] };
	}
	if (parsed.version !== POLICY_VERSION) {
		errors.push(`version: expected ${POLICY_VERSION}, got ${JSON.stringify(parsed.version)}`);
	}
	if (parsed.default_decision !== 'block') {
		errors.push(
			`default_decision: must be "block" (pnpm is default-deny; a policy that defaults to allow would silently authorise every future install script), got ${JSON.stringify(parsed.default_decision)}`,
		);
	}
	if (!Array.isArray(parsed.packages)) {
		return { policy: null, errors: [...errors, 'packages: must be an array'] };
	}

	const packages = [];
	const seen = new Set();
	for (const [index, entry] of parsed.packages.entries()) {
		const at = `packages[${index}]`;
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			errors.push(`${at}: must be an object`);
			continue;
		}
		const name = entry.name;
		if (typeof name !== 'string' || name.trim() === '') {
			errors.push(`${at}: name is required`);
			continue;
		}
		if (seen.has(name)) {
			errors.push(`${at}: duplicate entry for "${name}"`);
			continue;
		}
		seen.add(name);
		if (!Array.isArray(entry.hooks) || entry.hooks.length === 0) {
			errors.push(`${at} (${name}): hooks must be a non-empty array`);
			continue;
		}
		const unknownHooks = entry.hooks.filter((hook) => !KNOWN_HOOKS.includes(hook));
		if (unknownHooks.length > 0) {
			errors.push(
				`${at} (${name}): unknown lifecycle hook(s) ${unknownHooks.map((h) => `"${h}"`).join(', ')}; known hooks are ${KNOWN_HOOKS.join(', ')}`,
			);
			continue;
		}
		if (!DECISIONS.includes(entry.decision)) {
			errors.push(
				`${at} (${name}): decision must be one of ${DECISIONS.map((d) => `"${d}"`).join(', ')}, got ${JSON.stringify(entry.decision)}`,
			);
			continue;
		}
		if (typeof entry.justification !== 'string' || entry.justification.trim() === '') {
			errors.push(
				`${at} (${name}): justification is required — "why does this build run" is the deliverable of the audit, not an optional comment`,
			);
			continue;
		}
		const hasSingle = entry.observed_version !== undefined;
		const hasMany = entry.observed_versions !== undefined;
		if (hasSingle && hasMany) {
			errors.push(`${at} (${name}): use observed_version OR observed_versions, not both`);
			continue;
		}
		if (hasSingle && typeof entry.observed_version !== 'string') {
			errors.push(`${at} (${name}): observed_version must be a string when present`);
			continue;
		}
		if (
			hasMany &&
			(!Array.isArray(entry.observed_versions) ||
				entry.observed_versions.length === 0 ||
				entry.observed_versions.some((value) => typeof value !== 'string'))
		) {
			errors.push(`${at} (${name}): observed_versions must be a non-empty array of strings`);
			continue;
		}
		packages.push({
			name,
			hooks: [...entry.hooks],
			decision: entry.decision,
			justification: entry.justification,
			...(hasSingle ? { observed_version: entry.observed_version } : {}),
			...(hasMany ? { observed_versions: [...entry.observed_versions].sort() } : {}),
			...(typeof entry.remediation === 'string' ? { remediation: entry.remediation } : {}),
		});
	}

	if (errors.length > 0) return { policy: null, errors };
	return {
		policy: {
			version: parsed.version,
			issue: typeof parsed.issue === 'string' ? parsed.issue : null,
			default_decision: parsed.default_decision,
			packages,
		},
		errors: [],
	};
}

/**
 * pnpm-workspace.yaml keys that decide whether a lifecycle script runs.
 *
 * `allowBuilds` is the grant list pnpm 12 actually honours, and
 * `permissions` supersedes it when both are declared ("Their
 * "allowBuilds" entries are ignored in favor of "permissions"" — pnpm
 * diagnostics). `onlyBuiltDependencies` is the legacy list and
 * `ignoredBuiltDependencies` the explicit deny list.
 */
export const GRANT_MAP_KEYS = ['allowBuilds', 'permissions'];
export const LEGACY_GRANT_KEY = 'onlyBuiltDependencies';
export const DENY_SEQUENCE_KEY = 'ignoredBuiltDependencies';

/**
 * Read the pnpm execution allow-list out of `pnpm-workspace.yaml`.
 *
 * Deliberately a targeted line reader rather than a YAML dependency:
 * only the top-level keys that decide whether a lifecycle script runs
 * are needed, and the shapes pnpm accepts are sequences
 * (`onlyBuiltDependencies`, `ignoredBuiltDependencies`) and maps
 * (`allowBuilds: {name: true}`, `permissions: {name: true}`). Adding a
 * YAML parser for this would be a dependency whose own install surface
 * the audit then has to audit.
 *
 * Returns the **effective** grants only. A name that survives solely
 * in the legacy `onlyBuiltDependencies` list grants nothing under
 * pnpm 12, so counting it as permission would make the audit report a
 * build as permitted while pnpm skips it — the exact false green this
 * gate exists to remove. Those names come back in `legacyOnly` and are
 * reported as violations.
 */
export function readPnpmAllowlist(rawText) {
	const names = new Map(); // name -> declaring keys, sorted
	const errors = [];
	const sequences = new Map(); // key -> [names]
	const maps = new Map(); // key -> Map(name -> boolean)
	const lines = String(rawText ?? '').split('\n');
	let activeKey = null;
	let activeShape = null;
	for (const rawLine of lines) {
		const line = rawLine.replace(/\t/g, '  ');
		if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
		const indent = line.length - line.trimStart().length;
		const topLevel = indent === 0;
		if (topLevel) {
			const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line.trim());
			const key = match ? match[1] : null;
			activeKey = key && (GRANT_MAP_KEYS.includes(key) || sequencesHas(key)) ? key : null;
			activeShape = activeKey ? (GRANT_MAP_KEYS.includes(activeKey) ? 'map' : 'sequence') : null;
			if (activeKey === null) continue;
			recordKey(activeKey, sequences, maps);
			const inline = match[2].trim();
			if (activeShape === 'sequence' && inline.startsWith('[') && inline.endsWith(']')) {
				for (const item of inline.slice(1, -1).split(',')) {
					const name = unquote(item.trim());
					if (name) sequences.get(activeKey).push(name);
				}
				activeKey = null;
			}
			continue;
		}
		if (activeKey === null) continue;
		const item = /^\s*-\s*(.+)$/.exec(line);
		if (item) {
			const name = unquote(item[1].split('#')[0].trim());
			if (name) sequences.get(activeKey).push(name);
			continue;
		}
		const pair = /^\s+(['"]?)([^:'"]+)\1\s*:\s*(.+)$/.exec(line);
		if (pair) {
			const name = pair[2].trim();
			const value = pair[3].split('#')[0].trim();
			if (name === '') continue;
			if (value !== 'true' && value !== 'false') {
				errors.push(
					`pnpm-workspace.yaml#${activeKey}.${name}: expected a boolean, got ${JSON.stringify(value)}`,
				);
				continue;
			}
			maps.get(activeKey).set(name, value === 'true');
		}
	}

	const granted = new Map(); // grant map key -> Set(names granted)
	for (const key of GRANT_MAP_KEYS) {
		const map = maps.get(key) ?? new Map();
		granted.set(
			key,
			new Set([...map.entries()].filter(([, value]) => value).map(([name]) => name)),
		);
	}
	const bothGranted = [...granted.get('allowBuilds')].some((name) =>
		granted.get('permissions').has(name),
	);
	if (bothGranted) {
		errors.push(
			'pnpm-workspace.yaml: "allowBuilds" and "permissions" both grant build scripts for the same package; pnpm ignores the "allowBuilds" entry in favour of "permissions", so the effective grant cannot be read from the file — keep exactly one of the two keys',
		);
	}
	const effectiveKey =
		granted.get('permissions').size > 0
			? 'permissions'
			: granted.get('allowBuilds').size > 0
				? 'allowBuilds'
				: null;
	if (!bothGranted) {
		for (const key of GRANT_MAP_KEYS) {
			if (key === effectiveKey) continue;
			for (const name of granted.get(key)) {
				errors.push(
					`pnpm-workspace.yaml#${key}.${name}: grants build scripts while "${effectiveKey ?? 'no key'}" is the effective grant list; pnpm 12 ignores this entry`,
				);
			}
		}
	}

	const effective = effectiveKey ? granted.get(effectiveKey) : new Set();
	const legacy = sequences.get(LEGACY_GRANT_KEY) ?? [];
	const denied = new Set(sequences.get(DENY_SEQUENCE_KEY) ?? []);
	const legacyOnly = [];
	for (const name of [...effective].sort()) {
		record(names, name, effectiveKey);
		// Naming the legacy list too keeps the report honest about where a
		// grant is declared; it never grants anything on its own.
		if (legacy.includes(name)) record(names, name, LEGACY_GRANT_KEY);
	}
	for (const name of legacy) {
		if (!effective.has(name)) legacyOnly.push(name);
	}
	const conflicts = [...effective].filter((name) => denied.has(name)).sort();

	return { names, effectiveKey, legacyOnly: legacyOnly.sort(), ignored: denied, conflicts, errors };
}

function sequencesHas(key) {
	return key === LEGACY_GRANT_KEY || key === DENY_SEQUENCE_KEY;
}

function recordKey(key, sequences, maps) {
	if (GRANT_MAP_KEYS.includes(key)) {
		if (!maps.has(key)) maps.set(key, new Map());
		return;
	}
	if (!sequences.has(key)) sequences.set(key, []);
}

/** Accept either the reader's output or a bare name -> keys map (tests). */
export function normalizeAllowlist(input) {
	if (input instanceof Map) {
		return { names: input, effectiveKey: null, legacyOnly: [], ignored: [], conflicts: [] };
	}
	return {
		names: input?.names ?? new Map(),
		effectiveKey: input?.effectiveKey ?? null,
		legacyOnly: input?.legacyOnly ?? [],
		ignored: input?.ignored ?? new Set(),
		conflicts: input?.conflicts ?? [],
	};
}

function record(names, name, key) {
	const keys = names.get(name) ?? [];
	if (!keys.includes(key)) keys.push(key);
	names.set(name, [...keys].sort());
}

function unquote(value) {
	const match = /^(['"])(.*)\1$/.exec(value);
	return match ? match[2] : value;
}

/**
 * Walk an installed `node_modules` tree and return one record per
 * distinct package directory.
 *
 * Only real package boundaries are visited: the entries of a
 * `node_modules` directory (scope directories one level down), the
 * `.pnpm` virtual-store slots, and each package's own nested
 * `node_modules`. Files a dependency merely *ships* — `examples/`,
 * `test/fixtures/`, `vendor/` — are not package boundaries: pnpm
 * never builds them, so counting their manifests would invent
 * install-time code that does not exist and make the gate fail on a
 * fixture. Records are keyed by realpath so the top-level symlink and
 * the virtual-store copy stay one package.
 */
export function collectInstalledManifests(rootDir, options = {}) {
	const maxDepth = options.maxDepth ?? 12;
	const manifests = new Map(); // realpath -> manifest
	const visited = new Set();
	const queue = [{ dir: options.manifestsDir ?? joinNodePath(rootDir, 'node_modules'), depth: 0 }];
	while (queue.length > 0) {
		const { dir, depth } = queue.pop();
		let realDir;
		try {
			realDir = realpathSync(dir);
		} catch {
			continue;
		}
		if (visited.has(realDir)) continue;
		visited.add(realDir);

		for (const pkgDir of listPackageDirs(dir)) {
			let realPkgDir;
			try {
				realPkgDir = realpathSync(pkgDir);
			} catch {
				continue;
			}
			if (visited.has(realPkgDir)) continue;
			visited.add(realPkgDir);

			const manifest = readPackageManifest(joinNodePath(pkgDir, 'package.json'));
			if (manifest) manifests.set(realPkgDir, manifest);

			const nested = joinNodePath(pkgDir, 'node_modules');
			if (depth < maxDepth && existsSync(nested)) {
				queue.push({ dir: nested, depth: depth + 1 });
			}
		}
	}
	return [...manifests.values()];
}

/** Package directories directly inside one `node_modules` directory. */
function listPackageDirs(nodeModulesDir) {
	const dirs = [];
	for (const name of listDirectories(nodeModulesDir)) {
		if (name === '.bin') continue;
		const entry = joinNodePath(nodeModulesDir, name);
		if (name === '.pnpm') {
			// Each virtual-store slot (`name@version`) holds its own
			// node_modules; the hoisted `node_modules` inside `.pnpm` is a
			// container, not a package.
			for (const slot of listDirectories(entry)) {
				if (slot === 'node_modules') continue;
				dirs.push(joinNodePath(entry, slot));
			}
			continue;
		}
		if (name.startsWith('@')) {
			for (const scoped of listDirectories(entry)) dirs.push(joinNodePath(entry, scoped));
			continue;
		}
		dirs.push(entry);
	}
	return dirs;
}

function listDirectories(dir) {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}

/** Read one `package.json`, returning `null` for anything unusable. */
export function readPackageManifest(path) {
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		return null;
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string') return null;
	return {
		name: parsed.name,
		version: typeof parsed.version === 'string' ? parsed.version : 'unknown',
		scripts: parsed.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {},
		// pnpm builds a package that ships `binding.gyp` even without a
		// lifecycle script, so the file has to be part of the inventory.
		requiresBuild: existsSync(joinNodePath(dirnameOf(path), 'binding.gyp')),
		dependencies:
			parsed.dependencies && typeof parsed.dependencies === 'object' ? parsed.dependencies : {},
		devDependencies:
			parsed.devDependencies && typeof parsed.devDependencies === 'object'
				? parsed.devDependencies
				: {},
		optionalDependencies:
			parsed.optionalDependencies && typeof parsed.optionalDependencies === 'object'
				? parsed.optionalDependencies
				: {},
	};
}

function dirnameOf(path) {
	const normalized = String(path).replace(/\/+$/, '');
	const cut = normalized.lastIndexOf('/');
	return cut <= 0 ? normalized : normalized.slice(0, cut);
}

/**
 * Group installed manifests by package name.
 *
 * pnpm's virtual store legitimately holds several versions of the
 * same package (`workerd` follows `@cloudflare/vitest-plugin` and the
 * Worker runtime pins separately), so a policy record — and a report
 * row — has to be about the *name*, not one directory. Versions are
 * collected as a sorted set so the report stays deterministic.
 *
 * `options.gitHostedNames` promotes `prepare` to install-time for
 * git-hosted dependencies, and a package shipping `binding.gyp`
 * contributes the implicit `node-gyp rebuild` pnpm would run.
 */
export function groupInstalledByName(manifests, options = {}) {
	const gitHostedNames = options.gitHostedNames ?? new Set();
	const groups = new Map();
	for (const manifest of manifests) {
		const gitHosted = gitHostedNames.has(manifest.name);
		const hooks = classifyHooks(manifest.scripts, { gitHosted });
		let group = groups.get(manifest.name);
		if (!group) {
			group = {
				name: manifest.name,
				versions: new Set(),
				hooks: new Set(),
				publishTimeHooks: new Set(),
				rootHooks: new Set(),
				gitHosted,
				requiresBuild: false,
			};
			groups.set(manifest.name, group);
		}
		group.versions.add(manifest.version);
		group.gitHosted = group.gitHosted || gitHosted;
		group.requiresBuild = group.requiresBuild || manifest.requiresBuild === true;
		for (const hook of hooks.installTime) group.hooks.add(hook);
		if (manifest.requiresBuild === true) group.hooks.add(IMPLICIT_BUILD_HOOK);
		for (const hook of hooks.publishTime) group.publishTimeHooks.add(hook);
		for (const hook of hooks.rootInstallTime) group.rootHooks.add(hook);
	}
	return groups;
}

/** Sorted version list recorded in a policy entry, if any. */
function recordedVersions(entry) {
	if (Array.isArray(entry?.observed_versions)) return [...entry.observed_versions].sort();
	if (typeof entry?.observed_version === 'string') return [entry.observed_version];
	return null;
}

/**
 * Cross-check the installed inventory against the pnpm execution
 * allow-list and the reviewed policy.
 *
 * Returns `{ findings, publishTimeOnly, violations, warnings, summary }`.
 * Every entry is status-only: package name, version, hook names and
 * policy text.
 */
export function auditInstallScripts(input) {
	const {
		manifests = [],
		rootManifest = null,
		policy = { packages: [] },
		pnpmAllowlist: allowlistInput = new Map(),
		directNames = new Set(),
	} = input;
	const allowlist = normalizeAllowlist(allowlistInput);
	const pnpmAllowlist = allowlist.names;

	const violations = [];
	const warnings = [];
	const findings = [];
	const publishTimeOnly = [];

	const gitHostedNames = collectGitHostedNames(manifests, rootManifest);
	const groups = groupInstalledByName(manifests, { gitHostedNames });
	const policyEntries = new Map(policy.packages.map((entry) => [entry.name, entry]));

	const record = ({ name, versions, hooks, kind }) => {
		const sortedVersions = [...versions].sort();
		const sortedHooks = [...hooks].sort();
		const entry = policyEntries.get(name) ?? null;
		const allowlistKeys = pnpmAllowlist.get(name) ?? [];
		const recorded = entry ? recordedVersions(entry) : null;
		const finding = {
			name,
			versions: sortedVersions,
			hooks: sortedHooks,
			kind, // 'root' | 'direct' | 'transitive'
			direct: kind !== 'transitive',
			elevated: sortedHooks.some((hook) => ELEVATED_HOOKS.includes(hook)),
			git_hosted: gitHostedNames.has(name),
			implicit_build: sortedHooks.includes(IMPLICIT_BUILD_HOOK),
			decision: entry?.decision ?? null,
			justification: entry?.justification ?? null,
			observed_versions: recorded,
			version_drift: Boolean(recorded && recorded.join(',') !== sortedVersions.join(',')),
			allowlisted: allowlistKeys.length > 0,
			allowlist_keys: allowlistKeys,
			status: 'unreviewed',
		};

		if (!entry) {
			violations.push(
				`${name}@${sortedVersions.join(', ')} declares install-time lifecycle script(s) ${sortedHooks.join(', ')} but has no entry in quality/install-scripts.json — review whether the build is actually needed, then record the decision and its justification`,
			);
			findings.push(finding);
			return;
		}

		finding.status = 'reviewed';
		const undocumented = sortedHooks.filter((hook) => !entry.hooks.includes(hook));
		if (undocumented.length > 0) {
			violations.push(
				`${name}: policy records hook(s) [${entry.hooks.join(', ')}] but the installed version(s) declare [${sortedHooks.join(', ')}] — undocumented: ${undocumented.join(', ')}`,
			);
		}
		const vanished = entry.hooks.filter((hook) => !sortedHooks.includes(hook));
		if (vanished.length > 0) {
			warnings.push(
				`${name}: policy records hook(s) ${vanished.join(', ')} that the installed version(s) no longer declare — drop them from quality/install-scripts.json`,
			);
		}
		if (finding.version_drift) {
			const drift = `${name}: policy observed version(s) [${recorded.join(', ')}] != installed [${sortedVersions.join(', ')}]`;
			if (entry.decision === 'allow') {
				// An allowed package keeps its permission across version
				// bumps, so the code that runs on the next install is
				// unreviewed until the record is updated. That is not a
				// warning: pnpm would execute the new version in CI before
				// this audit even sees it.
				violations.push(
					`${drift} — an "allow" record runs the new version's lifecycle scripts on every install, so the version must be re-reviewed and the record updated in the same change`,
				);
			} else {
				warnings.push(
					`${drift} — the record blocks the build, so re-review the new version's lifecycle scripts when the decision changes`,
				);
			}
		}
		// The workspace ROOT project is not a dependency, so pnpm's
		// `onlyBuiltDependencies` allow-list does not govern it: the root
		// `prepare` always runs. Cross-checking it against that list would
		// fail every repository for a rule that cannot apply to it.
		const allowlistApplies = kind !== 'root';
		if (entry.decision === 'allow' && allowlistApplies && !finding.allowlisted) {
			violations.push(
				`${name}: policy decision "allow" but pnpm-workspace.yaml does not list it (onlyBuiltDependencies / allowBuilds) — the approved build will not run`,
			);
		}
		if (entry.decision === 'block' && allowlistApplies && finding.allowlisted) {
			violations.push(
				`${name}: policy decision "block" but pnpm-workspace.yaml allows its lifecycle scripts — the denied script still runs on every install`,
			);
		}
		findings.push(finding);
	};

	const rootHooks = rootManifest
		? classifyHooks(rootManifest.scripts, { gitHosted: gitHostedNames.has(ROOT_PACKAGE_KEY) })
		: null;
	if (rootHooks && (rootHooks.rootInstallTime.length > 0 || rootHooks.installTime.length > 0)) {
		record({
			name: ROOT_PACKAGE_KEY,
			versions: new Set([rootManifest.version]),
			hooks: new Set([...rootHooks.rootInstallTime, ...rootHooks.installTime]),
			kind: 'root',
		});
	} else if (policyEntries.has(ROOT_PACKAGE_KEY)) {
		warnings.push(
			`${ROOT_PACKAGE_KEY}: policy records a root lifecycle hook but package.json no longer declares one — drop the entry`,
		);
	}

	const installTimeNames = new Set();
	for (const group of groups.values()) {
		if (group.hooks.size > 0) {
			installTimeNames.add(group.name);
			record({
				name: group.name,
				versions: group.versions,
				hooks: group.hooks,
				kind: directNames.has(group.name) ? 'direct' : 'transitive',
			});
			continue;
		}
		if (group.publishTimeHooks.size > 0 || group.rootHooks.size > 0) {
			publishTimeOnly.push({
				name: group.name,
				versions: [...group.versions].sort(),
				hooks: [...group.publishTimeHooks, ...group.rootHooks].sort(),
			});
		}
	}

	// Unnecessary execution permission: an allow-list entry whose
	// installed package declares no install-time hook at all. It grants
	// a package the right to execute code on every future install for
	// no build benefit, which is exactly the drift this audit removes.
	for (const [name, keys] of [...pnpmAllowlist.entries()].sort()) {
		if (name === ROOT_PACKAGE_KEY || installTimeNames.has(name)) continue;
		const group = groups.get(name);
		warnings.push(
			`pnpm-workspace.yaml#${keys.join('+')} allows build scripts for "${name}" but the installed version(s)${group ? ` (${[...group.versions].sort().join(', ')})` : ''} declare no install-time lifecycle script — remove the entry`,
		);
	}

	// A grant that survives only in the legacy `onlyBuiltDependencies`
	// list grants nothing under pnpm 12, which reads `allowBuilds` (or
	// `permissions`). Reporting it as permitted would tell a reviewer
	// "this build runs" while pnpm skips it, so the drift is a failure
	// instead of a note.
	for (const name of allowlist.legacyOnly) {
		violations.push(
			`${name}: pnpm-workspace.yaml#${LEGACY_GRANT_KEY} lists it, but the effective grant list is ${allowlist.effectiveKey ? `#${allowlist.effectiveKey}` : 'missing'} — a build allowed only in the legacy list never runs under pnpm 12; move the entry to ${allowlist.effectiveKey ?? 'allowBuilds'} or delete it`,
		);
	}
	for (const name of allowlist.conflicts) {
		violations.push(
			`${name}: pnpm-workspace.yaml grants it in #${allowlist.effectiveKey} and denies it in #${DENY_SEQUENCE_KEY} at the same time — keep one intent`,
		);
	}

	// A policy record only earns its place while the package actually
	// ships an install-time hook. A record for a package that lost the
	// hook (or is no longer installed at all) is stale: it would keep
	// the next reviewer from seeing which hooks were ever approved.
	for (const entry of policy.packages) {
		if (entry.name === ROOT_PACKAGE_KEY) continue;
		if (installTimeNames.has(entry.name)) continue;
		const group = groups.get(entry.name);
		warnings.push(
			group
				? `policy entry "${entry.name}" is recorded but the installed version(s) declare no install-time lifecycle script — drop it from quality/install-scripts.json`
				: `policy entry "${entry.name}" matches no installed package — drop it from quality/install-scripts.json`,
		);
	}

	findings.sort((a, b) => a.name.localeCompare(b.name));
	publishTimeOnly.sort((a, b) => a.name.localeCompare(b.name));

	return {
		findings,
		publishTimeOnly,
		allowlist_source: allowlist.effectiveKey,
		violations: violations.sort(),
		warnings: warnings.sort(),
		summary: {
			packages_scanned: manifests.length,
			install_time_packages: findings.length,
			direct: findings.filter((finding) => finding.direct).length,
			transitive: findings.filter((finding) => !finding.direct).length,
			allowed: findings.filter((finding) => finding.decision === 'allow').length,
			blocked: findings.filter((finding) => finding.decision === 'block').length,
			unreviewed: findings.filter((finding) => finding.decision === null).length,
			elevated: findings.filter((finding) => finding.elevated).length,
			publish_time_only: publishTimeOnly.length,
			allowlist_entries: pnpmAllowlist.size,
			violations: violations.length,
			warnings: warnings.length,
		},
	};
}

/** Render the audit as the deterministic, status-only text report. */
export function formatTextReport(audit, context = {}) {
	const lines = [];
	const summary = audit.summary;
	const label = (name, versions) =>
		versions.length === 1
			? `${name}@${versions[0]}`
			: `${name} (installed: ${versions.join(', ')})`;
	lines.push('[install-script-audit] dependency install lifecycle script inventory');
	lines.push(
		`  package manager : ${context.packageManager ?? 'pnpm'} (default-deny: build scripts run only for allow-listed packages)`,
	);
	lines.push(`  policy          : ${context.policyPath ?? 'quality/install-scripts.json'}`);
	lines.push(
		`  execution allow : ${context.allowlistPath ?? 'pnpm-workspace.yaml'}${
			context.allowlistSource ? `#${context.allowlistSource} (effective grant list)` : ''
		}`,
	);
	lines.push(`  packages scanned: ${summary.packages_scanned} installed manifests`);
	lines.push('');

	lines.push(
		`Install-time lifecycle scripts (preinstall / install / postinstall, ${IMPLICIT_BUILD_HOOK}, and a git-hosted \`prepare\`) — ${summary.install_time_packages} package(s)`,
	);
	if (audit.findings.length === 0) {
		lines.push('  (none)');
	}
	for (const finding of audit.findings) {
		const name = finding.name === ROOT_PACKAGE_KEY ? '(workspace root)' : finding.name;
		const flags = [
			finding.kind === 'transitive' ? 'transitive' : finding.kind,
			finding.elevated ? 'ELEVATED preinstall' : null,
			finding.git_hosted ? 'git-hosted (prepare runs at install)' : null,
			finding.implicit_build ? 'implicit node-gyp rebuild (binding.gyp)' : null,
			finding.version_drift
				? `version drift [${finding.observed_versions.join(', ')}] -> [${finding.versions.join(', ')}]`
				: null,
		].filter(Boolean);
		lines.push(
			`  [${(finding.decision ?? 'UNREVIEWED').toUpperCase()}] ${label(name, finding.versions)}`,
		);
		lines.push(`      hooks    : ${finding.hooks.join(', ')}`);
		lines.push(`      origin   : ${flags.join(', ')}`);
		lines.push(
			finding.kind === 'root'
				? '      pnpm list: workspace root project — pnpm always runs its own `prepare`; the dependency allow-list does not apply'
				: `      pnpm list: ${finding.allowlisted ? finding.allowlist_keys.join(', ') : 'NOT ALLOW-LISTED (pnpm will not run it)'}`,
		);
		lines.push(`      why      : ${finding.justification ?? '(no recorded justification)'}`);
	}
	lines.push('');

	lines.push(
		`Publish-time-only lifecycle scripts (prepublish / prepublishOnly / prepack) — ${summary.publish_time_only} package(s); these never run during pnpm install and need no policy entry.`,
	);
	lines.push(
		`  ${audit.publishTimeOnly.map((entry) => label(entry.name, entry.versions)).join(', ') || '(none)'}`,
	);
	lines.push('');

	lines.push(`Violations (fail the gate) — ${summary.violations}`);
	for (const violation of audit.violations) lines.push(`  - ${violation}`);
	if (audit.violations.length === 0) lines.push('  (none)');
	lines.push('');
	lines.push(`Warnings (review, do not fail) — ${summary.warnings}`);
	for (const warning of audit.warnings) lines.push(`  - ${warning}`);
	if (audit.warnings.length === 0) lines.push('  (none)');
	lines.push('');
	lines.push(
		'Status-only output: package names, versions, hook names and policy text. No secret value is read or printed by this audit.',
	);
	return lines.join('\n');
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Render the same audit as a self-contained, publishable HTML
 * inspection report (used for the verification screenshot).
 *
 * The document is fully offline — inline CSS, no remote asset, no
 * script — because it is committed next to a runbook that anyone may
 * open.
 */
export function renderHtmlReport(audit, context = {}) {
	const summary = audit.summary;
	const cards = [
		['Packages scanned', summary.packages_scanned],
		['Install-time packages', summary.install_time_packages],
		['Allowed (allow-list)', summary.allowed],
		['Blocked by policy', summary.blocked],
		['Unreviewed', summary.unreviewed],
		['Elevated preinstall', summary.elevated],
		['Publish-time only', summary.publish_time_only],
		['Violations', summary.violations],
	];
	const rows = audit.findings
		.map((finding) => {
			const name = finding.name === ROOT_PACKAGE_KEY ? '(workspace root)' : finding.name;
			const decision = (finding.decision ?? 'unreviewed').toUpperCase();
			const tone = decision === 'ALLOW' ? 'ok' : decision === 'BLOCK' ? 'blocked' : 'bad';
			return `<tr>
  <td><span class="badge ${tone}">${escapeHtml(decision)}</span></td>
  <td class="pkg">${escapeHtml(name)}<span class="ver">${escapeHtml(finding.versions.join(', '))}</span></td>
  <td><code>${escapeHtml(finding.hooks.join(', '))}</code></td>
  <td>${escapeHtml(finding.kind)}${finding.elevated ? ' <span class="badge warn">PREINSTALL</span>' : ''}${
		finding.implicit_build ? ' <span class="badge warn">NODE-GYP</span>' : ''
	}${finding.git_hosted ? ' <span class="badge warn">GIT</span>' : ''}</td>
  <td class="allow">${escapeHtml(
		finding.kind === 'root'
			? 'root project (allow-list n/a)'
			: finding.allowlisted
				? finding.allowlist_keys.join(', ')
				: 'not allow-listed',
	)}</td>
  <td class="why">${escapeHtml(finding.justification ?? '(no recorded justification)')}</td>
</tr>`;
		})
		.join('\n');

	const listBlock = (items, cls) =>
		items.length === 0
			? `<p class="empty">none</p>`
			: `<ul class="${cls}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Install lifecycle script audit</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px; background: #fbfbf9; color: #1b1b19;
         font: 14px/1.55 ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color: #6b6b64; margin: 0 0 28px; font-size: 13px; }
  .cards { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 32px; }
  .card { background: #fff; border: 1px solid #e4e4de; border-radius: 8px;
          padding: 12px 16px; min-width: 132px; }
  .card .n { font-size: 22px; font-variant-numeric: tabular-nums; }
  .card .l { color: #6b6b64; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b6b64;
       margin: 28px 0 10px; }
  table { border-collapse: collapse; width: 100%; background: #fff;
          border: 1px solid #e4e4de; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #eeede7;
           vertical-align: top; font-size: 13px; }
  th { background: #f4f4f0; font-size: 11px; text-transform: uppercase;
       letter-spacing: 0.06em; color: #6b6b64; }
  tr:last-child td { border-bottom: none; }
  code { background: #f4f4f0; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .pkg { font-weight: 600; } .pkg .ver { color: #8a8a82; font-weight: 400; margin-left: 6px; }
  .why { color: #45453f; max-width: 460px; }
  .allow { color: #6b6b64; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px;
           letter-spacing: 0.06em; font-weight: 700; }
  .badge.ok { background: #e6f2e6; color: #2c6b2c; }
  .badge.blocked { background: #eef0f4; color: #4a5468; }
  .badge.bad { background: #f8e6e6; color: #8d2b2b; }
  .badge.warn { background: #fdf1dd; color: #8a5a12; }
  ul { margin: 0; padding-left: 20px; } li { margin-bottom: 4px; }
  ul.violations li { color: #8d2b2b; } ul.warnings li { color: #7a6a3a; }
  .empty { color: #6b6b64; margin: 0; }
  footer { margin-top: 36px; color: #8a8a82; font-size: 12px; border-top: 1px solid #e4e4de;
           padding-top: 14px; }
</style>
</head>
<body>
<h1>Dependency install lifecycle script audit</h1>
<p class="sub">package manager: ${escapeHtml(context.packageManager ?? 'pnpm')} &middot;
policy: ${escapeHtml(context.policyPath ?? 'quality/install-scripts.json')} &middot;
execution allow-list: ${escapeHtml(context.allowlistPath ?? 'pnpm-workspace.yaml')}${
		context.allowlistSource ? `#${escapeHtml(context.allowlistSource)}` : ''
	} &middot;
generated by <code>scripts/check-install-scripts.mjs</code></p>
<div class="cards">
${cards.map(([label, value]) => `  <div class="card"><div class="n">${escapeHtml(value)}</div><div class="l">${escapeHtml(label)}</div></div>`).join('\n')}
</div>
<h2>Install-time lifecycle scripts (declared hooks, implicit node-gyp rebuild, git-hosted prepare)</h2>
<table>
<thead><tr><th>Decision</th><th>Package</th><th>Hooks</th><th>Origin</th><th>pnpm allow-list</th><th>Why it is necessary</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<h2>Violations</h2>
${listBlock(audit.violations, 'violations')}
<h2>Warnings</h2>
${listBlock(audit.warnings, 'warnings')}
<h2>Publish-time-only packages (${summary.publish_time_only})</h2>
<p class="empty">${escapeHtml(audit.publishTimeOnly.map((entry) => entry.name).join(', ') || 'none')}</p>
<footer>Status-only report: package names, versions, hook names and policy text. No secret value is read, stored or printed by this audit.</footer>
</body>
</html>
`;
}
