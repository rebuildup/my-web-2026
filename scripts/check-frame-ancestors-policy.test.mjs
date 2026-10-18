import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	evaluateEmbedPolicy,
	evaluateStaticHtmlCoverage,
	evaluateWorkerCanary,
	findStaticHtmlDocuments,
	frameAncestorsValues,
	isUnder,
	main,
	normalizePattern,
	parseHeadersFile,
	patternMatchesPath,
	toolDeliveryProbePaths,
} from './check-frame-ancestors-policy.mjs';

/**
 * Fixture coverage for the static embed-policy gate (Issue #448).
 *
 * The gate is only worth running if it fails when it should, so each
 * direction it claims to protect is planted here as a fixture: the Tool
 * iframe being broken (`'none'`), third-party framing being re-opened
 * (`*`), a rule aimed at a Worker-owned path that could never apply,
 * and a dead Worker half. The final case runs the gate against the real
 * repository so a regression in the parser cannot turn it into a
 * silent no-op.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Evaluate a `_headers` document and return its violations. */
function violations(text, staticHtml = []) {
	const { rules, problems } = parseHeadersFile(text);
	return [...problems, ...evaluateEmbedPolicy(rules, staticHtml)];
}

const GOOD = `# comment
/tools/:slug/app/*
  Access-Control-Allow-Origin: *
  Content-Security-Policy: frame-ancestors 'self'

/tools/:slug/app
  Content-Security-Policy: frame-ancestors 'self'

/assets/*
  Cache-Control: public, max-age=31556952, immutable
`;

describe('check-frame-ancestors-policy — parser', () => {
	it('reads rules, headers and ignores comments', () => {
		const { rules, problems } = parseHeadersFile(GOOD);
		assert.deepEqual(problems, []);
		assert.equal(rules.length, 3);
		assert.equal(rules[0].pattern, '/tools/:slug/app/*');
		assert.deepEqual(
			rules[0].headers.map((h) => h.name),
			['Access-Control-Allow-Origin', 'Content-Security-Policy'],
		);
	});

	it('reports a header that appears before any rule pattern', () => {
		const errors = violations("  Content-Security-Policy: frame-ancestors 'self'\n");
		assert.equal(errors.length, 1);
		assert.match(errors[0], /header before any rule pattern/);
	});

	it('reports a line that is neither comment nor "Name: Value"', () => {
		const errors = violations('/assets/*\n  frame-ancestors self\n');
		assert.equal(errors.length, 1);
		assert.match(errors[0], /not a "Name: Value" header/);
	});
});

describe('check-frame-ancestors-policy — pattern classification', () => {
	it('drops wildcards and :param segments', () => {
		assert.equal(normalizePattern('/tools/:slug/app/*'), '/tools/app');
		assert.equal(normalizePattern('/tools/:slug/app'), '/tools/app');
		assert.equal(normalizePattern('/admin*'), '/admin');
	});

	it('keeps a lookalike path out of the denied namespace', () => {
		// The exact-prefix-or-/ rule the Worker policy uses: `/admin*` is
		// an admin rule, `/administrator` is not.
		assert.equal(isUnder('/admin*', '/admin'), true);
		assert.equal(isUnder('/admin/keys', '/admin'), true);
		assert.equal(isUnder('/administrator', '/admin'), false);
		assert.equal(isUnder('/api/v1/authentication', '/api/v1/auth'), false);
		assert.equal(isUnder('/api/v1/auth/get-session', '/api/v1/auth'), true);
	});

	it('reads only real directives, not tokens that start the same way', () => {
		assert.deepEqual(frameAncestorsValues("frame-ancestors 'self'"), ["'self'"]);
		assert.deepEqual(frameAncestorsValues("default-src 'self'; frame-ancestors 'none'"), [
			"'none'",
		]);
		assert.deepEqual(frameAncestorsValues('frame-ancestors-report'), []);
	});
});

describe('check-frame-ancestors-policy — the direction that keeps Tools working', () => {
	it('accepts the shipped Tool rule', () => {
		assert.deepEqual(violations(GOOD), []);
	});

	it('fails when a Tool artefact rule is switched to none', () => {
		const errors = violations(GOOD.replace("frame-ancestors 'self'", "frame-ancestors 'none'"));
		// One error for the rule that changed; the untouched second Tool
		// rule stays valid.
		assert.equal(errors.length, 1);
		assert.match(errors[0], /breaks every integrated Tool/);
	});

	it('fails when a Tool artefact rule drops the CSP header entirely', () => {
		const errors = violations('/tools/:slug/app/*\n  Access-Control-Allow-Origin: *\n');
		assert.equal(errors.length, 1);
		assert.match(errors[0], /sets no content-security-policy/);
	});
});

describe('check-frame-ancestors-policy — wide rules that reach a Tool artefact', () => {
	// Cloudflare applies every matching rule to a response and
	// comma-joins same-named headers, so a rule that is not written
	// under /tools still lands on the artefact when its pattern covers
	// the URL. `'none'` is legal elsewhere (the Worker half uses it for
	// /admin), so only the served-URL overlap can catch it.
	it('fails a wide rule that would deny the Tool iframe', () => {
		const errors = violations(`${GOOD}\n/*\n  Content-Security-Policy: frame-ancestors 'none'\n`);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /also matches the Tool artefact URL/);
		assert.match(errors[0], /comma-joins/);
	});

	it('fails a rule that covers the Tool namespace with a trailing wildcard', () => {
		const errors = violations(
			"/tools/*\n  Content-Security-Policy: frame-ancestors 'self'\n\n/*\n  Content-Security-Policy: frame-ancestors 'none'\n",
		);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /also matches the Tool artefact URL/);
	});

	it('accepts a wide rule that says self', () => {
		assert.deepEqual(
			violations(`${GOOD}\n/*\n  Content-Security-Policy: frame-ancestors 'self'\n`),
			[],
		);
	});

	it('does not report a rule that cannot reach a Tool artefact', () => {
		assert.deepEqual(
			violations(`${GOOD}\n/share/*\n  Content-Security-Policy: frame-ancestors 'none'\n`),
			[],
		);
	});

	it('reports a wrong Tool rule once, not once per served form', () => {
		const errors = violations(GOOD.replace("frame-ancestors 'self'", "frame-ancestors 'none'"));
		assert.equal(errors.length, 1);
		assert.match(errors[0], /breaks every integrated Tool/);
	});

	it('derives the probed URLs from the shipped Tool rules', () => {
		const { rules } = parseHeadersFile(GOOD);
		assert.deepEqual(toolDeliveryProbePaths(rules), [
			'/tools/tool/app',
			'/tools/tool/app/',
			'/tools/tool/app/index.html',
		]);
	});
});

describe('check-frame-ancestors-policy — the direction that denies third parties', () => {
	it('fails on the permissive values that re-open framing', () => {
		for (const value of ['*', 'https:', "'self' https://evil.example"]) {
			const errors = violations(`/tools/*\n  Content-Security-Policy: frame-ancestors ${value}\n`);
			assert.equal(errors.length, 1, `expected one violation for ${value}`);
			assert.match(errors[0], /is not a value this site ships/);
		}
	});

	it('fails a rule aimed at a Worker-generated path', () => {
		for (const pattern of ['/admin*', '/api/v1/auth/*']) {
			const errors = violations(`${pattern}\n  Content-Security-Policy: frame-ancestors 'none'\n`);
			assert.equal(errors.length, 1);
			assert.match(errors[0], /Worker-generated response/);
		}
	});

	it('fails a CSP that carries no frame-ancestors directive', () => {
		const errors = violations("/tools/*\n  Content-Security-Policy: default-src 'none'\n");
		assert.equal(errors.length, 1);
		assert.match(errors[0], /carries no frame-ancestors directive/);
	});

	it('fails a duplicated frame-ancestors directive', () => {
		const errors = violations(
			"/tools/*\n  Content-Security-Policy: frame-ancestors 'self'; frame-ancestors 'none'\n",
		);
		// Both the dead second opinion and the value it would have applied
		// to a Tool document are reported: the duplicate is misleading AND
		// the value is the one that would break the iframe if a browser
		// honoured it.
		assert.equal(errors.length, 2);
		assert.match(errors[0], /declared 2 times/);
		assert.match(errors[1], /breaks every integrated Tool/);
	});
});

/** The only committed public HTML document, in both served forms. */
const SHARE_DOCUMENT = [
	{
		file: '/share/procon2026/index.html',
		paths: ['/share/procon2026/', '/share/procon2026/index.html'],
	},
];

/** A generated Tool artefact document, which lives in `dist/`, not `public/`. */
const TOOL_DOCUMENT = [
	{
		file: '/tools/example/app/index.html',
		paths: ['/tools/example/app/', '/tools/example/app/index.html'],
	},
];

describe('check-frame-ancestors-policy — public HTML coverage', () => {
	it('accepts the shipped /share rule', () => {
		const text = "/share/*\n  Content-Security-Policy: frame-ancestors 'self'\n";
		assert.deepEqual(evaluateStaticHtmlCoverage(parseHeadersFile(text).rules, SHARE_DOCUMENT), []);
		assert.deepEqual(violations(text, SHARE_DOCUMENT), []);
	});

	it('fails when a public HTML document has no rule at all', () => {
		// GOOD covers only the Tool namespace, so the share document is
		// framable by any third party — the exact gap this rule closes.
		const errors = violations(GOOD, SHARE_DOCUMENT);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /\/share\/procon2026\/index\.html \(public HTML document\)/);
		assert.match(errors[0], /no framing policy/);
	});

	it('fails when the matching rule carries no frame-ancestors directive', () => {
		const text = '/share/*\n  Cache-Control: public, max-age=0, must-revalidate\n';
		const errors = evaluateStaticHtmlCoverage(parseHeadersFile(text).rules, SHARE_DOCUMENT);
		assert.equal(errors.length, 1);
		assert.match(
			errors[0],
			/not matched by any _headers rule that carries a frame-ancestors directive/,
		);
	});

	it('fails when a rule covers only the directory form of an index document', () => {
		// Static Assets answers both `/share/procon2026/` and
		// `/share/procon2026/index.html`. Covering one leaves the other
		// framable by a third party, so each served URL is checked.
		const text = "/share/procon2026/\n  Content-Security-Policy: frame-ancestors 'self'\n";
		const errors = evaluateStaticHtmlCoverage(parseHeadersFile(text).rules, SHARE_DOCUMENT);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /\/share\/procon2026\/index\.html \(public HTML document\)/);
		assert.match(errors[0], /\/share\/procon2026\/index\.html is not matched/);
	});

	it('fails when a rule covers only the explicit index.html URL', () => {
		const text =
			"/share/procon2026/index.html\n  Content-Security-Policy: frame-ancestors 'self'\n";
		const errors = evaluateStaticHtmlCoverage(parseHeadersFile(text).rules, SHARE_DOCUMENT);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /\/share\/procon2026\/ is not matched/);
	});

	it('accepts two rules that cover one served form each', () => {
		const text = [
			"/share/procon2026/\n  Content-Security-Policy: frame-ancestors 'self'\n",
			"/share/procon2026/index.html\n  Content-Security-Policy: frame-ancestors 'self'\n",
		].join('');
		assert.deepEqual(evaluateStaticHtmlCoverage(parseHeadersFile(text).rules, SHARE_DOCUMENT), []);
	});

	it('accepts a :param rule that covers a generated Tool artefact document', () => {
		assert.deepEqual(evaluateStaticHtmlCoverage(parseHeadersFile(GOOD).rules, TOOL_DOCUMENT), []);
	});

	it('does not let a sibling prefix match', () => {
		// Prefix matching is not string matching: `/share-other/*` is not
		// a rule for `/share/`, exactly like `/administrator` is not an
		// Admin path in the Worker policy.
		const text = "/share-other/*\n  Content-Security-Policy: frame-ancestors 'self'\n";
		assert.equal(
			evaluateStaticHtmlCoverage(parseHeadersFile(text).rules, SHARE_DOCUMENT).length,
			1,
		);
	});

	it('matches a path pattern without treating punctuation as a wildcard', () => {
		assert.equal(patternMatchesPath('/tools/:slug/app/*', '/tools/proto/app/index.html'), true);
		assert.equal(patternMatchesPath('/tools/:slug/app/*', '/tools/proto/other/index.html'), false);
		assert.equal(patternMatchesPath('/share/*', '/share/procon2026/'), true);
		assert.equal(patternMatchesPath('/share/*', '/shared/x'), false);
	});

	it('discovers the committed public HTML documents', () => {
		const documents = findStaticHtmlDocuments(join(REPO_ROOT, 'public'));
		const files = documents.map((document) => document.file);
		assert.ok(files.includes('/share/procon2026/index.html'), `not found in ${files.join(', ')}`);
		for (const document of documents) {
			// Every document is reported in both served forms when it is an
			// entry document, so a rule cannot cover only one URL.
			assert.ok(document.paths.includes(document.file));
			if (document.file.endsWith('/index.html')) {
				assert.ok(document.paths.includes(document.file.slice(0, -'index.html'.length)));
			}
		}
	});
});

describe('check-frame-ancestors-policy — Worker half canary', () => {
	it('passes on the real src/server.ts', () => {
		const source = readFileSync(join(REPO_ROOT, 'src/server.ts'), 'utf8');
		assert.deepEqual(evaluateWorkerCanary(source), []);
	});

	it('fails when the Worker half disappears', () => {
		// content-security-policy, frame-ancestors, and both policy values.
		assert.equal(evaluateWorkerCanary('export default { fetch() {} };').length, 4);
		assert.match(evaluateWorkerCanary('// frame-ancestors gone')[0], /content-security-policy/);
	});

	it('fails when only one of the two policy values survives', () => {
		const source = "// content-security-policy frame-ancestors 'none'";
		const errors = evaluateWorkerCanary(source);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /'self'/);
	});
});

describe('check-frame-ancestors-policy — against the real repository', () => {
	it('reports no violation for the shipped public/_headers', () => {
		const text = readFileSync(join(REPO_ROOT, 'public/_headers'), 'utf8');
		const documents = findStaticHtmlDocuments(join(REPO_ROOT, 'public'));
		assert.deepEqual(violations(text, documents), []);
	});

	it('exits 0 when run as a CLI', () => {
		assert.equal(main([]), 0);
	});
});
