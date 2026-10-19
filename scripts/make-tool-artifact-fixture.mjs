#!/usr/bin/env node
/**
 * Synthetic host repository for the Tool artefact inventory gate
 * (Issue #466).
 *
 * Usage:
 *   node scripts/make-tool-artifact-fixture.mjs .tmp/tool-artifact-fixture
 *   node scripts/make-tool-artifact-fixture.mjs .tmp/x --quiet
 *
 * Why a fixture
 * -------------
 * This repository is (correctly) never in a drifted state: both shipped
 * Tools carry a matching MIT license file and a lockfile, and the
 * reviewed record matches. A gate whose failure modes can only be seen
 * in a repository nobody is allowed to break is a gate nobody can
 * review. `scripts/make-provenance-fixture.mjs` (#473) established the
 * pattern; this is its counterpart for licenses, dependencies and
 * outbound references.
 *
 * The fixture is built with git plumbing and hand-written files only —
 * no network, no real Tool repository, no credential, and nothing that
 * touches a Cloudflare binding. `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM`
 * are neutralised and the commit dates are fixed, so every SHA and every
 * digest below is reproducible byte for byte.
 *
 * The five Tools, one per rule:
 *
 *   | tool                | what it proves                                    | verdict |
 *   | ------------------- | ------------------------------------------------- | ------- |
 *   | verified-widget     | MIT file + MIT claim + matching record            | PASS    |
 *   | rellicensed-widget  | AGPL-3.0 file, MIT claim                          | FAIL    |
 *   | unlicensed-widget   | no license file at all, `same_origin_static`      | FAIL    |
 *   | drifted-widget      | lockfile rewritten since the record was reviewed  | FAIL    |
 *   | shelved-widget      | `host_disabled`, no checkout — inventory-only     | INFO    |
 *
 * `unlicensed-widget` and `drifted-widget` also ship a collected
 * artefact under `dist/client/tools/<slug>/app/` so the outbound rule is
 * observable: `drifted-widget`'s bundle references a host that is not in
 * the reviewed set (a `warn` hold), and the reference is written with a
 * credential-shaped userinfo to prove the report reduces it to a bare
 * hostname.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = 'https://github.com/example-org';
const FIXED_DATE = '2026-01-01T00:00:00+00:00';

const SANDBOX_ENV = {
	...process.env,
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_SYSTEM: '/dev/null',
	GIT_AUTHOR_DATE: FIXED_DATE,
	GIT_COMMITTER_DATE: FIXED_DATE,
	GIT_AUTHOR_NAME: 'artifact-inventory fixture',
	GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
	GIT_COMMITTER_NAME: 'artifact-inventory fixture',
	GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

const MIT_TEXT = `MIT License

Copyright (c) 2026 example-org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.
`;

const AGPL_TEXT = `GNU AFFERO GENERAL PUBLIC LICENSE
Version 3, 19 November 2007

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.
`;

const LOCKFILE = `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      left-pad:
        specifier: ^1.3.0
        version: 1.3.0
`;

/** Drift the reviewed record away from the fixture's actual lockfile. */
const LOCKFILE_AFTER_REVIEW = `${LOCKFILE}    right-pad:
        specifier: ^1.0.0
        version: 1.0.0
`;

function gitIn(cwd, args) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: SANDBOX_ENV });
	if (result.status !== 0) {
		process.stderr.write(`fixture: git ${args.join(' ')} failed: ${result.stderr}\n`);
		process.exit(2);
	}
	return result.stdout.trim();
}

function writeToolCheckout(path, { licenseText, lockfileText, runtimeDependencies }) {
	mkdirSync(path, { recursive: true });
	gitIn(path, ['init', '-q', '-b', 'main']);
	if (licenseText !== null) writeFileSync(join(path, 'LICENSE'), licenseText);
	writeFileSync(
		join(path, 'package.json'),
		`${JSON.stringify({ name: 'widget', dependencies: runtimeDependencies }, null, 2)}\n`,
	);
	writeFileSync(join(path, 'index.html'), '<!doctype html><title>widget</title>\n');
	writeFileSync(join(path, lockfileText.name), lockfileText.body);
	gitIn(path, ['add', '-A']);
	gitIn(path, ['commit', '-q', '-m', 'widget: initial']);
	const sha = gitIn(path, ['rev-parse', 'HEAD']);
	gitIn(path, ['remote', 'add', 'origin', `${CANONICAL}/${basename(path)}.git`]);
	return sha;
}

/**
 * Write a collected artefact. The hostname is what the gate must print;
 * the userinfo, port and path are what it must discard.
 */
function writeArtifact(root, slug, body) {
	const dir = join(root, 'dist/client/tools', slug, 'app');
	mkdirSync(join(dir, 'assets'), { recursive: true });
	writeFileSync(join(dir, 'index.html'), `<!doctype html><title>${slug}</title>\n`);
	writeFileSync(join(dir, 'assets/app.js'), body);
}

const TOOLS = [
	{ slug: 'verified-widget', licenseText: MIT_TEXT, runtimeDependencies: { 'left-pad': '^1.3.0' } },
	{
		slug: 'relicensed-widget',
		licenseText: AGPL_TEXT,
		runtimeDependencies: { 'left-pad': '^1.3.0' },
	},
	{ slug: 'unlicensed-widget', licenseText: null, runtimeDependencies: { 'left-pad': '^1.3.0' } },
	{
		slug: 'drifted-widget',
		licenseText: MIT_TEXT,
		runtimeDependencies: { 'left-pad': '^1.3.0', 'right-pad': '^1.0.0' },
	},
	{ slug: 'shelved-widget', licenseText: null, runtimeDependencies: {}, inventoryOnly: true },
];

export function makeToolArtifactFixture(targetDir, { quiet = false } = {}) {
	const root = resolve(targetDir);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	gitIn(root, ['init', '-q', '-b', 'main']);
	mkdirSync(join(root, 'src/tools'), { recursive: true });

	const tools = [];
	const pins = new Map();
	for (const spec of TOOLS) {
		const checkoutPath = join(root, `external/${spec.slug}`);
		let sha;
		if (spec.inventoryOnly) {
			// No checkout at all: the manifest entry is inventory-only,
			// exactly like the 13 Tool entries this repository does not
			// fetch.
			// A pin no checkout can satisfy: the point of the entry is
			// that the recorded SHA is documentation, not evidence.
			sha = '0'.repeat(40);
		} else {
			sha = writeToolCheckout(checkoutPath, {
				licenseText: spec.licenseText,
				lockfileText: { name: 'pnpm-lock.yaml', body: LOCKFILE },
				runtimeDependencies: spec.runtimeDependencies,
			});
		}
		pins.set(spec.slug, sha);
		tools.push({
			slug: spec.slug,
			display_name: spec.slug,
			description: `Synthetic Tool for the Issue #466 inventory fixture (${spec.slug}).`,
			source: {
				canonical_repo: `${CANONICAL}/${spec.slug}.git`,
				submodule_path: `external/${spec.slug}`,
				pinned_sha: sha,
				branch: 'main',
			},
			build: { command: 'false', output_dir: 'dist', package_manager: 'pnpm' },
			delivery: spec.inventoryOnly
				? {
						kind: 'host_disabled',
						disabled_reason: 'Fixture entry with no checkout: inventory-only, nothing published.',
					}
				: {
						kind: 'same_origin_static',
						artifact_path: `/tools/${spec.slug}/app`,
						entry_html: `/tools/${spec.slug}/app/index.html`,
						iframe: { sandbox: 'allow-scripts', referrer_policy: 'no-referrer' },
					},
			classification: spec.inventoryOnly ? 'needs_tool_side_fix' : 'same_origin_static',
			license: 'MIT',
		});
	}

	writeFileSync(
		join(root, 'src/tools/manifest.json'),
		`${JSON.stringify({ version: 1, tools }, null, 2)}\n`,
	);
	writeFileSync(
		join(root, '.gitmodules'),
		TOOLS.filter((spec) => !spec.inventoryOnly)
			.map(
				(spec) =>
					`[submodule "external/${spec.slug}"]\n\tpath = external/${spec.slug}\n\turl = ${CANONICAL}/${spec.slug}.git\n`,
			)
			.join(''),
	);
	writeFileSync(join(root, 'README.md'), '# synthetic tool artifact inventory fixture\n');

	gitIn(root, ['add', 'README.md', '.gitmodules', 'src/tools/manifest.json']);
	for (const spec of TOOLS) {
		if (spec.inventoryOnly) continue;
		gitIn(root, [
			'update-index',
			'--add',
			'--cacheinfo',
			`160000,${pins.get(spec.slug)},external/${spec.slug}`,
		]);
	}
	gitIn(root, ['commit', '-q', '-m', 'host: pin the fixture tools']);

	// A reviewed record that was written BEFORE the dependency drift: the
	// recorded digests are the ones a reviewer saw, while
	// `drifted-widget`'s checkout now carries a rewritten lockfile.
	const toolsRecord = {};
	for (const spec of TOOLS) {
		const sha = pins.get(spec.slug);
		if (spec.inventoryOnly) {
			toolsRecord[spec.slug] = {
				pinned_sha: sha,
				license: {
					status: 'unverified',
					evidence_file: null,
					evidence_sha256: null,
					detected: [],
				},
				dependencies: {
					status: 'unverified',
					lockfile: null,
					lockfile_sha256: null,
					runtime: [],
				},
				outbound: { observed: false, hosts: [] },
			};
			continue;
		}
		toolsRecord[spec.slug] = {
			pinned_sha: sha,
			license: {
				status: spec.slug === 'relicensed-widget' ? 'unverified' : 'verified',
				evidence_file: spec.licenseText === null ? null : 'LICENSE',
				evidence_sha256:
					spec.licenseText === null
						? null
						: digestOfFile(join(root, `external/${spec.slug}/LICENSE`)),
				detected: spec.slug === 'relicensed-widget' ? ['MIT'] : ['MIT'],
			},
			dependencies: {
				status: 'verified',
				lockfile: 'pnpm-lock.yaml',
				lockfile_sha256: sha256(LOCKFILE),
				// `drifted-widget`'s reviewed set predates the rewrite, so
				// the finding can name what the rewrite added.
				runtime:
					spec.slug === 'drifted-widget'
						? ['left-pad']
						: Object.keys(spec.runtimeDependencies).sort(),
			},
			outbound: {
				observed: spec.slug === 'verified-widget',
				hosts: spec.slug === 'verified-widget' ? ['example.com'] : [],
			},
		};
	}
	writeFileSync(
		join(checkoutPathOf(root, 'drifted-widget'), 'pnpm-lock.yaml'),
		LOCKFILE_AFTER_REVIEW,
	);
	mkdirSync(join(root, 'quality'), { recursive: true });
	writeFileSync(
		join(root, 'quality/tool-artifact-inventory.json'),
		`${JSON.stringify(
			{
				schema: 1,
				generated_by: 'fixture (reviewed before the dependency drift)',
				note: 'Synthetic reviewed record for the Issue #466 fixture.',
				tools: toolsRecord,
			},
			null,
			2,
		)}\n`,
	);

	writeArtifact(root, 'verified-widget', 'export const docs = "https://example.com/readme";\n');
	writeArtifact(
		root,
		'drifted-widget',
		// The userinfo below is a credential SHAPE, not a credential: it
		// exists so the report can prove it reduces a URL to a hostname.
		'fetch("https://tracker.example.invalid:pw-fixture@metrics.example.org/collect");\nexport const docs = "https://example.com/readme";\n',
	);

	gitIn(root, ['add', '-A']);
	gitIn(root, [
		'commit',
		'-q',
		'-m',
		'fixture: reviewed record, collected artefacts, dependency drift',
	]);

	if (!quiet) {
		process.stdout.write(`fixture written: ${root}\n`);
	}
	return root;
}

function checkoutPathOf(root, slug) {
	return join(root, 'external', slug);
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

/** sha256 of a file's bytes — the same input the gate digests. */
function digestOfFile(path) {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function invokedAsScript() {
	const entry = process.argv[1];
	return entry !== undefined && resolve(entry) === resolve(fileURLToPath(import.meta.url));
}

if (invokedAsScript()) {
	const positional = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
	if (positional === undefined && !process.argv.includes('--quiet')) {
		process.stderr.write('usage: node scripts/make-tool-artifact-fixture.mjs <dir> [--quiet]\n');
		process.exit(2);
	}
	const dir = positional ?? mkdtempSync(join(tmpdir(), 'tool-artifact-'));
	makeToolArtifactFixture(dir, { quiet: process.argv.includes('--quiet') });
}
