#!/usr/bin/env node
/**
 * storybook ownership check — feature-local UI stories must be
 * previewable without reaching a foreign boundary (Issue #509).
 *
 * Usage:
 *   node scripts/check-storybook-ownership.mjs [--root=DIR] [--json=FILE]
 *
 * What it asserts
 * ---------------
 * The subject set is every file matched by the `stories` globs declared
 * in `.storybook/main.ts` (today: every `src/…/*.stories.ts(x)`). For
 * each
 * subject it walks the **runtime** import closure — value imports,
 * side-effect imports, dynamic `import()` with a literal specifier and
 * `export … from` re-exports — and fails when the closure reaches a
 * foreign boundary:
 *
 *   - `src/routes/**`   the TanStack Start file-route contract
 *   - `src/server.ts`   the Worker entrypoint
 *   - `src/http/**`     the external HTTP boundary (Hono)
 *   - `src/cloudflare/**`  the obligation that owns the bindings
 *   - `cloudflare:workers`  the Workers virtual module (does not
 *     resolve in a browser preview at all)
 *
 * The walk stops at the **server-function seam**: a module that
 * value-imports `createServerFn` / `createServerFunction` from
 * `@tanstack/react-start`. Those handlers run on the Worker, never in
 * the preview — `src/home/reactions/widget.stories.tsx` already
 * documents that the on-screen mutations are inert here, and
 * `.storybook/main.ts` already marks `cloudflare:workers` external for
 * exactly this reason. The seam edge is reported as an annotation, not
 * as a violation, so the report never hides it.
 *
 * Excluded, with reasons (printed in the report as `not applicable`)
 * -----------------------------------------------------------------
 * The rule constrains what a *story* may reach. It is not a second
 * ownership rule for the foreign boundaries themselves, which is what
 * `scripts/check-architecture.mjs` already owns; those modules are the
 * rule's TARGETS, not its subjects. Type-only imports are excluded
 * because `verbatimModuleSyntax: true` erases them at build time
 * (AGENTS.md §3 type-only edges — `home → http` is the registered one).
 * Bare specifiers (npm packages), `styled-system/**` (generated Panda
 * output) and asset imports are terminal leaves.
 *
 * Exit codes: 0 = every subject passed, 1 = at least one violation,
 * 2 = the graph could not be fully resolved (a subject is reported as
 * `not run`, so a green result is never claimed from an incomplete
 * walk — the same reasoning as `scripts/check-test-wiring.mjs`).
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

/** Virtual modules that only exist inside the Workers runtime. */
const WORKER_VIRTUAL_MODULES = new Set(['cloudflare:workers']);

/**
 * The foreign boundaries a story closure must not reach, each with the
 * reason it is foreign (printed verbatim in the report).
 */
const FOREIGN_BOUNDARIES = [
	{
		id: 'routes',
		pattern: /^src\/routes\//,
		label: 'src/routes/**',
		reason:
			'TanStack Start の file-route contract。obligation の consumer であり、import すると route tree と server function 一式が preview graph に入る。',
	},
	{
		id: 'entrypoint',
		pattern: /^src\/server\.tsx?$/,
		label: 'src/server.ts',
		reason: 'Worker runtime entrypoint。preview で実行する単位ではない。',
	},
	{
		id: 'http',
		pattern: /^src\/http\//,
		label: 'src/http/**',
		reason: '外部 HTTP boundary (Hono)。binding とリクエスト/レスポンスを前提にする。',
	},
	{
		id: 'cloudflare',
		pattern: /^src\/cloudflare\//,
		label: 'src/cloudflare/**',
		reason: 'Cloudflare binding を所有する obligation。preview には binding が存在しない。',
	},
];

/** Static ES imports, with enough clause context to classify them. */
const IMPORT_FROM = /(?:^|[\n;])\s*import\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
const IMPORT_SIDE_EFFECT = /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g;
const IMPORT_DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_FROM = /(?:^|[\n;])\s*export\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;

/**
 * Parse the runtime-relevant edges of a module.
 *
 * `import type … from` and `export type … from` are erased by
 * TypeScript under `verbatimModuleSyntax`, so they are recorded as
 * type-only edges and never traversed. `import { type A, b }` stays a
 * runtime edge: the statement also binds `b`.
 */
function parseEdges(source) {
	const edges = [];
	for (const match of source.matchAll(IMPORT_FROM)) {
		const clause = match[1].trim();
		edges.push({
			specifier: match[2],
			clause,
			// `^type\b` and not `startsWith('type')`: a default import
			// named `types` is a runtime edge, and calling it type-only
			// would be exactly the silent false negative this gate
			// exists to prevent.
			kind: /^type(\s|$)/.test(clause) ? 'import-type' : 'import',
		});
	}
	for (const match of source.matchAll(IMPORT_SIDE_EFFECT)) {
		edges.push({ specifier: match[1], clause: '', kind: 'import-side-effect' });
	}
	for (const match of source.matchAll(IMPORT_DYNAMIC)) {
		edges.push({ specifier: match[1], clause: '', kind: 'import-dynamic' });
	}
	for (const match of source.matchAll(EXPORT_FROM)) {
		edges.push({
			specifier: match[3],
			clause: match[2].trim(),
			kind: match[1] ? 'export-type' : 'export-from',
		});
	}
	return edges;
}

const isTypeOnlyEdge = (edge) => edge.kind === 'import-type' || edge.kind === 'export-type';

/**
 * A server-function seam: a module that declares a TanStack Start
 * server function. Its handler body only runs on the Worker, so the
 * walk stops here instead of following the handler's imports.
 */
function isServerFnSeam(edges) {
	return edges.some(
		(edge) =>
			!isTypeOnlyEdge(edge) &&
			edge.specifier === '@tanstack/react-start' &&
			/\bcreateServerFn(?:eration)?\b/.test(edge.clause),
	);
}

/**
 * Minimal glob → RegExp for the subset Storybook's `stories` globs use
 * (`**`, `*`, `?`, `@(a|b)`). Reading the real globs instead of
 * hardcoding one keeps the subject set honest when a story moves.
 */
function globToRegExp(pattern) {
	let out = '';
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		if (char === '*') {
			if (pattern[i + 1] === '*') {
				i++;
				if (pattern[i + 1] === '/') {
					i++;
					out += '(?:.*/)?';
				} else {
					out += '.*';
				}
			} else {
				out += '[^/]*';
			}
			continue;
		}
		if (char === '?') {
			out += '[^/]';
			continue;
		}
		if (char === '@' && pattern[i + 1] === '(') {
			const close = pattern.indexOf(')', i);
			if (close !== -1) {
				const alternatives = pattern
					.slice(i + 2, close)
					.split('|')
					.map((alt) => alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
					.join('|');
				out += `(?:${alternatives})`;
				i = close;
				continue;
			}
		}
		out += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${out}$`);
}

/** The `stories: [ … ]` globs declared by the Storybook config. */
function readStoryPatterns(root) {
	const configPath = join(root, '.storybook', 'main.ts');
	if (!existsSync(configPath)) return { patterns: [], reason: 'config-missing' };
	const source = readFileSync(configPath, 'utf8');
	const block = source.match(/stories\s*:\s*\[([\s\S]*?)\]/);
	if (!block) return { patterns: [], reason: 'no-stories-field' };
	const patterns = [];
	for (const match of block[1].matchAll(/['"]([^'"]+)['"]/g)) {
		patterns.push({
			pattern: match[1],
			regexp: globToRegExp(resolve(dirname(configPath), match[1])),
		});
	}
	if (patterns.length === 0) return { patterns: [], reason: 'no-stories-field' };
	return { patterns, reason: null };
}

function collectSourceFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return collectSourceFiles(path);
		return SOURCE_EXTENSIONS.includes(extname(path)) ? [path] : [];
	});
}

function resolveModuleFile(base) {
	const clean = base.split('?')[0].split('#')[0];
	for (const extension of SOURCE_EXTENSIONS) {
		const candidate = `${clean}${extension}`;
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	if (!existsSync(clean)) return null;
	if (statSync(clean).isFile()) return clean;
	for (const extension of SOURCE_EXTENSIONS) {
		const index = join(clean, `index${extension}`);
		if (existsSync(index)) return index;
	}
	return null;
}

const isInside = (parent, child) => child === parent || child.startsWith(`${parent}${sep}`);

/**
 * Walk one story's runtime import closure.
 *
 * `via` records the path so a violation names the exact edge chain
 * that has to change, instead of just the two endpoints.
 */
function inspectStory(root, srcRoot, storyFile) {
	const storyRel = relative(root, storyFile).split(sep).join('/');
	const violations = [];
	const unresolved = [];
	const seams = [];
	const externalPackages = new Set();
	const externalModules = new Set();
	const visited = new Set();
	const queue = [{ file: storyFile, path: [] }];

	while (queue.length > 0) {
		const { file, path } = queue.shift();
		if (visited.has(file)) continue;
		visited.add(file);
		const fromRel = relative(root, file).split(sep).join('/');
		const edges = parseEdges(readFileSync(file, 'utf8'));

		for (const edge of edges) {
			if (isTypeOnlyEdge(edge)) continue;
			const label = `${fromRel} -> ${edge.specifier}`;

			if (WORKER_VIRTUAL_MODULES.has(edge.specifier)) {
				violations.push({ boundary: 'cloudflare:workers', edge: label, via: [...path, label] });
				continue;
			}

			if (!edge.specifier.startsWith('.') && !edge.specifier.startsWith('~/')) {
				externalPackages.add(edge.specifier);
				continue;
			}

			const target = edge.specifier.startsWith('~/')
				? resolve(srcRoot, edge.specifier.slice(2))
				: resolve(dirname(file), edge.specifier);
			const resolved = resolveModuleFile(target);

			if (!isInside(srcRoot, target)) {
				// Outside `src/`: the generated Panda layer (`styled-system/`)
				// or a static asset. Terminal either way.
				externalModules.add(resolved ? relative(root, resolved) : label);
				continue;
			}

			if (!resolved) {
				unresolved.push(label);
				continue;
			}
			if (!SOURCE_EXTENSIONS.includes(extname(resolved))) {
				externalModules.add(relative(root, resolved));
				continue;
			}

			const toRel = relative(root, resolved).split(sep).join('/');
			const boundary = FOREIGN_BOUNDARIES.find((candidate) => candidate.pattern.test(toRel));
			if (boundary) {
				violations.push({ boundary: boundary.id, edge: label, via: [...path, label] });
				continue;
			}

			const targetEdges = parseEdges(readFileSync(resolved, 'utf8'));
			if (isServerFnSeam(targetEdges)) {
				seams.push({ edge: label, via: [...path, label] });
				continue;
			}

			queue.push({ file: resolved, path: [...path, label] });
		}
	}

	const verdict = violations.length > 0 ? 'fail' : unresolved.length > 0 ? 'not-run' : 'pass';
	return {
		file: storyRel,
		verdict,
		modules: visited.size,
		violations,
		unresolved,
		seams,
		externalPackages: [...externalPackages].sort(),
		externalModules: [...externalModules].sort(),
	};
}

function parseArgs(argv) {
	const options = { root: repoRootDefault, json: null };
	for (const arg of argv) {
		if (arg === '--help' || arg === '-h') {
			options.help = true;
			continue;
		}
		if (arg.startsWith('--root=')) {
			options.root = resolve(arg.slice('--root='.length));
			continue;
		}
		if (arg.startsWith('--json=')) {
			options.json = resolve(arg.slice('--json='.length));
			continue;
		}
		return { error: `unknown argument: ${arg}` };
	}
	return options;
}

function printReport(report, out) {
	out.write('storybook ownership check — feature-local UI stories must stay previewable\n\n');
	for (const story of report.subjects) {
		const counts = `modules ${String(story.modules).padStart(2)}  seam ${story.seams.length}`;
		out.write(`${story.verdict.padEnd(7)} ${story.file.padEnd(52)} ${counts}\n`);
		for (const violation of story.violations) {
			out.write(`        violation [${violation.boundary}] ${violation.via.join('  ->  ')}\n`);
		}
		for (const seam of story.seams) {
			out.write(`        seam     ${seam.via.join('  ->  ')}\n`);
		}
		for (const edge of story.unresolved) {
			out.write(`        not run  ${edge}\n`);
		}
	}

	out.write('\nnot applicable — foreign boundaries excluded from the subject set\n');
	for (const boundary of report.notApplicable) {
		out.write(`  - ${boundary.label}\n      ${boundary.reason}\n`);
	}

	const { pass, fail, notRun } = report.counts;
	out.write(
		`\nsummary: ${report.subjects.length} subject(s) — pass ${pass} / fail ${fail} / not run ${notRun}\n`,
	);
	if (report.knownLimitations.length > 0) {
		out.write('known limitations (manual work, not proven by this check):\n');
		for (const limitation of report.knownLimitations) out.write(`  - ${limitation}\n`);
	}
}

function main(argv) {
	const options = parseArgs(argv);
	if (options.error) {
		process.stderr.write(`[storybook:ownership:check] ${options.error}\n`);
		return 64;
	}
	if (options.help) {
		process.stdout.write(
			'usage: node scripts/check-storybook-ownership.mjs [--root=DIR] [--json=FILE]\n',
		);
		return 0;
	}

	const root = options.root;
	const srcRoot = join(root, 'src');
	const { patterns, reason } = readStoryPatterns(root);
	if (patterns.length === 0) {
		process.stderr.write(
			`[storybook:ownership:check] cannot read the subject set: ${reason}\nExpected \`stories: [ … ]\` in .storybook/main.ts.\n`,
		);
		return 2;
	}

	const subjects = collectSourceFiles(srcRoot)
		.filter((file) => patterns.some((entry) => entry.regexp.test(file)))
		.sort();

	if (subjects.length === 0) {
		process.stderr.write('[storybook:ownership:check] no story file matches .storybook/main.ts\n');
		return 2;
	}

	const stories = subjects.map((file) => inspectStory(root, srcRoot, file));
	const pass = stories.filter((story) => story.verdict === 'pass');
	const fail = stories.filter((story) => story.verdict === 'fail');
	const notRun = stories.filter((story) => story.verdict === 'not-run');

	const report = {
		verdict: fail.length > 0 ? 'fail' : notRun.length > 0 ? 'incomplete' : 'pass',
		subjectPatterns: patterns.map((entry) => entry.pattern),
		counts: {
			subjects: stories.length,
			pass: pass.length,
			fail: fail.length,
			notRun: notRun.length,
		},
		subjects: stories,
		notApplicable: FOREIGN_BOUNDARIES.map((boundary) => ({
			id: boundary.id,
			label: boundary.label,
			reason: boundary.reason,
		})),
		knownLimitations: [
			'server-function seam: createServerFn handler imports are not walked (the handler only runs on the Worker). A UI module that reaches a foreign boundary ONLY through its own ./load.ts is reported as a seam, not a violation.',
			`${WORKER_VIRTUAL_MODULES.size} Workers virtual module (${[...WORKER_VIRTUAL_MODULES].join(', ')}) cannot resolve in a browser preview at all — this check treats any direct or transitive edge to it as a violation.`,
			'the walk is regex-based over ES import syntax; computed specifiers, CommonJS require() and non-literal import() are not inspected.',
		],
	};

	printReport(report, process.stdout);

	if (options.json) {
		writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
		process.stdout.write(`\njson report: ${relative(root, options.json)}\n`);
	}

	if (fail.length > 0) {
		process.stderr.write(
			`\n[storybook:ownership:check] ${fail.length} story/stories reach a foreign boundary.\nExtract the renderable part into the owning obligation and pass loader data as a prop (see src/home/status/tiles.stories.tsx); \`import type\` is allowed.\n`,
		);
		return 1;
	}
	if (notRun.length > 0) {
		process.stderr.write(
			`\n[storybook:ownership:check] ${notRun.length} story/stories could not be fully resolved — the result above is NOT a pass.\n`,
		);
		return 2;
	}
	process.stderr.write('[storybook:ownership:check] every story stays inside its own obligation\n');
	return 0;
}

process.exit(main(process.argv.slice(2)));
