import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	auditInstallScripts,
	classifyHooks,
	collectGitHostedNames,
	collectInstalledManifests,
	formatTextReport,
	groupInstalledByName,
	parsePolicy,
	readPackageManifest,
	readPnpmAllowlist,
	renderHtmlReport,
} from './_install-scripts.mjs';
import { runAudit } from './check-install-scripts.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'check-install-scripts.mjs');

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

function manifest({
	name,
	version = FIXTURE_VERSION,
	scripts = {},
	dependencies = {},
	devDependencies = {},
	optionalDependencies = {},
	requiresBuild = false,
}) {
	return {
		name,
		version,
		scripts,
		requiresBuild,
		dependencies,
		devDependencies,
		optionalDependencies,
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

	it('promotes a git-hosted prepare to install-time', () => {
		const registryDep = classifyHooks({ prepare: 'npm run build' });
		assert.deepEqual(registryDep.rootInstallTime, ['prepare']);
		assert.deepEqual(registryDep.installTime, []);

		// pnpm prepares git-hosted dependencies while fetching them, so
		// the same hook is unreviewed install-time code there.
		const gitDep = classifyHooks({ prepare: 'npm run build' }, { gitHosted: true });
		assert.deepEqual(gitDep.installTime, ['prepare']);
		assert.deepEqual(gitDep.rootInstallTime, []);
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
	it('reads both the effective map and the legacy sequence', () => {
		const { names, effectiveKey, legacyOnly, errors } = readPnpmAllowlist(
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
		assert.equal(effectiveKey, 'allowBuilds');
		assert.deepEqual(names.get('@scope/pkg'), ['allowBuilds']);
		assert.deepEqual(names.get('third-pkg'), ['allowBuilds']);
		assert.equal(names.has('other-pkg'), false, 'a false map entry is not a permission');
		assert.equal(names.has('cf@1.0.0-beta.12'), false, 'patchedDependencies is not an allow-list');
		// Neither legacy name is granted by the effective map: pnpm 12 would
		// not run those builds, so they are reported instead of trusted.
		assert.equal(names.has('esbuild'), false);
		assert.equal(names.has('@biomejs/biome'), false);
		assert.deepEqual(legacyOnly, ['@biomejs/biome', 'esbuild']);
	});

	it('treats permissions as the effective list and refuses an ambiguous pair', () => {
		// pnpm ignores "allowBuilds" entries when "permissions" is
		// present. A second grant map is therefore never read silently:
		// the effective list has to be unambiguous to audit.
		const superseded = readPnpmAllowlist(
			['permissions:', '  esbuild: true', 'allowBuilds:', '  workerd: true'].join('\n'),
		);
		assert.equal(superseded.effectiveKey, 'permissions');
		assert.deepEqual([...superseded.names.keys()], ['esbuild']);
		assert.equal(superseded.errors.length, 1);
		assert.match(superseded.errors[0], /pnpm 12 ignores this entry/);

		const singleKey = readPnpmAllowlist(['permissions:', '  esbuild: true'].join('\n'));
		assert.deepEqual(singleKey.errors, []);
		assert.deepEqual([...singleKey.names.keys()], ['esbuild']);

		const ambiguous = readPnpmAllowlist(
			['allowBuilds:', '  esbuild: true', 'permissions:', '  esbuild: true'].join('\n'),
		);
		assert.equal(ambiguous.errors.length, 1);
		assert.match(ambiguous.errors[0], /keep exactly one of the two keys/);
	});

	it('records both keys when a package is granted by the effective and the legacy list', () => {
		const { names, legacyOnly } = readPnpmAllowlist(
			['allowBuilds:', '  esbuild: true', 'onlyBuiltDependencies:', '  - esbuild'].join('\n'),
		);
		assert.deepEqual(names.get('esbuild'), ['allowBuilds', 'onlyBuiltDependencies']);
		assert.deepEqual(legacyOnly, []);
	});

	it('reads an inline array and an explicit deny list', () => {
		const { names, ignored } = readPnpmAllowlist(
			['allowBuilds:', '  workerd: true', 'ignoredBuiltDependencies: [sharp]', ''].join('\n'),
		);
		assert.deepEqual([...names.keys()], ['workerd']);
		assert.deepEqual([...ignored], ['sharp']);
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

	it('does not treat a fixture shipped inside a package as an installed package', () => {
		// pnpm never builds `examples/` or `test/fixtures/`; only package
		// boundaries are part of the installed tree.
		const root = stageTree({
			files: [
				['node_modules/real-pkg/package.json', { name: 'real-pkg', version: '1.2.3' }],
				[
					'node_modules/real-pkg/examples/demo/package.json',
					{
						name: 'example-fixture',
						version: FIXTURE_VERSION,
						scripts: { postinstall: 'node x.js' },
					},
				],
				[
					'node_modules/real-pkg/test/fixtures/fixture-pkg/package.json',
					{
						name: 'fixture-pkg',
						version: FIXTURE_VERSION,
						scripts: { postinstall: 'lerna bootstrap' },
					},
				],
			],
		});
		assert.deepEqual(
			collectInstalledManifests(root).map((entry) => entry.name),
			['real-pkg'],
		);
	});

	it('reads binding.gyp as an implicit build requirement', () => {
		const root = stageTree({
			files: [
				['node_modules/native-pkg/package.json', { name: 'native-pkg', version: '1.2.3' }],
				['node_modules/native-pkg/binding.gyp', '{}'],
			],
		});
		const [record] = collectInstalledManifests(root);
		assert.equal(record.requiresBuild, true);
		const groups = groupInstalledByName([record]);
		assert.deepEqual([...groups.get('native-pkg').hooks], ['implicit:binding.gyp']);
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

	it('records the implicit node-gyp build of a binding.gyp package', () => {
		const groups = groupInstalledByName([
			manifest({ name: 'native-pkg', version: '1.0.0', requiresBuild: true }),
		]);
		assert.deepEqual([...groups.get('native-pkg').hooks], ['implicit:binding.gyp']);
	});
});

describe('collectGitHostedNames', () => {
	it('finds git-hosted dependencies in every manifest', () => {
		const names = collectGitHostedNames(
			[
				manifest({
					name: 'consumer',
					dependencies: { 'git-dep': 'github:owner/repo#v1', 'registry-dep': '^1.2.3' },
				}),
			],
			manifest({
				name: 'app',
				devDependencies: { 'other-git': 'git+ssh://git@host/o/r.git#main' },
			}),
		);
		assert.deepEqual([...names].sort(), ['git-dep', 'other-git']);
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

	it('warns on version drift of a blocked record and on stale policy records', () => {
		const audit = auditInstallScripts(
			baseInput({
				manifests: [
					manifest({ name: 'fixture-pkg', version: '9.9.9', scripts: { postinstall: 'a' } }),
				],
				policy: {
					version: 1,
					default_decision: 'block',
					packages: [
						policyEntry({ observed_version: '1.0.0', decision: 'block' }),
						policyEntry({ name: 'gone-pkg' }),
					],
				},
				pnpmAllowlist: new Map(),
			}),
		);
		assert.deepEqual(audit.violations, []);
		assert.equal(audit.warnings.length, 2);
		assert.ok(audit.warnings.some((warning) => /!=\s*installed/.test(warning)));
		assert.ok(
			audit.warnings.some((warning) => /"gone-pkg" matches no installed package/.test(warning)),
		);
	});

	it('fails when an allowed package moved to a version the record never reviewed', () => {
		// pnpm executes the new version's hook on the very install that
		// pulls it in, so an "allow" record that no longer matches the
		// installed version is unreviewed code, not a warning.
		const audit = auditInstallScripts(
			baseInput({
				manifests: [
					manifest({ name: 'fixture-pkg', version: '9.9.9', scripts: { postinstall: 'a' } }),
				],
				policy: {
					version: 1,
					default_decision: 'block',
					packages: [policyEntry({ observed_version: '1.0.0' })],
				},
				pnpmAllowlist: new Map([['fixture-pkg', ['allowBuilds']]]),
			}),
		);
		assert.equal(audit.violations.length, 1);
		assert.match(
			audit.violations[0],
			/policy observed version\(s\) \[1\.0\.0\] != installed \[9\.9\.9\]/,
		);
		assert.match(audit.violations[0], /re-reviewed/);
		assert.equal(audit.findings[0].version_drift, true);
	});

	it('fails when a grant survives only in the legacy onlyBuiltDependencies list', () => {
		const audit = auditInstallScripts(
			baseInput({
				manifests: [manifest({ name: 'fixture-pkg', scripts: { postinstall: 'a' } })],
				policy: { version: 1, default_decision: 'block', packages: [policyEntry()] },
				pnpmAllowlist: readPnpmAllowlist(['onlyBuiltDependencies:', '  - fixture-pkg'].join('\n')),
			}),
		);
		assert.equal(audit.summary.violations, 2);
		assert.ok(
			audit.violations.some((violation) => /onlyBuiltDependencies lists it/.test(violation)),
			audit.violations.join('\n'),
		);
		assert.ok(
			audit.violations.some((violation) =>
				/decision "allow" but pnpm-workspace\.yaml does not list/.test(violation),
			),
		);
	});

	it('fails when one package is granted and denied at the same time', () => {
		const audit = auditInstallScripts(
			baseInput({
				manifests: [manifest({ name: 'fixture-pkg', scripts: { postinstall: 'a' } })],
				policy: { version: 1, default_decision: 'block', packages: [policyEntry()] },
				pnpmAllowlist: readPnpmAllowlist(
					['allowBuilds:', '  fixture-pkg: true', 'ignoredBuiltDependencies: [fixture-pkg]'].join(
						'\n',
					),
				),
			}),
		);
		assert.ok(audit.violations.some((violation) => /keep one intent/.test(violation)));
	});

	it('treats a git-hosted prepare as unreviewed install-time code', () => {
		const gitManifest = manifest({ name: 'git-dep', scripts: { prepare: 'npm run build' } });
		const audit = auditInstallScripts(
			baseInput({
				manifests: [gitManifest],
				rootManifest: manifest({
					name: 'app',
					dependencies: { 'git-dep': 'github:owner/repo#v1' },
				}),
				pnpmAllowlist: new Map(),
			}),
		);
		assert.equal(audit.violations.length, 1);
		assert.match(audit.violations[0], /git-dep@/);
		assert.match(audit.violations[0], /no entry in quality\/install-scripts\.json/);
		assert.equal(audit.findings[0].git_hosted, true);

		// The same manifest reached from the registry cannot run at install
		// time, so it needs no record.
		const registryAudit = auditInstallScripts(baseInput({ manifests: [gitManifest] }));
		assert.deepEqual(registryAudit.violations, []);
		assert.equal(registryAudit.summary.publish_time_only, 1);
	});

	it('treats a binding.gyp package as unreviewed install-time code', () => {
		const audit = auditInstallScripts(
			baseInput({
				manifests: [manifest({ name: 'native-pkg', requiresBuild: true })],
				policy: {
					version: 1,
					default_decision: 'block',
					packages: [
						{
							name: 'native-pkg',
							hooks: ['implicit:binding.gyp'],
							decision: 'allow',
							justification: 'fixture native build',
						},
					],
				},
				pnpmAllowlist: new Map([['native-pkg', ['allowBuilds']]]),
			}),
		);
		assert.deepEqual(audit.violations, []);
		assert.equal(audit.findings[0].implicit_build, true);

		const unreviewed = auditInstallScripts(
			baseInput({ manifests: [manifest({ name: 'native-pkg', requiresBuild: true })] }),
		);
		assert.equal(unreviewed.violations.length, 1);
		assert.match(unreviewed.violations[0], /implicit:binding\.gyp/);
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
		// pnpm writes this marker into a completed install; without it the
		// audit refuses to treat the directory as an installed tree.
		mkdirSync(join(root, 'node_modules', '.pnpm'), { recursive: true });
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

	const agreeingPolicy = {
		version: 1,
		default_decision: 'block',
		packages: [
			policyEntry({ observed_version: FIXTURE_VERSION }),
			{ name: '.', hooks: ['prepare'], decision: 'allow', justification: 'own codegen' },
		],
	};

	it('passes when the allow-list and the reviewed policy agree', () => {
		const root = stageRepo({
			packages,
			allowlist: 'allowBuilds:\n  fixture-pkg: true\n',
			policy: agreeingPolicy,
		});
		const result = runAudit(root);
		assert.deepEqual(result.inputErrors, []);
		assert.deepEqual(result.audit.violations, []);
		assert.equal(result.ok, true);
		assert.equal(result.audit.allowlist_source, 'allowBuilds');
	});

	it('fails when a dependency gains an install-time hook nobody reviewed', () => {
		const root = stageRepo({
			packages,
			allowlist: 'allowBuilds:\n  fixture-pkg: true\n',
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

	it('fails a grant that exists only in the legacy onlyBuiltDependencies list', () => {
		const root = stageRepo({
			packages,
			allowlist: 'onlyBuiltDependencies:\n  - fixture-pkg\n',
			policy: agreeingPolicy,
		});
		const result = runAudit(root);
		assert.equal(result.ok, false);
		assert.ok(
			result.audit.violations.some((violation) => /onlyBuiltDependencies lists it/.test(violation)),
			result.audit.violations.join('\n'),
		);
	});

	it('reports missing inputs instead of silently auditing nothing', () => {
		const root = mkdtempSync(join(tmpdir(), 'install-script-audit-empty-'));
		roots.push(root);
		const result = runAudit(root);
		assert.equal(result.ok, false);
		assert.equal(result.inputErrors.length, 4);
		assert.ok(result.inputErrors.every((line) => /required input not found/.test(line)));
	});

	it('refuses to pass on a tree that was never installed', () => {
		const root = stageRepo({
			packages: [],
			allowlist: 'onlyBuiltDependencies: []\n',
			policy: { version: 1, default_decision: 'block', packages: [] },
			rootScripts: {},
		});
		rmSync(join(root, 'node_modules'), { recursive: true, force: true });
		const result = runAudit(root);
		assert.equal(result.ok, false);
		assert.ok(
			result.inputErrors.some((line) => /node_modules/.test(line) && /pnpm install/.test(line)),
		);
	});

	it('refuses to pass on an empty or interrupted node_modules', () => {
		const root = stageRepo({
			packages: [],
			allowlist: 'onlyBuiltDependencies: []\n',
			policy: { version: 1, default_decision: 'block', packages: [] },
			rootScripts: {},
		});
		// `mkdir node_modules` is not an install: no marker, no manifest.
		rmSync(join(root, 'node_modules'), { recursive: true, force: true });
		mkdirSync(join(root, 'node_modules'), { recursive: true });
		const result = runAudit(root);
		assert.equal(result.ok, false);
		assert.ok(
			result.inputErrors.some((line) => /is not a pnpm installation/.test(line)),
			result.inputErrors.join('\n'),
		);

		// A marked but empty tree is refused too: 0 manifests must never
		// read as "0 install-time scripts, clean".
		mkdirSync(join(root, 'node_modules', '.pnpm'), { recursive: true });
		const emptyTree = runAudit(root);
		assert.equal(emptyTree.ok, false);
		assert.ok(
			emptyTree.inputErrors.some((line) => /holds no installed package manifest/.test(line)),
			emptyTree.inputErrors.join('\n'),
		);
	});

	it('writes only the JSON document to stdout in --json mode', () => {
		const root = stageRepo({
			packages,
			allowlist: 'allowBuilds:\n  fixture-pkg: true\n',
			policy: agreeingPolicy,
		});
		const run = spawnSync(process.execPath, [scriptPath, `--root=${root}`, '--json'], {
			encoding: 'utf8',
		});
		assert.equal(run.status, 0, run.stderr);
		const parsed = JSON.parse(run.stdout);
		assert.equal(parsed.summary.violations, 0);
		assert.equal(parsed.allowlist_source, 'allowBuilds');
		assert.match(run.stderr, /\[check-install-scripts\] OK:/);
	});

	after(() => {
		for (const root of roots) rmSync(root, { recursive: true, force: true });
	});
});
