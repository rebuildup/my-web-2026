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
	SURFACES,
	checkReleaseGateCoverage,
	collectSurfaces,
	evaluateFixture,
	evaluateReleaseGate,
	expandScriptNames,
	loadFixture,
	parseProfileComponents,
	parseWorkflowJobRunCommands,
	renderReport,
	scriptNameOfCommand,
} from './check-release-gate-coverage.mjs';

/**
 * Fixture coverage for the release-gate check ledger (Issue #508).
 *
 * The gate is only worth running if it fails when it should. The case
 * that matters most is the Issue's first acceptance condition — "omit
 * one existing required inspection and the release must fail" — so the
 * first fixture plants exactly that omission (a required command the
 * release chain no longer reaches) and asserts the gate names it as
 * `not run` and errors. The rest pin the individual rules (unregistered
 * command, missing runner, N/A needs a reason, a protected row cannot be
 * deleted or relaxed) and the last case runs the gate against the real
 * repository so a regression in the scanner cannot become a silent
 * no-op.
 *
 * The on-disk fixtures in `quality/fixtures/release-gate/` are the same
 * ones `scripts/make-release-gate-report.mjs` renders as the report's
 * false-green probe, so the screenshot and this suite cannot disagree.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A miniature release chain: the same shape the real entry points have. */
const SCRIPTS = {
	'validate:fast': 'pnpm run lint:check && pnpm run secret:scan',
	'lint:check': 'biome lint .',
	'secret:scan': 'node scripts/scan-secrets.mjs',
	'validate:integration': 'pnpm run validate:fast && pnpm run secret:scan:bundle',
	'secret:scan:bundle': 'node scripts/scan-secrets.mjs --bundle',
	'validate:release': 'pnpm run validate:integration',
};

const FILES = ['scripts/scan-secrets.mjs'];

/** The quality profile of that miniature chain; agrees with it everywhere. */
const PROFILE = {
	fast: ['pnpm run lint:check', 'pnpm run secret:scan'],
	integration: ['- fast', 'pnpm run secret:scan:bundle'],
	release: ['pnpm run secret:scan:bundle'],
};

function check(overrides = {}) {
	return {
		id: 'secret-scan-source',
		contract: 'No secret-shaped literal is committed to the tracked source tree.',
		command: 'pnpm run secret:scan',
		state: 'implemented',
		required: true,
		surfaces: ['fast', 'integration', 'release'],
		documentation: 'docs/security/supply-chain-secret-scan.md',
		...overrides,
	};
}

/** A second, independent row that keeps the protected list satisfiable. */
function otherCheck(overrides = {}) {
	return check({
		id: 'lint-baseline',
		contract: 'Biome lint over the working tree, reported as an inspection nobody schedules.',
		command: 'pnpm run lint:check',
		surfaces: ['fast', 'integration', 'release'],
		documentation: 'docs/development.md',
		...overrides,
	});
}

/** A row the repository has not introduced yet: no command, a reason instead. */
function notApplicableCheck(overrides = {}) {
	const row = otherCheck({ required: false, state: 'not_applicable', surfaces: [], ...overrides });
	if (!Object.hasOwn(overrides, 'command')) row.command = undefined;
	return row;
}

/** The integration-only half of the same contract, as its own row. */
function bundleCheck(overrides = {}) {
	return check({
		id: 'secret-scan-bundle',
		contract: 'The production build output carries no secret either.',
		command: 'pnpm run secret:scan:bundle',
		surfaces: ['integration', 'release'],
		...overrides,
	});
}

/**
 * Evaluate a miniature world.
 *
 * @param {object} options
 * @param {string|null} options.omit  a script name no surface reaches
 * @param {string[]} options.protectedIds  defaults to the required rows
 */
function evaluate({
	checks = [check(), bundleCheck(), otherCheck()],
	scripts = SCRIPTS,
	omit = null,
	files = FILES,
	profileComponents = PROFILE,
	protectedIds = null,
	profileEquivalences = [],
} = {}) {
	const surfaces = collectSurfaces({ scripts });
	if (omit !== null) {
		for (const surface of SURFACES) {
			surfaces[surface] = new Set([...surfaces[surface]].filter((name) => name !== omit));
		}
	}
	const manifest = {
		version: 1,
		protected_checks: protectedIds ?? checks.filter((row) => row.required).map((row) => row.id),
		profile_equivalences: profileEquivalences,
		checks,
	};
	return evaluateReleaseGate({
		manifest,
		scripts,
		surfaces,
		profileComponents,
		fileExists: (path) => files.includes(path),
	});
}

/** The row for one id, so a test can assert on the status directly. */
function rowOf(result, id) {
	return result.rows.find((candidate) => candidate.id === id);
}

describe('the miniature world is a passing release', () => {
	it('resolves every required row to pass with no error', () => {
		const result = evaluate();
		assert.deepEqual(result.errors, []);
		assert.deepEqual(result.warnings, []);
		assert.deepEqual(result.summary, { pass: 3, fail: 0, not_run: 0, not_applicable: 0 });
	});
});

describe('script chain expansion', () => {
	it('follows `pnpm run` transitively and stops on a cycle', () => {
		const scripts = {
			a: 'pnpm run b && pnpm run c',
			b: 'pnpm run a && pnpm run c',
			c: 'node x.mjs',
		};
		assert.deepEqual(expandScriptNames(scripts, 'a').sort(), ['a', 'b', 'c']);
	});

	it('records the entry point but does not invent an unregistered script', () => {
		assert.deepEqual(expandScriptNames({ a: 'pnpm run ghost' }, 'a'), ['a']);
	});

	it('reads only a single, complete `pnpm run <script>` command', () => {
		assert.equal(scriptNameOfCommand('pnpm run secret:scan'), 'secret:scan');
		assert.equal(scriptNameOfCommand('pnpm run secret:scan -- --report x.html'), null);
		assert.equal(scriptNameOfCommand('node scripts/x.mjs'), null);
		assert.equal(scriptNameOfCommand(undefined), null);
	});
});

describe('quality profile reader', () => {
	it('reads the component list of each level and stops at the next top-level key', () => {
		const text = [
			'gates:',
			'  fast:',
			"    command: 'pnpm run validate:fast'",
			'    components:',
			"      - 'pnpm run format:check' # biome",
			"      - 'pnpm run lint:check'",
			'    cost_class: cheap',
			'  integration:',
			'    components:',
			'      - fast',
			"      - 'pnpm run build'",
			'  release:',
			'    components:',
			"      - 'pnpm run cf-typegen:check'",
			'ci:',
			'  workflow: .github/workflows/ci.yml',
			"      - 'pnpm run e2e'",
		].join('\n');
		const parsed = parseProfileComponents(text);
		assert.deepEqual(parsed.fast, ['pnpm run format:check', 'pnpm run lint:check']);
		assert.deepEqual(parsed.integration, ['pnpm run build']);
		assert.deepEqual(parsed.release, ['pnpm run cf-typegen:check']);
	});
});

describe('workflow reader', () => {
	const text = [
		'jobs:',
		'  validate:',
		'    steps:',
		'      - run: pnpm install --frozen-lockfile',
		'      - name: head-ref policy check',
		'        run: |',
		'          if ! [[ "$HEAD_REF" =~ ^release- ]]; then',
		'            exit 1',
		'          fi',
		'      - run: pnpm run validate:integration',
		'  other:',
		'    steps:',
		'      - run: pnpm run deploy:production',
	].join('\n');

	it('collects both run spellings and stops at the next job', () => {
		const commands = parseWorkflowJobRunCommands(text, CI_JOB);
		assert.ok(commands.includes('pnpm run validate:integration'));
		assert.ok(commands.includes('pnpm install --frozen-lockfile'));
		assert.ok(commands.includes('exit 1'));
		assert.ok(!commands.some((command) => command.includes('deploy:production')));
	});

	it('resolves the ci surface from the workflow plus package.json', () => {
		const surfaces = collectSurfaces({ scripts: SCRIPTS, workflowText: text });
		assert.ok(surfaces.ci.has('validate:integration'));
		assert.ok(surfaces.ci.has('secret:scan'));
	});
});

describe('a required inspection the release does not run', () => {
	it('fails instead of reporting the row as a pass', () => {
		const result = evaluate({ omit: 'secret:scan' });
		const row = rowOf(result, 'secret-scan-source');
		assert.equal(row.status, 'not_run');
		assert.deepEqual(row.missing_surfaces, ['fast', 'integration', 'release']);
		assert.equal(rowOf(result, 'lint-baseline').status, 'pass');
		assert.equal(result.summary.pass, 2);
		assert.equal(result.summary.not_run, 1);
		assert.ok(
			result.errors.some(
				(error) =>
					error.includes('required check "secret-scan-source" is not run') &&
					error.includes('not reachable from fast, integration, release'),
			),
		);
	});

	it('fails when a protected row is deleted instead of run', () => {
		const result = evaluate({ checks: [], protectedIds: ['secret-scan-source'] });
		assert.ok(
			result.errors.some(
				(error) =>
					error.includes('"secret-scan-source" is protected but has no row') &&
					error.includes('deleting a required check row fails here on purpose'),
			),
		);
	});

	it('fails when a protected row is quietly relaxed to optional', () => {
		const result = evaluate({
			checks: [check({ required: false }), otherCheck()],
			protectedIds: ['secret-scan-source'],
		});
		assert.ok(
			result.errors.some((error) => error.includes('a protected check must stay required')),
		);
	});

	it('fails when a protected row is reclassified as not applicable', () => {
		const result = evaluate({
			checks: [
				check({
					state: 'not_applicable',
					surfaces: [],
					reason: 'The inspection was retired without a replacement decision.',
				}),
				otherCheck(),
			],
			protectedIds: ['secret-scan-source'],
		});
		assert.ok(result.errors.some((error) => error.includes('cannot become not_applicable')));
	});

	it('fails when a required row declares no surface at all', () => {
		const result = evaluate({ checks: [check({ surfaces: [] }), otherCheck()] });
		assert.ok(
			result.errors.some((error) => error.includes('must declare the surfaces it runs on')),
		);
	});
});

describe('the other three statuses', () => {
	it('marks an unregistered command `fail`, not `not run`', () => {
		const scripts = { ...SCRIPTS, 'secret:scan': undefined };
		const result = evaluate({
			scripts,
			checks: [check(), otherCheck()],
			profileComponents: { ...PROFILE, fast: ['pnpm run lint:check'] },
		});
		assert.equal(rowOf(result, 'secret-scan-source').status, 'fail');
		assert.ok(
			result.errors.some((error) =>
				error.includes('"secret:scan" is not registered in package.json#scripts'),
			),
		);
	});

	it('marks a command whose runner file is gone `fail`', () => {
		const result = evaluate({ files: [] });
		assert.equal(rowOf(result, 'secret-scan-source').status, 'fail');
		assert.ok(
			result.errors.some((error) =>
				error.includes('runner file(s) not on disk: scripts/scan-secrets.mjs'),
			),
		);
	});

	it('marks a command no surface runs `not_run` without failing the release', () => {
		const result = evaluate({
			checks: [check(), otherCheck({ required: false, surfaces: [] })],
			profileComponents: PROFILE,
		});
		const row = rowOf(result, 'lint-baseline');
		assert.equal(row.status, 'not_run');
		assert.match(row.note, /no release surface runs it/);
		assert.deepEqual(result.errors, []);
	});

	it('requires a reason on a not_applicable row and never counts it as a pass', () => {
		const placeholder = evaluate({
			checks: [check(), notApplicableCheck({ reason: 'tbd' })],
			profileComponents: PROFILE,
		});
		assert.ok(
			placeholder.errors.some((error) => error.includes('must record why it does not apply')),
		);
		assert.equal(rowOf(placeholder, 'lint-baseline').status, 'not_applicable');
		assert.equal(placeholder.summary.not_applicable, 1);

		const reasoned = evaluate({
			checks: [
				check(),
				notApplicableCheck({
					reason: 'No staging or preview origin exists to point a scanner at.',
				}),
			],
			profileComponents: PROFILE,
		});
		assert.deepEqual(reasoned.errors, []);
		assert.equal(reasoned.summary.not_applicable, 1);
		assert.equal(rowOf(reasoned, 'lint-baseline').status, 'not_applicable');
	});

	it('refuses a command on a not_applicable row', () => {
		const result = evaluate({
			checks: [
				check(),
				notApplicableCheck({
					command: 'pnpm run lint:check',
					reason: 'No scan target exists for this repository in this Issue.',
				}),
			],
			profileComponents: PROFILE,
		});
		assert.ok(result.errors.some((error) => error.includes('carries no command')));
	});
});

describe('the quality profile stays in agreement with the chain', () => {
	it('fails on a component with no package.json script (phantom step)', () => {
		const result = evaluate({
			profileComponents: { ...PROFILE, fast: [...PROFILE.fast, 'pnpm run ghost:check'] },
		});
		assert.ok(result.errors.some((error) => error.includes('a phantom step')));
	});

	it('fails on a component the entry point no longer reaches', () => {
		const result = evaluate({ omit: 'secret:scan' });
		assert.ok(result.errors.some((error) => error.includes('never reaches it')));
	});

	it('accepts a component reached through the recorded equivalence, and fails when that path is gone', () => {
		const profileComponents = {
			...PROFILE,
			integration: ['pnpm run secret:scan:bundle'],
			release: ['pnpm run secret:scan'],
		};
		const viaFast = evaluate({
			omit: 'secret:scan:bundle',
			checks: [check()],
			protectedIds: ['secret-scan-source'],
			profileComponents,
			profileEquivalences: [
				{
					surface: 'integration',
					component: 'pnpm run secret:scan:bundle',
					reached_via: 'validate:fast',
				},
			],
		});
		assert.deepEqual(viaFast.errors, []);

		const broken = evaluate({
			omit: 'secret:scan:bundle',
			checks: [check()],
			protectedIds: ['secret-scan-source'],
			profileComponents,
			profileEquivalences: [
				{
					surface: 'integration',
					component: 'pnpm run secret:scan:bundle',
					reached_via: 'dep-audit:check',
				},
			],
		});
		assert.ok(
			broken.errors.some(
				(error) => error.includes('never reaches it') && error.includes('is gone too'),
			),
		);
	});

	it('treats a `- fast` level reference as a reference, not a step', () => {
		const result = evaluate();
		assert.ok(result.profileComponents.integration.includes('- fast'));
		assert.deepEqual(result.errors, []);
	});
});

describe('a security-family command with no ledger row', () => {
	it('is reported as unaccounted rather than silently passing', () => {
		const result = evaluateReleaseGate({
			manifest: {
				version: 1,
				protected_checks: ['secret-scan-source'],
				checks: [check()],
			},
			scripts: SCRIPTS,
			surfaces: collectSurfaces({ scripts: SCRIPTS }),
			fileExists: (path) => FILES.includes(path),
		});
		assert.deepEqual(result.unaccounted, ['secret:scan:bundle']);
		assert.equal(result.warnings.length, 1);
		assert.match(result.warnings[0], /secret:scan:bundle/);
		// A warning, never a release blocker: the roster is a curated report.
		assert.deepEqual(result.errors, []);
	});
});

describe('ledger shape', () => {
	it('fails closed on an empty roster, an empty protected list or a wrong version', () => {
		const result = evaluateReleaseGate({
			manifest: { version: 2, protected_checks: [], checks: [] },
			scripts: SCRIPTS,
			surfaces: collectSurfaces({ scripts: SCRIPTS }),
		});
		assert.ok(result.errors.some((error) => error.includes('`version` must be 1')));
		assert.ok(result.errors.some((error) => error.includes('at least one check')));
		assert.ok(result.errors.some((error) => error.includes('at least one id must be protected')));
	});

	it('rejects a duplicate id, a placeholder contract and an unknown surface', () => {
		const result = evaluate({
			checks: [
				check(),
				otherCheck(),
				otherCheck({ id: 'third-check', contract: 'tbd', surfaces: ['staging'] }),
				otherCheck(),
			],
			protectedIds: ['secret-scan-source', 'lint-baseline'],
		});
		assert.ok(result.errors.some((error) => error.includes('duplicate id')));
		assert.ok(result.errors.some((error) => error.includes('a real sentence')));
		assert.ok(
			result.errors.some((error) => error.includes('not in {fast, integration, release, ci}')),
		);
	});
});

describe('the on-disk fixtures (normal and abnormal)', () => {
	const names = readdirSync(join(REPO_ROOT, FIXTURE_DIR))
		.filter((name) => name.endsWith('.json'))
		.map((name) => name.replace(/\.json$/, ''))
		.sort();

	it('ships at least one normal and one abnormal fixture', () => {
		assert.ok(names.includes('pass'));
		assert.ok(names.includes('missing-required-check'));
		assert.ok(names.includes('unregistered-command'));
	});

	for (const name of names) {
		it(`${name} fixture resolves exactly as it declares`, () => {
			const fixture = loadFixture(REPO_ROOT, name);
			const result = evaluateFixture(fixture);
			assert.equal(result.errors.length, fixture.expect.errors);
			assert.equal(result.warnings.length, fixture.expect.warnings);
			assert.deepEqual(result.summary, fixture.expect.summary);
		});
	}

	it('the missing-check fixture names the omitted inspection instead of passing', () => {
		const result = evaluateFixture(loadFixture(REPO_ROOT, 'missing-required-check'));
		assert.ok(
			result.errors.some(
				(error) => error.includes('secret-scan-source') && error.includes('is not run'),
			),
		);
		assert.equal(result.summary.pass, 2);
	});

	it('the report probes are all on disk', () => {
		for (const name of PROBE_FIXTURES) {
			assert.ok(names.includes(name), `${name}.json must exist`);
		}
	});
});

describe('the real repository', () => {
	const result = checkReleaseGateCoverage({ root: REPO_ROOT });

	it('has no gate error, so the release ledger is complete today', () => {
		assert.deepEqual(result.errors, []);
	});

	it('keeps every protected check implemented, required and run', () => {
		const protectedIds = result.manifest.protected_checks;
		assert.ok(protectedIds.length > 0);
		for (const id of protectedIds) {
			const row = rowOf(result, id);
			assert.ok(row, `${id} must exist in ${DEFAULT_MANIFEST_PATH}`);
			assert.equal(row.state, 'implemented');
			assert.equal(row.required, true);
			assert.equal(row.status, 'pass', `${id} must be run, not ${row.status}`);
		}
	});

	it('classifies every row into one of the four statuses and never counts N/A as a pass', () => {
		const total = Object.values(result.summary).reduce((sum, count) => sum + count, 0);
		assert.equal(total, result.rows.length);
		assert.ok(result.rows.length >= 20);
		assert.ok(result.summary.not_applicable > 0);
		assert.ok(result.rows.some((row) => row.status === 'not_run'));
		for (const row of result.rows.filter((candidate) => candidate.status === 'not_applicable')) {
			assert.ok(row.note.length >= 20, `${row.id} needs a real reason`);
		}
	});

	it('documents every required row with a repository path', () => {
		for (const row of result.rows.filter((candidate) => candidate.required)) {
			assert.match(row.documentation ?? '', /^(docs|e2e|quality)\//, `${row.id}`);
		}
	});
});

describe('the report the screenshot is taken from', () => {
	it('renders every row, all four statuses and both probes', () => {
		const result = checkReleaseGateCoverage({ root: REPO_ROOT });
		const probes = PROBE_FIXTURES.map((name) => {
			const fixture = loadFixture(REPO_ROOT, name);
			return { name, note: fixture.note, ...evaluateFixture(fixture) };
		});
		const html = renderReport({
			manifest: result.manifest,
			result,
			probes,
			sourceSha: '000000000000',
		});
		for (const row of result.rows) assert.ok(html.includes(row.id), `${row.id} missing`);
		for (const probe of probes) assert.ok(html.includes(`release-gate/${probe.name}.json`));
		for (const status of ['pass', 'fail', 'not run', 'N/A']) {
			assert.ok(html.includes(status), `status label ${status} missing`);
		}
	});
});
