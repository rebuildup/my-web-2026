import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	GATE_NAMES,
	PROFILE_RELATIVE_PATH,
	parseGateProfile,
	planForGate,
	resolveGatePlan,
	scriptNamesOf,
	validateGateComponents,
} from './_quality-gate-plan.mjs';
import { buildPlan, main, successLine } from './run-quality-gates.mjs';

/**
 * Fixture coverage for the declared quality-gate plan (Issue #566).
 *
 * The parser is only worth having if it fails closed: a gate roster
 * that silently drops a line would run less validation while still
 * printing "OK". So the fixtures plant each unsupported shape and
 * assert the refusal, and the last block checks the real repository —
 * the plan that `pnpm run validate:fast` will actually execute.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER_RELATIVE_PATH = 'scripts/run-quality-gates.mjs';

const FIXTURE_PROFILE = `# header comment
schema_version: 1

gates:
  fast:
    command: 'pnpm run validate:fast'
    components:
      # a comment line inside the list
      - 'pnpm run format:check' # biome format (read-only)
      - 'node scripts/check-release-assets.mjs'
    cost_class: cheap
    trigger: local + every CI run

  integration:
    command: 'pnpm run validate:integration'
    components:
      - fast
      - 'pnpm run build:production'
    cost_class: medium
    trigger: pull_request

  release:
    command: 'pnpm run validate:release'
    components:
      - integration
      - 'pnpm run cf-typegen:check'
    cost_class: medium
    trigger: push_to_main_and_release

change_risk_mapping:
  doc_only:
    gate: fast
`;

describe('parseGateProfile', () => {
	it('reads the gates block, ignoring the rest of the document', () => {
		const { gates } = parseGateProfile(FIXTURE_PROFILE);
		assert.deepEqual(GATE_NAMES, Object.keys(gates));
		assert.deepEqual(gates.fast.components, [
			'pnpm run format:check',
			'node scripts/check-release-assets.mjs',
		]);
		assert.equal(gates.fast.cost_class, 'cheap');
		assert.equal(gates.fast.command, 'pnpm run validate:fast');
		assert.deepEqual(gates.integration.components, ['fast', 'pnpm run build:production']);
	});

	it('refuses an unknown gate rather than skipping it', () => {
		const profile = FIXTURE_PROFILE.replace('  integration:', '  smoke:');
		assert.throws(() => parseGateProfile(profile), /unknown gate "smoke"/);
	});

	it('refuses an unknown key inside a gate', () => {
		const profile = FIXTURE_PROFILE.replace('    cost_class: cheap', '    allowed_patterns:');
		assert.throws(() => parseGateProfile(profile), /unsupported key "allowed_patterns"/);
	});

	it('refuses tab indentation', () => {
		const profile = FIXTURE_PROFILE.replace('  fast:', '\tfast:');
		assert.throws(() => parseGateProfile(profile), /tab indentation/);
	});

	it('refuses an unterminated quoted value', () => {
		const profile = FIXTURE_PROFILE.replace(
			"'pnpm run build:production'",
			"'pnpm run build:production",
		);
		assert.throws(() => parseGateProfile(profile), /unterminated quoted value/);
	});

	it('refuses a list item that is not a command', () => {
		const profile = FIXTURE_PROFILE.replace(
			"      - 'node scripts/check-release-assets.mjs'",
			'      fast',
		);
		assert.throws(() => parseGateProfile(profile), /expected a "- <command>" list item/);
	});

	it('refuses a profile that declares no gate at all', () => {
		assert.throws(() => parseGateProfile('schema_version: 1\n'), /gates.fast is missing/);
	});

	it('refuses a gate with an empty component list', () => {
		const empty = FIXTURE_PROFILE.replace(
			[
				'      # a comment line inside the list',
				"      - 'pnpm run format:check' # biome format (read-only)",
				"      - 'node scripts/check-release-assets.mjs'",
				'',
			].join('\n'),
			'',
		);
		assert.throws(() => parseGateProfile(empty), /gates.fast.components is empty/);
	});
});

describe('resolveGatePlan', () => {
	const { gates } = parseGateProfile(FIXTURE_PROFILE);

	it('expands a composed gate in place, keeping declared order', () => {
		assert.deepEqual(resolveGatePlan(gates, 'integration'), [
			'pnpm run format:check',
			'node scripts/check-release-assets.mjs',
			'pnpm run build:production',
		]);
		assert.deepEqual(resolveGatePlan(gates, 'release'), [
			...resolveGatePlan(gates, 'integration'),
			'pnpm run cf-typegen:check',
		]);
	});

	it('keeps a repeated component instead of de-duplicating it', () => {
		const duplicated = parseGateProfile(
			FIXTURE_PROFILE.replace(
				"      - integration\n      - 'pnpm run cf-typegen:check'",
				"      - integration\n      - 'pnpm run cf-typegen:check'\n      - 'pnpm run cf-typegen:check'",
			),
		);
		assert.equal(
			resolveGatePlan(duplicated.gates, 'release').filter((c) => c === 'pnpm run cf-typegen:check')
				.length,
			2,
		);
	});

	it('refuses an unknown gate and a composition cycle', () => {
		assert.throws(() => resolveGatePlan(gates, 'smoke'), /unknown gate "smoke"/);
		const cyclic = parseGateProfile(
			FIXTURE_PROFILE.replace('      - integration', '      - release'),
		);
		assert.throws(() => resolveGatePlan(cyclic.gates, 'release'), /gate composition cycle/);
	});
});

describe('validateGateComponents', () => {
	it('accepts a known script and a raw command', () => {
		assert.deepEqual(validateGateComponents(['pnpm run test', 'node scripts/x.mjs'], ['test']), []);
	});

	it('rejects a pnpm run of a script that does not exist', () => {
		assert.deepEqual(validateGateComponents(['pnpm run test:nope'], ['test']), [
			'no such npm script: pnpm run test:nope (in "pnpm run test:nope")',
		]);
	});

	it('accepts trailing arguments after the script name', () => {
		const known = ['dep-audit:check'];
		assert.deepEqual(
			validateGateComponents(['pnpm run dep-audit:check -- --report x.html'], known),
			[],
		);
	});

	it('rejects a line that chains several commands', () => {
		assert.deepEqual(validateGateComponents(['pnpm run test && pnpm run typecheck'], []), [
			'one line must be one command: pnpm run test && pnpm run typecheck',
		]);
	});
});

describe('the repository plan', () => {
	const profileText = readFileSync(join(REPO_ROOT, PROFILE_RELATIVE_PATH), 'utf8');
	const packageJsonText = readFileSync(join(REPO_ROOT, 'package.json'), 'utf8');
	const pkg = JSON.parse(packageJsonText);
	const { gates } = parseGateProfile(profileText);
	const plan = (gate) => resolveGatePlan(gates, gate);

	it('declares every pnpm run component against a script that exists', () => {
		for (const gate of GATE_NAMES) {
			const { problems } = planForGate({ profileText, packageJsonText, gateName: gate });
			assert.deepEqual(problems, [], `gates.${gate} declares an unrunnable component`);
		}
	});

	it('runs each gate through the one-line runner script, not a chain', () => {
		for (const gate of GATE_NAMES) {
			assert.equal(gates[gate].command, `pnpm run validate:${gate}`);
			const value = String(pkg.scripts[`validate:${gate}`]);
			assert.ok(
				value.includes(`${RUNNER_RELATIVE_PATH} ${gate}`),
				`validate:${gate} must delegate to the runner: ${value}`,
			);
			assert.equal(value.split('&&').length, 1, 'the entry point must be a single command');
		}
		assert.equal(successLine('fast', 3), '\nvalidate:fast OK — 3 declared step(s)\n');
	});

	it('keeps the integration gate a superset of the fast gate, in order', () => {
		assert.deepEqual(plan('integration').slice(0, plan('fast').length), plan('fast'));
	});

	it('keeps the release gate a superset of the integration gate', () => {
		const integration = plan('integration');
		const release = plan('release');
		assert.deepEqual(release.slice(0, integration.length), integration);
		assert.deepEqual(release.slice(integration.length), ['pnpm run cf-typegen:check']);
	});

	it('runs the cheap policy gates, typecheck and the test suite inside fast', () => {
		for (const component of [
			'pnpm run format:check',
			'pnpm run lint:check',
			'pnpm run architecture:check',
			'pnpm run test:wiring:check',
			'pnpm run typecheck',
			'pnpm run test',
			'pnpm run secret:scan',
			'pnpm run knip:check',
		]) {
			assert.ok(plan('fast').includes(component), `gates.fast must still run ${component}`);
		}
	});

	it('re-declares every script the validate:fast chain used to name', () => {
		// The historical one-line chain, read from the released profile,
		// is the order criterion 5 protects: the plan must still run
		// these commands in this order.
		const released = planForGate({
			profileText,
			packageJsonText,
			gateName: 'fast',
		}).plan;
		const indexOf = (component) => {
			const index = released.indexOf(component);
			assert.notEqual(index, -1, `${component} is missing from gates.fast`);
			return index;
		};
		assert.ok(indexOf('pnpm run format:check') < indexOf('pnpm run lint:check'));
		assert.ok(indexOf('pnpm run lint:check') < indexOf('pnpm run architecture:check'));
		assert.ok(indexOf('pnpm run architecture:check') < indexOf('pnpm run typecheck'));
		assert.ok(indexOf('pnpm run typecheck') < indexOf('pnpm run test'));
		assert.ok(indexOf('pnpm run test') < indexOf('pnpm run secret:scan'));
	});

	it('lists the same plan the runner would execute', () => {
		const listed = execFileSync(
			process.execPath,
			[join(REPO_ROOT, RUNNER_RELATIVE_PATH), 'fast', '--list'],
			{ cwd: REPO_ROOT, encoding: 'utf8' },
		)
			.trim()
			.split('\n')
			.map((line) => line.split('\t')[1]);
		assert.deepEqual(listed, plan('fast'));
		assert.deepEqual(buildPlan('fast').plan, plan('fast'));
	});

	it('exposes the npm scripts of the manifest it validates', () => {
		assert.ok(scriptNamesOf(pkg).includes('validate:fast'));
		assert.deepEqual(scriptNamesOf({}), []);
	});

	it('refuses usage errors and prints the plan for --list', () => {
		assert.equal(main(['smoke']), 2, 'an unknown gate is a usage error');
		assert.equal(main(['fast', '--nope']), 2, 'an unknown option is a usage error');
		assert.equal(main(['fast', '--list']), 0, 'listing runs nothing and succeeds');
	});
});
