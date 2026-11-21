import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
	aggregateVerdict,
	judgeCompositionModel,
	judgeRoute,
	loadContract,
} from './judge-composition.mjs';

/**
 * Composition lint judge tests (Issue #1132, ADR-0023).
 *
 * The judge is a pure function over `composition-model/v1` JSON. These
 * tests pin the falsifiability contract: every negative fixture must
 * produce at least one Blocking verdict on its expected rule, and no
 * positive fixture may produce a Blocking verdict. Warnings are
 * recorded, not failed — they feed the L-C visual review.
 */

const CONTRACT = loadContract();
const FIXTURES = 'quality/fixtures/composition-lint';

function loadFixture(...parts) {
	return JSON.parse(readFileSync(join(FIXTURES, ...parts), 'utf8'));
}

function fixtureFiles(dir) {
	return readdirSync(join(FIXTURES, dir)).filter((f) => f.endsWith('.json'));
}

/** Group `name.w1440.json` / `name.w390.json` / `name.json` fixtures. */
function groupFixtures(dir) {
	const groups = new Map();
	for (const file of fixtureFiles(dir)) {
		const base = file.replace(/\.w\d+\.json$|\.json$/, '');
		if (!groups.has(base)) groups.set(base, {});
		const stem = file.includes('.w') ? file.match(/\.w(\d+)\.json$/)[1] : 'single';
		groups.get(base)[stem] = file;
	}
	return groups;
}

const ROUTES = Object.fromEntries(CONTRACT.routes.map((r) => [r.slug, r]));

// Route slug each fixture exercises (defaults to a generic page).
const FIXTURE_ROUTE = {
	'text-only-portfolio': 'portfolio',
	'list-with-rhythm': 'tools',
	'media-led-detail': 'portfolio-detail',
};

function routeFor(name) {
	return CONTRACT.routes.find((r) => r.slug === FIXTURE_ROUTE[name]) ?? {
		path: '/fixture',
		mediaExpected: false,
		indexRoute: false,
	};
}

function modelsFor(files) {
	const out = {};
	for (const [stem, file] of Object.entries(files)) {
		if (stem === 'single') continue;
		out[`w${stem}`] = loadFixture(files.dir ?? '', file);
	}
	return out;
}

// Each negative fixture names the rule(s) it exists to prove. Blocking
// rules must verdict 'fail'; warning rules must verdict 'warn' — a
// warning-level rule that never fires is as broken as a blocking one
// that never fires.
const NEGATIVE_EXPECT = {
	'monotone-stack': ['CL-1'],
	'repeated-structure': ['CL-2'],
	'no-hierarchy': ['CL-3'],
	'narrow-column': ['CL-4'],
	'uniform-grid': ['CL-5'],
	'text-only-portfolio': ['CL-6'],
	'mobile-naive-stack': ['CL-7'],
	'no-tone-variation': ['CL-8'],
	'no-focal': ['CL-9'],
};

describe('composition lint judge — negative fixtures must fire their rule', () => {
	for (const [name, files] of groupFixtures('negative')) {
		it(`${name} fires ${NEGATIVE_EXPECT[name].join('/')}`, () => {
			const route = routeFor(name);
			let verdicts;
			if (files.single) {
				verdicts = judgeCompositionModel(
					loadFixture('negative', files.single),
					CONTRACT,
					route,
					CONTRACT.viewports[0],
				);
			} else {
				const byViewport = {};
				for (const [stem, file] of Object.entries(files)) {
					byViewport[`w${stem}`] = loadFixture('negative', file);
				}
				verdicts = judgeRoute(byViewport, CONTRACT, route);
			}
			for (const ruleId of NEGATIVE_EXPECT[name]) {
				const rule = CONTRACT.rules.find((r) => r.id === ruleId);
				const expected = rule.severity === 'blocking' ? 'fail' : 'warn';
				assert.ok(
					verdicts.some((v) => v.rule === ruleId && v.verdict === expected),
					`${name} must fire ${ruleId} as ${expected}, got: ${JSON.stringify(verdicts)}`,
				);
			}
		});
	}
});

describe('composition lint judge — positive fixtures must not fail', () => {
	for (const [name, files] of groupFixtures('positive')) {
		it(`${name} produces no blocking verdict`, () => {
			const route = routeFor(name);
			let verdicts;
			if (files.single) {
				verdicts = judgeCompositionModel(
					loadFixture('positive', files.single),
					CONTRACT,
					route,
					CONTRACT.viewports[0],
				);
			} else {
				const byViewport = {};
				for (const [stem, file] of Object.entries(files)) {
					byViewport[`w${stem}`] = loadFixture('positive', file);
				}
				verdicts = judgeRoute(byViewport, CONTRACT, route);
			}
			const blocking = verdicts.filter((v) => v.verdict === 'fail' && v.severity === 'blocking');
			assert.deepEqual(
				blocking,
				[],
				`${name} must not produce a blocking verdict, got: ${JSON.stringify(verdicts)}`,
			);
		});
	}
});

describe('composition lint judge — rule-level expectations', () => {
	it('monotone-stack fails CL-1 specifically', () => {
		const verdicts = judgeCompositionModel(
			loadFixture('negative', 'monotone-stack.json'),
			CONTRACT,
			routeFor('monotone-stack'),
			CONTRACT.viewports[0],
		);
		assert.ok(verdicts.some((v) => v.rule === 'CL-1' && v.verdict === 'fail'));
	});

	it('text-only-portfolio fails CL-6 specifically', () => {
		const verdicts = judgeCompositionModel(
			loadFixture('negative', 'text-only-portfolio.json'),
			CONTRACT,
			routeFor('text-only-portfolio'),
			CONTRACT.viewports[0],
		);
		assert.ok(verdicts.some((v) => v.rule === 'CL-6' && v.verdict === 'fail'));
	});

	it('mobile-naive-stack warns CL-7', () => {
		const byViewport = {
			w1440: loadFixture('negative', 'mobile-naive-stack.w1440.json'),
			w390: loadFixture('negative', 'mobile-naive-stack.w390.json'),
		};
		const verdicts = judgeRoute(byViewport, CONTRACT, routeFor('mobile-naive-stack'));
		assert.ok(verdicts.some((v) => v.rule === 'CL-7'));
	});

	it('media-led-detail passes CL-6 on a mediaExpected route', () => {
		const verdicts = judgeCompositionModel(
			loadFixture('positive', 'media-led-detail.json'),
			CONTRACT,
			routeFor('media-led-detail'),
			CONTRACT.viewports[0],
		);
		assert.ok(!verdicts.some((v) => v.rule === 'CL-6'));
	});

	it('rejects an unknown model version (fail-closed)', () => {
		const verdicts = judgeCompositionModel(
			{ version: 'composition-model/v0', sections: [] },
			CONTRACT,
			routeFor('x'),
			CONTRACT.viewports[0],
		);
		assert.equal(aggregateVerdict(verdicts), 'fail');
	});
});
