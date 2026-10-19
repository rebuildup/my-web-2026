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
 * in `.storybook/main.ts` (today: every `src/…/*.stories.ts(x)`). Each
 * glob's non-glob prefix is the directory the walk starts from, so a
 * story declared outside `src/` is a subject too — and a glob that
 * cannot be read, or that resolves outside the repository, is an error
 * rather than a silently narrower subject set.
 *
 * For each subject it walks the **runtime** import closure — value
 * imports, side-effect imports, dynamic `import()` with a literal
 * specifier and `export … from` re-exports — and fails when the
 * closure reaches a foreign boundary:
 *
 *   - `src/routes/**`   the TanStack Start file-route contract
 *   - `src/server.ts`   the Worker entrypoint
 *   - `src/http/**`     the external HTTP boundary (Hono)
 *   - `src/cloudflare/**`  the obligation that owns the bindings
 *   - `cloudflare:workers`  the Workers virtual module (does not
 *     resolve in a browser preview at all)
 *
 * The walk stops inside a **`.handler(…)` body**, and nowhere else. A
 * module that value-imports `createServerFn` /
 * `createServerFunction` from `@tanstack/react-start` is a
 * server-function seam, and the start compiler plugin is what removes
 * those bodies from the client build. Every other edge of that module
 * is evaluated when the module is loaded — a module-level
 * `import { env } from 'cloudflare:workers'` included — so it is
 * walked whichever export the story asked the module for; narrowing it
 * by the bindings a story imports is unsound. A seam is reported as an
 * annotation, never hidden, and a seam that reaches a foreign boundary
 * outside its handler bodies fails like any other story.
 * `src/home/reactions/widget.stories.tsx` documents that the on-screen
 * mutations are inert in this preview.
 *
 * How the source is read
 * ----------------------
 * Matching runs on a masked copy of each module: comments, string
 * literals and template-literal text are blanked out first, so a story
 * that *shows* an import example (documentation, a code sample, a
 * comment) is not read as an edge, and an import-shaped string is not
 * read as a `createServerFn` seam that would hide a real boundary
 * violation. The mask preserves every newline and replaces each
 * string literal with an index-carrying placeholder, so the original
 * specifier is recovered; masked regions are shorter than the text
 * they replace, and only masked-relative positions are used.
 *
 * Excluded, with reasons (printed in the report as `not applicable`)
 * -----------------------------------------------------------------
 * The rule constrains what a *story* may reach. It is not a second
 * ownership rule for the foreign boundaries themselves, which is what
 * `scripts/check-architecture.mjs` already owns; those modules are the
 * rule's TARGETS, not its subjects, and a story that happens to live
 * inside one of them is listed as `not applicable` instead of being
 * counted as a subject. Type-only imports are excluded because
 * `verbatimModuleSyntax: true` erases them at build time (AGENTS.md §3
 * type-only edges — `home → http` is the registered one). Bare
 * specifiers (npm packages), `styled-system/**` (generated Panda
 * output) and asset imports are terminal leaves; a *source* file
 * outside `src/` is not a leaf and is walked like any other module.
 *
 * Exit codes: 0 = every subject passed, 1 = at least one violation,
 * 2 = the graph could not be fully resolved or the subject set could
 * not be read (a subject is reported as `not run`, so a green result
 * is never claimed from an incomplete walk — the same reasoning as
 * `scripts/check-test-wiring.mjs`).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
/** Directories never worth walking when a glob base is the repo root. */
const PRUNED_DIRECTORIES = new Set([
	'.git',
	'.tmp',
	'dist',
	'node_modules',
	'storybook-static',
	'styled-system',
]);

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
// The mask blanks comments to spaces, so `import /* why */ ('…')` reads
// as `import          ('…')`: the space (and any line break) between the
// keyword and the parenthesis is allowed for.
const IMPORT_DYNAMIC = /\bimport\s*\(\s*(?:['"]([^'"]+)['"]|(\uE000\d+\uE000))\s*\)/g;
const EXPORT_FROM = /(?:^|[\n;])\s*export\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
/**
 * Keywords after which a `/` opens a regular expression rather than a
 * division. Without them `return /['"]/.test(x)` reads as a division,
 * and the quote inside the pattern opens a "string" that masks the rest
 * of the line — hiding a real edge behind a fake literal.
 */
const REGEX_KEYWORDS = new Set([
	'await',
	'case',
	'delete',
	'do',
	'else',
	'in',
	'instanceof',
	'new',
	'of',
	'return',
	'throw',
	'typeof',
	'void',
	'yield',
]);
/** The placeholder a masked string literal is replaced with. */
const MASK_SENTINEL = '\uE000';
const MASKED_LITERAL = /^\uE000(\d+)\uE000$/;
/** The `stories` array of a Storybook config, with its string literals. */
const STRING_LITERAL = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;

const maskNonCodeLength = (text) => text.replace(/[^\n]/g, ' ');

/**
 * Blank out every region of `source` that cannot contain a real import
 * declaration: comments, string literals and template-literal text.
 *
 * Each string literal is replaced by a placeholder that carries its
 * index, so the import regexes keep matching `from '<placeholder>'`
 * and the original specifier is recovered by `literalText()`. The mask
 * preserves every newline; it is not length-preserving (a masked
 * region is shorter than the literal it replaces), so only
 * masked-relative positions are used.
 */
function maskNonCode(source) {
	const literals = [];
	const stack = [{ type: 'code', braceDepth: 0 }];
	const top = () => stack[stack.length - 1];
	let out = '';
	let lastSignificant = '';
	let lastWord = '';
	let i = 0;

	while (i < source.length) {
		const char = source[i];
		const next = source[i + 1];

		if (top().type === 'template') {
			if (char === '\\') {
				out += '  ';
				i += 2;
				continue;
			}
			if (char === '`') {
				const frame = top();
				stack.pop();
				// A template without an interpolation is one literal, and
				// `import(`…`)` is a real specifier: keep it readable as a
				// placeholder instead of masking it away, so a dynamic
				// import written with backticks is still walked. A
				// multi-line template keeps the newline-preserving mask.
				if (!frame.interpolated && !frame.hasNewline) {
					literals.push(source.slice(frame.sourceStart, i));
					out = `${out.slice(0, frame.outStart)}${MASK_SENTINEL}${literals.length - 1}${MASK_SENTINEL}`;
				}
				out += ' ';
				i += 1;
				continue;
			}
			if (char === '\n') {
				top().hasNewline = true;
				out += '\n';
				i += 1;
				continue;
			}
			if (char === '$' && next === '{') {
				top().interpolated = true;
				stack.push({ type: 'code', braceDepth: 0 });
				out += '  ';
				i += 2;
				continue;
			}
			out += char === '\n' ? '\n' : ' ';
			i += 1;
			continue;
		}

		if (char === '/' && next === '/') {
			let end = source.indexOf('\n', i);
			if (end === -1) end = source.length;
			out += maskNonCodeLength(source.slice(i, end));
			i = end;
			continue;
		}
		if (char === '/' && next === '*') {
			let end = source.indexOf('*/', i + 2);
			end = end === -1 ? source.length : end + 2;
			out += maskNonCodeLength(source.slice(i, end));
			i = end;
			continue;
		}
		if (
			char === '/' &&
			(lastSignificant === '' ||
				'(,=:[!&|?{};+-*%^~<>'.includes(lastSignificant) ||
				REGEX_KEYWORDS.has(lastWord))
		) {
			// A regular-expression literal, not a division. Masking it
			// keeps a quote inside the pattern from opening a "string"
			// that would swallow real code.
			let end = i + 1;
			let inClass = false;
			let terminated = false;
			while (end < source.length) {
				const current = source[end];
				if (current === '\\') {
					end += 2;
					continue;
				}
				if (current === '[') inClass = true;
				else if (current === ']') inClass = false;
				else if (current === '/' && !inClass) {
					terminated = true;
					break;
				} else if (current === '\n') break;
				end += 1;
			}
			end = Math.min(end, source.length);
			if (terminated) {
				// The terminating `/` and its flags belong to the same
				// literal. Leaving the `/` in place would make the next
				// iteration read it as the *start* of another literal
				// (`lastSignificant` is still `=`), and the rest of the
				// line — `/home/gi.test(route.title)` — would be masked
				// as pattern text, hiding a real edge behind it.
				end += 1;
				while (end < source.length && /[a-z]/i.test(source[end])) end += 1;
			}
			out += maskNonCodeLength(source.slice(i, end));
			i = end;
			continue;
		}
		if (char === "'" || char === '"') {
			let end = i + 1;
			while (end < source.length) {
				if (source[end] === '\\') {
					end += 2;
					continue;
				}
				if (source[end] === char || source[end] === '\n') break;
				end += 1;
			}
			end = Math.min(end, source.length);
			literals.push(source.slice(i + 1, end));
			out += `"${MASK_SENTINEL}${literals.length - 1}${MASK_SENTINEL}"`;
			i = end + 1;
			continue;
		}
		if (char === '`') {
			stack.push({
				type: 'template',
				braceDepth: 0,
				interpolated: false,
				hasNewline: false,
				sourceStart: i + 1,
				outStart: out.length,
			});
			out += ' ';
			i += 1;
			continue;
		}
		if (char === '{') {
			top().braceDepth += 1;
		} else if (char === '}') {
			if (top().braceDepth === 0 && stack.length > 1) {
				// Closes a `${ … }` interpolation: back to template text.
				stack.pop();
				out += ' ';
				i += 1;
				continue;
			}
			top().braceDepth = Math.max(0, top().braceDepth - 1);
		}

		if (!/\s/.test(char)) lastSignificant = char;
		lastWord = /[A-Za-z0-9_$]/.test(char) ? lastWord + char : '';
		out += char;
		i += 1;
	}

	return { masked: out, literals };
}

/** Recover the original specifier behind a masked placeholder. */
function literalText(token, literals) {
	const match = MASKED_LITERAL.exec(token);
	if (!match) return token;
	return literals[Number(match[1])] ?? token;
}

const pieces = (entry) => entry.split(/\s+as\s+/).map((piece) => piece.trim());

/**
 * Whether an import clause ships runtime code at all.
 *
 * `import type … from` and `import { type A } from` are both erased by
 * TypeScript under `verbatimModuleSyntax`, so neither is a runtime edge
 * (`home → http` in AGENTS.md §3 may be written either way). A clause
 * that binds anything at runtime stays a runtime edge:
 * `import { type A, b }` binds `b`, and `import Def, { type A }`
 * binds the default export.
 */
function isTypeOnlyClause(clause) {
	// `^type\b` and not `startsWith('type')`: a default import named
	// `types` is a runtime edge, and calling it type-only would be
	// exactly the silent false negative this gate exists to prevent.
	if (/^type(\s|$)/.test(clause)) return true;
	const named = clause.match(/\{([\s\S]*)\}/);
	if (!named) return false;
	// A default or namespace binding outside the braces is runtime.
	if (clause.split('{')[0].trim().length > 0) return false;
	const entries = named[1]
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	// `import {} from` binds nothing; treat it as a runtime edge.
	if (entries.length === 0) return false;
	return entries.every((entry) => {
		const imported = pieces(entry)[0];
		return imported === 'type' || imported.startsWith('type ');
	});
}

/**
 * Whether an `export { … }` clause re-exports type-only bindings.
 *
 * `export { type Data } from …` is erased exactly like `export type {
 * Data } from …`; reading only the leading `type` keyword would treat
 * the inline form as a runtime re-export and report a false boundary
 * hit. A mixed clause (`export { type A, b } from …`) still ships `b`,
 * so it stays runtime.
 */
function isTypeOnlyExportClause(clause) {
	const named = clause.match(/\{([\s\S]*)\}/);
	if (!named) return false;
	const entries = named[1]
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (entries.length === 0) return false;
	return entries.every((entry) => {
		const exported = pieces(entry)[0];
		return exported === 'type' || exported.startsWith('type ');
	});
}

/**
 * Parse the runtime-relevant edges of a masked module.
 *
 * `import type … from`, `import { type A } from`, `export type … from`
 * and `export { type A } from` are erased by TypeScript under
 * `verbatimModuleSyntax`, so they are recorded as type-only edges and
 * never traversed. `import { type A, b }` stays a runtime edge: the
 * statement also binds `b`.
 *
 * Each edge keeps its position in the masked source so the walk can
 * tell a dynamic `import()` inside a `.handler(…)` body (Worker-only)
 * from one the preview evaluates.
 */
function parseEdges(masked, literals) {
	const specifier = (token) => literalText(token, literals);
	const edges = [];
	for (const match of masked.matchAll(IMPORT_FROM)) {
		const clause = match[1].trim();
		edges.push({
			specifier: specifier(match[2]),
			clause,
			kind: isTypeOnlyClause(clause) ? 'import-type' : 'import',
			start: match.index ?? 0,
		});
	}
	for (const match of masked.matchAll(IMPORT_SIDE_EFFECT)) {
		edges.push({
			specifier: specifier(match[1]),
			clause: '',
			kind: 'import-side-effect',
			start: match.index ?? 0,
		});
	}
	for (const match of masked.matchAll(IMPORT_DYNAMIC)) {
		edges.push({
			specifier: specifier(match[1] ?? match[2]),
			clause: '',
			kind: 'import-dynamic',
			start: match.index ?? 0,
		});
	}
	for (const match of masked.matchAll(EXPORT_FROM)) {
		const clause = match[2].trim();
		const typeOnly = Boolean(match[1]) || isTypeOnlyExportClause(clause);
		edges.push({
			specifier: specifier(match[3]),
			clause,
			kind: typeOnly ? 'export-type' : 'export-from',
			start: match.index ?? 0,
		});
	}
	return edges;
}

const isTypeOnlyEdge = (edge) => edge.kind === 'import-type' || edge.kind === 'export-type';

/**
 * A server-function seam: a module that declares a TanStack Start
 * server function. Its `.handler(…)` bodies only run on the Worker,
 * so they — and only they — are outside the preview graph.
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
 * The local names a module calls the server-function factory by.
 *
 * `import { createServerFn as serverFn }` means the chain on disk is
 * `serverFn(…).handler(…)`. Searching for the *imported* name would
 * find no handler range, so every handler-only import would look
 * client-reachable and a legitimate seam would be reported as a
 * violation.
 */
function seamFactoryNames(edges) {
	const names = new Set(['createServerFn', 'createServerFunction']);
	for (const edge of edges) {
		if (isTypeOnlyEdge(edge)) continue;
		if (edge.specifier !== '@tanstack/react-start') continue;
		const named = edge.clause.match(/\{([\s\S]*)\}/);
		if (!named) continue;
		for (const part of named[1].split(',')) {
			const entry = part.trim();
			if (entry.length === 0) continue;
			const [imported, local] = pieces(entry);
			if (!names.has(imported)) continue;
			names.add(local ?? imported);
		}
	}
	return [...names];
}

/** The index just past the group opened at `open`, or -1. */
function balancedClose(text, open) {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const char = text[i];
		if (char === '(' || char === '[' || char === '{') depth += 1;
		else if (char === ')' || char === ']' || char === '}') {
			depth -= 1;
			if (depth === 0) return i;
			if (depth < 0) return -1;
		}
	}
	return -1;
}

/**
 * The ranges covered by a `createServerFn(…).handler(…)` body.
 *
 * Only the `.handler(…)` group is treated as Worker-only: everything
 * else in the chain (input validators, the method descriptor) is code
 * the client bundle carries. The factory is matched under every local
 * name the module imports it as.
 */
function findHandlerRanges(masked, factoryNames = ['createServerFn', 'createServerFunction']) {
	const alternation = [...new Set(factoryNames)]
		.sort((a, b) => b.length - a.length)
		.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('|');
	const factory = new RegExp(`\\b(?:${alternation})\\s*\\(`, 'g');
	const ranges = [];
	for (const match of masked.matchAll(factory)) {
		let open = masked.indexOf('(', match.index);
		let chain = 0;
		while (chain < 32) {
			chain += 1;
			const close = balancedClose(masked, open);
			if (close === -1) break;
			const rest = masked.slice(close + 1);
			const next = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(rest);
			if (!next) break;
			const groupStart = close + 1 + rest.indexOf('(');
			const groupEnd = balancedClose(masked, groupStart);
			if (groupEnd === -1) break;
			if (next[1] === 'handler') {
				ranges.push({ start: close + 1, end: groupEnd + 1 });
			}
			open = groupStart;
		}
	}
	return ranges;
}

/**
 * A dynamic `import()` the Worker alone evaluates: the call sits inside
 * a `.handler(…)` body, which never runs in the preview. The edge is
 * still a real server-only dependency, so it must not turn a legitimate
 * story into a failure. Static imports cannot appear inside a function
 * body, so only dynamic edges need this check.
 */
function isHandlerConfinedEdge(edge, handlerRanges) {
	return (
		edge.kind === 'import-dynamic' &&
		handlerRanges.some((range) => edge.start >= range.start && edge.start < range.end)
	);
}

/**
 * The edges of a module that the preview graph contains.
 *
 * The rule is POSITION, not reachability. A module-level edge —
 * `import { env } from 'cloudflare:workers'`, a side-effect import, an
 * `export … from` re-export, or a dynamic `import()` the module
 * evaluates while loading — runs when the module is loaded, so it is
 * in the preview graph whichever export the story asked that module
 * for. Narrowing it by the bindings a story actually imports is
 * unsound, and unsound in the direction this gate exists to prevent:
 * `src/home/reactions/load.ts` binds `env` at module level while a
 * story imports only the export types, and the preview still has to
 * load the Workers virtual module.
 *
 * The one exception is positional too: a dynamic `import()` whose call
 * site sits inside a `.handler(…)` body never runs in the preview,
 * because the start compiler plugin is what removes that body from the
 * client build. See `isHandlerConfinedEdge`.
 */
function clientReachableEdges(module_) {
	return module_.edges.filter(
		(edge) => !isTypeOnlyEdge(edge) && !isHandlerConfinedEdge(edge, module_.handlerRanges),
	);
}

/** Parse one module's source into the walk's view of it. */
function analyzeModule(source) {
	const { masked, literals } = maskNonCode(source);
	const edges = parseEdges(masked, literals);
	const seam = isServerFnSeam(edges);
	const handlerRanges = seam ? findHandlerRanges(masked, seamFactoryNames(edges)) : [];
	return { edges, seam, handlerRanges };
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

/**
 * The `stories: [ … ]` globs declared by the Storybook config.
 *
 * A `stories` array that contains anything other than string literals
 * (a spread, a template literal, a helper call) is reported as
 * unreadable instead of being silently narrowed to the literals.
 */
function readStoryPatterns(root) {
	const configPath = join(root, '.storybook', 'main.ts');
	if (!existsSync(configPath)) return { patterns: [], reason: 'config-missing' };
	// Comments and string literals are masked first, so a commented-out
	// `stories: ['../src/safe/**']` left above the real config cannot
	// become the subject set and silently narrow the gate to stories that
	// all pass. The array entries survive as placeholders.
	const { masked, literals } = maskNonCode(readFileSync(configPath, 'utf8'));
	const block = masked.match(/stories\s*:\s*\[([\s\S]*?)\]/);
	if (!block) return { patterns: [], reason: 'no-stories-field' };
	const patterns = [];
	let residue = '';
	let cursor = 0;
	for (const match of block[1].matchAll(STRING_LITERAL)) {
		residue += block[1].slice(cursor, match.index);
		cursor = match.index + match[0].length;
		patterns.push({
			pattern: literalText(match[2], literals),
			baseDir: resolve(dirname(configPath), patternBase(literalText(match[2], literals))),
			regexp: globToRegExp(resolve(dirname(configPath), literalText(match[2], literals))),
		});
	}
	residue += block[1].slice(cursor);
	if (residue.replace(/[\s,]/g, '') !== '') {
		return { patterns: [], reason: 'non-literal-story-entry' };
	}
	if (patterns.length === 0) return { patterns: [], reason: 'no-stories-field' };
	return { patterns, reason: null };
}

/** The directory part of a glob: everything before its first wildcard. */
function patternBase(pattern) {
	const index = pattern.search(/[*?@{(]/);
	return index === -1 ? pattern : pattern.slice(0, index);
}

function collectSourceFiles(directory) {
	if (!existsSync(directory)) return [];
	if (statSync(directory).isFile()) return [directory];
	if (PRUNED_DIRECTORIES.has(directory.split(sep).at(-1))) return [];
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
const toPosix = (path) => path.split(sep).join('/');
const boundaryOf = (relativePath) =>
	FOREIGN_BOUNDARIES.find((candidate) => candidate.pattern.test(relativePath)) ?? null;

/**
 * Walk one story's runtime import closure.
 *
 * `via` records the path so a violation names the exact edge chain
 * that has to change, instead of just the two endpoints.
 */
function inspectStory(root, srcRoot, storyFile) {
	const storyRel = toPosix(relative(root, storyFile));
	const violations = [];
	const unresolved = [];
	const unresolvedExternal = [];
	const seams = [];
	const externalPackages = new Set();
	const externalModules = new Set();
	const modules = new Set();
	const visited = new Set();
	const cache = new Map();
	const queue = [{ file: storyFile, path: [] }];

	const analyze = (file) => {
		const cached = cache.get(file);
		if (cached) return cached;
		const analyzed = analyzeModule(readFileSync(file, 'utf8'));
		cache.set(file, analyzed);
		return analyzed;
	};

	while (queue.length > 0) {
		const { file, path } = queue.shift();
		if (visited.has(file)) continue;
		visited.add(file);
		modules.add(file);

		const fromRel = toPosix(relative(root, file));
		const module_ = analyze(file);

		for (const edge of clientReachableEdges(module_)) {
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
				// Outside `src/`: only generated output (`styled-system/`)
				// and assets are terminal leaves. A *source* file there is
				// still part of the preview graph, so it is walked —
				// otherwise a story declared outside `src/` could reach a
				// boundary through its sibling helper and pass.
				if (!resolved) {
					unresolvedExternal.push(label);
					continue;
				}
				if (!SOURCE_EXTENSIONS.includes(extname(resolved))) {
					externalModules.add(toPosix(relative(root, resolved)));
					continue;
				}
				queue.push({ file: resolved, path: [...path, label] });
				continue;
			}

			if (!resolved) {
				unresolved.push(label);
				continue;
			}
			if (!SOURCE_EXTENSIONS.includes(extname(resolved))) {
				externalModules.add(toPosix(relative(root, resolved)));
				continue;
			}

			const toRel = toPosix(relative(root, resolved));
			const boundary = boundaryOf(toRel);
			if (boundary) {
				violations.push({ boundary: boundary.id, edge: label, via: [...path, label] });
				continue;
			}

			const targetModule = analyze(resolved);
			if (targetModule.seam) {
				seams.push({ edge: label, via: [...path, label] });
			}
			queue.push({ file: resolved, path: [...path, label] });
		}
	}

	const dedupeChains = (entries) => [
		...new Map(entries.map((entry) => [entry.via.join('\u0000'), entry])).values(),
	];
	const dedupeLabels = (entries) => [...new Set(entries)];
	const verdict = violations.length > 0 ? 'fail' : unresolved.length > 0 ? 'not-run' : 'pass';
	return {
		file: storyRel,
		verdict,
		modules: modules.size,
		violations: dedupeChains(violations),
		unresolved: dedupeLabels(unresolved),
		unresolvedExternal: dedupeLabels(unresolvedExternal),
		seams: dedupeChains(seams),
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
		for (const edge of story.unresolvedExternal) {
			out.write(`        external ${edge} (outside src/, unresolvable — see known limitations)\n`);
		}
	}

	out.write('\nnot applicable — foreign boundaries excluded from the subject set\n');
	for (const boundary of report.notApplicable) {
		out.write(`  - ${boundary.label}\n      ${boundary.reason}\n`);
	}
	if (report.notApplicableSubjects.length > 0) {
		out.write('  stories living inside a foreign boundary (rule targets, not subjects):\n');
		for (const entry of report.notApplicableSubjects) {
			out.write(`  - ${entry.file}  [${entry.boundary}]\n`);
		}
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
			`[storybook:ownership:check] cannot read the subject set: ${reason}\nExpected \`stories: [ … ]\` string literals in .storybook/main.ts.\n`,
		);
		return 2;
	}

	const outsideRepo = patterns.filter((entry) => !isInside(root, entry.baseDir));
	if (outsideRepo.length > 0) {
		process.stderr.write(
			`[storybook:ownership:check] a stories glob resolves outside the repository: ${outsideRepo
				.map((entry) => entry.pattern)
				.join(', ')}\nA narrower subject set is never reported as a pass.\n`,
		);
		return 2;
	}

	// Every glob's non-glob prefix is a walk root, so a story declared
	// outside `src/` is still a subject.
	const candidates = [...new Set(patterns.flatMap((entry) => collectSourceFiles(entry.baseDir)))];

	const subjects = [];
	const notApplicableSubjects = [];
	for (const file of candidates.sort()) {
		if (!patterns.some((entry) => entry.regexp.test(file))) continue;
		const relativePath = toPosix(relative(root, file));
		const boundary = boundaryOf(relativePath);
		if (boundary) {
			notApplicableSubjects.push({
				file: relativePath,
				boundary: boundary.id,
				label: boundary.label,
				reason: boundary.reason,
			});
			continue;
		}
		subjects.push(file);
	}

	if (subjects.length === 0) {
		process.stderr.write(
			notApplicableSubjects.length > 0
				? `[storybook:ownership:check] every story matching .storybook/main.ts lives inside a foreign boundary (${notApplicableSubjects.length} excluded), so there is no subject to walk.\nThe foreign boundaries are this rule's TARGETS, not its subjects; move the story next to the obligation that owns it.\n`
				: '[storybook:ownership:check] no story file matches .storybook/main.ts\n',
		);
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
		notApplicableSubjects,
		knownLimitations: [
			"server-function seam: the walk stops inside a createServerFn(…).handler(…) body, because only the start compiler plugin removes it from the client build. Every module-level edge of the seam is walked — a module-level `import { env } from 'cloudflare:workers'` runs when the module loads, so a story that imports only the export types still has to load the virtual module and still fails. Server-only bindings must be resolved with `await import(…)` inside the handler body (see src/home/reactions/load.ts).",
			'only the `~/` alias (the one `vite.config.ts` / `.storybook/main.ts` declare) is resolved. Any other alias-shaped specifier (`@/…`) reads as an external package and is a terminal leaf, so a boundary reached through a newly added alias would pass silently; add the alias here when one is added to the bundler config.',
			'the walk reads ES import syntax, not JSX text: a story that renders an import example as literal JSX children (`<code>import … from …</code>`) instead of a string still needs a comment, not raw text.',
			`${WORKER_VIRTUAL_MODULES.size} Workers virtual module (${[...WORKER_VIRTUAL_MODULES].join(', ')}) cannot resolve in a browser preview at all — this check treats any direct or transitive edge to it as a violation.`,
			'a specifier that resolves outside src/ is a terminal leaf only when it is generated output (`styled-system/`) or an asset; a source file outside src/ is walked like any other module. When such a path does not exist it is printed as `external` instead of failing the walk, so a stale generated path is a documented manual check.',
			'the walk is regex-based over ES import syntax; computed specifiers, CommonJS require() and an interpolated import(`${name}`) are not inspected (a template without interpolation names a real specifier and is walked).',
		],
	};

	printReport(report, process.stdout);

	if (options.json) {
		mkdirSync(dirname(options.json), { recursive: true });
		writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
		process.stdout.write(`\njson report: ${toPosix(relative(root, options.json))}\n`);
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
