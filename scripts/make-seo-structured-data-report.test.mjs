import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { escapeHtml, renderReportHtml } from './_seo-structured-data-report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = JSON.parse(
	readFileSync(join(ROOT, 'src/editorial/structured-data/contract.json'), 'utf8'),
);
const SNAPSHOT = JSON.parse(
	readFileSync(join(ROOT, 'test/integration/fixtures/structured-data-snapshot.json'), 'utf8'),
);

const REPORT = {
	version: '4.1.11',
	testResults: [
		{
			startTime: 0,
			endTime: 4200,
			assertionResults: [
				{
					fullName: 'validateStructuredData — negative control (no silent pass) rejects an award',
					status: 'passed',
					duration: 3,
				},
				{
					fullName: '/about emits exactly ["BreadcrumbList","Person"]',
					status: 'passed',
					duration: 12,
				},
				{
					fullName: '/tools is served and emits zero JSON-LD nodes',
					status: 'failed',
					duration: 7,
				},
			],
		},
	],
};

const html = renderReportHtml({
	report: REPORT,
	registry: REGISTRY,
	snapshot: SNAPSHOT,
	environment: { node: 'Node v22.18.0', platform: 'darwin arm64', vitest: '4.1.11' },
	reproduction: 'pnpm exec vitest run structured-data',
});

test('escapes HTML so report content can never break the page', () => {
	assert.equal(
		escapeHtml('<script>"x"&y</script>'),
		'&lt;script&gt;&quot;x&quot;&amp;y&lt;/script&gt;',
	);
});

test('renders every public route from the registry, not a hand-written list', () => {
	for (const route of REGISTRY.routes.filter((entry) => entry.public)) {
		assert.ok(html.includes(route.path), `missing route ${route.path}`);
	}
});

test('marks unimplemented routes as NOT IMPLEMENTED instead of as a pass', () => {
	const notImplemented = REGISTRY.routes.filter(
		(route) => route.public && route.status === 'not-implemented',
	);
	assert.ok(notImplemented.length > 0);
	const occurrences = html.split('<span class="verdict verdict-not-implemented">').length - 1;
	assert.equal(occurrences, notImplemented.length);
	assert.ok(html.includes('NOT IMPLEMENTED'));
	// A route that emits nothing must never be rendered as PASS.
	assert.ok(!html.includes('verdict-implemented">NOT IMPLEMENTED'));
});

test('separates negative controls from ordinary results', () => {
	assert.ok(html.includes('negative control'));
	assert.ok(html.includes('REJECTED'));
	assert.ok(html.includes('PASS'));
});

test('shows the committed Person / CreativeWork snapshots', () => {
	assert.ok(html.includes(SNAPSHOT.about.person.name));
	assert.ok(html.includes(SNAPSHOT.portfolio.creativeWork['@id']));
});

test('lists every withheld Person property with its reason', () => {
	for (const entry of REGISTRY.person.unapprovedProperties) {
		assert.ok(html.includes(`Person.${entry.property}`), `missing ${entry.property}`);
	}
});

test('states that Rich Results eligibility is not what this report measures', () => {
	assert.ok(html.includes('Rich Results'));
	assert.ok(html.includes('別系統'));
});

test('renders the reproduction commands', () => {
	assert.ok(html.includes('pnpm exec vitest run structured-data'));
});

test('reports failing tests as failures', () => {
	assert.ok(html.includes('>FAILED<'));
	assert.equal((html.match(/>PASS</g) ?? []).length, 1);
});
