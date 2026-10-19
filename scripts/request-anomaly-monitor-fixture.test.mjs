import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	FIXTURE_EPOCH_MS,
	FIXTURE_SPACING_MS,
	FIXTURE_VERDICT,
	MAX_FIXTURE_SPACING_MS,
	USAGE,
	diffCase,
	extractTable,
	findLeakingPage,
	findLeakingRow,
	leakMessage,
	loadFixtures,
	parseFixture,
	parseRows,
	pickDeclaredFields,
	renderHtml,
	renderTable,
	runFixture,
	runProof,
} from './request-anomaly-monitor-fixture.mjs';

/**
 * Operator proof tests for the anomaly-monitor fixture command
 * (Issue #481).
 *
 * The decision logic itself is covered by
 * `src/http/middleware/anomaly-monitor.test.ts` and, against the real
 * Worker entry, by `test/integration/request-anomaly-monitor.test.ts`.
 * This file covers what only the COMMAND can be wrong about:
 *
 *   1. every recorded fixture still produces the events it declares —
 *      the command is the drift detector, so a fixture edited without
 *      its expectation fails here;
 *   2. a fixture whose expectation is wrong fails the command (exit 1)
 *      rather than being reported as a pass;
 *   3. neither the CLI's stdout nor the HTML page contains an address,
 *      an e-mail or a credential shape, and a leak fails the command
 *      instead of producing an artefact;
 *   4. the command needs no credential, contacts nothing, and has no
 *      target flag a mistyped argument could turn into production.
 *
 * Every case runs against in-process fixtures only: no binding, no
 * network, no environment.
 */

const CLI = fileURLToPath(new URL('./request-anomaly-monitor-fixture.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_DIR = resolve(REPO_ROOT, 'quality', 'fixtures', 'request-anomaly-monitor');

const scratch = mkdtempSync(join(tmpdir(), 'anomaly-monitor-proof-'));
after(() => rmSync(scratch, { force: true, recursive: true }));

/** A minimal, valid fixture used as a base for the malformed-input cases. */
function baseFixture(overrides = {}) {
	return {
		case: 'synthetic-case',
		note: 'test fixture',
		surface: 'admin',
		runs: [{ status: 200, count: 1 }],
		expect: { eventCount: 0, events: [] },
		...overrides,
	};
}

describe('recorded fixtures', () => {
	it('all hold the declaration they carry', () => {
		const proof = runProof(FIXTURE_DIR);
		assert.deepEqual(
			proof.failures.map((fixture) => `${fixture.source}: ${fixture.outcome.problems.join('; ')}`),
			[],
		);
		assert.ok(proof.rows.length >= 7, 'expected the shipped fixture set');
		assert.ok(proof.totalRequests > 0);
	});

	it('cover both watched surfaces and all four signals', () => {
		const proof = runProof(FIXTURE_DIR);
		const signals = new Set();
		const surfaces = new Set();
		for (const row of proof.rows) {
			surfaces.add(row.surface);
			for (const event of runFixture(loadFixtures(FIXTURE_DIR).find((f) => f.case === row.case))
				.observed) {
				signals.add(event.signal);
			}
		}
		assert.deepEqual([...surfaces].sort(), ['admin', 'external-api']);
		assert.deepEqual([...signals].sort(), [
			'forbidden',
			'rate-limited',
			'server-error',
			'unauthorized',
		]);
	});

	it('include both a silent case and a crossing case', () => {
		const proof = runProof(FIXTURE_DIR);
		assert.ok(
			proof.rows.some((row) => row.events === '0'),
			'no silent fixture',
		);
		assert.ok(
			proof.rows.some((row) => row.events === '1'),
			'no crossing fixture',
		);
		for (const row of proof.rows) assert.equal(row.verdict, FIXTURE_VERDICT.pass);
	});

	it('are pinned to one window, so a case cannot straddle a boundary', () => {
		for (const fixture of loadFixtures(FIXTURE_DIR)) {
			const total = fixture.runs.reduce((sum, run) => sum + run.count, 0);
			assert.ok(
				(total - 1) * fixture.spacingMs <= MAX_FIXTURE_SPACING_MS,
				`${fixture.source} spans more than one ${MAX_FIXTURE_SPACING_MS}ms window`,
			);
			assert.equal(FIXTURE_SPACING_MS, 1000);
			assert.ok(FIXTURE_EPOCH_MS % 1000 === 0);
		}
	});
});

describe('replay', () => {
	it('gives each fixture a fresh monitor', () => {
		// A shared monitor would let one case's denominator decide the
		// next case's verdict; running the same fixture twice in a row
		// must produce the same answer.
		const fixture = loadFixtures(FIXTURE_DIR).find((f) => f.case === 'admin-credential-storm');
		const first = runFixture(fixture);
		const second = runFixture(fixture);
		assert.deepEqual(first.observed, second.observed);
	});

	it('reports a deviation instead of passing it', () => {
		// The fixture declares silence over traffic that is nothing but
		// 401s, so the monitor must contradict it. A command that
		// reported this as a pass would be a detector that detects
		// whatever the file happens to say.
		const fixture = parseFixture(
			JSON.stringify(baseFixture({ runs: [{ status: 401, count: 30 }] })),
			'deviation-case.json',
		);
		const outcome = runFixture(fixture);
		const problems = diffCase(fixture, outcome);
		assert.ok(problems.some((problem) => problem.includes('event count')));
	});

	it('reports a wrong number inside an event that exists', () => {
		const fixture = parseFixture(
			JSON.stringify(
				baseFixture({
					runs: [
						{ status: 200, count: 25 },
						{ status: 401, count: 9 },
					],
					expect: {
						eventCount: 1,
						events: [
							{
								event: 'anomaly.detected',
								surface: 'admin',
								signal: 'unauthorized',
								status: '401',
								samples: 34,
								hits: 8,
								rate: 0.26,
								threshold: 0.25,
								minSamples: 20,
							},
						],
					},
				}),
			),
			'wrong-number.json',
		);
		const outcome = runFixture(fixture);
		const problems = diffCase(fixture, outcome);
		assert.deepEqual(problems, ['event 1 hits: declared 8, observed 9']);
	});

	it('publishes only the fields an operator reads', () => {
		const fixture = loadFixtures(FIXTURE_DIR).find((f) => f.case === 'external-api-throttle-burst');
		const [event] = runFixture(fixture).observed;
		assert.deepEqual(Object.keys(pickDeclaredFields(event)).sort(), [
			'event',
			'hits',
			'minSamples',
			'rate',
			'samples',
			'signal',
			'status',
			'surface',
			'threshold',
		]);
	});
});

describe('malformed input', () => {
	it('refuses a fixture it cannot drive', () => {
		const cases = [
			['not json at all', 'not valid JSON'],
			[JSON.stringify(baseFixture({ surface: 'public' })), '"surface"'],
			[JSON.stringify(baseFixture({ runs: [] })), '"runs"'],
			[JSON.stringify(baseFixture({ runs: [{ status: 200 }] })), '"count"'],
			[JSON.stringify(baseFixture({ runs: [{ status: 99, count: 1 }] })), '"status"'],
			[JSON.stringify(baseFixture({ expect: { events: [] } })), '"expect.eventCount"'],
			[JSON.stringify(baseFixture({ expect: { eventCount: 1, events: [] } })), '"expect.events"'],
			[JSON.stringify(baseFixture({ spacingMs: 0 })), '"spacingMs"'],
			[JSON.stringify(baseFixture({ spacingMs: MAX_FIXTURE_SPACING_MS + 1 })), '"spacingMs"'],
		];
		for (const [raw, expected] of cases) {
			assert.throws(
				() => parseFixture(raw, 'bad.json'),
				(error) => error.message.includes(expected),
				`expected ${expected} for ${raw.slice(0, 40)}`,
			);
		}
	});
});

describe('leak guard', () => {
	it('lets the status-only vocabulary through', () => {
		const proof = runProof(FIXTURE_DIR);
		assert.equal(findLeakingRow(proof.rows), undefined);
	});

	it('refuses a row that carries caller context, by number only', () => {
		const row = {
			index: '4',
			rendered: '| 4 | probe | admin | 20x200 + 12x401 from 203.0.113.9 | 32 | 1 | — | pass | —',
		};
		assert.equal(findLeakingRow([row]), row);
		const message = leakMessage(row);
		assert.ok(message.includes('row 4'));
		assert.ok(!message.includes('203.0.113.9'), 'the refusal must not echo the leak');
	});

	it('refuses an e-mail and a credential shape', () => {
		for (const rendered of [
			'| 1 | operator.person@example.invalid | admin | 20x200 | 20 | 0 | — | pass | —',
			'| 1 | probe | admin | Bearer abcdef0123456789 | 20 | 0 | — | pass | —',
			'| 1 | probe | admin | mk_0123456789abcdef | 20 | 0 | — | pass | —',
			'| 1 | probe | admin | cookie: session=abc | 20 | 0 | — | pass | —',
		]) {
			assert.ok(findLeakingRow([{ index: '1', rendered }]), `expected a refusal for ${rendered}`);
		}
	});
});

describe('table round trip', () => {
	it('prints and re-reads the same rows', () => {
		const proof = runProof(FIXTURE_DIR);
		const table = renderTable(proof.rows);
		const extracted = extractTable(table);
		assert.ok(extracted, 'the markers must be present');
		const parsed = parseRows(extracted);
		assert.equal(parsed.length, proof.rows.length);
		for (const [index, row] of proof.rows.entries()) {
			assert.deepEqual(parsed[index], {
				index: row.index,
				case: row.case,
				surface: row.surface,
				traffic: row.traffic,
				requests: row.requests,
				events: row.events,
				detail: row.detail,
				verdict: row.verdict,
				reason: row.reason,
			});
		}
	});

	it('renders an HTML page that carries no caller value', () => {
		const proof = runProof(FIXTURE_DIR);
		const html = renderHtml(parseRows(extractTable(renderTable(proof.rows))), proof);
		assert.ok(html.includes('<!doctype html>'));
		assert.ok(html.includes('anomaly.detected') === false, 'the page reports counts, not payloads');
		assert.equal(findLeakingPage(html), null);
		// The page-level scan is deliberately value-shaped only: the
		// report's own prose discusses request headers by name, and a
		// guard that failed on the document explaining the rule would
		// be a guard the next author removes.
		assert.ok(html.includes('User-Agent'), 'the prose still names the fields it refuses to store');
	});
});

describe('the command itself', () => {
	it('exits 0 and prints a status-only matrix', () => {
		const run = spawnSync(process.execPath, [CLI], { cwd: REPO_ROOT, encoding: 'utf8' });
		assert.equal(run.status, 0, run.stderr);
		assert.ok(extractTable(run.stdout), 'the matrix markers must be in stdout');
		assert.equal(findLeakingRow([{ index: '1', rendered: run.stdout }]), undefined);
		assert.ok(run.stdout.includes('7 fixtures hold'));
	});

	it('exits 2 on an unknown flag and prints the usage', () => {
		const run = spawnSync(process.execPath, [CLI, '--target=production'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		});
		assert.equal(run.status, 2);
		assert.equal(run.stderr, USAGE);
	});

	it('fails the shipped directory the moment a fixture deviates', () => {
		// The command has no fixture-directory flag on purpose: the set
		// it runs is the one in the repository, so a mistyped argument
		// has nothing to aim at. The deviation path is therefore driven
		// through the pure runner over a copy of that set, which is
		// exactly the code the CLI takes.
		const dir = join(scratch, 'fixtures');
		run('mkdir', ['-p', dir]);
		for (const name of readdirSync(FIXTURE_DIR)) {
			run('cp', [join(FIXTURE_DIR, name), dir]);
		}
		writeFileSync(
			join(dir, 'deviating-case.json'),
			JSON.stringify(
				baseFixture({
					case: 'deviating-case',
					runs: [{ status: 401, count: 30 }],
				}),
				null,
				'\t',
			),
		);
		const proof = runProof(dir);
		assert.equal(proof.failures.length, 1);
		assert.equal(proof.failures[0].source, 'deviating-case.json');
		assert.deepEqual(proof.failures[0].outcome.problems, ['event count: declared 0, observed 1']);
	});

	it('writes the HTML report without carrying the raw table', () => {
		const target = join(scratch, 'report.html');
		const run = spawnSync(process.execPath, [CLI, `--html=${target}`], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		});
		assert.equal(run.status, 0, run.stderr);
		const html = readFileSync(target, 'utf8');
		assert.ok(html.includes('<!doctype html>'));
		assert.ok(!html.includes('anomaly-monitor-matrix'), 'the HTML must not carry the raw table');
	});
});

/** Tiny spawn helper (no shell, no credential in the environment). */
function run(command, args) {
	const result = spawnSync(command, args, { encoding: 'utf8' });
	assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
}
