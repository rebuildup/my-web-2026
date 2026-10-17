import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * Fixture tests for `scripts/check-storybook-ownership.mjs` (Issue #509).
 *
 * The checker is a static graph walk, so the only honest way to test it
 * is to hand it two trees: one where a feature-local UI story stays
 * inside its own obligation, and one where the same story reaches a
 * foreign boundary. Everything is generated under a temp directory —
 * a fixture that only passes because of the checked-in `src/` would
 * prove nothing about the rule.
 *
 * Each case also pins one of the four verdicts the report has to
 * distinguish: pass / fail / not run / not applicable.
 */

const checker = resolve('scripts/check-storybook-ownership.mjs');
const tempRoots = [];

/** A Storybook config that declares the same story glob the repo uses. */
const STORYBOOK_CONFIG = `import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
\tstories: ['../src/**/*.stories.@(ts|tsx)'],
\tframework: { name: '@storybook/react-vite', options: {} },
};

export default config;
`;

async function fixture(files) {
	const root = await mkdtemp(join(tmpdir(), 'my-web-storybook-ownership-'));
	tempRoots.push(root);
	await mkdir(join(root, '.storybook'), { recursive: true });
	await writeFile(join(root, '.storybook', 'main.ts'), STORYBOOK_CONFIG, 'utf8');
	for (const [path, contents] of Object.entries(files)) {
		const absolute = join(root, path);
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, contents, 'utf8');
	}
	return root;
}

function run(root, extraArgs = []) {
	const jsonPath = join(root, 'report.json');
	const result = spawnSync(
		process.execPath,
		[checker, `--root=${root}`, `--json=${jsonPath}`, ...extraArgs],
		{ encoding: 'utf8' },
	);
	return { status: result.status, stdout: result.stdout, stderr: result.stderr, jsonPath };
}

function readReport(jsonPath) {
	return JSON.parse(readFileSync(jsonPath, 'utf8'));
}

after(async () => {
	for (const root of tempRoots) await rm(root, { recursive: true, force: true });
});

describe('storybook ownership check — independent UI passes', () => {
	it('passes when the story closure stays inside the owning obligation', async () => {
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import type { Meta, StoryObj } from '@storybook/react';
import { StatusTiles } from './tiles';
import type { SystemService } from './health';

const meta = { title: 'home/StatusTiles', component: StatusTiles } satisfies Meta<typeof StatusTiles>;
export default meta;
export type Story = StoryObj<typeof meta>;
`,
			'src/home/status/tiles.tsx': `import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import type { SystemService } from './health';

export function StatusTiles({ services }: { services: readonly SystemService[] }) {
	return <section className={css({ display: 'flex' })}>{services.length}<Badge /></section>;
}
`,
			'src/home/status/health.ts': 'export interface SystemService { id: string }\n',
			'src/editorial/primitives/Badge.tsx':
				'export function Badge() { return <span>badge</span>; }\n',
		});

		const result = run(root);
		assert.equal(result.status, 0);
		const report = readReport(result.jsonPath);
		assert.equal(report.verdict, 'pass');
		assert.equal(report.counts.pass, 1);
		assert.equal(report.counts.fail, 0);
		assert.equal(report.counts.notRun, 0);
		// The generated Panda layer (`styled-system/`) is a terminal
		// leaf: neither a violation nor an unresolvable edge.
		assert.deepEqual(report.subjects[0].unresolved, []);
		assert.match(result.stdout, /summary: 1 subject\(s\) — pass 1 \/ fail 0 \/ not run 0/);
	});

	it('treats a type-only import of the HTTP boundary as an allowed edge', async () => {
		// AGENTS.md §3 registers `home → http` as an `import type`-only
		// edge; `verbatimModuleSyntax` erases it, so it must not be read
		// as a runtime reach into the external boundary.
		const root = await fixture({
			'src/home/reactions/widget.stories.tsx': `import { ReactionsWidget } from './widget';

export default { component: ReactionsWidget };
`,
			'src/home/reactions/widget.tsx': `import type { ReactionAggregate } from '../../http/reactions/schema';

export function ReactionsWidget({ rows }: { rows: readonly ReactionAggregate[] }) {
	return <ul>{rows.length}</ul>;
}
`,
			'src/http/reactions/schema.ts':
				'export interface ReactionAggregate { slug: string; count: number }\n',
		});

		const result = run(root);
		assert.equal(result.status, 0);
		assert.equal(readReport(result.jsonPath).verdict, 'pass');
	});

	it('stops at the server-function seam instead of walking its handler imports', async () => {
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { StatusTiles } from './tiles';

export default { component: StatusTiles };
`,
			'src/home/status/tiles.tsx': `import { addHomeReaction } from './load';

export function StatusTiles() {
	return <button onClick={() => addHomeReaction()} />;
}
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { env } from 'cloudflare:workers';
import { probeCloudflareHealth } from '../../cloudflare/health';

export const addHomeReaction = createServerFn({ method: 'POST' }).handler(async () => {
\tawait probeCloudflareHealth(env.DB);
});
`,
			'src/cloudflare/health.ts': 'export async function probeCloudflareHealth() {}\n',
		});

		const result = run(root);
		assert.equal(result.status, 0);
		const report = readReport(result.jsonPath);
		assert.equal(report.verdict, 'pass');
		assert.equal(report.subjects[0].seams.length, 1);
		assert.match(report.subjects[0].seams[0].edge, /load$/);
	});
});

describe('storybook ownership check — foreign boundaries fail', () => {
	const cases = [
		{
			name: 'a transitive route import',
			boundary: 'routes',
			files: {
				'src/home/composer.stories.tsx': `import { HomePage } from './composer';

export default { component: HomePage };
`,
				'src/home/composer.tsx': `import { route } from '../routes/index';

export function HomePage() {
	return <main>{String(route)}</main>;
}
`,
				'src/routes/index.tsx': 'export const route = { id: "/" };\n',
			},
		},
		{
			name: 'a transitive Cloudflare binding import',
			boundary: 'cloudflare',
			files: {
				'src/home/status/tiles.stories.tsx': `import { StatusTiles } from './tiles';

export default { component: StatusTiles };
`,
				'src/home/status/tiles.tsx': `import { probeCloudflareHealth } from '../../cloudflare/health';

export function StatusTiles() {
	return <main>{String(probeCloudflareHealth)}</main>;
}
`,
				'src/cloudflare/health.ts': 'export async function probeCloudflareHealth() {}\n',
			},
		},
		{
			name: 'the Worker entrypoint',
			boundary: 'entrypoint',
			files: {
				'src/home/hero.stories.tsx': `import { Hero } from './hero';

export default { component: Hero };
`,
				'src/home/hero.tsx': `import worker from '../server';

export function Hero() {
	return <main>{String(worker)}</main>;
}
`,
				'src/server.ts': 'export default { fetch: () => new Response("ok") };\n',
			},
		},
		{
			name: 'the external HTTP boundary',
			boundary: 'http',
			files: {
				'src/home/access/tiles.stories.tsx': `import { CounterTile } from './tiles';

export default { component: CounterTile };
`,
				'src/home/access/tiles.tsx': `import { app } from '../../http/hono';

export function CounterTile() {
	return <main>{String(app)}</main>;
}
`,
				'src/http/hono.ts': 'export const app = { routes: [] };\n',
			},
		},
		{
			name: 'the Workers virtual module',
			boundary: 'cloudflare:workers',
			files: {
				'src/home/hero.stories.tsx': `import { env } from 'cloudflare:workers';
import { Hero } from './hero';

export default { component: Hero, args: { bucket: env.MEDIA } };
`,
				'src/home/hero.tsx': 'export function Hero() { return <main>hero</main>; }\n',
			},
		},
		{
			// A default import whose local name merely starts with "type"
			// is a runtime edge. Reading it as `import type` would be a
			// silent false negative: the foreign boundary behind it would
			// never be reported.
			name: 'a default import whose name starts with "type"',
			boundary: 'routes',
			files: {
				'src/home/hero.stories.tsx': `import typePayload from './payload';

export default { args: { payload: typePayload } };
`,
				'src/home/payload.ts': `import { route } from '../routes/index';

export default { route };
`,
				'src/routes/index.tsx': 'export const route = { id: "/" };\n',
			},
		},
	];

	for (const testCase of cases) {
		it(`fails on ${testCase.name}`, async () => {
			const root = await fixture(testCase.files);
			const result = run(root);
			assert.equal(result.status, 1);
			const report = readReport(result.jsonPath);
			assert.equal(report.verdict, 'fail');
			assert.equal(report.counts.fail, 1);
			const [violation] = report.subjects[0].violations;
			assert.equal(violation.boundary, testCase.boundary);
			// The report names the whole edge chain, not just the endpoint.
			assert.ok(violation.via.length >= 1);
			assert.match(result.stderr, /reach a foreign boundary/);
		});
	}
});

describe('storybook ownership check — incomplete and excluded states are not "pass"', () => {
	it('reports not run and exits 2 when a specifier cannot be resolved', async () => {
		const root = await fixture({
			'src/home/hero.stories.tsx': `import { Hero } from './does-not-exist';

export default { component: Hero };
`,
		});

		const result = run(root);
		assert.equal(result.status, 2);
		const report = readReport(result.jsonPath);
		assert.equal(report.verdict, 'incomplete');
		assert.equal(report.counts.notRun, 1);
		assert.match(result.stderr, /NOT a pass/);
	});

	it('exits 2 when the subject set cannot be read from the Storybook config', async () => {
		const root = await fixture({
			'.storybook/main.ts': 'export default {};\n',
			'src/home/hero.stories.tsx': 'export default {};\n',
		});

		const result = run(root);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /cannot read the subject set/);
	});

	it('lists every foreign boundary as not applicable, with its reason', async () => {
		const root = await fixture({
			'src/editorial/tokens.stories.tsx': 'export default {};\n',
			'src/routes/index.tsx': 'export const route = {};\n',
			'src/server.ts': 'export default {};\n',
		});

		const result = run(root);
		assert.equal(result.status, 0);
		const report = readReport(result.jsonPath);
		assert.deepEqual(
			report.notApplicable.map((entry) => entry.id),
			['routes', 'entrypoint', 'http', 'cloudflare'],
		);
		for (const entry of report.notApplicable) {
			assert.ok(entry.reason.length > 0, `${entry.id} must state why it is excluded`);
		}
		assert.ok(report.knownLimitations.length > 0);
	});

	it('records the subject patterns it read from .storybook/main.ts', async () => {
		const root = await fixture({
			'src/editorial/tokens.stories.tsx': 'export default {};\n',
			'src/editorial/ignored.stories.mdx': '# not a story\n',
		});

		const result = run(root);
		assert.equal(result.status, 0);
		const report = readReport(result.jsonPath);
		assert.deepEqual(report.subjectPatterns, ['../src/**/*.stories.@(ts|tsx)']);
		assert.equal(report.counts.subjects, 1);
	});
});

describe('storybook ownership check — the shipped repository', () => {
	it('passes on the real src tree', () => {
		// The gate is only meaningful if the stories that ship today
		// already satisfy it; a check that starts red gets disabled.
		const result = spawnSync(process.execPath, [checker], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /summary: \d+ subject\(s\) — pass \d+ \/ fail 0 \/ not run 0/);
	});
});
