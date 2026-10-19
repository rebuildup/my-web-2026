import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	DRIFT_VERDICT,
	UNDECIDABLE_REASON,
	applyDriftCase,
	assertStatusOnly,
	countBuildCommands,
	decide,
	diffBuildCommands,
	diffModeSurfaces,
	diffProductionSurface,
	diffStaticAssetHeaders,
	exitCodeFor,
	formatDriftReport,
	isIdentifierPath,
	isSensitivePath,
	normalizeBinding,
	normalizeWorkerSurface,
	readRecord,
	runbookRowFor,
} from './_cloudflare-drift.mjs';
import { looksLikeCredentialValue } from './_secret-scan.mjs';
import {
	FIXTURE_DIR,
	RECORD_PATH,
	renderAudit,
	runDriftAudit,
} from './check-cloudflare-config-drift.mjs';
import { parseHeadersFile } from './check-security-headers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The committed record, so every case below is decided against the real one. */
function record() {
	return JSON.parse(readFileSync(join(ROOT, RECORD_PATH), 'utf8'));
}

function fixture(name) {
	return JSON.parse(readFileSync(join(ROOT, FIXTURE_DIR, `${name}.json`), 'utf8'));
}

/** A minimal resolved worker surface, for the pure seam cases. */
function surface(bindings, overrides = {}) {
	return {
		mode: 'production',
		accountId: 'c6ab6651a5d4d6d0d07686bbd3c3d56f',
		name: 'my-web-2026',
		compatibilityDate: '2026-09-07',
		compatibilityFlags: ['global_fetch_strictly_public', 'nodejs_compat'],
		entrypoint: './src/server.ts',
		observability: true,
		routes: ['rebuildup.dev'],
		bindings,
		...overrides,
	};
}

/**
 * The development surface.
 *
 * The same shape as the production one, with the production origin
 * removed: development must never inherit it (ADR-0014). The scalar
 * fields are present because the mode dimension compares them too — a
 * mode difference in `compatibilityDate` is as undeclared as a mode
 * difference in a binding.
 */
function developmentSurface(bindings, overrides = {}) {
	return {
		mode: 'development',
		accountId: 'c6ab6651a5d4d6d0d07686bbd3c3d56f',
		name: 'my-web-2026',
		compatibilityDate: '2026-09-07',
		compatibilityFlags: ['global_fetch_strictly_public', 'nodejs_compat'],
		entrypoint: './src/server.ts',
		observability: true,
		routes: [],
		bindings,
		...overrides,
	};
}

/**
 * A repository root whose RECORD is the committed one with one field
 * changed.
 *
 * The audit reads the record from `root`, so a temporary root proves the
 * GATE refuses the record — not only that a helper does. Everything the
 * audit would read afterwards is symlinked, so the refusal can never be
 * an accident of a missing file.
 */
function rootWithMutatedRecord(mutate) {
	const root = mkdtempSync(join(tmpdir(), 'cf-config-drift-'));
	mkdirSync(join(root, 'quality'), { recursive: true });
	const mutated = record();
	mutate(mutated);
	writeFileSync(join(root, RECORD_PATH), `${JSON.stringify(mutated, null, '\t')}\n`);
	for (const entry of ['cloudflare.config.ts', 'package.json', 'public', 'src', 'docs']) {
		symlinkSync(join(ROOT, entry), join(root, entry));
	}
	return root;
}

describe('the recorded production contract matches the repository', () => {
	it('decides MATCH on the working tree, so a drift cannot be absorbed into the record silently', async () => {
		const audit = await runDriftAudit({ root: ROOT });
		assert.equal(
			audit.result.verdict,
			DRIFT_VERDICT.match,
			formatDriftReport(audit.result, audit.meta),
		);
		assert.equal(exitCodeFor(audit.result), 0);
	});

	it('renders a status-only report that names secret bindings but never a value', async () => {
		const audit = await runDriftAudit({ root: ROOT });
		const text = renderAudit(audit);
		assert.match(text, /verdict=MATCH/);
		for (const name of ['BETTER_AUTH_SECRETS', 'MY_WEB_2026_CONSUMER_API_KEY']) {
			assert.equal(record().production.bindings[name].type, 'secret');
			assert.equal(record().production.bindings[name].value, undefined);
		}
		assert.match(text, /secrets=3 \(names only\)/);
	});
});

describe('one differing item is one finding and one red gate', () => {
	const cases = [
		'one-missing-binding',
		'secret-binding-dropped',
		'text-value-drift',
		'undeclared-development-binding',
	];

	for (const name of cases) {
		it(`${name}: the recipe's own expectation holds`, async () => {
			const expect = fixture(name).expect;
			const audit = await runDriftAudit({ root: ROOT, caseName: name });
			assert.equal(audit.result.verdict, expect.verdict);
			assert.equal(exitCodeFor(audit.result), expect.exitCode);
			assert.equal(audit.result.findings.length, expect.findings);
			assert.deepEqual(
				audit.result.findings.map((item) => item.path),
				expect.paths,
			);
			if (expect.kind !== undefined) {
				assert.ok(
					audit.result.findings.some((item) => item.kind === expect.kind),
					`expected a ${expect.kind} finding`,
				);
			}
			if (expect.actual !== undefined) {
				const redacted = audit.result.findings.find((item) => item.path.endsWith('.value'));
				assert.equal(redacted.actual, expect.actual);
			}
		});
	}

	it('a single missing binding is enough, and it is counted once', async () => {
		const audit = await runDriftAudit({ root: ROOT, caseName: 'one-missing-binding' });
		assert.equal(audit.result.findings.length, 1);
		assert.equal(audit.result.counts.bindings, 1);
		assert.deepEqual(audit.result.counts, {
			bindings: 1,
			routes: 0,
			headers: 0,
			build_commands: 0,
			mode: 0,
		});
		assert.equal(exitCodeFor(audit.result), 1);
	});

	it('the unmutated recipe is still green, so a red run cannot come from the harness', async () => {
		const audit = await runDriftAudit({ root: ROOT, caseName: 'match' });
		assert.equal(audit.result.verdict, DRIFT_VERDICT.match);
		assert.equal(exitCodeFor(audit.result), 0);
	});
});

describe('a secret binding is a name, never a value', () => {
	it('drops every field but the type during normalization', () => {
		assert.deepEqual(normalizeBinding({ type: 'secret', value: 'super-secret-value' }), {
			type: 'secret',
		});
		assert.deepEqual(normalizeBinding({ type: 'secret', plaintext: 'x' }), { type: 'secret' });
	});

	it('keeps the declared fields of the non-secret binding types', () => {
		assert.deepEqual(normalizeBinding({ type: 'd1', name: 'db', id: 'abc', extra: 'dropped' }), {
			type: 'd1',
			name: 'db',
			id: 'abc',
		});
	});

	it('never reaches the report even when the config object carries one', () => {
		const observed = surface({ MY_SECRET: { type: 'secret', value: 'super-secret-value' } }, {});
		const findings = diffProductionSurface(
			{ ...record().production, bindings: { MY_SECRET: { type: 'secret' } } },
			observed,
		);
		const text = formatDriftReport(decide(findings), {});
		assert.ok(!text.includes('super-secret-value'), text);
		assert.ok(!text.includes('value'), text);
	});
});

describe('an unexpected text value is redacted, not printed', () => {
	it('reports the length only', () => {
		const findings = diffProductionSurface(record().production, {
			...surface(record().production.bindings),
			bindings: {
				...record().production.bindings,
				MY_WEB_2026_COUNTER_KEY: { type: 'text', value: 'staging-page' },
			},
		});
		const item = findings.find((entry) => entry.path === 'bindings.MY_WEB_2026_COUNTER_KEY.value');
		assert.equal(item.kind, 'mismatch');
		assert.equal(item.expected, 'home-page');
		assert.equal(item.actual, '<redacted len=12>');
		assert.equal(isSensitivePath(item.path), true);
	});

	it('classifies the finding paths that may carry a credential', () => {
		assert.equal(isSensitivePath('bindings.MEDIA_PUBLIC_BASE_URL.value'), true);
		assert.equal(isSensitivePath('bindings.MEDIA_PUBLIC_BASE_URL.name'), false);
		assert.equal(isIdentifierPath('bindings.DB.id'), true);
		assert.equal(isIdentifierPath('production.accountId'), true);
		assert.equal(isIdentifierPath('production.routes'), true);
		assert.equal(isIdentifierPath('headers./*'), false);
	});

	it('the guard refuses a report that would carry a credential', () => {
		// A non-secret-looking path is what makes this reachable: the guard
		// exists so a NEW comparison site cannot print a value by accident.
		const poisoned = decide([
			{
				dimension: 'headers',
				path: 'headers./*',
				kind: 'header_value_mismatch',
				expected: '-',
				actual: 'a'.repeat(40),
			},
		]);
		assert.throws(
			() => assertStatusOnly(poisoned, { isCredential: looksLikeCredentialValue }),
			/refusing to emit a credential-shaped token/,
		);
	});

	it('the guard lets an identifier and a redacted value through', () => {
		const allowed = decide([
			{
				dimension: 'bindings',
				path: 'bindings.DB.id',
				kind: 'mismatch',
				expected: record().production.bindings.DB.id,
				actual: 'b'.repeat(32),
			},
			{
				dimension: 'bindings',
				path: 'bindings.MEDIA_PUBLIC_BASE_URL.value',
				kind: 'mismatch',
				expected: 'https://media.rebuildup.dev',
				actual: '<redacted len=40>',
			},
		]);
		assert.doesNotThrow(() =>
			assertStatusOnly(allowed, { isCredential: looksLikeCredentialValue }),
		);
	});
});

describe('the dev / prod question', () => {
	/** The bindings both modes share: production minus its production-only pair. */
	function sharedBindings() {
		const { BETTER_AUTH_URL, MEDIA_PUBLIC_BASE_URL, ...shared } = record().production.bindings;
		return structuredClone(shared);
	}

	it('accepts the differences the record declares', () => {
		const shared = sharedBindings();
		const findings = diffModeSurfaces(
			record(),
			surface(shared, { routes: ['rebuildup.dev'] }),
			developmentSurface(shared),
		);
		assert.deepEqual(findings, []);
	});

	it('treats a development-only binding as opt-in, not as drift', () => {
		// `LOCAL_API_MODE` comes from `.dev.vars`, so its absence in a clean
		// checkout is normal; its presence in production is not.
		const findings = diffModeSurfaces(
			record(),
			surface(record().production.bindings),
			developmentSurface(sharedBindings()),
		);
		assert.deepEqual(findings, []);
	});

	it('rejects a development-only binding that reached production', () => {
		const bindings = {
			...record().production.bindings,
			LOCAL_API_MODE: { type: 'text', value: 'mock' },
		};
		const findings = diffModeSurfaces(
			record(),
			surface(bindings),
			developmentSurface(sharedBindings()),
		);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].path, 'mode.production_only.LOCAL_API_MODE');
		assert.equal(findings[0].kind, 'unexpected');
	});

	it('rejects a route attached in development', () => {
		const findings = diffModeSurfaces(
			record(),
			surface(record().production.bindings),
			developmentSurface(sharedBindings(), { routes: ['rebuildup.dev'] }),
		);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].dimension, 'routes');
		assert.equal(findings[0].path, 'development.routes');
	});

	it('rejects a production-only binding that reached development', () => {
		const findings = diffModeSurfaces(
			record(),
			surface(record().production.bindings),
			developmentSurface({
				...sharedBindings(),
				BETTER_AUTH_URL: { type: 'text', value: 'https://rebuildup.dev' },
			}),
		);
		assert.equal(findings[0].path, 'mode.production_only_reached_development.BETTER_AUTH_URL');
	});

	it('rejects an undeclared per-mode VALUE difference', () => {
		const prod = {
			...record().production.bindings,
			MY_WEB_2026_COUNTER_KEY: { type: 'text', value: 'home-page' },
		};
		const findings = diffModeSurfaces(
			record(),
			surface(prod),
			developmentSurface({
				...sharedBindings(),
				MY_WEB_2026_COUNTER_KEY: { type: 'text', value: 'staging-page' },
			}),
		);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].kind, 'undeclared_mode_field_difference');
	});

	it('rejects an undeclared SCALAR difference between the two modes', () => {
		// A `compatibilityDate` that differs between development and
		// production is just as undeclared as a binding that exists on one
		// side only, and it is invisible in a file diff.
		const findings = diffModeSurfaces(
			record(),
			surface(record().production.bindings),
			developmentSurface(sharedBindings(), { compatibilityDate: '2026-01-01' }),
		);
		const item = findings.find((entry) => entry.path === 'mode.undeclared_field.compatibilityDate');
		assert.equal(item.kind, 'undeclared_mode_scalar_difference');
		assert.equal(item.dimension, 'mode');
	});

	it('accepts a scalar difference the record declares', () => {
		const declared = record();
		declared.development.mode_only_fields = ['compatibilityDate'];
		const findings = diffModeSurfaces(
			declared,
			surface(record().production.bindings),
			developmentSurface(sharedBindings(), { compatibilityDate: '2026-01-01' }),
		);
		assert.deepEqual(findings, []);
	});

	it('reports a missing production binding once, not once per dimension', () => {
		// The bindings dimension owns "a production binding the record
		// declares is missing"; the mode dimension must not repeat it, or
		// the count stops being a repair checklist.
		const productionBindings = { ...record().production.bindings };
		// The key must be GONE, not set to `undefined`: a present key with
		// an undefined value is a different surface.
		Reflect.deleteProperty(productionBindings, 'BETTER_AUTH_SECRETS');
		const { BETTER_AUTH_URL, MEDIA_PUBLIC_BASE_URL, ...shared } = productionBindings;
		const developmentBindings = {
			...shared,
			BETTER_AUTH_SECRETS: { type: 'secret' },
		};
		const findings = diffModeSurfaces(
			record(),
			surface(productionBindings),
			developmentSurface(developmentBindings),
		);
		assert.deepEqual(findings, []);
	});
});

describe('the production surface against the record', () => {
	it('reports a type change on one binding', () => {
		const bindings = { ...record().production.bindings, MEDIA: { type: 'd1', name: 'x', id: 'y' } };
		const findings = diffProductionSurface(record().production, surface(bindings));
		const item = findings.find((entry) => entry.path === 'bindings.MEDIA');
		assert.equal(item.kind, 'type_mismatch');
		assert.equal(item.expected, 'r2');
		assert.equal(item.actual, 'd1');
	});

	it('reports a binding production gained that the record never declared', () => {
		const bindings = { ...record().production.bindings, NEW_FLAG: { type: 'text', value: 'x' } };
		const findings = diffProductionSurface(record().production, surface(bindings));
		const item = findings.find((entry) => entry.path === 'bindings.NEW_FLAG');
		assert.equal(item.kind, 'unexpected');
	});

	it('reports a changed compatibility date and an empty route list', () => {
		const findings = diffProductionSurface(
			record().production,
			surface(record().production.bindings, { compatibilityDate: '2026-10-01', routes: [] }),
		);
		const paths = findings.map((item) => item.path);
		assert.ok(paths.includes('production.compatibilityDate'));
		assert.ok(paths.includes('production.routes'));
	});
});

describe('the build and deploy commands', () => {
	const commands = { build: 'pnpm run build', deploy: 'pnpm run deploy:production:prepared' };

	it('accepts commands that exist and are documented', () => {
		const runbook = [
			'| Field | Value |',
			'| --- | --- |',
			'| Build command | `pnpm run build` |',
			'| Deploy command | `pnpm run deploy:production:prepared` |',
		].join('\n');
		const findings = diffBuildCommands(
			{ build_commands: commands },
			{ build: 'vite build', 'deploy:production:prepared': 'x' },
			runbook,
		);
		assert.deepEqual(findings, []);
	});

	it('reports a script the dashboard command names but package.json no longer has', () => {
		const findings = diffBuildCommands(
			{ build_commands: commands },
			{ 'deploy:production:prepared': 'x' },
			'',
		);
		const item = findings.find((entry) => entry.path === 'build_commands.build');
		assert.equal(item.kind, 'script_missing');
	});

	it('reports a runbook row that no longer matches the record', () => {
		const runbook = '| Build command | `pnpm run build:production` |';
		const findings = diffBuildCommands(
			{ build_commands: commands },
			{ build: 'x', 'deploy:production:prepared': 'y' },
			runbook,
		);
		const item = findings.find((entry) => entry.path === 'build_commands.build.runbook');
		assert.equal(item.kind, 'runbook_mismatch');
		assert.equal(item.actual, 'pnpm run build:production');
	});

	it('ignores documentation keys', () => {
		const findings = diffBuildCommands(
			{ build_commands: { $comment: 'prose is not a command', ...commands } },
			{ build: 'x', 'deploy:production:prepared': 'y' },
			'| Build command | `pnpm run build` |\n| Deploy command | `pnpm run deploy:production:prepared` |',
		);
		assert.deepEqual(findings, []);
	});

	it('reads the runbook row by label, not by position', () => {
		const runbook = [
			'| Deploy command | `pnpm run deploy:production:prepared` |',
			'| Build command | `pnpm run build` |',
		].join('\n');
		assert.equal(runbookRowFor(runbook, 'build'), 'pnpm run build');
		assert.equal(runbookRowFor(runbook, 'deploy'), 'pnpm run deploy:production:prepared');
		assert.equal(runbookRowFor(runbook, 'production_branch'), null);
	});
});

describe('the static-asset header surface', () => {
	const config = {
		file: 'public/_headers',
		policy_file: 'src/http/security-headers.json',
		baseline_rule: '/*',
		baseline_header: 'x-content-type-options',
		baseline_policy_key: 'x_content_type_options',
		required_paths: ['/*', '/share/*'],
	};
	const policy = { x_content_type_options: 'nosniff' };

	it('accepts a covering rule set whose baseline carries the SoT value', () => {
		const rules = [
			{ path: '/*', headers: { 'x-content-type-options': 'nosniff' } },
			{ path: '/share/*', headers: {} },
		];
		assert.deepEqual(diffStaticAssetHeaders({ static_asset_headers: config }, rules, policy), []);
	});

	it('reports a namespace production serves with no rule at all', () => {
		const rules = [{ path: '/*', headers: { 'x-content-type-options': 'nosniff' } }];
		const findings = diffStaticAssetHeaders({ static_asset_headers: config }, rules, policy);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].path, 'headers.coverage./share/*');
	});

	it('reports an edited nosniff baseline', () => {
		const rules = [
			{ path: '/*', headers: { 'x-content-type-options': 'off' } },
			{ path: '/share/*', headers: {} },
		];
		const findings = diffStaticAssetHeaders({ static_asset_headers: config }, rules, policy);
		assert.equal(findings[0].kind, 'header_value_mismatch');
		assert.equal(findings[0].expected, 'nosniff');
		assert.equal(findings[0].actual, 'off');
	});

	it('reports an absent or empty header file instead of passing', () => {
		assert.equal(
			diffStaticAssetHeaders({ static_asset_headers: config }, [], policy)[0].kind,
			'header_rule_missing',
		);
		assert.equal(
			diffStaticAssetHeaders({ static_asset_headers: config }, undefined, policy)[0].kind,
			'header_rule_missing',
		);
	});

	it('reports a rule the record does not declare', () => {
		// The record is the SoT for this surface, so a rule it does not
		// know about is drift: a record that dropped one path would make
		// the coverage check inspect one namespace fewer while the gate
		// still reported MATCH.
		const rules = [
			{ path: '/*', headers: { 'x-content-type-options': 'nosniff' } },
			{ path: '/share/*', headers: {} },
			{ path: '/tools/mic-level/app/*', headers: {} },
		];
		const findings = diffStaticAssetHeaders({ static_asset_headers: config }, rules, policy);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].path, 'headers.undeclared./tools/mic-level/app/*');
		assert.equal(findings[0].kind, 'header_rule_undeclared');
	});

	it('reports a missing baseline rule instead of skipping the comparison', () => {
		// A baseline that names a path no rule has would skip the nosniff
		// value comparison entirely — a silent skip, which is the
		// fail-open this gate exists to remove.
		const retargeted = {
			static_asset_headers: { ...config, baseline_rule: '/no-such-path' },
		};
		const rules = [
			{ path: '/*', headers: { 'x-content-type-options': 'nosniff' } },
			{ path: '/share/*', headers: {} },
		];
		const findings = diffStaticAssetHeaders(retargeted, rules, policy);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].path, 'headers.baseline./no-such-path');
		assert.equal(findings[0].kind, 'header_rule_uncovered');
	});

	it('reports a missing declared baseline rule once, not twice', () => {
		// The baseline is one of the declared paths, so the coverage
		// direction owns the finding; the baseline branch must not repeat
		// it (one item, one finding).
		const rules = [{ path: '/share/*', headers: {} }];
		const findings = diffStaticAssetHeaders({ static_asset_headers: config }, rules, policy);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].path, 'headers.coverage./*');
		assert.equal(findings[0].kind, 'header_rule_uncovered');
	});

	it('declares every rule path the committed `_headers` file carries', () => {
		// The record is compared with the header file in BOTH directions,
		// so the committed record has to name every rule the file
		// carries — and the file has to carry every rule the record
		// names.
		const rules = parseHeadersFile(readFileSync(join(ROOT, 'public/_headers'), 'utf8'));
		const declared = [...record().static_asset_headers.required_paths].sort();
		assert.deepEqual(declared, rules.map((rule) => rule.path).sort());
	});
});

describe('fail closed', () => {
	it('refuses a record that cannot state the contract', () => {
		for (const broken of [
			{},
			{ ...record(), production: {} },
			{ ...record(), production: { ...record().production, routes: undefined } },
			{ ...record(), production: { ...record().production, bindings: undefined } },
			{ ...record(), development: {} },
			{ ...record(), build_commands: undefined },
			{ ...record(), static_asset_headers: undefined },
		]) {
			assert.equal(readRecord(broken)?.error, UNDECIDABLE_REASON.recordIncomplete);
		}
		for (const broken of [undefined, null, 'not a record']) {
			assert.equal(readRecord(broken)?.error, UNDECIDABLE_REASON.recordUnreadable);
		}
	});

	it('refuses a record that stores a value under a secret binding', () => {
		const poisoned = record();
		poisoned.production.bindings.BETTER_AUTH_SECRETS = { type: 'secret', value: 'anything' };
		assert.match(readRecord(poisoned).error, /record_incomplete:bindings\.BETTER_AUTH_SECRETS/);
	});

	it('refuses a record whose INNER contract is broken', () => {
		// A section that is present but empty states no contract, so the
		// dimension that reads it would inspect NOTHING while the gate
		// still reported MATCH. That is the silent pass this gate exists
		// to remove, so every one of these is UNDECIDABLE.
		const broken = [
			[
				'static_asset_headers.required_paths',
				(r) => {
					r.static_asset_headers.required_paths = undefined;
				},
			],
			[
				'static_asset_headers.baseline_rule',
				(r) => {
					r.static_asset_headers.baseline_rule = undefined;
				},
			],
			[
				'static_asset_headers.baseline_header',
				(r) => {
					r.static_asset_headers.baseline_header = undefined;
				},
			],
			[
				'static_asset_headers.policy_file',
				(r) => {
					r.static_asset_headers.policy_file = undefined;
				},
			],
			[
				'build_commands',
				(r) => {
					r.build_commands = {};
				},
			],
			[
				'build_commands.deploy',
				(r) => {
					r.build_commands.deploy = 'npm run deploy';
				},
			],
			[
				'development.routes',
				(r) => {
					r.development.routes = undefined;
				},
			],
			[
				'development.mode_only_bindings.production_only',
				(r) => {
					r.development.mode_only_bindings.production_only = undefined;
				},
			],
			[
				'development.mode_only_bindings.development_only',
				(r) => {
					r.development.mode_only_bindings.development_only = undefined;
				},
			],
			[
				'development.mode_only_fields',
				(r) => {
					r.development.mode_only_fields = undefined;
				},
			],
			[
				'production.routes',
				(r) => {
					r.production.routes = [];
				},
			],
			[
				'production.bindings',
				(r) => {
					r.production.bindings = {};
				},
			],
			[
				'production.compatibilityDate',
				(r) => {
					r.production.compatibilityDate = undefined;
				},
			],
		];
		for (const [field, mutate] of broken) {
			const mutated = record();
			mutate(mutated);
			const problem = readRecord(mutated);
			assert.ok(problem, field);
			assert.match(problem.error, /^record_incomplete/, field);
		}
	});

	it('refuses a record whose inner contract is broken, end to end', async () => {
		// The unit test above proves the helper refuses; this one proves
		// the GATE refuses, with the exit code a CI job would see.
		const broken = [
			[
				'static_asset_headers.required_paths',
				(r) => {
					r.static_asset_headers.required_paths = undefined;
				},
			],
			[
				'static_asset_headers.baseline_rule',
				(r) => {
					r.static_asset_headers.baseline_rule = undefined;
				},
			],
			[
				'build_commands',
				(r) => {
					r.build_commands = {};
				},
			],
			[
				'development.routes',
				(r) => {
					r.development.routes = undefined;
				},
			],
		];
		for (const [field, mutate] of broken) {
			const root = rootWithMutatedRecord(mutate);
			try {
				const audit = await runDriftAudit({ root });
				assert.equal(audit.result.verdict, DRIFT_VERDICT.undecidable, field);
				assert.equal(exitCodeFor(audit.result), 2, field);
				assert.match(audit.result.reason, /^record_incomplete/, field);
				assert.equal(audit.result.findings.length, 0, field);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});

	it('refuses a record that omits the comparison field its binding type needs', () => {
		// A record that names the type but not the value compares NOTHING
		// for that binding: `diffProductionSurface` skips every field the
		// record does not mention, so the dimension would inspect nothing
		// while the gate still reported MATCH. The type therefore decides
		// which fields are mandatory.
		const broken = [
			['text', 'MY_WEB_2026_COUNTER_KEY', 'value'],
			['d1', 'DB', 'name'],
			['d1', 'DB', 'id'],
			['r2', 'MEDIA', 'name'],
			['rate-limit', 'RATE_LIMIT_WRITE', 'namespace'],
			['rate-limit', 'RATE_LIMIT_WRITE', 'simple'],
		];
		for (const [type, name, field] of broken) {
			const mutated = record();
			assert.equal(mutated.production.bindings[name].type, type);
			Reflect.deleteProperty(mutated.production.bindings[name], field);
			const problem = readRecord(mutated);
			assert.ok(problem, `${name}.${field}`);
			assert.equal(problem.error, `record_incomplete:bindings.${name}.${field}`);
		}
	});

	it('refuses a record whose rate-limit budget is not a number', () => {
		const mutated = record();
		mutated.production.bindings.RATE_LIMIT_WRITE.simple = { limit: '60', period: 60 };
		const problem = readRecord(mutated);
		assert.equal(problem.error, 'record_incomplete:bindings.RATE_LIMIT_WRITE.simple');
	});

	it('refuses a record whose binding type it does not know how to compare', () => {
		const mutated = record();
		mutated.production.bindings.DB.type = 'vectorize';
		const problem = readRecord(mutated);
		assert.equal(problem.error, 'record_incomplete:bindings.DB.type');
	});

	it('refuses a record whose baseline rule is not one of the declared paths', () => {
		// A baseline that names a path no rule has would skip the nosniff
		// value comparison entirely, so the baseline has to be one of the
		// paths the record declares.
		const mutated = record();
		mutated.static_asset_headers.baseline_rule = '/no-such-path';
		const problem = readRecord(mutated);
		assert.equal(problem.error, 'record_incomplete:static_asset_headers.baseline_rule');
	});

	it('refuses a record whose comparison field was dropped, end to end', async () => {
		// The unit test above proves the helper refuses; this one proves
		// the GATE refuses, with the exit code a CI job would see.
		const broken = [
			[
				'MY_WEB_2026_COUNTER_KEY.value',
				(r) => {
					Reflect.deleteProperty(r.production.bindings.MY_WEB_2026_COUNTER_KEY, 'value');
				},
			],
			[
				'DB.id',
				(r) => {
					Reflect.deleteProperty(r.production.bindings.DB, 'id');
				},
			],
			[
				'MEDIA.name',
				(r) => {
					Reflect.deleteProperty(r.production.bindings.MEDIA, 'name');
				},
			],
			[
				'RATE_LIMIT_WRITE.simple',
				(r) => {
					Reflect.deleteProperty(r.production.bindings.RATE_LIMIT_WRITE, 'simple');
				},
			],
		];
		for (const [field, mutate] of broken) {
			const root = rootWithMutatedRecord(mutate);
			try {
				const audit = await runDriftAudit({ root });
				assert.equal(audit.result.verdict, DRIFT_VERDICT.undecidable, field);
				assert.equal(exitCodeFor(audit.result), 2, field);
				assert.equal(audit.result.reason, `record_incomplete:bindings.${field}`, field);
				assert.equal(audit.result.findings.length, 0, field);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});

	it('refuses a record whose baseline rule was retargeted, end to end', async () => {
		const root = rootWithMutatedRecord((r) => {
			r.static_asset_headers.baseline_rule = '/no-such-path';
		});
		try {
			const audit = await runDriftAudit({ root });
			assert.equal(audit.result.verdict, DRIFT_VERDICT.undecidable);
			assert.equal(exitCodeFor(audit.result), 2);
			assert.equal(audit.result.reason, 'record_incomplete:static_asset_headers.baseline_rule');
			assert.equal(audit.result.findings.length, 0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('is red when a declared header path is dropped from the record, end to end', async () => {
		// The other direction of the same comparison. A record that lost
		// one path would make the coverage check inspect one namespace
		// fewer, so the gate has to be RED instead of MATCH.
		const root = rootWithMutatedRecord((r) => {
			r.static_asset_headers.required_paths = r.static_asset_headers.required_paths.filter(
				(path) => path !== '/share/*',
			);
		});
		try {
			const audit = await runDriftAudit({ root });
			assert.equal(audit.result.verdict, DRIFT_VERDICT.drift);
			assert.equal(exitCodeFor(audit.result), 1);
			assert.deepEqual(
				audit.result.findings.map((item) => item.path),
				['headers.undeclared./share/*'],
			);
			assert.equal(audit.result.findings[0].kind, 'header_rule_undeclared');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('counts the REAL build commands, not the documentation keys', () => {
		assert.equal(countBuildCommands(record()), 2);
		assert.equal(
			countBuildCommands({ build_commands: { $comment: 'prose', build: 'pnpm run build' } }),
			1,
		);
	});

	it('maps a reason to a non-zero exit that is NOT the pass code', () => {
		const undecidable = decide([], UNDECIDABLE_REASON.recordUnreadable);
		assert.equal(undecidable.verdict, DRIFT_VERDICT.undecidable);
		assert.equal(exitCodeFor(undecidable), 2);
		assert.notEqual(exitCodeFor(undecidable), 0);
		assert.match(formatDriftReport(undecidable, {}), /verdict=UNDECIDABLE/);
	});

	it('treats an unresolvable configuration as undecidable, never as a match', () => {
		assert.equal(
			normalizeWorkerSurface({ mode: 'production', config: null }).error,
			'config_not_object',
		);
		assert.equal(
			normalizeWorkerSurface({ mode: 'production', config: { worker: {} } }).error,
			'worker_not_object',
		);
	});
});

describe('the machine-readable output is status-only too', () => {
	const script = join(ROOT, 'scripts/check-cloudflare-config-drift.mjs');

	it('applies the same redaction to the JSON stream', () => {
		// The leak guard runs on BOTH output paths, so a future comparison
		// site cannot leak a credential through `--json` alone.
		const run = spawnSync(process.execPath, [script, '--case=text-value-drift', '--json'], {
			encoding: 'utf8',
		});
		assert.equal(run.status, 1);
		const parsed = JSON.parse(run.stdout);
		assert.equal(parsed.verdict, DRIFT_VERDICT.drift);
		const item = parsed.findings.find(
			(entry) => entry.path === 'bindings.MY_WEB_2026_COUNTER_KEY.value',
		);
		assert.equal(item.actual, '<redacted len=12>');
		// The un-redacted value must not exist anywhere in the JSON stream.
		assert.ok(!run.stdout.includes('staging-page'), run.stdout);
	});

	it('never prints a binding value in the JSON stream', () => {
		const run = spawnSync(process.execPath, [script, '--json'], { encoding: 'utf8' });
		assert.equal(run.status, 0);
		const parsed = JSON.parse(run.stdout);
		assert.equal(parsed.verdict, DRIFT_VERDICT.match);
		for (const binding of Object.values(record().production.bindings)) {
			if (typeof binding.value !== 'string') continue;
			assert.ok(!run.stdout.includes(binding.value), binding.value);
		}
	});
});

describe('the fixture recipes are single-item mutations', () => {
	it('applyDriftCase removes, adds and edits exactly what the recipe names', () => {
		const production = surface({ A: { type: 'text', value: '1' }, B: { type: 'secret' } });
		const development = { bindings: {}, routes: [] };
		const mutated = applyDriftCase(production, development, {
			remove_binding: 'B',
			add_binding: { name: 'C', binding: { type: 'text', value: '3', extra: 'dropped' } },
			set_binding_field: { name: 'A', field: 'value', value: '2' },
		});
		assert.deepEqual(Object.keys(mutated.production.bindings).sort(), ['A', 'C']);
		assert.equal(mutated.production.bindings.A.value, '2');
		assert.deepEqual(mutated.production.bindings.C, { type: 'text', value: '3' });
		// The inputs are never mutated: a fixture cannot poison the next case.
		assert.deepEqual(Object.keys(production.bindings).sort(), ['A', 'B']);
		assert.equal(production.bindings.A.value, '1');
	});
});
