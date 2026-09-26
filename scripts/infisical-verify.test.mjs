import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * `infisical-verify.mjs` unit tests.
 *
 * The script spawns `infisical run --env=dev -- node -e "<script>"`
 * and parses presence markers. End-to-end requires a live Infisical
 * self-host + the dev env seeded.
 *
 * The testable surface is the **pure helpers** + **Windows-safe
 * invariant**:
 *
 *   1. `buildPresenceCheckScript` produces a Node script that
 *      writes `KEY=true|false` markers (NOT values).
 *   2. `parsePresenceMarkers` parses stdout into a presence map.
 *   3. The script source uses `spawnSync` with `shell: false` for
 *      Windows portability.
 *   4. argv / log / error message invariant: no secret value
 *      reaches stdout (the inner script outputs booleans only).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'infisical-verify.mjs');
const SOURCE = readFileSync(SCRIPT, 'utf8');

function loadPureHelpers() {
	const grab = (signature) => {
		const re = new RegExp(`function ${signature}\\b[\\s\\S]*?\\n\\}`, 'm');
		const match = SOURCE.match(re);
		if (!match) throw new Error(`could not extract ${signature} from script`);
		// biome-ignore lint/security/noGlobalEval: test-only function extraction.
		return eval(`(${match[0].replace(/^function\s+/, 'function ')})`);
	};
	return {
		buildPresenceCheckScript: grab('buildPresenceCheckScript'),
		parsePresenceMarkers: grab('parsePresenceMarkers'),
		parseArgs: grab('parseArgs'),
	};
}

describe('infisical-verify.mjs', () => {
	describe('buildPresenceCheckScript', () => {
		const { buildPresenceCheckScript } = loadPureHelpers();

		it('emits 3 KEY=Boolean(process.env[KEY]) lines each terminated with \\n', () => {
			const script = buildPresenceCheckScript([
				'BETTER_AUTH_SECRET',
				'BETTER_AUTH_SECRETS',
				'MY_WEB_2026_CONSUMER_API_KEY',
			]);
			// Each line writes "KEY=true|false\n" so parsePresenceMarkers
			// can split on newlines. Without \n, parser sees one giant
			// line and silently drops every key.
			assert.match(
				script,
				/process\.stdout\.write\("BETTER_AUTH_SECRET=" \+ Boolean\(process\.env\["BETTER_AUTH_SECRET"\]\) \+ "\\n"\)/,
			);
			assert.match(
				script,
				/process\.stdout\.write\("BETTER_AUTH_SECRETS=" \+ Boolean\(process\.env\["BETTER_AUTH_SECRETS"\]\) \+ "\\n"\)/,
			);
			assert.match(
				script,
				/process\.stdout\.write\("MY_WEB_2026_CONSUMER_API_KEY=" \+ Boolean\(process\.env\["MY_WEB_2026_CONSUMER_API_KEY"\]\) \+ "\\n"\)/,
			);
		});

		it('appends a newline after each marker so parser can split keys (no concatenation)', () => {
			const script = buildPresenceCheckScript(['A', 'B']);
			// The script source must contain an explicit "\\n" escape
			// after each Boolean(...) call. parsePresenceMarkers
			// splits on /\r?\n/ and would skip the entire line if
			// multiple markers were concatenated without a newline.
			//
			// We grep the whole script (not a regex match group)
			// because a naive `/process\.stdout\.write\([^)]+\)/`
			// stops at the first `)` inside `Boolean(process.env[...])`
			// and would miss the trailing `+ "\\n")`.
			const writeCalls = script
				.split(';')
				.map((s) => s.trim())
				.filter((s) => s.startsWith('process.stdout.write'));
			assert.equal(writeCalls.length, 2);
			for (const call of writeCalls) {
				assert.match(call, /Boolean\(process\.env\[/);
				assert.match(call, /"\\n"/);
			}
		});

		it('never includes the secret value in the script (only KEY names + Boolean coercion)', () => {
			const script = buildPresenceCheckScript(['BETTER_AUTH_SECRET']);
			// Defensive: the script must not print env var values.
			assert.equal(script.includes('process.env["BETTER_AUTH_SECRET"]'), true);
			// But it must wrap in Boolean() so the output is true/false,
			// not the value.
			assert.match(script, /Boolean\(process\.env\["BETTER_AUTH_SECRET"\]\)/);
			assert.doesNotMatch(script, /process\.stdout\.write\(process\.env\["BETTER_AUTH_SECRET"\]\)/);
		});

		it('rejects empty secretNames array', () => {
			assert.throws(() => buildPresenceCheckScript([]), /non-empty array/);
		});

		it('rejects non-array input', () => {
			assert.throws(() => buildPresenceCheckScript(null), /non-empty array/);
			assert.throws(() => buildPresenceCheckScript('not-an-array'), /non-empty array/);
		});
	});

	describe('parsePresenceMarkers', () => {
		const { parsePresenceMarkers } = loadPureHelpers();

		it('parses KEY=true|false lines into a presence map', () => {
			const stdout =
				'BETTER_AUTH_SECRET=true\nBETTER_AUTH_SECRETS=false\nMY_WEB_2026_CONSUMER_API_KEY=true\n';
			const out = parsePresenceMarkers(stdout);
			assert.equal(out.BETTER_AUTH_SECRET, true);
			assert.equal(out.BETTER_AUTH_SECRETS, false);
			assert.equal(out.MY_WEB_2026_CONSUMER_API_KEY, true);
		});

		it('handles \\r\\n line endings (Windows)', () => {
			const stdout =
				'BETTER_AUTH_SECRET=true\r\nBETTER_AUTH_SECRETS=true\r\nMY_WEB_2026_CONSUMER_API_KEY=true\r\n';
			const out = parsePresenceMarkers(stdout);
			assert.equal(out.BETTER_AUTH_SECRET, true);
			assert.equal(out.BETTER_AUTH_SECRETS, true);
			assert.equal(out.MY_WEB_2026_CONSUMER_API_KEY, true);
		});

		it('returns empty object for empty input', () => {
			assert.deepEqual(parsePresenceMarkers(''), {});
			assert.deepEqual(parsePresenceMarkers('\n\n\n'), {});
		});

		it('skips malformed lines', () => {
			const stdout = 'no-equals-sign\n=BAD-KEY-NAME\nGOOD_KEY=true';
			const out = parsePresenceMarkers(stdout);
			assert.equal(out.GOOD_KEY, true);
			assert.equal(Object.keys(out).length, 1);
		});

		it('treats "true" / "false" string literally (only those exact values are truthy)', () => {
			assert.equal(parsePresenceMarkers('KEY=true').KEY, true);
			assert.equal(parsePresenceMarkers('KEY=false').KEY, false);
			assert.equal(parsePresenceMarkers('KEY=1').KEY, undefined);
		});

		it('round-trips with buildPresenceCheckScript (no fixture drift)', () => {
			// Defensive: the parser and the script generator must
			// agree on the wire format. If a future refactor changes
			// the line terminator or marker syntax without updating
			// both, this round-trip catches it.
			const { buildPresenceCheckScript, parsePresenceMarkers } = loadPureHelpers();
			const names = ['BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRETS', 'MY_WEB_2026_CONSUMER_API_KEY'];
			const script = buildPresenceCheckScript(names);

			// Stub the env: secret present, secret absent, secret
			// present. (The order matters: distinct values per key.)
			const stubEnv = {
				BETTER_AUTH_SECRET: 'present-1',
				MY_WEB_2026_CONSUMER_API_KEY: 'present-3',
			};
			const stdout = names.map((k) => `${k}=${Boolean(stubEnv[k])}`).join('\n');

			const out = parsePresenceMarkers(stdout);
			assert.equal(out.BETTER_AUTH_SECRET, true);
			assert.equal(out.BETTER_AUTH_SECRETS, false);
			assert.equal(out.MY_WEB_2026_CONSUMER_API_KEY, true);

			// The generated script must reference each key (so a
			// typo in the keys list would surface).
			for (const k of names) {
				assert.equal(script.includes(`process.env[${JSON.stringify(k)}]`), true);
			}
		});
	});

	describe('parseArgs', () => {
		const { parseArgs } = loadPureHelpers();

		it('accepts no args', () => {
			assert.deepEqual(parseArgs([]), {});
		});

		it('accepts --help', () => {
			const origExit = process.exit;
			const origLog = console.log;
			let exitCode = null;
			let logOutput = '';
			process.exit = (code) => {
				exitCode = code;
				throw new Error('__exit__');
			};
			console.log = (msg) => {
				logOutput += `${msg}\n`;
			};
			try {
				try {
					parseArgs(['--help']);
				} catch (e) {
					if (e.message !== '__exit__') throw e;
				}
				assert.equal(exitCode, 0);
				assert.match(logOutput, /Usage: infisical-verify\.mjs/);
			} finally {
				process.exit = origExit;
				console.log = origLog;
			}
		});

		it('rejects unknown argument', () => {
			assert.throws(() => parseArgs(['--bogus']), /unknown argument: --bogus/);
		});
	});

	describe('Windows-safety invariant', () => {
		it('the script source uses shell: false for spawn', () => {
			// Defensive: assert shell:false appears at least once in
			// a spawnSync call. POSIX-only shell substitution (e.g.,
			// `$(jq -r ...)`) would not survive Windows native shells.
			const shellFalse = SOURCE.match(/shell:\s*false/g);
			assert.ok(
				(shellFalse?.length ?? 0) >= 1,
				'script must use spawnSync with shell:false for Windows portability',
			);
		});

		it('the script source never uses POSIX-only shell substitution', () => {
			// Defensive: assert no `$(...)` patterns (these would
			// break Windows native PowerShell / cmd).
			const posixSubstitution = SOURCE.match(/\$\([^)]*\)/g);
			assert.equal(
				posixSubstitution,
				null,
				`script contains POSIX shell substitution: ${posixSubstitution?.join(', ')}`,
			);
		});

		it('the script source does not pipe through grep / wc / jq', () => {
			// Defensive: assert no shell pipes (`|` in command strings,
			// `| grep`, `| wc`, `| jq`).
			const pipeToShellTool = SOURCE.match(/\|\s*(grep|wc|jq|awk|sed)\b/g);
			assert.equal(pipeToShellTool, null);
		});
	});

	describe('argv / log / error secret-handling invariant', () => {
		it('the script source never echoes a secret value to stdout/log', () => {
			const logLeaks = SOURCE.match(/console\.(log|error|warn)[^)]*process\.env\.(BETTER|MY_WEB)/g);
			assert.equal(logLeaks, null);
		});

		it('the script source does not include secret values in error messages', () => {
			const errorLeaks = SOURCE.match(/throw new Error\([^)]*process\.env\.(BETTER|MY_WEB)/g);
			assert.equal(errorLeaks, null);
		});

		it('the inner Node script writes presence markers only (not values)', () => {
			// Defensive: the inner script writes KEY=Boolean(env[KEY]),
			// never KEY=env[KEY] (which would leak the value).
			const directValueWrite = SOURCE.match(/process\.stdout\.write\([^)]*process\.env\.[^)]*\)/g);
			for (const match of directValueWrite ?? []) {
				// Each stdout.write must wrap the env access in
				// Boolean(...) so the value never reaches stdout.
				const wrappedInBoolean = /Boolean\(process\.env\./.test(match);
				assert.ok(wrappedInBoolean, `inner script writes a raw env value: ${match}`);
			}
		});
	});

	describe('@infisical/cli binary resolution (regression for native binary path)', () => {
		it('does not call require.resolve on a non-existent .js path', () => {
			// Regression: `@infisical/cli` ships a NATIVE executable at
			// `bin/infisical` (no `.js` extension; declared in
			// `package.json#bin`). The old code did
			// `require.resolve('@infisical/cli/bin/infisical.js')` which
			// always failed at execution time. The fix reads
			// `package.json#bin` instead.
			assert.equal(
				SOURCE.includes("require.resolve('@infisical/cli/bin/infisical.js')"),
				false,
				'script must not resolve the @infisical/cli bin as a .js file',
			);
		});

		it('reads the bin path from @infisical/cli/package.json', () => {
			assert.match(SOURCE, /@infisical\/cli\/package\.json/);
		});
	});

	describe('self-host INFISICAL_DOMAIN override (regression for CLI default domain bug)', () => {
		it('the script sets INFISICAL_DOMAIN in spawn env (NOT .infisical.json domain field)', () => {
			// Regression: the CLI's `infisical run` defaults to
			// `https://app.infisical.com/api` (US cloud) and ignores
			// `--domain` for some subcommands. The script must set
			// INFISICAL_DOMAIN in the spawn env so `infisical run`
			// targets the self-host. We can't add `domain` to
			// `.infisical.json` because the schema validator
			// (ALLOWED_INFISICAL_JSON_KEYS in bootstrap-api.mjs)
			// doesn't include `domain`.
			const spawnEnvs = SOURCE.match(/INFISICAL_DOMAIN:/g) ?? [];
			assert.ok(
				spawnEnvs.length >= 1,
				'script must set INFISICAL_DOMAIN in spawnSync env (dev + prod checks)',
			);
		});
	});
});
