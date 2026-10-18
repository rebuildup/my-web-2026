import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	assertWebpTarget,
	cellScreenshotName,
	collectCells,
	findUncoveredCells,
	formatRatio,
	keyFingerprints,
	renderGridHtml,
	resolveCellState,
} from './make-viewport-diff-grid-report.mjs';

/**
 * Regression tests for the Issue #417 grid report.
 *
 * The failures these guard against are specific. A naive flatten would
 * (a) treat the negative-control and diff-control tests as grid cells,
 * so a red control hides behind a green grid; (b) let a retry convert
 * a failure into a pass; or (c) drop a roster cell that never ran into
 * the totals, which is exactly the 「無言の合格」 the Issue forbids.
 */

const ROSTER = {
	routes: [
		{ path: '/', slug: 'home', group: 'Home', label: 'ホーム' },
		{ path: '/about', slug: 'about', group: 'Content', label: '自己紹介' },
	],
	viewports: [
		{ width: 390, height: 844, label: '390 / スマホ', stem: 'w390' },
		{ width: 1440, height: 900, label: '1440 / ノートPC', stem: 'w1440' },
	],
};

function projectConfig() {
	return { projects: [{ name: 'chromium' }] };
}

function run(status, error) {
	return {
		projectName: 'chromium',
		status,
		results: [{ status: status === 'skipped' ? 'skipped' : 'passed', duration: 120, error }],
	};
}

function spec(title, tests) {
	return { title, file: 'viewport/layout.spec.ts', tests, suites: [] };
}

function report(specs) {
	return {
		config: projectConfig(),
		suites: [{ title: 'viewport', file: 'viewport', specs, suites: [] }],
	};
}

function cellSpec(path, width, status, error) {
	return spec(`${path} @ ${width}px satisfies the layout contract`, [run(status, error)]);
}

describe('make-viewport-diff-grid-report — cell state', () => {
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

describe('make-viewport-diff-grid-report — collectCells', () => {
	it('keys cells by route and viewport width', () => {
		const { cells, totals } = collectCells(
			report([cellSpec('/', 390, 'expected'), cellSpec('/about', 1440, 'expected')]),
		);

		assert.deepEqual([...cells.keys()].sort(), ['/@390', '/about@1440']);
		assert.deepEqual(totals, { pass: 2, fail: 0, flaky: 0, skip: 0 });
	});

	it('renders one viewport regression as one red cell', () => {
		const { cells, totals } = collectCells(
			report([
				cellSpec('/', 390, 'expected'),
				cellSpec('/', 768, 'unexpected', { message: '/ @ 768px must not scroll sideways' }),
			]),
		);

		assert.equal(cells.get('/@390').state, 'pass');
		assert.equal(cells.get('/@768').state, 'fail');
		assert.match(cells.get('/@768').detail, /must not scroll sideways/);
		assert.equal(totals.fail, 1);
	});

	it('never lets a later pass overwrite a failure or a flaky outcome', () => {
		const failing = collectCells(
			report([
				spec('/ @ 390px satisfies the layout contract', [run('unexpected'), run('expected')]),
			]),
		);
		const flaky = collectCells(
			report([spec('/ @ 390px satisfies the layout contract', [run('flaky'), run('expected')])]),
		);

		assert.equal(failing.cells.get('/@390').state, 'fail');
		assert.equal(flaky.cells.get('/@390').state, 'flaky');
	});

	it('keeps a skipped cell visible instead of folding it into a pass', () => {
		const { totals } = collectCells(
			report([cellSpec('/', 390, 'expected'), cellSpec('/', 1440, 'skipped')]),
		);

		assert.equal(totals.pass, 1);
		assert.equal(totals.skip, 1);
	});

	it('separates the negative controls and diff controls from the grid', () => {
		const { cells, other } = collectCells(
			report([
				cellSpec('/', 390, 'expected'),
				spec('an unchanged page compares equal to its own re-capture', [run('unexpected')]),
				spec('horizontal-overflow fails the contract', [run('expected')]),
			]),
		);

		assert.equal(cells.size, 1, 'only gate cells belong in the grid');
		assert.equal(other.length, 2);
		assert.equal(
			other.find((row) => row.title.includes('negative') === false && row.state === 'fail').state,
			'fail',
			'a failing control row keeps its red state',
		);
	});
});

describe('make-viewport-diff-grid-report — roster coverage', () => {
	it('reports nothing uncovered when every roster cell was executed', () => {
		const { cells } = collectCells(
			report([
				cellSpec('/', 390, 'expected'),
				cellSpec('/', 1440, 'expected'),
				cellSpec('/about', 390, 'expected'),
				cellSpec('/about', 1440, 'expected'),
			]),
		);
		assert.deepEqual(findUncoveredCells(ROSTER, cells), []);
	});

	it('reports every roster cell that no test executed', () => {
		const { cells } = collectCells(report([cellSpec('/', 390, 'expected')]));
		assert.deepEqual(findUncoveredCells(ROSTER, cells), [
			'/ @ 1440px',
			'/about @ 390px',
			'/about @ 1440px',
		]);
	});

	it('reports the whole roster when nothing ran', () => {
		assert.deepEqual(findUncoveredCells(ROSTER, new Map()), [
			'/ @ 390px',
			'/ @ 1440px',
			'/about @ 390px',
			'/about @ 1440px',
		]);
	});

	it('reports nothing when the roster snapshot is missing rather than guessing one', () => {
		assert.deepEqual(findUncoveredCells(null, new Map()), []);
	});
});

describe('make-viewport-diff-grid-report — rendering', () => {
	const { cells, other, totals } = collectCells(
		report([
			cellSpec('/', 390, 'expected'),
			cellSpec('/about', 390, 'unexpected', { message: 'boom' }),
		]),
	);

	const base = {
		roster: ROSTER,
		cells,
		totals,
		other,
		controls: [
			{
				id: 'stability',
				label: '/ @390px — 無変更の再キャプチャ',
				expectation: '差分率 ≤ 0.002',
				ratio: 0,
				changedPixels: 0,
				totalPixels: 2000,
				verdict: 'stable',
			},
			{
				id: 'breakage',
				label: '/ @390px — 意図的破損',
				expectation: '差分率 ≥ 0.01',
				ratio: 0.42,
				changedPixels: 840,
				totalPixels: 2000,
				verdict: 'red-diff',
				judgeRejected: true,
				judgeDetail: '/ @390px must not scroll sideways',
				overlayPath: 'control-diff-390.png',
			},
		],
		fingerprints: keyFingerprints(
			new Map([
				[
					'home-w390',
					{
						slug: 'home',
						viewport: { width: 390 },
						observation: {
							overflowPx: 0,
							bodyFontSize: 16,
							desktopNavVisible: false,
							mobileToggleVisible: false,
						},
					},
				],
				['junk', { noSlug: true }],
			]),
		),
		environment: { OS: 'test-os', Node: 'test-runtime' },
		uncovered: [],
		screenshotPrefix: 'viewport-screenshots',
		screenshotRoot: '/nonexistent',
	};

	it('renders one column per viewport and one row per route', () => {
		const html = renderGridHtml(base);
		assert.match(html, /<th>390px/);
		assert.match(html, /<th>1440px/);
		assert.equal(html.match(/class="cell (pass|fail|flaky|skip)"/g).length, 4);
	});

	it('shows the measured layout facts, not just a badge', () => {
		const html = renderGridHtml(base);
		assert.match(html, /overflow 0px · body 16px · nav —/);
	});

	it('marks a failing cell red and keeps the failure message', () => {
		const html = renderGridHtml(base);
		assert.match(html, /class="cell fail" title="boom"/);
	});

	it('states the uncovered band only when a roster cell was skipped', () => {
		assert.match(renderGridHtml(base), /未実行セルなし/);
		const uncovered = renderGridHtml({ ...base, uncovered: ['/about @ 390px'] });
		assert.match(uncovered, /無言の合格にしない/);
		assert.match(uncovered, /\/about @ 390px/);
	});

	it('marks a missing capture instead of emitting a broken image', () => {
		const html = renderGridHtml(base);
		assert.match(html, /no capture/);
		assert.doesNotMatch(html, /<img/);
	});

	it('prints the control ratios so the red diff is evidenced, not claimed', () => {
		const html = renderGridHtml(base);
		assert.match(html, /42\.0%/);
		assert.match(html, /840 \/ 2000 px/);
		assert.match(html, /must not scroll sideways/);
	});

	it('never presents a control whose judge disagreed as acceptable', () => {
		const html = renderGridHtml({
			...base,
			controls: [{ ...base.controls[1], judgeRejected: false }],
		});
		assert.match(html, /pixel and geometry layers disagree/);
	});

	it('lists the non-grid rows so a control failure cannot hide', () => {
		const withFailure = collectCells(
			report([cellSpec('/', 390, 'expected'), spec('control row', [run('unexpected')])]),
		);
		const html = renderGridHtml({ ...base, other: withFailure.other });
		assert.match(html, /control row/);
		assert.match(html, /class="cell fail"/);
	});

	it('escapes HTML taken from the report', () => {
		const failing = collectCells(
			report([cellSpec('/', 390, 'unexpected', { message: '<script>alert(1)</script>' })]),
		);
		const html = renderGridHtml({ ...base, cells: failing.cells, totals: failing.totals });
		assert.doesNotMatch(html, /<script>alert/);
		assert.match(html, /&lt;script&gt;/);
	});
});

describe('make-viewport-diff-grid-report — helpers', () => {
	it('refuses a non-WebP verification artefact', () => {
		assert.throws(
			() => assertWebpTarget('docs/verification/compat/viewport-diff-grid.png'),
			/refusing to write a non-WebP/,
		);
		assert.doesNotThrow(() => assertWebpTarget('docs/verification/compat/viewport-diff-grid.webp'));
	});

	it('names a cell capture from the route slug and viewport stem', () => {
		assert.equal(cellScreenshotName('home', 'w390'), 'home-w390.png');
	});

	it('formats a ratio at a precision a reader can judge', () => {
		assert.equal(formatRatio(0), '0.000%');
		assert.equal(formatRatio(0.0042), '0.420%');
		assert.equal(formatRatio(0.42), '42.0%');
		assert.equal(formatRatio(Number.NaN), '—');
	});

	it('keys a fingerprint by the cell it belongs to, not by its file name', () => {
		const keyed = keyFingerprints(
			new Map([
				['about-w1440', { slug: 'about', viewport: { width: 1440 }, observation: {} }],
				['broken-doc', { observation: {} }],
			]),
		);

		assert.deepEqual([...keyed.keys()], ['about@1440']);
	});
});
