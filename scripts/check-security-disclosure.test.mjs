import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	BOOLEAN_REPORT_FIELDS,
	DEFAULT_MANIFEST_PATH,
	FIXTURE_DIR,
	PROBE_FIXTURES,
	checkDisclosureFlow,
	derivePriority,
	evaluateFixture,
	evaluateReport,
	findLeak,
	loadFixture,
	main,
	materializeFixture,
	renderReport,
} from './check-security-disclosure.mjs';

/**
 * Fixture coverage for the disclosure flow gate (Issue #478).
 *
 * A runbook nobody can falsify is a document, not a control. The blocks
 * below pin the three directions the gate claims:
 *
 *   - priority derivation is ordered and fails closed: a field the ledger
 *     does not define is an error, never a silent `false` (which would
 *     downgrade a P0 to a P3);
 *   - a missing duty, and a public detail published before the fix, are
 *     INCOMPLETE — never folded into a pass;
 *   - a report carrying a credential-shaped value is refused, and nothing
 *     the gate returns or prints contains that value.
 *
 * The last block runs the same evaluator against the real repository, so
 * a change to the ledger, the runbook or the fixtures cannot turn this
 * file into a no-op.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'scripts/check-security-disclosure.mjs');

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, DEFAULT_MANIFEST_PATH), 'utf8'));

/**
 * A synthetic repository: an in-memory file map plus the two readers the
 * gate takes as dependencies. `files` keys are repo-relative paths.
 */
function tree({ ledger, runbookText, scripts, files }) {
	const table = new Map(Object.entries(files));
	if (ledger !== undefined) table.set(DEFAULT_MANIFEST_PATH, JSON.stringify(ledger));
	if (runbookText !== undefined) table.set('docs/runbook/security-disclosure.md', runbookText);
	if (scripts !== undefined) table.set('package.json', JSON.stringify({ scripts }));
	const readFile = (path) => {
		const key = relative('/synthetic', path);
		if (!table.has(key)) throw new Error(`ENOENT: ${key}`);
		return table.get(key);
	};
	return {
		root: '/synthetic',
		readFile,
		fileExists: (path) => table.has(relative('/synthetic', path)),
		// Same table: the gate's default probe loader reads the real disk,
		// which a synthetic tree must not depend on.
		loadProbe: (_root, name) => JSON.parse(readFile(join('/synthetic', FIXTURE_DIR, name))),
	};
}

/** Copy without one key — biome forbids `delete` on an object literal. */
function omit(source, key) {
	const { [key]: _dropped, ...rest } = source;
	return rest;
}

function syntheticReport(overrides = {}) {
	return {
		class: 'fixture',
		internet_reachable: true,
		pre_auth: true,
		credential_disclosed: false,
		exploit_observed: false,
		detail_public_before_fix: false,
		summary: 'synthetic report for the unit suite',
		...overrides,
	};
}

describe('priority derivation', () => {
	it('is ordered first-match: credential disclosure outranks reachability', () => {
		const derived = derivePriority(manifest, syntheticReport({ credential_disclosed: true }));
		assert.equal(derived.priority, 'P0');
		assert.equal(derived.index, 0);
	});

	it('observed exploitation is P0 even when nothing else is exposed', () => {
		assert.equal(
			derivePriority(manifest, syntheticReport({ exploit_observed: true })).priority,
			'P0',
		);
	});

	it('unauthenticated internet reachability is P1, authenticated reachability P2', () => {
		assert.equal(derivePriority(manifest, syntheticReport({ pre_auth: true })).priority, 'P1');
		assert.equal(derivePriority(manifest, syntheticReport({ pre_auth: false })).priority, 'P2');
	});

	it('nothing reachable falls through to P3', () => {
		const derived = derivePriority(manifest, syntheticReport({ internet_reachable: false }));
		assert.equal(derived.priority, 'P3');
		assert.equal(derived.index, manifest.priority_rules.length - 1);
	});

	it('refuses a field the ledger does not define instead of reading it as false', () => {
		assert.throws(
			() => derivePriority(manifest, syntheticReport({ needs_urgent_lunch: true })),
			/unknown_report_field: needs_urgent_lunch/,
		);
	});

	it('refuses a non-boolean rule flag', () => {
		assert.throws(
			() => derivePriority(manifest, { ...syntheticReport(), pre_auth: 'yes' }),
			/report_flag_not_boolean: pre_auth/,
		);
	});
});

describe('status-only leak guard', () => {
	it('finds a credential-shaped value and reports its path, not the value', () => {
		const hit = findLeak({ pasted_value: `1:${'a'.repeat(48)}` });
		assert.equal(hit.code, 'credential_shaped_value');
		assert.equal(hit.path, 'pasted_value');
		assert.equal(JSON.stringify(hit).includes('a'.repeat(48)), false);
	});

	it('does not fire on an ordinary summary, a class name or a duty id', () => {
		assert.equal(findLeak(syntheticReport()), null);
		assert.equal(findLeak({ intake_recorded: true }), null);
	});

	it('a leaked report is refused as LEAK_REFUSED with a reason code only', () => {
		const report = syntheticReport({
			credential_disclosed: true,
			pasted_value: `1:${'b'.repeat(48)}`,
		});
		const outcome = evaluateReport({
			manifest,
			report,
			handled: Object.fromEntries(manifest.priorities.P0.required_actions.map((id) => [id, true])),
		});
		assert.equal(outcome.verdict, 'LEAK_REFUSED');
		assert.deepEqual(outcome.reasons, ['credential_shaped_value']);
		assert.equal(JSON.stringify(outcome).includes('b'.repeat(48)), false);
	});
});

describe('flow evaluation', () => {
	const completeP0 = () =>
		Object.fromEntries(manifest.priorities.P0.required_actions.map((id) => [id, true]));

	it('every required duty recorded is COMPLETE', () => {
		const outcome = evaluateReport({
			manifest,
			report: syntheticReport({ credential_disclosed: true }),
			handled: completeP0(),
		});
		assert.equal(outcome.verdict, 'COMPLETE');
		assert.deepEqual(outcome.reasons, []);
	});

	it('one missing duty is INCOMPLETE and names that duty', () => {
		const handled = omit(completeP0(), 'regression_test');
		const outcome = evaluateReport({
			manifest,
			report: syntheticReport({ credential_disclosed: true }),
			handled,
		});
		assert.equal(outcome.verdict, 'INCOMPLETE');
		assert.deepEqual(outcome.reasons, ['regression_test']);
		assert.deepEqual(outcome.missing, ['regression_test']);
	});

	it('a duty recorded as false is missing, not present', () => {
		const outcome = evaluateReport({
			manifest,
			report: syntheticReport({ credential_disclosed: true }),
			handled: { ...completeP0(), credential_containment: false },
		});
		assert.equal(outcome.verdict, 'INCOMPLETE');
		assert.deepEqual(outcome.missing, ['credential_containment']);
	});

	it('detail published before the fix fails even when every duty is recorded', () => {
		const outcome = evaluateReport({
			manifest,
			report: syntheticReport({ detail_public_before_fix: true }),
			handled: completeP0(),
		});
		assert.equal(outcome.verdict, 'INCOMPLETE');
		assert.deepEqual(outcome.reasons, ['public_detail_before_fix']);
	});

	it('a lower priority needs only its own duties', () => {
		const outcome = evaluateReport({
			manifest,
			report: syntheticReport({ internet_reachable: true, pre_auth: false }),
			handled: Object.fromEntries(manifest.priorities.P2.required_actions.map((id) => [id, true])),
		});
		assert.equal(outcome.priority, 'P2');
		assert.equal(outcome.verdict, 'COMPLETE');
	});

	it('an unknown duty in the record is an error, not an extra credit', () => {
		assert.throws(
			() =>
				evaluateReport({
					manifest,
					report: syntheticReport(),
					handled: { looks_fine: true },
				}),
			/unknown_duty: looks_fine/,
		);
	});
});

describe('hostile fixture materialisation', () => {
	it('builds the credential shape in memory instead of committing it', () => {
		const fixture = loadFixture(REPO_ROOT, 'pasted-credential.json');
		const onDisk = readFileSync(join(REPO_ROOT, FIXTURE_DIR, 'pasted-credential.json'), 'utf8');
		assert.equal(onDisk.includes('1:aaa'), false);
		const report = materializeFixture(fixture);
		assert.equal(fixture.hostile.field in report, true);
		const outcome = evaluateFixture(fixture, manifest);
		assert.equal(outcome.verdict, 'LEAK_REFUSED');
		assert.deepEqual(outcome.reasons, ['credential_shaped_value']);
	});

	it('refuses an unknown recipe rather than injecting nothing', () => {
		assert.throws(
			() => materializeFixture({ hostile: { shape: 'mystery', field: 'pasted_value' } }),
			/unknown_hostile_shape: mystery/,
		);
	});
});

describe('ledger / runbook agreement', () => {
	const runbookText = readFileSync(join(REPO_ROOT, 'docs/runbook/security-disclosure.md'), 'utf8');
	const scripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts;
	const files = new Map();
	const ledger = structuredClone(manifest);

	function run(overrides = {}, fixtureName = 'complete-p0.json') {
		const fixture = loadFixture(REPO_ROOT, fixtureName);
		return checkDisclosureFlow({
			...tree({
				ledger: overrides.ledger ?? ledger,
				runbookText: overrides.runbookText ?? runbookText,
				scripts: overrides.scripts ?? scripts,
				files: {
					...overrides.files,
					[join(FIXTURE_DIR, fixtureName)]: JSON.stringify(fixture),
				},
			}),
			probeFixtures: [fixtureName],
		});
	}

	it('a complete synthetic tree has no errors', () => {
		const result = run({
			files: Object.fromEntries(
				[
					...Object.values(ledger.actions).flatMap((duty) => duty.enforced_by),
					...ledger.references.map((reference) => reference.path),
				]
					.filter((path) => path !== 'docs/runbook/security-disclosure.md')
					.map((path) => [path, '']),
			),
		});
		assert.deepEqual(result.errors, []);
	});

	it('a stage whose heading left the runbook fails', () => {
		const result = run(
			{
				runbookText: runbookText.replace('## 4. 再現の固定 / reproduce', '## 4. reproduction'),
				files: Object.fromEntries(ledger.references.map((reference) => [reference.path, ''])),
			},
			'complete-p0.json',
		);
		assert.ok(result.errors.includes('stage_heading_not_documented: reproduce'));
	});

	it('a command the runbook names but package.json does not register fails', () => {
		const withoutGate = omit(scripts, 'security:disclosure:check');
		const result = run(
			{
				scripts: withoutGate,
				files: Object.fromEntries(ledger.references.map((reference) => [reference.path, ''])),
			},
			'complete-p0.json',
		);
		assert.ok(result.errors.includes('command_not_registered: security:disclosure:check'));
	});

	it('a missing reference fails rather than being reported as unverified', () => {
		const result = run(
			{
				files: Object.fromEntries(
					ledger.references
						.filter((reference) => reference.path !== 'docs/security.md')
						.map((reference) => [reference.path, '']),
				),
			},
			'complete-p0.json',
		);
		assert.ok(result.errors.includes('reference_unresolved: docs/security.md'));
	});

	it('a duty pointing at a deleted artefact fails', () => {
		const result = run(
			{
				files: Object.fromEntries(ledger.references.map((reference) => [reference.path, ''])),
			},
			'complete-p0.json',
		);
		assert.ok(
			result.errors.some((error) => error.startsWith('duty_evidence_missing: ')),
			'no duty_evidence_missing reported',
		);
	});

	it('an empty roster fails closed instead of disabling the gate', () => {
		const empty = structuredClone(ledger);
		empty.stages = [];
		const result = run({ ledger: empty }, 'complete-p0.json');
		assert.ok(result.errors.includes('empty_roster: stages'));
	});

	it('a probe whose expectation the evaluator does not reproduce fails', () => {
		const fixture = loadFixture(REPO_ROOT, 'missing-regression-test.json');
		const lying = { ...fixture, expect: { ...fixture.expect, verdict: 'COMPLETE' } };
		const result = checkDisclosureFlow({
			...tree({
				ledger,
				runbookText,
				scripts,
				files: {
					[join(FIXTURE_DIR, 'missing-regression-test.json')]: JSON.stringify(lying),
				},
			}),
			probeFixtures: ['missing-regression-test.json'],
		});
		assert.ok(result.errors.some((error) => error.startsWith('probe_mismatch:')));
	});

	it('an unreadable manifest fails closed', () => {
		const result = checkDisclosureFlow({
			...tree({ ledger: undefined, runbookText, scripts, files: {} }),
			probeFixtures: [],
		});
		assert.ok(result.errors.some((error) => error.startsWith('manifest_unreadable:')));
	});
});

describe('the real repository', () => {
	const result = checkDisclosureFlow({ root: REPO_ROOT });

	it('has no ledger / runbook problem', () => {
		assert.deepEqual(result.errors, []);
	});

	it('every committed probe reproduces its recorded expectation', () => {
		assert.equal(result.probes.length, PROBE_FIXTURES.length);
		for (const probe of result.probes) {
			assert.equal(probe.mismatch, null, `${probe.name}: ${probe.mismatch}`);
		}
	});

	it('keeps the four statuses distinct and includes refusals', () => {
		const verdicts = result.probes.map((probe) => probe.result.verdict);
		assert.ok(verdicts.includes('COMPLETE'));
		assert.ok(verdicts.includes('INCOMPLETE'));
		assert.ok(verdicts.includes('LEAK_REFUSED'));
	});

	it('the report renders the probes and carries no fixture value', () => {
		const html = renderReport({
			manifest,
			result,
			probes: result.probes,
			sourceSha: 'testsha',
		});
		assert.ok(html.includes('LEAK_REFUSED'));
		assert.ok(html.includes('pasted-credential'));
		assert.ok(html.includes('SIMULATION, NOT AN INCIDENT RECORD'));
		assert.equal(html.includes('1:aaaa'), false);
		assert.ok(BOOLEAN_REPORT_FIELDS.includes('detail_public_before_fix'));
	});
});

describe('CLI', () => {
	it('prints usage and exits 0 for --help', () => {
		assert.equal(main(['--help']), 0);
	});

	it('exits 0 on the real repository and prints only status lines', () => {
		const out = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
		for (const line of out.trim().split('\n')) {
			assert.match(line, /^\[disclosure\] /);
		}
		assert.ok(out.includes('verdict=OK'));
	});

	it('demonstrates one fixture and refuses a fixture that is not complete', () => {
		assert.equal(
			execFileSync(
				process.execPath,
				[SCRIPT, `--fixture=${join(FIXTURE_DIR, 'complete-p2.json')}`],
				{
					encoding: 'utf8',
				},
			).includes('verdict=COMPLETE'),
			true,
		);
		assert.throws(() =>
			execFileSync(
				process.execPath,
				[SCRIPT, `--fixture=${join(FIXTURE_DIR, 'missing-regression-test.json')}`],
				{ encoding: 'utf8', stdio: 'pipe' },
			),
		);
	});

	it('exits 2 for an unreadable fixture path', () => {
		assert.equal(main(['--fixture=quality/fixtures/security-disclosure/nope.json']), 2);
	});
});
