import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import {
	BLOCKED_SETTLE_MS,
	CPU_THROTTLE_RATE,
	DEFAULT_ROUTES,
	FONT_ORIGIN_PATTERNS,
	LAYOUT_SHIFT_METRICS,
	ORIGIN_PROBE_TIMEOUT_MS,
	SETTLE_MS,
	SWAP_WAIT_TIMEOUT_MS,
	WEBFONT_FAMILIES,
	aggregateComparison,
	compareRuns,
	cumulativeLayoutShift,
	evaluateFallbackReadability,
	fetchWithDeadline,
	fontFaceUrl,
	formatMetric,
	isCompletedRequest,
	parseArgs,
	parseRunKey,
	renderReportHtml,
	round3,
	screenshotFileName,
	shellQuote,
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

function run(route, scenario, metrics, layoutShiftSources = []) {
	return { route, scenario, metrics, fallback: null, screenshot: null, layoutShiftSources };
}

describe('font-first-paint-measure — measurement contract constants', () => {
	it('blocks both font hosts (googleapis serves the CSS, gstatic the faces)', () => {
		assert.deepEqual(FONT_ORIGIN_PATTERNS, [
			'https://fonts.googleapis.com/**',
			'https://fonts.gstatic.com/**',
		]);
	});

	it('bounds the reachability probe itself, not only the page wait', async () => {
		// The probe runs before the browser launches and carries no page-level
		// timeout, so a network that accepts the connection and then never
		// answers would stall the run on Node's default fetch timeout instead
		// of reporting "the origin is not usable" as this script promises.
		assert.ok(ORIGIN_PROBE_TIMEOUT_MS > 0);
		assert.ok(ORIGIN_PROBE_TIMEOUT_MS <= SWAP_WAIT_TIMEOUT_MS);
		const server = createServer(() => {
			// accept and never respond
		});
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		try {
			const { port } = server.address();
			await assert.rejects(fetchWithDeadline(`http://127.0.0.1:${port}/`, {}, 150), {
				name: 'TimeoutError',
			});
		} finally {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		}
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

	it('opens the settle window only after the swap, never before it', () => {
		// The slow-font swap lands ~3.8 s in. A fixed window shorter
		// than the wait would close before it and drop the shift it
		// caused, which is the one thing this ticket measures.
		assert.ok(SWAP_WAIT_TIMEOUT_MS > SETTLE_MS);
		assert.ok(SETTLE_MS > BLOCKED_SETTLE_MS);
	});
});

describe('font-first-paint-measure — absence is not zero', () => {
	it('keeps a missing measurement missing instead of rounding it to 0', () => {
		// `Math.round(null * 1000) / 1000` is 0. A blocked row has no
		// webfont face, so it has no swap instant: reporting 0 ms would
		// claim the page swapped at 0 ms.
		assert.equal(round3(null), null);
		assert.equal(round3(undefined), null);
		assert.equal(round3(Number.NaN), null);
		assert.equal(round3(Number.POSITIVE_INFINITY), null);
	});

	it('still rounds a real zero to zero', () => {
		assert.equal(round3(0), 0);
		assert.equal(round3(0.4874321), 0.487);
		assert.equal(formatMetric(0), '0');
	});

	it('prints an unobserved metric as n/a in prose and on the terminal', () => {
		assert.equal(formatMetric(null), 'n/a');
		assert.equal(formatMetric(undefined), 'n/a');
		assert.equal(formatMetric(12.5), '12.5');
	});

	it('does not report a shift timing for a page that never shifted', () => {
		// CLS of zero is a measurement (no shift entries at all); the
		// absence assertions above are about metrics with no event.
		assert.deepEqual(cumulativeLayoutShift([]), { cls: 0, count: 0, worst: 0 });
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

	it('rejects a non-numeric or negative font delay instead of running a mislabelled baseline', () => {
		// NaN made `delayMs > 0` false, so no route interception was
		// installed while the run was still labelled `slow-font`.
		assert.throws(() => parseArgs(['--font-delay-ms', 'abc']), /--font-delay-ms requires/);
		assert.throws(() => parseArgs(['--font-delay-ms', '-1']), /--font-delay-ms requires/);
		assert.throws(() => parseArgs(['--font-delay-ms', '']), /--font-delay-ms requires/);
	});

	it('rejects a route list that leaves nothing to measure', () => {
		// An empty list ran the loop zero times and still wrote a
		// report and exited 0 — a "completed measurement" holding no run.
		assert.throws(() => parseArgs(['--routes', ',']), /--routes requires at least one/);
		assert.throws(() => parseArgs(['--routes', '']), /--routes requires at least one/);
		assert.throws(() => parseArgs(['--routes', ' , , ']), /--routes requires at least one/);
	});

	it('names a screenshot so no two routes can share one file', () => {
		// `/a/b` and `/a_b` are distinct routes a caller can pass in the
		// same list. A plain slash-to-underscore rewrite gave both the
		// same file, so the later capture overwrote the earlier one while
		// both runs kept pointing at it.
		assert.notEqual(screenshotFileName('/a/b', 'baseline'), screenshotFileName('/a_b', 'baseline'));
		assert.equal(screenshotFileName('/a/b', 'baseline'), '_a_b-baseline.png');
		assert.equal(screenshotFileName('/a_b', 'baseline'), '_a__b-baseline.png');
	});

	it('keeps the default route file names unchanged', () => {
		// The committed snapshot's report names these two files, so the
		// escaping must not touch a route that has no underscore.
		assert.equal(screenshotFileName('/', 'baseline'), '_-baseline.png');
		assert.equal(screenshotFileName('/about', 'slow-font'), '_about-slow-font.png');
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
	it('counts only completed font-origin requests', () => {
		const result = summarizeFontResources([
			{
				name: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP',
				startTime: 100,
				duration: 120,
				responseStart: 260,
				encodedBodySize: 149049,
				transferSize: 149349,
			},
			{
				name: 'https://fonts.gstatic.com/s/notosansjp/v36/x.woff2',
				startTime: 400,
				duration: 480,
				responseStart: 560,
				encodedBodySize: 0,
				transferSize: 0,
			},
			{
				name: 'https://127.0.0.1:3000/_build/assets/app.js',
				startTime: 50,
				duration: 30,
				responseStart: 60,
				encodedBodySize: 900,
				transferSize: 900,
			},
		]);
		assert.equal(result.requests, 2);
		assert.equal(result.abortedRequests, 0);
		assert.equal(result.slowestMs, 480);
		assert.equal(result.lastStartMs, 400);
		assert.equal(result.transferBytes, 149349);
	});

	it('keeps an aborted request out of the delivered count', () => {
		// The blocked scenario aborts every font request on purpose.
		// Chromium keeps the entry in resource timing with a non-zero
		// `responseEnd` and no response signal at all, so the timestamp
		// alone would count a font that never arrived.
		const result = summarizeFontResources([
			{
				name: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP',
				startTime: 31,
				duration: 14.5,
				responseStart: 0,
				responseEnd: 45.3,
				encodedBodySize: 0,
				transferSize: 0,
			},
		]);
		assert.equal(result.requests, 0);
		assert.equal(result.abortedRequests, 1);
		assert.equal(result.transferBytes, 0);
		// No delivered response means no response time — not a 0 ms one.
		assert.equal(result.slowestMs, null);
		assert.equal(result.lastStartMs, null);
	});

	it('does not trust responseStatus, which reads 0 for a delivered response too', () => {
		// Measured in Chromium: a successful cross-origin response under
		// route interception reports `responseStatus: 0` because the
		// status is hidden without Timing-Allow-Origin.
		assert.equal(isCompletedRequest({ responseStatus: 0, transferSize: 149349 }), true);
		assert.equal(isCompletedRequest({ responseStatus: 0, responseEnd: 122 }), false);
		assert.equal(isCompletedRequest({ responseStatus: 200, responseEnd: 0 }), false);
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
	it('splits a run key from the right, so a colon in a route stays in the route', () => {
		// `/docs:v2` is a valid route. Splitting on every colon read
		// `v2` as the scenario and `baseline` as the metric, which moved
		// the CLS row out of the layout-shift table and pointed the
		// shift attribution at a scenario that does not exist.
		assert.deepEqual(parseRunKey('/docs:v2:baseline:cls'), {
			route: '/docs:v2',
			scenario: 'baseline',
			metric: 'cls',
		});
		assert.deepEqual(parseRunKey('/about:slow-font:fontSwapMs'), {
			route: '/about',
			scenario: 'slow-font',
			metric: 'fontSwapMs',
		});
	});

	it('keeps a colon route on the layout-shift side of the comparison', () => {
		const shifted = (value) => ({
			value,
			startTimeMs: 400,
			sources: [{ tag: 'ul', text: 'ホーム', previous: '872x29', current: '864x70' }],
		});
		const rows = compareRuns(
			{ runs: [run('/docs:v2', 'baseline', { cls: 0.4 }, [shifted(0.4)])] },
			{ runs: [run('/docs:v2', 'baseline', { cls: 0.002 }, [shifted(0.002)])] },
		);
		const clsRow = rows.find((row) => row.key === '/docs:v2:baseline:cls');
		assert.equal(clsRow.beforeSources[0].value, 0.4);
		assert.equal(clsRow.afterSources[0].value, 0.002);
		assert.equal(clsRow.direction, 'better');
		const aggregate = aggregateComparison(rows).find((row) => row.metric === 'cls');
		assert.equal(aggregate.layoutShift, true);
		assert.equal(aggregate.pairedRuns, 1);
	});
	it('diffs matching keys and marks a lower-is-better improvement', () => {
		const rows = compareRuns(
			{ runs: [run('/', 'baseline', { cls: 0.12, fcpMs: 400 })] },
			{ runs: [run('/', 'baseline', { cls: 0.03, fcpMs: 380 })] },
		);
		assert.deepEqual(rows, [
			{
				key: '/:baseline:cls',
				before: 0.12,
				after: 0.03,
				delta: -0.09,
				direction: 'better',
				beforeSources: [],
				afterSources: [],
			},
			{ key: '/:baseline:fcpMs', before: 400, after: 380, delta: -20, direction: 'better' },
		]);
	});

	it('carries the shift sources of both captures on the CLS row', () => {
		// The before number is only evidence if the elements that moved
		// are in the deliverable next to it.
		const shifted = (value, rect) => ({
			value,
			startTimeMs: 356.8,
			sources: [{ tag: 'ul', text: 'ホーム', previous: rect, current: '864x70' }],
		});
		const rows = compareRuns(
			{ runs: [run('/about', 'baseline', { cls: 0.975 }, [shifted(0.487, '872x29')])] },
			{ runs: [run('/about', 'baseline', { cls: 0.001 }, [shifted(0.001, '872x29')])] },
		);
		const clsRow = rows.find((row) => row.key === '/about:baseline:cls');
		assert.equal(clsRow.beforeSources[0].value, 0.487);
		assert.equal(clsRow.beforeSources[0].sources[0].previous, '872x29');
		assert.equal(clsRow.afterSources[0].value, 0.001);
		// A timing row carries no attribution.
		assert.equal(
			rows.find((row) => row.key === '/about:baseline:fcpMs'),
			undefined,
		);
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
			baseUrl: 'http://127.0.0.1:3000',
			routes: '/, /about',
			compareSource: '.tmp/font-first-paint/before/report.json',
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
			// A deliberately non-project-shaped fixture version: the
			// release-literal gate forbids restating the current release
			// anywhere in `scripts/**`.
			source: { sha: 'abc1234', dirty: false, branch: '485', version: '9.9.9-fixture' },
			capturedAt: '2026-10-18T00:00:00.000Z',
		},
		runs: [
			{
				route: '/',
				scenario: 'blocked',
				metrics: {
					fcpMs: 120,
					lcpMs: 200,
					cls: 0,
					fontSwapMs: null,
					fontRequests: 0,
					fontRequestsAborted: 1,
				},
				fallback: { ok: true, problems: [], probes: 8 },
				screenshot: '_-blocked.png',
			},
		],
		comparison: [
			{ key: '/:baseline:cls', before: 0.12, after: 0.03, delta: -0.09, direction: 'better' },
			{ key: '/:baseline:fcpMs', before: 268, after: 164, delta: -104, direction: 'better' },
			{
				key: '/about:baseline:cls',
				before: 0.975,
				after: 0.001,
				delta: -0.974,
				direction: 'better',
			},
		],
	};

	it('embeds the reproduction conditions, not just the numbers', () => {
		const html = renderReportHtml(report);
		assert.match(html, /abc1234/);
		assert.match(html, /141\.0\.7390\.0/);
		assert.match(html, /1280x800/);
		assert.match(html, /CPU x4/);
		// Which origin, which routes, which --compare input, and when.
		assert.match(html, /<th scope="row">origin measured<\/th><td>http:\/\/127\.0\.0\.1:3000/);
		assert.match(html, /<th scope="row">routes<\/th><td>\/, \/about/);
		assert.match(html, /2026-10-18T00:00:00\.000Z/);
		assert.doesNotMatch(html, /undefined/);
	});

	it('quotes an argument that contains a space so the recorded command re-runs', () => {
		// The report is the reproduction record. `--out ".tmp/font report"`
		// joined with plain spaces reads back as two arguments and dies on
		// an unknown flag, so the recorded invocation would not reproduce.
		assert.equal(shellQuote('--out .tmp/font report'), `'--out .tmp/font report'`);
		assert.equal(shellQuote("it's"), `'it'\\''s'`);
		assert.equal(shellQuote('plain'), `'plain'`);
		const argv = ['--out', '.tmp/font report', '--routes', '/, /about'];
		const html = renderReportHtml({
			...report,
			argv,
			// what `main()` builds from those argv entries
			command: `pnpm run perf:fonts:measure -- ${argv.map(shellQuote).join(' ')}`,
		});
		assert.match(
			html,
			/<th scope="row">command<\/th><td>pnpm run perf:fonts:measure -- '--out' '\.tmp\/font report' '--routes' '\/, \/about'/,
		);
		assert.match(html, /<th scope="row">arguments<\/th><td>'--out' '\.tmp\/font report'/);
	});

	it('warns loudly when the webfont pipeline was not fully reachable', () => {
		const html = renderReportHtml(report);
		assert.match(html, /webfont pipeline is NOT fully reachable/);
		assert.match(html, /the stylesheet and the face it points at are both probed/);
		assert.match(html, /treat swap timings as unavailable, not as zero/);
	});

	it('states that this is a measurement and not a gate', () => {
		assert.match(renderReportHtml(report), /Measurement only/);
		assert.match(renderReportHtml(report), /Budget \+ release gate: Issue #386/);
	});

	it('renders a before/after table when a comparison is present', () => {
		const html = renderReportHtml(report);
		assert.match(html, /before \/ after/);
		// The table aggregates per metric across routes, so the two `cls`
		// rows (0.12 and 0.975 before) collapse into one min-max range.
		assert.match(html, /<td>cls<\/td><td>0\.12–0\.975<\/td><td>0\.001–0\.03<\/td>/);
	});

	it('embeds every capture eagerly so a screenshot cannot miss one', () => {
		// `loading="lazy"` leaves the below-the-fold captures unloaded
		// when the report is screenshotted full-page, which silently
		// drops the evidence for those rows.
		const html = renderReportHtml(report);
		assert.doesNotMatch(html, /loading="lazy"/);
		assert.match(html, /<img src="\.\/_-blocked\.png"/);
	});

	it('renders a metric row as one table row, cells included', () => {
		// A dropped `<td>` wrapper makes the browser hoist the row out
		// of the table and render the report as a stack of images.
		const html = renderReportHtml(report);
		const metricsRow = html
			.split('<h2>metrics</h2>')[1]
			.split('</tbody>')[0]
			.split('\n')
			.filter((line) => line.startsWith('<tr>'))[0];
		assert.equal(metricsRow.match(/<td>/g).length, 10);
		assert.match(metricsRow, /<td><span class="ok">readable<\/span><\/td><td><img /);
	});

	it('renders an unobserved metric as n/a, never as 0 ms', () => {
		const html = renderReportHtml(report);
		// The fixture run is the blocked scenario: no webfont face ever
		// loaded, so there is no swap instant to report.
		assert.match(html, /<td>0<\/td><td><span class="na">n\/a<\/span><\/td><td>0<\/td>/);
		assert.doesNotMatch(html, />null</);
		assert.match(html, /never observed, not that it measured zero/);
	});

	it('splits the before/after table into layout shift rows and noisy context', () => {
		// CLS is the result column but it is a per-build measurement;
		// paint / swap timings are single-run and must not be read as a
		// result.
		const html = renderReportHtml(report);
		const layoutShift = html
			.split('<h3>layout shift (single run, per build)</h3>')[1]
			.split('</table>')[0];
		const context = html
			.split('<h3>context (single-run timings — noise)</h3>')[1]
			.split('</table>')[0];
		assert.match(layoutShift, /<td>cls<\/td>/);
		assert.doesNotMatch(layoutShift, /fcpMs/);
		assert.match(context, /<td>fcpMs<\/td>/);
		assert.doesNotMatch(context, /<td>cls<\/td>/);
		assert.match(html, /network and machine noise/);
		// A single before/after pair must not be sold as repeatable.
		assert.match(html, /a measurement of two builds, not a distribution/);
		assert.doesNotMatch(html, /deterministic/);
	});

	it('aggregates the noisy rows into one min-max row per metric', () => {
		assert.deepEqual(
			aggregateComparison([
				{ key: '/:baseline:fcpMs', before: 200, after: 180 },
				{ key: '/about:baseline:fcpMs', before: 300, after: 320 },
				{ key: '/:baseline:cls', before: 0.5, after: 0.1 },
			]),
			[
				{
					metric: 'fcpMs',
					before: '200–300',
					after: '180–320',
					layoutShift: false,
					pairedRuns: 2,
					totalRuns: 2,
				},
				{
					metric: 'cls',
					before: '0.5',
					after: '0.1',
					layoutShift: true,
					pairedRuns: 1,
					totalRuns: 1,
				},
			],
		);
	});

	it('never aggregates a run that only exists on one side', () => {
		// `--compare` gets handed captures with different route sets.
		// Folding the present half into a range would print a pairing
		// the data never observed.
		const rows = aggregateComparison([
			{ key: '/:baseline:cls', before: 0.5, after: null },
			{ key: '/about:baseline:cls', before: null, after: 0.02 },
			{ key: '/about:slow-font:cls', before: 0.4, after: 0.01 },
		]);
		assert.equal(rows[0].pairedRuns, 1);
		assert.equal(rows[0].totalRuns, 3);
		assert.equal(rows[0].before, '0.4');
		assert.equal(rows[0].after, '0.01');
	});

	it('reads n/a when a metric has no paired run at all', () => {
		const rows = aggregateComparison([
			{ key: '/:blocked:fontSwapMs', before: null, after: null },
			{ key: '/about:blocked:fontSwapMs', before: null, after: null },
		]);
		assert.equal(rows[0].before, 'n/a');
		assert.equal(rows[0].after, 'n/a');
		assert.equal(rows[0].pairedRuns, 0);
	});

	it('classifies only layout-shift metrics as the result column', () => {
		assert.deepEqual(LAYOUT_SHIFT_METRICS, ['cls', 'clsEntries', 'worstShift']);
	});

	it('follows a Google stylesheet to the face it serves', () => {
		// Reachability has to cover `fonts.gstatic.com` too: a network
		// that lets the stylesheet through and blocks the face would
		// otherwise be recorded as a real webfont swap.
		assert.equal(
			fontFaceUrl('@font-face{src:url(https://fonts.gstatic.com/s/notosansjp/v36/x.woff2)}'),
			'https://fonts.gstatic.com/s/notosansjp/v36/x.woff2',
		);
		assert.equal(fontFaceUrl('@font-face{src:url(/local/x.woff2)}'), null);
		assert.equal(fontFaceUrl(''), null);
	});

	it('omits the comparison table when there is nothing to compare', () => {
		const html = renderReportHtml({ ...report, comparison: [] });
		assert.doesNotMatch(html, /before \/ after/);
	});

	it('renders the before-capture attribution next to the after one', () => {
		const shift = (value) => ({
			value,
			startTimeMs: 356.8,
			sources: [{ tag: 'ul', text: 'ホーム', previous: '872x29', current: '864x70' }],
		});
		const html = renderReportHtml({
			...report,
			comparison: [
				{
					key: '/about:baseline:cls',
					before: 0.487,
					after: 0.001,
					delta: -0.486,
					direction: 'better',
					beforeSources: [shift(0.487)],
					afterSources: [shift(0.001)],
				},
			],
		});
		assert.match(html, /where the shift came from — before \/ after/);
		assert.match(html, /<td>before<\/td><td>0\.487<\/td><td>356\.8<\/td>/);
		assert.match(html, /<td>after<\/td><td>0\.001<\/td>/);
	});

	it('omits the before/after attribution when no shift was recorded', () => {
		const html = renderReportHtml({
			...report,
			comparison: [
				{
					key: '/about:baseline:cls',
					before: 0,
					after: 0,
					delta: 0,
					direction: 'flat',
					beforeSources: [],
					afterSources: [],
				},
			],
		});
		assert.doesNotMatch(html, /where the shift came from — before/);
	});

	it('escapes route text instead of injecting markup', () => {
		const html = renderReportHtml({
			...report,
			runs: [{ ...report.runs[0], route: '/<img src=x onerror=alert(1)>' }],
		});
		assert.doesNotMatch(html, /<img src=x/);
		assert.match(html, /&lt;img src=x/);
	});

	it('never interpolates a metric value raw', () => {
		// Every metric cell goes through the same formatter: a number is
		// escaped, anything else becomes `n/a`. A value can therefore no
		// longer reach the markup as markup.
		const html = renderReportHtml({
			...report,
			runs: [
				{
					...report.runs[0],
					metrics: { ...report.runs[0].metrics, fontSwapMs: '<b>1</b>' },
				},
			],
		});
		assert.doesNotMatch(html, /<b>1<\/b>/);
		assert.match(html, /<td><span class="na">n\/a<\/span><\/td>/);
	});
});
