import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	declaredFeatures,
	grantedFeatures,
	inspect,
	loadPolicy,
	parseHeadersFile,
	patternToRegExp,
	permissionsPolicyValue,
	resolveHeadersForPath,
} from './check-security-headers.mjs';

/**
 * `check-security-headers.mjs` unit tests (Issue #449).
 *
 * The check exists because two surfaces carry the same policy and
 * nothing else keeps them equal. Its interesting invariants are:
 *   1. `_headers` parsing (comments, indentation, one rule per path).
 *   2. Rule resolution: every matching rule contributes, later wins,
 *      and a `:slug` placeholder matches exactly one segment.
 *   3. `Permissions-Policy` parsing: `=()` is a deny, anything else is a
 *      grant. A check that cannot tell those apart cannot enforce the
 *      Tool/host separation.
 *   4. The real repository state passes, and every individual mutation
 *      of it fails — otherwise the gate proves nothing.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const HEADERS_PATH = resolve(ROOT, 'public/_headers');

function tempHeadersFile(contents) {
	const directory = mkdtempSync(join(tmpdir(), 'security-headers-'));
	const path = join(directory, '_headers');
	writeFileSync(path, contents);
	return path;
}

describe('parseHeadersFile', () => {
	it('parses path + indented header lines and skips comments', () => {
		const rules = parseHeadersFile(
			[
				'# comment',
				'',
				'/*',
				'  X-Content-Type-Options: nosniff',
				'  Referrer-Policy: no-referrer',
				'',
			].join('\n'),
		);
		assert.equal(rules.length, 1);
		assert.equal(rules[0].path, '/*');
		assert.equal(rules[0].headers['x-content-type-options'], 'nosniff');
		assert.equal(rules[0].headers['referrer-policy'], 'no-referrer');
	});

	it('keeps rules in file order (order is the override order)', () => {
		const rules = parseHeadersFile(['/*', '  A: 1', '/tools/:slug/app/*', '  A: 2', ''].join('\n'));
		assert.deepEqual(
			rules.map((rule) => rule.path),
			['/*', '/tools/:slug/app/*'],
		);
	});
});

describe('patternToRegExp / resolveHeadersForPath', () => {
	const rules = parseHeadersFile(
		[
			'/*',
			'  Permissions-Policy: baseline=()',
			'  Referrer-Policy: strict-origin-when-cross-origin',
			'/tools/:slug/app/*',
			'  Permissions-Policy: baseline=()',
			'  Referrer-Policy: no-referrer',
			'/tools/mic-level/app/*',
			'  Permissions-Policy: microphone=(self "https://rebuildup.dev")',
			'',
		].join('\n'),
	);

	it('matches a named placeholder as exactly one segment', () => {
		assert.ok(patternToRegExp('/tools/:slug/app/*').test('/tools/prototype/app/index.html'));
		assert.ok(!patternToRegExp('/tools/:slug/app/*').test('/tools/a/b/app/index.html'));
	});

	it('lets a later, more specific rule override an earlier one', () => {
		assert.equal(
			resolveHeadersForPath(rules, '/tools/mic-level/app/index.html')['referrer-policy'],
			'no-referrer',
		);
		assert.equal(
			resolveHeadersForPath(rules, '/tools/mic-level/app/index.html')['permissions-policy'],
			'microphone=(self "https://rebuildup.dev")',
		);
		assert.equal(
			resolveHeadersForPath(rules, '/share/procon2026/index.html')['referrer-policy'],
			'strict-origin-when-cross-origin',
		);
	});

	it('applies the wildcard rule to paths with no dedicated rule', () => {
		assert.equal(resolveHeadersForPath(rules, '/favicon.svg')['permissions-policy'], 'baseline=()');
	});
});

describe('grantedFeatures / declaredFeatures', () => {
	it('treats =() as denied and everything else as granted', () => {
		assert.deepEqual(grantedFeatures('camera=(), microphone=(self "https://x.dev")'), [
			'microphone',
		]);
		assert.deepEqual(grantedFeatures('camera=()'), []);
		assert.deepEqual(grantedFeatures(undefined), []);
	});

	it('splits manifest feature names on whitespace', () => {
		assert.deepEqual(declaredFeatures('microphone camera'), ['microphone', 'camera']);
		assert.deepEqual(declaredFeatures(''), []);
		assert.deepEqual(declaredFeatures(undefined), []);
	});
});

describe('inspect — repository state', () => {
	it('accepts the shipped public/_headers and manifest', () => {
		const result = inspect();
		assert.deepEqual(result.violations, []);
		// The shipped state has exactly one Tool grant. If a second Tool
		// starts declaring one, this assertion is the reminder to update
		// the expectation rather than to widen the gate silently.
		assert.deepEqual(
			result.grantedTools.map((tool) => tool.slug),
			['mic-level'],
		);
	});

	it('rejects a _headers that drops nosniff from the baseline', () => {
		const mutated = tempHeadersFile(
			parseToText(readHeadersText().replace(/^ {2}X-Content-Type-Options: nosniff$/m, '')),
		);
		const result = inspect({ headersPath: mutated });
		assert.ok(
			result.violations.some((violation) => violation.includes('x-content-type-options')),
			`expected a nosniff violation, got ${JSON.stringify(result.violations)}`,
		);
	});

	it('rejects a _headers that grants the microphone to every Tool', () => {
		// The realistic shape of this regression: someone widens the
		// wildcard Tool rule instead of adding the per-slug one, so the
		// capture device stops being a per-Tool decision.
		const baseline =
			'  Permissions-Policy: bluetooth=(), camera=(), display-capture=(), geolocation=(), hid=(), microphone=(), payment=(), serial=(), usb=(), xr-spatial-tracking=()';
		const text = readHeadersText();
		const ruleStart = text.indexOf('/tools/:slug/app/*');
		const lineStart = text.indexOf(baseline, ruleStart);
		assert.notEqual(lineStart, -1, 'the wildcard Tool rule must carry the deny baseline');
		const mutatedText = `${text.slice(0, lineStart)}  Permissions-Policy: microphone=(self "https://rebuildup.dev")${text.slice(
			lineStart + baseline.length,
		)}`;
		const result = inspect({ headersPath: tempHeadersFile(mutatedText) });
		assert.ok(
			result.violations.some((violation) => violation.includes('outside the declaring Tool')),
			`expected a namespace violation, got ${JSON.stringify(result.violations)}`,
		);
	});

	it('rejects a _headers that drops the per-Tool grant rule', () => {
		// Strip the Permissions-Policy line from the mic-level rule block
		// (comments may sit between the path and the header).
		const text = readHeadersText();
		const block = text.slice(text.indexOf('/tools/mic-level/app/*'));
		const nextRule = block.indexOf('\n/', 1);
		const ruleText = nextRule === -1 ? block : block.slice(0, nextRule);
		const mutatedText = text.replace(
			ruleText,
			ruleText.replace(/\n {2}Permissions-Policy: [^\n]*/, ''),
		);
		const result = inspect({ headersPath: tempHeadersFile(mutatedText) });
		assert.ok(
			result.violations.some((violation) => violation.includes('permissions-policy: expected')),
			`expected a missing-grant violation, got ${JSON.stringify(result.violations)}`,
		);
	});

	it('rejects a header declared by two rules that match the same path', () => {
		// Cloudflare COMBINES matching rules, so repeating
		// `Referrer-Policy` in the mic-level rule yields
		// `no-referrer, no-referrer` on the wire — measured, not assumed.
		const text = readHeadersText();
		const marker = '/tools/mic-level/app/*\n';
		const at = text.indexOf(marker) + marker.length;
		const mutated = tempHeadersFile(
			`${text.slice(0, at)}  Referrer-Policy: no-referrer${text.slice(at)}`,
		);
		const result = inspect({ headersPath: mutated });
		assert.ok(
			result.violations.some((violation) => violation.includes('matching rules')),
			`expected a duplicate-header violation, got ${JSON.stringify(result.violations)}`,
		);
	});

	it('rejects a Tool artefact that blanket-denies a capture device', () => {
		// The failure this Issue exists to prevent: a deny-all on the Tool
		// namespace breaks every Tool that legitimately needs one, because
		// the framed document's own policy is binding for that document.
		const text = readHeadersText();
		const marker = '/tools/:slug/app/*\n';
		const at = text.indexOf(marker) + marker.length;
		const mutated = tempHeadersFile(
			`${text.slice(0, at)}  Permissions-Policy: bluetooth=(), camera=(), microphone=(), usb=()${text.slice(at)}`,
		);
		const result = inspect({ headersPath: mutated });
		assert.ok(
			result.violations.some((violation) => violation.includes('expected no value')),
			`expected a blanket-deny violation, got ${JSON.stringify(result.violations)}`,
		);
	});
});

describe('permissionsPolicyValue', () => {
	const policy = loadPolicy();

	it('denies everything when nothing is granted', () => {
		const value = permissionsPolicyValue(policy, 'https://rebuildup.dev');
		assert.equal(value.includes('microphone=(self'), false);
		assert.ok(value.includes('microphone=()'));
	});

	it('grants only the requested feature, scoped to the origin', () => {
		const value = permissionsPolicyValue(policy, 'https://rebuildup.dev', ['microphone']);
		assert.ok(value.includes('microphone=(self "https://rebuildup.dev")'));
		assert.ok(value.includes('camera=()'));
	});
});

/** Read the shipped `_headers` (kept in one place for the mutations). */
function readHeadersText() {
	return readFileSync(HEADERS_PATH, 'utf8');
}

function parseToText(text) {
	return text.endsWith('\n') ? text : `${text}\n`;
}
