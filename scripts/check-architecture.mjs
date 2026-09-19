#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
	for (const pattern of [
		/\bimport\s+["']([^"']+)["']/g,
		/\bimport\(\s*["']([^"']+)["']\s*\)/g,
	]) {
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
				`${relative(root, file)}: ${fromOwner} may only \`import type\` from ${toOwner} (saw value import: \`${stmt.full.replace(/\`/g, '\\\`')}\`)`,
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

if (errors.length > 0) {
	console.error('[architecture:check] obligation boundary violations:');
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.error('[architecture:check] obligation boundaries OK');
