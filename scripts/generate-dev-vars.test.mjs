import assert from 'node:assert/strict';
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
 *   - parseSecretsRequired(wranglerJsoncSource)
 *   - parseSecretsResponse(jsonString)
 *   - formatDevVarsContent(secretMap)
 *
 * Operator-mandated invariants verified here:
 *   - Parser error messages never echo a secret value.
 *   - formatDevVarsContent quotes/escapes values so the output is
 *     parseable by `dotenv` parsers (round-trippable).
 *   - Lines in formatDevVarsContent are sorted alphabetically by
 *     key for stable diffs.
 *   - parseSecretsResponse silently drops items with missing key
 *     or null value (matches V3 placeholder rows).
 */
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'generate-dev-vars.mjs');

// Same regex-extraction pattern as
// `scripts/bootstrap-home-api-key.test.mjs:32-54`. We do not import
// the whole module because it runs at import time (parses argv,
// reads `.infisical.json`). Instead we slice out each pure helper
// via a regex and stitch them together inside an isolated
// factory closure.
async function loadPureHelpers() {
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(SCRIPT, 'utf8');

	function extract(name) {
		const re = new RegExp(`function\\s+${name}\\s*\\([\\s\\S]*?\\n\\}`, 'm');
		const match = source.match(re);
		if (!match) throw new Error(`Could not extract ${name}`);
		return match[0];
	}

	const parseJsonc = extract('parseJsonc');
	const parseSecretsRequired = extract('parseSecretsRequired');
	const parseSecretsResponse = extract('parseSecretsResponse');
	const formatDevVarsContent = extract('formatDevVarsContent');

	const factory = new Function(`
		${parseJsonc}
		${parseSecretsRequired}
		${parseSecretsResponse}
		${formatDevVarsContent}
		return { parseJsonc, parseSecretsRequired, parseSecretsResponse, formatDevVarsContent };
	`);
	return factory();
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

	describe('parseSecretsRequired', () => {
		it('returns the secrets.required array', async () => {
			const { parseSecretsRequired } = await loadPureHelpers();
			const source = `{
				"secrets": {
					"required": ["BETTER_AUTH_SECRET", "MY_WEB_2026_CONSUMER_API_KEY"]
				}
			}`;
			const out = parseSecretsRequired(source);
			assert.deepEqual(out, ['BETTER_AUTH_SECRET', 'MY_WEB_2026_CONSUMER_API_KEY']);
		});

		it('returns an empty array when secrets.required is absent', async () => {
			const { parseSecretsRequired } = await loadPureHelpers();
			const source = `{
				"name": "my-web-2026",
				"compatibility_date": "2026-09-07"
			}`;
			assert.deepEqual(parseSecretsRequired(source), []);
		});

		it('throws when secrets.required is not an array', async () => {
			const { parseSecretsRequired } = await loadPureHelpers();
			const source = `{
				"secrets": {
					"required": "BETTER_AUTH_SECRET"
				}
			}`;
			assert.throws(() => parseSecretsRequired(source), /must be an array/);
		});

		it('throws when an entry is empty string', async () => {
			const { parseSecretsRequired } = await loadPureHelpers();
			const source = `{
				"secrets": {
					"required": ["BETTER_AUTH_SECRET", ""]
				}
			}`;
			assert.throws(() => parseSecretsRequired(source), /invalid secrets\.required entry/);
		});

		it('parses JSONC (strips comments before locating secrets.required)', async () => {
			const { parseSecretsRequired } = await loadPureHelpers();
			const source = `{
				// Required secrets — see ADR-0015 §9.
				"secrets": {
					"required": [
						// legacy
						"BETTER_AUTH_SECRET",
						// consumer key
						"MY_WEB_2026_CONSUMER_API_KEY"
					]
				}
			}`;
			const out = parseSecretsRequired(source);
			assert.deepEqual(out, ['BETTER_AUTH_SECRET', 'MY_WEB_2026_CONSUMER_API_KEY']);
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
});
