import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CANONICAL_PRODUCTION_ORIGIN,
	CHROME_NAV_ROUTES,
	EXPECTED_SECTION_COUNTS,
	LINKED_TOOL_DELIVERY_KINDS,
	ONE_CLICK_ENTRIES,
	PAGE_CONTENT_SECTIONS,
	REPRESENTATIVE_API_ROUTES,
	REPRESENTATIVE_PAGE_ROUTES,
	REPRESENTATIVE_ROUTES,
	auditRoute,
	findRepresentativeRoute,
	formatAuditReport,
	resolveDefaultState,
} from './prod-smoke-routes.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Offline contract tests for the Issue #500 representative-route registry.
 *
 * Why a pure-function test exists next to a Playwright spec
 * -------------------------------------------------------
 * `e2e/prod-smoke.spec.ts` can only run against a real origin, and the
 * canonical one is production. That means the pass/fail LOGIC of the
 * smoke would otherwise ship untested: a classifier that quietly stopped
 * reporting problems would turn every production smoke into a false
 * success, and nobody would find out until the day it mattered.
 *
 * So the classifier is exercised here, with no network, no workerd, and
 * no browser. Each test below is a fabricated observation of a route that
 * is either healthy or broken in one specific way, and the assertion is
 * that `auditRoute()` reports exactly the defect. The coverage guard at
 * the end makes a NEWLY REGISTERED route fail this file until it has at
 * least one fixture of its own, which is what stops the registry from
 * growing faster than its verification.
 *
 * Every repository fact these tests re-derive is read from disk (the
 * generated route tree, the Tool Registry manifest, the Hono boundary
 * source). Nothing here restates a copy that could drift.
 */

/** The five paths Issue #500 names as the representative route set. */
const ISSUE_SCOPED_PATHS = ['/', '/about', '/portfolio', '/tools', '/api/v1/health'];

/**
 * Per-route fixtures. Written as data rather than generated from the
 * registry's own patterns on purpose: a fixture that is derived from the
 * pattern under test proves nothing, because it would be wrong and correct
 * at the same time.
 */
const FIXTURES = {
	'/': {
		// The document title carries the origin suffix (Issue #418); the
		// <h1> does not. The fixture states both, so the two patterns are
		// pinned separately (Issue #816).
		title: 'my-web-2026 — rebuildup.dev',
		h1Text: 'my-web-2026',
		unmatchedProbes: { homeSections: false, reactionsDisabled: true },
	},
	'/about': {
		title: 'fixture — About',
		h1Text: 'fixture name',
		unmatchedProbes: { identityHeading: false, narrativeSections: false },
	},
	'/portfolio': {
		title: 'Portfolio — fixture',
		h1Text: '主要な制作物 / Selected projects',
		// Both documented branches at once — a state that cannot exist.
		unmatchedProbes: { emptyState: true, projectCard: true },
	},
	'/tools': {
		title: 'Tools — my-web-2026',
		// Issue #785: the index h1 is the Japanese surface title alone;
		// the English word sits in the eyebrow, not in the heading.
		h1Text: 'ツール',
		unmatchedProbes: { allManifestSlugsListed: false, everyRowClassified: false },
	},
	'/api/v1/health': {
		title: null,
		h1Text: null,
		unmatchedProbes: {
			statusOk: false,
			serviceIdentity: false,
			boundaryLayer: false,
			semverVersion: false,
		},
	},
};

/** A healthy `/api/v1/health` payload. `9.9.9` is a fixture, never a release. */
const HEALTH_PAYLOAD = {
	status: 'ok',
	service: 'my-web-2026',
	layer: 'external-boundary',
	version: '9.9.9',
};

function fixtureFor(path) {
	const fixture = FIXTURES[path];
	assert.ok(fixture, `no fixture for representative route ${path}`);
	return fixture;
}

/** A healthy observation for one registered route. */
function healthyObservation(route) {
	const fixture = fixtureFor(route.path);
	const firstState = route.defaultStates[0];
	assert.ok(firstState, `${route.path} documents no default state`);
	return {
		status: route.status,
		contentType: `${route.contentType}; charset=utf-8`,
		finalOrigin: CANONICAL_PRODUCTION_ORIGIN,
		finalPath: route.path,
		title: fixture.title,
		canonicalHref: route.canonical,
		h1Count: route.h1 === null ? 0 : 1,
		h1Visible: route.h1 !== null,
		h1Text: route.h1 === null ? null : fixture.h1Text,
		json: route.kind === 'api' ? HEALTH_PAYLOAD : null,
		defaultProbes: { ...firstState.probes },
	};
}

/** URL paths the generated TanStack route tree resolves to. */
function routeTreeTargets() {
	const source = readFileSync(resolve(REPO_ROOT, 'src/routeTree.gen.ts'), 'utf8');
	const block = source.match(/\n {2}to:\n([\s\S]*?)\n {2}id:/);
	assert.ok(block, 'could not read the `to` union out of src/routeTree.gen.ts');
	return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describe('representative-route registry — the Issue #500 scope', () => {
	it('registers exactly the five routes Issue #500 names', () => {
		assert.deepEqual(
			REPRESENTATIVE_ROUTES.map((route) => route.path),
			ISSUE_SCOPED_PATHS,
		);
	});

	it('registers no duplicate path', () => {
		const paths = REPRESENTATIVE_ROUTES.map((route) => route.path);
		assert.equal(new Set(paths).size, paths.length);
	});

	it('splits page routes from api routes without losing any entry', () => {
		assert.equal(REPRESENTATIVE_PAGE_ROUTES.length + REPRESENTATIVE_API_ROUTES.length, 5);
		assert.deepEqual(
			REPRESENTATIVE_API_ROUTES.map((route) => route.path),
			['/api/v1/health'],
		);
	});

	it('is read-only by construction — every entry declares GET', () => {
		for (const route of REPRESENTATIVE_ROUTES) {
			assert.equal(route.method, 'GET', `${route.path} must stay read-only`);
		}
	});

	it('declares one acceptable status and content type per route', () => {
		for (const route of REPRESENTATIVE_ROUTES) {
			assert.equal(route.status, 200, `${route.path} status`);
			assert.ok(route.contentType.length > 0, `${route.path} contentType`);
			assert.ok(route.label.length > 0, `${route.path} label`);
		}
	});

	it('documents at least one named default state with at least one probe each', () => {
		for (const route of REPRESENTATIVE_ROUTES) {
			assert.ok(
				route.defaultStates.length > 0,
				`${route.path} documents no default state — a smoke that asserts nothing is a false success`,
			);
			for (const state of route.defaultStates) {
				assert.ok(state.name.length > 0, `${route.path} default state name`);
				assert.ok(state.description.length > 0, `${route.path}/${state.name} description`);
				assert.ok(Object.keys(state.probes).length > 0, `${route.path}/${state.name} has no probe`);
			}
		}
	});

	it('gives every api route a probe-free h1 slot and every page route a real h1 selector', () => {
		for (const route of REPRESENTATIVE_PAGE_ROUTES) {
			assert.ok(route.h1, `${route.path} must declare its h1 selector`);
		}
		for (const route of REPRESENTATIVE_API_ROUTES) {
			assert.equal(route.h1, null, `${route.path} is JSON and has no h1`);
			assert.equal(route.canonical, null, `${route.path} is JSON and has no canonical`);
		}
	});
});

describe('representative-route registry — canonical origin', () => {
	it('derives the origin from the shared Cloudflare contract', () => {
		assert.equal(CANONICAL_PRODUCTION_ORIGIN, 'https://rebuildup.dev');
	});

	it('never points at the debug-only workers.dev host', () => {
		assert.equal(CANONICAL_PRODUCTION_ORIGIN.includes('workers.dev'), false);
		const source = readFileSync(resolve(REPO_ROOT, 'scripts/prod-smoke-routes.mjs'), 'utf8');
		// Prose may name the debug host; a URL may not point at it.
		assert.equal(/https?:\/\/[^\s'"`]*workers\.dev/.test(source), false);
	});

	it('does not restate the origin as a literal — it is imported, not duplicated', () => {
		const source = readFileSync(resolve(REPO_ROOT, 'scripts/prod-smoke-routes.mjs'), 'utf8');
		assert.equal(
			source.includes(`'${CANONICAL_PRODUCTION_ORIGIN}'`),
			false,
			'a second origin literal is exactly the drift PRODUCTION_CUSTOM_DOMAIN exists to prevent',
		);
		assert.ok(source.includes("from './_cloudflare-contract.mjs'"));
	});

	it('pins every canonical it does declare to the canonical origin', () => {
		for (const route of REPRESENTATIVE_ROUTES) {
			if (route.canonical === null) continue;
			assert.ok(
				route.canonical.startsWith(`${CANONICAL_PRODUCTION_ORIGIN}/`),
				`${route.path} canonical "${route.canonical}" must sit on the canonical origin`,
			);
		}
	});
});

describe('representative-route registry — drift guards against the repository', () => {
	it('registers only paths the generated route tree actually resolves', () => {
		const targets = routeTreeTargets();
		for (const route of REPRESENTATIVE_PAGE_ROUTES) {
			assert.ok(
				targets.includes(route.path),
				`${route.path} is registered but absent from the generated route tree — the smoke would follow a route that no longer exists`,
			);
		}
	});

	it('registers the health route the Hono boundary actually serves', () => {
		const hono = readFileSync(resolve(REPO_ROOT, 'src/http/hono.ts'), 'utf8');
		for (const route of REPRESENTATIVE_API_ROUTES) {
			assert.ok(
				hono.includes(`'${route.path}'`),
				`${route.path} is registered but the external boundary no longer serves it`,
			);
		}
	});

	it('only points one-click entries at registered representative page routes', () => {
		for (const entry of ONE_CLICK_ENTRIES) {
			assert.equal(entry.from, '/', 'one-click entries are declared from the home surface');
			const target = findRepresentativeRoute(entry.to);
			assert.ok(target, `${entry.to} is not a registered representative route`);
			assert.equal(target.kind, 'page', `${entry.to} is not navigable`);
			assert.ok(entry.selector.length > 0, `${entry.to} entry has no selector`);
			assert.ok(
				entry.selector.includes(`href="${entry.to}"`),
				`${entry.to} entry selector must name its own href, or the selector and the target can disagree`,
			);
		}
	});

	it('reaches every navigable representative page route in one click', () => {
		const targets = new Set(ONE_CLICK_ENTRIES.map((entry) => entry.to));
		for (const route of REPRESENTATIVE_PAGE_ROUTES) {
			if (route.path === '/') continue;
			assert.ok(
				targets.has(route.path),
				`${route.path} is registered but has no declared one-click entry from /`,
			);
		}
	});

	it('registers chrome-nav routes that really are representative page routes', () => {
		for (const path of CHROME_NAV_ROUTES) {
			const route = findRepresentativeRoute(path);
			assert.ok(route, `${path} is a chrome-nav route but is not registered`);
			assert.equal(route.kind, 'page', `${path} is a chrome-nav route but is not a page`);
		}
	});

	it('reads the Tool Registry manifest the /tools default state depends on', () => {
		const manifest = JSON.parse(
			readFileSync(resolve(REPO_ROOT, 'src/tools/manifest.json'), 'utf8'),
		);
		assert.ok(manifest.tools.length > 0, 'the Tool Registry manifest is empty');
		for (const tool of manifest.tools) {
			assert.match(tool.slug, /^[a-z0-9][a-z0-9-]*$/);
			assert.ok(
				['same_origin_static', 'external_exception', 'host_disabled'].includes(tool.delivery.kind),
				`${tool.slug} has a delivery kind the /tools row classification does not cover`,
			);
		}
	});

	it('keeps the linked-row delivery kinds in step with the Tool Registry', () => {
		// `/tools` renders a LINKED row for every `PUBLIC_DELIVERY_KINDS`
		// entry and a disabled row for everything else, so the smoke's
		// per-row classification is only as good as this copy of the rule.
		// Re-derive it from `src/tools/registry.ts` instead of trusting the
		// copy.
		const source = readFileSync(resolve(REPO_ROOT, 'src/tools/registry.ts'), 'utf8');
		const match = source.match(/PUBLIC_DELIVERY_KINDS\s*(?::[^=]*)?=\s*new Set[^(]*\(\[(.*?)\]/s);
		assert.ok(match, 'could not read PUBLIC_DELIVERY_KINDS out of src/tools/registry.ts');
		const kinds = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
		assert.ok(kinds.length > 0, 'PUBLIC_DELIVERY_KINDS parsed as empty');
		assert.deepEqual([...LINKED_TOOL_DELIVERY_KINDS].sort(), kinds.sort());
		assert.equal(
			LINKED_TOOL_DELIVERY_KINDS.includes('host_disabled'),
			false,
			'a host_disabled Tool must be classified as a Coming soon row, never as a linked one',
		);
	});

	it('pins the same section counts the local Playwright suites assert', () => {
		// The section counts are composition facts, so they are registry
		// data rather than adapter literals. The local suites render the
		// real pages and pin the same numbers, so a composition change
		// that updates one contract but not the other is caught here
		// instead of only at the next production smoke.
		const pinnedCount = (specPath, locator) => {
			const source = readFileSync(resolve(REPO_ROOT, specPath), 'utf8');
			const match = source.match(new RegExp(`${locator}[\\s\\S]{0,120}?toHaveCount\\((\\d+)\\)`));
			assert.ok(
				match,
				`${specPath} no longer pins a count for ${locator} — update this guard together with it`,
			);
			return Number(match[1]);
		};
		assert.equal(
			pinnedCount('e2e/smoke.spec.ts', 'page\\.locator\\(PAGE_CONTENT_SECTIONS\\)'),
			EXPECTED_SECTION_COUNTS['/'].labelled,
			'the home section count drifted between the local suite and the production contract',
		);
		assert.equal(
			pinnedCount('e2e/about.spec.ts', 'section\\[aria-labelledby\\^="about-section-"\\]'),
			EXPECTED_SECTION_COUNTS['/about'].narrative,
			'the /about narrative section count drifted between the local suite and the production contract',
		);
	});

	it('scopes the shared page-content selector to the page subtree', () => {
		// Issue #664 — the root layout's chrome (the GA4 consent panel
		// is a named `<section>`) lives outside `#app-root`, so a
		// document-wide `section[aria-labelledby]` selector would count
		// it as a section of every page. The shared constant is the one
		// place that scope is decided, so the guard pins the scope here
		// rather than trusting three call sites to agree.
		assert.match(
			PAGE_CONTENT_SECTIONS,
			/^#app-root section\[aria-labelledby\]$/,
			'the shared page-content selector must stay scoped to the page subtree',
		);
		for (const specPath of ['e2e/smoke.spec.ts', 'e2e/contact.spec.ts', 'e2e/prod-smoke.spec.ts']) {
			const source = readFileSync(resolve(REPO_ROOT, specPath), 'utf8');
			assert.ok(
				source.includes('PAGE_CONTENT_SECTIONS'),
				`${specPath} must count the page's own sections through the shared selector`,
			);
			assert.equal(
				source.includes("locator('section[aria-labelledby]')"),
				false,
				`${specPath} still counts sections document-wide — root-layout chrome would be counted as a page section (Issue #664)`,
			);
		}
	});

	it('declares a section count for exactly the routes whose default state counts sections', () => {
		const counting = REPRESENTATIVE_PAGE_ROUTES.filter((route) =>
			Object.keys(route.defaultStates[0].probes).some((probe) => /sections/i.test(probe)),
		);
		assert.deepEqual(
			counting.map((route) => route.path).sort(),
			Object.keys(EXPECTED_SECTION_COUNTS).sort(),
			'every count-based default state needs its expected count in EXPECTED_SECTION_COUNTS, and every entry there must be a count-based default state',
		);
		for (const [path, counts] of Object.entries(EXPECTED_SECTION_COUNTS)) {
			for (const [key, value] of Object.entries(counts)) {
				assert.ok(Number.isInteger(value) && value > 0, `${path}.${key} is not a positive count`);
			}
		}
	});
});

describe('representative-route registry — source hygiene', () => {
	it('carries no project release literal', () => {
		const source = readFileSync(resolve(REPO_ROOT, 'scripts/prod-smoke-routes.mjs'), 'utf8');
		assert.equal(
			/(?<![\d.])v?0\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?![\d.])/.test(source),
			false,
			'the registry must not restate the current release version',
		);
	});

	it('checks the health version by shape, not by value', () => {
		// The registry deliberately does not pin `/api/v1/health#version`
		// to package.json#version: production runs `main` while this
		// repository sits on the open release branch, so an equality
		// assertion would be red for the whole sprint. The probe it does
		// register is a semver SHAPE check, asserted here so a future
		// edit cannot quietly turn it into an equality check.
		const health = findRepresentativeRoute('/api/v1/health');
		assert.ok(health);
		assert.deepEqual(Object.keys(health.defaultStates[0].probes).sort(), [
			'boundaryLayer',
			'semverVersion',
			'serviceIdentity',
			'statusOk',
		]);
	});
});

describe('resolveDefaultState — classification of the documented branches', () => {
	it('returns the matching branch name', () => {
		const portfolio = findRepresentativeRoute('/portfolio');
		assert.equal(
			resolveDefaultState(portfolio, { emptyState: true, projectCard: false }),
			'catalogue-empty',
		);
		assert.equal(
			resolveDefaultState(portfolio, { emptyState: false, projectCard: true }),
			'catalogue-published',
		);
	});

	it('returns null when no documented branch matches', () => {
		const portfolio = findRepresentativeRoute('/portfolio');
		assert.equal(resolveDefaultState(portfolio, { emptyState: true, projectCard: true }), null);
	});

	it('returns null when a probe was never observed — an unmeasured route is never green', () => {
		const home = findRepresentativeRoute('/');
		assert.equal(resolveDefaultState(home, {}), null);
		assert.equal(resolveDefaultState(home, { homeSections: true }), null);
	});
});

/**
 * One fabricated defect per failure mode the classifier claims to catch.
 * `applies` skips a defect for routes that do not declare the field at
 * all (an api route has no title, a route with no canonical cannot have
 * the wrong one).
 */
const DEFECTS = [
	{
		name: 'an unexpected status',
		applies: () => true,
		mutate: (observation) => ({ ...observation, status: 503 }),
		expect: /expected status 200, got 503/,
	},
	{
		name: 'a redirect to a different origin',
		applies: () => true,
		mutate: (observation) => ({ ...observation, finalOrigin: 'https://look-alike.example' }),
		expect: /served from origin "https:\/\/look-alike\.example" after redirects/,
	},
	{
		name: 'a redirect to a different path',
		applies: () => true,
		mutate: (observation) => ({ ...observation, finalPath: '/404' }),
		expect: /is not answering for itself/,
	},
	{
		name: 'the wrong content type',
		applies: () => true,
		mutate: (observation) => ({ ...observation, contentType: 'text/plain; charset=utf-8' }),
		expect: /expected Content-Type starting with/,
	},
	{
		name: 'a missing title',
		applies: (route) => route.titlePattern !== null,
		mutate: (observation) => ({ ...observation, title: null }),
		expect: /declares no <title>/,
	},
	{
		name: 'the wrong title',
		applies: (route) => route.titlePattern !== null,
		mutate: (observation) => ({ ...observation, title: 'Deploy log — internal' }),
		expect: /<title> "Deploy log — internal" does not match/,
	},
	{
		name: 'a canonical pointing somewhere else',
		applies: (route) => route.canonical !== null,
		mutate: (observation) => ({ ...observation, canonicalHref: 'https://elsewhere.example/about' }),
		expect: /expected link\[rel=canonical\] href/,
	},
	{
		name: 'a missing canonical',
		applies: (route) => route.canonical !== null,
		mutate: (observation) => ({ ...observation, canonicalHref: null }),
		expect: /got no canonical link/,
	},
	{
		name: 'a duplicated h1',
		applies: (route) => route.h1 !== null,
		mutate: (observation) => ({ ...observation, h1Count: 2 }),
		expect: /expected exactly one <h1>, got 2/,
	},
	{
		name: 'an h1 that is not visible',
		applies: (route) => route.h1 !== null,
		mutate: (observation) => ({ ...observation, h1Visible: false }),
		expect: /is present but not visible/,
	},
	{
		name: 'the wrong h1 text',
		applies: (route) => route.h1TextPattern !== null,
		mutate: (observation) => ({ ...observation, h1Text: 'Internal build id' }),
		expect: /<h1> text "Internal build id" does not match/,
	},
	{
		name: 'a body that is not JSON',
		applies: (route) => route.kind === 'api',
		mutate: (observation) => ({ ...observation, json: null }),
		expect: /the response body is not parseable JSON/,
	},
	{
		name: 'an undocumented default state',
		applies: () => true,
		mutate: (observation, route) => ({
			...observation,
			defaultProbes: fixtureFor(route.path).unmatchedProbes,
		}),
		expect: /no documented default state matched/,
	},
	{
		name: 'a default state that was never observed',
		applies: () => true,
		mutate: (observation) => ({ ...observation, defaultProbes: {} }),
		expect: /no documented default state matched/,
	},
];

describe('auditRoute — a healthy route reports nothing', () => {
	for (const route of REPRESENTATIVE_ROUTES) {
		it(`${route.path} passes with a healthy observation`, () => {
			const problems = auditRoute(route, healthyObservation(route));
			assert.deepEqual(
				problems,
				[],
				`a healthy ${route.path} must produce an empty problem list:\n${problems.join('\n')}`,
			);
		});
	}
});

describe('auditRoute — every failure mode is reported, never swallowed', () => {
	for (const route of REPRESENTATIVE_ROUTES) {
		for (const defect of DEFECTS.filter((candidate) => candidate.applies(route))) {
			it(`${route.path} reports ${defect.name}`, () => {
				const problems = auditRoute(route, defect.mutate(healthyObservation(route), route));
				assert.ok(
					problems.length > 0,
					`${route.path} with ${defect.name} produced an empty problem list — that is a false success`,
				);
				assert.ok(
					problems.some((problem) => defect.expect.test(problem)),
					`${route.path} with ${defect.name} reported:\n${problems.join('\n')}`,
				);
				assert.ok(
					problems.every((problem) => problem.includes(route.path)),
					`every problem must name the route it belongs to:\n${problems.join('\n')}`,
				);
			});
		}
	}

	it('collects every defect at once instead of stopping at the first', () => {
		const health = findRepresentativeRoute('/api/v1/health');
		const problems = auditRoute(health, {
			...healthyObservation(health),
			status: 500,
			contentType: 'text/html',
			json: null,
		});
		assert.ok(problems.length >= 3, `expected a multi-defect report, got:\n${problems.join('\n')}`);
		assert.ok(problems.some((problem) => /expected status 200, got 500/.test(problem)));
		assert.ok(problems.some((problem) => /expected Content-Type starting with/.test(problem)));
		assert.ok(problems.some((problem) => /not parseable JSON/.test(problem)));
	});

	it('reports every unhealthy health payload field, naming the probe', () => {
		const health = findRepresentativeRoute('/api/v1/health');
		const healthy = healthyObservation(health);
		for (const probe of Object.keys(health.defaultStates[0].probes)) {
			const problems = auditRoute(health, {
				...healthy,
				defaultProbes: { ...healthy.defaultProbes, [probe]: false },
			});
			assert.ok(
				problems.length > 0,
				`a health payload whose "${probe}" probe is false must not pass silently`,
			);
			assert.ok(
				problems.some((problem) => problem.includes(`${probe}=false`)),
				`the report must name the failing probe "${probe}":\n${problems.join('\n')}`,
			);
		}
	});
});

describe('auditRoute — the origin the run was pointed at is part of the contract', () => {
	it('defaults to the canonical production origin', () => {
		// A run that does not pass an origin is a production run by
		// definition (`pnpm run e2e:prod` / `pnpm run e2e:prod:transition`),
		// so the default must be the canonical origin — never "accept
		// whatever answered", which is exactly the false success the
		// origin guard exists to remove.
		for (const route of REPRESENTATIVE_ROUTES) {
			const problems = auditRoute(route, {
				...healthyObservation(route),
				finalOrigin: 'https://look-alike.example',
			});
			assert.ok(
				problems.some((problem) => /must not leave the origin it was pointed at/.test(problem)),
				`${route.path} served from another origin must be reported with the default expected origin`,
			);
		}
	});

	it('accepts a rehearsal origin instead of production when the caller passes one', () => {
		// `pnpm run e2e:prod:local` points the same contract at the local
		// preview build; the origin guard must follow the run, not insist
		// on production and turn every rehearsal red.
		const localOrigin = 'http://127.0.0.1:3000';
		for (const route of REPRESENTATIVE_ROUTES) {
			const observation = { ...healthyObservation(route), finalOrigin: localOrigin };
			assert.deepEqual(
				auditRoute(route, observation, localOrigin),
				[],
				`a healthy local-origin observation must pass when the run was pointed at ${localOrigin}`,
			);
			assert.ok(
				auditRoute(route, observation, CANONICAL_PRODUCTION_ORIGIN).some((problem) =>
					/must not leave the origin it was pointed at/.test(problem),
				),
				`${route.path} answered on ${localOrigin} must not pass a production run`,
			);
		}
	});

	it('reports an unobserved origin rather than skipping the guard', () => {
		// Fail closed: an adapter that forgot to report the origin must
		// produce a problem, not an undefined comparison that silently
		// passes.
		const home = findRepresentativeRoute('/');
		const { finalOrigin, ...withoutOrigin } = healthyObservation(home);
		assert.ok(finalOrigin);
		const problems = auditRoute(home, withoutOrigin);
		assert.ok(
			problems.some((problem) => /served from origin "undefined"/.test(problem)),
			`an observation with no final origin must be reported, got:\n${problems.join('\n')}`,
		);
	});
});

describe('formatAuditReport — the failure report an operator reads weeks later', () => {
	it('says healthy when there is nothing wrong', () => {
		const home = findRepresentativeRoute('/');
		assert.equal(formatAuditReport(home, []), `${CANONICAL_PRODUCTION_ORIGIN}/ — healthy`);
	});

	it('names the absolute URL, every problem, and the read-only boundary', () => {
		const tools = findRepresentativeRoute('/tools');
		const problems = auditRoute(tools, {
			...healthyObservation(tools),
			status: 502,
			defaultProbes: fixtureFor('/tools').unmatchedProbes,
		});
		const report = formatAuditReport(tools, problems);
		assert.ok(report.includes(`${CANONICAL_PRODUCTION_ORIGIN}/tools`));
		for (const problem of problems) {
			assert.ok(report.includes(problem), `the report dropped the problem: ${problem}`);
		}
		assert.ok(report.includes('read-only'));
		assert.ok(report.includes(CANONICAL_PRODUCTION_ORIGIN));
	});

	it('emits exactly one bullet per problem', () => {
		const about = findRepresentativeRoute('/about');
		const problems = auditRoute(about, {
			...healthyObservation(about),
			status: 404,
			title: 'Deploy log — internal',
			canonicalHref: null,
		});
		const bullets = formatAuditReport(about, problems)
			.split('\n')
			.filter((line) => line.trimStart().startsWith('- '));
		assert.equal(bullets.length, problems.length);
	});

	it('names the origin it was actually given, not always production', () => {
		// A rehearsal run (`pnpm run e2e:prod:local`) must not print a
		// production URL it never touched: the whole value of the Issue
		// #500 verification artefact is that it states which origin was
		// observed.
		const tools = findRepresentativeRoute('/tools');
		const localOrigin = 'http://127.0.0.1:3000';
		const problems = auditRoute(tools, { ...healthyObservation(tools), status: 502 });
		const report = formatAuditReport(tools, problems, localOrigin);
		assert.ok(report.includes(`${localOrigin}/tools`));
		assert.equal(report.includes('https://rebuildup.dev'), false);
		assert.equal(formatAuditReport(tools, [], localOrigin), `${localOrigin}/tools — healthy`);
	});
});

describe('representative-route registry — classifier coverage guard', () => {
	it('gives every registered route at least one defect fixture of its own', () => {
		for (const route of REPRESENTATIVE_ROUTES) {
			const applicable = DEFECTS.filter((defect) => defect.applies(route));
			assert.ok(
				applicable.length >= 3,
				`${route.path} has only ${applicable.length} defect fixture(s); a route whose classifier is barely exercised is how a false success ships`,
			);
		}
	});

	it('gives every registered route an offline healthy fixture', () => {
		for (const route of REPRESENTATIVE_ROUTES) {
			assert.ok(FIXTURES[route.path], `${route.path} has no healthy fixture`);
			assert.deepEqual(
				Object.keys(fixtureFor(route.path).unmatchedProbes).sort(),
				Object.keys(route.defaultStates[0].probes).sort(),
				`${route.path} fixture probes must match the registered probe keys`,
			);
		}
	});
});
