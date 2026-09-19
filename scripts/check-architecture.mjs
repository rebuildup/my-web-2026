#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'src');

const legacyClassifierRoots = ['modules', 'design-system', 'platform'];

const forbiddenOwnerDependencies = new Map([
	['cloudflare', new Set(['home'])],
	['http', new Set(['home'])],
	['editorial', new Set(['home', 'cloudflare', 'http'])],
]);

/**
 * Owner pairs where the import edge is allowed only via
 * `import type …`. TypeScript's `verbatimModuleSyntax` erases
 * `import type` at build time, so this is the only edge that does
 * not require the source owner to ship runtime code into the
 * target owner.
 *
 * AGENTS.md §3 calls the schema-types-only obligation out for
 * `home/reactions ↔ http/reactions` and `home/access ↔
 * http/access-counter`. Other edges are not currently needed;
 * adding an edge here requires an entry in the AGENTS.md §3
 * dependency table.
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

function resolveInternalImport(fromFile, specifier) {
	if (specifier.startsWith('.')) return resolve(dirname(fromFile), specifier);
	if (specifier.startsWith('~/')) return resolve(srcRoot, specifier.slice(2));
	return null;
}

/**
 * Returns every `import …` (static) statement in `source`, with a
 * flag for whether the statement is fully type-only (i.e. starts
 * with `import type`). Side-effect imports (no specifier) and
 * dynamic `import('…')` calls are not tracked here — they have
 * either no specifier or a runtime cost regardless.
 */
function importStatements(source) {
	const re = /(?:^|\n)\s*import\s+(?:type\s+)?[^"';]*?["']([^"']+)["']/g;
	const stmts = [];
	for (const match of source.matchAll(re)) {
		const full = match[0].slice(match[0].indexOf('import')).replace(/\s+/g, ' ').trimStart();
		const head = full.slice('import'.length).trimStart();
		const isTypeOnly = head.startsWith('type ');
		stmts.push({ full, isTypeOnly, specifier: match[1] });
	}
	return stmts;
}

function importSpecifiers(source) {
	const specs = new Set();
	const patterns = [
		/\bfrom\s+['"]([^'"]+)['"]/g,
		/\bimport\s+['"]([^'"]+)['"]/g,
		/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
	];
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) specs.add(match[1]);
	}
	return specs;
}

const errors = [];

for (const name of legacyClassifierRoots) {
	if (existsSync(join(srcRoot, name))) {
		errors.push(
			`src/${name}/ is a legacy classifier root. Reintroducing it requires an explicit ADR-0008 boundary decision.`,
		);
	}
}

// Reverse-direction forbidden edges (cloudflare → home, http → home,
// editorial → {home, cloudflare, http}).
for (const file of sourceFiles(srcRoot)) {
	const fromOwner = ownerOf(file);
	const forbidden = forbiddenOwnerDependencies.get(fromOwner);
	if (!forbidden) continue;

	const source = readFileSync(file, 'utf8');
	for (const specifier of importSpecifiers(source)) {
		const target = resolveInternalImport(file, specifier);
		if (!target) continue;
		const toOwner = ownerOf(target);
		if (toOwner && forbidden.has(toOwner)) {
			errors.push(
				`${relative(root, file)}: ${fromOwner} must not depend on ${toOwner} (${specifier})`,
			);
		}
	}
}

// Type-only edges (home → http must be `import type`, never value).
for (const edge of typeOnlyEdges) {
	const homeRoot = join(srcRoot, edge.from);
	if (!existsSync(homeRoot)) continue;
	for (const file of sourceFiles(homeRoot)) {
		const source = readFileSync(file, 'utf8');
		for (const stmt of importStatements(source)) {
			const target = resolveInternalImport(file, stmt.specifier);
			if (!target) continue;
			const toOwner = ownerOf(target);
			if (toOwner !== edge.to) continue;
			if (stmt.isTypeOnly) continue;
			errors.push(
				`${relative(root, file)}: ${edge.from} may only \`import type\` from ${edge.to} (saw value import: \`${stmt.full.replace(/`/g, '\\`')}\`). Move the runtime to ${edge.to}/, hoist it into a shared obligation, or refactor to a fetch boundary.`,
			);
		}
	}
}

if (errors.length > 0) {
	console.error('[architecture:check] obligation boundary violations:');
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.error('[architecture:check] obligation boundaries OK');
