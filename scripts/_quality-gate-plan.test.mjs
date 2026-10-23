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
import { buildPlan, main, runPlan, successLine } from './run-quality-gates.mjs';

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

/**
 * The fast plan pinned as of Issue #566, one command per line.
 *
 * It is the merge-base `validate:fast` `&&` chain (43 steps) with the two
 * explicit `node --test scripts/check-{release-assets,app-icons}.test.mjs`
 * steps folded into `pnpm run test`, and the two raw node calls replaced
 * by their existing npm-script aliases (41 steps). The whole list is
 * compared, so a dropped or reordered component fails instead of only
 * breaking one of five spot-checked orderings.
 *
 * Issue #477 adds one line here with its gate: `secrets:status:check`,
 * declared in `quality/profile.yaml` right after
 * `infisical:check:coverage`; Issue #478 (`security:disclosure:check`)
 * and Issue #464 (`integration:scope:check`) add theirs on the release
 * trunk, so the reconciled pin holds 44 components — one per declared
 * `gates.fast.components` entry, in the same order. The pin keeps its
 * job (a dropped or moved
 * component still fails); a new gate is still one line in the profile
 * plus one line here.
 */
const EXPECTED_FAST_PLAN = [
	'pnpm run format:check',
	'pnpm run lint:check',
	'pnpm run architecture:check',
	'pnpm run log:redaction:check',
	'pnpm run structured-data:check',
	// Issue #621: the offline project-introduction contract reads the
	// committed snapshot the same way the structured-data gate reads its
	// contract, so it runs next to it.
	'pnpm run projects:check',
	'pnpm run ogp:card:check',
	'pnpm run index:boundary:check',
	'pnpm run tools:check',
	'pnpm run install:scripts:check',
	'pnpm run wrangler:independence:check',
	'pnpm run cloudflare:contract:check',
	// Issue #480: the drift gate runs immediately after the binding
	// contract it extends, so a drift finding is read next to the contract
	// finding rather than at the end of the chain.
	'pnpm run cf:config:drift:check',
	'pnpm run test:wiring:check',
	'pnpm run release:assets:check',
	'pnpm run version:check',
	'pnpm run typecheck',
	'pnpm run infisical:check:coverage',
	'pnpm run secrets:status:check',
	'pnpm run sbom:check',
	'pnpm run csrf:contract:check',
	'pnpm run compat:check',
	'pnpm run tools:provenance:check',
	'pnpm run storybook:ownership:check',
	'pnpm run copy:i18n:check',
	// Issue #437: the owner review-date gate for the time-sensitive
	// public copy. It runs right after the copy locale contract, so a
	// review-pending finding is read next to the other copy findings.
	'pnpm run copy:stale:check',
	'pnpm run publication:check',
	'pnpm run content:links:check',
	'pnpm run publication:redaction:check',
	'pnpm run routes:quality:check',
	'pnpm run security:headers:check',
	'pnpm run security:disclosure:check',
	'pnpm run asvs:check',
	'pnpm run html:standards:check',
	'pnpm run i18n:policy:check',
	'pnpm run test',
	'pnpm run seo:status:check',
	'pnpm run ci:pins:check',
	'pnpm run knip:check',
	'pnpm run secret:scan',
	'pnpm run a11y:reduced-motion:check',
	// Issue #396: the icon-button accessible-name contract, declared in
	// `quality/profile.yaml` right after the reduced-motion gate.
	'pnpm run a11y:icon-button-names:check',
	'pnpm run a11y:table:code:check',
	'pnpm run a11y:image-alt:check',
	'pnpm run a11y:language-of-parts:check',
	// Issue #398: the heading-outline / landmark contract. It runs
	// right after the other `a11y` contracts, so an outline finding is
	// read next to the other accessibility findings.
	'pnpm run a11y:heading-landmarks:check',
	'pnpm run css:check',
	// Issue #399: the colour-contrast AA contract. It runs right after the
	// CSS gate, because both read the shipped token / stylesheet layer.
	'pnpm run a11y:contrast:check',
	// Issue #405: the live-region / status-message contract, declared in
	// `quality/profile.yaml` right after the contrast gate.
	'pnpm run a11y:live-region:check',
	// Issue #395: the focus visibility / focus-not-obscured contract. It
	// runs right after the colour gate, because both read the shipped
	// source and the shipped stylesheet.
	'pnpm run a11y:focus-visible:check',
	'pnpm run app:icons:check',
	'pnpm run threat:model:check',
	'pnpm run release:gate:check',
	'pnpm run integration:scope:check',
	'pnpm run tools:artifact:check',
	'pnpm run assets:license:check',
];

describe('runPlan', () => {
	it('reports a signal-killed step as 128 + signal, like the old shell chain', () => {
		const output = [];
		const code = runPlan(['kill -TERM $$'], { stream: { write: (line) => output.push(line) } });
		assert.equal(code, 143, 'SIGTERM is 15, so the shell chain exited 143');
		assert.match(output.join(''), /\[1\/1\] kill -TERM \$\$/);
	});
});

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

	it('rejects a backgrounded command and command substitution', () => {
		for (const component of [
			'pnpm run secret:scan & pnpm run knip:check',
			'pnpm run secret:scan; pnpm run knip:check',
			'node scripts/report.mjs `git rev-parse HEAD`',
			'node scripts/report.mjs $(git rev-parse HEAD)',
		]) {
			assert.deepEqual(validateGateComponents([component], []), [
				`one line must be one command: ${component}`,
			]);
		}
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

	it('runs each gate through the exact one-line runner script, not a chain', () => {
		for (const gate of GATE_NAMES) {
			assert.equal(gates[gate].command, `pnpm run validate:${gate}`);
			assert.equal(
				pkg.scripts[`validate:${gate}`],
				`node scripts/run-quality-gates.mjs ${gate}`,
				`validate:${gate} must be exactly the runner in run mode`,
			);
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

	it('runs the historical validate:fast chain, gate for gate, in order', () => {
		// The historical one-line chain is the order criterion 5 protects.
		// Compare the WHOLE list: five relative orderings would not notice a
		// dropped publication / release-asset / app-icons component or a
		// component moved away from its merge-base position.
		assert.deepEqual(plan('fast'), EXPECTED_FAST_PLAN);
		// Pin the tail explicitly: `tools:artifact:check` landed at the END of
		// the merge-base chain (after `release:gate:check`), so the failure
		// path stops after every other fast gate exactly as it used to. A
		// gate added later keeps that merge-base step in place and lands
		// beside it, so every historical step keeps the position — and
		// therefore the failure path — it already had: Issue #464 added
		// `integration:scope:check` BEFORE that merge-base tail, Issue #497
		// added `assets:license:check` AFTER it.
		assert.deepEqual(plan('fast').slice(-4), [
			'pnpm run release:gate:check',
			'pnpm run integration:scope:check',
			'pnpm run tools:artifact:check',
			'pnpm run assets:license:check',
		]);
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

	it('refuses usage errors and never lets --list replace a gate run', () => {
		assert.equal(main(['smoke']), 2, 'an unknown gate is a usage error');
		assert.equal(main(['fast', '--nope']), 2, 'an unknown option is a usage error');
		assert.equal(
			main(['fast', '--list'], { lifecycleEvent: undefined }),
			0,
			'a direct diagnostic listing succeeds',
		);
		for (const lifecycleEvent of ['validate:fast', 'validate:integration', 'validate:release']) {
			assert.equal(
				main(['fast', '--list'], { lifecycleEvent }),
				2,
				`${lifecycleEvent} must run the plan, never print it`,
			);
		}
	});
});
