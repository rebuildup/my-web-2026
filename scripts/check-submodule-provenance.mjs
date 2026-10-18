#!/usr/bin/env node
/**
 * Tool submodule supply-chain provenance gate (Issue #473).
 *
 * Usage:
 *   node scripts/check-submodule-provenance.mjs
 *   node scripts/check-submodule-provenance.mjs --require-checkout
 *   node scripts/check-submodule-provenance.mjs --root=<dir> --report=markdown
 *   node scripts/check-submodule-provenance.mjs --report=html --report-out=<file>
 *
 * Why this exists
 * ---------------
 * `scripts/check-tools-manifest.mjs` (Issue #80) proves that the
 * *recorded* gitlink SHA in the parent tree equals the SHA recorded in
 * `src/tools/manifest.json`. That is a manifest/gitlink agreement
 * check. It says nothing about where the bytes actually came from:
 *
 *   1. `.gitmodules` may point at a different repository than the
 *      manifest's `source.canonical_repo` (a fork, a typo, or an
 *      outright substitution). The manifest still matches the gitlink.
 *   2. A local `submodule.<name>.url` override or a global
 *      `url.<X>.insteadOf` rewrite silently redirects the fetch to a
 *      different origin while both recorded SHAs keep matching.
 *   3. A `branch = <ref>` key in `.gitmodules` (or
 *      `submodule.<name>.branch` in git config) makes
 *      `git submodule update --remote` / a build system's default
 *      fetch resolve to a *mutable branch tip* instead of the pinned
 *      commit — ADR-0006 §4 requires "Submodule floats /
 *      auto-updates are not used".
 *   4. The gitlink may match the manifest while the working copy at
 *      `external/<slug>/` sits at a different commit, or one of its
 *      `remote.origin` URLs points somewhere else (a second
 *      `remote.origin.url` can sit in front of the canonical one, and
 *      a fetch uses the first). The build then ships a Tool that no
 *      recorded SHA describes.
 *   4b. The working copy can be dirty without any tracked file having
 *      changed: a dropped-in source file, a `public/` asset or an
 *      auto-detected config file is untracked, `HEAD` still equals
 *      the pin, and the bytes the build collects are not the pinned
 *      commit's bytes.
 *   5. The collected build artefact may predate the current pin, so
 *      what is served under `/tools/<slug>/app/` was built from a
 *      source the manifest no longer describes.
 *
 * This gate closes 1-5. It is deliberately **status-only**: every
 * finding is a code + subject + message + remedy, it never prints a
 * credential, never lists secret values, and never performs a network
 * fetch. URLs that come from the ambient git config (an
 * `insteadOf` rewrite, a local `submodule.<name>.url`, a checkout's
 * `remote.origin`) are reported with their userinfo / query / fragment
 * replaced by `***`, because those strings can carry an access token
 * and the output of this gate is pasted into PRs and CI logs. No
 * production system is contacted; the observed facts come from the
 * committed tree, the local git config, and the local checkout only.
 * That keeps it cheap enough for `validate:fast` and keeps it safe to
 * paste into a PR.
 *
 * Contract (see docs/tools/runbook.md §6):
 *
 *   - `.gitmodules` and `src/tools/manifest.json` must agree on every
 *     submodule: same path, same repository URL.
 *   - Every fetched repository is a credential-free
 *     `https://github.com/<owner>/<repo>.git` URL. That is checked on
 *     the *raw* configured value — a URL that only looks canonical
 *     after userinfo is stripped (`https://user:TOKEN@github.com/o/r.git`)
 *     is still a fetch URL that carries a credential.
 *   - Every submodule is pinned: no `.gitmodules` `branch =` key, no
 *     `submodule.<name>.branch` config, no local `url` override, no
 *     `url.<X>.insteadOf` rewrite in **any** effective git config
 *     (per-worktree config and `include` / `includeIf` expansion
 *     included).
 *   - `pinned_sha` == gitlink SHA == checked-out HEAD.
 *   - Every configured `remote.origin.url` equals `canonical_repo`.
 *   - The checkout carries no uncommitted change and no untracked file.
 *   - When a build artefact stamp exists, it names the same pin.
 *
 * Exit codes: 0 = no error-severity finding, 1 = at least one error,
 * 2 = unusable input (unreadable root / manifest).
 */

import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const SHA_REGEX = /^[0-9a-f]{40}$/;

/** Where `build-tools.mjs` records which pin produced the artefact. */
export const PROVENANCE_STAMP_DIR = 'dist/tool-provenance';

/** Submodule config keys that mean "follow something mutable". */
const MUTABLE_TRACKING_KEYS = ['branch'];

export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

// ---------------------------------------------------------------------------
// .gitmodules parsing
// ---------------------------------------------------------------------------

/**
 * Parse a `.gitmodules` file into `{ name, path, url, keys }` records.
 *
 * A deliberately small INI reader: `.gitmodules` sections are
 * `[submodule "<name>"]` with `key = value` lines. Unknown keys are
 * preserved in `keys` so the caller can reason about them (the
 * `branch` key is the one that matters here) instead of silently
 * dropping a fetch-affecting setting.
 */
export function parseGitmodules(text) {
	const sections = [];
	let current = null;
	for (const rawLine of String(text ?? '').split('\n')) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue;
		const section = /^\[submodule\s+"(.+)"\]$/.exec(line);
		if (section) {
			// Git treats a repeated `[submodule "<name>"]` as the same
			// subsection and merges its keys (a later value wins). A
			// fresh record per occurrence would drop an earlier
			// `branch =` key as soon as a later section repeats the
			// name, and `git submodule status` would still follow the
			// branch while this parser saw none.
			const existing = sections.find((entry) => entry.name === section[1]);
			if (existing) {
				current = existing;
				continue;
			}
			current = { name: section[1], path: null, url: null, keys: {} };
			sections.push(current);
			continue;
		}
		if (!current) continue;
		const pair = /^([A-Za-z0-9-]+)\s*=\s*(.*)$/.exec(line);
		if (!pair) continue;
		// Git config variable names are case-insensitive: git itself reads
		// `Branch = main` in `.gitmodules` as `branch`. Store keys
		// lowercase so a capitalised spelling cannot slip past a rule that
		// only reads `keys.branch`.
		const key = pair[1].toLowerCase();
		current.keys[key] = pair[2];
		if (key === 'path') current.path = pair[2];
		if (key === 'url') current.url = pair[2];
	}
	return sections;
}

// ---------------------------------------------------------------------------
// URL policy
// ---------------------------------------------------------------------------

/**
 * Strip credential-shaped parts out of anything that will be printed.
 *
 * Some of the facts this gate reads come from the *ambient* git config,
 * not from the repository: `url.<base>.insteadOf` and a local
 * `submodule.<name>.url` can both carry `https://x-access-token:ghp_…@`
 * or `https://…?private_token=…`. The gate promises status-only output
 * (AGENTS.md §4: an agent must never surface a secret value), and that
 * output gets pasted into PRs and CI logs, so a URL is only ever
 * reported with its userinfo, query and fragment replaced.
 *
 * Deliberately string-based rather than `new URL(...)`: an `insteadOf`
 * value is a *prefix* (`https://`, `git@github.com:`), not a URL, and
 * must survive round-tripping unchanged.
 *
 * A credential is not always in the userinfo. `https://github.com/
 * owner/ghp_TOKEN@repo.git` puts the token in a *path* segment, where
 * `new URL()` will not classify it as userinfo; the `path@` rule below
 * redacts that shape before the value can reach stderr, a finding, or
 * a report.
 */
export function redactUrlCredentials(value) {
	if (typeof value !== 'string') return '';
	return value
		.replace(/(\/\/)[^/@\s]*@/g, '$1***@')
		.replace(/(^|\s)[A-Za-z0-9._+-]+:[^/@\s]+@/g, '$1***@')
		.replace(/(\/)[^/\s@]+@/g, '$1***@')
		.replace(/([?#]).*$/, '$1***');
}

/**
 * Canonical comparison form of a git URL. Comparison is case-insensitive
 * on the host (DNS), exact on the path (GitHub preserves case in the
 * path, and a case-different path is worth a reviewer's eyes).
 *
 * Returns `null` for anything that is not an absolute URL, so callers
 * never compare two unparseable values into a false MATCH.
 */
export function normalizeRepoUrl(url) {
	if (typeof url !== 'string') return null;
	const trimmed = url.trim();
	if (trimmed !== url || /\s/.test(trimmed)) return null;
	if (!/^https:\/\//i.test(trimmed)) return null;
	let parsed;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}
	const path = parsed.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
	if (path === '') return null;
	return `${parsed.host.toLowerCase()}${path}`;
}

/**
 * Classify a declared fetch URL against the Tool Registry policy
 * (ADR-0006 §3): a credential-free, ref-free `https://github.com`
 * repository URL. Anything else would make "the pinned SHA came from
 * where we say it came from" unverifiable.
 */
export function classifyRepoUrl(url) {
	if (typeof url !== 'string' || url.trim().length === 0) {
		return { ok: false, code: 'URL_MISSING', message: 'no url declared' };
	}
	const value = url.trim();
	// Messages are status-only output: they may be pasted into a PR or a
	// CI log, so they carry `display` (credentials stripped), never the
	// raw string, while the checks below still run on `value`.
	const display = redactUrlCredentials(value);
	if (/\s/.test(value)) {
		return { ok: false, code: 'URL_UNSAFE', message: 'url contains whitespace' };
	}
	if (/:\/\/[^/@]*@/.test(value) || /^[A-Za-z0-9._-]+@[^:]+:/.test(value)) {
		return {
			ok: false,
			code: 'URL_UNSAFE',
			message:
				'url embeds credentials or an SSH user@host transport; use https without credentials',
		};
	}
	if (!/^https:\/\//i.test(value)) {
		// Report only the scheme. The rest of the value is arbitrary
		// operator input and may carry a credential in a position
		// `redactUrlCredentials` cannot recognise.
		const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value)?.[1] ?? 'unknown';
		return {
			ok: false,
			code: 'URL_UNSAFE',
			message: `url must be https:// (got ${scheme}:); ssh/git/file transports hide the fetch source`,
		};
	}
	if (value.includes('?') || value.includes('#')) {
		return {
			ok: false,
			code: 'URL_UNSAFE',
			message: 'url must address a repository, not a ref or query',
		};
	}
	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		return { ok: false, code: 'URL_UNSAFE', message: 'unparseable url' };
	}
	if (parsed.hostname.toLowerCase() !== 'github.com') {
		return {
			ok: false,
			code: 'URL_UNSAFE',
			message: `url host must be github.com (got ${parsed.hostname})`,
		};
	}
	const segments = parsed.pathname
		.replace(/\.git$/, '')
		.split('/')
		.filter(Boolean);
	if (segments.length !== 2) {
		return {
			ok: false,
			code: 'URL_UNSAFE',
			message: 'url must be https://github.com/<owner>/<repo>.git',
		};
	}
	for (const segment of segments) {
		if (!/^[A-Za-z0-9._-]+$/.test(segment) || segment.startsWith('.') || segment.endsWith('.git')) {
			// Never echo the segment: an invalid segment is exactly
			// where a pasted access token tends to end up (see the
			// `https://github.com/owner/ghp_…@repo.git` case).
			return {
				ok: false,
				code: 'URL_UNSAFE',
				message: 'url path segment is not an owner/repo name',
			};
		}
	}
	if (/[:@{}]/.test(parsed.pathname)) {
		return {
			ok: false,
			code: 'URL_UNSAFE',
			message: 'url must not pin a ref',
		};
	}
	return { ok: true, code: 'URL_OK', message: value };
}

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

/** Run git and return stdout, or `null` when git is unavailable. */
function git(cwd, args) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
	if (result.error || result.status !== 0) return null;
	return result.stdout.trim();
}

/**
 * Parse `git ls-tree -r HEAD` output into `{ [path]: sha }` for gitlink
 * (mode 160000) entries only.
 */
export function parseGitlinkStdout(stdout) {
	const links = {};
	for (const line of String(stdout ?? '').split('\n')) {
		if (line.trim().length === 0) continue;
		const [header, path] = line.split('\t');
		if (!path) continue;
		const [mode, , sha] = header.split(/\s+/);
		if (mode !== '160000') continue;
		links[path] = sha;
	}
	return links;
}

/** Parse `git config --get-regexp` output into `{ key: value }`. */
export function parseConfigLines(stdout) {
	const entries = {};
	for (const line of String(stdout ?? '').split('\n')) {
		if (line.trim().length === 0) continue;
		const space = line.indexOf(' ');
		if (space === -1) {
			entries[line.trim()] = '';
			continue;
		}
		entries[line.slice(0, space)] = line.slice(space + 1);
	}
	return entries;
}

/**
 * Split `submodule.<name>.<key>` config keys. Submodule names may
 * contain `/` and `.`, so the key is taken from the right.
 */
export function splitSubmoduleConfigKey(key) {
	const match = /^submodule\.(.+)\.([A-Za-z0-9-]+)$/.exec(key);
	if (!match) return null;
	// As with `.gitmodules`, the config key is case-insensitive.
	return { name: match[1], configKey: match[2].toLowerCase() };
}

/** True when `path` holds an initialised submodule (a `.git` file/dir). */
export function isSubmoduleInitialised(absolutePath) {
	return existsSync(join(absolutePath, '.git'));
}

/**
 * Observe the checkout at `path` without ever trusting a parent-repo
 * answer. `git -C <uninitialised dir> rev-parse HEAD` silently walks
 * UP to the enclosing repository, which would report the host's HEAD
 * as the Tool's "actual source SHA" — so the observed toplevel must
 * match the submodule path itself.
 */
export function observeCheckout(root, path) {
	const absolutePath = isAbsolute(path) ? path : join(root, path);
	const unobserved = () => ({
		initialised: false,
		head: null,
		origin: null,
		origins: [],
		dirty: false,
		// No status was read, so it is not evidence of a clean tree.
		statusReadable: false,
		toplevelMatches: false,
	});
	if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) {
		return unobserved();
	}
	if (!isSubmoduleInitialised(absolutePath)) {
		return unobserved();
	}
	const toplevel = git(absolutePath, ['rev-parse', '--show-toplevel']);
	if (!toplevel) {
		return unobserved();
	}
	let toplevelMatches = false;
	try {
		toplevelMatches = realpathSync(toplevel) === realpathSync(absolutePath);
	} catch {
		toplevelMatches = false;
	}
	if (!toplevelMatches) {
		return unobserved();
	}
	const head = git(absolutePath, ['rev-parse', 'HEAD']);
	// Every configured value, not just the last one: a fetch uses the
	// *first* `remote.origin.url`, while `git config --get` returns only
	// the last value written. A checkout that lists an attacker's URL
	// first and the canonical URL last would otherwise pass an "the
	// origin matches" check while fetching from somewhere else.
	const origins = splitConfigValues(
		git(absolutePath, ['config', '--get-all', 'remote.origin.url']),
	);
	// Untracked files count as dirty. The bytes a build collects come
	// from the worktree, not from the tree, so a dropped-in source
	// file, a `public/` asset or an auto-detected config file makes the
	// build non-reproducible exactly like an in-place edit does — while
	// `HEAD` still equals the pin. `--untracked-files=no` used to hide
	// precisely that case. Porcelain's default mode (`normal`) still
	// honours the Tool repository's own `.gitignore`, so the
	// `node_modules/` and `dist/` the build itself creates do not trip it.
	// `null` and the empty string mean different things: an empty string
	// is a successful `--porcelain` run that reported no change, while
	// `null` is a non-zero exit (a corrupt index, a permission problem,
	// a broken worktree). `Boolean(status)` collapses both into
	// "clean", which would let a build proceed over a tree whose state
	// was never actually observed. Keep the distinction and let the
	// callers fail closed.
	const status = git(absolutePath, ['status', '--porcelain']);
	return {
		initialised: true,
		head: head && SHA_REGEX.test(head) ? head : null,
		// `origin` is the URL a fetch would use first; `origins` is every
		// value that is configured.
		origin: origins[0] ?? null,
		origins,
		dirty: Boolean(status),
		statusReadable: status !== null,
		toplevelMatches: true,
	};
}

/**
 * Collect every observed fact the pure verifier needs. Nothing here
 * touches the network and nothing here reads an environment variable
 * or a secret file.
 */
/** Split multi-value `git config --get-all` output into its values. */
export function splitConfigValues(stdout) {
	return String(stdout ?? '')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * Parse `git config --list --show-scope` output into
 * `{ scope, key, value }` records.
 *
 * Each line is `<scope>\t<key>=<value>`. Returns `null` when the output
 * carries no scope column, so the caller can tell "this git does not
 * report scopes" apart from "this config has no entries".
 */
export function parseScopedConfigStdout(stdout) {
	const text = String(stdout ?? '');
	if (text.trim().length === 0) return [];
	const entries = [];
	for (const line of text.split('\n')) {
		if (line.trim().length === 0) continue;
		const tab = line.indexOf('\t');
		// The key is the part before the first `=` after the scope column;
		// git config names never contain `=` or a tab, but a *value* may.
		const equals = tab === -1 ? -1 : line.indexOf('=', tab + 1);
		if (tab === -1 || equals === -1) return null;
		entries.push({
			scope: line.slice(0, tab).trim(),
			key: line.slice(tab + 1, equals).trim(),
			value: line.slice(equals + 1),
		});
	}
	return entries;
}

/**
 * The **effective** git config for `root`, as `{ scope, key, value }`
 * records in precedence order (low to high; the last value for a key is
 * the one `git config --get` returns).
 *
 * Enumerating `--local` / `--global` / `--system` with
 * `--get-regexp` is not the same thing as reading the effective config,
 * and the difference is load-bearing for this gate:
 *
 *   - `git config --global`/`--system`/`--local` do not expand
 *     `include` / `includeIf` unless `--includes` is passed, so a
 *     rewrite or `submodule.<name>` setting parked in an included file
 *     was invisible.
 *   - `config.worktree` (used by any checkout that enables
 *     `extensions.worktreeConfig`) is a level none of `--local` reads.
 *     A `submodule.<name>.url` or `.branch` there is what a fetch and
 *     `git submodule update` actually use, so reading only `--local`
 *     would inspect a setting that is being overridden.
 *   - `command`-scope entries (`git -c`, `GIT_CONFIG_*`) can do the same.
 *
 * `git config --list` reads every level and expands includes by
 * default, and `--show-scope` labels each entry, so one call covers the
 * whole effective config. The per-scope fallback keeps the gate working
 * on a git that does not know `--show-scope`.
 */
export function collectEffectiveConfig(root) {
	const listed = git(root, ['config', '--list', '--show-scope', '--includes']);
	const scoped = listed === null ? null : parseScopedConfigStdout(listed);
	if (scoped !== null) return scoped;
	return ['--local', '--worktree', '--global', '--system'].flatMap((flag) =>
		Object.entries(
			parseConfigLines(git(root, ['config', flag, '--includes', '--get-regexp', '^.*$']) ?? ''),
		).map(([key, value]) => ({ scope: flag.slice(2), key, value })),
	);
}

/** Every `url.<base>.insteadOf` rewrite in the effective config. */
export function collectUrlRewrites(root) {
	return collectEffectiveConfig(root).filter((entry) => /^url\..*\.insteadof$/i.test(entry.key));
}

export function collectFacts(root, manifest, gitmodules) {
	const head = git(root, ['rev-parse', 'HEAD']);
	const gitAvailable = Boolean(head);
	const gitlinks = gitAvailable
		? parseGitlinkStdout(git(root, ['ls-tree', '-r', 'HEAD']) ?? '')
		: {};

	const submoduleConfig = {};
	const submoduleConfigScopes = {};
	const urlRewrites = [];
	if (gitAvailable) {
		// Effective, not `--local`: `extensions.worktreeConfig` moves
		// `submodule.<name>.url` / `.branch` into `config.worktree`, where
		// it overrides the local value and is what git actually uses.
		for (const entry of collectEffectiveConfig(root)) {
			const split = splitSubmoduleConfigKey(entry.key);
			if (!split) continue;
			submoduleConfig[split.name] ??= {};
			submoduleConfigScopes[split.name] ??= {};
			// Precedence order, so the last value for a key wins exactly
			// as it does for `git config --get`.
			submoduleConfig[split.name][split.configKey] = entry.value;
			submoduleConfigScopes[split.name][split.configKey] = entry.scope;
		}
		for (const rewrite of collectUrlRewrites(root)) {
			urlRewrites.push(rewrite);
		}
	}

	const paths = new Set();
	for (const section of gitmodules) if (section.path) paths.add(section.path);
	for (const tool of manifest.tools ?? []) {
		const path = tool.source?.submodule_path;
		if (path && (gitlinks[path] || sectionForPath(gitmodules, path))) paths.add(path);
	}
	const checkouts = {};
	for (const path of [...paths].sort()) {
		checkouts[path] = observeCheckout(root, path);
	}

	const artifacts = {};
	const artifactProblems = {};
	for (const tool of manifest.tools ?? []) {
		if (tool.delivery?.kind !== 'same_origin_static') continue;
		const stamp = readArtifactStamp(root, tool.slug);
		artifacts[tool.slug] = stamp.stamp;
		if (stamp.problem) artifactProblems[tool.slug] = stamp.problem;
	}

	return {
		gitAvailable,
		head: head ?? null,
		gitlinks,
		submoduleConfig,
		submoduleConfigScopes,
		urlRewrites,
		checkouts,
		artifacts,
		artifactProblems,
	};
}

/**
 * Read `dist/tool-provenance/<slug>.json`.
 *
 * Returns `{ present, stamp, problem }`:
 *
 *   - `present: false` — nothing built yet (or the output was cleaned);
 *     an `info` note, not a failure.
 *   - `present: true, problem: <why>` — a stamp exists but records no
 *     usable provenance (truncated JSON, hand-edited, an older `schema`,
 *     or a missing/blank commit SHA). This is an **error**: a stamp
 *     that names no commit must not be accepted as proof that the
 *     served artefact came from the pin, and reporting it as "missing"
 *     would launder corruption into the pre-build state.
 *   - `present: true, stamp: {...}` — a stamp that records the commit
 *     it was built from; the caller compares it with the pin.
 */
export function readArtifactStamp(root, slug) {
	const stampPath = join(root, PROVENANCE_STAMP_DIR, `${slug}.json`);
	const invalid = (problem) => ({ present: true, stamp: null, problem });
	if (!existsSync(stampPath)) return { present: false, stamp: null, problem: null };
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(stampPath, 'utf8'));
	} catch {
		return invalid('is not valid JSON (a truncated or hand-edited write)');
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return invalid(
			`is a ${Array.isArray(parsed) ? 'JSON array' : 'JSON scalar'}, not a stamp object`,
		);
	}
	if (parsed.schema !== 1) {
		return invalid(`declares schema ${describeValue(parsed.schema)}, expected 1`);
	}
	for (const field of ['slug', 'canonical_repo']) {
		if (typeof parsed[field] !== 'string' || parsed[field].length === 0) {
			return invalid(`is missing the required ${field} field`);
		}
	}
	for (const field of ['pinned_sha', 'checkout_sha']) {
		if (!SHA_REGEX.test(String(parsed[field] ?? ''))) {
			return invalid(
				`records ${field} as ${describeValue(parsed[field])}, not a 40-char commit SHA`,
			);
		}
	}
	return { present: true, stamp: parsed, problem: null };
}

/** Render a JSON value for a message without ever printing `undefined`. */
function describeValue(value) {
	if (value === undefined) return 'nothing';
	try {
		return JSON.stringify(value);
	} catch {
		return 'an unreadable value';
	}
}

function sectionForPath(gitmodules, path) {
	return gitmodules.find((section) => section.path === path);
}

// ---------------------------------------------------------------------------
// Pure verification
// ---------------------------------------------------------------------------

function finding(code, severity, subject, message, remedy) {
	return { code, severity, subject, message, remedy };
}

/**
 * Pure verifier. `manifest`, `gitmodules` and `facts` are plain data,
 * so every branch below is reachable from a unit test without a git
 * repository, a network, or a Tool checkout.
 */
export function verifySubmoduleProvenance({ manifest, gitmodules, facts, options = {} }) {
	const requireCheckout = options.requireCheckout === true;
	const findings = [];
	const rows = [];
	const tools = Array.isArray(manifest?.tools) ? manifest.tools : [];
	const gitAvailable = facts.gitAvailable !== false;

	for (const rewrite of facts.urlRewrites ?? []) {
		findings.push(
			finding(
				'URL_INSTEADOF_REWRITE',
				'error',
				'git-config',
				`git config (${rewrite.scope}) ${redactUrlCredentials(rewrite.key)} rewrites fetches to "${redactUrlCredentials(rewrite.value)}"; a submodule pin resolved through this is not the recorded source`,
				'remove the url.*.insteadOf rewrite for this repository, then re-run the gate',
			),
		);
	}

	const declaredPaths = new Map();
	const declaredNamesByPath = new Map();
	for (const section of gitmodules) {
		if (!section.path) continue;
		const previousName = declaredNamesByPath.get(section.path);
		if (previousName !== undefined && previousName !== section.name) {
			// Two different submodule names claim one path. Git cannot fetch
			// both into it, and which `submodule.<name>.*` config applies is
			// ambiguous, so treat it as an error instead of silently letting
			// the last section win.
			findings.push(
				finding(
					'GITMODULES_DUPLICATE_PATH',
					'error',
					section.path,
					`.gitmodules declares ${section.path} under both "${previousName}" and "${section.name}"; one path can only be one submodule`,
					'keep a single [submodule] section for this path and drop the duplicate',
				),
			);
		}
		declaredNamesByPath.set(section.path, section.name);
		declaredPaths.set(section.path, section);
	}

	const toolByPath = new Map();
	for (const tool of tools) {
		const path = tool.source?.submodule_path;
		if (path) toolByPath.set(path, tool);
	}

	// 1. Every fetched submodule must be owned by a manifest entry, and
	//    every fetched manifest entry must be declared in .gitmodules.
	for (const [path, section] of declaredPaths) {
		if (!toolByPath.has(path)) {
			findings.push(
				finding(
					'SUBMODULE_UNDECLARED',
					'error',
					path,
					`.gitmodules declares "${section.name}" at ${path} but src/tools/manifest.json has no entry with source.submodule_path="${path}"`,
					'add the manifest entry (ADR-0006 §3) or drop the submodule; a fetch with no registry entry has no pinned provenance',
				),
			);
		}
	}

	const allPaths = new Set([...declaredPaths.keys(), ...toolByPath.keys()]);

	for (const path of [...allPaths].sort()) {
		const section = declaredPaths.get(path);
		const tool = toolByPath.get(path);
		const subject = path;
		const rowNotes = [];
		const gitlinkSha = facts.gitlinks?.[path] ?? null;
		const checkout = facts.checkouts?.[path] ?? {
			initialised: false,
			head: null,
			origin: null,
			dirty: false,
			statusReadable: false,
			toplevelMatches: false,
		};
		const pinnedSha = tool?.source?.pinned_sha ?? null;
		const canonicalRepo = tool?.source?.canonical_repo ?? null;
		const deliveryKind = tool?.delivery?.kind ?? null;
		// A manifest entry only becomes a *submodule* row once something
		// actually fetches it: a gitlink in the committed tree, a
		// `.gitmodules` entry, or an initialised checkout. An entry with
		// none of those is inventory-only (ADR-0006 §4 step 2) — its
		// recorded SHA is documentation, not an enforced contract.
		const isFetched = Boolean(gitlinkSha || section || checkout.initialised);
		const kind = isFetched || deliveryKind === 'same_origin_static' ? 'submodule' : 'inventory';

		const push = (...args) => {
			findings.push(finding(...args));
			rowNotes.push(args[0]);
		};

		if (!tool) {
			rows.push({
				kind,
				subject,
				slug: null,
				delivery_kind: null,
				pinned_sha: null,
				gitlink_sha: gitlinkSha,
				checkout_sha: checkout.head,
				origin_url: redactUrlCredentials(checkout.origin),
				artifact_pin: null,
				verdict: 'FAIL',
				codes: rowNotes,
			});
			continue;
		}

		if (pinnedSha !== null && !SHA_REGEX.test(String(pinnedSha))) {
			push(
				'PINNED_SHA_INVALID',
				'error',
				subject,
				`${tool.slug}: source.pinned_sha "${pinnedSha}" is not a 40-char lowercase hex commit SHA`,
				'record the exact commit SHA the Tool repo reported for the reviewed change',
			);
		}

		// --- fetch source identity (取得元違い) ---------------------------
		if (section) {
			const declared = classifyRepoUrl(section.url ?? '');
			if (!declared.ok) {
				push(
					'URL_UNSAFE',
					'error',
					subject,
					`${tool.slug}: .gitmodules url for "${section.name}" is not a credential-free https://github.com repository — ${declared.message}`,
					'set .gitmodules url to https://github.com/<owner>/<repo>.git with no credentials, ref, or query',
				);
			}
			const declaredNorm = normalizeRepoUrl(section.url ?? '');
			const canonicalNorm = normalizeRepoUrl(canonicalRepo ?? '');
			if (declared.ok && canonicalNorm && declaredNorm !== canonicalNorm) {
				push(
					'URL_MISMATCH',
					'error',
					subject,
					`${tool.slug}: .gitmodules fetches ${redactUrlCredentials(section.url)} but the manifest declares source.canonical_repo ${redactUrlCredentials(canonicalRepo)}`,
					'point both at the same reviewed repository, or change the manifest when the Tool is intentionally re-hosted',
				);
			}
			if (!declared.ok && canonicalNorm && declaredNorm === null) {
				push(
					'URL_MISMATCH',
					'error',
					subject,
					`${tool.slug}: .gitmodules url "${redactUrlCredentials(section.url)}" cannot be compared with the manifest's ${redactUrlCredentials(canonicalRepo)}`,
					'normalise the .gitmodules url to the manifest canonical_repo form',
				);
			}
		} else if (deliveryKind === 'same_origin_static' || gitlinkSha) {
			push(
				'DECLARED_DELIVERY_UNFETCHABLE',
				'error',
				subject,
				`${tool.slug}: manifest declares submodule_path ${path} with delivery.kind=${deliveryKind} but .gitmodules has no entry for it`,
				'add the [submodule] entry, or set delivery.kind to a non-served kind while the Tool is inventory-only',
			);
		}

		// --- branch-tip trust -------------------------------------------
		for (const key of MUTABLE_TRACKING_KEYS) {
			const fromFile = section?.keys?.[key];
			if (fromFile) {
				push(
					'BRANCH_TRACKED',
					'error',
					subject,
					`${tool.slug}: .gitmodules pins "${section.name}" to the mutable ref "${fromFile}"; submodule update --remote would replace the pinned commit with a branch tip`,
					`delete the \`${key}\` key from .gitmodules; record the upstream branch in source.branch for documentation only`,
				);
			}
		}
		const configName = section?.name ?? path;
		for (const [name, config] of Object.entries(facts.submoduleConfig ?? {})) {
			if (name !== configName) continue;
			const scopes = facts.submoduleConfigScopes?.[name] ?? {};
			const scopeOf = (key) => (scopes[key] ? ` (${scopes[key]})` : '');
			const unsetHint = (key) =>
				`git config --unset ${key === 'url' ? 'submodule.<name>.url' : `submodule.<name>.${key}`}, then re-run the gate`;
			for (const key of MUTABLE_TRACKING_KEYS) {
				if (config[key]) {
					push(
						'BRANCH_TRACKED',
						'error',
						subject,
						`${tool.slug}: git config${scopeOf(key)} submodule.${name}.${key}="${config[key]}" makes the checkout follow a mutable ref`,
						`git config --unset submodule.${name}.${key}, then re-run the gate`,
					);
				}
			}
			if (config.url) {
				// Policy first, then identity: the raw configured value has
				// to be a credential-free https GitHub repository on its
				// own. Comparing normalised forms alone would accept
				// `https://user:TOKEN@github.com/<owner>/<repo>.git`,
				// which normalises to the same owner/repo as the manifest
				// while still being a fetch URL that carries a credential.
				const configUrl = classifyRepoUrl(config.url);
				if (!configUrl.ok) {
					push(
						'URL_UNSAFE',
						'error',
						subject,
						`${tool.slug}: git config${scopeOf('url')} submodule.${name}.url is not a credential-free https://github.com repository — ${configUrl.message}`,
						unsetHint('url'),
					);
				}
				if (canonicalRepo && normalizeRepoUrl(config.url) !== normalizeRepoUrl(canonicalRepo)) {
					push(
						'LOCAL_URL_OVERRIDE',
						'error',
						subject,
						`${tool.slug}: git config${scopeOf('url')} submodule.${name}.url="${redactUrlCredentials(config.url)}" overrides the fetch source declared in the manifest (${redactUrlCredentials(canonicalRepo)})`,
						'git config --unset submodule.<name>.url, or re-run `git submodule sync` after confirming the intended source',
					);
				}
			}
		}

		// --- manifest / gitlink agreement --------------------------------
		if (isFetched && !gitlinkSha) {
			push(
				'GITLINK_MISSING',
				'error',
				subject,
				`${tool.slug}: ${path} is declared as a submodule but the committed tree has no gitlink (mode 160000) entry for it`,
				'git submodule add the path, then commit the gitlink together with the manifest entry',
			);
		}
		if (gitlinkSha && pinnedSha && gitlinkSha !== pinnedSha) {
			push(
				'GITLINK_SHA_MISMATCH',
				'error',
				subject,
				`${tool.slug}: gitlink ${gitlinkSha} does not equal source.pinned_sha ${pinnedSha}`,
				'commit the reviewed commit as the gitlink and record that same SHA in the manifest (see docs/tools/runbook.md §5)',
			);
		}

		// --- actual source vs pinned SHA (the headline check) -----------
		if (!checkout.initialised) {
			if (requireCheckout) {
				push(
					'CHECKOUT_MISSING',
					'error',
					subject,
					`${tool.slug}: ${path} is not initialised, so the actual source SHA cannot be compared with ${pinnedSha ?? 'the pin'}`,
					'git submodule update --init --recursive',
				);
			} else if (isFetched) {
				push(
					'CHECKOUT_MISSING',
					'warn',
					subject,
					`${tool.slug}: ${path} is not initialised; only the recorded gitlink was verified. The build gate (scripts/build-tools.mjs) requires the checkout`,
					'git submodule update --init --recursive',
				);
			}
		} else {
			if (!checkout.head) {
				push(
					'CHECKOUT_SHA_UNREADABLE',
					'error',
					subject,
					`${tool.slug}: ${path} is initialised but HEAD could not be read as a commit SHA`,
					`git -C ${path} status; re-initialise the submodule`,
				);
			} else if (pinnedSha && checkout.head !== pinnedSha) {
				push(
					'CHECKOUT_SHA_MISMATCH',
					'error',
					subject,
					`${tool.slug}: the checked-out source is ${checkout.head} but the pin is ${pinnedSha}; the bytes a build would use are not the bytes the manifest describes`,
					`git -C ${path} checkout ${pinnedSha} (or bump source.pinned_sha to the reviewed commit), then re-run the gate`,
				);
			}
			// Every configured `remote.origin.url`, not just the last one a
			// `git config --get` returns: a fetch uses the *first*, so a
			// checkout that lists an attacker's URL first and the canonical
			// URL last must not pass as canonical.
			const origins = checkout.origins ?? (checkout.origin ? [checkout.origin] : []);
			const canonicalNorm = normalizeRepoUrl(canonicalRepo ?? '');
			for (const origin of origins) {
				// Policy on the raw value, identity on the normalised one. A
				// URL that embeds a credential (`https://user:TOKEN@…`)
				// normalises to the same owner/repo, so it would pass an
				// identity check while still being a fetch URL that carries a
				// token — exactly what the credential-free rule forbids.
				const classified = classifyRepoUrl(origin);
				if (!classified.ok) {
					push(
						'URL_UNSAFE',
						'error',
						subject,
						`${tool.slug}: the checkout's remote.origin ${redactUrlCredentials(origin)} is not a credential-free https://github.com repository — ${classified.message}`,
						`git -C ${path} config --unset-all remote.origin.url, then git -C ${path} remote add origin ${canonicalRepo ?? 'https://github.com/<owner>/<repo>.git'} (a credential in a fetch URL becomes a credential in every CI log that prints it)`,
					);
					continue;
				}
				const originNorm = normalizeRepoUrl(origin);
				if (canonicalNorm && originNorm !== canonicalNorm) {
					push(
						'CHECKOUT_ORIGIN_MISMATCH',
						'error',
						subject,
						`${tool.slug}: the checkout's remote.origin is ${redactUrlCredentials(origin)}, not the declared ${redactUrlCredentials(canonicalRepo)}${origins.length > 1 ? ` (${origins.length} remote.origin.url values are configured and a fetch uses the first; every one of them must match)` : ''}`,
						`git -C ${path} remote set-url origin ${canonicalRepo} (drop the extra values first with \`git -C ${path} config --unset-all remote.origin.url\`)`,
					);
				}
			}
			if (checkout.statusReadable === false) {
				// Fail closed: a non-zero `git status` is not a clean tree.
				// `rev-parse HEAD` can still succeed with a corrupt index, so
				// without this branch the gate would report PASS for a
				// checkout whose modifications it never observed.
				push(
					'CHECKOUT_STATUS_UNREADABLE',
					'error',
					subject,
					`${tool.slug}: ${path} is initialised but \`git status --porcelain\` failed, so the gate cannot tell whether the worktree matches the pinned commit`,
					`git -C ${path} status; repair the checkout (corrupt index, permissions) or re-run \`git submodule update --init --recursive\``,
				);
			} else if (checkout.dirty) {
				push(
					'CHECKOUT_DIRTY',
					'warn',
					subject,
					`${tool.slug}: ${path} has uncommitted changes or untracked files, so its build is not reproducible from the pinned commit (ADR-0006 §4: the pin is a verified commit, and neither an in-place edit nor a dropped-in untracked file is it)`,
					'discard the local edit (or delete the untracked file — `git status --porcelain` in the checkout lists it), fix the Tool in its own repository, then re-checkout the pinned commit',
				);
			}
		}

		// --- build artefact provenance ----------------------------------
		const stamp = facts.artifacts?.[tool.slug] ?? null;
		const stampProblem = facts.artifactProblems?.[tool.slug] ?? null;
		if (isFetched) {
			if (stampProblem) {
				push(
					'ARTIFACT_STAMP_INVALID',
					'error',
					subject,
					`${tool.slug}: the build provenance stamp at ${PROVENANCE_STAMP_DIR}/${tool.slug}.json ${stampProblem}; a stamp that records no commit cannot prove which source the artefact was built from`,
					`pnpm run build rewrites the stamp from the current pin; remove ${PROVENANCE_STAMP_DIR}/${tool.slug}.json if the Tool is no longer served`,
				);
			} else if (!stamp) {
				push(
					'ARTIFACT_PIN_MISSING',
					'info',
					subject,
					`${tool.slug}: no build provenance stamp at ${PROVENANCE_STAMP_DIR}/${tool.slug}.json (nothing built yet, or the output was cleaned)`,
					'pnpm run build records the stamp; nothing to fix before a build has run',
				);
			} else {
				const stampSha = stamp.pinned_sha ?? null;
				const stampCheckout = stamp.checkout_sha ?? null;
				if (stampSha && pinnedSha && stampSha !== pinnedSha) {
					push(
						'ARTIFACT_PIN_MISMATCH',
						'error',
						subject,
						`${tool.slug}: the collected artefact was built from ${stampSha}, but the manifest now pins ${pinnedSha}`,
						'pnpm run build to rebuild the artefact from the current pin',
					);
				}
				if (
					stampCheckout &&
					checkout.initialised &&
					checkout.head &&
					stampCheckout !== checkout.head
				) {
					push(
						'ARTIFACT_SOURCE_MISMATCH',
						'error',
						subject,
						`${tool.slug}: the collected artefact was built from checkout ${stampCheckout}, but ${path} now sits at ${checkout.head}`,
						'pnpm run build to rebuild the artefact from the current source',
					);
				}
				if (
					stamp.canonical_repo &&
					canonicalRepo &&
					normalizeRepoUrl(stamp.canonical_repo) !== normalizeRepoUrl(canonicalRepo)
				) {
					push(
						'ARTIFACT_SOURCE_MISMATCH',
						'error',
						subject,
						`${tool.slug}: the collected artefact names source ${redactUrlCredentials(stamp.canonical_repo)}, not the declared ${redactUrlCredentials(canonicalRepo)}`,
						'pnpm run build to rebuild the artefact from the declared source',
					);
				}
			}
		}

		rows.push({
			kind,
			subject,
			slug: tool.slug,
			delivery_kind: deliveryKind,
			pinned_sha: pinnedSha,
			gitlink_sha: gitlinkSha,
			checkout_sha: checkout.head,
			origin_url: redactUrlCredentials(checkout.origin),
			artifact_pin: stamp?.pinned_sha ?? null,
			verdict: 'PASS',
			codes: rowNotes,
		});
	}

	// Inventory-only entries: a recorded pin with no fetch source at
	// all. Reportable (the pin is documentation, not an enforced
	// contract) but not an error while the Tool is not served.
	for (const tool of tools) {
		const path = tool.source?.submodule_path;
		if (!path || allPaths.has(path)) continue;
		rows.push({
			kind: 'inventory',
			subject: tool.slug,
			slug: tool.slug,
			delivery_kind: tool.delivery?.kind ?? null,
			pinned_sha: tool.source?.pinned_sha ?? null,
			gitlink_sha: null,
			checkout_sha: null,
			origin_url: null,
			artifact_pin: null,
			verdict: 'INFO',
			codes: ['INVENTORY_ONLY'],
		});
	}

	if (!gitAvailable) {
		findings.push(
			finding(
				'GIT_UNAVAILABLE',
				'warn',
				'git',
				'no readable git HEAD in this directory; recorded pins could not be compared with a committed tree',
				'run the gate from a git checkout of the repository',
			),
		);
	}

	const bySubject = new Map();
	for (const item of findings) {
		const severity = item.severity;
		const current = bySubject.get(item.subject);
		if (!current || SEVERITY_ORDER[severity] < SEVERITY_ORDER[current]) {
			bySubject.set(item.subject, severity);
		}
	}
	for (const row of rows) {
		const severity = bySubject.get(row.subject);
		if (row.kind === 'inventory') {
			// An inventory-only entry has no fetch source to verify; its
			// recorded SHA is documentation (ADR-0006 §4 step 2). INFO
			// notes about it must neither be laundered into a PASS claim
			// about a pinned submodule nor become a FAIL.
			row.verdict = 'INFO';
			continue;
		}
		if (severity === 'error') row.verdict = 'FAIL';
		else if (severity === 'warn') row.verdict = 'WARN';
	}

	const counts = {
		error: findings.filter((item) => item.severity === 'error').length,
		warn: findings.filter((item) => item.severity === 'warn').length,
		info: findings.filter((item) => item.severity === 'info').length,
	};

	return {
		ok: counts.error === 0,
		counts,
		rows,
		findings,
		gitAvailable,
	};
}

// ---------------------------------------------------------------------------
// Reporting (status-only)
// ---------------------------------------------------------------------------

const VERDICT_LABEL = {
	FAIL: 'FAIL',
	WARN: 'WARN',
	PASS: 'PASS',
	INFO: 'INFO',
};

const dash = (value) => (value === null || value === undefined || value === '' ? '—' : value);

export function summarize(result) {
	const submoduleRows = result.rows.filter((row) => row.kind !== 'inventory');
	return {
		...result,
		summary: {
			submodules: submoduleRows.length,
			passed: submoduleRows.filter((row) => row.verdict === 'PASS').length,
			warned: submoduleRows.filter((row) => row.verdict === 'WARN').length,
			failed: submoduleRows.filter((row) => row.verdict === 'FAIL').length,
			inventoryOnly: result.rows.length - submoduleRows.length,
		},
	};
}

export function renderMarkdownReport(rawResult) {
	const result = summarize(rawResult);
	const lines = [];
	lines.push('# Tool submodule provenance report');
	lines.push('');
	lines.push(
		`Result: **${result.ok ? 'PASS' : 'FAIL'}** — ${result.summary.submodules} submodule(s), ` +
			`${result.summary.passed} pass / ${result.summary.warned} warn / ${result.summary.failed} fail, ` +
			`${result.summary.inventoryOnly} inventory-only, findings: ${result.counts.error} error / ` +
			`${result.counts.warn} warn / ${result.counts.info} info`,
	);
	lines.push('');
	lines.push(
		'| kind | submodule | slug | pinned_sha | gitlink_sha | checkout_sha | origin | artefact pin | verdict |',
	);
	lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
	for (const row of result.rows) {
		lines.push(
			`| ${row.kind} | ${row.subject} | ${dash(row.slug)} | ${dash(row.pinned_sha)} | ${dash(row.gitlink_sha)} | ` +
				`${dash(row.checkout_sha)} | ${dash(row.origin_url)} | ${dash(row.artifact_pin)} | ${VERDICT_LABEL[row.verdict]} |`,
		);
	}
	lines.push('');
	if (result.findings.length === 0) {
		lines.push(
			'No findings: every fetched submodule resolves to the pinned commit at the declared source.',
		);
	} else {
		lines.push('## Findings');
		lines.push('');
		for (const item of result.findings) {
			lines.push(`- \`${item.code}\` (${item.severity}) **${item.subject}** — ${item.message}`);
			lines.push(`  - remedy: ${item.remedy}`);
		}
	}
	lines.push('');
	lines.push(
		'> Status-only report: no credential, secret value, or remote fetch is involved. Findings are derived from the committed tree, the local git config, and the local submodule checkout.',
	);
	return `${lines.join('\n')}\n`;
}

export function renderJsonReport(rawResult) {
	const result = summarize(rawResult);
	return `${JSON.stringify(result, null, 2)}\n`;
}

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function renderHtmlReport(rawResult) {
	const result = summarize(rawResult);
	const rows = result.rows
		.map(
			(row) => `      <tr class="${row.verdict.toLowerCase()}">
        <td>${escapeHtml(row.kind)}</td>
        <td><code>${escapeHtml(row.subject)}</code></td>
        <td>${escapeHtml(dash(row.slug))}</td>
        <td><code>${escapeHtml(dash(row.pinned_sha))}</code></td>
        <td><code>${escapeHtml(dash(row.gitlink_sha))}</code></td>
        <td><code>${escapeHtml(dash(row.checkout_sha))}</code></td>
        <td><code>${escapeHtml(dash(row.origin_url))}</code></td>
        <td><code>${escapeHtml(dash(row.artifact_pin))}</code></td>
        <td><span class="badge ${row.verdict.toLowerCase()}">${VERDICT_LABEL[row.verdict]}</span></td>
      </tr>`,
		)
		.join('\n');
	const findings = result.findings
		.map(
			(item) => `      <li class="${item.severity}"><code>${escapeHtml(item.code)}</code>
        <strong>${escapeHtml(item.subject)}</strong> — ${escapeHtml(item.message)}<br />
        <em>remedy:</em> ${escapeHtml(item.remedy)}</li>`,
		)
		.join('\n');
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Tool submodule provenance report</title>
    <style>
      :root { color-scheme: light; }
      body { font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; margin: 32px; color: #16181d; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      .meta { color: #5b6270; margin-bottom: 20px; }
      .summary { border: 1px solid #d8dce3; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; background: #f7f8fa; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th, td { border-bottom: 1px solid #e3e6ec; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f2f3f6; font-weight: 600; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      .badge { font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 999px; }
      .badge.pass { background: #dcf5e5; color: #12633a; }
      .badge.warn { background: #fdf0d5; color: #7a5300; }
      .badge.fail { background: #fbdcdc; color: #8c1d1d; }
      .badge.info { background: #e4ecfa; color: #234a86; }
      tr.fail td { background: #fff7f7; }
      tr.warn td { background: #fffdf5; }
      ul.findings { list-style: none; padding: 0; margin: 0; }
      ul.findings li { border-left: 3px solid #d8dce3; padding: 8px 12px; margin-bottom: 8px; background: #fafbfc; }
      ul.findings li.error { border-left-color: #c0392b; }
      ul.findings li.warn { border-left-color: #d99b1a; }
      ul.findings li.info { border-left-color: #3f6fb5; }
      .note { margin-top: 24px; color: #5b6270; font-size: 12px; }
    </style>
  </head>
  <body>
    <h1>Tool submodule provenance report</h1>
    <div class="meta">
      my-web-2026 &middot; <code>scripts/check-submodule-provenance.mjs</code> &middot; Issue #473 &middot;
      status-only output derived from a local repository fixture
    </div>
    <div class="summary">
      Result: <strong>${result.ok ? 'PASS' : 'FAIL'}</strong> &middot;
      ${result.summary.submodules} submodule(s) &middot; ${result.summary.passed} pass /
      ${result.summary.warned} warn / ${result.summary.failed} fail &middot;
      ${result.summary.inventoryOnly} inventory-only &middot;
      findings ${result.counts.error} error / ${result.counts.warn} warn / ${result.counts.info} info
    </div>
    <table>
      <thead>
        <tr>
          <th>kind</th><th>submodule</th><th>slug</th><th>pinned_sha</th><th>gitlink_sha</th>
          <th>checkout_sha</th><th>origin</th><th>artefact pin</th><th>verdict</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
    ${
			result.findings.length === 0
				? '<p>No findings: every fetched submodule resolves to the pinned commit at the declared source.</p>'
				: `<h2>Findings</h2>\n    <ul class="findings">\n${findings}\n    </ul>`
		}
    <p class="note">
      Status-only report. No credential, secret value, or remote fetch is involved: every field above is read
      from the committed tree, the local git config, and the local submodule checkout.
    </p>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArg(args, name) {
	for (const arg of args) {
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return null;
}

export function main(argv) {
	const args = argv.slice(2);
	const rootArg = parseArg(args, '--root');
	const reportFormat = parseArg(args, '--report');
	const reportOut = parseArg(args, '--report-out');
	const requireCheckout = args.includes('--require-checkout');
	const root = rootArg ? resolve(process.cwd(), rootArg) : repoRoot;

	if (args.includes('--help') || args.includes('-h')) {
		process.stdout.write(
			[
				'Usage: node scripts/check-submodule-provenance.mjs [options]',
				'',
				'  --require-checkout     treat an uninitialised submodule as an error',
				'  --root=<dir>           inspect another repository (fixture / sandbox reproduction)',
				'  --report=<format>      markdown | json | html (status-only report on stdout)',
				'  --report-out=<file>    write the report to a file instead of stdout',
				'',
			].join('\n'),
		);
		return 0;
	}

	if (!existsSync(root)) {
		process.stderr.write(`[check-submodule-provenance] root not found: ${root}\n`);
		return 2;
	}
	const manifestPath = join(root, 'src/tools/manifest.json');
	if (!existsSync(manifestPath)) {
		process.stderr.write(`[check-submodule-provenance] manifest not found: ${manifestPath}\n`);
		return 2;
	}
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch (error) {
		process.stderr.write(
			`[check-submodule-provenance] manifest is not valid JSON: ${error.message}\n`,
		);
		return 2;
	}
	const gitmodulesPath = join(root, '.gitmodules');
	const gitmodules = existsSync(gitmodulesPath)
		? parseGitmodules(readFileSync(gitmodulesPath, 'utf8'))
		: [];

	const facts = collectFacts(root, manifest, gitmodules);
	const result = summarize(
		verifySubmoduleProvenance({ manifest, gitmodules, facts, options: { requireCheckout } }),
	);

	if (reportFormat) {
		let rendered;
		if (reportFormat === 'json') rendered = renderJsonReport(result);
		else if (reportFormat === 'html') rendered = renderHtmlReport(result);
		else if (reportFormat === 'markdown') rendered = renderMarkdownReport(result);
		else {
			process.stderr.write(
				`[check-submodule-provenance] unknown --report format: ${reportFormat} (markdown|json|html)\n`,
			);
			return 2;
		}
		if (reportOut) {
			const outPath = resolve(process.cwd(), reportOut);
			mkdirSync(dirname(outPath), { recursive: true });
			writeFileSync(outPath, rendered);
			process.stdout.write(
				`[check-submodule-provenance] wrote ${reportFormat} report to ${outPath} (result: ${result.ok ? 'PASS' : 'FAIL'})\n`,
			);
		} else {
			process.stdout.write(rendered);
		}
	}

	if (result.findings.length > 0) {
		process.stderr.write(
			`[check-submodule-provenance] ${result.counts.error} error(s), ${result.counts.warn} warning(s), ${result.counts.info} note(s):\n`,
		);
		for (const item of result.findings) {
			process.stderr.write(`  [${item.severity}] ${item.code} ${item.subject}: ${item.message}\n`);
			process.stderr.write(`      remedy: ${item.remedy}\n`);
		}
	}
	process.stderr.write(
		`[check-submodule-provenance] ${result.summary.submodules} submodule(s) inspected: ${result.summary.passed} pass, ${result.summary.warned} warn, ${result.summary.failed} fail (${result.summary.inventoryOnly} inventory-only). Result: ${result.ok ? 'PASS' : 'FAIL'}\n`,
	);
	return result.ok ? 0 : 1;
}

/**
 * Only act as a CLI when invoked directly. `scripts/build-tools.mjs`
 * imports `observeCheckout` from here to refuse building a checkout
 * whose HEAD is not the pinned commit, and that import must not run the
 * gate (or exit the process).
 */
function invokedAsScript() {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (invokedAsScript()) {
	process.exit(main(process.argv));
}
