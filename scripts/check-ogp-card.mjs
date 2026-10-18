#!/usr/bin/env node
/**
 * Open Graph / Twitter card gate (Issue #421).
 *
 * Two modes, one engine (`scripts/ogp-card-contract.mjs`):
 *
 *   node scripts/check-ogp-card.mjs                        # coverage
 *   node scripts/check-ogp-card.mjs --live <baseUrl> [--html <out>] [--json]
 *
 * ## Mode 1 — coverage (cheap; wired into `validate:fast`)
 *
 * Reads `src/editorial/social-card/contract.json` and the framework's
 * own route tree (`src/routeTree.gen.ts`, regenerated from
 * `src/routes/**` on every run) and fails when:
 *
 *   1. the contract is malformed (origin not the production origin,
 *      empty site name / locale, empty closed sets);
 *   2. a non-admin route has no entry — the silent-gap direction that
 *      matters, because a surface nobody declared is a surface whose
 *      card nobody verifies;
 *   3. an entry names a route the router no longer has (a stale
 *      claim reads exactly like a passing one);
 *   4. an entry is internally inconsistent: unknown status / policy, an
 *      `og:type` outside the closed set, an empty note, a sample that
 *      is not a concrete instance of its route, an `implemented` entry
 *      with no `og:type`, or a `not-implemented` entry that claims one;
 *   5. the declared fallback card is not a real committed asset, or
 *      its generator script is missing — a contract that promises an
 *      `og:image` nobody can fetch is the failure mode this Issue is
 *      about;
 *   6. a `deferredSurfaces` entry (Issue #421's 記事) has grown a real
 *      route without its contract entry being written.
 *
 * The companion gate is `test/integration/ogp-card.test.ts`, which
 * proves each entry against real SSR HTML. This one proves the list is
 * complete; that one proves it is true.
 *
 * ## Mode 2 — live evaluation
 *
 * The same engine pointed at a real origin (dev server, `vite preview`,
 * a deployed environment). Every declared surface appears with an
 * explicit PASS / FAIL row and the image SOURCE (`content` /
 * `fallback`), so a missing-media row is visible rather than inferred
 * from an absent tag. A request that errors is a FAIL.
 *
 * Exit codes: 0 = complete / no findings, 1 = drift or findings,
 * 2 = usage error.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_BETTER_AUTH_URL } from './_cloudflare-contract.mjs';
import { evaluateSocialCards, renderHtmlReport, renderTextReport } from './ogp-card-contract.mjs';
import { parseHeadTags } from './seo-head-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const ROUTE_TREE = join(REPO_ROOT, 'src/routeTree.gen.ts');
const CONTRACT_PATH = join(REPO_ROOT, 'src/editorial/social-card/contract.json');

/** Path prefixes that are never public surface (auth-gated admin). */
const NON_PUBLIC_PREFIXES = ['/admin'];

const VALID_STATUSES = new Set(['implemented', 'not-implemented']);
const VALID_POLICIES = new Set(['content-first', 'none']);

const USAGE = `check-ogp-card — Open Graph / Twitter card gate (Issue #421)

  node scripts/check-ogp-card.mjs                      # contract coverage vs the route tree
  node scripts/check-ogp-card.mjs --live <baseUrl> [--html <out.html>] [--json]
`;

/** `fullPath: '/portfolio/$slug'` → the router's own published truth. */
export function parseRoutePaths(source) {
	return [...source.matchAll(/fullPath:\s*'([^']+)'/g)].map((match) => match[1]);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Is `sample` a concrete instance of the dynamic route `id`? */
export function isSampleUnderRoute(id, sample) {
	const pattern = id
		.split('/')
		.filter((segment) => segment.length > 0)
		.map((segment) => (segment.startsWith('$') ? '[^/]+' : escapeRegExp(segment.replace(/_$/, ''))))
		.join('/');
	return new RegExp(`^/${pattern}$`).test(sample);
}

export function readContract() {
	return JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
}

/**
 * The engine's view of the repository contract.
 *
 * Derived from `contract.json`, never restated: a second copy of the
 * site name or the fallback URL is how a report ends up describing a
 * document nobody ships.
 */
export function policyFromContract(contract) {
	return {
		canonicalOrigin: contract.canonicalOrigin,
		siteName: contract.siteName,
		siteLocale: contract.siteLocale,
		fallbackCardUrl: `${contract.canonicalOrigin}${contract.fallbackCard.path}`,
		fallbackCardAlt: contract.fallbackCard.alt,
		fallbackCardWidth: contract.fallbackCard.width,
		fallbackCardHeight: contract.fallbackCard.height,
	};
}

/**
 * Evaluate the contract registry against the router's route tree.
 *
 * @returns {{ errors: string[], contract: object }}
 */
export function evaluateCoverage({ contract, routePaths }) {
	const errors = [];

	if (contract?.canonicalOrigin !== PRODUCTION_BETTER_AUTH_URL) {
		errors.push(
			`contract.canonicalOrigin must be ${PRODUCTION_BETTER_AUTH_URL} (ADR-0014), got ${contract?.canonicalOrigin}`,
		);
	}
	for (const key of ['siteName', 'siteLocale']) {
		if (typeof contract?.[key] !== 'string' || contract[key].trim().length === 0) {
			errors.push(`contract.${key} must be a non-empty string`);
		}
	}
	for (const key of ['ogTypes', 'cardTypes']) {
		if (!Array.isArray(contract?.[key]) || contract[key].length === 0) {
			errors.push(`contract.${key} must be a non-empty array`);
		}
	}

	const fallback = contract?.fallbackCard;
	if (typeof fallback?.path !== 'string' || !fallback.path.startsWith('/')) {
		errors.push('contract.fallbackCard.path must be an origin-relative path');
	} else if (!existsSync(join(REPO_ROOT, 'public', fallback.path))) {
		errors.push(
			`contract.fallbackCard.path: public${fallback.path} does not exist — the declared og:image must be a real committed asset`,
		);
	}
	for (const key of ['width', 'height']) {
		if (!Number.isInteger(fallback?.[key]) || fallback[key] <= 0) {
			errors.push(`contract.fallbackCard.${key} must be a positive integer`);
		}
	}
	if (typeof fallback?.alt !== 'string' || fallback.alt.trim().length === 0) {
		errors.push('contract.fallbackCard.alt must be non-empty (a nameless card is worse than none)');
	}
	if (typeof fallback?.generator === 'string' && fallback.generator.length > 0) {
		if (!existsSync(join(REPO_ROOT, fallback.generator))) {
			errors.push(`contract.fallbackCard.generator: ${fallback.generator} does not exist`);
		}
	}

	const declared = Array.isArray(contract?.routes) ? contract.routes : [];
	const declaredPaths = new Set(declared.map((entry) => entry?.path));

	for (const routePath of routePaths) {
		if (
			NON_PUBLIC_PREFIXES.some(
				(prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`),
			)
		) {
			continue;
		}
		if (!declaredPaths.has(routePath)) {
			errors.push(
				`${routePath}: no entry in contract.routes — a surface nobody declares is a surface whose card nobody verifies`,
			);
		}
	}

	for (const entry of declared) {
		const label = `contract.routes[${entry?.path ?? '(no path)'}]`;
		if (!routePaths.includes(entry?.path)) {
			errors.push(`${label}: the router no longer serves this route (stale claim)`);
		}
		if (!VALID_STATUSES.has(entry?.status)) {
			errors.push(`${label}: status "${entry?.status}" not in {${[...VALID_STATUSES].join(', ')}}`);
		}
		if (!VALID_POLICIES.has(entry?.cardPolicy)) {
			errors.push(
				`${label}: cardPolicy "${entry?.cardPolicy}" not in {${[...VALID_POLICIES].join(', ')}}`,
			);
		}
		if (typeof entry?.note !== 'string' || entry.note.trim().length < 20) {
			errors.push(`${label}: note must say WHY the surface is (or is not) in the card contract`);
		}
		if (typeof entry?.samplePath !== 'string' || !entry.samplePath.startsWith('/')) {
			errors.push(`${label}: samplePath must be a concrete request path`);
		} else if (!isSampleUnderRoute(entry.path, entry.samplePath)) {
			errors.push(
				`${label}: samplePath "${entry.samplePath}" is not a concrete instance of "${entry.path}"`,
			);
		}
		if (entry?.status === 'implemented') {
			if (!contract?.ogTypes?.includes(entry.ogType)) {
				errors.push(`${label}: og:type "${entry.ogType}" is not one of contract.ogTypes`);
			}
			if (entry.cardPolicy !== 'content-first') {
				errors.push(
					`${label}: an implemented surface must publish a card (cardPolicy "content-first")`,
				);
			}
		} else {
			if (entry?.ogType !== undefined) {
				errors.push(`${label}: a not-implemented surface must not claim an og:type`);
			}
			if (entry.cardPolicy !== 'none') {
				errors.push(`${label}: a not-implemented surface must declare cardPolicy "none"`);
			}
		}
	}

	const deferred = Array.isArray(contract?.deferredSurfaces) ? contract.deferredSurfaces : [];
	for (const entry of deferred) {
		if (typeof entry?.id !== 'string' || entry.id.trim().length === 0) {
			errors.push('contract.deferredSurfaces[?]: id is required');
			continue;
		}
		if (typeof entry.reason !== 'string' || entry.reason.trim().length < 40) {
			errors.push(
				`contract.deferredSurfaces[${entry.id}]: reason must explain why the surface Issue #421 names is not in the contract yet`,
			);
		}
		for (const routePath of routePaths) {
			if (routePath.includes(entry.id)) {
				errors.push(
					`contract.deferredSurfaces[${entry.id}]: ${routePath} now exists — move the surface from deferred into contract.routes with its og:type (an undeclared surface is a silent pass)`,
				);
			}
		}
	}

	return { errors, contract };
}

/**
 * The surfaces a live run evaluates: every declared surface that is
 * visitor-facing.
 *
 * Exported (and unit-tested) because a surface silently dropped from
 * this list is an unverified surface — the same failure direction the
 * coverage gate protects the other end of.
 */
export function publicSurfaces(contract) {
	return contract.routes.filter((entry) => entry.public !== false);
}

async function fetchDocument(baseUrl, path) {
	const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
	try {
		const response = await fetch(url, {
			redirect: 'manual',
			headers: { accept: 'text/html' },
			signal: AbortSignal.timeout(20_000),
		});
		return { status: response.status, html: await response.text(), error: null };
	} catch (error) {
		return {
			status: null,
			html: '',
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function runCoverage() {
	const contract = readContract();
	const routePaths = parseRoutePaths(readFileSync(ROUTE_TREE, 'utf8'));
	const { errors } = evaluateCoverage({ contract, routePaths });

	if (errors.length > 0) {
		process.stderr.write(`${errors.map((error) => `  - ${error}`).join('\n')}\n`);
		process.stderr.write(`${errors.length} contract error(s)\n`);
		return 1;
	}
	const declared = contract.routes.filter((entry) => entry.status === 'implemented').length;
	process.stdout.write(
		`[ogp-card] ${contract.routes.length} non-public/admin route(s) declared (${declared} card(s) implemented, ${
			contract.routes.length - declared
		} declared without a card), ${contract.deferredSurfaces.length} deferred surface(s)\n`,
	);
	return 0;
}

async function runLive({ baseUrl, html, json }) {
	const contract = readContract();
	const policy = policyFromContract(contract);
	const surfaces = publicSurfaces(contract);
	const observations = [];

	for (const surface of surfaces) {
		const { status, html: document, error } = await fetchDocument(baseUrl, surface.samplePath);
		observations.push({
			path: surface.samplePath,
			status,
			tags: error ? [] : parseHeadTags(document),
			requestFailed: Boolean(error),
			requestError: error ?? undefined,
		});
	}

	const result = evaluateSocialCards({ surfaces, observations, policy });

	if (json) {
		process.stdout.write(`${JSON.stringify({ policy, ...result }, null, 2)}\n`);
	} else {
		process.stdout.write(`${renderTextReport(result)}\n`);
	}

	if (html) writeFileSync(html, renderHtmlReport(result));

	return result.findings.length > 0 ? 1 : 0;
}

function parseArgs(argv) {
	const options = { live: null, html: null, json: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') return { help: true };
		if (arg === '--json') {
			options.json = true;
			continue;
		}
		if (arg === '--live') {
			options.live = argv[++i] ?? null;
			continue;
		}
		if (arg === '--html') {
			options.html = argv[++i] ?? null;
			continue;
		}
		return { error: `unknown argument: ${arg}` };
	}
	return { options };
}

async function main() {
	const parsed = parseArgs(process.argv.slice(2));
	if (parsed.help) {
		process.stdout.write(USAGE);
		return 0;
	}
	if (parsed.error) {
		process.stderr.write(`${parsed.error}\n\n${USAGE}`);
		return 2;
	}
	return parsed.options.live ? runLive(parsed.options) : runCoverage();
}

const invokedDirectly =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	process.exitCode = await main();
}
