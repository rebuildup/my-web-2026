#!/usr/bin/env node

/**
 * Structured-data route coverage gate (Issue #422).
 *
 * Why this gate exists
 * --------------------
 * `src/editorial/structured-data/contract.json` declares, for every
 * visitor-facing route, exactly which schema.org types it emits and —
 * for routes that emit nothing — WHY. Without a gate against the
 * real route inventory that list rots in the one direction that
 * matters: someone adds a surface, it starts emitting (or not
 * emitting) structured data, and nothing notices. "Not implemented"
 * would quietly read as "nothing to check".
 *
 * So this check derives the inventory from `src/routeTree.gen.ts` —
 * the router's own generated truth, not a filename convention that
 * would need its own exceptions — and fails when:
 *
 *   - a public route has no entry (silent gap), or
 *   - an entry names a route the router no longer has (stale claim), or
 *   - an entry is internally inconsistent: unknown status, a declared
 *     `@type` the contract does not know, an empty note, a sample
 *     path without a concrete route, or a `not-implemented` entry
 *     that claims emitted types.
 *
 * The companion gate is `test/integration/structured-data.test.ts`,
 * which proves each entry against real SSR HTML. This one proves the
 * list is complete; that one proves it is true.
 *
 *   node scripts/check-structured-data-coverage.mjs
 *
 * Exit codes: 0 = registry complete, 1 = drift, 2 = bad input.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE_TREE = join(ROOT, 'src/routeTree.gen.ts');
const CONTRACT = join(ROOT, 'src/editorial/structured-data/contract.json');

const VALID_STATUSES = new Set(['implemented', 'not-implemented', 'out-of-scope']);

/** Path prefixes that are never public surface. */
const NON_PUBLIC_PREFIXES = ['/admin'];

/**
 * `fullPath: '/portfolio/$slug'` → `['/portfolio/$slug']`.
 * The generated tree is the router's own output, so this reads the
 * one place the answer already exists.
 */
export function parseRoutePaths(source) {
	const paths = [];
	for (const match of source.matchAll(/fullPath:\s*'([^']+)'/g)) {
		paths.push(match[1]);
	}
	return paths;
}

/** `/portfolio/$slug` → `/portfolio/[slug]`; `/tools/` → `/tools`. */
export function normaliseRoutePath(path) {
	const withoutTrailingSlash = path.length > 1 ? path.replace(/\/+$/, '') : path;
	return withoutTrailingSlash.replace(/\$([A-Za-z0-9_]+)/g, (_match, name) => `[${name}]`);
}

export function isPublicRoute(path) {
	return !NON_PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function entryCovers(entryPath, routePath) {
	if (entryPath.endsWith('/**')) {
		const prefix = entryPath.slice(0, -3);
		return routePath === prefix || routePath.startsWith(`${prefix}/`);
	}
	return entryPath === routePath;
}

/**
 * Compare the router's inventory with the declared registry.
 * Returns `{ errors, publicRoutes, nonPublicRoutes }`.
 */
export function checkCoverage({ routePaths, registry, knownTypes }) {
	const errors = [];
	const declaredPublic = registry.filter((entry) => entry.public);
	const declaredNonPublic = registry.filter((entry) => !entry.public);

	for (const routePath of routePaths) {
		const matched = registry.filter((entry) => entryCovers(entry.path, routePath));
		if (matched.length === 0) {
			errors.push(
				isPublicRoute(routePath)
					? `route ${routePath} has no structured-data decision in contract.json — declare what it emits, or declare "not-implemented" with a reason`
					: `route ${routePath} is non-public but no out-of-scope entry covers it`,
			);
			continue;
		}
		if (matched.length > 1) {
			errors.push(
				`route ${routePath} is covered by ${matched.length} entries (${matched
					.map((entry) => entry.path)
					.join(', ')}) — each route must have exactly one decision`,
			);
		}
		const entry = matched[0];
		if (isPublicRoute(routePath) && !entry.public) {
			errors.push(`route ${routePath} is public but is covered by a non-public entry`);
		}
	}

	for (const entry of registry) {
		if (entry.path.endsWith('/**')) continue;
		if (!routePaths.includes(entry.path)) {
			errors.push(
				entry.public
					? `registry entry ${entry.path} does not exist in the router (src/routeTree.gen.ts) — remove it or fix the path`
					: `non-public registry entry ${entry.path} does not exist in the router`,
			);
		}
	}

	for (const entry of registry) {
		if (!VALID_STATUSES.has(entry.status)) {
			errors.push(
				`registry entry ${entry.path} has status "${entry.status}" (expected one of ${[...VALID_STATUSES].join(', ')})`,
			);
		}
		if (typeof entry.note !== 'string' || entry.note.trim() === '') {
			errors.push(
				`registry entry ${entry.path} has no note — an unexplained entry is indistinguishable from an oversight`,
			);
		}
		if (!Array.isArray(entry.expectedTypes)) {
			errors.push(`registry entry ${entry.path} must declare expectedTypes as an array`);
			continue;
		}
		for (const type of entry.expectedTypes) {
			if (!knownTypes.includes(type)) {
				errors.push(
					`registry entry ${entry.path} declares unknown @type "${type}" (contract.json#knownTypes: ${knownTypes.join(', ')})`,
				);
			}
		}
		if (entry.status === 'not-implemented' && entry.expectedTypes.length > 0) {
			errors.push(
				`registry entry ${entry.path} is not-implemented but claims ${entry.expectedTypes.join(', ')}`,
			);
		}
		if (entry.status === 'implemented' && entry.expectedTypes.length === 0) {
			errors.push(`registry entry ${entry.path} is implemented but declares no @type`);
		}
		if (entry.path.includes('[') && entry.samplePath === null && entry.status === 'implemented') {
			errors.push(
				`registry entry ${entry.path} is a dynamic route marked implemented but has no samplePath for the integration suite to fetch`,
			);
		}
	}

	return {
		errors,
		publicRoutes: routePaths.filter(isPublicRoute).map(normaliseRoutePath),
		nonPublicRoutes: routePaths.filter((path) => !isPublicRoute(path)).map(normaliseRoutePath),
		declaredPublic: declaredPublic.map((entry) => entry.path),
		declaredNonPublic: declaredNonPublic.map((entry) => entry.path),
	};
}

function main() {
	let routeTree;
	let contract;
	try {
		routeTree = readFileSync(ROUTE_TREE, 'utf8');
		contract = JSON.parse(readFileSync(CONTRACT, 'utf8'));
	} catch (error) {
		process.stderr.write(`structured-data coverage: cannot read inputs: ${error.message}\n`);
		return 2;
	}

	const routePaths = parseRoutePaths(routeTree).map(normaliseRoutePath);
	const result = checkCoverage({
		routePaths,
		registry: contract.routes,
		knownTypes: contract.knownTypes,
	});

	if (result.errors.length > 0) {
		process.stderr.write(
			`structured-data coverage: ${result.errors.length} problem(s) between src/routeTree.gen.ts and contract.json:\n`,
		);
		for (const message of result.errors) process.stderr.write(`  - ${message}\n`);
		process.stderr.write(
			'\nA route with no structured-data decision cannot be reported as "covered".\n' +
				'Add an entry to src/editorial/structured-data/contract.json (status\n' +
				'"not-implemented" + a reason is a valid answer) — or, if the route emits\n' +
				'nodes, implement them and let test/integration/structured-data.test.ts\n' +
				'prove the claim against real SSR HTML.\n',
		);
		return 1;
	}

	process.stdout.write(
		`structured-data coverage OK: ${result.publicRoutes.length} public route(s) declared, ` +
			`${result.nonPublicRoutes.length} non-public route(s) out of scope\n`,
	);
	return 0;
}

// Imported as a library by `check-structured-data-coverage.test.mjs`,
// so the CLI only runs when this file is the process entry point.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(main());
}
