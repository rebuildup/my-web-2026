#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The repository root this module checks by default.
 *
 * `checkArchitecture(repoRoot)` takes the root as an ARGUMENT so the
 * rules can be exercised against a fixture tree
 * (`scripts/check-architecture.test.mjs`). The default is the
 * repository this file lives in, which is what the CLI uses.
 */
export const DEFAULT_REPO_ROOT = root;

const legacyClassifierRoots = ['modules', 'design-system', 'platform'];

const forbiddenOwnerDependencies = new Map([
	['cloudflare', new Set(['home'])],
	['http', new Set(['home', 'server.ts'])],
	['editorial', new Set(['home', 'cloudflare', 'http'])],
	['home', new Set(['routes', 'cloudflare', 'http'])],
	// `portfolio` (Issue #76) is a peer obligation to `home`.
	// It reads D1 / R2 via the cloudflare runtime (no direct
	// dependency edge) and consumes `editorial` primitives. It must
	// not import from `home`, `routes`, or `http` (peer / route /
	// external HTTP boundary responsibilities).
	['portfolio', new Set(['home', 'routes', 'http'])],
	// `about` (Issue #102) is a peer obligation to `home` and
	// `portfolio`. It composes repo-controlled narrative copy with
	// a narrative subset of public portfolio projects; it must
	// not import from `home` (peer obligation), `routes` (the
	// route layer is the consumer), `cloudflare` (server-fn pattern
	// keeps `cloudflare:workers` virtual-module access out of the
	// obligation), or `http` (external HTTP boundary).
	['about', new Set(['home', 'routes', 'cloudflare', 'http'])],
	// `logging` (Issue #467) is a LEAF obligation: it owns the runtime
	// log-redaction contract (what may appear in a console record) and
	// knows nothing about the obligations whose logs it redacts. Every
	// other owner imports it; it imports none of them. Keeping it a leaf
	// is what makes "no owner can log a raw payload" enforceable as a
	// structural fact rather than a review convention.
	[
		'logging',
		new Set([
			'about',
			'admin',
			'cloudflare',
			'contact',
			'editorial',
			'home',
			'http',
			'portfolio',
			'reactions',
			'routes',
			'server.ts',
			'tools',
		]),
	],
	// `external-api` (Issue #499) owns the reliability contract for
	// reads of a third-party API behind a display component. It is a
	// peer obligation to `home` / `portfolio` / `about`, not a layer
	// under them: it composes `editorial` primitives and performs its
	// own outbound request, so it may not reach into a peer obligation,
	// the route layer, the Cloudflare runtime or the inbound HTTP
	// boundary.
	//
	// The rule below is ONE DIRECTION: `external-api` may not import
	// those owners. The reverse edge (`home` / `portfolio` / `about` /
	// `routes` importing `external-api`) is NOT registered here — today
	// no file does, and whether that edge should be a hard guard or stay
	// open for a promoting capability is an owner decision recorded in
	// `docs/verification/ops/api-timeout-fallback.md` §7.
	['external-api', new Set(['home', 'routes', 'portfolio', 'about', 'cloudflare', 'http'])],
	// `keyboard` (Issue #620) owns the read-only keyboard-layout
	// reference: the allowlisted source snapshot, its provenance, the
	// Kanata / hidutil parsers and the key-position display model. It is
	// a peer surface, not a layer: it composes `editorial` primitives
	// and may not reach into another peer obligation, the route layer,
	// the Cloudflare runtime or the inbound HTTP boundary.
	[
		'keyboard',
		new Set(['home', 'routes', 'portfolio', 'about', 'cloudflare', 'http', 'server.ts']),
	],
	// `projects` (Issue #621) owns the public project-introduction contract:
	// the committed snapshot shape, its reader-side validation, and the page
	// that composes it. It is a peer obligation to `home` / `portfolio` /
	// `about`, so it may not import those owners, the route layer, the
	// Cloudflare runtime or the inbound HTTP boundary. It composes
	// `editorial` primitives and reads only its own committed snapshot.
	['projects', new Set(['home', 'routes', 'portfolio', 'about', 'cloudflare', 'http'])],
	// `personal` (Issue #709) owns the structured display data and the
	// standalone preview of the personal documents (the philosophy, the
	// making motivation, the brand naming record, the influence notes).
	// It is a peer obligation to `home` / `portfolio` / `about`: it
	// composes `editorial` display primitives and reads no route, no
	// binding and no peer obligation. Its boundary is registered as an
	// ALLOWLIST in `allowedOwnerDependencies` below, because AGENTS.md §3
	// declares exactly one edge for it (`personal -> editorial`) and a
	// denylist could not keep that true once a new peer owner appears.
	// `legal` (Issue #497) owns the publication-rights review contract for
	// the assets this repository ships and references: which rights
	// holder, which licence and which evidence back a shipped byte, and
	// what a reader is shown. It is a peer obligation, not a layer: it
	// reads a committed record, composes `editorial` primitives, and
	// touches no binding, no peer obligation, no route and no boundary.
	// The gate (`scripts/check-asset-licenses.mjs`) is a consumer, not an
	// exception: it imports the same rules, so the rules stay in `src/`.
	['legal', new Set(['home', 'routes', 'portfolio', 'about', 'cloudflare', 'http', 'logging'])],
]);

/**
 * Owners whose boundary is an ALLOWLIST rather than a denylist.
 *
 * A denylist can only forbid the owners it names, so an owner added to
 * the repository later would enter it silently. When AGENTS.md §3
 * declares that an owner has exactly ONE permitted edge, the rule has
 * to be an allowlist, or the declared boundary is not the enforced one.
 *
 * `personal` (Issue #709) is such an owner: AGENTS.md §3 declares
 * `personal -> editorial` and nothing else. The personal-document
 * preview renders display primitives and reads no route, no binding and
 * no peer obligation, so every other owner directory is forbidden —
 * including one that does not exist yet.
 */
const allowedOwnerDependencies = new Map([['personal', new Set(['editorial'])]]);

/**
 * Directories whose contents are considered "parent" for the
 * Tool-boundary rule. The parent MUST NOT import from any path
 * matching `external/<slug>/src/**`.
 */
const parentSourceRoots = ['src', 'scripts', 'e2e', 'migrations'];

/**
 * Leaf obligations (Issue #433): pure policy that owns a rule, not a
 * surface, so it may not depend on any other obligation. Keeping the
 * rule at the bottom of the graph is what lets `home/`, `portfolio/`,
 * `reactions/`, `admin/` and `routes/` all obey the same Unicode /
 * slug policy without any of them depending on each other.
 *
 * The exemption is for EVERY `*.test.*` / `*.spec.*` file under a
 * leaf obligation, not just the one file that needs it today: a
 * decision table's tests assert that the policy agrees with the
 * owner-owned grammars it was written against
 * (`src/i18n/fixtures.test.ts` imports `EMOJI_SLUG_GRAMMAR` and
 * `PORTFOLIO_SLUG_GRAMMAR`), and that shape is not going to be
 * special-cased per file. The RULE the leaf states — "policy depends
 * on nothing" — is still enforced on every implementation module.
 */
const leafOwners = new Set(['i18n', 'privacy']);

function isTestFile(path, srcDirectory) {
	return /\.(test|spec)\.tsx?$/.test(relative(srcDirectory, path).split(sep).join('/'));
}

/**
 * Owner pairs where the dependency is allowed only through
 * `import type ...`. These exceptions preserve the runtime owner
 * graph because TypeScript erases the edge under
 * `verbatimModuleSyntax`.
 *
 * Every entry must also be documented in AGENTS.md §3.
 */
const typeOnlyEdges = [{ from: 'home', to: 'http' }];

function sourceFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return ['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extname(path)) ? [path] : [];
	});
}

function ownerOf(path, srcDirectory) {
	const rel = relative(srcDirectory, path);
	if (rel.startsWith('..')) return null;
	return rel.split(sep)[0] ?? null;
}

/**
 * Whether a first path segment under `src/` names an OWNER directory.
 *
 * `ownerOf` returns the first path segment of any file, so `src/styles.css`
 * yields `styles.css` and `src/routeTree.gen.ts` yields
 * `routeTree.gen.ts`. Those are files, not obligations. An allowlist rule
 * has to tell the two apart, because it forbids everything that is not on
 * the list — including a file that belongs to no owner at all.
 *
 * @param {string} name first path segment
 * @param {string} srcDirectory the repository's `src/` directory
 */
function isOwnerDirectory(name, srcDirectory) {
	if (!name) return false;
	try {
		return statSync(join(srcDirectory, name)).isDirectory();
	} catch {
		return false;
	}
}

function isHomeStatusFile(path, srcDirectory) {
	const rel = relative(srcDirectory, path).split(sep).join('/');
	return rel.startsWith('home/status/');
}

function resolveInternalImport(fromFile, specifier, srcDirectory) {
	if (specifier.startsWith('.')) return resolve(dirname(fromFile), specifier);
	if (specifier.startsWith('~/')) return resolve(srcDirectory, specifier.slice(2));
	return null;
}

/**
 * Static ES imports with their runtime/type-only character.
 */
function importStatements(source) {
	const re = /(?:^|\n)\s*import\s+(?:type\s+)?[^"';]*?["']([^"']+)["']/g;
	const stmts = [];
	for (const match of source.matchAll(re)) {
		const full = match[0].slice(match[0].indexOf('import')).replace(/\s+/g, ' ').trimStart();
		const head = full.slice('import'.length).trimStart();
		stmts.push({
			full,
			isTypeOnly: head.startsWith('type '),
			specifier: match[1],
		});
	}
	return stmts;
}

/**
 * Runtime-only imports that are not covered by `importStatements`:
 * side-effect imports and dynamic imports.
 */
function runtimeImportSpecifiers(source) {
	const specs = new Set();
	for (const pattern of [/\bimport\s+["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g]) {
		for (const match of source.matchAll(pattern)) specs.add(match[1]);
	}
	return specs;
}

function isTypeOnlyEdge(from, to) {
	return typeOnlyEdges.some((edge) => edge.from === from && edge.to === to);
}

/**
 * Tool-boundary patterns (ADR-0006 §2 / §3).
 */
const TOOL_SRC_PATTERN = /^external\/[a-z0-9][a-z0-9-]{0,127}\/src(\/|$)/;
const PARENT_SRC_PATTERN = /^(\.\.\/)+src(\/|$)/;
const TOOL_PACKAGE_PATTERN = /^external\/[a-z0-9][a-z0-9-]{0,127}\/package\.json$/;
const TOOL_DIST_PATTERN = /^external\/[a-z0-9][a-z0-9-]{0,127}\/dist(\/|$)/;

function collectJsLikeFiles(directory) {
	const out = [];
	const stack = [directory];
	while (stack.length > 0) {
		const dir = stack.pop();
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const p = join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(p);
			} else if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extname(p))) {
				out.push(p);
			}
		}
	}
	return out;
}

/**
 * Returns the list of `import` specifiers in `source` that violate
 * the Tool-boundary rules. The caller passes the file path so we can
 * disambiguate `parent → Tool` from `Tool → parent`.
 */
function boundaryImportViolations(source, fromFileRel) {
	const violations = [];
	const isParentFile = parentSourceRoots.some(
		(rootName) => fromFileRel === rootName || fromFileRel.startsWith(`${rootName}/`),
	);
	const isToolFile = fromFileRel.startsWith('external/');
	if (!isParentFile && !isToolFile) return violations;

	const specifiers = new Set();
	for (const re of [
		/(?:^|\n)\s*import\s+(?:type\s+)?[^"';]*?["']([^"']+)["']/g,
		/\bimport\s+["']([^"']+)["']/g,
		/\bimport\(\s*["']([^"']+)["']\s*\)/g,
	]) {
		for (const match of source.matchAll(re)) specifiers.add(match[1]);
	}

	for (const spec of specifiers) {
		// Parent → Tool src/package/dist is forbidden.
		if (isParentFile) {
			if (TOOL_SRC_PATTERN.test(spec)) {
				violations.push(
					`${fromFileRel}: parent must not import from Tool source (${spec}) — ADR-0006 §2`,
				);
			}
			if (TOOL_PACKAGE_PATTERN.test(spec)) {
				violations.push(
					`${fromFileRel}: parent must not import a Tool's package.json (${spec}) — ADR-0006 §3`,
				);
			}
			if (TOOL_DIST_PATTERN.test(spec)) {
				violations.push(
					`${fromFileRel}: parent must not import a Tool's build output (${spec}) — ADR-0006 §3`,
				);
			}
		}
		// Tool → parent src is forbidden.
		if (isToolFile) {
			if (PARENT_SRC_PATTERN.test(spec)) {
				violations.push(`${fromFileRel}: Tool must not import parent src (${spec}) — ADR-0006 §2`);
			}
		}
	}
	return violations;
}

/**
 * Run every obligation-boundary rule against a repository tree.
 *
 * The rules are:
 *
 *   - a **leaf** obligation (`i18n`, `privacy`) may not depend on any
 *     other owner, statically or at runtime;
 *   - an owner may not depend on the owners registered for it in
 *     `forbiddenOwnerDependencies`, with the type-only edges and the
 *     `home/status` exception honoured;
 *   - an owner registered in `allowedOwnerDependencies` may depend ONLY
 *     on the owners listed there, so a peer owner that does not exist
 *     yet cannot enter the graph unnoticed;
 *   - the parent may not import a Tool's source / package.json / build
 *     output, and a Tool may not import the parent's source.
 *
 * The leaf rule is checked for EVERY file under a leaf owner, whether or
 * not that owner appears in `forbiddenOwnerDependencies`. It used to be
 * evaluated AFTER the `if (!forbidden) continue;` early return, and
 * since no leaf owner is a key of that map the rule was unreachable:
 * AGENTS.md §3 declared the leaf rule enforced while the code could
 * never fire it. `scripts/check-architecture.test.mjs` pins the rule
 * with a fixture so that shape cannot come back.
 *
 * @param {string} repoRoot repository root to check
 * @returns {string[]} the violations, empty when the tree is clean
 */
export function checkArchitecture(repoRoot) {
	const sourceRoot = join(repoRoot, 'src');
	const errors = [];

	for (const name of legacyClassifierRoots) {
		if (existsSync(join(sourceRoot, name))) {
			errors.push(
				`src/${name}/ is a legacy classifier root. Reintroducing it requires an explicit ADR-0008 boundary decision.`,
			);
		}
	}

	for (const file of sourceFiles(sourceRoot)) {
		const fromOwner = ownerOf(file, sourceRoot);
		const forbidden = forbiddenOwnerDependencies.get(fromOwner);
		const allowed = allowedOwnerDependencies.get(fromOwner);
		const isLeaf = leafOwners.has(fromOwner) && !isTestFile(file, sourceRoot);
		// A leaf owner has NO entry in `forbiddenOwnerDependencies` — that
		// is the POINT of a leaf: nothing forbids it from depending on
		// another owner, because it may not depend on any of them. The
		// leaf rule therefore has to be evaluated BEFORE the
		// `forbidden`-based early return below, or it never runs.
		if (!isLeaf && !forbidden && !allowed) continue;

		const source = readFileSync(file, 'utf8');
		const staticImports = importStatements(source);
		const runtimeImports = runtimeImportSpecifiers(source);

		if (isLeaf) {
			const specifiers = [...staticImports.map((stmt) => stmt.specifier), ...runtimeImports];
			for (const specifier of specifiers) {
				const target = resolveInternalImport(file, specifier, sourceRoot);
				if (!target) continue;
				const toOwner = ownerOf(target, sourceRoot);
				if (!toOwner || toOwner === fromOwner) continue;
				errors.push(
					`${relative(repoRoot, file)}: ${fromOwner} is a leaf obligation and must not depend on ${toOwner} (${specifier})`,
				);
			}
		}

		// An ALLOWLIST boundary (Issue #709): the owner may depend on the
		// listed owners and on nothing else. The check is by owner
		// DIRECTORY, so a peer owner that does not exist yet is forbidden
		// too — that is the whole point of the allowlist over a denylist.
		if (allowed) {
			const permitted = [...allowed].join(', ');
			const specifiers = [...staticImports.map((stmt) => stmt.specifier), ...runtimeImports];
			for (const specifier of specifiers) {
				const target = resolveInternalImport(file, specifier, sourceRoot);
				if (!target) continue;
				const toOwner = ownerOf(target, sourceRoot);
				if (!toOwner || toOwner === fromOwner) continue;
				// A file directly under `src/` (`styles.css`,
				// `routeTree.gen.ts`) belongs to no owner, so it is not
				// part of the obligation graph.
				if (!isOwnerDirectory(toOwner, sourceRoot)) continue;
				if (allowed.has(toOwner)) continue;
				errors.push(
					`${relative(repoRoot, file)}: ${fromOwner} may only depend on ${permitted} (saw ${specifier})`,
				);
			}
		}

		if (!forbidden) continue;

		for (const stmt of staticImports) {
			const target = resolveInternalImport(file, stmt.specifier, sourceRoot);
			if (!target) continue;
			const toOwner = ownerOf(target, sourceRoot);
			if (!toOwner || !forbidden.has(toOwner)) continue;

			const allowedHomeStatusRuntimeDependency =
				fromOwner === 'home' &&
				isHomeStatusFile(file, sourceRoot) &&
				(toOwner === 'cloudflare' || toOwner === 'http');
			if (allowedHomeStatusRuntimeDependency) continue;

			if (isTypeOnlyEdge(fromOwner, toOwner) && stmt.isTypeOnly) continue;

			if (isTypeOnlyEdge(fromOwner, toOwner)) {
				errors.push(
					`${relative(repoRoot, file)}: ${fromOwner} may only import types from ${toOwner} (saw runtime import: ${stmt.specifier})`,
				);
				continue;
			}

			errors.push(
				`${relative(repoRoot, file)}: ${fromOwner} must not depend on ${toOwner} (${stmt.specifier})`,
			);
		}

		for (const specifier of runtimeImports) {
			const target = resolveInternalImport(file, specifier, sourceRoot);
			if (!target) continue;
			const toOwner = ownerOf(target, sourceRoot);
			if (!toOwner || !forbidden.has(toOwner)) continue;

			const allowedHomeStatusRuntimeDependency =
				fromOwner === 'home' &&
				isHomeStatusFile(file, sourceRoot) &&
				(toOwner === 'cloudflare' || toOwner === 'http');
			if (allowedHomeStatusRuntimeDependency) continue;

			errors.push(
				`${relative(repoRoot, file)}: ${fromOwner} must not runtime-import ${toOwner} (${specifier})`,
			);
		}
	}

	// Tool-boundary rules (ADR-0006 §2 / §3), enforced in two passes:
	// one over each parent source root, one over each checked-out Tool
	// submodule. Both passes share `boundaryImportViolations`.
	for (const rootName of parentSourceRoots) {
		const dir = join(repoRoot, rootName);
		if (!existsSync(dir)) continue;
		for (const file of collectJsLikeFiles(dir)) {
			const rel = relative(repoRoot, file);
			const source = readFileSync(file, 'utf8');
			errors.push(...boundaryImportViolations(source, rel));
		}
	}

	// Pass 2: each checked-out Tool submodule (best effort; submodules may
	// not be initialised in CI without `git submodule update --init`).
	const externalRoot = join(repoRoot, 'external');
	if (existsSync(externalRoot)) {
		for (const entry of readdirSync(externalRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const toolRoot = join(externalRoot, entry.name);
			// Skip if it's a placeholder directory (not a real submodule).
			if (!existsSync(join(toolRoot, '.git'))) continue;
			const srcDir = join(toolRoot, 'src');
			if (!existsSync(srcDir)) continue;
			for (const file of collectJsLikeFiles(srcDir)) {
				const rel = relative(repoRoot, file);
				const source = readFileSync(file, 'utf8');
				errors.push(...boundaryImportViolations(source, rel));
			}
		}
	}

	return errors;
}

/**
 * CLI entry point.
 *
 * `--root=<dir>` points the check at another tree;
 * `scripts/check-architecture.test.mjs` uses it to exercise the rules
 * against a fixture. Without it the repository this file lives in is
 * checked.
 *
 * Exit codes: 0 = clean, 1 = violations, 2 = bad input.
 */
function main(argv) {
	const rootArg = argv.find((arg) => arg.startsWith('--root='));
	const repoRoot = rootArg ? resolve(rootArg.slice('--root='.length)) : DEFAULT_REPO_ROOT;

	if (!existsSync(join(repoRoot, 'src'))) {
		console.error(`[architecture:check] no src/ directory under ${repoRoot}`);
		return 2;
	}

	const errors = checkArchitecture(repoRoot);
	if (errors.length > 0) {
		console.error('[architecture:check] obligation boundary violations:');
		for (const error of errors) console.error(`- ${error}`);
		return 1;
	}

	console.error('[architecture:check] obligation boundaries OK');
	return 0;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exitCode = main(process.argv.slice(2));
}
