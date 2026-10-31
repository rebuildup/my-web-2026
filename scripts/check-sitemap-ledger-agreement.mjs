#!/usr/bin/env node

/**
 * Sitemap membership — the publication ledger and the sitemap
 * generator must agree (Issue #734).
 *
 * What this is
 * ------------
 * Two declarations answer the same question — "which paths belong in
 * the sitemap?" — and today they answer it differently:
 *
 *   1. `scripts/publication-surface.mjs` — the **publication ledger**.
 *      One entry per route file, each carrying a `sitemap` flag and a
 *      reason. It is the *audit classification*: "is this public, and
 *      is it advertised?".
 *   2. `src/http/seo/sitemap.ts` — the **generator**. It emits the
 *      actual XML that a crawler receives, and it states its own
 *      membership rule: a page belongs when it is (a) reachable
 *      without authentication, (b) not `robots: noindex` in its own
 *      `head()`, and (c) linked from the public nav.
 *
 * Two independent declarations are only useful if they are compared.
 * Until now nothing compared them, so they drifted:
 *
 *   - `/tools/<slug>` — the ledger said `sitemap: true`, the
 *     generator excluded it because the Tool shell declares
 *     `robots: noindex`.
 *   - `/design-system` — the ledger said `sitemap: false` (grounded
 *     in breadcrumb suppression), the generator listed it.
 *
 * Both disagreements were invisible: every gate was green, and the
 * committed snapshot recorded the ledger's answer, not the XML a
 * crawler actually receives.
 *
 * The rule
 * --------
 * The **generator is the authority** — it emits the document. The
 * ledger is the *independent* classification that must agree with it.
 * This gate therefore fails when the two disagree, and it says which
 * side is out of step.
 *
 * Nothing here reads the network, a binding, or a secret. It compares
 * two in-process declarations.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	SITEMAP_DYNAMIC_ROUTES,
	SITEMAP_ENTRIES,
	SITEMAP_EXCLUSIONS,
} from '../src/http/seo/sitemap.ts';
import { SURFACE_DECLARATIONS } from './publication-surface.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * One disagreement between the two declarations.
 *
 * @typedef {object} SitemapAgreementViolation
 * @property {'ledger-only' | 'generator-only' | 'ledger-flags-included' | 'ledger-flags-excluded' | 'missing-ledger-entry' | 'missing-ledger-route' | 'ledger-sitemap-undeclared'} code
 * @property {string} subject the path or route template the two sides disagree about
 * @property {string} message what one side says and what the other says
 */

/**
 * Normalize a route spelling for comparison.
 *
 * The ledger writes route ids with a trailing slash (`/admin/`) where
 * the generator writes the router template (`/admin`). Both name the
 * same route, so the comparison has to see them as one.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeRoute(value) {
	if (value.length > 1 && value.endsWith('/')) return value.slice(0, -1);
	return value;
}

/**
 * Does an exclusion cover this path?
 *
 * An exclusion with `kind: 'route'` covers exactly one route. An
 * exclusion with `kind: 'prefix'` covers the route and everything
 * below it — which is how the generator keeps the whole `/admin`
 * family out of the document while the ledger claims each admin
 * surface separately.
 *
 * @param {readonly any[]} exclusions
 * @param {string} path
 * @returns {boolean}
 */
export function isExcludedPath(exclusions, path) {
	const target = normalizeRoute(path);
	return exclusions.some((exclusion) => {
		const route = normalizeRoute(exclusion.route);
		if (route === target) return true;
		if (exclusion.kind !== 'prefix') return false;
		return target.startsWith(`${route}/`);
	});
}

/**
 * Compare the ledger's sitemap claims with the generator's sitemap
 * facts.
 *
 * Pure: it takes both declarations as arguments, so a test can feed it
 * a disagreement without touching the repository.
 *
 * @param {{declarations: readonly any[], entries: readonly any[], exclusions: readonly any[], dynamicRoutes: readonly any[]}} input
 * @returns {SitemapAgreementViolation[]}
 */
/**
 * The tail every "the two declarations disagree" message carries.
 *
 * The generator emits the document, so a disagreement is resolved by
 * changing the ledger — the gate states that so a reader does not have
 * to infer which side is out of step.
 */
const AUTHORITY_NOTE = 'One of the two declarations has to change; the generator is the authority.';

export function compareSitemapDeclarations({ declarations, entries, exclusions, dynamicRoutes }) {
	const violations = [];

	// The generator's facts.
	const entryPaths = new Set(entries.map((entry) => entry.path));
	const dynamicTemplates = new Set(dynamicRoutes.map((route) => normalizeRoute(route.template)));
	const excludedRoutes = new Set(exclusions.map((exclusion) => normalizeRoute(exclusion.route)));

	// The ledger's claims, split by kind: a static surface owns one
	// concrete path; a dynamic surface owns a route template; the root
	// shell owns no URL at all and is exempt.
	const staticClaims = new Map();
	const routeClaims = new Map();
	for (const declaration of declarations) {
		if (declaration.path === null || declaration.path === undefined) {
			if (declaration.dynamic === undefined) continue;
			routeClaims.set(normalizeRoute(declaration.id), declaration);
			continue;
		}
		staticClaims.set(declaration.path, declaration);
	}

	// 0. A declaration that owns a URL has to say whether that URL is a
	//    sitemap target. A `sitemap` that is neither `true` nor `false`
	//    is a claim nobody made: it lands in neither the "the ledger
	//    advertises it" branch nor the "the ledger keeps it out" branch,
	//    so a typo in a new declaration slipped through the whole
	//    comparison with `violations = []` and a green gate. The gate
	//    exists to make "the two declarations disagree" visible, and an
	//    undecided declaration is the disagreement this one missed.
	for (const [path, declaration] of staticClaims) {
		if (typeof declaration.sitemap !== 'boolean') {
			violations.push({
				code: 'ledger-sitemap-undeclared',
				subject: path,
				message: `the publication ledger does not say whether "${path}" is a sitemap target — \`sitemap\` must be true or false, and ${JSON.stringify(declaration.sitemap)} is neither. ${AUTHORITY_NOTE}`,
			});
		}
	}
	for (const [route, declaration] of routeClaims) {
		if (typeof declaration.sitemap !== 'boolean') {
			violations.push({
				code: 'ledger-sitemap-undeclared',
				subject: route,
				message: `the publication ledger does not say whether the route family "${route}" is a sitemap target — \`sitemap\` must be true or false, and ${JSON.stringify(declaration.sitemap)} is neither. ${AUTHORITY_NOTE}`,
			});
		}
	}

	// 1. A path the ledger advertises must be in the document.
	for (const [path, declaration] of staticClaims) {
		if (declaration.sitemap === true && !entryPaths.has(path)) {
			violations.push({
				code: 'ledger-flags-included',
				subject: path,
				message: `the publication ledger marks "${path}" as a sitemap target, but the sitemap generator does not list it. ${AUTHORITY_NOTE}`,
			});
		}
	}

	// 2. A path the ledger keeps out must not be in the document, and
	//    must carry an explicit exclusion in the generator — a surface
	//    kept out "for no recorded reason" is how the two declarations
	//    drifted apart in the first place.
	for (const [path, declaration] of staticClaims) {
		if (declaration.sitemap !== false) continue;
		if (entryPaths.has(path)) {
			violations.push({
				code: 'ledger-flags-excluded',
				subject: path,
				message: `the publication ledger keeps "${path}" out of the sitemap, but the sitemap generator lists it. ${AUTHORITY_NOTE}`,
			});
			continue;
		}
		if (!isExcludedPath(exclusions, path)) {
			violations.push({
				code: 'ledger-flags-excluded',
				subject: path,
				message: `the publication ledger keeps "${path}" out of the sitemap, but the sitemap generator records no exclusion for it`,
			});
		}
	}

	// 3. Every path in the document must be claimed by the ledger.
	for (const path of entryPaths) {
		const declaration = staticClaims.get(path);
		if (!declaration) {
			violations.push({
				code: 'missing-ledger-entry',
				subject: path,
				message: `the sitemap generator lists "${path}", but the publication ledger has no entry for it`,
			});
			continue;
		}
		if (declaration.sitemap !== true) {
			violations.push({
				code: 'ledger-flags-excluded',
				subject: path,
				message: `the sitemap generator lists "${path}", but the publication ledger marks it as not a sitemap target`,
			});
		}
	}

	// 4. A dynamic route family the ledger advertises must be emitted
	//    by the generator.
	for (const [route, declaration] of routeClaims) {
		if (declaration.sitemap === true && !dynamicTemplates.has(route)) {
			violations.push({
				code: 'ledger-flags-included',
				subject: route,
				message: `the publication ledger marks the route family "${route}" as a sitemap target, but the sitemap generator emits no dynamic route for it`,
			});
		}
	}

	// 5. A dynamic route family the ledger keeps out must be an
	//    explicit exclusion in the generator — not merely absent.
	for (const [route, declaration] of routeClaims) {
		if (declaration.sitemap === false && !excludedRoutes.has(route)) {
			violations.push({
				code: 'ledger-flags-excluded',
				subject: route,
				message: `the publication ledger keeps the route family "${route}" out of the sitemap, but the sitemap generator records no exclusion for it`,
			});
		}
	}

	// 6. Every dynamic route the generator emits must be claimed.
	for (const template of dynamicTemplates) {
		const declaration = routeClaims.get(template);
		if (!declaration) {
			violations.push({
				code: 'missing-ledger-route',
				subject: template,
				message: `the sitemap generator emits the route family "${template}", but the publication ledger has no entry for it`,
			});
			continue;
		}
		if (declaration.sitemap !== true) {
			violations.push({
				code: 'ledger-flags-excluded',
				subject: template,
				message: `the sitemap generator emits the route family "${template}", but the publication ledger marks it as not a sitemap target`,
			});
		}
	}

	return violations;
}

/**
 * The declarations as this repository actually holds them.
 *
 * @returns {{declarations: readonly any[], entries: readonly any[], exclusions: readonly any[], dynamicRoutes: readonly any[]}}
 */
export function repositoryDeclarations() {
	return {
		declarations: SURFACE_DECLARATIONS,
		entries: SITEMAP_ENTRIES,
		exclusions: SITEMAP_EXCLUSIONS,
		dynamicRoutes: SITEMAP_DYNAMIC_ROUTES,
	};
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv) {
	const ledgerOption = argv.find((argument) => argument.startsWith('--ledger='));
	const unknown = argv.filter(
		(argument) => argument.startsWith('--') && !argument.startsWith('--ledger='),
	);
	if (unknown.length > 0) {
		console.error(`[sitemap:ledger:check] unknown option(s): ${unknown.join(', ')}`);
		return 2;
	}

	let declarations = SURFACE_DECLARATIONS;
	if (ledgerOption) {
		const ledgerPath = resolve(REPO_ROOT, ledgerOption.slice('--ledger='.length));
		try {
			const module = await import(pathToFileURL(ledgerPath).href);
			declarations = module.SURFACE_DECLARATIONS;
		} catch (error) {
			console.error(
				`[sitemap:ledger:check] cannot read the ledger at ${ledgerPath}: ${error.message}`,
			);
			return 2;
		}
		if (!Array.isArray(declarations)) {
			console.error(
				`[sitemap:ledger:check] the ledger at ${ledgerPath} exports no SURFACE_DECLARATIONS array`,
			);
			return 2;
		}
	}

	const violations = compareSitemapDeclarations({
		declarations,
		entries: SITEMAP_ENTRIES,
		exclusions: SITEMAP_EXCLUSIONS,
		dynamicRoutes: SITEMAP_DYNAMIC_ROUTES,
	});
	if (violations.length > 0) {
		console.error(
			'[sitemap:ledger:check] the publication ledger and the sitemap generator disagree:',
		);
		for (const violation of violations) {
			console.error(`- [${violation.code}] ${violation.subject}: ${violation.message}`);
		}
		console.error(
			'[sitemap:ledger:check] the generator owns the document; the ledger must agree with it.',
		);
		return 1;
	}

	console.error(
		'[sitemap:ledger:check] the publication ledger and the sitemap generator agree — OK',
	);
	return 0;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exitCode = await main(process.argv.slice(2));
}
