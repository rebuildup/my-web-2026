/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { findIdentifiers } from '../../scripts/check-public-internal-identifiers.mjs';
import {
	applyPortfolioSchema,
	clearPortfolioTables,
	seedPortfolioRow,
} from './fixtures/portfolio-d1';
import { applyReactionsSchema } from './fixtures/reactions-d1';

/**
 * SSR-payload internal-identifier gate (Issue #1009).
 *
 * `scripts/check-public-internal-identifiers.mjs` scans source copy
 * surfaces, but a loader can still serialise an internal field into
 * the `$_TSR` dehydrated payload — exactly the #1005 defect class
 * (manifest internals reaching the visitor). Source scanning cannot
 * see that: the leak only exists in the rendered document.
 *
 * This suite closes the gap from the other side: it fetches every
 * public SSR route's real Worker HTML — which embeds the dehydrated
 * loader payload — and applies the SAME detection rules the copy gate
 * uses. Any repo path, internal field name, issue ref or release ref
 * in the bytes a visitor receives fails the build.
 *
 * `/admin/**` is absent: it sits behind the auth boundary and its
 * content is owner-approved by definition (same scope rule as
 * `privacy-projection.test.ts`).
 *
 * The route list below must name every public route file under
 * `src/routes/**`; a new public route without a row here is a
 * coverage hole.
 */
const PUBLIC_FIXTURE_SLUG = 'identifier-fixture-public';

const PUBLIC_SSR_PATHS = [
	'/',
	'/about',
	'/contact',
	'/portfolio',
	`/portfolio/${PUBLIC_FIXTURE_SLUG}`,
	'/tools',
	'/tools/text-counter',
	'/tools/prototype',
	'/design-system',
	'/keyboard',
	'/projects/dotfiles',
] as const;

/**
 * Public JSON surfaces that answer without an API key. `/api/v1/*`
 * bodies are scanned with the same rules — an internal field name in
 * a JSON key is the same leak class as one in HTML.
 */
const PUBLIC_JSON_PATHS = ['/api/v1/health', '/api/v1/db/ping'] as const;

interface ScanHit {
	readonly rule: string;
	readonly match: string;
}

/**
 * References that are allowlisted pending owner triage — the same
 * "intentional technical description" class Issue #837 O-8 reserves
 * for reasoned exceptions, never a silent suppression:
 *
 *   - `/design-system` is the public design-system documentation
 *     surface; naming `src/editorial/` token sources, verification
 *     fixtures and the Issues that shipped a decision is its authored
 *     content, not leaked internals.
 *   - `/projects/dotfiles` renders authored portfolio copy that
 *     documents this repository's ADR layout; the paths are the
 *     project's subject matter.
 *   - `/` `src/home/digits/*.webp` are Vite `?url` asset imports.
 *     The workerd test pool resolves them to source paths; a
 *     production `vite build` emits content-hashed `/assets/` URLs,
 *     so the match cannot appear in deployed HTML. It is a
 *     test-environment artefact, listed here so the gate stays
 *     strict everywhere else.
 *
 * Each entry is prefix-matched on `match`; removing an entry makes
 * the corresponding finding fail again — the list only shrinks.
 */
const ALLOWED_REFERENCES: readonly { path: string; rule: string; matchPrefix: string }[] = [
	{ path: '/design-system', rule: 'repo-path', matchPrefix: 'src/editorial/' },
	{ path: '/design-system', rule: 'repo-path', matchPrefix: 'docs/verification/' },
	{ path: '/design-system', rule: 'repo-path', matchPrefix: 'src/styles.css' },
	{ path: '/design-system', rule: 'issue-ref', matchPrefix: 'Issue #' },
	{ path: '/projects/dotfiles', rule: 'repo-path', matchPrefix: 'docs/adr/' },
	{ path: '/', rule: 'repo-path', matchPrefix: 'src/home/digits/' },
];

function isAllowed(path: string, hit: ScanHit): boolean {
	return ALLOWED_REFERENCES.some(
		(entry) =>
			entry.path === path && entry.rule === hit.rule && hit.match.startsWith(entry.matchPrefix),
	);
}

function scanBody(path: string, body: string): string[] {
	const hits: ScanHit[] = [];
	// The detector works on candidate text; the whole document is fed
	// as one candidate so matches inside embedded JSON (`$_TSR`)
	// count the same as visible markup.
	for (const hit of findIdentifiers(body)) {
		hits.push({ rule: hit.rule as string, match: hit.match });
	}
	return hits
		.filter((hit) => !isAllowed(path, hit))
		.map((hit) => `${path} [${hit.rule}] "${hit.match}"`);
}

beforeAll(async () => {
	await applyReactionsSchema(env.DB);
	await applyPortfolioSchema(env.DB);
	await clearPortfolioTables(env.DB);
	await seedPortfolioRow(env.DB, PUBLIC_FIXTURE_SLUG, {
		title: 'Identifier Fixture Project',
		summary: '公開可能な 1 行サマリー。',
	});
});

describe('public surface — no internal identifiers reach rendered bytes', () => {
	it('fixture: the detector fires on a synthetic leak (non-vacuity)', () => {
		const hits = scanBody(
			'fixture',
			'<html><body><script>window.__TSR__ = {"source":"src/tools/manifest.json","note":"see Issue #465 and release-0-9-0"}</script></body></html>',
		);
		expect(hits.length).toBeGreaterThanOrEqual(3);
	});

	it('fixture: ordinary public copy passes clean', () => {
		const hits = scanBody(
			'fixture',
			'<html><body><p>Tools, portfolio, keyboard layouts and contact.</p><a href="/portfolio">Works</a></body></html>',
		);
		expect(hits).toEqual([]);
	});

	for (const path of PUBLIC_SSR_PATHS) {
		it(`GET ${path} carries no internal identifier`, async () => {
			const response = await SELF.fetch(`https://example.com${path}`);
			expect(response.status).toBe(200);
			const html = await response.text();
			expect(scanBody(path, html)).toEqual([]);
		});
	}

	for (const path of PUBLIC_JSON_PATHS) {
		it(`GET ${path} carries no internal identifier`, async () => {
			const response = await SELF.fetch(`https://example.com${path}`);
			expect([200, 404]).toContain(response.status);
			const body = await response.text();
			expect(scanBody(path, body)).toEqual([]);
		});
	}
});
