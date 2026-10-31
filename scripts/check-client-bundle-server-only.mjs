#!/usr/bin/env node
/**
 * Server-only code must not reach the browser bundle (Issue #724).
 *
 * Why this gate exists
 * --------------------
 * The client bundle grew to ~1.69 MB because two server-only things were
 * reachable from it:
 *
 *   1. the Better Auth **server** stack (the core package, Kysely,
 *      Drizzle, the SQLite dialects, the API-key plugin) — roughly
 *      700 KB — imported at module level by four admin modules, and
 *   2. `emoji-picker-react` (335 KB), whose `EmojiStyle` / `Theme`
 *      string enums were imported as **values** and therefore defeated
 *      the `lazy()` split that was supposed to keep the picker out of
 *      first paint.
 *
 * The byte budget noticed only that "the entry chunk got bigger". It
 * could not say **what** got bigger, so the response was to raise the
 * cap — seven times. This gate closes that loop: it names the module,
 * so the response can be "fix the import" instead.
 *
 * What it checks
 * --------------
 * Every chunk the client build emitted, and therefore every module a
 * browser could be asked to download:
 *
 *   - a module from a **server-only package** (the policy file lists
 *     them: `better-auth`, `kysely`, `drizzle-orm`, …), or
 *   - a repository module under a **server-only source path** (the
 *     policy file lists them: `src/cloudflare/auth/`, the auth
 *     foundation that binds to D1).
 *
 * A **lazy** chunk counts too. A server-only chunk that is never
 * fetched is still shipped to every CDN edge and still shows up in the
 * deploy artefact; the browser bundle is not the place for it.
 *
 * The policy file
 * ---------------
 * `quality/client-bundle-policy.json` holds both lists. It is a
 * declaration, not a measurement — the same shape as every other
 * declared rule in `quality/` — so it is reviewed like one: a new entry
 * is a claim that the package/path is server-only, and the gate is what
 * turns the claim into a red build when the claim stops being true.
 *
 * Usage
 * -----
 *   node scripts/check-client-bundle-server-only.mjs
 *   node scripts/check-client-bundle-server-only.mjs --graph=<path> --policy=<path>
 *   node scripts/check-client-bundle-server-only.mjs --json
 *
 * Exit codes: 0 = no server-only module in the client bundle; 1 = at
 * least one offender; 2 = bad input (missing graph, malformed policy).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_GRAPH = join(REPO_ROOT, 'dist', 'client', 'bundle-graph.json');
const DEFAULT_POLICY = join(REPO_ROOT, 'quality', 'client-bundle-policy.json');

function parseArg(argv, name) {
	for (const arg of argv) {
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return null;
}

function readJson(path, label) {
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		throw new Error(`${label} not found: ${path}`);
	}
	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new Error(`${label} is not valid JSON: ${path} (${error.message})`);
	}
}

/**
 * Every module id in the graph, with the chunk it was found in.
 *
 * The graph records modules per chunk, so an offender is reported with
 * the chunk name — "the entry chunk" versus "a lazy route chunk" is the
 * difference between "every visitor downloads this" and "one route
 * downloads this".
 */
export function collectModules(graph) {
	const found = new Map();
	for (const [fileName, chunk] of Object.entries(graph.chunks ?? {})) {
		for (const moduleId of chunk.modules ?? []) {
			if (!found.has(moduleId)) found.set(moduleId, new Set());
			found.get(moduleId).add(fileName);
		}
	}
	return found;
}

/**
 * The modules the policy declares server-only.
 *
 * @param {object} policy parsed `quality/client-bundle-policy.json`
 * @returns {{package: string[], module_prefix: string[]}}
 */
export function policyRules(policy) {
	const packages = policy?.server_only_packages;
	const prefixes = policy?.server_only_module_prefixes;
	if (!Array.isArray(packages) || !packages.every((p) => typeof p === 'string')) {
		throw new Error('policy.server_only_packages must be an array of strings');
	}
	if (!Array.isArray(prefixes) || !prefixes.every((p) => typeof p === 'string')) {
		throw new Error('policy.server_only_module_prefixes must be an array of strings');
	}
	return { package: packages, module_prefix: prefixes };
}

/**
 * Classify one module id against the policy.
 *
 * @param {string} moduleId normalised module id (`pkg:…` / `src:…`)
 * @param {{package: string[], module_prefix: string[]}} rules
 * @returns {string|null} the rule that matched, or null
 */
export function classifyModule(moduleId, rules) {
	if (moduleId.startsWith('pkg:')) {
		const name = moduleId.slice(4);
		if (rules.package.includes(name)) return `package ${name}`;
		return null;
	}
	if (moduleId.startsWith('src:') || moduleId.startsWith('src/')) {
		// The policy writes repository paths the way the repository spells
		// them (`src/cloudflare/auth/`), while the normalised module id
		// carries the same path relative to `src/` (`cloudflare/auth/…`).
		// The policy's leading `src/` is therefore dropped before the
		// comparison — the two are the same path, written twice.
		const path = moduleId.slice(4);
		for (const prefix of rules.module_prefix) {
			const comparable = prefix.startsWith('src/') ? prefix.slice(4) : prefix;
			if (path.startsWith(comparable)) return `source path ${prefix}`;
		}
	}
	return null;
}

/**
 * Find every server-only module in the graph.
 *
 * @param {object} graph parsed bundle graph
 * @param {object} policy parsed policy file
 * @returns {Array<{module: string, rule: string, chunks: string[]}>}
 */
export function findServerOnlyModules(graph, policy) {
	const rules = policyRules(policy);
	const offenders = [];
	for (const [moduleId, chunks] of collectModules(graph)) {
		const rule = classifyModule(moduleId, rules);
		if (!rule) continue;
		offenders.push({ module: moduleId, rule, chunks: [...chunks].sort() });
	}
	return offenders.sort((a, b) => a.module.localeCompare(b.module));
}

function main(argv) {
	const graphPath = resolve(parseArg(argv, '--graph') ?? DEFAULT_GRAPH);
	const policyPath = resolve(parseArg(argv, '--policy') ?? DEFAULT_POLICY);
	const asJson = argv.includes('--json');

	if (!existsSync(graphPath)) {
		console.error(
			`[client-bundle-server-only] client bundle graph not found: ${graphPath}\n  Run \`pnpm run build\` first — the gate reads the graph the build emits.`,
		);
		return 2;
	}

	const graph = readJson(graphPath, 'client bundle graph');
	const policy = readJson(policyPath, 'client bundle policy');
	if (graph.schema_version !== 1 || typeof graph.chunks !== 'object') {
		console.error(
			`[client-bundle-server-only] unsupported bundle graph schema: ${graph.schema_version}`,
		);
		return 2;
	}

	const offenders = findServerOnlyModules(graph, policy);
	const chunkCount = Object.keys(graph.chunks ?? {}).length;
	const moduleCount = collectModules(graph).size;

	if (asJson) {
		console.log(
			JSON.stringify(
				{
					schema_version: 1,
					graph: graphPath,
					chunks: chunkCount,
					modules: moduleCount,
					offenders,
					verdict: offenders.length === 0 ? 'pass' : 'fail',
				},
				null,
				'\t',
			),
		);
	} else if (offenders.length === 0) {
		console.log(
			`[client-bundle-server-only] pass — ${moduleCount} module(s) in ${chunkCount} chunk(s), no server-only module.`,
		);
	} else {
		console.error(
			'[client-bundle-server-only] FAIL — server-only code reached the browser bundle:',
		);
		for (const offender of offenders) {
			console.error(
				`  ${offender.module}\n    rule: ${offender.rule}\n    chunk(s): ${offender.chunks.join(', ')}`,
			);
		}
		console.error(
			'\n  A server-only module in the client bundle means a browser downloads code it can\n  never use. Move the import behind `await import(…)` inside the function that\n  needs it (the TanStack Start compiler strips `.handler()` bodies from the\n  client build), or split the client-facing constant out of the server module.',
		);
	}

	return offenders.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		console.error(`[client-bundle-server-only] ${error.message}`);
		process.exitCode = 2;
	}
}
