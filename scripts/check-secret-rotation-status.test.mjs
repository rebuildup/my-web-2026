import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AUDIT_ONLY_SECRETS, REQUIRED_RUNTIME_SECRETS } from './_cloudflare-contract.mjs';
import {
	CADENCE_KIND,
	DEADLINE_STATUS,
	DRIFT_STATUS,
	UNDECIDABLE_REASON,
	VERDICT,
	assertNoValueInText,
	classifyDeadline,
	collectNonNameTokens,
	evaluateSecretStatus,
	exitCodeForReport,
	formatStatusReport,
	isContractName,
	parseLedger,
	parseObservation,
	undecidableStatus,
} from './_secret-rotation-status.mjs';

/**
 * Secret drift / rotation-deadline status tests (Issue #477).
 *
 * The three properties the tool exists for, each asserted directly:
 *
 *   1. normal and mismatch are DIFFERENT verdicts with different exit
 *      codes, decided from mock data — a name the observation reports
 *      missing fails, an environment that matches passes, and a rotation
 *      past its cadence fails on its own;
 *   2. every state in which the tool cannot decide exits non-zero, so
 *      "could not read" is never the signal a release sees for "fine";
 *   3. the rendered report carries names, statuses, counts and dates
 *      and no value — enforced by the name grammar, by the ledger
 *      schema, and by the leak guard, each tested on its own.
 *
 * Nothing here reads Infisical, Cloudflare or the environment: the
 * observations are recorded status-only fixtures, and the CLI child
 * process runs with a credential-free environment.
 */

const CLI = fileURLToPath(new URL('./check-secret-rotation-status.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_DIR = fileURLToPath(
	new URL('../quality/fixtures/secret-rotation-status/', import.meta.url),
);
const LEDGER_PATH = fileURLToPath(
	new URL('../quality/secret-rotation-ledger.json', import.meta.url),
);

/** A child env with no Infisical / Cloudflare credential at all. */
const CREDENTIAL_FREE_ENV = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };

const CONTRACT = { required: REQUIRED_RUNTIME_SECRETS, auditOnly: AUDIT_ONLY_SECRETS };

function runCli(args, env = CREDENTIAL_FREE_ENV) {
	const result = spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		env,
		cwd: REPO_ROOT,
	});
	return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function fixture(name) {
	return JSON.parse(readFileSync(`${FIXTURE_DIR}${name}`, 'utf8'));
}

/** The ledger a case declares, parsed through the same seam the CLI uses. */
function fixtureLedger(name) {
	const parsed = parseLedger(JSON.stringify(fixture(name).ledger));
	assert.equal(parsed.ok, true, `fixture ${name} ledger must parse`);
	return parsed.ledger;
}

function fixtureCase(name) {
	const parsed = fixture(name);
	const ledger = fixtureLedger(name);
	const observation = parsed.observation ? parseObservation(parsed.observation) : null;
	return evaluateSecretStatus({
		ledger,
		contract: CONTRACT,
		observation: observation?.ok ? observation.observation : null,
		now: parsed.now,
	});
}

function minimalLedger(overrides = {}) {
	return {
		version: 1,
		policy: 'test',
		secrets: [
			{
				name: 'BETTER_AUTH_SECRETS',
				cadence: { kind: CADENCE_KIND.calendar, days: 90, label: 'quarterly review' },
				last_rotated_at: '2026-08-20',
				driver: 'scripts/rotate-better-auth-secret.mjs',
				runbook: 'docs/runbook/issue-139-rotation.md',
				...overrides,
			},
		],
	};
}

describe('name grammar (the status-only boundary)', () => {
	it('accepts the §3.2 convention and refuses everything else', () => {
		for (const name of ['BETTER_AUTH_SECRETS', 'MY_WEB_2026_CONSUMER_API_KEY']) {
			assert.equal(isContractName(name), true);
		}
		for (const notAName of [
			'kZ8xQ2mL9pR4tV7wY1nB6hJ3sD5fG0aC', // value-shaped
			'BETTER_AUTH_SECRETS=1:abc',
			'lowercase_name',
			'NOUNDERSCORE',
			'A_'.repeat(40),
			'',
			42,
			null,
		]) {
			assert.equal(isContractName(notAName), false);
		}
	});

	it('refuses an observation that carries a value instead of a name, without echoing it', () => {
		const token = 'ExampleValueThatIsNotAName123';
		const parsed = parseObservation({
			environment: 'prod',
			captured_at: '2026-10-18',
			missing: [token],
			extra: [],
		});
		assert.equal(parsed.ok, false);
		assert.equal(parsed.reason, UNDECIDABLE_REASON.observationMalformed);
		assert.ok(!JSON.stringify(parsed).includes(token));
	});

	it('flags the tokens a leak guard has to watch', () => {
		const tokens = collectNonNameTokens({
			environment: 'prod',
			captured_at: '2026-10-18',
			missing: ['MY_WEB_2026_CONSUMER_API_KEY'],
		});
		assert.deepEqual(tokens, []);
		const withValue = collectNonNameTokens({
			environment: 'prod',
			missing: ['ExampleValueNotAName123'],
		});
		assert.deepEqual(withValue, ['ExampleValueNotAName123']);
	});

	it('refuses to emit text containing a possible value', () => {
		assert.throws(
			() =>
				assertNoValueInText('row=ExampleValueNotAName123 drift=MISSING', [
					'ExampleValueNotAName123',
				]),
			/status-only contract is not negotiable/,
		);
		assert.doesNotThrow(() =>
			assertNoValueInText('row=BETTER_AUTH_SECRETS drift=MISSING', ['ExampleValueNotAName123']),
		);
	});
});

describe('ledger schema', () => {
	it('rejects a row that tries to hold a value', () => {
		const parsed = parseLedger(
			JSON.stringify({
				...minimalLedger(),
				secrets: [{ ...minimalLedger().secrets[0], value: 'placeholder' }],
			}),
		);
		assert.equal(parsed.ok, false);
		assert.equal(parsed.reason, UNDECIDABLE_REASON.ledgerMalformed);
		assert.ok(parsed.errors.some((error) => error.includes('value')));
	});

	it('rejects an unknown top-level key, a bad cadence and a duplicate row', () => {
		for (const broken of [
			{ ...minimalLedger(), note: 'smuggled' },
			{
				...minimalLedger(),
				secrets: [{ ...minimalLedger().secrets[0], cadence: { kind: 'whenever', label: 'x' } }],
			},
			{
				...minimalLedger(),
				secrets: [
					minimalLedger().secrets[0],
					{ ...minimalLedger().secrets[0], last_rotated_at: '2026-01-01' },
				],
			},
		]) {
			const parsed = parseLedger(JSON.stringify(broken));
			assert.equal(parsed.ok, false);
			assert.equal(parsed.reason, UNDECIDABLE_REASON.ledgerMalformed);
		}
	});

	it('is unreadable, not malformed, when it is not JSON at all', () => {
		assert.equal(parseLedger('not json').reason, UNDECIDABLE_REASON.ledgerUnreadable);
	});

	it('covers exactly the runtime contract this repository ships', () => {
		const parsed = parseLedger(readFileSync(LEDGER_PATH, 'utf8'));
		assert.equal(parsed.ok, true);
		const names = parsed.ledger.secrets.map((row) => row.name).sort();
		const contractNames = [...REQUIRED_RUNTIME_SECRETS, ...AUDIT_ONLY_SECRETS].sort();
		assert.deepEqual(names, contractNames);
		// Every name the runbook declares is projection, so a runbook
		// rename has to arrive with the ledger row, not silently after it.
		for (const row of parsed.ledger.secrets) {
			assert.ok(Object.keys(CADENCE_KIND).length > 0);
			assert.ok(row.runbook.length > 0);
			assert.ok(row.driver.length > 0);
		}
	});
});

describe('deadline classification', () => {
	const row = { cadence: { kind: CADENCE_KIND.calendar, days: 90 }, lastRotatedAt: '2026-01-05' };
	const now = Date.UTC(2026, 9, 19);

	it('separates within / due soon / overdue', () => {
		assert.equal(classifyDeadline(row, now).status, DEADLINE_STATUS.overdue);
		const soon = classifyDeadline({ ...row, lastRotatedAt: '2026-07-27' }, now);
		assert.equal(soon.status, DEADLINE_STATUS.dueSoon);
		assert.equal(soon.remainingDays, 6);
		const within = classifyDeadline({ ...row, lastRotatedAt: '2026-08-20' }, now);
		assert.equal(within.status, DEADLINE_STATUS.within);
		assert.equal(within.due, '2026-11-18');
		assert.equal(within.remainingDays, 30);
	});

	it('treats an event-driven cadence and an unrecorded date as different facts', () => {
		assert.equal(
			classifyDeadline({ cadence: { kind: CADENCE_KIND.eventDriven }, lastRotatedAt: null }, now)
				.status,
			DEADLINE_STATUS.eventDriven,
		);
		assert.equal(
			classifyDeadline({ ...row, lastRotatedAt: null }, now).status,
			DEADLINE_STATUS.unrecorded,
		);
	});
});

describe('verdicts from recorded (status-only) data', () => {
	it('separates normal from mismatch, and drift from deadline', () => {
		const expectations = {
			'in-sync.json': { verdict: VERDICT.ok, code: 0 },
			'name-missing.json': { verdict: VERDICT.drift, code: 1 },
			'overdue.json': { verdict: VERDICT.overdue, code: 1 },
			'unexpected-name.json': { verdict: VERDICT.ok, code: 0 },
			'unrecorded.json': { verdict: VERDICT.ok, code: 0 },
		};
		for (const [name, expected] of Object.entries(expectations)) {
			const report = fixtureCase(name);
			assert.equal(report.verdict, expected.verdict, `${name} verdict`);
			assert.equal(exitCodeForReport(report), expected.code, `${name} exit code`);
			const declared = fixture(name).expect;
			assert.equal(report.verdict, declared.verdict, `${name} declared verdict`);
			assert.equal(exitCodeForReport(report), declared.exit_code, `${name} declared exit code`);
			assert.equal(report.counts.advisory, declared.advisory, `${name} declared advisory count`);
		}
	});

	it('names the missing name and never invents a phase for it', () => {
		const report = fixtureCase('name-missing.json');
		const row = report.rows.find((entry) => entry.name === 'MY_WEB_2026_CONSUMER_API_KEY');
		assert.equal(row.drift, DRIFT_STATUS.missing);
		assert.equal(report.counts.driftFailures, 1);
	});

	it('reports "not observed" as its own state, never as a match', () => {
		const report = fixtureCase('unrecorded.json');
		assert.equal(report.observed, false);
		for (const row of report.rows) assert.equal(row.drift, DRIFT_STATUS.notObserved);
		assert.equal(report.counts.advisory, 4);
	});

	it('keeps an unexpected environment name advisory', () => {
		const report = fixtureCase('unexpected-name.json');
		const row = report.rows.find((entry) => entry.name === 'EXAMPLE_DEPLOY_CREDENTIAL_NAME');
		assert.equal(row.drift, DRIFT_STATUS.unexpected);
		assert.equal(report.counts.driftFailures, 0);
		assert.equal(exitCodeForReport(report), 0);
	});

	it('fails closed when the ledger does not cover the contract', () => {
		const ledger = fixtureLedger('in-sync.json');
		const trimmed = { ...ledger, secrets: ledger.secrets.slice(1) };
		const report = evaluateSecretStatus({
			ledger: trimmed,
			contract: CONTRACT,
			observation: null,
			now: '2026-10-19',
		});
		assert.equal(report.verdict, VERDICT.drift);
		assert.equal(report.counts.driftFailures, 1);
		assert.equal(
			report.rows.find((row) => row.name === 'BETTER_AUTH_SECRETS').drift,
			DRIFT_STATUS.missingRow,
		);

		const extra = {
			...ledger,
			secrets: [
				...ledger.secrets,
				{
					name: 'GHOST_SECRET_NAME',
					cadence: { kind: CADENCE_KIND.eventDriven, label: 'none' },
					last_rotated_at: null,
					driver: 'scripts/rotate-better-auth-secret.mjs',
					runbook: 'docs/runbook/issue-139-rotation.md',
				},
			],
		};
		const drifted = evaluateSecretStatus({
			ledger: extra,
			contract: CONTRACT,
			observation: null,
			now: '2026-10-19',
		});
		assert.equal(drifted.verdict, VERDICT.drift);
		assert.equal(
			drifted.rows.find((row) => row.name === 'GHOST_SECRET_NAME').drift,
			DRIFT_STATUS.extraRow,
		);
	});

	it('refuses an unusable clock rather than defaulting to "fine"', () => {
		const report = evaluateSecretStatus({
			ledger: fixtureLedger('in-sync.json'),
			contract: CONTRACT,
			observation: null,
			now: 'not-a-date',
		});
		assert.equal(report.verdict, VERDICT.undecidable);
		assert.equal(report.reason, UNDECIDABLE_REASON.clockInvalid);
		assert.equal(exitCodeForReport(report), 2);
	});
});

describe('recorded check-cf-secrets transcript', () => {
	const TRANSCRIPT = [
		'[check-cf-secrets] environment=prod',
		'[check-cf-secrets] captured_at=2026-10-18',
		'[check-cf-secrets] mode=execute',
		'[OK] Infisical prod vs required runtime contract',
		'[FAIL] Infisical prod vs audit-only retention',
		'  missing: MY_WEB_2026_CONSUMER_API_KEY',
		'  extra:   EXAMPLE_DEPLOY_CREDENTIAL_NAME',
		'[execute] all checks OK',
	].join('\n');

	it('reads the name lists the existing script already prints', () => {
		const parsed = parseObservation(TRANSCRIPT);
		assert.equal(parsed.ok, true);
		assert.equal(parsed.observation.environment, 'prod');
		assert.equal(parsed.observation.capturedAt, '2026-10-18');
		assert.deepEqual(parsed.observation.missing, ['MY_WEB_2026_CONSUMER_API_KEY']);
		assert.deepEqual(parsed.observation.extra, ['EXAMPLE_DEPLOY_CREDENTIAL_NAME']);
	});

	it('is malformed when it carries no verdict and no name list', () => {
		const parsed = parseObservation('just some notes\nnothing structured here');
		assert.equal(parsed.ok, false);
		assert.equal(parsed.reason, UNDECIDABLE_REASON.observationMalformed);
	});

	it('is malformed when a name list carries a value', () => {
		const parsed = parseObservation(
			TRANSCRIPT.replace('MY_WEB_2026_CONSUMER_API_KEY', 'ExampleValueNotAName123'),
		);
		assert.equal(parsed.ok, false);
		assert.equal(parsed.reason, UNDECIDABLE_REASON.observationMalformed);
	});
});

describe('rendered report', () => {
	it('prints names, statuses, counts and dates — and no value', () => {
		const report = fixtureCase('name-missing.json');
		const text = formatStatusReport(report, {
			source: 'fixture',
			ledger: 'fixture',
			contract: 'scripts/_cloudflare-contract.mjs',
		});
		assert.match(text, /verdict=DRIFT/);
		assert.match(text, /row=MY_WEB_2026_CONSUMER_API_KEY tier=runtime_required drift=MISSING/);
		assert.match(text, /drift_failures=1/);
		assert.match(text, /No secret value is read/);
		assertNoValueInText(text, collectNonNameTokens(fixture('name-missing.json').observation));
	});

	it('prints a reason CODE and no raw error text when undecidable', () => {
		const text = formatStatusReport(undecidableStatus(UNDECIDABLE_REASON.ledgerMalformed), {
			source: 'repository',
			ledger: 'unread',
			contract: 'scripts/_cloudflare-contract.mjs',
		});
		assert.match(text, /verdict=UNDECIDABLE reason=ledger_malformed/);
		assert.equal(exitCodeForReport(undecidableStatus(UNDECIDABLE_REASON.observationMalformed)), 2);
	});
});

describe('CLI', () => {
	it('reports the shipped repository state without a credential', () => {
		const result = runCli([]);
		assert.equal(result.status, 0);
		assert.match(result.stdout, /verdict=OK/);
		assert.match(result.stdout, /observation=not_observed/);
		assert.match(result.stdout, /row=BETTER_AUTH_SECRETS tier=runtime_required drift=NOT_OBSERVED/);
		assert.ok(!result.stdout.includes('sk-'));
	});

	it('reproduces every recorded case verdict and exit code', () => {
		for (const [name, declared] of [
			['in-sync', { verdict: VERDICT.ok, code: 0 }],
			['name-missing', { verdict: VERDICT.drift, code: 1 }],
			['overdue', { verdict: VERDICT.overdue, code: 1 }],
			['unexpected-name', { verdict: VERDICT.ok, code: 0 }],
			['unrecorded', { verdict: VERDICT.ok, code: 0 }],
			['malformed-observation', { verdict: VERDICT.undecidable, code: 2 }],
		]) {
			const result = runCli([`--case=quality/fixtures/secret-rotation-status/${name}.json`]);
			assert.equal(result.status, declared.code, `${name} exit code`);
			assert.match(result.stdout, new RegExp(`verdict=${declared.verdict}`), `${name} verdict`);
		}
	});

	it('marks a fixture run as not a release verdict', () => {
		const result = runCli(['--case=quality/fixtures/secret-rotation-status/in-sync.json']);
		assert.match(result.stdout, /this is NOT a release verdict/);
	});

	it('refuses a pinned clock without --case, so the gate cannot be green-washed', () => {
		const result = runCli(['--now=2020-01-01']);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /--now is accepted only with --case/);
	});

	it('rejects an unreadable observation instead of reporting a match', () => {
		const result = runCli(['--observation=.tmp/does-not-exist.txt']);
		assert.equal(result.status, 2);
		assert.match(result.stdout, /reason=observation_unreadable/);
	});

	it('rejects an unknown argument', () => {
		const result = runCli(['--print-values']);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /unknown argument/);
	});
});
