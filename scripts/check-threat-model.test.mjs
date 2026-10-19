import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	DEFAULT_MANIFEST_PATH,
	FIXTURE_DIR,
	PROBE_FIXTURES,
	STRIDE_CATEGORIES,
	ZONE_ORDER,
	checkThreatModel,
	evaluateFixture,
	evaluateThreatModel,
	loadFixture,
	referencedScriptNames,
	releaseSurfaceScripts,
	renderReport,
	scriptRunnerFiles,
	unknownKeys,
} from './check-threat-model.mjs';

/**
 * Fixture coverage for the per-capability threat model ledger (Issue #479).
 *
 * The gate is only worth running if it fails when it should, and Issue
 * #479's two hard conditions are both negative: a capability must not be
 * able to claim an attack surface the repository does not contain, and
 * nothing may make a production credential part of the model. So the
 * first fixtures are exactly those two failures — a mitigation that cites
 * a file nobody shipped, and an asset source written as a value — plus a
 * live capability whose threat nobody owns. The rest pin the individual
 * rules, and the last case runs the gate against the real repository so
 * a regression in the scanner cannot become a silent no-op.
 *
 * The on-disk fixtures in `quality/fixtures/threat-model/` are the same
 * ones `scripts/make-threat-model-report.mjs` renders as the report's
 * false-green probe, so the committed screenshot and this suite cannot
 * disagree.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A miniature release chain plus the gate the fixture world registers. */
const SCRIPTS = {
	'validate:fast': 'pnpm run lint:check && pnpm run fixture:check',
	'lint:check': 'biome lint .',
	'fixture:check': 'node scripts/fixture-gate.mjs',
	'validate:integration': 'pnpm run validate:fast && pnpm run build',
	build: 'vite build',
	'validate:release': 'pnpm run validate:integration',
};

/** The `pass` fixture's world, re-read so a test can mutate one field. */
function passWorld() {
	const fixture = loadFixture(REPO_ROOT, 'pass');
	return { manifest: fixture.manifest, scripts: fixture.scripts, files: fixture.files };
}

/**
 * The `pass` world plus a second, `deferred` capability with its own gate
 * and an unowned threat whose hand-work is written down — the state a
 * capability that is built but not shipped is allowed to be in.
 */
function worldWithDeferredCapability() {
	const world = passWorld();
	const deferred = structuredClone(world.manifest.capabilities[0]);
	deferred.id = 'fixture-deferred';
	deferred.title = 'Fixture deferred surface';
	deferred.status = 'deferred';
	deferred.summary =
		'A second synthetic feature unit that is built but not shipped, so its threat may stay unowned as long as the work is written down.';
	deferred.boundaries[0].controls = [{ kind: 'gate', ref: 'scripts/fixture-deferred-gate.mjs' }];
	deferred.boundaries[1].controls = [
		{ kind: 'test', ref: 'test/integration/csrf-contract.test.ts' },
	];
	deferred.threats[0].id = 'fixture-deferred-forgery';
	deferred.threats[0].mitigations = [
		{
			ref: 'scripts/fixture-deferred-gate.mjs',
			kind: 'gate',
			state: 'planned',
			note: 'The gate for the deferred surface has not been written yet, so the threat stays unowned on purpose.',
		},
	];
	deferred.threats[0].follow_up =
		'Decide whether the deferred surface is shipped before the gate that owns its threat exists.';
	world.files.push('scripts/fixture-deferred-gate.mjs');
	world.scripts['fixture:check:deferred'] = 'node scripts/fixture-deferred-gate.mjs';
	world.manifest.capabilities.push(deferred);
	world.manifest.control_registry.push({
		command: 'fixture:check:deferred',
		ref: 'scripts/fixture-deferred-gate.mjs',
		capabilities: ['fixture-deferred'],
		contract:
			'The second gate exists only so a deferred capability can be claimed by a command of its own.',
	});
	return world;
}

function evaluate(world) {
	const files = new Set(world.files ?? []);
	return evaluateThreatModel({
		manifest: world.manifest,
		scripts: world.scripts ?? SCRIPTS,
		fileExists: (path) => files.has(path),
	});
}

describe('the real repository is a complete ledger', () => {
	it('has no error against the working tree', () => {
		const result = checkThreatModel({ root: REPO_ROOT, manifestPath: DEFAULT_MANIFEST_PATH });
		assert.deepEqual(result.errors, [], result.errors.join('\n'));
		assert.ok(result.capabilities.length >= 5, 'the ledger must model the shipped feature units');
		assert.equal(
			result.summary.uncovered,
			0,
			'a shipped capability may not carry an uncovered threat',
		);
	});

	it('models every threat as covered and every boundary as reviewable', () => {
		const result = checkThreatModel({ root: REPO_ROOT });
		for (const capability of result.capabilities) {
			assert.ok(capability.review_items.length >= 2, `${capability.id} needs review items`);
			assert.ok(
				capability.review_items.every((item) => item.trim().endsWith('?')),
				`${capability.id}: a review item is a question`,
			);
			for (const threat of capability.threats) {
				assert.equal(threat.status, 'covered', `${capability.id}/${threat.id}`);
			}
		}
	});

	it('resolves the diagram capability the report draws', () => {
		const result = checkThreatModel({ root: REPO_ROOT });
		const diagram = result.capabilities.find(
			(row) => row.id === result.manifest.diagram_capability,
		);
		assert.ok(diagram, 'the ledger names a capability for the diagram');
		assert.ok(diagram.nodes.length >= 3, 'a trust boundary needs at least one zone on each side');
		assert.ok(ZONE_ORDER.includes(diagram.nodes[0].zone));
	});
});

describe('the on-disk fixtures are the report probe', () => {
	for (const name of PROBE_FIXTURES) {
		it(`renders ${name} from the same evaluator`, () => {
			const fixture = loadFixture(REPO_ROOT, name);
			const result = evaluateFixture(fixture);
			const expected = name === 'pass' ? 0 : 1;
			assert.equal(
				result.errors.length === 0,
				expected === 0,
				`${name}: ${result.errors.join(' | ')}`,
			);
		});
	}

	it('reads every fixture the report asks for', () => {
		assert.deepEqual(PROBE_FIXTURES, [
			'pass',
			'missing-evidence',
			'unowned-threat',
			'secret-literal',
		]);
		assert.equal(FIXTURE_DIR, 'quality/fixtures/threat-model');
	});
});

describe('a threat nobody shipped is not a mitigation', () => {
	it('fails on a control and a mitigation that point at a missing file', () => {
		const world = passWorld();
		const capability = world.manifest.capabilities[0];
		capability.threats[0].mitigations[0].ref = 'test/integration/deleted-gate.test.ts';
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /does not exist on disk/);
	});

	it('fails on a node that claims a place the repository does not contain', () => {
		const world = passWorld();
		world.manifest.capabilities[0].nodes[1].source = 'src/http/not-a-real-module.ts';
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /nodes\[fixture-boundary\]\.source: .*does not exist on disk/);
	});

	it('fails on an asset whose source is neither a real path nor a binding name', () => {
		const world = passWorld();
		world.manifest.capabilities[0].assets[0].source_of_truth = 'the key in the vault';
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /source_of_truth: must be a path that exists on disk/);
	});
});

describe('a boundary is a boundary, not a flow', () => {
	it('fails when an edge touches no boundary zone', () => {
		const world = passWorld();
		const capability = world.manifest.capabilities[0];
		capability.boundaries[0].to = 'fixture-log';
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /touches no `boundary` node/);
	});

	it('fails when an untrusted or trusted node crosses nothing', () => {
		const world = passWorld();
		world.manifest.capabilities[0].boundaries.pop();
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /nodes\[fixture-log\]: a `trusted` node that no trust boundary crosses/);
	});

	it('accepts an edge that does cross the boundary zone', () => {
		const world = passWorld();
		assert.deepEqual(evaluate(world).errors, []);
	});
});

describe('the vocabulary is closed', () => {
	it('rejects a STRIDE category the schema does not declare', () => {
		const world = passWorld();
		world.manifest.capabilities[0].threats[0].stride = 'information-integrity';
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /stride: "information-integrity" not in \{spoofing/);
		assert.equal(STRIDE_CATEGORIES.length, 6, 'STRIDE is six categories, not a wish list');
	});

	it('rejects a trust zone that is not one of the three', () => {
		const world = passWorld();
		world.manifest.capabilities[0].nodes[0].zone = 'semi-trusted';
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /zone: "semi-trusted" not in \{untrusted, boundary, trusted\}/);
	});

	it('rejects a field the shape does not declare', () => {
		const world = passWorld();
		world.manifest.capabilities[0].assets[0].value = 'anything';
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /unknown key\(s\) value/);
		assert.deepEqual(unknownKeys({ id: 'a', value: 'b' }, 'asset'), ['value']);
	});
});

describe('the secret guard', () => {
	it('fails on a credential-shaped value and never prints it', () => {
		const world = passWorld();
		// The refused value is read from the fixture rather than written
		// here: a test file that copies it would itself become a
		// credential-shaped string for `pnpm run secret:scan`, and the
		// repository's secret scanner must never need a waiver for a test.
		const value = loadFixture(REPO_ROOT, 'secret-literal').manifest.capabilities[0].assets[0]
			.source_of_truth;
		world.manifest.capabilities[0].assets[0].source_of_truth = value;
		const result = evaluate(world);
		assert.ok(
			result.errors.some((error) => error.includes('credential-shaped')),
			'the shape test must reject it',
		);
		assert.ok(
			!result.errors.some((error) => error.includes(value)),
			'the refused value must never reach the error output',
		);
	});

	it('fails on a secret-sounding name bound to a value', () => {
		const world = passWorld();
		world.manifest.policy = 'FIXTURE_API_KEY = the-plaintext-value-goes-here';
		const result = evaluate(world);
		assert.ok(result.errors.some((error) => error.includes('secret-shaped assignment')));
	});

	it('accepts a binding NAME, which is what the ledger is allowed to record', () => {
		const world = passWorld();
		assert.equal(world.manifest.capabilities[0].assets[0].source_of_truth, 'FIXTURE_API_KEY');
		assert.deepEqual(evaluate(world).errors, []);
	});
});

describe('an unowned threat on a shipped capability', () => {
	it('fails when the only mitigation is still planned work', () => {
		const world = passWorld();
		const threat = world.manifest.capabilities[0].threats[0];
		threat.mitigations[0].state = 'planned';
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /a `planned` mitigation needs the threat's `follow_up` sentence/);
		assert.match(errors, /a live capability may not carry an uncovered threat/);
	});

	it('allows a deferred capability to carry the same threat with the work written down', () => {
		const world = worldWithDeferredCapability();
		const result = evaluate(world);
		assert.deepEqual(result.errors, [], result.errors.join('\n'));
		const deferred = result.capabilities.find((row) => row.id === 'fixture-deferred');
		assert.equal(deferred.threats[0].status, 'uncovered', 'the unowned threat is still reported');
		assert.equal(result.summary.uncovered, 1, 'and it is counted as uncovered, never as covered');
	});

	it('refuses to demote a protected capability', () => {
		const world = passWorld();
		world.manifest.capabilities[0].status = 'planned';
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /a protected capability cannot become planned/);
	});

	it('fails when a protected capability row is deleted', () => {
		const world = passWorld();
		world.manifest.capabilities = [];
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /is protected but has no row/);
	});
});

describe('the control registry agrees with the model', () => {
	it('fails when a capability claims a gate it does not cite', () => {
		const world = passWorld();
		world.manifest.control_registry[0].capabilities.push('fixture-other');
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /fixture-other is not a capability in this ledger/);
	});

	it('fails when a citing capability is missing from the registry row', () => {
		const world = passWorld();
		world.manifest.control_registry[0].capabilities = [];
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /cites this gate but is not listed as a claimant/);
	});

	it('fails when the registry command is not registered in package.json', () => {
		const world = passWorld();
		world.manifest.control_registry[0].command = 'fixture:absent';
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /is not registered in package.json#scripts/);
	});

	it('fails when a capability is claimed by no gate at all', () => {
		const world = passWorld();
		world.manifest.control_registry = [];
		const errors = evaluate(world).errors.join('\n');
		assert.match(errors, /control_registry: at least one gate/);
	});

	it('reads the runner files of a command so a variant is not a missing row', () => {
		assert.deepEqual(scriptRunnerFiles(SCRIPTS, 'fixture:check'), ['scripts/fixture-gate.mjs']);
		assert.deepEqual(scriptRunnerFiles(SCRIPTS, 'lint:check'), []);
	});

	it('reads the release surface from the profile roster, not from a one-line entry point', () => {
		// Issue #566 turned `validate:*` into a single call into a gate
		// runner, so a surface resolved from package.json alone would be
		// empty and rule 14 would never fire.
		const profileText = readFileSync(join(REPO_ROOT, 'quality/profile.yaml'), 'utf8');
		const surface = releaseSurfaceScripts({
			profileText,
			scripts: {
				'validate:release': 'node scripts/run-quality-gates.mjs release',
				'csrf:contract:check': 'node scripts/check-csrf-contract.mjs',
				'threat:model:check': 'node scripts/check-threat-model.mjs',
			},
		});
		assert.ok(surface.has('csrf:contract:check'), 'the profile roster names the command');
		assert.ok(surface.has('threat:model:check'), 'and this gate is on the roster too');
	});

	it('falls back to the script chain when the profile cannot be read', () => {
		const surface = releaseSurfaceScripts({
			profileText: '',
			scripts: { 'validate:release': 'pnpm run fixture:check', 'fixture:check': 'node x.mjs' },
		});
		assert.ok(surface.has('fixture:check'));
		assert.deepEqual(referencedScriptNames('pnpm run a && pnpm run b'), ['a', 'b']);
	});
});

describe('the report', () => {
	it('renders the diagram, the ledger and the probe from the same result', () => {
		const fixture = loadFixture(REPO_ROOT, 'pass');
		const result = evaluateFixture(fixture);
		const probes = PROBE_FIXTURES.map((name) => {
			const probe = loadFixture(REPO_ROOT, name);
			return { name, note: probe.note, ...evaluateFixture(probe) };
		});
		const html = renderReport({ manifest: fixture.manifest, result, probes });
		assert.match(html, /<svg[^>]+class="diagram"/, 'the report draws the trust boundary diagram');
		assert.match(html, /fixture-boundary/);
		assert.match(html, /threat-model-diagram\.webp/);
		assert.equal(
			(html.match(/class="probe"/g) ?? []).length,
			PROBE_FIXTURES.length,
			'every probe fixture is rendered',
		);
		assert.equal(
			html,
			renderReport({ manifest: fixture.manifest, result, probes }),
			'the same inputs render byte-identical HTML',
		);
	});

	it('draws one box per node and one arrow per declared boundary', () => {
		const fixture = loadFixture(REPO_ROOT, 'pass');
		const result = evaluateFixture(fixture);
		const html = renderReport({ manifest: fixture.manifest, result, probes: [] });
		const capability = result.capabilities[0];
		assert.equal((html.match(/class="node node-/g) ?? []).length, capability.nodes.length);
		assert.equal((html.match(/class="edge"/g) ?? []).length, capability.boundaries.length);
	});
});
