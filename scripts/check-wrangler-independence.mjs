/**
 * Runtime independence from Wrangler (Issue #247, cleanup slice).
 *
 * Two halves, because neither alone is sufficient:
 *
 *   1. LOAD. Import each converted production script with `wrangler`
 *      made genuinely unresolvable (`_no-wrangler-hook.mjs`). This is
 *      the half that matters: `require.resolve('wrangler/package.json')`
 *      at module scope is not an invocation, so an invocation grep
 *      misses it, but it still breaks the script the moment the
 *      dependency is removed.
 *
 *   2. STATIC. Reject any live wrangler reference in the runtime
 *      paths. This covers the scripts that execute at module scope
 *      (`verify-portfolio.mjs`, `seed-portfolio-path-a.mjs`,
 *      `upload-portfolio-media.mjs`) and cannot be imported to test,
 *      and it catches references a future edit reintroduces.
 *
 * The static half distinguishes a *live* reference from prose: matches
 * inside a comment or a docstring are allowed, because ADRs, runbooks,
 * and migration notes record what the pipeline used to do and rewriting
 * that history is not this check's job.
 *
 * Exit: 0 independent, 1 dependent, 2 bad input.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');
const E2E_DIR = join(REPO_ROOT, 'e2e');

/**
 * Converted production scripts that are safe to import: they parse
 * arguments and act inside a function, not at module scope.
 */
const IMPORTABLE = [
	'scripts/phase-3-plus-prod-flip.mjs',
	'scripts/rotate-better-auth-secret.mjs',
	'scripts/rotate-home-api-key.mjs',
	'scripts/publish-portfolio-production.mjs',
];

/**
 * This check's own infrastructure necessarily names wrangler, so it is
 * excluded — otherwise the gate fails on the file that implements it.
 */
const SELF = new Set([
	join('scripts', 'check-wrangler-independence.mjs'),
	join('scripts', '_no-wrangler-hook.mjs'),
	join('scripts', '_no-wrangler-resolver.mjs'),
]);

/**
 * Runtime paths scanned statically. Self-executing scripts live here
 * because importing them would run them.
 *
 * Test files are EXCLUDED, and that is a deliberate trade rather than an
 * oversight. A test that asserts wrangler is gone necessarily contains
 * the string: `assert.ok(!source.includes('wrangler.production.jsonc'))`,
 * or a case that passes `--config=wrangler.production.jsonc` expecting a
 * rejection. Flagging those would mean a check that fails on its own
 * regression guards, and a check like that gets deleted rather than
 * fixed.
 *
 * The coverage those tests would have provided is not lost: the load
 * half above imports the real production scripts with wrangler made
 * unresolvable, which is a stronger statement than scanning text. What
 * this half adds is the self-executing scripts that cannot be imported.
 */
const STATIC_TARGETS = [
	...readdirSync(SCRIPTS_DIR)
		.filter((name) => name.endsWith('.mjs') || name.endsWith('.ts'))
		.filter((name) => !name.endsWith('.test.mjs'))
		.map((name) => join('scripts', name)),
	// Playwright specs are NOT excluded: unlike the `*.test.mjs` files
	// above, a spec is real code that runs against a real environment,
	// so a Wrangler call in one is genuine operational access.
	...readdirSync(E2E_DIR)
		.filter((name) => name.endsWith('.ts') || name.endsWith('.mjs'))
		.map((name) => join('e2e', name)),
].filter((relative) => !SELF.has(relative));

/**
 * Strip comments so prose about Wrangler does not trip the scanner.
 *
 * Block comments and line comments are removed; string literals are
 * kept, because `'wrangler'` as an argv element is exactly the live
 * reference we are looking for.
 */
function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * A wrangler mention that survives comment-stripping AND appears in an
 * executable position.
 *
 * Deliberately narrow. A bare word match flags dry-run display strings
 * and JSDoc that merely *name* wrangler, which are documentation, not
 * access — and a check that cries wolf gets deleted rather than fixed.
 * What must never reappear is wrangler as a thing the code resolves,
 * spawns, or imports.
 */
const EXECUTABLE_REFERENCE = [
	// resolve / import
	/require\s*\.\s*resolve\s*\(\s*['"`]wrangler/,
	/\bfrom\s+['"`]wrangler(\/|['"`])/,
	/\bimport\s*\(\s*['"`]wrangler/,
	// spawn: spawn('wrangler'), ['wrangler', …], 'exec', 'wrangler'
	/\bspawn(?:Sync)?\s*\(\s*['"`]wrangler/,
	/['"`]wrangler['"`]\s*,/,
	// config files read at runtime.
	//
	// `(\.[a-z-]+)?` rather than `production?`: the latter means
	// "productio" plus an optional "n", so it matched ONLY
	// `wrangler.production.jsonc` and silently missed plain
	// `wrangler.jsonc` — which is exactly the file this gate is meant to
	// catch, and exactly the one `generate-dev-vars.mjs` still reads.
	/['"`][^'"`]*wrangler(\.[a-z-]+)?\.jsonc['"`]/,
];

function isLiveReference(code) {
	return EXECUTABLE_REFERENCE.some((pattern) => pattern.test(code));
}

function staticOffenders() {
	const offenders = [];
	for (const relative of STATIC_TARGETS) {
		let source;
		try {
			source = readFileSync(join(REPO_ROOT, relative), 'utf8');
		} catch {
			continue;
		}
		if (isLiveReference(stripComments(source))) offenders.push(relative);
	}
	return offenders;
}

function loadUnderNoWrangler() {
	const failures = [];
	for (const relative of IMPORTABLE) {
		const absolute = join(REPO_ROOT, relative);
		try {
			execFileSync(
				process.execPath,
				[
					'--import',
					join(SCRIPTS_DIR, '_no-wrangler-hook.mjs'),
					'--input-type=module',
					'-e',
					`await import(${JSON.stringify(absolute)});`,
				],
				{ cwd: REPO_ROOT, stdio: 'pipe', timeout: 120_000 },
			);
		} catch (error) {
			const stderr = String(error.stderr ?? error.message);
			failures.push({ file: relative, detail: stderr.split('\n').slice(0, 4).join(' ') });
		}
	}
	return failures;
}

function main() {
	const failures = loadUnderNoWrangler();
	const offenders = staticOffenders();

	if (failures.length === 0 && offenders.length === 0) {
		process.stdout.write(
			`wrangler independence OK: ${IMPORTABLE.length} scripts load with wrangler unresolvable; ` +
				`${STATIC_TARGETS.length} runtime files free of live wrangler references\n`,
		);
		return 0;
	}

	if (failures.length > 0) {
		process.stderr.write('these scripts fail to load when wrangler is unresolvable:\n');
		for (const { file, detail } of failures) {
			process.stderr.write(`  - ${file}\n      ${detail}\n`);
		}
	}
	if (offenders.length > 0) {
		process.stderr.write('\nlive wrangler references in runtime paths (outside comments):\n');
		for (const file of offenders) process.stderr.write(`  - ${file}\n`);
	}
	process.stderr.write(
		'\nRuntime code must reach Cloudflare only through the repository adapters:\n' +
			'  D1            -> scripts/_d1.mjs\n' +
			'  R2            -> scripts/_r2.mjs\n' +
			'  Worker secret -> scripts/_worker-secrets.mjs\n',
	);
	return 1;
}

process.exit(main());
