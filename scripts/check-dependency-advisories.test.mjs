import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
/**
 * `check-dependency-advisories.mjs` end-to-end tests (Issue #470).
 *
 * The unit tests prove the decision; these prove the process contract
 * CI depends on — the exit code, the status-only output, and the
 * acquisition behaviour that makes "no advisories" trustworthy:
 *
 *   1. Exit codes are the contract: 0 pass / recorded, 1 blocked,
 *      2 usage, 3 advisory data unavailable.
 *   2. A registry error document, an unparsable response and a
 *      non-blocking enforcement mode all still fail closed — none of
 *      them can print a zero-finding claim, and none of them echoes the
 *      upstream body into a log or an artifact.
 *   3. `--enforce` decides as `block` without editing the reviewed
 *      declaration, which is the escalation switch in the runbook.
 *   4. A usage mistake exits 2. `--now garbage` and `--input /nope` are
 *      operator typos, and must not be reported as a security verdict.
 *   5. Nothing from the environment reaches the output: the gate runs
 *      with the real secret-shaped variables present, and none of them
 *      appear in stdout, stderr or the HTML report.
 *
 * Every case runs against a fixture document, so the suite is
 * deterministic and needs no registry access.
 */
import { EXIT, parseArgs } from './check-dependency-advisories.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'check-dependency-advisories.mjs');
const FIXTURES = join(HERE, 'fixtures', 'dependency-advisories');
const REPO_ROOT = resolve(HERE, '..');
const REPOSITORY_GATE = join(REPO_ROOT, 'quality', 'dependency-advisory-gate.json');

/** A secret-shaped value that must never reach the output. */
const CANARY = 'canary-must-never-be-printed-0123456789';

function gate(name) {
	return join(FIXTURES, name);
}

function run(args, env = {}) {
	const result = spawnSync(process.execPath, [SCRIPT, ...args], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
		env: {
			...process.env,
			// Present but never readable by the gate; asserted below.
			MY_WEB_2026_CONSUMER_API_KEY: CANARY,
			BETTER_AUTH_SECRETS: CANARY,
			...env,
		},
	});
	return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function fixtureArgs(name, extra = []) {
	return ['--input', join(FIXTURES, name), '--now', '2026-10-18', ...extra];
}

describe('check-dependency-advisories — exit codes', () => {
	it('fails a high/critical example input under block enforcement', () => {
		const { status, stdout } = run(
			fixtureArgs('blocking.json', ['--gate', gate('gate-with-exception.json')]),
		);
		assert.equal(status, EXIT.BLOCKED);
		assert.match(stdout, /dependency advisory gate: FAIL/);
		assert.match(stdout, /\[critical\] GHSA-fixt-fixt-fixt fixture-runtime/);
		assert.match(stdout, /\[high\] GHSA-fixt-fixt-figh fixture-parser/);
	});

	it('passes a clean document', () => {
		const { status, stdout } = run(fixtureArgs('clean.json', ['--enforce']));
		assert.equal(status, EXIT.PASS);
		assert.match(stdout, /dependency advisory gate: PASS/);
		assert.match(stdout, /advisories reported: 0/);
	});

	it('records rather than blocks under audit enforcement', () => {
		// The committed declaration moved to `block` (Issue #645), so the
		// recorded-but-not-blocking verdict is covered by a fixture gate
		// that still declares the audit mode.
		const { status, stdout } = run(
			fixtureArgs('blocking.json', ['--gate', gate('gate-audit-enforcement.json')]),
		);
		assert.equal(status, EXIT.PASS);
		assert.match(stdout, /FINDINGS RECORDED/);
		assert.match(stdout, /enforcement is audit: recorded, not blocking/);
		assert.ok(!stdout.includes('dependency advisory gate: PASS'));
	});

	it('blocks on a blocking advisory under the committed block enforcement', () => {
		// The committed declaration is the one CI runs. Under `block` a
		// blocking finding that no approved exception covers must stop the
		// build — this is the behaviour the escalation to `block` claims.
		const { status, stdout } = run(fixtureArgs('blocking.json'));
		assert.equal(status, EXIT.BLOCKED);
		assert.match(stdout, /dependency advisory gate: FAIL/);
		assert.match(stdout, /enforcement:\s+block/);
		assert.match(stdout, /\[critical\] GHSA-fixt-fixt-fixt fixture-runtime/);
		assert.match(stdout, /\[high\] GHSA-fixt-fixt-figh fixture-parser/);
	});

	it('passes with a record when an approved exception covers the finding', () => {
		const { status, stdout } = run(
			fixtureArgs('blocking.json', ['--gate', gate('gate-with-exception.json'), '--enforce']),
		);
		assert.equal(status, EXIT.BLOCKED, 'the unexcepted high finding still stops the build');
		assert.match(stdout, /approved exceptions in force \(1\)/);
		assert.match(stdout, /approved by fixture: repository owner/);
		assert.match(stdout, /until 2027-01-31 \(105 day\(s\) left\)/);
	});

	it('blocks again once the exception has expired', () => {
		const { status, stdout } = run(
			fixtureArgs('blocking.json', [
				'--gate',
				gate('gate-with-expired-exception.json'),
				'--enforce',
			]),
		);
		assert.equal(status, EXIT.BLOCKED);
		assert.match(stdout, /expired exceptions treated as blocking \(1\)/);
		assert.match(stdout, /exception expired on 2026-01-31/);
	});

	it('passes outright when the only blocking advisory is covered by an approved exception', () => {
		const { status, stdout } = run(
			fixtureArgs('excepted-only.json', ['--gate', gate('gate-with-exception.json'), '--enforce']),
		);
		assert.equal(status, EXIT.PASS);
		assert.match(stdout, /dependency advisory gate: PASS/);
		assert.match(stdout, /blocking after exceptions: 0/);
		assert.match(stdout, /approved exceptions in force \(1\)/);
	});

	it('keeps blocking the package an approval does not name, and says why', () => {
		// One GHSA, two packages, one approved record. The second package
		// is not covered, so the gate must keep stopping on it and must
		// not report the record as covering the whole advisory.
		const { status, stdout } = run(
			fixtureArgs('multi-package.json', [
				'--gate',
				gate('gate-with-split-exception.json'),
				'--enforce',
			]),
		);
		assert.equal(status, EXIT.BLOCKED);
		assert.match(stdout, /dependency advisory gate: FAIL/);
		assert.match(stdout, /\[critical\] GHSA-fixt-fxmp-fxmp fixture-server-core/);
		assert.match(stdout, /approved exceptions in force \(1\)/);
		assert.match(stdout, /\[critical\] GHSA-fixt-fxmp-fxmp fixture-runtime/);
		assert.ok(!stdout.includes('DATA UNAVAILABLE'));
	});

	it('reports a record that matches no finding without failing the scan as unreadable', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dep-audit-report-'));
		try {
			const reportPath = join(dir, 'report.html');
			const { status, stdout } = run(
				fixtureArgs('multi-package.json', [
					'--gate',
					gate('gate-with-mismatched-exception.json'),
					'--enforce',
					'--report',
					reportPath,
				]),
			);
			assert.equal(status, EXIT.BLOCKED);
			assert.match(stdout, /exception records that match no finding \(1\)/);
			assert.match(stdout, /declares fixture-server-bundle\/critical/);
			assert.match(stdout, /reports fixture-runtime\/critical, fixture-server-core\/critical/);
			assert.match(stdout, /the record suppressed nothing/);
			assert.equal(stdout.match(/\[critical\] GHSA-fixt-fxmp-fxmp/g).length, 2);
			assert.ok(!stdout.includes('DATA UNAVAILABLE'));
			assert.ok(!stdout.includes('UNKNOWN, not zero'));
			const html = readFileSync(reportPath, 'utf8');
			assert.ok(html.includes('Exception records that match no finding (1)'));
			assert.ok(html.includes('suppressed nothing'));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('check-dependency-advisories — data fetch failure is never zero', () => {
	it('exits 3 on a registry error document', () => {
		const { status, stdout } = run(fixtureArgs('registry-error.json'));
		assert.equal(status, EXIT.DATA_UNAVAILABLE);
		assert.match(stdout, /dependency advisory gate: DATA UNAVAILABLE/);
		assert.match(stdout, /advisory data:\s+UNAVAILABLE/);
		assert.match(stdout, /UNKNOWN, not zero/);
		assert.doesNotMatch(stdout, /advisories reported/);
	});

	it('exits 3 on an unparsable response', () => {
		const { status, stdout } = run(fixtureArgs('non-json-response.txt'));
		assert.equal(status, EXIT.DATA_UNAVAILABLE);
		assert.match(stdout, /did not return JSON/);
	});

	it('exits 2 — not 1 — for a usage typo, instead of crashing into a security verdict', () => {
		// Exit 1 means "blocking advisories outstanding". A mistyped date
		// or a missing file is an operator mistake; an uncaught exception
		// there would be a stack trace under a security exit code.
		const badDate = run(['--input', join(FIXTURES, 'clean.json'), '--now', 'garbage']);
		assert.equal(badDate.status, EXIT.USAGE);
		assert.match(badDate.stderr, /--now must be a YYYY-MM-DD date/);
		assert.ok(!badDate.stdout.includes('dependency advisory gate'));

		const missing = run(['--input', join(FIXTURES, 'does-not-exist.json')]);
		assert.equal(missing.status, EXIT.USAGE);
		assert.match(missing.stderr, /cannot read the advisory document/);
		assert.ok(!missing.stdout.includes('dependency advisory gate'));

		const unreadableStdin = spawnSync(
			process.execPath,
			[SCRIPT, '--input', '/dev/null/nope', '--now', '2026-10-18'],
			{ cwd: REPO_ROOT, encoding: 'utf8' },
		);
		assert.equal(unreadableStdin.status, EXIT.USAGE);
	});

	it('exits 3 even under audit enforcement, which is otherwise non-blocking', () => {
		const { status } = run(fixtureArgs('registry-error.json', ['--enforce']));
		assert.equal(status, EXIT.DATA_UNAVAILABLE);
	});

	it('exits 3 under the committed block enforcement too', () => {
		// Unreadable advisory data fails closed in every enforcement
		// mode: a registry outage must never read as a clean tree.
		const { status, stdout } = run(fixtureArgs('registry-error.json'));
		assert.equal(status, EXIT.DATA_UNAVAILABLE);
		assert.match(stdout, /DATA UNAVAILABLE/);
	});

	it('exits 2 — not 3 — for a broken gate declaration', () => {
		const { status, stderr } = run(
			fixtureArgs('clean.json', ['--gate', join(FIXTURES, 'missing.json')]),
		);
		assert.equal(status, EXIT.USAGE);
		assert.match(stderr, /cannot read gate declaration/);
	});

	it('exits 2 for an unknown option and for a malformed flag value', () => {
		assert.equal(run(['--nope']).status, EXIT.USAGE);
		assert.equal(run(['--format']).status, EXIT.USAGE);
		assert.equal(run(['--format', 'yaml', ...fixtureArgs('clean.json')]).status, EXIT.USAGE);
		assert.equal(run(['--help']).status, EXIT.PASS);
	});

	it('accepts the bare `--` separator pnpm forwards from `pnpm run … -- args`', () => {
		// This is the exact argument vector the CI step produces, so the
		// package-script contract is pinned rather than assumed.
		const { status, stdout } = run([
			'--',
			'--input',
			join(FIXTURES, 'clean.json'),
			'--now',
			'2026-10-18',
		]);
		assert.equal(status, EXIT.PASS);
		assert.match(stdout, /dependency advisory gate: PASS/);
	});

	it('reports the unavailable verdict as JSON too, with null counts', () => {
		const { status, stdout } = run(fixtureArgs('registry-error.json', ['--format', 'json']));
		assert.equal(status, EXIT.DATA_UNAVAILABLE);
		const payload = JSON.parse(stdout);
		assert.equal(payload.status, 'data-unavailable');
		assert.equal(payload.dataStatus, 'unavailable');
		assert.equal(payload.total, null);
		assert.equal(payload.blockingCount, null);
		assert.equal(payload.counts.critical, null);
	});
});

describe('check-dependency-advisories — JSON verdict and report output', () => {
	it('emits a machine-readable verdict with the exception record', () => {
		const { status, stdout } = run(
			fixtureArgs('blocking.json', [
				'--gate',
				gate('gate-with-exception.json'),
				'--format',
				'json',
			]),
		);
		const payload = JSON.parse(stdout);
		assert.equal(status, EXIT.BLOCKED);
		assert.equal(payload.status, 'fail');
		assert.equal(payload.exitCode, EXIT.BLOCKED);
		assert.equal(payload.total, 4);
		assert.equal(payload.blockingCount, 1);
		assert.equal(payload.blocking[0].package, 'fixture-parser');
		assert.equal(payload.excepted[0].id, 'GHSA-fixt-fixt-fixt');
		assert.equal(payload.excepted[0].daysRemaining, 105);
		assert.equal(payload.reported.length, 2);
	});

	it('writes a self-contained HTML report next to the verdict', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dep-audit-report-'));
		try {
			const reportPath = join(dir, 'nested', 'report.html');
			const { status } = run(
				fixtureArgs('blocking.json', [
					'--gate',
					gate('gate-audit-enforcement.json'),
					'--report',
					reportPath,
				]),
			);
			assert.equal(status, EXIT.PASS);
			const html = readFileSync(reportPath, 'utf8');
			assert.match(html, /^<!doctype html>/);
			assert.doesNotMatch(html, /<script\b/i);
			assert.ok(html.includes('FINDINGS RECORDED'));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('writes a report that shows unknown, not zero, when data is unavailable', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dep-audit-report-'));
		try {
			const reportPath = join(dir, 'report.html');
			const { status } = run(fixtureArgs('registry-error.json', ['--report', reportPath]));
			assert.equal(status, EXIT.DATA_UNAVAILABLE);
			const html = readFileSync(reportPath, 'utf8');
			assert.ok(html.includes('DATA UNAVAILABLE'));
			assert.ok(html.includes('>unknown<'));
			assert.doesNotMatch(html, /Blocking \(0\)/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('check-dependency-advisories — secret posture', () => {
	it('prints nothing that came from the environment', () => {
		const { stdout, stderr } = run(fixtureArgs('blocking.json', ['--format', 'json']));
		assert.ok(!stdout.includes(CANARY));
		assert.ok(!stderr.includes(CANARY));
	});

	it('never copies an upstream response body into stdout or the report', () => {
		// The unavailable verdict is the one branch that would otherwise
		// carry raw upstream text into a CI log and into a 90-day artifact.
		// `upstream-echo.txt` is not JSON and carries a token-shaped string
		// to prove the body is withheld rather than merely truncated.
		const dir = mkdtempSync(join(tmpdir(), 'dep-audit-report-'));
		try {
			const reportPath = join(dir, 'report.html');
			const { status, stdout, stderr } = run(
				fixtureArgs('upstream-echo.txt', ['--report', reportPath]),
			);
			assert.equal(status, EXIT.DATA_UNAVAILABLE);
			assert.ok(!stdout.includes('npm_fixtureTokenValueThatMustNotBeCopied'));
			assert.ok(!stderr.includes('npm_fixtureTokenValueThatMustNotBeCopied'));
			assert.ok(
				!readFileSync(reportPath, 'utf8').includes('npm_fixtureTokenValueThatMustNotBeCopied'),
			);
			assert.ok(!stdout.includes('registry.npmjs.org'));
			assert.match(stdout, /the response body is withheld/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('keeps the canary out of the HTML report as well', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dep-audit-report-'));
		try {
			const reportPath = join(dir, 'report.html');
			run(fixtureArgs('blocking.json', ['--report', reportPath]));
			assert.ok(!readFileSync(reportPath, 'utf8').includes(CANARY));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('reads no secret source to decide: only the advisory document and the declaration', () => {
		// Comments are stripped first: this file's own header explains the
		// posture in prose, and prose naming Infisical is documentation, not
		// access. Same trade the Wrangler independence gate makes.
		const code = readFileSync(SCRIPT, 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/(^|[^:])\/\/.*$/gm, '$1');
		for (const forbidden of ['infisical', 'wrangler secret', '.dev.vars', 'printenv']) {
			assert.ok(
				!code.toLowerCase().includes(forbidden),
				`${forbidden} must not appear in the gate`,
			);
		}
		assert.ok(!/process\.env\.[A-Z_]*(SECRET|TOKEN|KEY|PASSWORD)/.test(code));
	});
});

describe('parseArgs', () => {
	it('defaults to the committed declaration and live acquisition', () => {
		const options = parseArgs([]);
		assert.equal(options.gatePath, REPOSITORY_GATE);
		assert.equal(options.input, null);
		assert.equal(options.format, 'text');
		assert.equal(options.enforce, false);
	});

	it('accepts --input - for stdin and resolves paths against the process cwd', () => {
		assert.equal(parseArgs(['--input', '-']).input, '-');
		assert.equal(
			parseArgs(['--gate', 'quality/dependency-advisory-gate.json']).gatePath,
			REPOSITORY_GATE,
		);
	});

	it('parses --now into a UTC date and rejects every other shape', () => {
		assert.equal(parseArgs(['--now', '2026-10-18']).now.toISOString(), '2026-10-18T00:00:00.000Z');
		assert.equal(parseArgs([]).now, null);
		assert.throws(() => parseArgs(['--now', 'yesterday']));
		assert.throws(() => parseArgs(['--now']));
	});
});

describe('check-dependency-advisories — stdin acquisition', () => {
	it('reads an advisory document from stdin', () => {
		const payload = readFileSync(join(FIXTURES, 'clean.json'), 'utf8');
		const result = spawnSync(process.execPath, [SCRIPT, '--input', '-', '--now', '2026-10-18'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
			input: payload,
		});
		assert.equal(result.status, EXIT.PASS);
		assert.match(result.stdout, /advisory document from stdin/);
		assert.match(result.stdout, /dependency advisory gate: PASS/);
	});

	it('treats empty stdin as unavailable data rather than a clean scan', () => {
		const result = spawnSync(process.execPath, [SCRIPT, '--input', '-', '--now', '2026-10-18'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
			input: '',
		});
		assert.equal(result.status, EXIT.DATA_UNAVAILABLE);
		assert.match(result.stdout, /produced no output/);
	});
});

describe('check-dependency-advisories — the committed declaration stays valid', () => {
	it('parses the declaration the repository ships', () => {
		const raw = JSON.parse(readFileSync(REPOSITORY_GATE, 'utf8'));
		assert.equal(raw.schemaVersion, 1);
		assert.equal(raw.enforcement, 'block', 'Issue #645 escalated the committed gate to block');
		assert.ok(Array.isArray(raw.exceptions));
		const { status, stdout } = run([
			'--input',
			join(FIXTURES, 'clean.json'),
			'--now',
			'2026-10-18',
		]);
		assert.equal(status, EXIT.PASS);
		assert.match(stdout, /gate declaration:\s+quality\/dependency-advisory-gate\.json/);
	});

	it('keeps the shipped exception a dated, tracked, reviewable record', () => {
		// An exception is a decision, so it has to name what it accepts,
		// who accepted it, when it stops accepting it, and where the
		// follow-up is tracked. A record without an expiry or a tracking
		// Issue is not reviewable and the declaration parser rejects it.
		const raw = JSON.parse(readFileSync(REPOSITORY_GATE, 'utf8'));
		assert.equal(raw.exceptions.length, 1);
		const [exception] = raw.exceptions;
		assert.equal(exception.advisoryId, 'GHSA-vfj7-8cjw-p6xm');
		assert.equal(exception.package, 'braces');
		assert.equal(exception.severity, 'high');
		assert.match(exception.expiresOn, /^\d{4}-\d{2}-\d{2}$/);
		assert.ok(Number.isInteger(exception.trackingIssue));
		assert.ok(exception.approvedBy.length > 0);
		assert.ok(exception.reason.length > 0);
	});

	it('fails closed on the committed declaration when the advisory data cannot be read', () => {
		// `enforcement: block` must not weaken the unavailable-data
		// contract: the declaration still says `dataUnavailable: fail`,
		// so an unreadable document is exit 3, never a pass.
		const raw = JSON.parse(readFileSync(REPOSITORY_GATE, 'utf8'));
		assert.equal(raw.dataUnavailable, 'fail');
		const { status, stdout } = run(fixtureArgs('registry-error.json'));
		assert.equal(status, EXIT.DATA_UNAVAILABLE);
		assert.match(stdout, /DATA UNAVAILABLE/);
		assert.match(stdout, /UNKNOWN, not zero/);
	});
});

describe('check-dependency-advisories — argument contract', () => {
	it('keeps one report per path: a second run replaces the file rather than appending', () => {
		// Two runs, one report path: the second run owns the file, and the
		// gate must not append. This pins "last writer wins" so a CI log
		// never mixes two verdicts in one artifact.
		const dir = mkdtempSync(join(tmpdir(), 'dep-audit-report-'));
		try {
			const reportPath = join(dir, 'report.html');
			run(fixtureArgs('clean.json', ['--report', reportPath]));
			const first = readFileSync(reportPath, 'utf8');
			run(
				fixtureArgs('blocking.json', [
					'--gate',
					gate('gate-audit-enforcement.json'),
					'--report',
					reportPath,
				]),
			);
			const second = readFileSync(reportPath, 'utf8');
			assert.notEqual(first, second);
			assert.ok(second.includes('FINDINGS RECORDED'));
			assert.ok(!second.includes('dependency advisory gate: PASS'));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('keeps the report path out of stdout and writes it to stderr', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dep-audit-report-'));
		try {
			const { stdout, stderr } = run(
				fixtureArgs('clean.json', ['--report', join(dir, 'report.html'), '--format', 'json']),
			);
			assert.doesNotMatch(stdout, /report written/);
			assert.match(stderr, /report written: /);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('writes a report whose counts match the JSON verdict for the same document', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dep-audit-report-'));
		try {
			const reportPath = join(dir, 'report.html');
			run(fixtureArgs('blocking.json', ['--report', reportPath]));
			const payload = JSON.parse(run(fixtureArgs('blocking.json', ['--format', 'json'])).stdout);
			const html = readFileSync(reportPath, 'utf8');
			assert.ok(html.includes(`Blocking (${payload.blockingCount})`));
			assert.ok(html.includes(String(payload.counts.critical)));
			assert.ok(html.includes(String(payload.counts.moderate)));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
