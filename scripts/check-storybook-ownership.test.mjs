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

/** A config that declares extra globs, so the subject set can be probed. */
const storybookConfig = (stories) => `import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
\tstories: [${stories}],
\tframework: { name: '@storybook/react-vite', options: {} },
};

export default config;
`;

async function fixture(files, config = STORYBOOK_CONFIG) {
	const root = await mkdtemp(join(tmpdir(), 'my-web-storybook-ownership-'));
	tempRoots.push(root);
	await mkdir(join(root, '.storybook'), { recursive: true });
	await writeFile(join(root, '.storybook', 'main.ts'), config, 'utf8');
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
		// The generated Panda layer is a terminal leaf even when the
		// fixture has not run `panda codegen`: an unresolvable
		// out-of-src path is printed, not silently swallowed.
		assert.equal(report.subjects[0].unresolvedExternal.length, 1);
		assert.match(report.subjects[0].unresolvedExternal[0], /styled-system\/css$/);
		assert.match(result.stdout, /external .*styled-system\/css/);
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

	it('treats an inline `import { type A }` clause as an allowed type-only edge', async () => {
		// Same registered `home → http` edge as above, written with an
		// inline type specifier instead of `import type`. The clause does
		// not start with `type`, so a reader that only checks the clause
		// head reports a violation the build never produces.
		const root = await fixture({
			'src/home/reactions/widget.stories.tsx': `import { ReactionsWidget } from './widget';

export default { component: ReactionsWidget };
`,
			'src/home/reactions/widget.tsx': `import { type ReactionAggregate } from '../../http/reactions/schema';

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

	it('treats an inline type re-export of the HTTP boundary as an allowed edge', async () => {
		// `export { type Data } from …` is erased exactly like
		// `export type { Data } from …`. Reading only the leading `type`
		// keyword would file this re-export as runtime surface and report
		// a boundary hit the build never produces.
		const root = await fixture({
			'src/home/reactions/widget.stories.tsx': `import { ReactionsWidget } from './widget';

export default { component: ReactionsWidget };
`,
			'src/home/reactions/widget.tsx': `export { type ReactionAggregate } from '../../http/reactions/schema';
export function ReactionsWidget() {
	return <ul />;
}
`,
			'src/http/reactions/schema.ts':
				'export interface ReactionAggregate { slug: string; count: number }\n',
		});

		const result = run(root);
		assert.equal(result.status, 0);
		assert.equal(readReport(result.jsonPath).verdict, 'pass');
	});

	it('still treats a mixed type and value re-export as a runtime edge', async () => {
		// The conservative half: `{ type A, b }` ships `b`, so the
		// boundary really is in the preview graph.
		const root = await fixture({
			'src/home/reactions/widget.stories.tsx': `import { ReactionsWidget } from './widget';

export default { component: ReactionsWidget };
`,
			'src/home/reactions/widget.tsx': `export { type ReactionAggregate, reactionsApp } from '../../http/reactions/app';
export function ReactionsWidget() {
	return <ul />;
}
`,
			'src/http/reactions/app.ts': `export interface ReactionAggregate { slug: string }
export const reactionsApp = {};
`,
		});

		const result = run(root);
		assert.equal(result.status, 1);
		assert.equal(readReport(result.jsonPath).subjects[0].violations[0].boundary, 'http');
	});

	it('still treats a mixed `{ type A, b }` clause as a runtime edge', async () => {
		// The conservative half of the same rule: one runtime binding
		// ships the module, so the boundary really is in the graph.
		const root = await fixture({
			'src/home/reactions/widget.stories.tsx': `import { ReactionsWidget } from './widget';

export default { component: ReactionsWidget };
`,
			'src/home/reactions/widget.tsx': `import { type ReactionAggregate, reactionsApp } from '../../http/reactions/app';

export function ReactionsWidget({ rows }: { rows: readonly ReactionAggregate[] }) {
	return <ul>{rows.length}{String(reactionsApp)}</ul>;
}
`,
			'src/http/reactions/app.ts': 'export const reactionsApp = { routes: [] };\n',
		});

		const result = run(root);
		assert.equal(result.status, 1);
		assert.equal(readReport(result.jsonPath).subjects[0].violations[0].boundary, 'http');
	});

	it('keeps handler-confined imports of an aliased createServerFn seam out of the walk', async () => {
		// `import { createServerFn as serverFn }` puts the handler chain
		// under a local name. Reading only the imported name finds no
		// handler range, the handler body counts as a client-reachable
		// position, and this legitimate seam is reported as a violation.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { addReaction } from './load';

export default { component: addReaction };
`,
			'src/home/status/load.ts': `import { createServerFn as serverFn } from '@tanstack/react-start';

export const addReaction = serverFn({ method: 'POST' }).handler(async () => {
\tconst { env } = await import('cloudflare:workers');
\tconst { probeCloudflareHealth } = await import('../../cloudflare/health');
\tawait probeCloudflareHealth(env.DB);
});
`,
			'src/cloudflare/health.ts': 'export async function probeCloudflareHealth() {}\n',
		});

		const result = run(root);
		assert.equal(result.status, 0);
		const report = readReport(result.jsonPath);
		assert.equal(report.verdict, 'pass');
		assert.deepEqual(report.subjects[0].violations, []);
		assert.equal(report.subjects[0].seams.length, 1);
	});

	it('reports a module-level edge of an aliased seam whose export reads it through a regex', async () => {
		// The narrowing is positional, not reachability-based: a
		// module-level edge runs when the module loads, so the regex
		// literal (and everything else the export does with the
		// binding) cannot hide it. The regex must also be masked as one
		// literal so its `/` does not swallow the rest of the file.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { isHome } from './load';

export default { component: isHome };
`,
			'src/home/status/load.ts': `import { createServerFn as serverFn } from '@tanstack/react-start';
import { route } from '../../routes/index';

export const isHome = /home/gi.test(route.title);

export const addReaction = serverFn({ method: 'POST' }).handler(async () => {
\treturn route.id;
});
`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.subjects[0].verdict, 'fail');
		assert.equal(report.subjects[0].violations[0].boundary, 'routes');
	});

	it('walks a module-level edge a local `export { a as b }` alias cannot hide', async () => {
		// `const routeTitle = route.title; export { routeTitle as title }`
		// names an export the story asks for. The rule does not read
		// declarations at all: the import is evaluated when the module
		// loads, so the alias changes nothing.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { title } from './load';

export default { component: title };
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { route } from '../../routes/index';

const routeTitle = route.title;

export { routeTitle as title };

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
\treturn route.id;
});
`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.subjects[0].verdict, 'fail');
		assert.equal(report.subjects[0].violations[0].boundary, 'routes');
	});

	it('walks a source file outside src/ instead of treating it as a leaf', async () => {
		// The subject set includes stories declared outside `src/`, so
		// their closure has to be complete: a sibling helper is part of
		// the preview graph, not a generated artefact.
		const root = await fixture(
			{
				'src/home/hero.stories.tsx': 'export default {};\n',
				'stories/legacy.stories.tsx': `import { legacyTitle } from './helpers';

export default { args: { legacyTitle } };
`,
				'stories/helpers.ts': `import { route } from '../src/routes/index';

export const legacyTitle = route.title;
`,
				'src/routes/index.tsx': 'export const route = { id: "/", title: "home" };\n',
			},
			storybookConfig(`'../src/**/*.stories.@(ts|tsx)', '../stories/**/*.stories.@(ts|tsx)'`),
		);

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		const legacy = report.subjects.find((entry) => entry.file === 'stories/legacy.stories.tsx');
		assert.equal(legacy.verdict, 'fail');
		assert.equal(legacy.violations[0].boundary, 'routes');
		assert.match(legacy.violations[0].via.join(' -> '), /helpers\.ts -> \.\.\/src\/routes\/index$/);
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

export const addHomeReaction = createServerFn({ method: 'POST' }).handler(async () => {
\tconst { env } = await import('cloudflare:workers');
\tconst { probeCloudflareHealth } = await import('../../cloudflare/health');
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

describe('storybook ownership check — a comment or a string is not an import', () => {
	it('ignores an import example a story renders inside a template literal', async () => {
		// Documentation code samples are the reason masking exists: the
		// text below names `src/routes/index`, but no runtime edge does.
		const root = await fixture({
			'src/home/hero.stories.tsx': `import { Hero } from './hero';

const example = \`import { Route } from '../../routes/index';\`;

export default { component: Hero, args: { example } };
`,
			'src/home/hero.tsx': 'export function Hero() { return <main>hero</main>; }\n',
			'src/routes/index.tsx': 'export const Route = { id: "/" };\n',
		});

		const result = run(root);
		assert.equal(result.status, 0);
		const report = readReport(result.jsonPath);
		assert.equal(report.verdict, 'pass');
		assert.deepEqual(report.subjects[0].violations, []);
		assert.deepEqual(report.subjects[0].seams, []);
	});

	it('still reports the real edge when a comment mentions createServerFn', async () => {
		// An import-shaped comment must not be read as a server-function
		// seam: a seam stops the walk, so a false seam would hide the
		// boundary violation behind it.
		const root = await fixture({
			'src/home/hero.stories.tsx': `import { Hero } from './hero';

export default { component: Hero };
`,
			'src/home/hero.tsx': `// import { createServerFn } from '@tanstack/react-start';
import { route } from '../routes/index';

export function Hero() {
\treturn <main>{String(route)}</main>;
}
`,
			'src/routes/index.tsx': 'export const route = { id: "/" };\n',
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.verdict, 'fail');
		assert.equal(report.subjects[0].violations[0].boundary, 'routes');
		assert.deepEqual(report.subjects[0].seams, []);
	});
});

describe('storybook ownership check — a seam module is walked client-side', () => {
	it('fails when a client-reachable export of a seam module reaches a boundary', async () => {
		// Stopping at the seam module itself would hide this: the story
		// imports ROUTE_TITLE, so `src/routes/index` really does enter
		// the preview graph.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { StatusTiles } from './tiles';

export default { component: StatusTiles };
`,
			'src/home/status/tiles.tsx': `import { ROUTE_TITLE } from './load';

export function StatusTiles() {
\treturn <h1>{ROUTE_TITLE}</h1>;
}
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { route } from '../../routes/index';

export const ROUTE_TITLE = route.title;

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
\treturn route.id;
});
`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		const [violation] = report.subjects[0].violations;
		assert.equal(violation.boundary, 'routes');
		assert.match(violation.via.join(' -> '), /load\.ts -> \.\.\/\.\.\/routes\/index$/);
		assert.equal(report.subjects[0].seams.length, 1);
	});

	it('fails when a later declarator of a multi-binding export reaches a boundary', async () => {
		// `export const unused = 1, title = route.title` binds `title`
		// second. Naming only the first declarator leaves the export the
		// story imports without a block, so the walk finds no reference
		// to `route` and passes.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { title } from './load';

export default { component: title };
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { route } from '../../routes/index';

export const unused: Map<string, number> = new Map(), title = route.title;

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return route.id;
});
`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.subjects[0].verdict, 'fail');
		assert.equal(report.subjects[0].violations[0].boundary, 'routes');
	});

	it('fails when a destructured export of a multi-binding declaration reaches a boundary', async () => {
		// The destructuring form binds `title` without a name after
		// `const`, which the declaration header alone does not expose.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { title } from './load';

export default { component: title };
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { route } from '../../routes/index';

export const { title }: { title: string } = route;

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return route.id;
});
`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.subjects[0].verdict, 'fail');
		assert.equal(report.subjects[0].violations[0].boundary, 'routes');
	});

	it('keeps handler-confined imports of a seam module out of the walk', async () => {
		// Same module shape, opposite answer: nothing but the handler
		// body reaches `src/cloudflare/**`, so the preview stays clean.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { StatusTiles } from './tiles';

export default { component: StatusTiles };
`,
			'src/home/status/tiles.tsx': `import { addReaction } from './load';

export function StatusTiles() {
\treturn <button onClick={() => addReaction()} />;
}
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
\tconst { env } = await import('cloudflare:workers');
\tconst { probeCloudflareHealth } = await import('../../cloudflare/health');
\tawait probeCloudflareHealth(env.DB);
});
`,
			'src/cloudflare/health.ts': 'export async function probeCloudflareHealth() {}\n',
		});

		const result = run(root);
		assert.equal(result.status, 0);
		const report = readReport(result.jsonPath);
		assert.equal(report.verdict, 'pass');
		assert.deepEqual(report.subjects[0].violations, []);
		assert.equal(report.subjects[0].seams.length, 1);
	});

	it('fails when a module-level binding edge of a seam is not the one the story imports', async () => {
		// The regression this rule exists for: `env` is bound at module
		// level and read only inside the handler, while the story asks
		// the seam for `ROUTE_TITLE` alone. An ES module evaluates its
		// static imports when it loads, so the virtual module is in the
		// preview graph either way and the story must fail.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { ROUTE_TITLE } from './load';

export default { component: ROUTE_TITLE };
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { env } from 'cloudflare:workers';

export const ROUTE_TITLE = 'home';

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
\treturn env.DB;
});
`,
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.subjects[0].violations[0].boundary, 'cloudflare:workers');
	});

	it('keeps a dynamic import inside a handler body out of the walk', async () => {
		// `import()` inside `.handler(…)` runs on the Worker only, so it
		// is not a client edge even though a dynamic import has no
		// binding the request could narrow it by.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { StatusTiles } from './tiles';

export default { component: StatusTiles };
`,
			'src/home/status/tiles.tsx': `import { addReaction } from './load';

export function StatusTiles() {
	return <button onClick={() => addReaction()} />;
}
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	const { probeCloudflareHealth } = await import('../../cloudflare/health');
	return probeCloudflareHealth();
});
`,
			'src/cloudflare/health.ts': 'export async function probeCloudflareHealth() {}\n',
		});

		const result = run(root);
		assert.equal(result.status, 0);
		const report = readReport(result.jsonPath);
		assert.equal(report.verdict, 'pass');
		assert.deepEqual(report.subjects[0].violations, []);
		assert.equal(report.subjects[0].seams.length, 1);
	});

	it('still walks a dynamic import outside every handler body', async () => {
		// The other half of the same rule: a module-level `import()` the
		// preview reaches is evaluated by the preview, so it stays a
		// violation.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { StatusTiles } from './tiles';

export default { component: StatusTiles };
`,
			'src/home/status/tiles.tsx': `import { addReaction, health } from './load';

export function StatusTiles() {
	return <button onClick={() => addReaction()} data-health={String(health)} />;
}
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return null;
});

export const health = () => import('../../cloudflare/health');
`,
			'src/cloudflare/health.ts': 'export async function probeCloudflareHealth() {}\n',
		});

		const result = run(root);
		assert.equal(result.status, 1);
		assert.equal(readReport(result.jsonPath).subjects[0].violations[0].boundary, 'cloudflare');
	});

	it('walks a dynamic import outside every handler body', async () => {
		// `import()` inside `.handler(…)` runs on the Worker only, so it
		// is not a client edge even though a dynamic import has no
		// binding the request could narrow it by. Outside the handler
		// body the rule is conservative: the call sits in a declaration
		// the preview may never evaluate, but only `.handler(…)` is
		// treated as Worker-only, so it stays a violation.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { StatusTiles } from './tiles';

export default { component: StatusTiles };
`,
			'src/home/status/tiles.tsx': `import { addReaction } from './load';

export function StatusTiles() {
	return <button onClick={() => addReaction()} />;
}
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return null;
});

const unused = () => import('../../routes/index');
`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		assert.equal(readReport(result.jsonPath).subjects[0].violations[0].boundary, 'routes');
	});

	it('reads a dynamic import written with a space or a comment before the parenthesis', async () => {
		// `import ('…')` and `import /* why */ ('…')` are the same call:
		// the mask blanks the comment to spaces, so the gap between the
		// keyword and the parenthesis has to be allowed for or the edge
		// disappears and the story passes.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { StatusTiles } from './tiles';

export default { component: StatusTiles };
`,
			'src/home/status/tiles.tsx': `import { addReaction } from './load';

export function StatusTiles() {
	return <button onClick={() => addReaction()} />;
}
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return null;
});

export const health = () =>
\timport /* server only */ ('../../cloudflare/health');
`,
			'src/cloudflare/health.ts': 'export async function probeCloudflareHealth() {}\n',
		});

		const result = run(root);
		assert.equal(result.status, 1);
		assert.equal(readReport(result.jsonPath).subjects[0].violations[0].boundary, 'cloudflare');
	});

	it('fails when an export is filled by a top-level assignment', async () => {
		// `let title; title = route.title; export { title };` binds the
		// export without a declaration value. Blocking the declaration
		// alone would leave `route` out of `title`'s reference set and the
		// walk would find nothing.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { title } from './load';

export default { component: title };
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { route } from '../../routes/index';

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return route.id;
});

let title;
title = route.title;
export { title };
`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.subjects[0].verdict, 'fail');
		assert.equal(report.subjects[0].violations[0].boundary, 'routes');
	});

	it('walks a module-level edge whatever assignment the export the story imports uses', async () => {
		// The assignment is never read: `title` is reassigned before it
		// is exported, and the statement that touches `route` names a
		// binding the story never reaches. The module-level import still
		// runs at load time, so the story fails.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { title } from './load';

export default { component: title };
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { route } from '../../routes/index';

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return route.id;
});

let title = 'home';
let unrelated;
unrelated = route.title;
title = 'home';
export { title };
`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.verdict, 'fail');
		assert.equal(report.subjects[0].violations[0].boundary, 'routes');
	});
});

describe('storybook ownership check — an import shape never hides a seam module edge', () => {
	// Nothing narrows a module-level edge, so an alias, a namespace, a
	// default import or a re-export is only another hop in the chain.
	// the importer's local binding. Requesting `title` from a module
	// that exports `ROUTE_TITLE` finds no declaration and would walk
	// nothing, hiding the very edge the seam rule exists to expose.
	const seam = `import { createServerFn } from '@tanstack/react-start';
import { route } from '../../routes/index';

export const ROUTE_TITLE = route.title;

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
\treturn route.id;
});
`;

	it('fails for an aliased named import of a client-reachable export', async () => {
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { ROUTE_TITLE as title } from './load';

export default { component: title };
`,
			'src/home/status/load.ts': seam,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.subjects[0].verdict, 'fail');
		assert.equal(report.subjects[0].violations[0].boundary, 'routes');
	});

	it('fails for a namespace import of a seam module', async () => {
		// A namespace import may touch any export, so the walk is
		// conservative rather than narrowing to the local name `load`.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import * as load from './load';

export default { component: load.ROUTE_TITLE };
`,
			'src/home/status/load.ts': seam,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.subjects[0].verdict, 'fail');
		assert.equal(report.subjects[0].violations[0].boundary, 'routes');
	});

	it('fails for a default import of a seam module', async () => {
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import load from './load';

export default { component: load.title };
`,
			'src/home/status/load.ts': `${seam}\nexport default { title: ROUTE_TITLE };\n`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.subjects[0].verdict, 'fail');
		assert.equal(report.subjects[0].violations[0].boundary, 'routes');
	});

	it('fails when a seam export is filled by a member assignment', async () => {
		// `config.title = route.title` mutates a binding the preview
		// imports. Blocking only the declaration leaves `route` out of
		// `config`'s reference set, so the walk would find nothing.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { config } from './load';

export default { component: config.title };
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { route } from '../../routes/index';

export const config = { title: 'home' };
config.title = route.title;

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return route.id;
});
`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		assert.equal(readReport(result.jsonPath).subjects[0].violations[0].boundary, 'routes');
	});

	it('fails when a regular expression after return swallows the rest of the line', async () => {
		// `/['"]/` after `return` is a regex literal. Reading it as a
		// division lets the quote inside the pattern open a "string",
		// which masks `route.title` and hides the edge behind it.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { hasRouteTitle } from './load';

export default { component: hasRouteTitle };
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { route } from '../../routes/index';

export const hasRouteTitle = () => /['"]/.test(route.title);

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return route.id;
});
`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		assert.equal(readReport(result.jsonPath).subjects[0].violations[0].boundary, 'routes');
	});

	it('fails for a dynamic import written with backticks', async () => {
		// `import(`../x`)` names a real specifier: an interpolation-free
		// template is one literal, and masking it whole would drop the
		// edge the walk exists to report.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { loadRoute } from './load';

export default { component: loadRoute };
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return null;
});

export const loadRoute = () => import(\`../../routes/index\`);
`,
			'src/routes/index.tsx': "export const route = { id: '/', title: 'home' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		assert.equal(readReport(result.jsonPath).subjects[0].violations[0].boundary, 'routes');
	});

	it('walks a module-level import even when an object key names it', async () => {
		// `{ health: 'ok' }` names a key, not the imported `health`, and
		// the walk never has to tell them apart any more: the import is
		// evaluated when the module loads, so it is a violation whatever
		// `meta` does with the name.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { meta } from './load';

export default { component: meta.title };
`,
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { health } from '../../cloudflare/health';

export const meta = { title: 'home', health: 'ok' };

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return health.status();
});
`,
			'src/cloudflare/health.ts': "export const health = { status: () => 'ok' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		assert.equal(readReport(result.jsonPath).subjects[0].violations[0].boundary, 'cloudflare');
	});

	it('walks a named re-export of a seam module', async () => {
		// A barrel that re-exports one name from a seam adds a hop, not
		// a narrowing: the seam's module-level edge is reported through
		// the whole chain.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { title } from './index';

export default { component: title };
`,
			'src/home/status/index.ts': "export { title } from './load';\n",
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { health } from '../../cloudflare/health';

export const title = 'home';

export const addReaction = createServerFn({ method: 'POST'}).handler(async () => {
	return health.status();
});
`,
			'src/cloudflare/health.ts': "export const health = { status: () => 'ok' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.subjects[0].violations[0].boundary, 'cloudflare');
		assert.match(
			report.subjects[0].violations[0].via.join(' -> '),
			/index\.ts -> \.\/load -> src\/home\/status\/load\.ts -> \.\.\/\.\.\/cloudflare\/health$/,
		);
	});

	it('still walks every export behind `export *`', async () => {
		// The complement of the named re-export: `export *` can reach any
		// export, so the request stays wide and the edge is reported.
		const root = await fixture({
			'src/home/status/tiles.stories.tsx': `import { title } from './index';

export default { component: title };
`,
			'src/home/status/index.ts': "export * from './load';\n",
			'src/home/status/load.ts': `import { createServerFn } from '@tanstack/react-start';
import { health } from '../../cloudflare/health';

export const title = 'home';

export const addReaction = createServerFn({ method: 'POST' }).handler(async () => {
	return health.status();
});
`,
			'src/cloudflare/health.ts': "export const health = { status: () => 'ok' };\n",
		});

		const result = run(root);
		assert.equal(result.status, 1);
		assert.equal(readReport(result.jsonPath).subjects[0].violations[0].boundary, 'cloudflare');
	});
});

describe('storybook ownership check — the subject set is exactly the stories globs', () => {
	it('checks a story declared outside src/', async () => {
		const root = await fixture(
			{
				'src/home/hero.stories.tsx': 'export default {};\n',
				'stories/legacy.stories.tsx': `import { route } from '../src/routes/index';

export default { args: { route } };
`,
				'src/routes/index.tsx': 'export const route = {};\n',
			},
			storybookConfig(`'../src/**/*.stories.@(ts|tsx)', '../stories/**/*.stories.@(ts|tsx)'`),
		);

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.counts.subjects, 2);
		assert.equal(report.subjects[1].verdict, 'fail');
		assert.equal(report.subjects[1].violations[0].boundary, 'routes');
	});

	it('exits 2 when a glob resolves outside the repository', async () => {
		const root = await fixture(
			{ 'src/home/hero.stories.tsx': 'export default {};\n' },
			storybookConfig(`'../src/**/*.stories.@(ts|tsx)', '../../*.stories.ts'`),
		);

		const result = run(root);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /resolves outside the repository/);
	});

	it('exits 2 when the stories array contains a non-literal entry', async () => {
		const root = await fixture(
			{ 'src/home/hero.stories.tsx': 'export default {};\n' },
			storybookConfig(`...sharedStories, '../src/**/*.stories.@(ts|tsx)'`),
		);

		const result = run(root);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /cannot read the subject set: non-literal-story-entry/);
	});

	it('ignores a commented-out stories array in the config', async () => {
		// The config is read from the active settings, not from the first
		// `stories:` the text contains: a comment left above the real
		// config would otherwise narrow the subject set to stories that
		// all pass and the gate would return green.
		const root = await fixture(
			{
				'src/home/hero.stories.tsx': 'export default {};\n',
				'src/home/tiles.stories.tsx': `import { route } from '../routes/index';

export default { component: route.title };
`,
				'src/routes/index.tsx': "export const route = { title: 'home' };\n",
			},
			`import type { StorybookConfig } from '@storybook/react-vite';

// stories: ['../src/home/hero.stories.tsx']
const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(ts|tsx)'],
	framework: { name: '@storybook/react-vite', options: {} },
};

export default config;
`,
		);

		const result = run(root);
		assert.equal(result.status, 1);
		const report = readReport(result.jsonPath);
		assert.equal(report.counts.subjects, 2);
		assert.equal(
			report.subjects.find((entry) => entry.file === 'src/home/tiles.stories.tsx').violations[0]
				.boundary,
			'routes',
		);
	});

	it('creates the parent directory of the requested --json path', async () => {
		// `.tmp/` is gitignored, so a fresh checkout has no such
		// directory: the documented `--json=.tmp/…` invocation must not
		// fail with ENOENT after the walk already succeeded.
		const root = await fixture({ 'src/home/hero.stories.tsx': 'export default {};\n' });
		const nested = join(root, '.tmp', 'nested', 'report.json');
		const result = spawnSync(process.execPath, [checker, `--root=${root}`, `--json=${nested}`], {
			encoding: 'utf8',
		});
		assert.equal(result.status, 0);
		assert.equal(JSON.parse(readFileSync(nested, 'utf8')).verdict, 'pass');
	});

	it('does not count a story inside a foreign boundary as a subject', async () => {
		const root = await fixture({
			'src/home/hero.stories.tsx': 'export default {};\n',
			'src/routes/index.stories.tsx': 'export default {};\n',
		});

		const result = run(root);
		assert.equal(result.status, 0);
		const report = readReport(result.jsonPath);
		assert.equal(report.counts.subjects, 1);
		assert.deepEqual(
			report.notApplicableSubjects.map((entry) => [entry.file, entry.boundary]),
			[['src/routes/index.stories.tsx', 'routes']],
		);
		assert.match(result.stdout, /rule targets, not subjects/);
	});

	it('names the excluded-boundary reason when no subject is left to walk', async () => {
		// Every story under the globs sits inside a foreign boundary.
		// "no story file matches .storybook/main.ts" is a different
		// failure, so the message has to say which one it is.
		const root = await fixture({
			'src/routes/index.stories.tsx': 'export default {};\n',
			'src/cloudflare/health.stories.tsx': 'export default {};\n',
		});

		const result = run(root);
		assert.equal(result.status, 2);
		assert.match(
			result.stderr,
			/every story matching \.storybook\/main\.ts lives inside a foreign boundary \(2 excluded\)/,
		);
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
