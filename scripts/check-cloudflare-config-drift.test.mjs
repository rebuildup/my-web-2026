import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	DRIFT_VERDICT,
	UNDECIDABLE_REASON,
	applyDriftCase,
	assertStatusOnly,
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
		const findings = diffModeSurfaces(record(), surface(shared, { routes: ['rebuildup.dev'] }), {
			bindings: structuredClone(shared),
			routes: [],
		});
		assert.deepEqual(findings, []);
	});

	it('treats a development-only binding as opt-in, not as drift', () => {
		// `LOCAL_API_MODE` comes from `.dev.vars`, so its absence in a clean
		// checkout is normal; its presence in production is not.
		const findings = diffModeSurfaces(record(), surface(record().production.bindings), {
			bindings: sharedBindings(),
			routes: [],
		});
		assert.deepEqual(findings, []);
	});

	it('rejects a development-only binding that reached production', () => {
		const bindings = {
			...record().production.bindings,
			LOCAL_API_MODE: { type: 'text', value: 'mock' },
		};
		const findings = diffModeSurfaces(record(), surface(bindings), {
			bindings: sharedBindings(),
			routes: [],
		});
		assert.equal(findings.length, 1);
		assert.equal(findings[0].path, 'mode.production_only.LOCAL_API_MODE');
		assert.equal(findings[0].kind, 'unexpected');
	});

	it('rejects a route attached in development', () => {
		const findings = diffModeSurfaces(record(), surface(record().production.bindings), {
			bindings: sharedBindings(),
			routes: ['rebuildup.dev'],
		});
		assert.equal(findings.length, 1);
		assert.equal(findings[0].dimension, 'routes');
		assert.equal(findings[0].path, 'development.routes');
	});

	it('rejects a production-only binding that reached development', () => {
		const findings = diffModeSurfaces(record(), surface(record().production.bindings), {
			bindings: {
				...sharedBindings(),
				BETTER_AUTH_URL: { type: 'text', value: 'https://rebuildup.dev' },
			},
			routes: [],
		});
		assert.equal(findings[0].path, 'mode.development_only_absent.BETTER_AUTH_URL');
	});

	it('rejects an undeclared per-mode VALUE difference', () => {
		const prod = {
			...record().production.bindings,
			MY_WEB_2026_COUNTER_KEY: { type: 'text', value: 'home-page' },
		};
		const findings = diffModeSurfaces(record(), surface(prod), {
			bindings: {
				...sharedBindings(),
				MY_WEB_2026_COUNTER_KEY: { type: 'text', value: 'staging-page' },
			},
			routes: [],
		});
		assert.equal(findings.length, 1);
		assert.equal(findings[0].kind, 'undeclared_mode_field_difference');
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
