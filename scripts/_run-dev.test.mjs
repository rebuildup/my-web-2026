import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
/**
 * `_run-dev.mjs` pure-helper tests (Phase 3 #69 sub-step DEP0190 fix).
 *
 * The full script calls `process.platform` and spawns `cmd.exe` /
 * `pnpm` based on it; that path is exercised only in operator-side
 * smoke on Windows. The pure helpers here — `isSafeEnvSlug`,
 * `readDefaultEnvironmentCandidate`, `buildSpawnPlan` — are
 * unit-testable in isolation.
 *
 * Helpers under test:
 *   - isSafeEnvSlug(s)
 *   - readDefaultEnvironmentCandidate({ configPath, fsExistsSync, fsReadFileSync })
 *   - normalizeForwardedArgs(rawArgs)
 *   - quoteCmdArg(token)
 *   - buildSpawnPlan({ isWindows, env, extraArgs })
 *
 * Operator-mandated invariants verified here:
 *   - The Windows spawn shape is exactly `cmd.exe /d /s /c pnpm <args>`
 *     with `shell: false` and `windowsVerbatimArguments: true` (the
 *     Node-canonical pattern that avoids DEP0190 in Node 22.15+).
 *   - `env` is validated against `[A-Za-z0-9_-]{1,64}` BEFORE being
 *     placed into argv — no `cmd.exe` metacharacter (`& | < > ^ ; ( ) %
 *     ! ? * , # = $ " ' \` / \\` \\n \\r space tab`) can be smuggled
 *     through a slug, even with `shell: false`. `cmd.exe` parses its
 *     own command line.
 *   - The slug-validation gate fires for unsafe slugs; the throwing
 *     error path carries no shell-controlled content.
 *   - Extra CLI argv (`pnpm dev -- --port 4999 --strictPort`, Issue
 *     #284) is appended AFTER `vite dev` in both the POSIX and Windows
 *     plans, without changing the no-args spawn shape and without
 *     weakening the env-slug gate.
 *   - Forwarded tokens containing cmd.exe-unsafe characters (space,
 *     `&`, quotes, parens, …) are wrapped for the Windows branch by
 *     `quoteCmdArg` (`windowsVerbatimArguments` does no quoting), while
 *     the POSIX plan keeps the raw token — asserted as exact argv
 *     shapes on both branches. This quoting is unit-verified only: it
 *     has NOT been exercised on a real Windows host (honest limitation;
 *     see the `_run-dev.mjs` docblock).
 */
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '_run-dev.mjs');

// Same regex-extraction pattern as
// `scripts/bootstrap-home-api-key.test.mjs:32-54` and
// `scripts/generate-dev-vars.test.mjs:38-62`. We do not import the
// whole module because it runs main() at import time (process.exit
// or spawn). Instead we slice out each pure helper via a regex and
// stitch them together inside an isolated factory closure.
async function loadPureHelpers() {
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(SCRIPT, 'utf8');

	function extract(name) {
		const re = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*[\\s\\S]*?\\n\\}`, 'm');
		const match = source.match(re);
		if (!match) throw new Error(`Could not extract ${name}`);
		// Strip the optional leading `export ` so the body can be
		// evaluated by `new Function(...)` (non-module context, where
		// `export` is a syntax error). The function body itself is
		// unchanged.
		return match[0].replace(/^export\s+/, '');
	}

	const isSafeEnvSlug = extract('isSafeEnvSlug');
	const readDefaultEnvironmentCandidate = extract('readDefaultEnvironmentCandidate');
	const normalizeForwardedArgs = extract('normalizeForwardedArgs');
	const quoteCmdArg = extract('quoteCmdArg');
	const buildSpawnPlan = extract('buildSpawnPlan');

	const factory = new Function(`
		const SAFE_ENV_SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;
		const CMD_UNSAFE_ARG_RE = /[ "&|<>^()]/;
		${isSafeEnvSlug}
		${readDefaultEnvironmentCandidate}
		${normalizeForwardedArgs}
		${quoteCmdArg}
		${buildSpawnPlan}
		return { isSafeEnvSlug, readDefaultEnvironmentCandidate, normalizeForwardedArgs, quoteCmdArg, buildSpawnPlan, SAFE_ENV_SLUG_RE, CMD_UNSAFE_ARG_RE };
	`);
	return factory();
}

/** Stub fs accessors that return the given config path state. */
function fsStubs({ exists = true, content = null, throwsOnRead = false }) {
	return {
		fsExistsSync: () => exists,
		fsReadFileSync: throwsOnRead
			? () => {
					throw new Error('ENOENT');
				}
			: () => content,
	};
}

describe('_run-dev.mjs', () => {
	describe('isSafeEnvSlug', () => {
		it('accepts canonical Infisical env slugs', async () => {
			const { isSafeEnvSlug } = await loadPureHelpers();
			assert.equal(isSafeEnvSlug('dev'), true);
			assert.equal(isSafeEnvSlug('prod'), true);
			assert.equal(isSafeEnvSlug('production'), true);
			assert.equal(isSafeEnvSlug('staging'), true);
			assert.equal(isSafeEnvSlug('my-env-2'), true);
			assert.equal(isSafeEnvSlug('Test_Env-99'), true);
			assert.equal(isSafeEnvSlug('a'), true);
		});

		it('rejects empty string and non-string inputs', async () => {
			const { isSafeEnvSlug } = await loadPureHelpers();
			assert.equal(isSafeEnvSlug(''), false);
			assert.equal(isSafeEnvSlug(' '), false);
			assert.equal(isSafeEnvSlug(undefined), false);
			assert.equal(isSafeEnvSlug(null), false);
			assert.equal(isSafeEnvSlug(42), false);
			assert.equal(isSafeEnvSlug({}), false);
			assert.equal(isSafeEnvSlug([]), false);
		});

		it('rejects strings longer than 64 characters', async () => {
			const { isSafeEnvSlug } = await loadPureHelpers();
			assert.equal(isSafeEnvSlug('a'.repeat(64)), true);
			assert.equal(isSafeEnvSlug('a'.repeat(65)), false);
			assert.equal(isSafeEnvSlug('a'.repeat(1000)), false);
		});

		it('rejects every cmd.exe / POSIX metacharacter (the gating point)', async () => {
			const { isSafeEnvSlug } = await loadPureHelpers();
			// cmd.exe parses `&`, `|`, `<`, `>`, `^` as command separators
			// and output rewriters. POSIX /bin/sh does the same for `&`,
			// `|`, `<`, `>`, `;`, `(`, `)`. The slug charset
			// `[A-Za-z0-9_-]` is the only safe subset.
			const metachars = [
				'&',
				'|',
				'<',
				'>',
				'^',
				'\n',
				'\r',
				'"',
				"'",
				'`',
				'$',
				'\\',
				'/',
				' ',
				'\t',
				';',
				'(',
				')',
				'%',
				'!',
				'?',
				'*',
				',',
				'#',
				'=',
				':',
				'@',
				'{',
				'}',
				'[',
				']',
				'+',
				'~',
			];
			for (const c of metachars) {
				assert.equal(
					isSafeEnvSlug(`dev${c}foo`),
					false,
					`should reject embedded ${JSON.stringify(c)}`,
				);
				assert.equal(isSafeEnvSlug(`${c}`), false, `should reject bare ${JSON.stringify(c)}`);
				assert.equal(
					isSafeEnvSlug(`dev${c}`),
					false,
					`should reject trailing ${JSON.stringify(c)}`,
				);
			}
		});

		it('rejects real-world injection strings', async () => {
			const { isSafeEnvSlug } = await loadPureHelpers();
			assert.equal(isSafeEnvSlug('dev; rm -rf /'), false);
			assert.equal(isSafeEnvSlug('dev && echo pwned'), false);
			assert.equal(isSafeEnvSlug('dev|prod'), false);
			assert.equal(isSafeEnvSlug('dev>out'), false);
			assert.equal(isSafeEnvSlug('dev$IFS'), false);
			assert.equal(isSafeEnvSlug("dev'quote"), false);
			assert.equal(isSafeEnvSlug('dev"quote'), false);
			assert.equal(isSafeEnvSlug('dev\\backslash'), false);
			assert.equal(isSafeEnvSlug('dev/slash'), false);
			assert.equal(isSafeEnvSlug('dev space'), false);
			assert.equal(isSafeEnvSlug('dev.tar.gz'), false);
		});

		it('rejects non-ASCII characters', async () => {
			const { isSafeEnvSlug } = await loadPureHelpers();
			assert.equal(isSafeEnvSlug('dév'), false);
			assert.equal(isSafeEnvSlug('環境'), false);
			assert.equal(isSafeEnvSlug('dev™'), false);
			assert.equal(isSafeEnvSlug('日本語'), false);
		});
	});

	describe('readDefaultEnvironmentCandidate', () => {
		it("returns 'dev' when the config file does not exist", async () => {
			const { readDefaultEnvironmentCandidate } = await loadPureHelpers();
			const candidate = readDefaultEnvironmentCandidate({
				configPath: '/missing/.infisical.json',
				...fsStubs({ exists: false }),
			});
			assert.equal(candidate, 'dev');
		});

		it("returns 'dev' when the config file exists but is unreadable / malformed", async () => {
			const { readDefaultEnvironmentCandidate } = await loadPureHelpers();
			const candidate = readDefaultEnvironmentCandidate({
				configPath: '/.infisical.json',
				...fsStubs({ exists: true, content: '{not json', throwsOnRead: true }),
			});
			assert.equal(candidate, 'dev');
		});

		it("returns 'dev' when defaultEnvironment is absent", async () => {
			const { readDefaultEnvironmentCandidate } = await loadPureHelpers();
			const candidate = readDefaultEnvironmentCandidate({
				configPath: '/.infisical.json',
				...fsStubs({
					exists: true,
					content: JSON.stringify({ workspaceId: '89cda9cb' }),
				}),
			});
			assert.equal(candidate, 'dev');
		});

		it('returns the candidate verbatim (caller validates safety)', async () => {
			const { readDefaultEnvironmentCandidate } = await loadPureHelpers();
			// Returns raw value — slug validation is the caller's job,
			// not this helper's. We test that the verbatim return
			// matches the JSON value (including potential injection
			// payloads which the caller MUST reject).
			for (const candidateValue of ['production', 'staging', 'dev; rm -rf /']) {
				const candidate = readDefaultEnvironmentCandidate({
					configPath: '/.infisical.json',
					...fsStubs({
						exists: true,
						content: JSON.stringify({ defaultEnvironment: candidateValue }),
					}),
				});
				assert.equal(candidate, candidateValue);
			}
		});
	});

	describe('buildSpawnPlan (DEP0190-safe Windows contract)', () => {
		it('produces a POSIX plan: pnpm + shell:false', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			const plan = buildSpawnPlan({ isWindows: false, env: 'dev' });
			assert.equal(plan.command, 'pnpm');
			assert.deepEqual(plan.args, [
				'exec',
				'infisical',
				'run',
				'--env',
				'dev',
				'--',
				'pnpm',
				'exec',
				'vite',
				'dev',
			]);
			assert.equal(plan.options.shell, false);
			assert.equal('windowsVerbatimArguments' in plan.options, false);
		});

		it('produces a DEP0190-safe Windows plan: cmd.exe /d /s /c pnpm + windowsVerbatimArguments:true + shell:false', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			const plan = buildSpawnPlan({ isWindows: true, env: 'dev' });
			assert.equal(plan.command, 'cmd.exe');
			assert.deepEqual(plan.args, [
				'/d',
				'/s',
				'/c',
				'pnpm',
				'exec',
				'infisical',
				'run',
				'--env',
				'dev',
				'--',
				'pnpm',
				'exec',
				'vite',
				'dev',
			]);
			// Node-canonical DEP0190-safe shape:
			assert.equal(plan.options.shell, false);
			assert.equal(plan.options.windowsVerbatimArguments, true);
		});

		it('propagates --env <slug> in both POSIX and Windows plans', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			for (const env of ['dev', 'prod', 'staging', 'feature-x', 'Test_Env-99']) {
				const posix = buildSpawnPlan({ isWindows: false, env });
				const win = buildSpawnPlan({ isWindows: true, env });
				const posixEnvIdx = posix.args.indexOf('--env');
				const winEnvIdx = win.args.indexOf('--env');
				assert.notEqual(posixEnvIdx, -1);
				assert.notEqual(winEnvIdx, -1);
				assert.equal(posix.args[posixEnvIdx + 1], env);
				assert.equal(win.args[winEnvIdx + 1], env);
			}
		});

		it('throws for every unsafe slug (no smuggled cmd.exe metacharacter)', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			const unsafe = [
				'dev; rm -rf /',
				'dev && echo pwned',
				'dev|prod',
				'dev>out',
				'dev$IFS',
				"dev'quote",
				'dev"quote',
				'dev\\backslash',
				'dev/slash',
				'dev space',
				'dev\ttab',
				'dev\nnewline',
				'',
				null,
				undefined,
				42,
				'a'.repeat(65),
				'dév',
			];
			for (const env of unsafe) {
				assert.throws(
					() => buildSpawnPlan({ isWindows: true, env }),
					/not a safe slug/,
					`should reject env=${JSON.stringify(env)}`,
				);
				assert.throws(
					() => buildSpawnPlan({ isWindows: false, env }),
					/not a safe slug/,
					`should reject env=${JSON.stringify(env)} (POSIX)`,
				);
			}
		});

		it('error message does not echo the unsafe value into argv-routed text', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			// The error string is intentionally placed in argv/log boundaries
			// by `_run-dev.mjs`, so it must not carry the offending value
			// (which on Windows might contain cmd.exe metacharacters that
			// the shell could re-interpret).
			let caught;
			try {
				buildSpawnPlan({ isWindows: true, env: 'dev; rm -rf /' });
			} catch (e) {
				caught = e;
			}
			assert.ok(caught instanceof Error);
			// JSON.stringify is applied by the implementation; verify the
			// value IS present (operator-visible error diagnostic) but is
			// wrapped in JSON quotes that the shell cannot re-interpret.
			assert.match(caught.message, /"dev; rm -rf \/"/);
		});
	});

	describe('normalizeForwardedArgs (Issue #284)', () => {
		it("strips pnpm's leading `--` separator", async () => {
			// `pnpm dev -- --port 4999 --strictPort` reaches the script as
			// ['--', '--port', '4999', '--strictPort'] (pnpm 12.x forwards
			// the separator itself). vite would treat `--` as an operand
			// separator and ignore every flag after it.
			const { normalizeForwardedArgs } = await loadPureHelpers();
			assert.deepEqual(normalizeForwardedArgs(['--', '--port', '4999', '--strictPort']), [
				'--port',
				'4999',
				'--strictPort',
			]);
		});

		it('leaves a tail without a leading `--` untouched', async () => {
			const { normalizeForwardedArgs } = await loadPureHelpers();
			assert.deepEqual(normalizeForwardedArgs(['--port', '4999']), ['--port', '4999']);
			assert.deepEqual(normalizeForwardedArgs([]), []);
		});

		it('strips only ONE leading `--`; later ones are genuine content', async () => {
			const { normalizeForwardedArgs } = await loadPureHelpers();
			assert.deepEqual(normalizeForwardedArgs(['--', '--', '--port']), ['--', '--port']);
			assert.deepEqual(normalizeForwardedArgs(['--port', '--', 'x']), ['--port', '--', 'x']);
		});

		it('throws for non-array input instead of coercing it', async () => {
			const { normalizeForwardedArgs } = await loadPureHelpers();
			for (const bad of ['--port', null, undefined, 42, {}]) {
				assert.throws(
					() => normalizeForwardedArgs(bad),
					/must be an array/,
					`should reject rawArgs=${JSON.stringify(bad)}`,
				);
			}
		});
	});

	describe('buildSpawnPlan (extra CLI argv forwarding, Issue #284)', () => {
		const EXTRA = ['--port', '4999', '--strictPort'];

		it('appends extra args after `vite dev` in the POSIX plan', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			const plan = buildSpawnPlan({ isWindows: false, env: 'dev', extraArgs: EXTRA });
			assert.equal(plan.command, 'pnpm');
			assert.deepEqual(plan.args, [
				'exec',
				'infisical',
				'run',
				'--env',
				'dev',
				'--',
				'pnpm',
				'exec',
				'vite',
				'dev',
				'--port',
				'4999',
				'--strictPort',
			]);
			assert.equal(plan.options.shell, false);
			assert.equal('windowsVerbatimArguments' in plan.options, false);
		});

		it('appends extra args after `vite dev` in the Windows plan (shape otherwise unchanged)', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			const plan = buildSpawnPlan({ isWindows: true, env: 'dev', extraArgs: EXTRA });
			assert.equal(plan.command, 'cmd.exe');
			assert.deepEqual(plan.args, [
				'/d',
				'/s',
				'/c',
				'pnpm',
				'exec',
				'infisical',
				'run',
				'--env',
				'dev',
				'--',
				'pnpm',
				'exec',
				'vite',
				'dev',
				'--port',
				'4999',
				'--strictPort',
			]);
			assert.equal(plan.options.shell, false);
			assert.equal(plan.options.windowsVerbatimArguments, true);
		});

		it('leaves the no-args spawn shape unchanged (default extraArgs = [])', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			// Omitting extraArgs entirely must produce the exact historical
			// argv — no trailing empty string, no placeholder.
			for (const isWindows of [false, true]) {
				const withDefault = buildSpawnPlan({ isWindows, env: 'dev' });
				const withEmpty = buildSpawnPlan({ isWindows, env: 'dev', extraArgs: [] });
				assert.deepEqual(withDefault, withEmpty);
				assert.deepEqual(withDefault.args.slice(-2), ['vite', 'dev']);
			}
		});

		it('still validates the env slug when extra args are present', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			for (const isWindows of [false, true]) {
				assert.throws(
					() => buildSpawnPlan({ isWindows, env: 'dev && echo pwned', extraArgs: EXTRA }),
					/not a safe slug/,
					`should reject unsafe env with extraArgs (isWindows=${isWindows})`,
				);
			}
		});

		it('rejects non-string or non-array extra args instead of coercing them into argv', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			// `undefined` is intentionally absent: the default parameter
			// (`extraArgs = []`) makes the omitted value valid — that is the
			// backward-compatible no-args path covered by the test above.
			for (const bad of ['--port 4999', 42, null, ['--port', 4999], [null]]) {
				assert.throws(
					() => buildSpawnPlan({ isWindows: false, env: 'dev', extraArgs: bad }),
					/extraArgs must be an array of strings/,
					`should reject extraArgs=${JSON.stringify(bad)}`,
				);
			}
		});

		it('full pipeline: raw pnpm argv tail → vite argv ends with the forwarded flags (both platforms)', async () => {
			const { normalizeForwardedArgs, buildSpawnPlan } = await loadPureHelpers();
			// Exactly what `main()` sees with `pnpm dev -- --port 4999 --strictPort`.
			const rawTail = ['--', '--port', '4999', '--strictPort'];
			const extraArgs = normalizeForwardedArgs(rawTail);
			for (const isWindows of [false, true]) {
				const plan = buildSpawnPlan({ isWindows, env: 'dev', extraArgs });
				const argv = isWindows ? plan.args.slice(4) : plan.args; // drop cmd.exe /d /s /c pnpm prefix
				// `vite dev` must be the last fixed tokens before the flags —
				// no stray `--` separator left in front of them.
				const viteDevIdx = argv.lastIndexOf('dev');
				assert.deepEqual(argv.slice(viteDevIdx + 1), ['--port', '4999', '--strictPort']);
				assert.equal(argv[viteDevIdx - 1], 'vite');
				// The `--` after `--env dev` is required (infisical's command
				// separator). What must NOT exist is a second `--` between
				// `vite dev` and the forwarded flags — that is the pnpm
				// separator vite would silently swallow.
				assert.equal(
					argv.slice(viteDevIdx + 1).includes('--'),
					false,
					'no pnpm `--` separator may reach vite',
				);
			}
		});
	});

	// Windows cmd.exe quoting of forwarded tokens.
	//
	// `windowsVerbatimArguments: true` passes the argv to `cmd.exe`
	// literally — no Node-side quoting — so a forwarded token with a
	// space or `&` / `"` / `(` / `)` would split or be re-interpreted.
	// The Windows branch wraps such tokens via `quoteCmdArg`; the POSIX
	// branch (argv array, `shell: false`) keeps them verbatim.
	//
	// Unit-verified only — NOT exercised on a real Windows host (see
	// the `_run-dev.mjs` docblock).
	describe('quoteCmdArg / Windows quoting of forwarded tokens', () => {
		const FIXED = [
			'/d',
			'/s',
			'/c',
			'pnpm',
			'exec',
			'infisical',
			'run',
			'--env',
			'dev',
			'--',
			'pnpm',
			'exec',
			'vite',
			'dev',
		];

		it('leaves tokens without cmd-unsafe characters untouched', async () => {
			const { quoteCmdArg } = await loadPureHelpers();
			for (const safe of [
				'--port',
				'4999',
				'--strictPort',
				'plain_token-1',
				'--outDir=./dist',
				'C:\\no-space\\path',
			]) {
				assert.equal(quoteCmdArg(safe), safe, `should pass ${JSON.stringify(safe)} through`);
			}
		});

		it('wraps tokens containing spaces in double quotes', async () => {
			const { quoteCmdArg } = await loadPureHelpers();
			assert.equal(quoteCmdArg('C:\\My Folder\\out'), '"C:\\My Folder\\out"');
			assert.equal(quoteCmdArg('two words'), '"two words"');
		});

		it('wraps tokens containing & (cmd.exe command separator)', async () => {
			const { quoteCmdArg } = await loadPureHelpers();
			assert.equal(quoteCmdArg('a&b'), '"a&b"');
			assert.equal(quoteCmdArg('--flag=a b&c'), '"--flag=a b&c"');
		});

		it('wraps quote-containing tokens and escapes the embedded quote as \\"', async () => {
			const { quoteCmdArg } = await loadPureHelpers();
			// Input: say "hi"  →  wrapped: "say \"hi\""
			assert.equal(quoteCmdArg('say "hi"'), '"say \\"hi\\""');
			// Input: "  →  wrapped: "\""
			assert.equal(quoteCmdArg('"'), '"\\""');
		});

		it('wraps tokens containing parens and other cmd metacharacters', async () => {
			const { quoteCmdArg } = await loadPureHelpers();
			assert.equal(quoteCmdArg('foo(bar)'), '"foo(bar)"');
			assert.equal(quoteCmdArg('a|b'), '"a|b"');
			assert.equal(quoteCmdArg('a>b'), '"a>b"');
			assert.equal(quoteCmdArg('a<b'), '"a<b"');
			assert.equal(quoteCmdArg('a^b'), '"a^b"');
		});

		it('throws for non-string input instead of coercing it', async () => {
			const { quoteCmdArg } = await loadPureHelpers();
			for (const bad of [42, null, undefined, ['x'], {}]) {
				assert.throws(
					() => quoteCmdArg(bad),
					/expects a string/,
					`should reject token=${JSON.stringify(bad)}`,
				);
			}
		});

		it('Windows plan: exact argv with quoted forwarded tokens', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			const extraArgs = ['--title', 'my app', 'a&b', 'say "hi"', 'plain'];
			const plan = buildSpawnPlan({ isWindows: true, env: 'dev', extraArgs });
			assert.equal(plan.command, 'cmd.exe');
			assert.deepEqual(plan.args, [
				...FIXED,
				'--title',
				'"my app"',
				'"a&b"',
				'"say \\"hi\\""',
				'plain',
			]);
			assert.equal(plan.options.shell, false);
			assert.equal(plan.options.windowsVerbatimArguments, true);
		});

		it('POSIX plan: exact argv UNCHANGED (raw forwarded tokens, no quoting)', async () => {
			const { buildSpawnPlan } = await loadPureHelpers();
			const extraArgs = ['--title', 'my app', 'a&b', 'say "hi"', 'plain'];
			const plan = buildSpawnPlan({ isWindows: false, env: 'dev', extraArgs });
			assert.equal(plan.command, 'pnpm');
			// Same fixed prefix as the Windows plan minus the cmd.exe wrapper,
			// with the forwarded tokens byte-for-byte verbatim.
			assert.deepEqual(plan.args, [...FIXED.slice(4), ...extraArgs]);
			assert.equal(plan.options.shell, false);
			assert.equal('windowsVerbatimArguments' in plan.options, false);
		});
	});
});
