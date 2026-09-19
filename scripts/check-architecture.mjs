#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

for (const file of sourceFiles(srcRoot)) {
	const fromOwner = ownerOf(file);
	const forbidden = forbiddenOwnerDependencies.get(fromOwner);
	if (!forbidden) continue;

	const source = readFileSync(file, 'utf8');
	for (const specifier of importSpecifiers(source)) {
		const target = resolveInternalImport(file, specifier);
		if (!target) continue;
		const toOwner = ownerOf(target);
		const allowedHomeStatusRuntimeDependency =
			fromOwner === 'home' &&
			isHomeStatusFile(file) &&
			(toOwner === 'cloudflare' || toOwner === 'http');
		if (toOwner && forbidden.has(toOwner) && !allowedHomeStatusRuntimeDependency) {
			errors.push(
				`${relative(root, file)}: ${fromOwner} must not depend on ${toOwner} (${specifier})`,
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
