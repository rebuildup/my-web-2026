import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CI_JOB,
	DEFAULT_MANIFEST_PATH,
	FIXTURE_DIR,
	PROBE_FIXTURES,
	STATUSES,
	checkAsvsCoverage,
	ciJobRunLines,
	collectSurfaces,
	evaluateAsvsCoverage,
	evaluateFixture,
	loadFixture,
	renderReport,
	scriptNameOfCommand,
	statusLabel,
} from './check-asvs-coverage.mjs';

/**
 * Fixture coverage for the ASVS coverage ledger (Issue #507).
 *
 * The gate is only useful if it fails when the ledger lies. The
 * fixtures pin the two directions the Issue names:
 *
 *   - a normal ledger may mix pass / not run / N/A, and the not-run row
 *     is never folded into pass;
 *   - an applicable row with a missing evidence file is fail, not
 *     not-run (a nonexistent path is not "unverified", it is a false
 *     claim);
 *   - an applicable row with no evidence and no follow_up is fail
 *     (silent omission);
 *   - a gate that is not registered in package.json is fail.
 *
 * The last block runs the same evaluator against the real repository, so
 * a regression in the manifest or the scanner cannot become a no-op.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const standard = {
	name: 'OWASP Application Security Verification Standard',
	version: '5.0.0',
	url: 'https://owasp.org/www-project-application-security-verification-standard/',
	requirements_url: 'https://example.invalid/asvs-requirements.json',
	certification: false,
	note: 'A fixture ledger. It is not an ASVS certification or an audit.',
};

const policy =
	'Every selected applicable requirement names a control and evidence; missing evidence is not run with follow_up and is never a pass.';

function item(overrides = {}) {
	return {
		id: 'V1.2.1',
		chapter: 'V1 Encoding and Sanitization',
		section: 'V1.2 Injection Prevention',
		level: 'L1',
		requirement: 'Verify that output encoding is relevant for the context.',
		applicability: 'applicable',
		control: 'fixture output encoder',
		issues: [507],
		evidence: [{ kind: 'test', path: 'scripts/check-asvs-coverage.test.mjs' }],
		...overrides,
	};
}

function evaluate(overrides = {}) {
	const manifest = {
		version: 1,
		standard,
		target_levels: ['L1', 'L2'],
		policy,
		items: [item()],
		...overrides,
	};
	return evaluateAsvsCoverage({
		manifest,
		scripts: {
			'validate:fast': 'pnpm run demo:check',
			'demo:check': 'node scripts/demo-check.mjs',
		},
		surfaces: {
			fast: new Set(['validate:fast', 'demo:check']),
			integration: new Set(['validate:integration', 'validate:fast', 'demo:check']),
			release: new Set(['validate:release', 'validate:integration', 'validate:fast', 'demo:check']),
			ci: new Set(),
		},
		fileExists: (path) => path === 'scripts/check-asvs-coverage.test.mjs',
	});
}

function rowOf(result, id) {
	return result.rows.find((row) => row.id === id);
}

describe('script and status vocabulary', () => {
	it('accepts exactly one pnpm run command', () => {
		assert.equal(scriptNameOfCommand('pnpm run asvs:check'), 'asvs:check');
		assert.equal(scriptNameOfCommand('node scripts/check-asvs-coverage.mjs'), null);
		assert.equal(scriptNameOfCommand('pnpm run a && pnpm run b'), null);
	});

	it('labels not run and N/A without turning them into pass', () => {
		assert.equal(statusLabel('pass'), 'pass');
		assert.equal(statusLabel('not_run'), 'not run');
		assert.equal(statusLabel('not_applicable'), 'N/A');
		assert.notEqual(statusLabel('not_run'), 'pass');
	});

	it('reads the ci surface from the validate job only, and only from run lines', () => {
		const workflowText = [
			'jobs:',
			'  validate:',
			'    name: validate',
			'      - name: gate',
			'        # `pnpm run commented:check` is prose, not a step.',
			'        run: pnpm run validate:fast',
			'      - run: pnpm run dep-audit:check -- --report .tmp/x.html',
			'  other:',
			'    steps:',
			'      - run: pnpm run other:check',
			'',
		].join('\n');
		assert.equal(CI_JOB, 'validate');
		const runLines = ciJobRunLines(workflowText);
		assert.ok(runLines.some((line) => line.includes('dep-audit:check')));
		assert.ok(!runLines.some((line) => line.includes('commented:check')));
		assert.ok(!runLines.some((line) => line.includes('other:check')));

		const scripts = {
			'validate:fast': 'pnpm run fast:check',
			'fast:check': 'node scripts/fast.mjs',
			'dep-audit:check': 'node scripts/dep.mjs',
			'commented:check': 'node scripts/commented.mjs',
			'other:check': 'node scripts/other.mjs',
		};
		const surfaces = collectSurfaces({ scripts, workflowText });
		assert.ok(surfaces.ci.has('dep-audit:check'));
		assert.ok(!surfaces.ci.has('commented:check'), 'a comment is not a CI step');
		assert.ok(!surfaces.ci.has('other:check'), 'another job is not the validate gate');
	});
});

describe('a normal ledger keeps the four statuses distinct', () => {
	const fixture = loadFixture(REPO_ROOT, 'pass.json');
	const result = evaluateFixture(fixture);

	it('has no error and the expected summary', () => {
		assert.deepEqual(result.errors, []);
		assert.deepEqual(result.summary, fixture.expect.summary);
	});

	it('resolves the evidenced row to pass and the evidenced-less row to not run', () => {
		assert.equal(rowOf(result, 'V1.2.1').status, 'pass');
		assert.equal(rowOf(result, 'V3.4.3').status, 'not_run');
		assert.equal(rowOf(result, 'V17.1.1').status, 'not_applicable');
		assert.ok(rowOf(result, 'V3.4.3').follow_up.length > 20);
	});
});

describe('the ledger fails closed on a false claim', () => {
	it('fails a missing evidence file instead of calling it not run', () => {
		const fixture = loadFixture(REPO_ROOT, 'missing-evidence.json');
		const result = evaluateFixture(fixture);
		assert.equal(result.errors.length, 1);
		assert.equal(result.summary.fail, 1);
		assert.equal(rowOf(result, 'V1.2.1').status, 'fail');
		assert.match(result.errors[0], /does not exist/);
	});

	it('fails an applicable row with no evidence and no future work', () => {
		const fixture = loadFixture(REPO_ROOT, 'missing-follow-up.json');
		const result = evaluateFixture(fixture);
		assert.equal(result.errors.length, 1);
		assert.equal(result.summary.fail, 1);
		assert.match(result.errors[0], /follow_up/);
	});

	it('fails an unregistered gate', () => {
		const fixture = loadFixture(REPO_ROOT, 'unregistered-gate.json');
		const result = evaluateFixture(fixture);
		assert.equal(result.errors.length, 1);
		assert.equal(result.summary.fail, 1);
		assert.match(result.errors[0], /not registered/);
	});

	it('rejects a certification claim', () => {
		const result = evaluate({ standard: { ...standard, certification: true } });
		assert.match(result.errors.join('\n'), /certification/);
	});

	it('rejects an N/A row that still carries evidence', () => {
		const result = evaluate({
			items: [
				item({
					id: 'V17.1.1',
					applicability: 'not_applicable',
					reason: 'No WebRTC, TURN, or media signaling surface exists.',
				}),
			],
		});
		assert.equal(result.summary.fail, 1);
		assert.match(result.errors.join('\n'), /carries no evidence/);
	});

	it('rejects an N/A row with a placeholder reason', () => {
		const result = evaluate({
			items: [
				item({
					id: 'V17.1.1',
					applicability: 'not_applicable',
					reason: 'TBD',
					evidence: [],
				}),
			],
		});
		assert.equal(result.summary.fail, 1);
		assert.match(result.errors.join('\n'), /must say why/);
	});

	it('rejects a gate that is registered but not on its declared surface', () => {
		const result = evaluate({
			items: [
				item({
					// `ci` is the one surface the fixture world does not run.
					evidence: [{ kind: 'gate', command: 'pnpm run demo:check', surfaces: ['ci'] }],
				}),
			],
		});
		assert.equal(result.summary.fail, 1);
		assert.match(result.errors[0], /not reachable from ci/);
	});

	it('rejects duplicate requirement ids', () => {
		const result = evaluate({ items: [item(), item()] });
		assert.match(result.errors.join('\n'), /duplicate id/);
	});

	it('rejects a malformed requirement id', () => {
		const result = evaluate({ items: [item({ id: '3.4.4' })] });
		assert.match(result.errors.join('\n'), /ASVS id/);
	});
});

describe('the real repository ledger', () => {
	const result = checkAsvsCoverage({ root: REPO_ROOT });

	it('is internally consistent', () => {
		assert.deepEqual(result.errors, []);
	});

	it('selects a non-empty matrix with all four statuses represented', () => {
		assert.ok(result.rows.length >= 30);
		const total = Object.values(result.summary).reduce((sum, count) => sum + count, 0);
		assert.equal(total, result.rows.length);
		assert.ok(result.summary.pass > 0, 'at least one evidenced requirement');
		assert.ok(result.summary.not_run > 0, 'an applicable gap must be visible');
		assert.ok(result.summary.not_applicable > 0, 'an out-of-scope surface must be visible');
		for (const row of result.rows) assert.ok(STATUSES.includes(row.status), row.id);
	});

	it('publishes the counts the report and the PR body claim', () => {
		// Pinned so a manifest edit that quietly moves a row between
		// statuses cannot leave a green run behind a stale headline.
		assert.deepEqual(result.summary, { pass: 29, fail: 0, not_run: 6, not_applicable: 10 });
		assert.deepEqual(
			result.rows.filter((row) => row.status === 'not_run').map((row) => row.id),
			['V3.4.3', 'V6.3.3', 'V7.4.3', 'V8.2.2', 'V15.2.1', 'V16.1.1'],
		);
		assert.deepEqual(
			result.rows.filter((row) => row.status === 'not_applicable').map((row) => row.id),
			[
				'V13.4.1',
				'V14.3.1',
				'V1.2.5',
				'V1.5.1',
				'V2.4.2',
				'V4.3.1',
				'V4.4.1',
				'V9.1.1',
				'V10.1.1',
				'V17.1.1',
			],
		);
	});

	it('gives every pass row an executable evidence item, not documents alone', () => {
		for (const row of result.rows.filter((candidate) => candidate.status === 'pass')) {
			assert.ok(
				row.evidence.some((entry) => entry.kind === 'test' || entry.kind === 'gate'),
				`${row.id} passes on documents alone`,
			);
		}
	});

	it('does not claim ASVS certification', () => {
		assert.equal(result.manifest.standard.certification, false);
		assert.match(result.manifest.standard.note, /not an ASVS certification|not an audit/i);
	});

	it('gives every pass row resolved evidence and every gap a reason', () => {
		for (const row of result.rows.filter((candidate) => candidate.status === 'pass')) {
			assert.ok(row.evidence_results.length > 0, row.id);
			assert.ok(
				row.evidence_results.every((entry) => entry.ok),
				row.id,
			);
		}
		for (const row of result.rows.filter((candidate) => candidate.status === 'not_run')) {
			assert.ok(row.follow_up.length >= 20, `${row.id} needs follow_up`);
		}
		for (const row of result.rows.filter((candidate) => candidate.status === 'not_applicable')) {
			assert.ok(row.reason.length >= 20, `${row.id} needs a reason`);
		}
	});

	it('keeps the manifest on ASVS 5.0.0 and every selected id unique', () => {
		assert.equal(result.manifest.standard.version, '5.0.0');
		const ids = result.rows.map((row) => row.id);
		assert.equal(new Set(ids).size, ids.length);
	});
});

describe('the report the screenshot is taken from', () => {
	it('renders every row, all four statuses, both gap sections and the probes', () => {
		const result = checkAsvsCoverage({ root: REPO_ROOT });
		const probes = PROBE_FIXTURES.map((name) => {
			const fixture = loadFixture(REPO_ROOT, name);
			return { name, note: fixture.note, result: evaluateFixture(fixture) };
		});
		const html = renderReport({
			manifest: result.manifest,
			result,
			probes,
			sourceSha: '000000000000',
		});
		for (const row of result.rows) assert.ok(html.includes(row.id), `${row.id} missing`);
		for (const status of ['pass', 'fail', 'not run', 'N/A']) {
			assert.ok(html.toLowerCase().includes(status.toLowerCase()), `status ${status} missing`);
		}
		assert.ok(html.includes('NOT AN ASVS CERTIFICATION'));
		assert.ok(html.includes('Unverified applicable requirements'));
		assert.ok(html.includes('Not applicable in this release'));
		for (const probe of probes) assert.ok(html.includes(probe.name));
	});
});

describe('fixture directory', () => {
	it('contains exactly the probes the report renders', () => {
		const files = readdirSync(join(REPO_ROOT, FIXTURE_DIR))
			.filter((name) => name.endsWith('.json'))
			.sort();
		assert.deepEqual(files, [...PROBE_FIXTURES].sort());
	});

	it('points at the default manifest', () => {
		assert.equal(DEFAULT_MANIFEST_PATH, 'quality/asvs-coverage.json');
	});
});
