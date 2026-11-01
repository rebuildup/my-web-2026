/**
 * `scripts/check-operator-mfa.mjs` — the operator MFA confirmation audit
 * (Issue #469).
 *
 * What this suite holds
 * ---------------------
 * The gate's whole value is in what it REFUSES to call a pass, so most of
 * these cases are fail-closed ones: a future confirmation date, a
 * self-inconsistent row, a ledger carrying an account identifier, a
 * factor kind outside the enum, a duplicated service. Each must land on
 * `UNDECIDABLE` (exit 2), and none may produce a row that reads
 * `confirmed`.
 *
 * The anonymization contract is asserted mechanically rather than by
 * convention: the schema has no field in which an account identifier can
 * be written, and every rendered artefact — this repository's own output
 * included — goes through the guard that refuses to print an e-mail, an
 * `otpauth://` URI, a base32 seed, a recovery-code-shaped digit run or a
 * bearer token. The guard's own finding carries a line number and a
 * detector id, never the matched text.
 *
 * Nothing here touches a network, a Cloudflare binding, or a credential
 * store: the ledger is a local fixture, per Issue #469's acceptance
 * condition that no production operation may be performed.
 *
 * Run: `node --test scripts/check-operator-mfa.test.mjs`
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	FACTOR_KIND,
	FORBIDDEN_LEDGER_KEYS,
	REQUIRED_SERVICES,
	SERVICE,
	SERVICE_ROW_KEYS,
	UNDECIDABLE_REASON,
	VERDICT,
	assertNoSensitiveInText,
	auditLedger,
	exitCodeFor,
	findSensitiveInText,
	formatAuditReport,
	readFixture,
	readLedger,
} from './_operator-mfa-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(ROOT, 'scripts', 'check-operator-mfa.mjs');
const LEDGER = resolve(ROOT, 'quality', 'operator-mfa-ledger.json');
const FIXTURE_DIR = resolve(ROOT, 'quality', 'fixtures', 'operator-mfa');

const FIXTURE_NAMES = [
	'all-confirmed.json',
	'one-unconfirmed.json',
	'missing-service.json',
	'stale-confirmation.json',
	'self-inconsistent.json',
	'account-identifier.json',
	'prototype-key.json',
];

const POLICY = Object.freeze({
	status: 'ratified',
	min_factors: 2,
	require_phishing_resistant: true,
	max_confirmation_age_days: 180,
});

/** A ledger with every row satisfied; cases mutate one aspect of it. */
function ledgerWith(overrides = {}) {
	const row = (
		confirmedAt,
		factors = [
			{ kind: 'passkey', confirmed_at: confirmedAt },
			{ kind: 'totp_app', confirmed_at: confirmedAt },
		],
	) => ({
		service: 'github',
		confirmed_at: confirmedAt,
		factors,
	});
	const services = [
		row('2026-10-12'),
		{ ...row('2026-10-12'), service: 'cloudflare' },
		{ ...row('2026-10-13'), service: 'infisical' },
		{ ...row('2026-10-13'), service: 'registrar' },
	];
	return { version: 1, policy: { ...POLICY }, services, ...overrides };
}

function runCli(args) {
	return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
}

describe('operator MFA audit — the shipped ledger claims nothing it cannot verify', () => {
	it('reads as OUTSTANDING, because no confirmation date has been recorded', () => {
		const audit = auditLedger(readFileSync(LEDGER, 'utf8'), { now: '2026-10-19' });
		assert.equal(audit.verdict, VERDICT.outstanding);
		assert.equal(exitCodeFor(audit), 1);
		assert.equal(audit.counts.confirmed, 0);
		assert.equal(audit.rows.length, REQUIRED_SERVICES.length);
	});

	it('marks the policy as proposed, so a pass would not read as owner-ratified', () => {
		const audit = auditLedger(readFileSync(LEDGER, 'utf8'), { now: '2026-10-19' });
		assert.equal(audit.policy.status, 'proposed');
		assert.equal(audit.policyRatified, false);
		assert.ok(audit.notes.some((note) => note.includes('policy_status=proposed')));
	});

	it('holds no account identifier, secret or free text', () => {
		const raw = JSON.parse(readFileSync(LEDGER, 'utf8'));
		for (const row of raw.services) {
			assert.deepEqual(Object.keys(row).sort(), [...SERVICE_ROW_KEYS].sort());
		}
		assertNoSensitiveInText(readFileSync(LEDGER, 'utf8'));
	});
});

describe('operator MFA audit — recorded fixtures decide what each case declares', () => {
	for (const name of FIXTURE_NAMES) {
		it(`${name} matches the verdict, exit code and counts it declares`, () => {
			const path = join(FIXTURE_DIR, name);
			const text = readFileSync(path, 'utf8');
			assertNoSensitiveInText(text);
			const read = readFixture(text);
			assert.ok(!('reason' in read), `${name} is not a readable fixture envelope`);
			const audit = auditLedger(read.fixture.ledger, { now: read.fixture.now });
			assert.equal(audit.verdict, read.fixture.expect.verdict, `${name} verdict`);
			assert.equal(exitCodeFor(audit), read.fixture.expect.exitCode, `${name} exit code`);
			for (const [key, value] of Object.entries(read.fixture.expect.counts)) {
				assert.equal(audit.counts[key], value, `${name} counts.${key}`);
			}
			if (read.fixture.expect.reason) {
				assert.equal(audit.reason, read.fixture.expect.reason, `${name} reason`);
			}
			// A verdict that is not OK may never be presented with every
			// required service confirmed, and OK may only be reached when
			// all four rows are confirmed.
			if (audit.verdict === VERDICT.ok)
				assert.equal(audit.counts.confirmed, REQUIRED_SERVICES.length);
			if (audit.verdict === VERDICT.undecidable) assert.equal(audit.rows.length, 0);
		});
	}

	it('keeps unconfirmed, stale and missing out of the confirmed bucket', () => {
		for (const name of FIXTURE_NAMES) {
			const read = readFixture(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
			const audit = auditLedger(read.fixture.ledger, { now: read.fixture.now });
			const total = Object.values(audit.counts).reduce((sum, value) => sum + value, 0);
			if (audit.verdict === VERDICT.undecidable) {
				assert.equal(total, 0, `${name} reports no row at all`);
				continue;
			}
			assert.equal(total, REQUIRED_SERVICES.length, `${name} covers every service`);
			const outstanding = audit.counts.unconfirmed + audit.counts.stale + audit.counts.missing;
			assert.equal(audit.verdict === VERDICT.ok, outstanding === 0, `${name} verdict shape`);
		}
	});
});

describe('operator MFA audit — fail-closed matrix', () => {
	const cases = [
		['a future confirmation date', { services: [] }, UNDECIDABLE_REASON.confirmationDateInFuture],
		['a non-ISO date', {}, UNDECIDABLE_REASON.confirmationDateInvalid],
		['a calendar day that does not exist', {}, UNDECIDABLE_REASON.confirmationDateInvalid],
		['a duplicated service', {}, UNDECIDABLE_REASON.serviceDuplicated],
		['an unknown service', {}, UNDECIDABLE_REASON.serviceUnknown],
		['an unknown factor kind', {}, UNDECIDABLE_REASON.factorKindUnknown],
		['a factor kind on Object.prototype', {}, UNDECIDABLE_REASON.factorKindUnknown],
		['a service id on Object.prototype', {}, UNDECIDABLE_REASON.serviceUnknown],
		['a forbidden account identifier', {}, UNDECIDABLE_REASON.forbiddenField],
		['an unknown top-level field', {}, UNDECIDABLE_REASON.unknownField],
		['a missing policy block', { policy: undefined }, UNDECIDABLE_REASON.policyInvalid],
		[
			'an out-of-range policy',
			{ policy: { ...POLICY, min_factors: 0 } },
			UNDECIDABLE_REASON.policyInvalid,
		],
		['an empty services array', { services: [] }, UNDECIDABLE_REASON.ledgerShapeInvalid],
		['an unsupported version', { version: 2 }, UNDECIDABLE_REASON.ledgerVersionUnsupported],
	];

	function mutated(build) {
		const ledger = ledgerWith();
		build(ledger);
		return ledger;
	}

	const builders = {
		'a future confirmation date': () =>
			mutated((ledger) => {
				ledger.services[0].confirmed_at = '2026-12-01';
				ledger.services[0].factors[0].confirmed_at = '2026-12-01';
				ledger.services[0].factors[1].confirmed_at = '2026-12-01';
			}),
		'a non-ISO date': () =>
			mutated((ledger) => {
				ledger.services[0].confirmed_at = '12/10/2026';
			}),
		'a calendar day that does not exist': () =>
			mutated((ledger) => {
				ledger.services[0].confirmed_at = '2026-02-30';
			}),
		'a duplicated service': () =>
			mutated((ledger) => {
				ledger.services[1].service = 'github';
			}),
		'an unknown service': () =>
			mutated((ledger) => {
				ledger.services[1].service = 'example-bank';
			}),
		'an unknown factor kind': () =>
			mutated((ledger) => {
				ledger.services[0].factors[0].kind = 'yubikey_hardware_token';
			}),
		// `{"kind": "toString"}` is a string an operator can type and a
		// plain `FACTOR_KIND[kind]` test answers from `Object.prototype`,
		// which would let a one-factor row reach `min_factors: 2`.
		'a factor kind on Object.prototype': () =>
			mutated((ledger) => {
				ledger.services[0].factors = [
					{ kind: 'passkey', confirmed_at: '2026-10-12' },
					{ kind: 'toString', confirmed_at: '2026-10-12' },
				];
			}),
		'a service id on Object.prototype': () =>
			mutated((ledger) => {
				ledger.services[1].service = 'constructor';
			}),
		'a forbidden account identifier': () =>
			mutated((ledger) => {
				ledger.services[0].email = 'someone@example.invalid';
			}),
		'an unknown top-level field': () =>
			mutated((ledger) => {
				ledger.checklist_version = 2;
			}),
		'a missing policy block': () => ledgerWith({ policy: undefined }),
		'an out-of-range policy': () => ledgerWith({ policy: { ...POLICY, min_factors: 0 } }),
		'an empty services array': () => ledgerWith({ services: [] }),
		'an unsupported version': () => ledgerWith({ version: 2 }),
	};

	for (const [name, , expectedReason] of cases) {
		it(`${name} is UNDECIDABLE (${expectedReason}), not a partial pass`, () => {
			const audit = auditLedger(builders[name](), { now: '2026-10-19' });
			assert.equal(audit.verdict, VERDICT.undecidable);
			assert.equal(audit.reason, expectedReason);
			assert.equal(exitCodeFor(audit), 2);
			assert.equal(audit.rows.length, 0);
			assert.equal(audit.counts.confirmed, 0);
		});
	}

	it('unparseable JSON and a non-object are ledger failures, not exceptions', () => {
		assert.equal(readLedger('{').reason, UNDECIDABLE_REASON.ledgerUnparseable);
		assert.equal(readLedger('[]').reason, UNDECIDABLE_REASON.ledgerShapeInvalid);
		assert.equal(readLedger(null).reason, UNDECIDABLE_REASON.ledgerShapeInvalid);
	});

	it('an unusable clock fails closed rather than ageing against "now"', () => {
		const audit = auditLedger(ledgerWith(), { now: 'not-a-date' });
		assert.equal(audit.verdict, VERDICT.undecidable);
		assert.equal(audit.reason, UNDECIDABLE_REASON.clockInvalid);
	});

	it('a vocabulary cannot be extended by Object.prototype', () => {
		// Both halves of the guard: the vocabularies carry no inherited
		// key, and membership is an own-property test rather than a
		// plain lookup that would answer "toString" / "constructor".
		for (const dict of [SERVICE, FACTOR_KIND]) {
			assert.equal(Object.getPrototypeOf(dict), null, 'the vocabulary has no prototype');
			for (const inherited of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
				assert.equal(Object.hasOwn(dict, inherited), false, `${inherited} is not a member`);
				assert.equal(inherited in dict, false, `${inherited} must not be inherited`);
			}
		}
		// And the whole ledger is refused, rather than counted as a pass.
		for (const [key, value] of [
			['kind', 'toString'],
			['kind', '__proto__'],
			['service', 'constructor'],
			['service', 'toString'],
		]) {
			const ledger = ledgerWith();
			if (key === 'kind')
				ledger.services[0].factors[1] = { kind: value, confirmed_at: '2026-10-12' };
			else ledger.services[1].service = value;
			const audit = auditLedger(ledger, { now: '2026-10-19' });
			assert.equal(audit.verdict, VERDICT.undecidable, `${key}=${value}`);
			assert.equal(audit.counts.confirmed, 0, `${key}=${value} confirms nothing`);
			assert.equal(audit.rows.length, 0, `${key}=${value} renders no row`);
		}
	});

	it('a recorded fixture must declare the clock its verdict was recorded with', () => {
		const path = join(FIXTURE_DIR, 'all-confirmed.json');
		const raw = JSON.parse(readFileSync(path, 'utf8'));
		const withoutNow = { case: raw.case, note: raw.note, ledger: raw.ledger, expect: raw.expect };
		const read = readFixture(JSON.stringify(withoutNow));
		assert.equal(read.reason, UNDECIDABLE_REASON.fixtureClockMissing);
	});
});

describe('operator MFA audit — the ledger cannot name an account', () => {
	it('has no free-text field on a service row', () => {
		assert.equal(SERVICE_ROW_KEYS.includes('note'), false);
		assert.deepEqual([...SERVICE_ROW_KEYS].sort(), ['confirmed_at', 'factors', 'service']);
	});

	it('rejects every identifier-shaped key with its own reason code', () => {
		for (const key of ['account', 'email', 'handle', 'login', 'user', 'username', 'note']) {
			assert.ok(FORBIDDEN_LEDGER_KEYS.includes(key), `${key} must be forbidden`);
			const ledger = ledgerWith();
			ledger.services[0][key] = 'anything';
			const audit = auditLedger(ledger, { now: '2026-10-19' });
			assert.equal(audit.reason, UNDECIDABLE_REASON.forbiddenField, `${key} reason`);
		}
	});
});

describe('operator MFA audit — the anonymization guard', () => {
	const samples = [
		['email-address', 'operator address operator@example.invalid'],
		['otpauth-uri', 'otpauth://totp/example?secret=ABCDEFGHIJKLMNOP'],
		['base32-secret', 'seed GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'],
		['long-digit-run', 'recovery code 123456789012'],
		['bearer-token', 'Authorization: Bearer abcdefghijklmnop'],
		['url-embedded-credential', 'https://user:hunter2@registry/repo'],
		['private-key-block', '-----BEGIN RSA PRIVATE KEY-----'],
		['provider-token', 'ghp_abcdefghijklmnopqrstuvwx'],
	];

	for (const [id, sample] of samples) {
		it(`flags ${id} and prints neither the value nor the id of a person`, () => {
			const findings = findSensitiveInText(`line one\n${sample}\n`);
			assert.ok(
				findings.some((finding) => finding.id === id),
				`${id} must be detected`,
			);
			for (const finding of findings) {
				assert.equal(Object.keys(finding).sort().join(','), 'id,line');
			}
			assert.throws(
				() => assertNoSensitiveInText(sample),
				(error) => {
					assert.match(error.message, /^anonymization guard: [a-z0-9-]+ at line \d+/);
					assert.equal(error.message.includes(sample), false);
					return true;
				},
			);
		});
	}

	it('does not read a provenance git short sha as a credential', () => {
		// A 12-character hexadecimal sha is all digits about 0.36% of the
		// time, and the digit-run rule cannot tell it from a secret.
		const provenance =
			'Issue #469 · my-web-2026 <version> · head 637725805045 · 生成 2026-11-01T05:34:43.315Z';
		assert.deepEqual(findSensitiveInText(provenance), []);
		assertNoSensitiveInText(provenance);
	});

	it('still flags a digit run that is not a provenance short sha', () => {
		const findings = findSensitiveInText('recovery code 123456789012');
		assert.ok(findings.some((finding) => finding.id === 'long-digit-run'));
		const longer = findSensitiveInText('head 6377258050451234');
		assert.ok(longer.some((finding) => finding.id === 'long-digit-run'));
	});

	it('passes the rendered report for every fixture', () => {
		for (const name of FIXTURE_NAMES) {
			const read = readFixture(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
			const audit = auditLedger(read.fixture.ledger, { now: read.fixture.now });
			const text = formatAuditReport(audit, { source: `fixture ${name}` });
			assertNoSensitiveInText(text);
			assert.equal(text.includes('@'), false, `${name} renders no address`);
			assert.match(text, /^operator MFA confirmation audit \(Issue #469\)/);
			assert.ok(text.includes(`verdict: ${audit.verdict}`));
		}
	});

	it('renders the same verdict the classifier returned, including for UNDECIDABLE', () => {
		const audit = auditLedger({ version: 1 }, { now: '2026-10-19' });
		const text = formatAuditReport(audit, { source: 'unit' });
		assert.ok(text.includes('verdict: UNDECIDABLE'));
		assert.ok(text.includes('exit=2'));
		assert.ok(text.includes('no rows'));
	});
});

describe('operator MFA audit — CLI', () => {
	it('exits 1 on the shipped ledger and 0 on the confirmed fixture', () => {
		const shipped = runCli([]);
		assert.equal(shipped.status, 1);
		assert.match(shipped.stdout, /verdict: OUTSTANDING/);

		const ok = runCli(['--fixture=quality/fixtures/operator-mfa/all-confirmed.json']);
		assert.equal(ok.status, 0);
		assert.match(ok.stdout, /verdict: OK/);
	});

	it('exits 2 for an undecidable fixture, an unreadable ledger and a usage error', () => {
		const inconsistent = runCli(['--fixture=quality/fixtures/operator-mfa/self-inconsistent.json']);
		assert.equal(inconsistent.status, 2);
		assert.match(inconsistent.stdout, /reason=confirmation_date_inconsistent/);

		const missing = runCli(['--ledger=quality/fixtures/operator-mfa/does-not-exist.json']);
		assert.equal(missing.status, 2);
		assert.match(missing.stdout, /reason=ledger_unreadable/);

		const usage = runCli(['--print-secrets']);
		assert.equal(usage.status, 2);
		assert.match(usage.stderr, /unknown argument/);
	});

	it('refuses an unreadable ledger with a verdict, never a stack trace', () => {
		// A home directory or a path holding `@` is plausible for an
		// operator, and the guard that protects the two sibling branches
		// has to cover this one too: exit 2, a value-free reason, and no
		// Node stack frame on either stream.
		const dir = mkdtempSync(join(tmpdir(), 'operator-mfa-unreadable@'));
		try {
			const result = runCli([`--ledger=${join(dir, 'absent.json')}`]);
			const output = `${result.stdout}${result.stderr}`;
			assert.equal(result.status, 2);
			assert.match(result.stdout, /reason=ledger_unreadable/);
			assert.equal(/at .*\(.*:\d+:\d+\)/.test(result.stderr), false, 'no stack frame');
			assert.equal(/\n\s+at /.test(result.stderr), false, 'no stack frame');
			assertNoSensitiveInText(output);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('prints status only — no address, no bearer token, no enrolment list', () => {
		for (const name of FIXTURE_NAMES) {
			const result = runCli([`--fixture=quality/fixtures/operator-mfa/${name}`]);
			const output = `${result.stdout}${result.stderr}`;
			assert.equal(output.includes('@'), false, `${name} must print no address`);
			assert.equal(/Bearer/i.test(output), false, `${name} must print no token`);
			assertNoSensitiveInText(output);
		}
	});

	it('refuses to print a ledger that carries a secret-shaped value', () => {
		const dir = mkdtempSync(join(tmpdir(), 'operator-mfa-'));
		try {
			const path = join(dir, 'leaky-ledger.json');
			const file = ledgerWith();
			// A value shaped like an identifier, written into a field the
			// schema does not define. The guard runs on the file text before
			// any parsing, so it refuses even the row the schema would have
			// rejected on its own.
			file.services[0].account = 'owner@example.invalid';
			writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
			const result = runCli([`--ledger=${path}`]);
			assert.equal(result.status, 2);
			assert.match(result.stderr, /anonymization guard: email-address/);
			assert.equal(result.stderr.includes('owner@example.invalid'), false);
			assert.equal(result.stdout.includes('owner@example.invalid'), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
