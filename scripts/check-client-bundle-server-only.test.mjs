import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const checker = resolve('scripts/check-client-bundle-server-only.mjs');

/**
 * The policy fixture. The prefixes are written the way the repository
 * spells the paths (`src/cloudflare/auth/`), because a policy file is
 * read by humans comparing it against the repository tree.
 */
const POLICY = {
	schema_version: 1,
	server_only_packages: ['better-auth', 'kysely'],
	server_only_module_prefixes: ['src/cloudflare/auth/'],
};

/**
 * Write a bundle graph whose chunks carry the given module ids.
 *
 * The ids use the shape `scripts/_client-bundle-graph.mjs` produces:
 * `src:<path relative to src/>` for a repository file and `pkg:<name>`
 * for a package.
 *
 * @param {string} dir directory to write into
 * @param {Record<string, string[]>} modulesByChunk module ids per chunk
 * @returns {Promise<string>} the graph path
 */
async function writeGraph(dir, modulesByChunk) {
	const chunks = {};
	for (const [fileName, modules] of Object.entries(modulesByChunk)) {
		chunks[fileName] = {
			name: fileName,
			is_entry: true,
			bytes: 1,
			gzip_bytes: 1,
			imports: [],
			css: [],
			modules,
		};
	}
	const graphPath = resolve(dir, 'bundle-graph.json');
	await writeFile(graphPath, `${JSON.stringify({ schema_version: 1, chunks }, null, '\t')}\n`);
	return graphPath;
}

/**
 * Write the policy file used by the fixtures.
 *
 * @param {string} dir directory to write into
 * @returns {Promise<string>} the policy path
 */
async function writePolicy(dir) {
	const policyPath = resolve(dir, 'policy.json');
	await writeFile(policyPath, `${JSON.stringify(POLICY, null, '\t')}\n`);
	return policyPath;
}

/**
 * Run the gate against a graph / policy pair.
 *
 * @param {string} graphPath graph path
 * @param {string} policyPath policy path
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function runGate(graphPath, policyPath) {
	return spawnSync(
		process.execPath,
		[checker, `--graph=${graphPath}`, `--policy=${policyPath}`, '--json'],
		{ encoding: 'utf8' },
	);
}

test('passes when no server-only module is in the bundle', async (t) => {
	const dir = await mkdtemp(resolve(tmpdir(), 'my-web-server-only-ok-'));
	t.after(() => rm(dir, { recursive: true, force: true }));

	const graphPath = await writeGraph(dir, {
		'assets/index-a.js': ['src:home/composer.tsx', 'pkg:react-dom', 'pkg:zod'],
	});
	const policyPath = await writePolicy(dir);

	const result = runGate(graphPath, policyPath);

	assert.equal(result.status, 0);
	const report = JSON.parse(result.stdout);
	assert.equal(report.verdict, 'pass');
	assert.deepEqual(report.offenders, []);
});

test('fails and names the module when a server-only package is in the bundle', async (t) => {
	const dir = await mkdtemp(resolve(tmpdir(), 'my-web-server-only-pkg-'));
	t.after(() => rm(dir, { recursive: true, force: true }));

	const graphPath = await writeGraph(dir, {
		'assets/index-a.js': ['src:home/composer.tsx', 'pkg:kysely'],
	});
	const policyPath = await writePolicy(dir);

	const result = runGate(graphPath, policyPath);

	assert.equal(result.status, 1);
	const report = JSON.parse(result.stdout);
	assert.equal(report.verdict, 'fail');
	assert.equal(report.offenders.length, 1);
	assert.equal(report.offenders[0].module, 'pkg:kysely');
	assert.match(report.offenders[0].rule, /package kysely/);
	assert.deepEqual(report.offenders[0].chunks, ['assets/index-a.js']);
});

test('fails and names the module when a server-only source path is in the bundle', async (t) => {
	const dir = await mkdtemp(resolve(tmpdir(), 'my-web-server-only-src-'));
	t.after(() => rm(dir, { recursive: true, force: true }));

	const graphPath = await writeGraph(dir, {
		'assets/index-a.js': ['src:cloudflare/auth/better-auth.ts'],
	});
	const policyPath = await writePolicy(dir);

	const result = runGate(graphPath, policyPath);

	assert.equal(result.status, 1);
	const report = JSON.parse(result.stdout);
	assert.equal(report.offenders.length, 1);
	assert.equal(report.offenders[0].module, 'src:cloudflare/auth/better-auth.ts');
	assert.match(report.offenders[0].rule, /source path src\/cloudflare\/auth\//);
});

test('fails for a lazy chunk too — a server-only chunk is still shipped to every edge', async (t) => {
	const dir = await mkdtemp(resolve(tmpdir(), 'my-web-server-only-lazy-'));
	t.after(() => rm(dir, { recursive: true, force: true }));

	const graphPath = await writeGraph(dir, {
		'assets/index-a.js': ['src:home/composer.tsx'],
		'assets/lazy-b.js': ['pkg:better-auth'],
	});
	const policyPath = await writePolicy(dir);

	const result = runGate(graphPath, policyPath);

	assert.equal(result.status, 1);
	const report = JSON.parse(result.stdout);
	assert.deepEqual(report.offenders[0].chunks, ['assets/lazy-b.js']);
});

test('exits 2 when the graph is missing', async (t) => {
	const dir = await mkdtemp(resolve(tmpdir(), 'my-web-server-only-missing-'));
	t.after(() => rm(dir, { recursive: true, force: true }));

	const policyPath = await writePolicy(dir);
	const result = runGate(resolve(dir, 'does-not-exist.json'), policyPath);

	assert.equal(result.status, 2);
	assert.match(result.stderr, /client bundle graph not found/);
});

test('exits 2 when the policy is malformed', async (t) => {
	const dir = await mkdtemp(resolve(tmpdir(), 'my-web-server-only-policy-'));
	t.after(() => rm(dir, { recursive: true, force: true }));

	const graphPath = await writeGraph(dir, { 'assets/index-a.js': ['src:home/composer.tsx'] });
	const policyPath = resolve(dir, 'policy.json');
	await writeFile(policyPath, `${JSON.stringify({ server_only_packages: 'better-auth' })}\n`);

	const result = runGate(graphPath, policyPath);

	assert.equal(result.status, 2);
	assert.match(result.stderr, /server_only_packages must be an array of strings/);
});
