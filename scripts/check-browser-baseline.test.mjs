/**
 * `scripts/check-browser-baseline.mjs` — fixture suite (Issue #414).
 *
 * Every rule the Web feature adoption gate claims to enforce is proven
 * here against a synthetic repository laid out in a temp directory, plus
 * one assertion against the real repository. The fixtures are the
 * verifiable artefact the Issue asks for: a reader can see, without
 * running the shipped code against the shipped surfaces, what "fails",
 * what "warns", and which mistakes are impossible to pass silently.
 *
 * `node --test scripts/check-browser-baseline.test.mjs`
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ManifestError, formatReport, loadManifest, runCheck } from './check-browser-baseline.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(REPO_ROOT, 'scripts/check-browser-baseline.mjs');

const SUPPORT_HIGH = {
	chrome: '129',
	edge: '129',
	firefox: '131',
	safari: '18',
	safari_ios: '18',
};

function datasetBaseline(baseline, overrides = {}) {
	return {
		feature_id: 'fixture-feature',
		baseline,
		baseline_low_date: baseline === false ? null : '2024-05-13',
		baseline_high_date: baseline === 'high' ? '2024-09-14' : null,
		support: SUPPORT_HIGH,
		...overrides,
	};
}

function fixtureManifest(overrides = {}) {
	return {
		schema_version: 1,
		policy: {
			bar: 'baseline-widely-available',
			target_browsers: [
				{ id: 'chrome', label: 'Chrome', role: 'Baseline core', floor: '129' },
				{ id: 'edge', label: 'Edge', role: 'Baseline core', floor: '129' },
				{ id: 'firefox', label: 'Firefox', role: 'Baseline core', floor: '131' },
				{ id: 'safari', label: 'Safari', role: 'Baseline core', floor: '18' },
				{ id: 'safari_ios', label: 'Safari on iOS', role: 'mobile', floor: '18' },
			],
		},
		dataset: {
			name: 'web-features',
			source_url: 'https://example.invalid/web-features/data.json',
			snapshot_date: '2026-10-18',
			browsers: {
				chrome: { name: 'Chrome', releases: [{ date: '2024-09-17', version: '129' }] },
				edge: { name: 'Edge', releases: [{ date: '2024-09-19', version: '129' }] },
				firefox: { name: 'Firefox', releases: [{ date: '2024-10-01', version: '131' }] },
				safari: { name: 'Safari', releases: [{ date: '2024-09-16', version: '18' }] },
				safari_ios: { name: 'Safari iOS', releases: [{ date: '2024-09-16', version: '18' }] },
			},
		},
		scan: {
			coverage_root: 'src',
			extensions: ['.ts', '.tsx', '.css'],
			exclude: ['**/*.test.ts'],
		},
		surfaces: [{ id: 'routes', root: 'src/routes', min_files: 1, role: 'file routes' }],
		features: [],
		guarded_features: [],
		...overrides,
	};
}

function fixtureFeature(overrides = {}) {
	return {
		id: 'fixture-feature',
		label: 'fixture feature',
		kind: 'css',
		detect: ['fixture-marker'],
		dataset: datasetBaseline('high'),
		fallback: null,
		...overrides,
	};
}

/** Write a synthetic repository and return its root. */
function makeFixture({ manifest, files }, t) {
	const root = mkdtempSync(join(tmpdir(), 'my-web-baseline-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [path, content] of Object.entries(files)) {
		writeFixtureFile(root, path, content);
	}
	writeFixtureFile(
		root,
		'quality/browser-baseline.json',
		`${JSON.stringify(manifest, null, '\t')}\n`,
	);
	return root;
}

function writeFixtureFile(root, path, content) {
	const abs = join(root, path);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, content);
}

function check(t, options) {
	const root = makeFixture(options, t);
	return runCheck({ root, manifestPath: 'quality/browser-baseline.json' });
}

const rules = (result) => result.errors.map((entry) => entry.rule);

/* ------------------------------------------------------------------ *
 * the shipped repository
 * ------------------------------------------------------------------ */

test('the real repository passes the gate and reports its below-bar adoptions as warnings', () => {
	const result = runCheck();

	assert.deepEqual(result.errors, []);
	assert.equal(result.stats.uncovered, 0);
	assert.ok(result.stats.belowBar >= 1, 'the repo must exercise the below-the-bar path');
	assert.ok(
		result.warnings.every((warning) => warning.rule === 'below_baseline_with_fallback'),
		'every warning must be a below-the-bar adoption with a verified fallback',
	);
	for (const row of result.rows) {
		assert.ok(row.hits.length > 0, `${row.id} is declared but never detected`);
		if (row.belowBar) {
			assert.equal(row.fallback.kind, 'progressive');
			assert.ok(row.fallbackEvidence.length > 0, `${row.id} has no verified fallback evidence`);
		}
	}
	for (const guarded of result.guardedRows) {
		assert.equal(guarded.hits.length, 0, `${guarded.id} is guarded but used`);
	}
	for (const floor of result.targets.floors) {
		assert.ok(floor.declared >= floor.implied, `${floor.id} floor is below the Baseline bar`);
	}
});

test('the CLI entry point exits 0 on the real repository and prints the machine-readable form', () => {
	const result = spawnSync(process.execPath, [CHECKER, '--json'], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr);
	const parsed = JSON.parse(result.stdout);
	assert.equal(parsed.ok, true);
	assert.ok(parsed.rows.length > 0);

	const human = spawnSync(process.execPath, [CHECKER], { cwd: REPO_ROOT, encoding: 'utf8' });
	assert.equal(human.status, 0);
	assert.match(human.stdout, /target browsers \(Baseline Widely available/);
	assert.match(human.stdout, /guarded features \(not adopted/);
});

/* ------------------------------------------------------------------ *
 * below the bar: warn with a fallback, fail without one
 * ------------------------------------------------------------------ */

test('a below-bar feature adopted without a declared fallback fails', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({
			features: [fixtureFeature({ dataset: datasetBaseline('low'), fallback: null })],
		}),
		files: { 'src/routes/index.tsx': 'const el = "fixture-marker";\n' },
	});

	assert.ok(rules(result).includes('fallback_required'));
	assert.match(
		result.errors.find((entry) => entry.rule === 'fallback_required').message,
		/needs|without a declared/,
	);
});

test('a below-bar feature with verified fallback evidence warns instead of failing', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({
			features: [
				fixtureFeature({
					dataset: datasetBaseline(false),
					fallback: {
						kind: 'progressive',
						strategy:
							'Progressive enhancement: the supported declaration comes first and the unknown value is dropped at parse time, so the previous rendering stays.',
						evidence: [
							{
								file: 'src/routes/styles.css',
								pattern: 'word-break: normal;',
								precedes: true,
								proves: 'the fallback is a live declaration before the enhancement',
							},
						],
					},
				}),
			],
		}),
		files: {
			'src/routes/styles.css': ':where(body) {\n\tword-break: normal;\n\tfixture-marker: yes;\n}\n',
		},
	});

	assert.deepEqual(result.errors, []);
	const belowBar = result.warnings.filter((entry) => entry.rule === 'below_baseline_with_fallback');
	assert.equal(belowBar.length, 1);
	assert.match(belowBar[0].message, /progressive fallback/);
	assert.equal(result.rows[0].fallbackEvidence.length, 1);
});

test('a declared fallback whose evidence pattern disappeared fails instead of warning forever', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({
			features: [
				fixtureFeature({
					dataset: datasetBaseline('low'),
					fallback: {
						kind: 'progressive',
						strategy:
							'Progressive enhancement: the supported declaration comes first and the unknown value is dropped at parse time, so the previous rendering stays.',
						evidence: [
							{
								file: 'src/routes/styles.css',
								pattern: 'word-break: normal;',
								proves: 'the fallback is a live declaration',
							},
						],
					},
				}),
			],
		}),
		files: { 'src/routes/styles.css': '/* the fallback declaration was deleted */\n' },
	});

	assert.ok(rules(result).includes('fallback_evidence_missing'));
});

test('a fallback declared after the enhancement fails the ordering check', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({
			features: [
				fixtureFeature({
					dataset: datasetBaseline('low'),
					fallback: {
						kind: 'progressive',
						strategy:
							'Progressive enhancement: the supported declaration comes first and the unknown value is dropped at parse time, so the previous rendering stays.',
						evidence: [
							{
								file: 'src/routes/styles.css',
								pattern: 'word-break: normal;',
								precedes: true,
								proves: 'the fallback precedes the enhancement',
							},
						],
					},
				}),
			],
		}),
		files: {
			'src/routes/styles.css':
				'.fixture-marker { word-break: auto-phrase; }\nword-break: normal;\n',
		},
	});

	assert.ok(rules(result).includes('fallback_evidence_unordered'));
});

test('a web-api feature may not declare a progressive CSS fallback', (t) => {
	assert.throws(
		() =>
			loadManifest(
				writeTempManifest(
					fixtureManifest({
						features: [
							fixtureFeature({
								kind: 'web-api',
								fallback: {
									kind: 'progressive',
									strategy: 'x'.repeat(60),
									evidence: [],
								},
							}),
						],
					}),
					t,
				),
			),
		ManifestError,
	);
});

/* ------------------------------------------------------------------ *
 * guarded features
 * ------------------------------------------------------------------ */

test('using a guarded feature fails until it is registered with a fallback', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({
			features: [fixtureFeature()],
			guarded_features: [
				{
					id: 'webgpu',
					label: '`navigator.gpu`',
					detect: ['navigator\\.gpu'],
					dataset: datasetBaseline(false, { feature_id: 'webgpu' }),
					rationale: 'Firefox has no implementation, so a required feature cannot fall back.',
				},
			],
		}),
		files: {
			'src/routes/index.tsx':
				'const adapter = await navigator.gpu.requestAdapter();\n// fixture-marker\n',
		},
	});

	const failure = result.errors.find((entry) => entry.rule === 'guarded_feature_adopted');
	assert.ok(failure, 'a guarded feature must fail when it appears');
	assert.match(failure.message, /Firefox has no implementation/);
});

/* ------------------------------------------------------------------ *
 * silent-pass guards
 * ------------------------------------------------------------------ */

test('a declared feature that is no longer used fails (declaration drift)', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({ features: [fixtureFeature()] }),
		files: { 'src/routes/index.tsx': 'export const Home = () => null;\n' },
	});

	assert.ok(rules(result).includes('feature_not_detected'));
});

test('a surface that matches no file fails instead of scanning nothing and passing', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({ features: [fixtureFeature()] }),
		files: { 'src/other/page.tsx': '// fixture-marker\n' },
	});

	assert.ok(rules(result).includes('surface_empty'));
	assert.ok(rules(result).includes('surface_uncovered'));
});

test('a source file owned by no declared surface fails (an unregistered surface cannot escape the gate)', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({ features: [fixtureFeature()] }),
		files: {
			'src/routes/index.tsx': '// fixture-marker\n',
			'src/new-feature/widget.tsx': '// a surface nobody declared\n',
		},
	});

	const failure = result.errors.find((entry) => entry.rule === 'surface_uncovered');
	assert.ok(failure);
	assert.match(failure.message, /src\/new-feature\/widget\.tsx/);
});

test('a false-positive waiver that stops matching anything fails', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({
			features: [
				fixtureFeature({
					detect: ['AsyncLocalStorage'],
					allow: [
						{
							file: 'src/routes/*.tsx',
							pattern: 'AsyncLocalStorage',
							reason: 'fixture: the comment is not a Web API adoption',
						},
					],
				}),
			],
		}),
		files: { 'src/routes/index.tsx': '// fixture-marker\n' },
	});

	const failure = result.errors.find((entry) => entry.rule === 'allow_unused');
	assert.ok(failure);
	assert.match(failure.message, /suppresses nothing/);
});

test('a live false-positive waiver suppresses only its own occurrences and is reported', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({
			features: [
				fixtureFeature({
					detect: ['AsyncLocalStorage'],
					allow: [
						{
							file: 'src/routes/*.tsx',
							pattern: 'AsyncLocalStorage context',
							reason: 'fixture: the prose mention is not a Web API adoption',
						},
					],
				}),
			],
		}),
		files: {
			'src/routes/index.tsx':
				"// fixture-marker\n// TanStack Start's AsyncLocalStorage context.\nconst scope = new AsyncLocalStorage();\n",
		},
	});

	assert.deepEqual(result.errors, []);
	assert.equal(result.stats.suppressed, 1);
	assert.equal(result.rows[0].hits.length, 1);
});

test('a declaration whose every occurrence is waived fails, so a dead entry cannot linger', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({
			features: [
				fixtureFeature({
					detect: ['AsyncLocalStorage'],
					allow: [
						{
							file: 'src/routes/*.tsx',
							pattern: 'AsyncLocalStorage',
							reason: 'fixture: prose mention only',
						},
					],
				}),
			],
		}),
		files: { 'src/routes/index.tsx': '// fixture-marker\n// AsyncLocalStorage context.\n' },
	});

	const failure = result.errors.find((entry) => entry.rule === 'feature_not_detected');
	assert.ok(failure);
	assert.match(failure.message, /no unsuppressed occurrence/);
});

test('a repository-wide waiver is rejected at manifest load', (t) => {
	assert.throws(
		() =>
			loadManifest(
				writeTempManifest(
					fixtureManifest({
						features: [
							fixtureFeature({
								allow: [{ file: '**', pattern: 'anything', reason: 'fixture: too broad' }],
							}),
						],
					}),
					t,
				),
			),
		ManifestError,
	);
});

test('a declared target-browser floor below the Baseline bar fails', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({
			features: [fixtureFeature()],
			policy: {
				bar: 'baseline-widely-available',
				target_browsers: [{ id: 'chrome', label: 'Chrome', role: 'Baseline core', floor: '90' }],
			},
		}),
		files: { 'src/routes/index.tsx': '// fixture-marker\n' },
	});

	const failure = result.errors.find((entry) => entry.rule === 'target_floor_below_bar');
	assert.ok(failure);
	assert.match(
		failure.message,
		/declared target Chrome floor 90 .* below the Baseline Widely available bar/,
	);
});

test('the floor comparison reports itself as unverifiable instead of switching off when nothing is above the bar', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({
			features: [
				fixtureFeature({ dataset: datasetBaseline('high', { baseline_high_date: null }) }),
			],
			policy: {
				bar: 'baseline-widely-available',
				target_browsers: [{ id: 'chrome', label: 'Chrome', role: 'Baseline core', floor: '1' }],
			},
		}),
		files: { 'src/routes/index.tsx': '// fixture-marker\n' },
	});

	assert.deepEqual(rules(result), []);
	assert.equal(result.targets.latest, null);
	assert.deepEqual(
		result.targets.floors.map((floor) => floor.implied),
		[null],
	);
	const warning = result.warnings.find((entry) => entry.rule === 'target_floor_unverifiable');
	assert.ok(warning, 'a floor comparison that cannot run must not pass silently');
	assert.match(warning.message, /cannot be verified/);
});

test('a path claimed by two surfaces fails instead of being scanned and counted twice', (t) => {
	const result = check(t, {
		manifest: fixtureManifest({
			features: [fixtureFeature()],
			surfaces: [
				{ id: 'routes', root: 'src/routes', min_files: 1, role: 'fixture routes' },
				{ id: 'shared', files: ['src/routes/index.tsx'], min_files: 1, role: 'duplicate owner' },
			],
		}),
		files: { 'src/routes/index.tsx': '// fixture-marker\n' },
	});

	const failure = result.errors.find((entry) => entry.rule === 'surface_file_duplicate');
	assert.ok(failure);
	assert.match(failure.message, /src\/routes\/index\.tsx \(routes \+ shared\)/);
	assert.equal(result.stats.duplicates, 1);
	assert.equal(result.stats.files, 1, 'a duplicated path must be counted once');
});

test('an unusable manifest exits 2 with a message instead of passing', () => {
	const root = mkdtempSync(join(tmpdir(), 'my-web-baseline-broken-'));
	try {
		writeFixtureFile(
			root,
			'quality/browser-baseline.json',
			JSON.stringify(fixtureManifest({ schema_version: 99 })),
		);
		assert.throws(
			() => runCheck({ root, manifestPath: 'quality/browser-baseline.json' }),
			ManifestError,
		);
		const result = spawnSync(process.execPath, [CHECKER, '--dataset'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		});
		assert.equal(result.status, 2);
		assert.match(result.stderr, /--dataset requires a path/);

		const missing = spawnSync(process.execPath, [CHECKER, '--dataset', '/nonexistent/data.json'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		});
		assert.equal(missing.status, 2);
		assert.match(missing.stderr, /cannot read the web-features dataset/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

/* ------------------------------------------------------------------ *
 * dataset drift
 * ------------------------------------------------------------------ */

test('--dataset re-verifies the vendored snapshot and reports drift', (t) => {
	const root = makeFixture(
		{
			manifest: fixtureManifest({ features: [fixtureFeature()] }),
			files: { 'src/routes/index.tsx': '// fixture-marker\n' },
		},
		t,
	);
	const datasetPath = join(root, 'data.json');
	writeFileSync(
		datasetPath,
		JSON.stringify({
			features: {
				'fixture-feature': {
					status: {
						baseline: 'low',
						baseline_low_date: '2025-01-01',
						support: { ...SUPPORT_HIGH, chrome: '100' },
					},
				},
			},
		}),
	);

	const result = runCheck({ root, manifestPath: 'quality/browser-baseline.json', datasetPath });
	assert.ok(
		result.datasetDrift.length >= 4,
		`expected several drift entries, got ${result.datasetDrift.length}`,
	);
	assert.ok(result.datasetDrift.some((entry) => entry.includes('dataset.baseline is "high"')));
	assert.ok(
		result.datasetDrift.some((entry) =>
			entry.includes('support.chrome is "129", dataset says "100"'),
		),
	);
	assert.match(formatReport(result), /dataset verification: \d+ drift\(s\)/);
});

/** Write a manifest to a temp file and return its path (loadManifest input). */
function writeTempManifest(manifest, t) {
	const dir = mkdtempSync(join(tmpdir(), 'my-web-baseline-manifest-'));
	t?.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, 'browser-baseline.json');
	writeFileSync(path, JSON.stringify(manifest));
	return path;
}
