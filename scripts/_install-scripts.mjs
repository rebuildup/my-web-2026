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
 * NOT here: pnpm does not run a registry dependency's `prepare`, only
 * the workspace root project's own.
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

export const KNOWN_HOOKS = [...INSTALL_TIME_HOOKS, ...ROOT_INSTALL_HOOKS, ...PUBLISH_TIME_HOOKS];

/** Policy decisions. Default is deny (see `parsePolicy`). */
export const DECISIONS = ['allow', 'block'];

/** Policy key for the workspace root project (`package.json` itself). */
export const ROOT_PACKAGE_KEY = '.';

export const POLICY_VERSION = 1;

/** `preinstall` runs before anything else; flag it in every report. */
export const ELEVATED_HOOKS = ['preinstall'];

/**
 * Split a manifest's `scripts` map into the three firing classes.
 * Only hooks whose value is a non-empty string count — npm treats a
 * non-string / empty script as absent.
 */
export function classifyHooks(scripts) {
	const source = scripts && typeof scripts === 'object' ? scripts : {};
	const installTime = [];
	const rootInstallTime = [];
	const publishTime = [];
	for (const hook of KNOWN_HOOKS) {
		const value = source[hook];
		if (typeof value !== 'string' || value.trim() === '') continue;
		if (INSTALL_TIME_HOOKS.includes(hook)) installTime.push(hook);
		else if (ROOT_INSTALL_HOOKS.includes(hook)) rootInstallTime.push(hook);
		else publishTime.push(hook);
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
 * Read the pnpm execution allow-list out of `pnpm-workspace.yaml`.
 *
 * Deliberately a targeted line reader rather than a YAML dependency:
 * only the two top-level keys that decide whether a lifecycle script
 * runs are needed, and both shapes pnpm accepts are sequences
 * (`onlyBuiltDependencies`) and maps (`allowBuilds: {name: true}`).
 * Adding a YAML parser for this would be a dependency whose own
 * install surface the audit then has to audit.
 */
export function readPnpmAllowlist(rawText) {
	const names = new Map(); // name -> declaring keys, sorted
	const errors = [];
	const lines = String(rawText ?? '').split('\n');
	const wanted = new Set(['onlyBuiltDependencies', 'allowBuilds']);
	let activeKey = null;
	for (const rawLine of lines) {
		const line = rawLine.replace(/\t/g, '  ');
		if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
		const indent = line.length - line.trimStart().length;
		const topLevel = indent === 0;
		if (topLevel) {
			const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line.trim());
			activeKey = match && wanted.has(match[1]) ? match[1] : null;
			if (activeKey === null) continue;
			const inline = match[2].trim();
			if (inline.startsWith('[') && inline.endsWith(']')) {
				for (const item of inline.slice(1, -1).split(',')) {
					const name = unquote(item.trim());
					if (name) record(names, name, activeKey);
				}
				activeKey = null;
			}
			continue;
		}
		if (activeKey === null) continue;
		const item = /^\s*-\s*(.+)$/.exec(line);
		if (item) {
			const name = unquote(item[1].split('#')[0].trim());
			if (name) record(names, name, activeKey);
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
			if (value === 'true') record(names, name, activeKey);
		}
	}
	return { names, errors };
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
 * pnpm stores the real directories under `node_modules/.pnpm/...` and
 * exposes them as symlinks at the top level, so records are keyed by
 * realpath to keep one package one record.
 */
export function collectInstalledManifests(rootDir, options = {}) {
	const maxDepth = options.maxDepth ?? 8;
	const manifests = new Map(); // realpath -> record
	const visited = new Set();
	const queue = [{ dir: options.manifestsDir ?? joinNodePath(rootDir, 'node_modules'), depth: 0 }];
	while (queue.length > 0) {
		const current = queue.pop();
		let realDir;
		try {
			realDir = realpathSync(current.dir);
		} catch {
			continue;
		}
		if (visited.has(realDir)) continue;
		visited.add(realDir);

		const manifest = readPackageManifest(joinNodePath(current.dir, 'package.json'));
		if (manifest) manifests.set(realDir, manifest);

		if (current.depth >= maxDepth) continue;
		for (const name of listDirectories(current.dir)) {
			if (name === '.bin') continue;
			queue.push({ dir: joinNodePath(current.dir, name), depth: current.depth + 1 });
		}
		const nested = joinNodePath(current.dir, 'node_modules');
		if (existsSync(nested)) {
			queue.push({ dir: nested, depth: current.depth + 1 });
		}
	}
	return [...manifests.values()];
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

/**
 * Group installed manifests by package name.
 *
 * pnpm's virtual store legitimately holds several versions of the
 * same package (`workerd` follows `@cloudflare/vitest-plugin` and the
 * Worker runtime pins separately), so a policy record — and a report
 * row — has to be about the *name*, not one directory. Versions are
 * collected as a sorted set so the report stays deterministic.
 */
export function groupInstalledByName(manifests) {
	const groups = new Map();
	for (const manifest of manifests) {
		const hooks = classifyHooks(manifest.scripts);
		let group = groups.get(manifest.name);
		if (!group) {
			group = {
				name: manifest.name,
				versions: new Set(),
				hooks: new Set(),
				publishTimeHooks: new Set(),
				rootHooks: new Set(),
			};
			groups.set(manifest.name, group);
		}
		group.versions.add(manifest.version);
		for (const hook of hooks.installTime) group.hooks.add(hook);
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
		pnpmAllowlist = new Map(),
		directNames = new Set(),
	} = input;

	const violations = [];
	const warnings = [];
	const findings = [];
	const publishTimeOnly = [];

	const groups = groupInstalledByName(manifests);
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
			warnings.push(
				`${name}: policy observed version(s) [${recorded.join(', ')}] != installed [${sortedVersions.join(', ')}] — re-review the new version's lifecycle scripts and update the record`,
			);
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

	const rootHooks = rootManifest ? classifyHooks(rootManifest.scripts) : null;
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
	lines.push(`  execution allow : ${context.allowlistPath ?? 'pnpm-workspace.yaml'}`);
	lines.push(`  packages scanned: ${summary.packages_scanned} installed manifests`);
	lines.push('');

	lines.push(
		`Install-time lifecycle scripts (preinstall / install / postinstall) — ${summary.install_time_packages} package(s)`,
	);
	if (audit.findings.length === 0) {
		lines.push('  (none)');
	}
	for (const finding of audit.findings) {
		const name = finding.name === ROOT_PACKAGE_KEY ? '(workspace root)' : finding.name;
		const flags = [
			finding.kind === 'transitive' ? 'transitive' : finding.kind,
			finding.elevated ? 'ELEVATED preinstall' : null,
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
  <td>${escapeHtml(finding.kind)}${finding.elevated ? ' <span class="badge warn">PREINSTALL</span>' : ''}</td>
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
execution allow-list: ${escapeHtml(context.allowlistPath ?? 'pnpm-workspace.yaml')} &middot;
generated by <code>scripts/check-install-scripts.mjs</code></p>
<div class="cards">
${cards.map(([label, value]) => `  <div class="card"><div class="n">${escapeHtml(value)}</div><div class="l">${escapeHtml(label)}</div></div>`).join('\n')}
</div>
<h2>Install-time lifecycle scripts (preinstall / install / postinstall)</h2>
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
