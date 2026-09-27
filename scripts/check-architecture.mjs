#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'src');

const legacyClassifierRoots = ['modules', 'design-system', 'platform'];

const forbiddenOwnerDependencies = new Map([
	['cloudflare', new Set(['home'])],
	['http', new Set(['home', 'server.ts'])],
	['editorial', new Set(['home', 'cloudflare', 'http'])],
	['home', new Set(['routes', 'cloudflare', 'http'])],
]);

/**
 * Directories whose contents are considered "parent" for the
 * Tool-boundary rule. The parent MUST NOT import from any path
 * matching `external/<slug>/src/**`.
 */
const parentSourceRoots = ['src', 'scripts', 'e2e', 'migrations'];

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

function ownerOf(path) {
	const rel = relative(srcRoot, path);
	if (rel.startsWith('..')) return null;
	return rel.split(sep)[0] ?? null;
}

function isHomeStatusFile(path) {
	const rel = relative(srcRoot, path).split(sep).join('/');
	return rel.startsWith('home/status/');
}

function resolveInternalImport(fromFile, specifier) {
	if (specifier.startsWith('.')) return resolve(dirname(fromFile), specifier);
	if (specifier.startsWith('~/')) return resolve(srcRoot, specifier.slice(2));
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

const errors = [];

for (const name of legacyClassifierRoots) {
	if (existsSync(join(srcRoot, name))) {
		errors.push(
			`src/${name}/ is a legacy classifier root. Reintroducing it requires an explicit ADR-0008 boundary decision.`,
		);
	}
}

for (const file of sourceFiles(srcRoot)) {
	const fromOwner = ownerOf(file);
	const forbidden = forbiddenOwnerDependencies.get(fromOwner);
	if (!forbidden) continue;

	const source = readFileSync(file, 'utf8');
	const staticImports = importStatements(source);
	const runtimeImports = runtimeImportSpecifiers(source);

	for (const stmt of staticImports) {
		const target = resolveInternalImport(file, stmt.specifier);
		if (!target) continue;
		const toOwner = ownerOf(target);
		if (!toOwner || !forbidden.has(toOwner)) continue;

		const allowedHomeStatusRuntimeDependency =
			fromOwner === 'home' &&
			isHomeStatusFile(file) &&
			(toOwner === 'cloudflare' || toOwner === 'http');
		if (allowedHomeStatusRuntimeDependency) continue;

		if (isTypeOnlyEdge(fromOwner, toOwner) && stmt.isTypeOnly) continue;

		if (isTypeOnlyEdge(fromOwner, toOwner)) {
			errors.push(
				`${relative(root, file)}: ${fromOwner} may only import types from ${toOwner} (saw runtime import: ${stmt.specifier})`,
			);
			continue;
		}

		errors.push(
			`${relative(root, file)}: ${fromOwner} must not depend on ${toOwner} (${stmt.specifier})`,
		);
	}

	for (const specifier of runtimeImports) {
		const target = resolveInternalImport(file, specifier);
		if (!target) continue;
		const toOwner = ownerOf(target);
		if (!toOwner || !forbidden.has(toOwner)) continue;

		const allowedHomeStatusRuntimeDependency =
			fromOwner === 'home' &&
			isHomeStatusFile(file) &&
			(toOwner === 'cloudflare' || toOwner === 'http');
		if (allowedHomeStatusRuntimeDependency) continue;

		errors.push(
			`${relative(root, file)}: ${fromOwner} must not runtime-import ${toOwner} (${specifier})`,
		);
	}
}

/**
 * Tool-boundary rules (ADR-0006 §2):
 *   - parent MUST NOT import from `external/<slug>/src/**`
 *   - Tool source MUST NOT import from `../../src/**` of the parent
 *   - parent MUST NOT import from a Tool's `package.json` / build output
 *
 * Enforced in two passes: one over each parent source root, one over
 * each checked-out Tool submodule. Both passes share
 * `boundaryImportViolations`.
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

// Pass 1: parent source roots
for (const rootName of parentSourceRoots) {
	const dir = join(root, rootName);
	if (!existsSync(dir)) continue;
	for (const file of collectJsLikeFiles(dir)) {
		const rel = relative(root, file);
		const source = readFileSync(file, 'utf8');
		errors.push(...boundaryImportViolations(source, rel));
	}
}

// Pass 2: each checked-out Tool submodule (best effort; submodules may
// not be initialised in CI without `git submodule update --init`).
const externalRoot = join(root, 'external');
if (existsSync(externalRoot)) {
	for (const entry of readdirSync(externalRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const toolRoot = join(externalRoot, entry.name);
		const stat = statSync(toolRoot);
		// Skip if it's a placeholder directory (not a real submodule).
		if (!existsSync(join(toolRoot, '.git'))) continue;
		const srcDir = join(toolRoot, 'src');
		if (!existsSync(srcDir)) continue;
		for (const file of collectJsLikeFiles(srcDir)) {
			const rel = relative(root, file);
			const source = readFileSync(file, 'utf8');
			errors.push(...boundaryImportViolations(source, rel));
		}
	}
}

if (errors.length > 0) {
	console.error('[architecture:check] obligation boundary violations:');
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.error('[architecture:check] obligation boundaries OK');
