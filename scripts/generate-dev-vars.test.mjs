import assert from 'node:assert/strict';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
/**
 * `generate-dev-vars.mjs` pure-helper tests (Issue #69, Phase 3 #69 sub-step 69.5).
 *
 * The full script opens an HTTPS connection to Infisical and writes
 * `.dev.vars` to disk; that path requires `INFISICAL_TOKEN` and is
 * exercised only in operator-side smoke. The pure helpers here are
 * unit-testable in isolation.
 *
 * Helpers under test:
 *   - parseJsonc(source)
 *   - parseSecretsResponse(jsonString)
 *   - formatDevVarsContent(secretMap)
 *   - isProdEnvironment(env)
 *   - writeDevVarsAtomic({ targetPath, content, writeFile, rename, unlink })
 *   - runMain({ repoRoot, argv, env })
 *
 * Operator-mandated invariants verified here:
 *   - Parser error messages never echo a secret value.
 *   - formatDevVarsContent quotes/escapes values so the output is
 *     parseable by `dotenv` parsers (round-trippable).
 *   - Lines in formatDevVarsContent are sorted alphabetically by
 *     key for stable diffs.
 *   - parseSecretsResponse silently drops items with missing key
 *     or null value (matches V3 placeholder rows).
 *   - isProdEnvironment refuses prod / production (case-insensitive).
 *   - writeDevVarsAtomic:
 *     - Pre-existing `.dev.vars.tmp` is NOT truncated or unlinked
 *       on EEXIST.
 *     - Successful exclusive create + rename failure → temp is
 *       cleaned up only when owned by this process.
 *     - Cleanup failure does NOT mask the original error.
 *   - runMain prod-reject fires BEFORE any HTTP or file write,
 *     leaving the scratch repo's `.dev.vars` unchanged and creating
 *     no `.dev.vars.tmp`.
 */
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REQUIRED_RUNTIME_SECRETS } from './_cloudflare-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'generate-dev-vars.mjs');

// Same regex-extraction pattern as
// `scripts/bootstrap-home-api-key.test.mjs:32-54`. We do not import
// the whole module because it runs at import time (parses argv,
// reads `.infisical.json`). Instead we slice out each pure helper
// via a regex and stitch them together inside an isolated
// factory closure.
/**
 * Extract a top-level function `name` from `source` by locating the
 * opening `function name(` and then using a paren counter to find
 * the matching `)`, then a brace counter to find the matching `}`.
 * Handles defaults that contain `(` (e.g. `process.argv.slice(2)`).
 * Strips an optional leading `export ` so the result is parseable
 * by `new Function(...)` in a non-module context.
 */
function extractFunction(source, name) {
	const headerRe = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
	const m = source.match(headerRe);
	if (!m) throw new Error(`Could not locate header for ${name}`);
	const startIdx = m.index;
	// Find matching close paren after the function name, scanning
	// from `(` (the one after the name).
	let depth = 0;
	let parenStart = -1;
	for (let i = m.index + m[0].length - 1; i < source.length; i++) {
		const ch = source[i];
		if (ch === '(') {
			if (parenStart === -1) parenStart = i;
			depth++;
		} else if (ch === ')') {
			depth--;
			if (depth === 0) {
				// `i` is at the closing paren. The opening `{` of
				// the function body follows; skip whitespace.
				let braceIdx = i + 1;
				while (braceIdx < source.length && /\s/.test(source[braceIdx])) braceIdx++;
				if (source[braceIdx] !== '{') {
					throw new Error(`Expected '{' after parameter list for ${name}`);
				}
				// Brace-counter from `braceIdx`.
				let bDepth = 0;
				for (let j = braceIdx; j < source.length; j++) {
					if (source[j] === '{') bDepth++;
					else if (source[j] === '}') {
						bDepth--;
						if (bDepth === 0) {
							return source.slice(startIdx, j + 1).replace(/^export\s+/, '');
						}
					}
				}
				throw new Error(`Could not find matching closing brace for ${name}`);
			}
		}
	}
	throw new Error(`Could not find matching closing paren for ${name}`);
}

async function loadPureHelpers() {
	const { readFileSync, writeFileSync, renameSync, unlinkSync } = await import('node:fs');
	const source = readFileSync(SCRIPT, 'utf8');

	const parseJsonc = extractFunction(source, 'parseJsonc');
	const parseSecretsResponse = extractFunction(source, 'parseSecretsResponse');
	const formatDevVarsContent = extractFunction(source, 'formatDevVarsContent');
	const isProdEnvironment = extractFunction(source, 'isProdEnvironment');
	const writeDevVarsAtomic = extractFunction(source, 'writeDevVarsAtomic');

	const factory = new Function(
		'writeFileSync',
		'renameSync',
		'unlinkSync',
		'DEV_VARS_TMP_SUFFIX',
		`
		${parseJsonc}
		${parseSecretsResponse}
		${formatDevVarsContent}
		${isProdEnvironment}
		${writeDevVarsAtomic}
		return {
			parseJsonc,
			parseSecretsResponse,
			formatDevVarsContent,
			isProdEnvironment,
			writeDevVarsAtomic,
		};
	`,
	);
	return factory(writeFileSync, renameSync, unlinkSync, '.tmp');
}

/**
 * Load `runMain` for execution-path tests. `runMain` references
 * module-scope constants (`REPO_ROOT`, `INFISICAL_API_URL_DEFAULT`)
 * and module-scope helpers (`readInfisicalWorkspaceId`,
 * `readWranglerSecretsRequired`, `parseSecretsRequired`,
 * `formatDevVarsContent`, `listInfisicalSecrets`, `isProdEnvironment`).
 * To run `runMain` in isolation we need to load a curated set of
 * helpers into the factory closure and inject the deps.
 *
 * This is more complex than `loadPureHelpers` because `runMain` is
 * async and has multiple dependency edges. We extract the helpers
 * the same way (brace-counter slice) and pre-build the dependency
 * graph.
 */
async function loadRunMain() {
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(SCRIPT, 'utf8');

	// Pull every helper `runMain` transitively touches. Keep this
	// list explicit — if a new helper is added inside `runMain`,
	// extend this list.
	const helperNames = [
		'parseArgs',
		'parseJsonc',
		'parseSecretsResponse',
		'formatDevVarsContent',
		'isProdEnvironment',
		'writeDevVarsAtomic',
	];
	const extracted = Object.fromEntries(helperNames.map((n) => [n, extractFunction(source, n)]));

	// `readInfisicalWorkspaceId` takes `repoRoot` as a defaulted
	// parameter, referencing the module's REPO_ROOT const as the
	// default. Rewrite the default to `null` so the injected `repoRoot`
	// is always used. Strip the defaulting expressions:
	function stripDefaults(body, paramNames) {
		let out = body;
		for (const p of paramNames) {
			out = out.replace(new RegExp(`(${p}\\s*=\\s*)[A-Za-z_$][A-Za-z0-9_$.]*`, 'g'), '$1null');
		}
		return out;
	}
	const readInfisicalWorkspaceId = stripDefaults(
		extractFunction(source, 'readInfisicalWorkspaceId'),
		['repoRoot'],
	);
	// `runMain` itself. We rewrite the parameter defaults so the
	// factory closure's own constants take over.
	const runMainBody = extractFunction(source, 'runMain').replace(
		/(repoRoot|argv|env)\s*=\s*[A-Za-z_$][A-Za-z0-9_$.]*(?:\(\))?/g,
		'$1=__placeholder',
	);

	// `listInfisicalSecrets` + `httpsJson` are unused in prod-reject
	// path, but the function definitions need to be in scope. We
	// provide stubs.
	const listInfisicalSecretsStub = `async function listInfisicalSecrets() { throw new Error('listInfisicalSecrets stub called'); }`;
	const httpsJsonStub = `async function httpsJson() { throw new Error('httpsJson stub called'); }`;

	// Provide a stub for `console.log` so test output stays clean
	// (still assertions on stderr / no-tmp).
	const consoleStub = 'const console = { log: () => {}, error: () => {}, warn: () => {} };';

	const factory = new Function(
		'resolve',
		'existsSync',
		'readFileSync',
		'writeFileSync',
		'renameSync',
		'unlinkSync',
		// `runMain` reads the shared runtime contract, which it imports in
		// the real module. This factory evaluates the extracted function
		// outside that module, so the REAL contract array is injected
		// rather than a local copy that could drift from it.
		'REQUIRED_RUNTIME_SECRETS',
		`
		const REPO_ROOT = ${JSON.stringify('placeholder')};
		const INFISICAL_API_URL_DEFAULT = ${JSON.stringify('https://secrets.rebuildup.dev')};
		const DEV_VARS_FILENAME = '.dev.vars';
		const DEV_VARS_TMP_SUFFIX = '.tmp';
		${consoleStub}
		${httpsJsonStub}
		${listInfisicalSecretsStub}
		${extracted.parseArgs}
		${extracted.parseJsonc}
		${extracted.isProdEnvironment}
		${extracted.parseSecretsResponse}
		${extracted.formatDevVarsContent}
		${extracted.writeDevVarsAtomic}
		${readInfisicalWorkspaceId}
		${runMainBody}
		return { runMain };
	`,
	);
	return factory(
		resolve,
		existsSync,
		readFileSync,
		writeFileSync,
		renameSync,
		unlinkSync,
		REQUIRED_RUNTIME_SECRETS,
	);
}

describe('generate-dev-vars.mjs', () => {
	describe('parseJsonc', () => {
		it('strips // line-comments before parsing', async () => {
			const { parseJsonc } = await loadPureHelpers();
			const source = `{
				// a comment
				"a": 1
			}`;
			const parsed = parseJsonc(source);
			assert.deepEqual(parsed, { a: 1 });
		});

		it('strips /* block-comments */ before parsing', async () => {
			const { parseJsonc } = await loadPureHelpers();
			const source = `{
				/* a block comment */
				"a": 1
			}`;
			const parsed = parseJsonc(source);
			assert.deepEqual(parsed, { a: 1 });
		});

		it('preserves // inside string literals', async () => {
			const { parseJsonc } = await loadPureHelpers();
			// The regex is naive (it's a script-side helper, not a full
			// JSONC parser). What it guarantees is that THIS codebase
			// (no string-internal //) parses correctly.
			const source = `{"url": "https://example.com", "a": 1}`;
			const parsed = parseJsonc(source);
			assert.deepEqual(parsed, { url: 'https://example.com', a: 1 });
		});
	});

	describe('parseSecretsResponse', () => {
		it('parses the V3 secrets list shape', async () => {
			const { parseSecretsResponse } = await loadPureHelpers();
			const json = JSON.stringify({
				secrets: [
					{ secretKey: 'BETTER_AUTH_SECRET', secretValue: 'redacted-A' },
					{ secretKey: 'MY_WEB_2026_CONSUMER_API_KEY', secretValue: 'redacted-B' },
				],
			});
			const out = parseSecretsResponse(json);
			assert.deepEqual(out, [
				{ secretKey: 'BETTER_AUTH_SECRET', secretValue: 'redacted-A' },
				{ secretKey: 'MY_WEB_2026_CONSUMER_API_KEY', secretValue: 'redacted-B' },
			]);
		});

		it('accepts the alternate key/value field names', async () => {
			const { parseSecretsResponse } = await loadPureHelpers();
			const json = JSON.stringify({
				secrets: [
					{ key: 'A', value: 'v-a' },
					{ key: 'B', value: 'v-b' },
				],
			});
			const out = parseSecretsResponse(json);
			assert.deepEqual(out, [
				{ secretKey: 'A', secretValue: 'v-a' },
				{ secretKey: 'B', secretValue: 'v-b' },
			]);
		});

		it('skips items with missing secretKey', async () => {
			const { parseSecretsResponse } = await loadPureHelpers();
			const json = JSON.stringify({
				secrets: [
					{ secretKey: '', secretValue: 'v' },
					{ secretValue: 'v' },
					{ secretKey: 'A', secretValue: 'v' },
				],
			});
			const out = parseSecretsResponse(json);
			assert.deepEqual(out, [{ secretKey: 'A', secretValue: 'v' }]);
		});

		it('skips items with null secretValue (hidden / placeholder rows)', async () => {
			const { parseSecretsResponse } = await loadPureHelpers();
			const json = JSON.stringify({
				secrets: [
					{ secretKey: 'A', secretValue: null },
					{ secretKey: 'B', secretValue: '' },
					{ secretKey: 'C', secretValue: 'v' },
				],
			});
			const out = parseSecretsResponse(json);
			assert.deepEqual(out, [{ secretKey: 'C', secretValue: 'v' }]);
		});

		it('returns empty array when response has no secrets array', async () => {
			const { parseSecretsResponse } = await loadPureHelpers();
			const json = JSON.stringify({});
			const out = parseSecretsResponse(json);
			assert.deepEqual(out, []);
		});

		it('throws with a non-echoing prefix on non-JSON input', async () => {
			const { parseSecretsResponse } = await loadPureHelpers();
			// Empty string → V8 reports "Unexpected end of JSON input"
			// (no offending fragment echo). We only need to verify that
			// OUR wrapper adds a non-echoing, non-leaking prefix; we
			// cannot control what V8 itself chooses to include.
			let caught;
			try {
				parseSecretsResponse('');
			} catch (e) {
				caught = e;
			}
			assert.ok(caught instanceof Error);
			assert.match(caught.message, /^V3 secrets response is not valid JSON: /);
		});
	});

	describe('formatDevVarsContent', () => {
		it('emits one KEY="value" line per entry', async () => {
			const { formatDevVarsContent } = await loadPureHelpers();
			const out = formatDevVarsContent({
				BETTER_AUTH_SECRET: 'redacted-A',
				MY_WEB_2026_CONSUMER_API_KEY: 'redacted-B',
			});
			assert.equal(
				out,
				'BETTER_AUTH_SECRET="redacted-A"\nMY_WEB_2026_CONSUMER_API_KEY="redacted-B"\n',
			);
		});

		it('sorts keys alphabetically for stable diffs', async () => {
			const { formatDevVarsContent } = await loadPureHelpers();
			const out = formatDevVarsContent({
				ZZZ_LAST: 'z',
				AAA_FIRST: 'a',
				MMM_MIDDLE: 'm',
			});
			assert.equal(out, 'AAA_FIRST="a"\nMMM_MIDDLE="m"\nZZZ_LAST="z"\n');
		});

		it('escapes embedded double quotes and backslashes', async () => {
			const { formatDevVarsContent } = await loadPureHelpers();
			const out = formatDevVarsContent({
				WEIRD: 'a"b\\c',
			});
			// The output must be parseable: re-parse and recover original.
			assert.equal(out, 'WEIRD="a\\"b\\\\c"\n');
			// Round-trip: extract value between the outermost quotes.
			const inner = out.match(/WEIRD="(.*)"\n/)[1];
			// The on-disk form is `a\"b\\c`; revert the escapes.
			const recovered = inner.replace(/\\(.)/g, (_m, c) => c);
			assert.equal(recovered, 'a"b\\c');
		});

		it('emits an empty trailing-newline-only file for empty map', async () => {
			const { formatDevVarsContent } = await loadPureHelpers();
			const out = formatDevVarsContent({});
			assert.equal(out, '\n');
		});
	});

	describe('isProdEnvironment (operator-mandated prod hard-reject)', () => {
		it('matches the Infisical native slug `prod`', async () => {
			const { isProdEnvironment } = await loadPureHelpers();
			assert.equal(isProdEnvironment('prod'), true);
		});

		it('matches the alternative slug `production`', async () => {
			const { isProdEnvironment } = await loadPureHelpers();
			assert.equal(isProdEnvironment('production'), true);
		});

		it('is case-insensitive (PROD, Production, ProD all match)', async () => {
			const { isProdEnvironment } = await loadPureHelpers();
			assert.equal(isProdEnvironment('PROD'), true);
			assert.equal(isProdEnvironment('Production'), true);
			assert.equal(isProdEnvironment('ProD'), true);
		});

		it('trims surrounding whitespace', async () => {
			const { isProdEnvironment } = await loadPureHelpers();
			assert.equal(isProdEnvironment('  prod  '), true);
			assert.equal(isProdEnvironment('\tproduction\n'), true);
		});

		it('does NOT match `dev` or `development`', async () => {
			const { isProdEnvironment } = await loadPureHelpers();
			assert.equal(isProdEnvironment('dev'), false);
			assert.equal(isProdEnvironment('DEV'), false);
			assert.equal(isProdEnvironment('development'), false);
			assert.equal(isProdEnvironment('staging'), false);
		});

		it('does NOT match empty string or non-string inputs', async () => {
			const { isProdEnvironment } = await loadPureHelpers();
			assert.equal(isProdEnvironment(''), false);
			assert.equal(isProdEnvironment(' '), false);
			assert.equal(isProdEnvironment(undefined), false);
			assert.equal(isProdEnvironment(null), false);
			assert.equal(isProdEnvironment(42), false);
			assert.equal(isProdEnvironment({}), false);
		});

		it('does NOT match strings that merely contain `prod` as a substring', async () => {
			const { isProdEnvironment } = await loadPureHelpers();
			// We match the slug, not the substring. A user typed
			// `prod-old` is NOT a Phase 3 prod slug. They must pass
			// `prod` exactly (modulo case + whitespace).
			assert.equal(isProdEnvironment('prod-old'), false);
			assert.equal(isProdEnvironment('my-prod-account'), false);
			assert.equal(isProdEnvironment('prodigy'), false);
		});
	});

	describe('secret-handling invariant', () => {
		// The full script must NEVER echo a secret value to argv / log /
		// error. These tests cover the pure helpers that produce
		// user-visible strings: parseSecretsResponse (error path only)
		// and formatDevVarsContent (success path writes to disk by
		// design — disk is the secret's home, not a log surface).

		it('parser error does not include the secret value', async () => {
			const { parseSecretsResponse } = await loadPureHelpers();
			const poisoned = 'a-secretly-leaked-value-not-real';
			let caught;
			try {
				parseSecretsResponse(`{"secrets": [{"key": "${poisoned}"`); // broken JSON
			} catch (e) {
				caught = e;
			}
			assert.ok(caught instanceof Error);
			assert.doesNotMatch(caught.message, new RegExp(poisoned));
		});

		it('formatDevVarsContent: output lines are KEY="..." only (no extra log content)', async () => {
			const { formatDevVarsContent } = await loadPureHelpers();
			const out = formatDevVarsContent({
				BETTER_AUTH_SECRET: 'sk-test-value-must-not-appear-elsewhere',
			});
			const lines = out.split('\n').filter(Boolean);
			assert.equal(lines.length, 1);
			// The key appears exactly once (in the key position), the
			// value appears exactly once (in the quoted value position).
			// No stray log lines, no header, no footer.
			assert.match(lines[0], /^BETTER_AUTH_SECRET="/);
			assert.ok(lines[0].endsWith('"'));
			assert.equal(out.indexOf('BETTER_AUTH_SECRET'), out.lastIndexOf('BETTER_AUTH_SECRET'));
		});

		it('round-trip: formatDevVarsContent output matches a 3-name `.dev.vars` contract', async () => {
			const { formatDevVarsContent } = await loadPureHelpers();
			const out = formatDevVarsContent({
				BETTER_AUTH_SECRET: 'redacted-A',
				BETTER_AUTH_SECRETS: 'redacted-B',
				MY_WEB_2026_CONSUMER_API_KEY: 'redacted-C',
			});
			// Strip quotes and backslash escapes to recover the canonical
			// `.dev.vars` map (matches what `dotenv` parsers would load).
			const recovered = Object.fromEntries(
				out
					.trim()
					.split('\n')
					.map((line) => {
						const m = line.match(/^([A-Z0-9_]+)="(.*)"$/);
						const value = m[2].replace(/\\(.)/g, (_mm, c) => c);
						return [m[1], value];
					}),
			);
			assert.deepEqual(recovered, {
				BETTER_AUTH_SECRET: 'redacted-A',
				BETTER_AUTH_SECRETS: 'redacted-B',
				MY_WEB_2026_CONSUMER_API_KEY: 'redacted-C',
			});
		});

		it('end-to-end parse → filter → format on a synthetic V3 response', async () => {
			const { parseSecretsResponse, formatDevVarsContent } = await loadPureHelpers();
			const required = ['BETTER_AUTH_SECRET', 'MY_WEB_2026_CONSUMER_API_KEY'];

			const responseJson = JSON.stringify({
				secrets: [
					{ secretKey: 'BETTER_AUTH_SECRET', secretValue: 'val-A' },
					// This key is present in Infisical but NOT in
					// secrets.required — must be filtered out.
					{ secretKey: 'UNRELATED_KEY', secretValue: 'val-unrelated' },
					{ secretKey: 'MY_WEB_2026_CONSUMER_API_KEY', secretValue: 'val-C' },
				],
			});

			const all = parseSecretsResponse(responseJson);
			const requiredSet = new Set(required);
			const filtered = all.filter((s) => requiredSet.has(s.secretKey));

			const map = Object.fromEntries(filtered.map((s) => [s.secretKey, s.secretValue]));
			const out = formatDevVarsContent(map);

			// Only the two required keys survive — UNRELATED_KEY is
			// silently filtered out (no operator-visible error; Infisical
			// stores many keys, the script only materialises the ones the
			// Worker actually requires).
			assert.equal(out, 'BETTER_AUTH_SECRET="val-A"\nMY_WEB_2026_CONSUMER_API_KEY="val-C"\n');
		});
	});

	describe('writeDevVarsAtomic (CodeRabbit reviews 3 + 4 — security invariants)', () => {
		// Use a fresh scratch dir per test so leftover .tmp from a
		// previous test cannot pollute the next.
		let scratch;
		before(() => {
			scratch = mkdtempSync(resolve(tmpdir(), 'gen-dev-vars-atomic-'));
		});
		after(() => {
			try {
				rmSync(scratch, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
		});

		it('writes content atomically with mode 0o600 on success', async () => {
			const { writeDevVarsAtomic } = await loadPureHelpers();
			const target = resolve(scratch, 'a-success.dev.vars');
			const tmp = `${target}.tmp`;
			writeDevVarsAtomic({ targetPath: target, content: 'K="v"\n' });
			assert.equal(existsSync(target), true);
			assert.equal(existsSync(tmp), false); // renamed away
			assert.equal(readFileSync(target, 'utf8'), 'K="v"\n');
			// Mode 0o600 (mask out file-type bits): the on-disk file
			// is created with restrictive mode; we only assert the
			// permission bits (0o777) to be 0o600.
			const st = statSync(target);
			assert.equal(st.mode & 0o777, 0o600);
		});

		it('EEXIST on pre-existing tmp does NOT truncate or unlink it', async () => {
			const { writeDevVarsAtomic } = await loadPureHelpers();
			const target = resolve(scratch, 'b-eexist.dev.vars');
			const tmp = `${target}.tmp`;
			// Pre-place a sentinel tmp file at mode 0o644. The
			// operator-mandated invariant is that the exclusive create
			// must NOT touch this file in any way.
			const sentinel = 'SENTINEL-OLD-CONTENT';
			writeFileSync(tmp, sentinel, { mode: 0o644 });
			const beforeStat = statSync(tmp);
			const beforeContent = readFileSync(tmp, 'utf8');
			const beforeMtime = beforeStat.mtimeMs;

			await assert.rejects(
				async () => writeDevVarsAtomic({ targetPath: target, content: 'NEW="x"\n' }),
				(err) => err.code === 'EEXIST',
				'should throw EEXIST (pre-existing tmp)',
			);

			// Sentinel must still exist with original content + mode.
			assert.equal(existsSync(tmp), true, 'pre-existing tmp must NOT be unlinked');
			assert.equal(readFileSync(tmp, 'utf8'), beforeContent, 'tmp content must be unchanged');
			const afterStat = statSync(tmp);
			assert.equal(afterStat.mode & 0o777, beforeStat.mode & 0o777, 'tmp mode must be unchanged');
			assert.equal(afterStat.mtimeMs, beforeMtime, 'tmp mtime must be unchanged');
			// The target file must not exist (write never succeeded).
			assert.equal(existsSync(target), false, 'target file must NOT be created');
		});

		it('cleanup unlinks tmp ONLY when this process created it (rename-fail)', async () => {
			const { writeDevVarsAtomic } = await loadPureHelpers();
			const target = resolve(scratch, 'c-rename-fail.dev.vars');
			const tmp = `${target}.tmp`;

			// Inject a rename stub that always throws. The real
			// writeFile creates the tmp; the rename stub fails; the
			// helper must then unlink only the tmp it created.
			const renameStub = () => {
				throw Object.assign(new Error('rename-fail injected'), { code: 'EACCES' });
			};

			await assert.rejects(
				async () =>
					writeDevVarsAtomic({
						targetPath: target,
						content: 'K="v"\n',
						rename: renameStub,
					}),
				(err) => err.message === 'rename-fail injected',
				'should rethrow the rename error verbatim',
			);

			// The tmp created by this process should have been
			// unlinked in the cleanup branch (tmpCreated === true).
			assert.equal(existsSync(tmp), false, 'own tmp must be unlinked after rename failure');
			assert.equal(existsSync(target), false, 'target must NOT exist after rename failure');
		});

		it('cleanup failure (unlink throws) does NOT mask the original rename error', async () => {
			const { writeDevVarsAtomic } = await loadPureHelpers();
			const target = resolve(scratch, 'd-cleanup-throw.dev.vars');
			const tmp = `${target}.tmp`;

			const renameStub = () => {
				throw Object.assign(new Error('rename-fail-injected'), { code: 'EACCES' });
			};
			const unlinkStub = () => {
				throw new Error('unlink-fail-injected');
			};

			let caught;
			try {
				writeDevVarsAtomic({
					targetPath: target,
					content: 'K="v"\n',
					rename: renameStub,
					unlink: unlinkStub,
				});
			} catch (e) {
				caught = e;
			}
			assert.ok(caught, 'should have thrown');
			// The original rename error must be preserved; the
			// unlink stub's error is swallowed by design.
			assert.equal(caught.message, 'rename-fail-injected');
			assert.equal(caught.code, 'EACCES');
		});

		it('EEXIST with a foreign tmp does NOT invoke unlink (ownership flag)', async () => {
			// The strict reading of the invariant: on EEXIST,
			// `tmpCreated` stays false, so even if `unlink` is the
			// real fs.unlinkSync, it MUST NOT be called.
			const { writeDevVarsAtomic } = await loadPureHelpers();
			const target = resolve(scratch, 'e-foreign-tmp.dev.vars');
			const tmp = `${target}.tmp`;
			writeFileSync(tmp, 'foreign-tmp', { mode: 0o600 });
			let unlinkCalled = false;
			const unlinkSpy = (p) => {
				unlinkCalled = true;
				return realUnlink(p);
			};
			const realUnlink = unlinkSync;

			await assert.rejects(async () =>
				writeDevVarsAtomic({
					targetPath: target,
					content: 'K="v"\n',
					unlink: unlinkSpy,
				}),
			);

			assert.equal(unlinkCalled, false, 'unlink must NOT be called on EEXIST');
			assert.equal(existsSync(tmp), true, 'foreign tmp must remain');
		});
	});

	describe('runMain prod hard-reject (execution-path regression, CodeRabbit nitpick)', () => {
		// Two scratch roots: one for explicit `--env=prod`, one for
		// `.infisical.json#defaultEnvironment = "prod"`. Both must
		// short-circuit BEFORE any HTTP or file write, leaving the
		// existing `.dev.vars` (sentinel) unchanged and producing no
		// `.dev.vars.tmp`.
		let scratchCaseA;
		let scratchCaseB;

		before(() => {
			scratchCaseA = mkdtempSync(resolve(tmpdir(), 'gen-dev-vars-prodA-'));
			scratchCaseB = mkdtempSync(resolve(tmpdir(), 'gen-dev-vars-prodB-'));

			// Common scaffold: .infisical.json + wrangler.jsonc with
			// the legacy 2-name `secrets.required`. Default env is
			// `dev` unless overridden below.
			const writeScaffold = (root, defaultEnv) => {
				writeFileSync(
					resolve(root, '.infisical.json'),
					JSON.stringify({ workspaceId: 'test-ws-id', defaultEnvironment: defaultEnv }),
					{ mode: 0o600 },
				);
				writeFileSync(
					resolve(root, 'wrangler.jsonc'),
					`{
  // comments are fine
  "name": "test-worker",
  "secrets": { "required": ["BETTER_AUTH_SECRET", "MY_WEB_2026_CONSUMER_API_KEY"] }
}
`,
				);
			};
			writeScaffold(scratchCaseA, 'dev');
			writeScaffold(scratchCaseB, 'prod'); // Case B: prod is the default

			// Pre-existing `.dev.vars` sentinel at each scratch root;
			// the prod-reject must NOT touch it.
			const sentinelContent = 'SENTINEL_EXISTING_DEV_VARS=1\n';
			writeFileSync(resolve(scratchCaseA, '.dev.vars'), sentinelContent, { mode: 0o600 });
			writeFileSync(resolve(scratchCaseB, '.dev.vars'), sentinelContent, { mode: 0o600 });
		});

		after(() => {
			try {
				rmSync(scratchCaseA, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
			try {
				rmSync(scratchCaseB, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
		});

		it('Case A: explicit --env=prod short-circuits before any HTTP or file write', async () => {
			const { runMain } = await loadRunMain();
			const sentinelPath = resolve(scratchCaseA, '.dev.vars');
			const sentinelStat = statSync(sentinelPath);

			await assert.rejects(
				async () =>
					runMain({
						repoRoot: scratchCaseA,
						argv: ['--env=prod', '--dry-run'],
						env: { INFISICAL_TOKEN: 'fake-token-for-test' },
					}),
				/refuses environment="prod"/,
				'should throw the prod-rejection error',
			);

			// Sentinel .dev.vars must be unchanged.
			assert.equal(existsSync(sentinelPath), true);
			const afterStat = statSync(sentinelPath);
			assert.equal(afterStat.mtimeMs, sentinelStat.mtimeMs, '.dev.vars mtime must not change');
			assert.equal(readFileSync(sentinelPath, 'utf8'), 'SENTINEL_EXISTING_DEV_VARS=1\n');

			// No `.dev.vars.tmp` was created (write path never reached).
			assert.equal(existsSync(resolve(scratchCaseA, '.dev.vars.tmp')), false);
		});

		it('Case B: .infisical.json#defaultEnvironment = "prod" triggers the same rejection', async () => {
			const { runMain } = await loadRunMain();
			const sentinelPath = resolve(scratchCaseB, '.dev.vars');
			const sentinelStat = statSync(sentinelPath);

			await assert.rejects(
				async () =>
					runMain({
						repoRoot: scratchCaseB,
						argv: ['--dry-run'], // no explicit --env; falls back to defaultEnvironment
						env: { INFISICAL_TOKEN: 'fake-token-for-test' },
					}),
				/refuses environment="prod"/,
				'should throw the prod-rejection error from defaultEnvironment',
			);

			assert.equal(existsSync(sentinelPath), true);
			const afterStat = statSync(sentinelPath);
			assert.equal(afterStat.mtimeMs, sentinelStat.mtimeMs, '.dev.vars mtime must not change');
			assert.equal(readFileSync(sentinelPath, 'utf8'), 'SENTINEL_EXISTING_DEV_VARS=1\n');
			assert.equal(existsSync(resolve(scratchCaseB, '.dev.vars.tmp')), false);
		});
	});
});
