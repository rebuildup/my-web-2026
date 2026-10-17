import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
	auditInstallScripts,
	classifyHooks,
	collectInstalledManifests,
	formatTextReport,
	groupInstalledByName,
	parsePolicy,
	readPackageManifest,
	readPnpmAllowlist,
	renderHtmlReport,
} from './_install-scripts.mjs';
import { runAudit } from './check-install-scripts.mjs';

// Fixture versions deliberately avoid the `0.x.y` release-literal shape
// so scripts/check-release-version.mjs never flags this file.
const FIXTURE_VERSION = '1.2.3';

function policyEntry(overrides = {}) {
	return {
		name: 'fixture-pkg',
		hooks: ['postinstall'],
		decision: 'allow',
		justification: 'fixture build that produces a required artifact',
		...overrides,
	};
}

function manifest({ name, version = FIXTURE_VERSION, scripts = {} }) {
	return {
		name,
		version,
		scripts,
		dependencies: {},
		devDependencies: {},
		optionalDependencies: {},
	};
}

describe('classifyHooks', () => {
	it('splits hooks by when they actually fire', () => {
		const classified = classifyHooks({
			preinstall: 'node pre.cjs',
			install: 'node install.cjs',
			postinstall: 'node post.cjs',
			prepare: 'panda codegen',
			prepublishOnly: 'npm run build',
			prepack: 'npm pack',
			postpack: 'echo done',
			prepublish: 'echo legacy',
			test: 'vitest',
		});
		assert.deepEqual(classified.installTime, ['preinstall', 'install', 'postinstall']);
		assert.deepEqual(classified.rootInstallTime, ['prepare']);
		assert.deepEqual(classified.publishTime, [
			'prepublish',
			'prepublishOnly',
			'prepack',
			'postpack',
		]);
	});

	it('ignores non-string and blank hook values', () => {
		const classified = classifyHooks({ postinstall: '   ', prepare: 42, preinstall: null });
		assert.deepEqual(classified, { installTime: [], rootInstallTime: [], publishTime: [] });
	});

	it('tolerates a missing scripts map', () => {
		assert.deepEqual(classifyHooks(undefined), {
			installTime: [],
			rootInstallTime: [],
			publishTime: [],
		});
	});
});

describe('parsePolicy', () => {
	const serialize = (value) => JSON.stringify(value);

	it('accepts a reviewed policy and normalises observed versions', () => {
		const { policy, errors } = parsePolicy(
			serialize({
				version: 1,
				issue: '#474',
				default_decision: 'block',
				packages: [
					policyEntry({ observed_versions: ['2.0.0', '1.0.0'], remediation: 'drop the entry' }),
					policyEntry({ name: '.', hooks: ['prepare'] }),
				],
			}),
		);
		assert.deepEqual(errors, []);
		assert.equal(policy.packages[0].observed_versions[0], '1.0.0');
		assert.equal(policy.packages[0].remediation, 'drop the entry');
		assert.equal(policy.packages[1].name, '.');
	});

	it('rejects malformed JSON', () => {
		const { policy, errors } = parsePolicy('{ not json');
		assert.equal(policy, null);
		assert.match(errors[0], /not valid JSON/);
	});

	it('rejects a wrong version, a non-deny default and a missing packages array', () => {
		const wrongVersion = parsePolicy(
			serialize({ version: 2, default_decision: 'block', packages: [] }),
		);
		assert.match(wrongVersion.errors[0], /version: expected 1/);

		const permissiveDefault = parsePolicy(
			serialize({ version: 1, default_decision: 'allow', packages: [] }),
		);
		assert.match(permissiveDefault.errors[0], /default_decision: must be "block"/);

		const noPackages = parsePolicy(serialize({ version: 1, default_decision: 'block' }));
		assert.match(noPackages.errors[0], /packages: must be an array/);
	});

	it('requires a justification, a known hook set and a known decision', () => {
		const cases = [
			[{ ...policyEntry({ justification: '' }) }, /justification is required/],
			[{ ...policyEntry({ hooks: ['postinstall', 'lifecycle-weird'] }) }, /unknown lifecycle hook/],
			[{ ...policyEntry({ decision: 'maybe' }) }, /decision must be one of/],
			[{ ...policyEntry({ hooks: [] }) }, /hooks must be a non-empty array/],
			[{ ...policyEntry({ name: '' }) }, /name is required/],
		];
		for (const [entry, pattern] of cases) {
			const { errors } = parsePolicy(
				serialize({ version: 1, default_decision: 'block', packages: [entry] }),
			);
			assert.ok(
				errors.some((error) => pattern.test(error)),
				`expected ${pattern} in ${errors}`,
			);
		}
	});

	it('rejects duplicate names and both version fields at once', () => {
		const duplicates = parsePolicy(
			serialize({
				version: 1,
				default_decision: 'block',
				packages: [policyEntry(), policyEntry({ hooks: ['install'] })],
			}),
		);
		assert.ok(duplicates.errors.some((error) => /duplicate entry/.test(error)));

		const bothVersions = parsePolicy(
			serialize({
				version: 1,
				default_decision: 'block',
				packages: [policyEntry({ observed_version: '1.0.0', observed_versions: ['1.0.0'] })],
			}),
		);
		assert.ok(bothVersions.errors.some((error) => /not both/.test(error)));
	});
});

describe('readPnpmAllowlist', () => {
	it('reads both the sequence form and the map form', () => {
		const { names, errors } = readPnpmAllowlist(
			[
				'allowBuilds:',
				"  '@scope/pkg': true",
				'  other-pkg: false',
				'  third-pkg: true',
				'minimumReleaseAge: 0',
				'onlyBuiltDependencies:',
				'  - esbuild',
				"  - '@biomejs/biome'",
				'patchedDependencies:',
				'  cf@1.0.0-beta.12: patches/cf@1.0.0-beta.12.patch',
			].join('\n'),
		);
		assert.deepEqual(errors, []);
		assert.deepEqual(names.get('@scope/pkg'), ['allowBuilds']);
		assert.deepEqual(names.get('third-pkg'), ['allowBuilds']);
		assert.deepEqual(names.get('esbuild'), ['onlyBuiltDependencies']);
		assert.deepEqual(names.get('@biomejs/biome'), ['onlyBuiltDependencies']);
		assert.equal(names.has('other-pkg'), false, 'a false map entry is not a permission');
		assert.equal(names.has('cf@1.0.0-beta.12'), false, 'patchedDependencies is not an allow-list');
	});

	it('records both keys when a package appears in each', () => {
		const { names } = readPnpmAllowlist(
			['allowBuilds:', '  esbuild: true', 'onlyBuiltDependencies:', '  - esbuild'].join('\n'),
		);
		assert.deepEqual(names.get('esbuild'), ['allowBuilds', 'onlyBuiltDependencies']);
	});

	it('reads an inline array', () => {
		const { names } = readPnpmAllowlist('onlyBuiltDependencies: [esbuild, workerd]\n');
		assert.deepEqual([...names.keys()], ['esbuild', 'workerd']);
	});

	it('reports a non-boolean map value instead of silently allowing it', () => {
		const { errors } = readPnpmAllowlist(['allowBuilds:', '  esbuild: yes-please'].join('\n'));
		assert.equal(errors.length, 1);
		assert.match(errors[0], /expected a boolean/);
	});
});

describe('collectInstalledManifests', () => {
	const roots = [];
	function stageTree({ files = [], symlinks = [] }) {
		const root = mkdtempSync(join(tmpdir(), 'install-script-audit-'));
		roots.push(root);
		for (const [relative, value] of files) {
			const path = join(root, relative);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
		}
		for (const [relative, target] of symlinks) {
			const path = join(root, relative);
			mkdirSync(dirname(path), { recursive: true });
			symlinkSync(target, path);
		}
		return root;
	}

	it('walks the pnpm virtual store and de-duplicates symlinked copies', () => {
		const root = stageTree({
			files: [
				[
					'node_modules/.pnpm/fixture-pkg@1.2.3/node_modules/fixture-pkg/package.json',
					{ name: 'fixture-pkg', version: '1.2.3', scripts: { postinstall: 'node build.js' } },
				],
				[
					'node_modules/.pnpm/fixture-pkg@1.2.3/node_modules/nested-dep/package.json',
					{ name: 'nested-dep', version: '4.5.6' },
				],
			],
			symlinks: [
				// pnpm exposes the virtual-store copy as a symlink at the top level.
				['node_modules/fixture-pkg', '.pnpm/fixture-pkg@1.2.3/node_modules/fixture-pkg'],
				['node_modules/nested-dep', '.pnpm/fixture-pkg@1.2.3/node_modules/nested-dep'],
				['node_modules/.bin/fixture-pkg', '.pnpm/fixture-pkg@1.2.3/node_modules/fixture-pkg'],
			],
		});
		const manifests = collectInstalledManifests(root);
		const names = manifests.map((entry) => entry.name).sort();
		assert.deepEqual(names, ['fixture-pkg', 'nested-dep']);
	});

	it('ignores unparseable manifests instead of crashing the walk', () => {
		const root = stageTree({ files: [['node_modules/broken/package.json', '{ oops']] });
		assert.deepEqual(collectInstalledManifests(root), []);
		assert.equal(readPackageManifest(join(root, 'node_modules/absent/package.json')), null);
	});

	after(() => {
		for (const root of roots) rmSync(root, { recursive: true, force: true });
	});
});

describe('groupInstalledByName', () => {
	it('collapses several installed versions into one record', () => {
		const groups = groupInstalledByName([
			manifest({ name: 'esbuild', version: '1.9.0', scripts: { postinstall: 'a' } }),
			manifest({ name: 'esbuild', version: '1.8.0', scripts: { postinstall: 'a' } }),
			manifest({ name: 'plain', version: '1.0.0' }),
		]);
		assert.deepEqual([...groups.get('esbuild').versions].sort(), ['1.8.0', '1.9.0']);
		assert.deepEqual([...groups.get('esbuild').hooks], ['postinstall']);
		assert.deepEqual([...groups.get('plain').hooks], []);
	});
});

describe('auditInstallScripts', () => {
	const baseInput = (overrides = {}) => ({
		manifests: [],
		rootManifest: null,
		policy: { version: 1, default_decision: 'block', packages: [] },
		pnpmAllowlist: new Map(),
		directNames: new Set(),
		...overrides,
	});

	it('fails when an install-time hook has no reviewed record', () => {
		const audit = auditInstallScripts(
			baseInput({
				manifests: [manifest({ name: 'sneaky-pkg', scripts: { preinstall: 'node x.js' } })],
			}),
		);
		assert.equal(audit.violations.length, 1);
		assert.match(audit.violations[0], /sneaky-pkg/);
		assert.match(audit.violations[0], /no entry in quality\/install-scripts\.json/);
		assert.equal(audit.summary.unreviewed, 1);
		assert.equal(audit.findings[0].elevated, true, 'preinstall must be flagged as elevated');
	});

	it('fails when the policy allows a build pnpm will not run', () => {
		const audit = auditInstallScripts(
			baseInput({
				manifests: [manifest({ name: 'fixture-pkg', scripts: { postinstall: 'node build.js' } })],
				policy: { version: 1, default_decision: 'block', packages: [policyEntry()] },
			}),
		);
		assert.equal(audit.violations.length, 1);
		assert.match(audit.violations[0], /decision "allow" but pnpm-workspace\.yaml does not list it/);
	});

	it('fails when the policy blocks a build pnpm still runs', () => {
		const audit = auditInstallScripts(
			baseInput({
				manifests: [manifest({ name: 'fixture-pkg', scripts: { postinstall: 'node build.js' } })],
				policy: {
					version: 1,
					default_decision: 'block',
					packages: [policyEntry({ decision: 'block' })],
				},
				pnpmAllowlist: new Map([['fixture-pkg', ['onlyBuiltDependencies']]]),
			}),
		);
		assert.equal(audit.violations.length, 1);
		assert.match(audit.violations[0], /decision "block" but pnpm-workspace\.yaml allows/);
	});

	it('fails when the installed manifest grows an undocumented hook', () => {
		const audit = auditInstallScripts(
			baseInput({
				manifests: [
					manifest({ name: 'fixture-pkg', scripts: { postinstall: 'a', preinstall: 'b' } }),
				],
				policy: { version: 1, default_decision: 'block', packages: [policyEntry()] },
				pnpmAllowlist: new Map([['fixture-pkg', ['onlyBuiltDependencies']]]),
			}),
		);
		assert.equal(audit.violations.length, 1);
		assert.match(audit.violations[0], /undocumented: preinstall/);
	});

	it('passes a fully reviewed and allow-listed install', () => {
		const audit = auditInstallScripts(
			baseInput({
				manifests: [
					manifest({ name: 'fixture-pkg', scripts: { postinstall: 'node build.js' } }),
					manifest({ name: 'publish-only', scripts: { prepublishOnly: 'npm run build' } }),
				],
				rootManifest: manifest({ name: 'app', scripts: { prepare: 'panda codegen' } }),
				policy: {
					version: 1,
					default_decision: 'block',
					packages: [
						policyEntry({ observed_version: FIXTURE_VERSION }),
						{ name: '.', hooks: ['prepare'], decision: 'allow', justification: 'own codegen' },
					],
				},
				pnpmAllowlist: new Map([['fixture-pkg', ['onlyBuiltDependencies']]]),
			}),
		);
		assert.deepEqual(audit.violations, []);
		assert.deepEqual(audit.warnings, []);
		assert.equal(audit.summary.allowed, 2);
		assert.equal(audit.summary.publish_time_only, 1);
	});

	it('does not hold the workspace root to the dependency allow-list', () => {
		const audit = auditInstallScripts(
			baseInput({
				rootManifest: manifest({ name: 'app', scripts: { prepare: 'panda codegen' } }),
				policy: {
					version: 1,
					default_decision: 'block',
					packages: [
						{ name: '.', hooks: ['prepare'], decision: 'allow', justification: 'own codegen' },
					],
				},
			}),
		);
		assert.deepEqual(audit.violations, []);
		assert.equal(audit.findings[0].kind, 'root');
	});

	it('warns about allow-list permission that buys no build', () => {
		const audit = auditInstallScripts(
			baseInput({
				manifests: [manifest({ name: 'no-build-pkg' })],
				pnpmAllowlist: new Map([['no-build-pkg', ['onlyBuiltDependencies']]]),
			}),
		);
		assert.deepEqual(audit.violations, []);
		assert.equal(audit.warnings.length, 1);
		assert.match(audit.warnings[0], /allows build scripts for "no-build-pkg"/);
		assert.match(audit.warnings[0], /remove the entry/);
	});

	it('warns on version drift and on stale policy records', () => {
		const audit = auditInstallScripts(
			baseInput({
				manifests: [
					manifest({ name: 'fixture-pkg', version: '9.9.9', scripts: { postinstall: 'a' } }),
				],
				policy: {
					version: 1,
					default_decision: 'block',
					packages: [policyEntry({ observed_version: '1.0.0' }), policyEntry({ name: 'gone-pkg' })],
				},
				pnpmAllowlist: new Map([['fixture-pkg', ['onlyBuiltDependencies']]]),
			}),
		);
		assert.deepEqual(audit.violations, []);
		assert.equal(audit.warnings.length, 2);
		assert.ok(audit.warnings.some((warning) => /re-review the new version/.test(warning)));
		assert.ok(
			audit.warnings.some((warning) => /"gone-pkg" matches no installed package/.test(warning)),
		);
	});

	it('warns when the root record outlives the root hook', () => {
		const audit = auditInstallScripts(
			baseInput({
				rootManifest: manifest({ name: 'app' }),
				policy: {
					version: 1,
					default_decision: 'block',
					packages: [
						{ name: '.', hooks: ['prepare'], decision: 'allow', justification: 'own codegen' },
					],
				},
			}),
		);
		assert.ok(audit.warnings.some((warning) => /no longer declares one/.test(warning)));
	});
});

describe('report rendering', () => {
	const audit = auditInstallScripts({
		manifests: [
			manifest({ name: 'fixture-pkg', scripts: { postinstall: 'node build.js' } }),
			manifest({ name: 'publisher', scripts: { prepack: 'npm pack' } }),
		],
		rootManifest: manifest({ name: 'app', scripts: { prepare: 'panda codegen' } }),
		policy: {
			version: 1,
			default_decision: 'block',
			packages: [
				policyEntry(),
				{ name: '.', hooks: ['prepare'], decision: 'allow', justification: 'own codegen' },
			],
		},
		pnpmAllowlist: new Map([['fixture-pkg', ['onlyBuiltDependencies']]]),
		directNames: new Set(['fixture-pkg']),
	});

	it('renders a deterministic, status-only text report', () => {
		const text = formatTextReport(audit, {});
		assert.equal(text, formatTextReport(audit, {}), 'report must be deterministic');
		assert.match(text, /fixture-pkg/);
		assert.match(text, /workspace root project/);
		assert.match(text, /Violations \(fail the gate\) — 0/);
		assert.match(text, /No secret value is read or printed/);
	});

	it('renders a self-contained HTML report that escapes policy text', () => {
		const html = renderHtmlReport(
			{
				...audit,
				findings: [
					{
						...audit.findings[0],
						justification: '<script>alert("x")</script> & "quoted"',
					},
				],
			},
			{},
		);
		assert.match(html, /^<!doctype html>/);
		assert.ok(!html.includes('<script>alert'), 'policy text must be HTML-escaped');
		assert.match(html, /&lt;script&gt;/);
		assert.ok(!html.includes('<script src'), 'the report must not load remote assets');
	});
});

describe('runAudit (end to end over a fixture repository)', () => {
	const roots = [];
	function stageRepo({ policy, allowlist, packages, rootScripts = { prepare: 'panda codegen' } }) {
		const root = mkdtempSync(join(tmpdir(), 'install-script-audit-repo-'));
		roots.push(root);
		writeFileSync(
			join(root, 'package.json'),
			JSON.stringify({
				name: 'fixture-app',
				version: FIXTURE_VERSION,
				scripts: rootScripts,
				devDependencies: Object.fromEntries(packages.map((entry) => [entry.name, entry.version])),
			}),
		);
		mkdirSync(join(root, 'quality'), { recursive: true });
		writeFileSync(join(root, 'quality/install-scripts.json'), JSON.stringify(policy));
		writeFileSync(join(root, 'pnpm-workspace.yaml'), allowlist);
		for (const entry of packages) {
			const dir = join(root, 'node_modules', entry.name, 'node_modules', entry.name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, 'package.json'),
				JSON.stringify({ name: entry.name, version: entry.version, scripts: entry.scripts }),
			);
		}
		return root;
	}

	const packages = [
		{ name: 'fixture-pkg', version: FIXTURE_VERSION, scripts: { postinstall: 'node build.js' } },
	];

	it('passes when the allow-list and the reviewed policy agree', () => {
		const root = stageRepo({
			packages,
			allowlist: 'onlyBuiltDependencies:\n  - fixture-pkg\n',
			policy: {
				version: 1,
				default_decision: 'block',
				packages: [
					policyEntry({ observed_version: FIXTURE_VERSION }),
					{ name: '.', hooks: ['prepare'], decision: 'allow', justification: 'own codegen' },
				],
			},
		});
		const result = runAudit(root);
		assert.deepEqual(result.inputErrors, []);
		assert.deepEqual(result.audit.violations, []);
		assert.equal(result.ok, true);
	});

	it('fails when a dependency gains an install-time hook nobody reviewed', () => {
		const root = stageRepo({
			packages,
			allowlist: 'onlyBuiltDependencies:\n  - fixture-pkg\n',
			policy: {
				version: 1,
				default_decision: 'block',
				packages: [
					{ name: '.', hooks: ['prepare'], decision: 'allow', justification: 'own codegen' },
				],
			},
		});
		const result = runAudit(root);
		assert.equal(result.ok, false);
		assert.match(result.audit.violations[0], /fixture-pkg/);
	});

	it('reports a missing input instead of silently auditing nothing', () => {
		const root = mkdtempSync(join(tmpdir(), 'install-script-audit-empty-'));
		roots.push(root);
		const result = runAudit(root);
		assert.equal(result.ok, false);
		assert.equal(result.inputErrors.length, 3);
		assert.ok(result.inputErrors.every((line) => /required input not found/.test(line)));
	});

	after(() => {
		for (const root of roots) rmSync(root, { recursive: true, force: true });
	});
});
