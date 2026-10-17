import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
/**
 * `_dependency-advisories.mjs` unit tests (Issue #470).
 *
 * The invariants worth proving, in the order the gate depends on them:
 *
 *   1. Normalisation. A `pnpm audit --json` document becomes a stable
 *      finding list, and anything that is not an advisory document is
 *      REJECTED rather than normalised to an empty list.
 *   2. Unknown severities stop. A registry severity this gate has never
 *      heard of is an error, never a downgrade to `low`.
 *   3. Severity policy. Only the declared blocking severities stop;
 *      moderate/low are reported.
 *   4. Exceptions are records with a deadline. An approved, unexpired
 *      exception converts a blocking finding into a recorded pass; an
 *      expired one stops being an exception and blocks again.
 *   5. Unavailable data never reads as clean. There is no path from an
 *      unreadable document to `pass`, and every count is null so a report
 *      cannot render zero.
 *   6. The gate declaration is validated strictly. An unknown key would
 *      otherwise leave an empty blocking set and a silent pass.
 */
import {
	GateDefinitionError,
	STATUS,
	advisoryIdentity,
	daysUntilExpiry,
	evaluateAdvisories,
	evaluateUnavailableData,
	parseAdvisoryPayload,
	parseGateDeclaration,
	renderText,
} from './_dependency-advisories.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'dependency-advisories');

const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

const repositoryGate = parseGateDeclaration(
	JSON.parse(readFileSync(resolve(HERE, '..', 'quality', 'dependency-advisory-gate.json'), 'utf8')),
);
const blockingFixture = parseAdvisoryPayload(fixture('blocking.json'));
const gateWithException = parseGateDeclaration(fixture('gate-with-exception.json'));
const gateWithExpiredException = parseGateDeclaration(fixture('gate-with-expired-exception.json'));

const NOW = '2026-10-18';
const asOf = (value) => new Date(`${value}T00:00:00Z`);

describe('parseAdvisoryPayload — normalisation', () => {
	it('reads severity, package, versions and dependency paths', () => {
		const critical = blockingFixture.find((finding) => finding.severity === 'critical');
		assert.equal(critical.package, 'fixture-runtime');
		assert.deepEqual(critical.versions, ['2.3.1']);
		assert.deepEqual(critical.paths, ['.>fixture-app>fixture-runtime']);
		assert.equal(critical.patchedVersions, '>=2.4.0');
		assert.equal(critical.devOnly, false);
	});

	it('marks a finding that only appears on dev dependency paths', () => {
		const dev = blockingFixture.find((finding) => finding.package === 'fixture-parser');
		assert.equal(dev.devOnly, true);
	});

	it('orders findings by descending severity, then package, then id', () => {
		assert.deepEqual(
			blockingFixture.map((finding) => finding.severity),
			['critical', 'high', 'moderate', 'low'],
		);
	});

	it('keeps the reported advisory id case, and falls back without one', () => {
		const ghsa = blockingFixture.find((finding) => finding.package === 'fixture-runtime');
		assert.equal(ghsa.id, 'GHSA-fixt-fixt-fixt');
		assert.equal(advisoryIdentity('k', { id: 42 }), 'npm:42');
		assert.equal(
			advisoryIdentity('k', { url: 'https://example.invalid/a' }),
			'https://example.invalid/a',
		);
		assert.throws(() => advisoryIdentity('k', {}), GateDefinitionError);
	});

	it('accepts a document with zero advisories as zero advisories', () => {
		assert.deepEqual(parseAdvisoryPayload(fixture('clean.json')), []);
	});

	it('rejects an error document instead of reading it as clean', () => {
		assert.throws(
			() => parseAdvisoryPayload(fixture('registry-error.json')),
			/no "advisories" object/,
		);
	});

	it('rejects a non-object payload and a non-object advisories map', () => {
		assert.throws(() => parseAdvisoryPayload('not json'), GateDefinitionError);
		assert.throws(() => parseAdvisoryPayload({ advisories: [] }), GateDefinitionError);
		assert.throws(() => parseAdvisoryPayload({ advisories: { a: 'nope' } }), GateDefinitionError);
	});

	it('stops on an unknown severity instead of downgrading it', () => {
		const payload = fixture('clean.json');
		payload.advisories = { 1: { id: 1, module_name: 'x', severity: 'severe', findings: [] } };
		assert.throws(() => parseAdvisoryPayload(payload), /unknown severity "severe"/);
	});

	it('requires a package name on every advisory', () => {
		const payload = fixture('clean.json');
		payload.advisories = { 1: { id: 1, severity: 'high', findings: [] } };
		assert.throws(() => parseAdvisoryPayload(payload), /module_name/);
	});
});

describe('parseGateDeclaration — the reviewed declaration', () => {
	it('accepts the declaration committed to the repository', () => {
		assert.equal(repositoryGate.schemaVersion, 1);
		assert.deepEqual(repositoryGate.blockingSeverities, ['critical', 'high']);
		assert.deepEqual(repositoryGate.exceptions, []);
		assert.equal(repositoryGate.dataUnavailable, 'fail');
	});

	it('rejects an unknown key, which would otherwise silently empty the blocking set', () => {
		const { blockingSeverities, ...rest } = fixture('gate-with-exception.json');
		assert.ok(Array.isArray(blockingSeverities));
		assert.throws(
			() => parseGateDeclaration({ ...rest, blockingSeverity: ['high'] }),
			/unknown key "blockingSeverity"/,
		);
	});

	it('requires at least one blocking severity and a supported enforcement mode', () => {
		assert.throws(
			() =>
				parseGateDeclaration({ ...fixture('gate-with-exception.json'), blockingSeverities: [] }),
			/at least one severity/,
		);
		assert.throws(
			() => parseGateDeclaration({ ...fixture('gate-with-exception.json'), enforcement: 'warn' }),
			/enforcement must be one of/,
		);
	});

	it('refuses any dataUnavailable policy other than fail-closed', () => {
		assert.throws(
			() =>
				parseGateDeclaration({ ...fixture('gate-with-exception.json'), dataUnavailable: 'ignore' }),
			/must not be reported as clean/,
		);
	});

	it('rejects a severity that is both blocking and reported', () => {
		assert.throws(
			() =>
				parseGateDeclaration({
					...fixture('gate-with-exception.json'),
					reportedSeverities: ['high', 'low'],
				}),
			/one meaning/,
		);
	});

	it('requires every exception record to be complete and dated', () => {
		const base = fixture('gate-with-exception.json').exceptions[0];
		for (const field of [
			'advisoryId',
			'package',
			'severity',
			'reason',
			'approvedBy',
			'expiresOn',
		]) {
			const broken = { ...base };
			delete broken[field];
			assert.throws(
				() =>
					parseGateDeclaration({ ...fixture('gate-with-exception.json'), exceptions: [broken] }),
				GateDefinitionError,
				`missing ${field} must be rejected`,
			);
		}
		assert.throws(
			() =>
				parseGateDeclaration({
					...fixture('gate-with-exception.json'),
					exceptions: [{ ...base, expiresOn: '31/01/2027' }],
				}),
			/YYYY-MM-DD/,
		);
		assert.throws(
			() =>
				parseGateDeclaration({ ...fixture('gate-with-exception.json'), exceptions: [base, base] }),
			/duplicate exception/,
		);
	});
});

describe('evaluateAdvisories — severity policy', () => {
	const blockGate = { ...gateWithException, exceptions: [] };

	it('fails on a high/critical example input under block enforcement', () => {
		const result = evaluateAdvisories({
			findings: blockingFixture,
			gate: blockGate,
			now: asOf(NOW),
		});
		assert.equal(result.status, STATUS.FAIL);
		assert.equal(result.blockingCount, 2);
		assert.deepEqual(
			result.blocking.map(({ finding }) => [finding.severity, finding.package]),
			[
				['critical', 'fixture-runtime'],
				['high', 'fixture-parser'],
			],
		);
		assert.equal(result.dataStatus, 'available');
	});

	it('reports moderate/low without blocking them', () => {
		const result = evaluateAdvisories({
			findings: blockingFixture,
			gate: blockGate,
			now: asOf(NOW),
		});
		assert.equal(result.reported.length, 2);
		assert.deepEqual(
			result.reported.map((finding) => finding.severity),
			['moderate', 'low'],
		);
		assert.equal(result.blockingCount, 2);
	});

	it('passes on a document with no advisories', () => {
		const result = evaluateAdvisories({
			findings: parseAdvisoryPayload(fixture('clean.json')),
			gate: blockGate,
			now: asOf(NOW),
		});
		assert.equal(result.status, STATUS.PASS);
		assert.equal(result.total, 0);
		assert.equal(result.blockingCount, 0);
	});

	it('records rather than blocks when enforcement is audit, and never calls that clean', () => {
		const result = evaluateAdvisories({
			findings: blockingFixture,
			gate: { ...repositoryGate },
			now: asOf(NOW),
		});
		assert.equal(result.status, STATUS.AUDIT_FINDINGS);
		assert.equal(result.blockingCount, 2);
		assert.notEqual(result.status, STATUS.PASS);
		assert.match(renderText(result), /enforcement is audit/);
	});

	it('counts every severity the document reported', () => {
		const result = evaluateAdvisories({
			findings: blockingFixture,
			gate: blockGate,
			now: asOf(NOW),
		});
		assert.deepEqual(result.counts, { info: 0, low: 1, moderate: 1, high: 1, critical: 1 });
		assert.equal(result.total, 4);
	});
});

describe('evaluateAdvisories — approved exceptions with a deadline', () => {
	it('passes with a record when an approved exception covers the finding', () => {
		const result = evaluateAdvisories({
			findings: blockingFixture,
			gate: gateWithException,
			now: asOf(NOW),
		});
		assert.equal(result.status, STATUS.FAIL, 'the unexcepted high finding still blocks');
		assert.equal(result.blockingCount, 1);
		assert.equal(result.excepted.length, 1);
		const [record] = result.excepted;
		assert.equal(record.finding.id, 'GHSA-fixt-fixt-fixt');
		assert.equal(record.exception.approvedBy, 'fixture: repository owner (not a real approval)');
		assert.equal(record.exception.trackingIssue, 470);
		assert.equal(record.exception.expiresOn, '2027-01-31');
		assert.equal(record.daysRemaining, 105);
		assert.ok(!result.blocking.some(({ finding }) => finding.id === 'GHSA-fixt-fixt-fixt'));
	});

	it('passes outright when the exception covers every blocking finding', () => {
		const onlyCritical = blockingFixture.filter((finding) => finding.severity === 'critical');
		const result = evaluateAdvisories({
			findings: onlyCritical,
			gate: gateWithException,
			now: asOf(NOW),
		});
		assert.equal(result.status, STATUS.PASS);
		assert.equal(result.excepted.length, 1);
		assert.match(renderText(result), /approved exceptions in force \(1\)/);
		assert.match(renderText(result), /approved by fixture: repository owner/);
	});

	it('blocks again once the exception expires, and names the expiry', () => {
		const onlyCritical = blockingFixture.filter((finding) => finding.severity === 'critical');
		const result = evaluateAdvisories({
			findings: onlyCritical,
			gate: gateWithExpiredException,
			now: asOf(NOW),
		});
		assert.equal(result.status, STATUS.FAIL);
		assert.equal(result.blockingCount, 1);
		assert.equal(result.expired.length, 1);
		assert.match(result.blocking[0].reason, /exception expired on 2026-01-31/);
		assert.match(renderText(result), /expired exceptions treated as blocking/);
	});

	it('treats the expiry date itself as still covered', () => {
		assert.equal(daysUntilExpiry('2026-10-18', asOf('2026-10-18')), 0);
		assert.equal(daysUntilExpiry('2026-10-19', asOf('2026-10-18')), 1);
		assert.equal(daysUntilExpiry('2026-10-17', asOf('2026-10-18')), -1);
	});

	it('flags an exception record that matches no advisory, so it can be removed', () => {
		const result = evaluateAdvisories({
			findings: blockingFixture.filter((finding) => finding.severity === 'high'),
			gate: gateWithException,
			now: asOf(NOW),
		});
		assert.equal(result.staleExceptions.length, 1);
		assert.equal(result.staleExceptions[0].exception.advisoryId, 'GHSA-fixt-fixt-fixt');
		assert.match(renderText(result), /exception records with no matching advisory/);
	});

	it('rejects an exception whose declared package or severity contradicts the advisory', () => {
		const mismatched = {
			...gateWithException,
			exceptions: [{ ...gateWithException.exceptions[0], package: 'other-package' }],
		};
		assert.throws(
			() =>
				evaluateAdvisories({
					findings: blockingFixture.filter((finding) => finding.severity === 'critical'),
					gate: mismatched,
					now: asOf(NOW),
				}),
			/declares other-package\/critical/,
		);
	});
});

describe('evaluateUnavailableData — data fetch failure is not zero advisories', () => {
	const unavailable = evaluateUnavailableData({
		gate: { ...repositoryGate },
		now: asOf(NOW),
		reason: 'registry error document (ERR_PNPM_FETCH)',
	});

	it('cannot pass, whatever the enforcement mode or the finding list', () => {
		assert.equal(unavailable.status, STATUS.DATA_UNAVAILABLE);
		assert.notEqual(unavailable.status, STATUS.PASS);
		const blocked = evaluateUnavailableData({
			gate: { ...repositoryGate, enforcement: 'block' },
			now: asOf(NOW),
			reason: 'no output',
		});
		assert.equal(blocked.status, STATUS.DATA_UNAVAILABLE);
	});

	it('leaves every count null so no report can render a zero', () => {
		assert.equal(unavailable.total, null);
		assert.equal(unavailable.blockingCount, null);
		for (const severity of Object.keys(unavailable.counts)) {
			assert.equal(unavailable.counts[severity], null, `${severity} must be unknown, not 0`);
		}
	});

	it('never prints a zero-finding claim in text form', () => {
		const text = renderText(unavailable, { source: 'fixture', gatePath: 'fixture' });
		assert.match(text, /DATA UNAVAILABLE/);
		assert.match(text, /UNKNOWN, not zero/);
		assert.doesNotMatch(text, /advisories reported: 0/);
		assert.doesNotMatch(text, /0 advisories/);
		assert.doesNotMatch(text, /no advisories/i);
		assert.ok(!text.includes('blocking after exceptions'));
	});

	it('records the failure reason so CI logs say why', () => {
		assert.equal(unavailable.dataDetail, 'registry error document (ERR_PNPM_FETCH)');
		assert.throws(
			() => evaluateUnavailableData({ gate: repositoryGate, now: asOf(NOW) }),
			GateDefinitionError,
		);
	});
});
