import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	CPU_THROTTLE_RATE,
	DEFAULT_ROUTES,
	FONT_ORIGIN_PATTERNS,
	WEBFONT_FAMILIES,
	compareRuns,
	cumulativeLayoutShift,
	evaluateFallbackReadability,
	parseArgs,
	renderReportHtml,
	summarizeFontResources,
} from './font-first-paint-measure.mjs';

/**
 * These tests cover the deterministic parts of the Issue #485
 * measurement — argument parsing, CLS session windowing, font-resource
 * summarisation, the fallback-readability verdict, the before/after
 * diff and the HTML rendering. They do NOT launch a browser: the
 * measurement itself is a manual command (`pnpm run perf:fonts:measure`)
 * whose artefact is committed under `docs/verification/perf/`.
 *
 * A measurement that cannot fail is decoration, so the fallback verdict
 * gets the same scrutiny as a gate assertion — including the case where
 * the block silently did not apply.
 */

function probe(overrides = {}) {
	return {
		tag: 'h1',
		textSample: 'プロフィール',
		rectWidth: 420,
		rectHeight: 48,
		visibility: 'visible',
		opacity: 1,
		color: 'rgb(17, 24, 39)',
		colorAlpha: 1,
		fontFamily: 'Hiragino Kaku Gothic ProN',
		...overrides,
	};
}

function run(route, scenario, metrics) {
	return { route, scenario, metrics, fallback: null, screenshot: null };
}

describe('font-first-paint-measure — measurement contract constants', () => {
	it('blocks both font hosts (googleapis serves the CSS, gstatic the faces)', () => {
		assert.deepEqual(FONT_ORIGIN_PATTERNS, [
			'https://fonts.googleapis.com/**',
			'https://fonts.gstatic.com/**',
		]);
	});

	it('probes the webfont families the tokens actually reference', () => {
		assert.deepEqual(WEBFONT_FAMILIES, ['Noto Sans JP', 'Zen Kaku Gothic New']);
	});

	it('measures representative local routes only', () => {
		assert.deepEqual(DEFAULT_ROUTES, ['/', '/about']);
	});

	it('throttles CPU in the slow-font scenario rather than the whole matrix', () => {
		assert.equal(CPU_THROTTLE_RATE, 4);
	});
});

describe('font-first-paint-measure — parseArgs', () => {
	it('defaults to the local preview origin and the two representative routes', () => {
		const options = parseArgs([]);
		assert.equal(options.baseUrl, 'http://127.0.0.1:3000');
		assert.deepEqual(options.routes, ['/', '/about']);
		assert.equal(options.screenshots, true);
		assert.equal(options.headless, true);
	});

	it('strips a trailing slash so path joins never double up', () => {
		assert.equal(
			parseArgs(['--base-url', 'http://127.0.0.1:4173/']).baseUrl,
			'http://127.0.0.1:4173',
		);
	});

	it('parses route lists, delay and screenshot suppression', () => {
		const options = parseArgs([
			'--routes',
			'/, /about ,/contact',
			'--font-delay-ms',
			'2500',
			'--no-screenshots',
			'--compare',
			'.tmp/font-first-paint/before/report.json',
		]);
		assert.deepEqual(options.routes, ['/', '/about', '/contact']);
		assert.equal(options.fontDelayMs, 2500);
		assert.equal(options.screenshots, false);
		assert.equal(options.compare, '.tmp/font-first-paint/before/report.json');
	});

	it('rejects an unknown flag instead of silently ignoring it', () => {
		assert.throws(() => parseArgs(['--nope']), /unknown argument/);
	});

	it('rejects a flag whose value is missing', () => {
		assert.throws(() => parseArgs(['--base-url']), /requires a value/);
	});
});

describe('font-first-paint-measure — cumulativeLayoutShift', () => {
	it('reports zero when nothing shifted', () => {
		assert.deepEqual(cumulativeLayoutShift([]), { cls: 0, count: 0, worst: 0 });
	});

	it('sums shifts inside one session window', () => {
		const result = cumulativeLayoutShift([
			{ value: 0.02, startTime: 100 },
			{ value: 0.03, startTime: 400 },
		]);
		assert.equal(result.cls, 0.05);
		assert.equal(result.count, 2);
		assert.equal(result.worst, 0.03);
	});

	it('starts a new session after a 1s gap, keeping the largest window only', () => {
		const result = cumulativeLayoutShift([
			{ value: 0.2, startTime: 0 },
			{ value: 0.2, startTime: 5000 },
		]);
		// Naive summation would say 0.4; the session-window definition
		// says the two shifts never belonged to one user session.
		assert.equal(result.cls, 0.2);
	});

	it('starts a new session past the 5s window even without a gap', () => {
		const result = cumulativeLayoutShift([
			{ value: 0.1, startTime: 0 },
			{ value: 0.1, startTime: 4600 },
			{ value: 0.1, startTime: 4800 },
		]);
		assert.equal(result.cls, 0.2);
	});

	it('is order-insensitive', () => {
		const shuffled = [
			{ value: 0.04, startTime: 900 },
			{ value: 0.01, startTime: 100 },
			{ value: 0.02, startTime: 300 },
		];
		assert.equal(cumulativeLayoutShift(shuffled).cls, 0.07);
	});
});

describe('font-first-paint-measure — summarizeFontResources', () => {
	it('counts only font-origin requests', () => {
		const result = summarizeFontResources([
			{
				name: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP',
				startTime: 100,
				duration: 120,
				transferSize: 0,
			},
			{
				name: 'https://fonts.gstatic.com/s/notosansjp/v36/x.woff2',
				startTime: 400,
				duration: 480,
				transferSize: 0,
			},
			{
				name: 'https://127.0.0.1:3000/_build/assets/app.js',
				startTime: 50,
				duration: 30,
				transferSize: 900,
			},
		]);
		assert.equal(result.requests, 2);
		assert.equal(result.slowestMs, 480);
		assert.equal(result.lastStartMs, 400);
	});

	it('keeps a zero byte total honest when the origin sends no Timing-Allow-Origin', () => {
		const result = summarizeFontResources([
			{ name: 'https://fonts.gstatic.com/s/x.woff2', duration: 10, transferSize: 0 },
		]);
		assert.equal(result.transferBytes, 0);
		assert.equal(result.requests, 1);
	});

	it('survives resource entries without a name', () => {
		assert.equal(summarizeFontResources([{ duration: 5 }]).requests, 0);
	});
});

describe('font-first-paint-measure — fallback readability verdict', () => {
	it('passes when real text stays visible with the platform fallback', () => {
		const result = evaluateFallbackReadability({
			probes: [probe(), probe({ tag: 'p', fontFamily: 'system-ui' })],
			webFontAvailable: false,
			blocked: true,
		});
		assert.equal(result.ok, true);
		assert.deepEqual(result.problems, []);
		assert.equal(result.probes, 2);
	});

	it('fails when the block did not apply (webfont still resolved)', () => {
		const result = evaluateFallbackReadability({
			probes: [probe({ fontFamily: 'Noto Sans JP' })],
			webFontAvailable: true,
			blocked: true,
		});
		assert.equal(result.ok, false);
		assert.match(result.problems[0], /block did not apply/);
	});

	it('fails when the page exposed nothing to read', () => {
		const result = evaluateFallbackReadability({
			probes: [],
			webFontAvailable: false,
			blocked: true,
		});
		assert.equal(result.ok, false);
		assert.match(result.problems[0], /no text probe/);
	});

	it('fails on zero-size, hidden, transparent or zero-opacity text', () => {
		const result = evaluateFallbackReadability({
			probes: [
				probe({ rectWidth: 0, rectHeight: 0 }),
				probe({ visibility: 'hidden' }),
				probe({ colorAlpha: 0 }),
				probe({ opacity: 0 }),
				probe({ textSample: '' }),
			],
			webFontAvailable: false,
			blocked: true,
		});
		assert.equal(result.ok, false);
		assert.equal(result.problems.length, 5);
	});
});

describe('font-first-paint-measure — compareRuns', () => {
	it('diffs matching keys and marks a lower-is-better improvement', () => {
		const rows = compareRuns(
			{ runs: [run('/', 'baseline', { cls: 0.12, fcpMs: 400 })] },
			{ runs: [run('/', 'baseline', { cls: 0.03, fcpMs: 380 })] },
		);
		assert.deepEqual(rows, [
			{ key: '/:baseline:cls', before: 0.12, after: 0.03, delta: -0.09, direction: 'better' },
			{ key: '/:baseline:fcpMs', before: 400, after: 380, delta: -20, direction: 'better' },
		]);
	});

	it('marks a regression as worse', () => {
		const rows = compareRuns(
			{ runs: [run('/', 'slow-font', { cls: 0.02 })] },
			{ runs: [run('/', 'slow-font', { cls: 0.2 })] },
		);
		assert.equal(rows[0].direction, 'worse');
		assert.equal(rows[0].delta, 0.18);
	});

	it('reports n/a (not a wrong pairing) when a key only exists in one run', () => {
		const rows = compareRuns(
			{ runs: [run('/', 'baseline', { cls: 0.1 })] },
			{ runs: [run('/about', 'baseline', { cls: 0.1 })] },
		);
		assert.equal(rows.length, 2);
		for (const row of rows) {
			assert.equal(row.delta, null);
			assert.equal(row.direction, 'flat');
		}
	});
});

describe('font-first-paint-measure — renderReportHtml', () => {
	const report = {
		command: 'pnpm run perf:fonts:measure',
		environment: {
			browser: {
				name: 'chromium',
				version: '141.0.7390.0',
				playwright: '^1.63.0',
				mode: 'headless',
			},
			viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
			fontOriginReachable: false,
			fontOriginStatus: 'ENOTFOUND',
			network: { fontDelayMs: 1500 },
			cpu: { throttleRate: 4 },
			host: {
				platform: 'darwin',
				arch: 'arm64',
				cpuModel: 'Apple M4',
				cpuCount: 10,
				totalMemGB: 24,
			},
			source: { sha: 'abc1234', dirty: false, branch: '485', version: '0.6.3' },
			capturedAt: '2026-10-18T00:00:00.000Z',
		},
		runs: [
			{
				route: '/',
				scenario: 'blocked',
				metrics: { fcpMs: 120, lcpMs: 200, cls: 0, fontSwapMs: 5, fontRequests: 0 },
				fallback: { ok: true, problems: [], probes: 8 },
				screenshot: '_-blocked.png',
			},
		],
		comparison: [
			{ key: '/:baseline:cls', before: 0.12, after: 0.03, delta: -0.09, direction: 'better' },
		],
	};

	it('embeds the reproduction conditions, not just the numbers', () => {
		const html = renderReportHtml(report);
		assert.match(html, /abc1234/);
		assert.match(html, /141\.0\.7390\.0/);
		assert.match(html, /1280x800/);
		assert.match(html, /CPU x4/);
	});

	it('warns loudly when the font origin was unreachable', () => {
		assert.match(renderReportHtml(report), /font origin NOT reachable/);
	});

	it('states that this is a measurement and not a gate', () => {
		assert.match(renderReportHtml(report), /Measurement only/);
		assert.match(renderReportHtml(report), /Budget \+ release gate: Issue #386/);
	});

	it('renders the before/after table when a comparison is present', () => {
		const html = renderReportHtml(report);
		assert.match(html, /before \/ after/);
		assert.match(html, /\/:baseline:cls/);
	});

	it('omits the comparison table when there is nothing to compare', () => {
		const html = renderReportHtml({ ...report, comparison: [] });
		assert.doesNotMatch(html, /before \/ after/);
	});

	it('escapes route text instead of injecting markup', () => {
		const html = renderReportHtml({
			...report,
			runs: [{ ...report.runs[0], route: '/<img src=x onerror=alert(1)>' }],
		});
		assert.doesNotMatch(html, /<img src=x/);
		assert.match(html, /&lt;img src=x/);
	});
});
