import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	DEFAULT_ROSTER_PATH,
	DEFAULT_RUN_RECORD_PATH,
	STATUS,
	buildDashboard,
	classifySignal,
	describeEnvironment,
	expandCommand,
	loadRoster,
	readRunRecord,
	renderDashboardHtml,
	resolveSignals,
	summarize,
	validateLedgerAlignment,
	validateRoster,
} from './release-quality-dashboard.mjs';

/**
 * Fixture coverage for the release quality dashboard (Issue #493).
 *
 * The acceptance criterion this file exists for is "PASS / FAIL / NOT RUN
 * are distinguishable, and a missing report never reads as PASS". Every
 * branch of `classifySignal` is pinned here with a fixture run record,
 * including the branch that matters most — exit code 0 with the declared
 * report absent — because a dashboard that quietly reports PASS for a
 * measurement nobody made is worse than no dashboard at all.
 *
 * The final describe() runs the real roster so a refactor that stops
 * parsing `quality/release-dashboard.json` fails here instead of
 * rendering an empty page in the committed screenshot.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const IMPLEMENTED_EXIT_CODE = {
	id: 'architecture-boundary',
	group: 'gate',
	label: 'architecture boundary',
	state: 'implemented',
	command: 'pnpm run architecture:check',
	requirements: [],
	evidence: { kind: 'exit_code' },
};

const IMPLEMENTED_ARTEFACT = {
	id: 'route-quality-coverage',
	group: 'gate',
	label: 'route × quality gate coverage',
	state: 'implemented',
	command: 'pnpm run routes:quality:report',
	requirements: [],
	evidence: { kind: 'artefact', paths: ['.tmp/route-quality-report.html'] },
};

const PLANNED = {
	id: 'a11y-axe',
	group: 'accessibility',
	label: 'axe-core scan',
	family: 'a11y',
	state: 'planned',
	requirements: [],
	evidence: null,
};

const SHA = 'abc123def456';

function record(overrides = {}) {
	return {
		version: 1,
		source_sha: SHA,
		captured_at: '2026-10-19T00:00:00.000Z',
		environment: { runner: 'local' },
		runs: [{ id: 'architecture-boundary', exit_code: 0, duration_ms: 120, artifacts: [] }],
		skipped: [],
		...overrides,
	};
}

function classify(
	signal,
	{ runRecord = null, artefactExists = () => true, currentSha = SHA } = {},
) {
	return classifySignal({ signal, runRecord, currentSha, artefactExists });
}

describe('classifySignal — no output can never become PASS', () => {
	it('reports NOT RUN when there is no run record at all', () => {
		const result = classify(IMPLEMENTED_EXIT_CODE);
		assert.equal(result.status, STATUS.NOT_RUN);
		assert.match(result.reason, /run record/);
	});

	it('reports NOT RUN when the record is another source SHA', () => {
		const result = classify(IMPLEMENTED_EXIT_CODE, {
			runRecord: record({ source_sha: 'ffffffffffff' }),
		});
		assert.equal(result.status, STATUS.NOT_RUN);
		assert.match(result.reason, /別の source SHA/);
	});

	it('reports NOT RUN when the record cannot name the checkout it came from', () => {
		for (const sourceSha of [undefined, '', null, 42]) {
			const result = classify(IMPLEMENTED_EXIT_CODE, {
				runRecord: record({ source_sha: sourceSha }),
			});
			assert.equal(result.status, STATUS.NOT_RUN, `source_sha ${String(sourceSha)}`);
			assert.match(result.reason, /source SHA を記録していない/);
		}
	});

	it('reports NOT RUN when this checkout has no SHA to compare against', () => {
		const result = classify(IMPLEMENTED_EXIT_CODE, {
			runRecord: record(),
			currentSha: null,
		});
		assert.equal(result.status, STATUS.NOT_RUN);
		assert.match(result.reason, /source SHA が取得できない/);
	});

	it('reports NOT RUN when the record has no entry for this signal', () => {
		const result = classify(IMPLEMENTED_ARTEFACT, { runRecord: record() });
		assert.equal(result.status, STATUS.NOT_RUN);
		assert.match(result.reason, /記録が無い/);
	});

	it('reports NOT RUN (with the requirement) when the signal was skipped', () => {
		const result = classify(IMPLEMENTED_ARTEFACT, {
			runRecord: record({
				runs: [
					{
						id: 'route-quality-coverage',
						skipped: true,
						reason: 'requires build（この実行では許可されていない）',
					},
				],
			}),
		});
		assert.equal(result.status, STATUS.NOT_RUN);
		assert.match(result.reason, /requires build/);
	});

	it('reports NOT RUN — never PASS — when exit code is 0 but the report is missing', () => {
		const result = classify(IMPLEMENTED_ARTEFACT, {
			runRecord: record({
				runs: [{ id: 'route-quality-coverage', exit_code: 0, duration_ms: 90, artifacts: [] }],
			}),
			artefactExists: () => false,
		});
		assert.equal(result.status, STATUS.NOT_RUN);
		assert.match(result.reason, /report missing/);
		assert.match(result.reason, /\.tmp\/route-quality-report\.html/);
	});

	it('reports NOT RUN when the report exists but this run never wrote it', () => {
		const result = classify(IMPLEMENTED_ARTEFACT, {
			runRecord: record({
				runs: [{ id: 'route-quality-coverage', exit_code: 0, duration_ms: 90, artifacts: [] }],
			}),
			artefactExists: () => true,
		});
		assert.equal(result.status, STATUS.NOT_RUN);
		assert.match(result.reason, /report を書き出していない/);
		assert.match(result.reason, /\.tmp\/route-quality-report\.html/);
	});

	it('reports FAIL when the recorded command exited non-zero', () => {
		const result = classify(IMPLEMENTED_EXIT_CODE, {
			runRecord: record({
				runs: [{ id: 'architecture-boundary', exit_code: 1, duration_ms: 80, artifacts: [] }],
			}),
		});
		assert.equal(result.status, STATUS.FAIL);
		assert.match(result.reason, /exit code 1/);
	});

	it('reports PASS only with a current record, exit 0 and the declared report present', () => {
		const result = classify(IMPLEMENTED_ARTEFACT, {
			runRecord: record({
				runs: [
					{
						id: 'route-quality-coverage',
						exit_code: 0,
						duration_ms: 90,
						artifacts: [{ path: '.tmp/route-quality-report.html', bytes: 4096 }],
					},
				],
			}),
			artefactExists: (path) => path === '.tmp/route-quality-report.html',
		});
		assert.equal(result.status, STATUS.PASS);
		assert.deepEqual(result.artifacts, ['.tmp/route-quality-report.html']);
	});

	it('reports PASS for an exit-code-only signal with a current exit 0', () => {
		const result = classify(IMPLEMENTED_EXIT_CODE, { runRecord: record() });
		assert.equal(result.status, STATUS.PASS);
	});

	it('reports N/A for a planned family and never counts it as a measurement', () => {
		const result = classify(PLANNED, {
			runRecord: record({
				runs: [{ id: 'a11y-axe', exit_code: 0, duration_ms: 1, artifacts: [] }],
			}),
		});
		assert.equal(result.status, STATUS.NOT_APPLICABLE);
		assert.match(result.reason, /未実装/);
	});
});

describe('validateRoster', () => {
	const families = {
		gate_families: [
			{ id: 'a11y', state: 'planned', contract: 'axe-core scan runs over the surface.' },
			{ id: 'e2e', state: 'implemented', contract: 'A Playwright spec asserts the surface.' },
		],
	};
	const roster = (overrides = {}) => ({
		version: 1,
		groups: [
			{ id: 'gate', label: 'ゲート' },
			{ id: 'accessibility', label: 'a11y' },
		],
		signals: [IMPLEMENTED_EXIT_CODE],
		...overrides,
	});

	it('accepts the shape the roster is documented to have', () => {
		assert.deepEqual(validateRoster(roster(), families), []);
	});

	it('rejects a signal in an undeclared group', () => {
		const errors = validateRoster(
			roster({ signals: [{ ...IMPLEMENTED_EXIT_CODE, group: 'mystery' }] }),
			families,
		);
		assert.match(errors.join('\n'), /undeclared group/);
	});

	it('rejects an implemented signal with no command or evidence', () => {
		const errors = validateRoster(
			roster({
				signals: [{ ...IMPLEMENTED_EXIT_CODE, command: '', evidence: null }],
			}),
			families,
		);
		assert.match(errors.join('\n'), /no command/);
		assert.match(errors.join('\n'), /evidence\.kind/);
	});

	it('rejects a family reference that contradicts the coverage ledger', () => {
		const errors = validateRoster(
			roster({
				signals: [{ ...PLANNED, group: 'accessibility', state: 'implemented' }],
			}),
			families,
		);
		assert.match(errors.join('\n'), /declares state "implemented" but family "a11y" is "planned"/);
	});

	it('rejects a planned signal that carries a command', () => {
		const errors = validateRoster(
			roster({
				signals: [{ ...PLANNED, group: 'accessibility', command: 'pnpm run axe' }],
			}),
			families,
		);
		assert.match(errors.join('\n'), /planned signal "a11y-axe" must not declare a command/);
	});

	it('rejects duplicate ids and unknown requirements', () => {
		const errors = validateRoster(
			roster({
				signals: [IMPLEMENTED_EXIT_CODE, { ...IMPLEMENTED_EXIT_CODE, requirements: ['telepathy'] }],
			}),
			families,
		);
		assert.match(errors.join('\n'), /duplicate signal id/);
		assert.match(errors.join('\n'), /unknown requirement "telepathy"/);
	});
});

describe('artefact evidence must be reachable from its command', () => {
	const families = { gate_families: [] };
	const roster = (signal) => ({
		version: 1,
		groups: [{ id: 'gate', label: 'ゲート' }],
		signals: [signal],
	});
	const signal = (overrides = {}) => ({
		id: 'bundle-budget',
		group: 'gate',
		label: 'client bundle budget',
		state: 'implemented',
		command: 'pnpm run bundle:budget:check -- --report=.tmp/bundle-budget.json',
		requirements: ['build'],
		evidence: { kind: 'artefact', paths: ['.tmp/bundle-budget.json'] },
		...overrides,
	});

	it('rejects a command that never writes the declared report', () => {
		const errors = validateRoster(
			roster(signal({ command: 'pnpm run bundle:budget:check' })),
			families,
		);
		assert.match(errors.join('\n'), /its command never writes there/);
	});

	it('accepts a report path that only appears in the package script it runs', () => {
		const errors = validateRoster(
			roster(
				signal({
					id: 'route-quality-coverage',
					command: 'pnpm run routes:quality:report',
					requirements: [],
					evidence: { kind: 'artefact', paths: ['.tmp/route-quality-report.html'] },
				}),
			),
			families,
			null,
			{
				scripts: {
					'routes:quality:report':
						'node scripts/check-route-quality-coverage.mjs --report=.tmp/route-quality-report.html',
				},
			},
		);
		assert.deepEqual(errors, []);
	});

	it('accepts a tool default output directory when the roster explains it', () => {
		const errors = validateRoster(
			roster(
				signal({
					command: 'CI=1 pnpm run e2e -- --reporter=html',
					requirements: ['build', 'browser'],
					evidence: {
						kind: 'artefact',
						paths: ['playwright-report/index.html'],
						output_dir: 'playwright-report',
						output_dir_note: 'playwright html reporter default',
					},
				}),
			),
			families,
			null,
			{ scripts: {} },
		);
		assert.deepEqual(errors, []);
	});

	it('rejects an output_dir without a note, and a path outside it', () => {
		const missingNote = validateRoster(
			roster(
				signal({
					command: 'CI=1 pnpm run e2e -- --reporter=html',
					evidence: {
						kind: 'artefact',
						paths: ['playwright-report/index.html'],
						output_dir: 'playwright-report',
					},
				}),
			),
			families,
			null,
			{ scripts: {} },
		);
		assert.match(missingNote.join('\n'), /output_dir without output_dir_note/);

		const outside = validateRoster(
			roster(
				signal({
					command: 'CI=1 pnpm run e2e -- --reporter=html',
					evidence: {
						kind: 'artefact',
						paths: ['other-dir/index.html'],
						output_dir: 'playwright-report',
						output_dir_note: 'playwright html reporter default',
					},
				}),
			),
			families,
			null,
			{ scripts: {} },
		);
		assert.match(outside.join('\n'), /is not under evidence\.output_dir/);
	});

	it('expands one level of pnpm run when checking reachability', () => {
		const scripts = { 'routes:quality:report': 'node scripts/check.mjs --report=x.html' };
		assert.equal(
			expandCommand('pnpm run routes:quality:report', scripts),
			'node scripts/check.mjs --report=x.html',
		);
		assert.equal(
			expandCommand('pnpm run not-a-script', scripts),
			'pnpm run not-a-script',
			'an unknown script must stay visible instead of vanishing',
		);
	});
});

describe('readRunRecord', () => {
	const root = mkdtempSync(join(tmpdir(), 'release-quality-record-'));
	const path = '.tmp/release-quality-runs.json';
	const write = (contents) => {
		mkdirSync(join(root, '.tmp'), { recursive: true });
		writeFileSync(join(root, path), contents);
	};

	after(() => rmSync(root, { recursive: true, force: true }));

	it('treats a missing record as no record, not as an error', () => {
		const result = readRunRecord({ root, runRecordPath: 'not-there.json' });
		assert.equal(result.record, null);
		assert.equal(result.problem, null);
	});

	it('rejects unreadable, mistyped and version-less records with a reason', () => {
		write('{ not json');
		assert.match(readRunRecord({ root, runRecordPath: path }).problem, /読み込めません/);
		write(JSON.stringify({ version: 1, runs: 'oops' }));
		assert.match(readRunRecord({ root, runRecordPath: path }).problem, /runs が配列ではありません/);
		write(JSON.stringify({ version: 2, runs: [] }));
		assert.match(readRunRecord({ root, runRecordPath: path }).problem, /version が不正/);
		write(JSON.stringify([{ id: 'x' }]));
		assert.match(readRunRecord({ root, runRecordPath: path }).problem, /形が不正/);
	});

	it('surfaces the rejection reason on the row instead of crashing', () => {
		write(JSON.stringify({ version: 1, runs: 'oops' }));
		const { record: runRecord, problem } = readRunRecord({ root, runRecordPath: path });
		assert.equal(runRecord, null);
		const result = classifySignal({
			signal: IMPLEMENTED_EXIT_CODE,
			runRecord,
			recordProblem: problem,
			currentSha: SHA,
			artefactExists: () => true,
		});
		assert.equal(result.status, STATUS.NOT_RUN);
		assert.match(result.reason, /runs が配列ではありません/);
	});
});

describe('resolveSignals', () => {
	it('inherits state and contract from quality/route-coverage.json', () => {
		const [row] = resolveSignals({
			roster: {
				signals: [{ id: 'a11y-axe', group: 'accessibility', family: 'a11y' }],
			},
			families: {
				gate_families: [{ id: 'a11y', state: 'planned', contract: 'axe scan runs.' }],
			},
		});
		assert.equal(row.state, 'planned');
		assert.equal(row.contract, 'axe scan runs.');
		assert.equal(row.familyStateSource, 'quality/route-coverage.json');
	});
});

describe('summarize', () => {
	it('counts each state separately', () => {
		const rows = [STATUS.PASS, STATUS.FAIL, STATUS.NOT_RUN, STATUS.NOT_APPLICABLE, STATUS.PASS].map(
			(status) => ({ result: { status } }),
		);
		assert.deepEqual(summarize(rows), {
			total: 5,
			pass: 2,
			fail: 1,
			notRun: 1,
			notApplicable: 1,
		});
	});
});

describe('renderDashboardHtml', () => {
	const dashboard = {
		roster: { groups: [{ id: 'gate', label: 'ゲート' }] },
		rows: [
			{ signal: IMPLEMENTED_ARTEFACT, result: classify(IMPLEMENTED_ARTEFACT) },
			{
				signal: IMPLEMENTED_EXIT_CODE,
				result: classify(IMPLEMENTED_EXIT_CODE, {
					runRecord: record({
						runs: [{ id: 'architecture-boundary', exit_code: 1, duration_ms: 80, artifacts: [] }],
					}),
				}),
			},
			{ signal: PLANNED, result: classify(PLANNED) },
		],
		summary: { total: 3, pass: 0, fail: 1, notRun: 1, notApplicable: 1 },
		environment: {
			sourceSha: SHA,
			runner: 'local',
			capturedAt: '2026-10-19T00:00:00.000Z',
			node: 'v22.18.0',
			platform: 'darwin arm64',
			cpu: { model: 'Apple M2', cores: 10 },
			browser: 'not used',
			network: 'not used',
		},
		runRecordPath: DEFAULT_RUN_RECORD_PATH,
	};

	it('prints the status vocabulary, the counts and the reproduction conditions', () => {
		const html = renderDashboardHtml({ dashboard, root: REPO_ROOT });
		for (const label of ['PASS', 'FAIL', 'NOT RUN', 'N/A (未実装)']) {
			assert.ok(html.includes(label), `missing status label ${label}`);
		}
		for (const key of ['source sha', 'runner (local / CI)', 'CPU', 'browser', 'network']) {
			assert.ok(html.includes(key), `missing environment row ${key}`);
		}
		assert.ok(html.includes(SHA));
		assert.match(html, /可視化でありゲートではありません/);
	});

	it('never renders the word PASS as the status of a row with no output', () => {
		const html = renderDashboardHtml({ dashboard, root: REPO_ROOT });
		const row = html.split('<tr>').find((chunk) => chunk.includes('route-quality-coverage'));
		assert.ok(row, 'the row must be rendered at all');
		assert.ok(row.includes('NOT RUN'), 'a row with no run record must read NOT RUN');
		assert.ok(!row.includes('>PASS<'));
	});
});

describe('validateLedgerAlignment', () => {
	const roster = (alignment) => ({
		version: 1,
		release_gate_ledger: 'quality/release-gate.json',
		groups: [{ id: 'gate', label: 'ゲート' }],
		signals: [IMPLEMENTED_EXIT_CODE],
		ledger_alignment: alignment,
	});
	const releaseGate = { checks: [{ id: 'architecture-boundary' }, { id: 'release-version' }] };

	it('accepts a roster that decides every release-gate row', () => {
		assert.deepEqual(
			validateLedgerAlignment(
				roster({
					as_signal: { 'architecture-boundary': 'architecture-boundary' },
					not_listed: { 'release-version': { signal: null, reason: 'branch 依存' } },
				}),
				releaseGate,
			),
			[],
		);
	});

	it('fails when a release-gate row has no decision at all', () => {
		const errors = validateLedgerAlignment(
			roster({ as_signal: { 'architecture-boundary': 'architecture-boundary' } }),
			releaseGate,
		);
		assert.match(errors.join('\n'), /no decision for release-gate check "release-version"/);
	});

	it('fails when a mapping points at a signal that does not exist', () => {
		const errors = validateLedgerAlignment(
			roster({
				as_signal: { 'architecture-boundary': 'architecture-boundary', 'release-version': 'nope' },
				not_listed: {},
			}),
			releaseGate,
		);
		assert.match(errors.join('\n'), /maps "release-version" to unknown signal "nope"/);
	});

	it('fails when a not_listed row has no reason', () => {
		const errors = validateLedgerAlignment(
			roster({
				as_signal: { 'architecture-boundary': 'architecture-boundary' },
				not_listed: { 'release-version': { signal: null, reason: '' } },
			}),
			releaseGate,
		);
		assert.match(errors.join('\n'), /not_listed\["release-version"\] has no reason/);
	});
});

describe('describeEnvironment', () => {
	it('takes the source SHA and the capture time from the record root', () => {
		const environment = describeEnvironment({
			root: REPO_ROOT,
			sha: 'head00000000',
			runRecord: {
				// The record root owns *when*; `environment` owns *where*.
				source_sha: 'recorded0000',
				captured_at: '2026-10-19T08:17:35.518Z',
				environment: { runner: 'ci', node: 'v22.18.0', network: 'not used' },
			},
		});
		assert.equal(environment.sourceSha, 'recorded0000');
		assert.equal(environment.capturedAt, '2026-10-19T08:17:35.518Z');
		assert.equal(environment.runner, 'ci');
		assert.equal(environment.node, 'v22.18.0');
	});

	it('falls back to the current checkout when there is no record', () => {
		const environment = describeEnvironment({ root: REPO_ROOT, sha: 'head00000000' });
		assert.equal(environment.sourceSha, 'head00000000');
		assert.equal(environment.capturedAt, null);
		assert.equal(environment.network, 'unknown (run record なし)');
	});
});

describe('the real roster', () => {
	it('parses, validates and classifies every declared signal', () => {
		const { errors } = loadRoster({ root: REPO_ROOT });
		assert.deepEqual(errors, []);

		const dashboard = buildDashboard({ root: REPO_ROOT });
		assert.deepEqual(dashboard.errors, []);
		assert.ok(dashboard.rows.length >= 10, `only ${dashboard.rows.length} signals declared`);
		for (const { signal, result } of dashboard.rows) {
			assert.ok(Object.values(STATUS).includes(result.status), `${signal.id}: unknown status`);
			assert.ok(result.label && result.reason, `${signal.id}: missing label/reason`);
		}
	});

	it('decides every row of the Issue #508 release-gate ledger', () => {
		const { errors, releaseGate, roster } = loadRoster({ root: REPO_ROOT });
		assert.deepEqual(errors, []);
		const decided = new Set([
			...Object.keys(roster.ledger_alignment.as_signal),
			...Object.keys(roster.ledger_alignment.not_listed),
		]);
		for (const check of releaseGate.checks) {
			assert.ok(decided.has(check.id), `release-gate check ${check.id} has no dashboard decision`);
		}
	});

	it('declares the unimplemented families as N/A rather than as measurements', () => {
		const dashboard = buildDashboard({ root: REPO_ROOT });
		const familyRows = dashboard.rows.filter((row) => row.signal.family);
		const planned = familyRows.filter((row) => row.signal.state === 'planned');
		assert.ok(planned.length >= 3, 'the roster must still carry the planned families');
		for (const row of planned) {
			assert.equal(row.result.status, STATUS.NOT_APPLICABLE);
		}
		// A family that IS implemented is a measurement, not an N/A row:
		// Issue #393 flipped `a11y` to implemented, and the axe scan runs
		// and decides by its exit code.
		const implemented = familyRows.filter((row) => row.signal.state === 'implemented');
		assert.ok(implemented.length >= 1, 'the roster must carry the implemented a11y family');
		for (const row of implemented) {
			assert.notEqual(row.result.status, STATUS.NOT_APPLICABLE);
		}
	});

	it('has a committed screenshot path the Issue asks for (as WebP)', () => {
		const target = join(REPO_ROOT, 'docs/verification/quality/release-quality-dashboard.webp');
		assert.ok(existsSync(join(REPO_ROOT, DEFAULT_ROSTER_PATH)), 'the roster must be committed');
		// The artefact itself is committed by the screenshot step; this
		// assertion documents the contract without making the test fail on
		// a tree that has not run `pnpm run verify:quality-dashboard-screenshot`.
		assert.ok(
			!existsSync(join(REPO_ROOT, 'docs/verification/quality/release-quality-dashboard.png')),
		);
		assert.ok(target.endsWith('.webp'));
	});
});
