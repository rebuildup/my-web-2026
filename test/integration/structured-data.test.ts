/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ABOUT_DATA } from '../../src/about/data';
import {
	type JsonLdNode,
	PERSON_UNAPPROVED_PROPERTIES,
	ROUTE_COVERAGE,
	validateStructuredData,
} from '../../src/editorial/structured-data';
import {
	applyPortfolioSchema,
	clearPortfolioTables,
	seedEntry,
	seedPortfolioEntry,
} from './fixtures/portfolio-d1';
import SNAPSHOT from './fixtures/structured-data-snapshot.json';

/**
 * Route coverage for structured data (Issue #422).
 *
 * This suite reads the REAL SSR HTML — `SELF.fetch` goes through the
 * same TanStack Start pipeline production serves — so what is
 * asserted is what a crawler receives, not what a builder returns in
 * isolation.
 *
 * Three failure modes it is written to prevent:
 *
 *   1. **A missing node passing as success.** Every registry entry
 *      is compared in both directions: the declared `@type` list must
 *      be present AND nothing undeclared may appear. A route whose
 *      JSON-LD silently disappeared fails here.
 *   2. **An unimplemented route passing as success.** A route
 *      declared `not-implemented` is fetched too and must emit zero
 *      nodes. When someone adds `Person` to `/tools`, this suite
 *      fails until the registry is updated — "not implemented"
 *      cannot quietly become "probably fine".
 *   3. **A drifted screenshot.** The emitted nodes are compared to
 *      `fixtures/structured-data-snapshot.json`, which is also what
 *      the PR screenshot renders. Editing the node breaks CI first,
 *      so the committed report cannot describe a different document.
 *
 * `ROUTE_COVERAGE` itself is gated statically by
 * `scripts/check-structured-data-coverage.mjs`, which proves the
 * registry has no gap against `src/routes/**`.
 */

const APPROVED_SAME_AS = ABOUT_DATA.externalHandles.map((handle) => handle.href);

const SAMPLED_ROUTES = ROUTE_COVERAGE.filter((route) => route.public && route.samplePath !== null);

/** Parse every `application/ld+json` script. A malformed one throws. */
function extractJsonLd(html: string): unknown[] {
	const pattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
	const nodes: unknown[] = [];
	for (const match of html.matchAll(pattern)) {
		const raw = match[1] as string;
		// Unparseable structured data is a failure, not an empty list.
		nodes.push(JSON.parse(raw));
	}
	return nodes;
}

async function fetchHtml(path: string): Promise<string> {
	const response = await SELF.fetch(`https://example.com${path}`, { redirect: 'manual' });
	const status = response.status;
	if (status < 200 || status >= 300) {
		throw new Error(
			`structured data coverage: GET ${path} returned status ${status} — an unreachable route must never count as covered`,
		);
	}
	return response.text();
}

function nodeOfType(nodes: readonly unknown[], type: string): JsonLdNode {
	const node = nodes.find(
		(candidate) =>
			typeof candidate === 'object' &&
			candidate !== null &&
			(candidate as JsonLdNode)['@type'] === type,
	);
	if (!node) throw new Error(`no ${type} node in the document`);
	return node as JsonLdNode;
}

beforeAll(async () => {
	await applyPortfolioSchema(env.DB);
	await clearPortfolioTables(env.DB);
	await seedPortfolioEntry(env.DB, seedEntry('aulymo'));
});

describe('structured data — declared route coverage holds against real SSR HTML', () => {
	it('samples every public registry entry that declares a sample path', () => {
		expect(SAMPLED_ROUTES.length).toBeGreaterThanOrEqual(6);
	});

	for (const route of SAMPLED_ROUTES) {
		it(`${route.path} emits exactly ${JSON.stringify(route.expectedTypes)}`, async () => {
			const html = await fetchHtml(route.samplePath as string);
			const nodes = extractJsonLd(html);
			const types = nodes.map((node) => (node as JsonLdNode)['@type']);
			// Both directions: nothing missing, nothing undeclared.
			expect(types).toEqual([...route.expectedTypes]);

			const validation = validateStructuredData(nodes, { approvedSameAs: APPROVED_SAME_AS });
			expect(validation.findings).toEqual([]);
			expect(validation.valid).toBe(true);
		});
	}
});

describe('structured data — routes that emit nothing say so out loud', () => {
	for (const route of ROUTE_COVERAGE.filter(
		(entry) => entry.status === 'not-implemented' && entry.samplePath !== null,
	)) {
		it(`${route.path} is served and emits zero JSON-LD nodes`, async () => {
			const html = await fetchHtml(route.samplePath as string);
			expect(extractJsonLd(html)).toEqual([]);
		});
	}
});

describe('structured data — the /about Person node', () => {
	it('matches the committed snapshot exactly', async () => {
		const nodes = extractJsonLd(await fetchHtml('/about'));
		expect(nodeOfType(nodes, 'Person')).toEqual(SNAPSHOT.about.person);
	});

	it('carries no award, education or credential property', async () => {
		const nodes = extractJsonLd(await fetchHtml('/about'));
		const person = nodeOfType(nodes, 'Person');
		for (const { property } of PERSON_UNAPPROVED_PROPERTIES) {
			expect(person).not.toHaveProperty(property);
		}
	});

	it('does not leak the display-only school / grade string into the document', async () => {
		const nodes = extractJsonLd(await fetchHtml('/about'));
		const serialised = JSON.stringify(nodes);
		// `identity.role` is rendered by <AboutPage /> and is a real
		// fact; it is still absent here, because a display sentence is
		// not a record with a period.
		expect(ABOUT_DATA.identity.role).toContain('宇部高専');
		expect(serialised).not.toContain('宇部高専');
		expect(serialised).not.toContain('本科4年');
	});

	it('uses only approved sameAs handles', async () => {
		const nodes = extractJsonLd(await fetchHtml('/about'));
		expect(nodeOfType(nodes, 'Person').sameAs).toEqual(APPROVED_SAME_AS);
	});
});

describe('structured data — the /portfolio/[slug] CreativeWork node', () => {
	it('matches the committed snapshot exactly', async () => {
		const nodes = extractJsonLd(await fetchHtml('/portfolio/aulymo'));
		expect(nodeOfType(nodes, 'CreativeWork')).toEqual(SNAPSHOT.portfolio.creativeWork);
	});

	it('keeps the seed period precision — year, not the storage day component', async () => {
		const nodes = extractJsonLd(await fetchHtml('/portfolio/aulymo'));
		// PORTFOLIO_SEED#aulymo records 「2022 - present」 and stores
		// period_start as 2022-01-01. Only the year is a known fact.
		expect(nodeOfType(nodes, 'CreativeWork').dateCreated).toBe('2022');
	});

	it('resolves its author reference to the canonical person', async () => {
		const nodes = extractJsonLd(await fetchHtml('/portfolio/aulymo'));
		const author = nodeOfType(nodes, 'CreativeWork').author as JsonLdNode;
		expect(author['@type']).toBe('Person');
		expect(author['@id']).toBe('https://rebuildup.dev/about#person');
		expect(author.url).toBe('https://rebuildup.dev/about');
	});

	it('omits the cover image when the row has no composed media url', async () => {
		const nodes = extractJsonLd(await fetchHtml('/portfolio/aulymo'));
		// The test pool leaves env.MEDIA unbound, so `composeMediaUrl`
		// yields null. Fail-closed: no image key at all, rather than an
		// empty or relative one.
		expect(nodeOfType(nodes, 'CreativeWork')).not.toHaveProperty('image');
	});
});

describe('structured data — Rich Results is reported as NOT evaluated', () => {
	it('never claims Google rich-result eligibility', async () => {
		const nodes = extractJsonLd(await fetchHtml('/about'));
		const validation = validateStructuredData(nodes, { approvedSameAs: APPROVED_SAME_AS });
		expect(validation.richResults.evaluated).toBe(false);
	});
});
