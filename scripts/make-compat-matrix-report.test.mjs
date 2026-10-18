import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	assertWebpTarget,
	collectMatrix,
	findUncoveredRoutes,
	relativePath,
	renderMatrixHtml,
	resolveCellState,
} from './make-compat-matrix-report.mjs';

/**
 * Regression tests for the Issue #415 matrix report.
 *
 * The failure these guard against is specific: the Playwright JSON
 * reporter emits ONE spec entry per project, so a naive flatten
 * renders a 3-engine run as 3 single-engine rows (or, worse, merges a
 * failed retry with a later pass and reports the row green). Both would
 * make the committed verification screenshot disagree with what CI
 * actually ran, which is the exact 「無言の合格」 the Issue forbids.
 */

const ENGINES = ['chromium', 'firefox', 'webkit'];

function projectConfig() {
	return { projects: ENGINES.map((name) => ({ name })) };
}

function test_(projectName, status, error) {
	return {
		projectName,
		status,
		results: [{ status: status === 'skipped' ? 'skipped' : 'passed', duration: 100, error }],
	};
}

function report(specs) {
	return {
		config: projectConfig(),
		suites: [
			{
				title: 'public-ui.spec.ts',
				file: 'public-ui.spec.ts',
				specs,
				suites: [],
			},
		],
	};
}

function spec(title, tests) {
	return { title, file: 'public-ui.spec.ts', tests };
}

describe('make-compat-matrix-report — cell state', () => {
	it('maps Playwright outcomes onto visible cells', () => {
		assert.equal(resolveCellState({ status: 'expected' }), 'pass');
		assert.equal(resolveCellState({ status: 'flaky' }), 'flaky');
		assert.equal(resolveCellState({ status: 'skipped' }), 'skip');
		assert.equal(resolveCellState({ status: 'unexpected' }), 'fail');
	});

	it('treats an unknown or missing status as a failure, never as a pass', () => {
		assert.equal(resolveCellState({ status: 'something-new' }), 'fail');
		assert.equal(resolveCellState(undefined), 'fail');
	});
});

describe('make-compat-matrix-report — collectMatrix', () => {
	it('merges the per-project spec entries of one test into one row', () => {
		const matrix = collectMatrix(
			report([
				spec('/ satisfies the public display contract', [test_('chromium', 'expected')]),
				spec('/ satisfies the public display contract', [test_('firefox', 'expected')]),
				spec('/ satisfies the public display contract', [test_('webkit', 'expected')]),
			]),
		);

		assert.equal(matrix.engines.join(','), ENGINES.join(','));
		assert.equal(matrix.rows.length, 1);
		assert.equal(matrix.tests, 3);
		assert.deepEqual(matrix.totals, { pass: 3, fail: 0, flaky: 0, skip: 0 });
	});

	it('renders a single-engine regression as a single red cell', () => {
		const matrix = collectMatrix(
			report([
				spec('/about satisfies the public display contract', [test_('chromium', 'expected')]),
				spec('/about satisfies the public display contract', [test_('firefox', 'expected')]),
				spec('/about satisfies the public display contract', [
					test_('webkit', 'unexpected', { message: '/about must render exactly one <main>' }),
				]),
			]),
		);

		const row = matrix.rows[0];
		assert.equal(row.cells.get('chromium').state, 'pass');
		assert.equal(row.cells.get('firefox').state, 'pass');
		assert.equal(row.cells.get('webkit').state, 'fail');
		assert.match(row.cells.get('webkit').detail, /exactly one <main>/);
		assert.equal(matrix.totals.fail, 1);
	});

	it('never lets a later pass overwrite a failure or a flaky outcome', () => {
		const matrix = collectMatrix(
			report([
				spec('/ flaky row', [test_('chromium', 'unexpected', { message: 'first try failed' })]),
				spec('/ flaky row', [test_('chromium', 'expected')]),
				spec('/ flaky row', [test_('firefox', 'flaky')]),
				spec('/ flaky row', [test_('firefox', 'expected')]),
			]),
		);

		assert.equal(matrix.rows[0].cells.get('chromium').state, 'fail');
		assert.equal(matrix.rows[0].cells.get('firefox').state, 'flaky');
	});

	it('keeps a skipped test visible instead of folding it into a pass', () => {
		const matrix = collectMatrix(
			report([
				spec('skip-to-content link', [test_('chromium', 'expected')]),
				spec('skip-to-content link', [test_('firefox', 'expected')]),
				spec('skip-to-content link', [test_('webkit', 'skipped')]),
			]),
		);

		assert.equal(matrix.totals.pass, 2);
		assert.equal(matrix.totals.skip, 1);
	});

	it('walks nested describe suites and qualifies the row title', () => {
		const nested = {
			config: projectConfig(),
			suites: [
				{
					title: 'public-ui.spec.ts',
					file: 'public-ui.spec.ts',
					specs: [],
					suites: [
						{
							title: 'basic operations — mobile viewport',
							file: 'public-ui.spec.ts',
							specs: [spec('hamburger opens the panel', [test_('chromium', 'expected')])],
							suites: [],
						},
					],
				},
			],
		};
		const matrix = collectMatrix(nested);

		assert.equal(matrix.rows.length, 1);
		assert.equal(
			matrix.rows[0].title,
			'public-ui.spec.ts › basic operations — mobile viewport › hamburger opens the panel',
		);
	});
});

describe('make-compat-matrix-report — roster coverage', () => {
	const roster = [
		{ path: '/', slug: 'home', label: 'ホーム', h1: '/^my-web-2026$/' },
		{ path: '/about', slug: 'about', label: '自己紹介', h1: '/木村友亮/' },
	];

	it('reports nothing uncovered when every roster route was executed', () => {
		const matrix = collectMatrix(
			report([
				spec('/ satisfies the public display contract', [test_('chromium', 'expected')]),
				spec('/about satisfies the public display contract', [test_('chromium', 'expected')]),
			]),
		);
		assert.deepEqual(findUncoveredRoutes(roster, matrix.rows), []);
	});

	it('reports a roster route that no test executed', () => {
		const matrix = collectMatrix(
			report([spec('/ satisfies the public display contract', [test_('chromium', 'expected')])]),
		);
		assert.deepEqual(findUncoveredRoutes(roster, matrix.rows), ['/about']);
	});

	it('reports the whole roster as uncovered when nothing ran', () => {
		assert.deepEqual(findUncoveredRoutes(roster, []), ['/', '/about']);
	});
});

describe('make-compat-matrix-report — rendering', () => {
	const matrix = collectMatrix(
		report([
			spec('/ satisfies the public display contract', [test_('chromium', 'expected')]),
			spec('/ satisfies the public display contract', [test_('firefox', 'expected')]),
			spec('/ satisfies the public display contract', [test_('webkit', 'skipped')]),
		]),
	);

	const base = {
		matrix,
		roster: [{ path: '/', slug: 'home', label: 'ホーム', h1: '/^my-web-2026$/' }],
		environment: { OS: 'test-os', Node: 'test-runtime' },
		screenshotPrefix: 'compat-screenshots',
		screenshotRoot: '/nonexistent',
	};

	it('emits one column per engine and keeps SKIP distinguishable', () => {
		const html = renderMatrixHtml({ ...base, uncovered: [] });
		for (const engine of ENGINES) assert.match(html, new RegExp(`<th>${engine}</th>`));
		assert.equal(html.match(/class="cell pass"/g).length, 2);
		assert.equal(html.match(/class="cell skip"/g).length, 1);
	});

	it('states the uncovered band only when a roster route was skipped', () => {
		assert.match(renderMatrixHtml({ ...base, uncovered: [] }), /未実行 route なし/);
		assert.match(renderMatrixHtml({ ...base, uncovered: ['/about'] }), /無言の合格にしない/);
	});

	it('marks a missing screenshot instead of emitting a broken image', () => {
		const html = renderMatrixHtml({ ...base, uncovered: [] });
		assert.match(html, /no capture/);
		assert.doesNotMatch(html, /<img/);
	});

	it('escapes HTML in failure messages taken from the report', () => {
		const failing = collectMatrix(
			report([
				spec('/x satisfies the public display contract', [
					test_('chromium', 'unexpected', { message: '<script>alert(1)</script>' }),
				]),
			]),
		);
		const html = renderMatrixHtml({ ...base, matrix: failing, uncovered: [] });
		assert.doesNotMatch(html, /<script>alert/);
		assert.match(html, /&lt;script&gt;/);
	});
});

describe('make-compat-matrix-report — guards', () => {
	it('refuses a non-WebP verification artefact', () => {
		assert.throws(
			() => assertWebpTarget('docs/verification/compat/browsers-matrix.png'),
			/refusing to write a non-WebP/,
		);
		assert.doesNotThrow(() => assertWebpTarget('docs/verification/compat/browsers-matrix.webp'));
	});

	it('addresses screenshots relative to the report file', () => {
		assert.equal(relativePath('/repo/.tmp', '/repo/.tmp/compat-screenshots'), 'compat-screenshots');
		assert.equal(relativePath('/repo/docs', '/repo/.tmp/shots'), '../.tmp/shots');
	});
});
