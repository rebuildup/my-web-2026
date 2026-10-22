/**
 * Decide which test files need the Workers test pool connection
 * (Issue #618).
 *
 * `test/setup/better-auth-schema.ts` imports `cloudflare:test` to reach
 * `env.DB`. That import connects the test file to the pool (Miniflare)
 * and costs ~2.4s per test FILE — paid by every file while the setup
 * imported it unconditionally. Only files whose runtime import graph
 * can reach `cloudflare:test` (bindings) or `cloudflare:workers` (the
 * `env` accessor) need that connection, so `vitest.config.ts` computes
 * the set here and the setup file applies the schema only for those.
 *
 * Reachability is TRANSITIVE. `src/http/seo/router.test.ts` imports
 * `src/http/hono.ts`, which imports `src/http/auth/router.ts` and so
 * on to `src/cloudflare/auth/better-auth.ts`, which reads `env` from
 * `cloudflare:workers` at module scope. Skipping the connection for
 * that file does not fail an assertion; the module import itself never
 * resolves, so the test times out. A direct-text scan of the test file
 * is therefore not sufficient.
 *
 * Fail-safe direction
 * -------------------
 * The walk treats a relative or `~`-aliased import it cannot resolve
 * as "connects to the pool". Over-inclusion costs the connection the
 * file used to pay unconditionally; under-inclusion loses a test. Bare
 * package specifiers (`vitest`, `hono`, `node:*`) are not walked: they
 * cannot reach this repository's `env` module. If the walk cannot read
 * a file at all, that file is treated as connecting.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Test entry points the Vitest workerd config includes. */
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:ts|tsx)$/;

/** Module specifiers that require the Workerd pool connection. */
const POOL_CONNECTION_SPECIFIERS = ['cloudflare:test', 'cloudflare:workers'];

/**
 * `import ... from 'x'`, `import 'x'`, `export ... from 'x'`,
 * `import('x')`. The static branch's middle is `[^'"]*?` rather than
 * `[\s\S]*?` so a side-effect import (`import './x';`) cannot be
 * swallowed by a later `from` clause; a quoted specifier is the only
 * thing that ends a module specifier anyway.
 */
const IMPORT_PATTERN =
	/(?:^|[^\w$])(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|(?:^|[^\w$])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Source extensions tried for an extensionless specifier. */
const SOURCE_SUFFIXES = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx'];

/**
 * Extensions that can be imported but cannot import back. Reaching one
 * ends the walk; it can never lead to this repository's `env` module.
 * Panda CSS generates `styled-system/**` from `src/**` at install time,
 * so that tree is generated output, not a path into `src`.
 */
const TERMINAL_SUFFIXES = [
	'.json',
	'.webp',
	'.png',
	'.jpg',
	'.jpeg',
	'.svg',
	'.avif',
	'.gif',
	'.css',
	'.txt',
	'.wasm',
];

/** Vite query suffixes (`?url`, `?raw`, `?worker`) are not part of the path. */
const VITE_QUERY_PATTERN = /[?#].*$/;

/** The `~/*` alias declared in `tsconfig.json` / `vite.config.ts`. */
const ALIAS_PREFIX = '~/';

/**
 * Absolute, sorted paths of test files under `dirs` whose transitive
 * import graph can reach a Workerd-pool module.
 *
 * `rootDir` is the repository root; the walk only follows relative and
 * `~`-aliased imports, so it never enters `node_modules`.
 */
export function discoverAuthSchemaTestFiles(
	rootDir,
	{ dirs = ['src', 'test'], specifiers = POOL_CONNECTION_SPECIFIERS } = {},
) {
	const root = resolve(rootDir);
	const reachMemo = new Map();
	const visiting = new Set();

	/** Does `file` (or anything it imports) connect to the pool? */
	const connects = (file) => {
		if (reachMemo.has(file)) return reachMemo.get(file);
		if (visiting.has(file)) return false; // cycle: decided by another path
		visiting.add(file);

		let source;
		try {
			source = readFileSync(file, 'utf8');
		} catch {
			visiting.delete(file);
			reachMemo.set(file, true);
			return true;
		}

		let result = specifiers.some((specifier) => source.includes(specifier));
		if (!result) {
			for (const specifier of extractSpecifiers(source)) {
				const resolved = resolveLocalSpecifier(specifier, file, root);
				if (resolved === null) continue; // bare package / node: builtin
				if (resolved === undefined) {
					// A local-looking import we cannot resolve. Fail safe: we
					// cannot prove the file stays disconnected.
					result = true;
					break;
				}
				if (connects(resolved)) {
					result = true;
					break;
				}
			}
		}

		visiting.delete(file);
		reachMemo.set(file, result);
		return result;
	};

	const found = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			// A missing directory is an empty candidate set. The gate that
			// proves the suite is wired (check-test-wiring.mjs) is what
			// fails when the tree disappears, not this scan.
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name) && connects(full)) {
				found.push(resolve(full));
			}
		}
	};

	for (const dir of dirs) walk(resolve(root, dir));
	return found.sort();
}

/** Every module specifier mentioned by an import / export / dynamic import. */
export function extractSpecifiers(source) {
	const specifiers = [];
	for (const match of source.matchAll(IMPORT_PATTERN)) {
		specifiers.push(match[1] ?? match[2]);
	}
	return specifiers;
}

/**
 * Resolve a specifier to an absolute file path.
 *
 * Returns `null` for a bare package / `node:` builtin and for a settled
 * terminal (generated `styled-system/**`, a non-source asset): neither
 * can import this repository's `env` module, so the walk ends there.
 * Returns `undefined` for a local-looking specifier that does not
 * resolve (caller fails safe), and a source path otherwise.
 */
export function resolveLocalSpecifier(specifier, fromFile, rootDir) {
	const path = specifier.replace(VITE_QUERY_PATTERN, '');
	if (path.startsWith('node:')) return null;

	let base;
	if (path.startsWith('.')) {
		base = resolve(dirname(fromFile), path);
	} else if (path.startsWith(ALIAS_PREFIX)) {
		base = resolve(rootDir, 'src', path.slice(ALIAS_PREFIX.length));
	} else {
		return null; // bare package specifier
	}

	for (const suffix of ['', ...SOURCE_SUFFIXES]) {
		const candidate = `${base}${suffix}`;
		if (isFile(candidate)) return settle(candidate, rootDir);
	}

	// `import './mock'` and `import '~/editorial/forms'` resolve to a
	// directory's index file, exactly as Vite does.
	for (const suffix of SOURCE_SUFFIXES) {
		const index = `${base}/index${suffix}`;
		if (isFile(index)) return settle(index, rootDir);
	}

	for (const suffix of TERMINAL_SUFFIXES) {
		if (isFile(`${base}${suffix}`)) return null;
	}
	return undefined;
}

function isFile(path) {
	return existsSync(path) && statSync(path).isFile();
}

/** A resolved path outside `src/` or `test/` is generated / vendored. */
function settle(path, rootDir) {
	const relative = path.slice(resolve(rootDir).length + 1);
	if (relative.startsWith('src/') || relative.startsWith('test/')) return path;
	return null;
}
