/**
 * `scripts/check-html-standards.mjs` — fixture suite (Issue #412).
 *
 * Every rule the HTML standards gate claims to enforce is proven here
 * against a minimal document, against the two committed fixtures, and
 * against the inventory / waiver guards. The fixtures are the
 * verifiable artefact the Issue asks for: a reader can see, without
 * running the gate against the shipped Worker, what fails, what is
 * deliberately allowed, and which mistakes cannot pass silently.
 *
 * `node --test scripts/check-html-standards.test.mjs`
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	DEFAULT_MANIFEST,
	ManifestError,
	evaluateInventory,
	loadManifest,
	publishedPathForId,
	runOfflineCheck,
} from './check-html-standards.mjs';
import {
	effectiveFindings,
	evaluateRoutes,
	parseDocument,
	severitiesFrom,
	validateHtml,
} from './html-standards-contract.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(REPO_ROOT, 'scripts/check-html-standards.mjs');
const MANIFEST_PATH = join(REPO_ROOT, DEFAULT_MANIFEST);

/** Wrap a body in the document skeleton the gate requires. */
function document(body, { head = '', doctype = '<!doctype html>', lang = 'en' } = {}) {
	return `${doctype}<html lang="${lang}"><head><meta charset="utf-8"><title>fixture</title>${head}</head><body>${body}</body></html>`;
}

/** Rules emitted at error severity for a fragment. */
function errorRules(body, options) {
	return validateHtml(document(body, options))
		.messages.filter((message) => message.severity === 'error')
		.map((message) => message.rule);
}

/**
 * Rules emitted at error severity for a WHOLE document, so the cases
 * that can only be expressed at the end of the input (an optional end
 * tag, a trailing `<`) are reachable instead of being closed for the
 * test by the wrapper above.
 */
function rawErrorRules(html) {
	return validateHtml(html)
		.messages.filter((message) => message.severity === 'error')
		.map((message) => message.rule);
}

/** The document skeleton, left open on purpose (EOF is the case under test). */
function openDocument(body) {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title></head><body>${body}`;
}

/** Every text node in the parsed tree, concatenated — proves a literal survived. */
function textContent(node) {
	if (node.type === 'text') return node.text;
	return node.children.map(textContent).join('');
}

test('invalid markup — the three defect classes the Issue names', async (t) => {
	await t.test('a block element inside a phrasing parent is invalid nesting', () => {
		assert.ok(errorRules('<h2><div>block</div></h2>').includes('invalid-nesting'));
		assert.ok(!errorRules('<h2>phrasing <em>only</em></h2>').includes('invalid-nesting'));
	});

	await t.test('an interactive control inside a link is invalid nesting', () => {
		assert.ok(
			errorRules('<a href="/"><button type="button">x</button></a>').includes('invalid-nesting'),
		);
		assert.ok(
			!errorRules('<a href="/"><span>label</span></a>').includes('invalid-nesting'),
			'phrasing inside a link is transparent content and is allowed',
		);
	});

	await t.test('an <li> outside a list is invalid nesting', () => {
		assert.ok(errorRules('<ul><span>x</span></ul>').includes('invalid-nesting'));
		assert.ok(!errorRules('<ul><li>a</li><li>b</li></ul>').includes('invalid-nesting'));
	});

	await t.test('a duplicate id is reported once, at the second occurrence', () => {
		const messages = validateHtml(document('<p id="x">one</p><p id="x">two</p>')).messages.filter(
			(message) => message.rule === 'duplicate-id',
		);
		assert.equal(messages.length, 1);
		assert.match(messages[0].message, /Duplicate ID "x"/);
	});

	await t.test('an attribute the element does not take is an attribute error', () => {
		assert.ok(errorRules('<div href="/nope">x</div>').includes('unknown-attribute'));
		assert.ok(!errorRules('<a href="/yes">x</a>').includes('unknown-attribute'));
	});

	await t.test('the autofill attribute is allowed on every element HTML lists it for', () => {
		// Regression: `autocomplete` is a LISTED attribute of form / input /
		// select / textarea. When the per-element tables carried it on only
		// `select` and `textarea`, the SSR half failed on /admin/login,
		// which renders `autocomplete="username"` / `current-password` on
		// its TextFields (Issue #404) — a conformant document reported as
		// html.unknown-attribute.
		for (const fragment of [
			'<form autocomplete="on"></form>',
			'<input autocomplete="username">',
			'<select autocomplete="email"><option>a</option></select>',
			'<textarea autocomplete="street-address"></textarea>',
		]) {
			assert.ok(!errorRules(fragment).includes('unknown-attribute'), fragment);
		}
		// The allowlist stays PER ELEMENT: an attribute that belongs to a
		// different element is still reported, so the fix above cannot be
		// generalised into "input accepts anything".
		assert.ok(
			errorRules('<select rows="2"><option>a</option></select>').includes('unknown-attribute'),
		);
	});

	await t.test('a duplicate attribute keeps the first value silently — report it', () => {
		assert.ok(errorRules('<span class="a" class="b">x</span>').includes('duplicate-attribute'));
	});

	await t.test('an out-of-grammar enumerated value is a bad value', () => {
		assert.ok(errorRules('<form method="put"></form>').includes('bad-value'));
		assert.ok(!errorRules('<form method="post"></form>').includes('bad-value'));
		assert.ok(errorRules('<input type="textt">').includes('bad-value'));
		assert.ok(errorRules('<ol type="Q"></ol>').includes('bad-value'));
		assert.ok(!errorRules('<ol type="1"></ol>').includes('bad-value'));
	});

	await t.test('a boolean attribute may not carry an arbitrary value', () => {
		assert.ok(errorRules('<input type="checkbox" checked="maybe">').includes('bad-value'));
		assert.ok(!errorRules('<input type="checkbox" checked>').includes('bad-value'));
		assert.ok(!errorRules('<input type="checkbox" checked="checked">').includes('bad-value'));
	});

	await t.test('a rel token list is validated per token', () => {
		assert.ok(!errorRules('<a href="/" rel="noopener noreferrer">x</a>').includes('bad-value'));
		assert.ok(errorRules('<a href="/" rel="noopener inventedrel">x</a>').includes('bad-value'));
	});

	await t.test('a dangling IDREF is reported', () => {
		assert.ok(errorRules('<a href="/" aria-labelledby="nowhere">x</a>').includes('bad-idref'));
		assert.ok(
			!errorRules('<span id="here">y</span><a href="/" aria-labelledby="here">x</a>').includes(
				'bad-idref',
			),
		);
	});

	await t.test('a label[for] that does not resolve to a control is reported', () => {
		assert.ok(errorRules('<label for="field">l</label>').includes('bad-idref'));
		assert.ok(!errorRules('<label for="field">l</label><input id="field">').includes('bad-idref'));
		assert.ok(errorRules('<label for="x">l</label><div id="x"></div>').includes('bad-idref'));
	});

	await t.test('required attributes are enforced', () => {
		assert.ok(errorRules('<img src="/a.webp">').includes('missing-attribute'));
		assert.ok(!errorRules('<img src="/a.webp" alt="a">').includes('missing-attribute'));
		const noLang = validateHtml(
			'<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body></body></html>',
		).messages.map((message) => message.rule);
		assert.ok(noLang.includes('missing-attribute'), '<html> without lang must be reported');
	});

	await t.test('a misnested pair and a stray end tag are reported separately', () => {
		const rules = errorRules('<b><i>x</b></i>');
		assert.ok(rules.includes('misnested-tag'));
		assert.ok(rules.includes('stray-end-tag'));
	});

	await t.test('an element left open at EOF is reported', () => {
		const rules = validateHtml(
			'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body><div>open',
		).messages.map((message) => message.rule);
		assert.ok(rules.includes('unclosed-element'));
	});

	await t.test('a missing doctype, a foreign doctype and a missing skeleton are reported', () => {
		assert.ok(errorRules('<p>x</p>', { doctype: '' }).includes('missing-doctype'));
		assert.ok(errorRules('<p>x</p>', { doctype: '<!DOCTYPE xhtml>' }).includes('bad-doctype'));
		const legacy = validateHtml(
			document('<p>x</p>', { doctype: '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN">' }),
		).messages.map((message) => message.rule);
		assert.ok(legacy.includes('obsolete-doctype'), 'a legacy doctype is reported, as a warning');
		const skeletonless = validateHtml('<!doctype html><p>x</p>').messages.map((m) => m.rule);
		assert.ok(skeletonless.includes('missing-element'));
	});

	await t.test('an empty <title> is reported', () => {
		const result = validateHtml(
			'<!doctype html><html lang="en"><head><meta charset="utf-8"><title> </title></head><body></body></html>',
		);
		assert.ok(result.messages.some((message) => message.rule === 'empty-title'));
	});

	await t.test('a non-UTF-8 charset is reported', () => {
		assert.ok(
			errorRules('<p>x</p>', { head: '<meta charset="ISO-8859-1">' }).includes('bad-value'),
		);
	});
});

test('valid markup is not reported — false positives are the failure mode', async (t) => {
	await t.test('the committed valid fixture is clean', () => {
		const result = validateHtml(
			readFileSync(join(REPO_ROOT, 'test/fixtures/html-standards/valid-page.html'), 'utf8'),
		);
		assert.deepEqual(result.stats.errors, 0, JSON.stringify(result.messages, null, 2));
		assert.deepEqual(result.stats.warnings, 0, JSON.stringify(result.messages, null, 2));
	});

	await t.test('optional end tags are honoured', () => {
		assert.deepEqual(errorRules('<ul><li>a<li>b</ul>'), []);
		assert.deepEqual(errorRules('<p>a<p>b'), []);
		assert.deepEqual(errorRules('<table><tr><td>a<td>b</table>'), []);
	});

	await t.test('an optional end tag left open at EOF is not unclosed-element', () => {
		// HTML5 closes an optional end tag for you, including at the end of
		// the document. Reporting it would make conforming documents fail.
		assert.deepEqual(rawErrorRules(openDocument('<p>text')), []);
		assert.deepEqual(rawErrorRules(openDocument('<ul><li>a<li>b</ul>')), []);
		assert.deepEqual(rawErrorRules(openDocument('<dl><dt>a<dd>b</dl>')), []);
		// The document skeleton's own end tags are optional too, so a
		// document that simply stops is still conforming.
		assert.deepEqual(
			rawErrorRules('<!doctype html><html lang="en"><head><title>t</title></head><body><p>text'),
			[],
		);
		// A REQUIRED end tag at EOF is still a real defect, or this
		// exception would hide a truncated document.
		assert.ok(
			rawErrorRules(openDocument('<div>text')).includes('unclosed-element'),
			'a <div> left open at EOF is still reported',
		);
	});

	await t.test('a literal < in text is text, and the tokenizer still terminates', () => {
		// Regression: the literal-`<` branch advanced the cursor to offset 1
		// instead of past the `<`, so any document holding a `<` that does
		// not open a tag looped until the heap died instead of reporting.
		assert.deepEqual(errorRules('<p>a < b</p>'), []);
		assert.deepEqual(errorRules('<p>1<2</p>'), []);
		assert.deepEqual(errorRules('<p>a << b</p>'), []);
		// EOF and a run of `<` are only expressible on a whole document.
		assert.deepEqual(rawErrorRules(openDocument('<p>trailing <')), []);
		assert.deepEqual(rawErrorRules(openDocument('<<<')), []);

		// Termination alone is not enough: the `<` must survive as text and
		// the markup after it must still be parsed.
		const html = document('<p>a < b</p><h2>after</h2>');
		assert.ok(textContent(parseDocument(html).root).includes('a < b'), 'the literal < stays text');
		assert.equal(
			validateHtml(html).stats.elements,
			7,
			'html, head, meta, title, body, p and h2 — parsing continued past the literal <',
		);
	});

	await t.test('inline SVG is not checked as HTML', () => {
		const svg =
			'<span><svg viewBox="0 0 24 24" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0" stroke-width="2"/></svg></span>';
		assert.deepEqual(errorRules(svg), []);
	});

	await t.test('a <dl> may group dt/dd in a div', () => {
		assert.deepEqual(errorRules('<dl><div><dt>a</dt><dd>b</dd></div></dl>'), []);
		assert.ok(
			errorRules('<div><dt>a</dt></div>').includes('invalid-nesting'),
			'a dt outside a <dl> is still invalid',
		);
	});

	await t.test('a <legend> may be the first child of a <fieldset>', () => {
		assert.deepEqual(errorRules('<fieldset><legend>L</legend><p>b</p></fieldset>'), []);
	});

	await t.test('a JSON-LD script type is a MIME type, not a bad keyword', () => {
		assert.ok(
			!errorRules('<p>x</p>', { head: '<script type="application/ld+json">{}</script>' }).includes(
				'bad-value',
			),
		);
		assert.ok(
			errorRules('<p>x</p>', { head: '<script type="modulee">x</script>' }).includes('bad-value'),
		);
	});

	await t.test('a hoisted <style> in the body is a documented divergence, not a finding', () => {
		// React 19 streams suspense styles as `<div hidden><style>…</style></div>`
		// and the Nu validator flags it; the SSR documents this project ships
		// cannot avoid it, so the engine records the divergence instead.
		assert.deepEqual(errorRules('<div hidden><style>.a{color:red}</style></div>'), []);
		assert.ok(
			errorRules('<div><ul><style>.a{color:red}</style></ul></div>').includes('invalid-nesting'),
			'a <style> inside a non-flow parent is still reported',
		);
	});

	await t.test('data-* and aria-* are allowed anywhere they make sense', () => {
		assert.deepEqual(errorRules('<div data-state="" data-x="1">x</div>'), []);
		assert.deepEqual(errorRules('<div role="note" aria-current="page">x</div>'), []);
	});

	await t.test('an unknown element is not a conformance error', () => {
		assert.deepEqual(errorRules('<my-widget data-x="1"><p>x</p></my-widget>'), []);
	});

	await t.test('an id is still unique across an SVG boundary', () => {
		const rules = errorRules('<svg id="a"></svg><p id="a">x</p>').filter(
			(rule) => rule === 'duplicate-id',
		);
		assert.equal(rules.length, 1);
	});

	await t.test('a skipped heading level is a warning, never an error', () => {
		const messages = validateHtml(document('<h2>x</h2><h4>y</h4>')).messages;
		const skip = messages.find((message) => message.rule === 'heading-level-skip');
		assert.ok(skip);
		assert.equal(
			skip.severity,
			'error',
			'the shipped manifest sets the severity; this asserts the default',
		);
	});
});

test('the manifest owns the severity of each rule', () => {
	const manifest = loadManifest(MANIFEST_PATH);
	assert.equal(manifest.rules['heading-level-skip'].severity, 'warning');
	assert.equal(manifest.rules['duplicate-id'].severity, 'error');

	const messages = validateHtml(document('<h2>x</h2><h4>y</h4>'), {
		severities: severitiesFrom(manifest),
	}).messages;
	const skip = messages.find((message) => message.rule === 'heading-level-skip');
	assert.equal(skip.severity, 'warning');
	assert.equal(validateHtml(document('<h2>x</h2><h4>y</h4>')).stats.errors, 1);
});

test('the rule table and the engine catalogue must agree in both directions', () => {
	const manifest = loadManifest(MANIFEST_PATH);
	// The shipped manifest is complete (loadManifest already proved it).
	assert.ok(Object.keys(manifest.rules).length >= 18);

	const { 'duplicate-id': _dropped, ...withoutDuplicateId } = manifest.rules;
	const broken = { ...manifest, rules: withoutDuplicateId };
	assert.throws(() => loadManifestFixture(broken), /duplicate-id/);

	const invented = {
		...manifest,
		rules: { ...manifest.rules, 'no-such-rule': { severity: 'error', reason: 'invented rule' } },
	};
	assert.throws(() => loadManifestFixture(invented), /no-such-rule/);
});

test('a route roster entry that reads as coverage but checks nothing fails', async (t) => {
	const manifest = loadManifest(MANIFEST_PATH);
	const declared = new Set(manifest.routes.map((route) => route.route_id));

	await t.test('every published route id is declared', () => {
		const errors = evaluateInventory({
			manifest,
			fileRouteIds: new Set([...declared, '/new-route']),
			treeRouteIds: new Set(),
		});
		assert.equal(errors.length, 1);
		assert.match(errors[0], /inventory\.unlisted: \/new-route/);
	});

	await t.test('a declared route that no longer exists fails', () => {
		const errors = evaluateInventory({
			manifest,
			fileRouteIds: new Set(),
			treeRouteIds: new Set(),
		});
		assert.ok(errors.length >= 1);
		assert.ok(errors.every((error) => /inventory\.(missing|unlisted)/.test(error)));
	});

	await t.test('the shipped manifest matches the shipped routes', () => {
		const offline = runOfflineCheck({ root: REPO_ROOT, manifest });
		assert.deepEqual(offline.inventory, []);
		assert.deepEqual(offline.errors, []);
	});

	await t.test('every shipped waiver names the shape it covers', () => {
		assert.ok(manifest.waivers.length > 0, 'the shipped ledger records the pre-existing defects');
		for (const waiver of manifest.waivers) {
			assert.ok(
				waiver.route_id || waiver.message_pattern,
				`waiver ${waiver.rule} must scope itself`,
			);
			assert.match(waiver.reason, /PRE-EXISTING/);
		}
	});

	await t.test('nested route ids normalize to their published path', () => {
		assert.equal(publishedPathForId('/admin/invitations_/accept'), '/admin/invitations/accept');
		assert.equal(publishedPathForId('/portfolio/'), '/portfolio');
		assert.equal(publishedPathForId('/'), '/');
	});
});

test('a route nobody observed is not a passing route', async (t) => {
	const manifest = {
		routes: [{ route_id: '/x', path: '/x', mode: 'render', why: 'fixture route for the suite' }],
		waivers: [],
	};

	await t.test('a missing observation is an error', () => {
		const result = evaluateRoutes({ manifest, observations: [] });
		assert.equal(result.stats.errors, 1);
		assert.equal(result.findings[0].rule, 'route.unobserved');
	});

	await t.test('a request that failed is an error', () => {
		const result = evaluateRoutes({
			manifest,
			observations: [
				{
					routeId: '/x',
					path: '/x',
					status: null,
					html: '',
					contentType: null,
					requestFailed: true,
					note: 'connection refused',
				},
			],
		});
		assert.equal(result.findings[0].rule, 'route.request-failed');
	});

	await t.test('a non-2xx and a non-HTML response are errors', () => {
		const notRendered = evaluateRoutes({
			manifest,
			observations: [
				{
					routeId: '/x',
					path: '/x',
					status: 307,
					html: document('<p>x</p>'),
					contentType: 'text/html',
				},
			],
		});
		assert.ok(notRendered.findings.some((finding) => finding.rule === 'route.not-rendered'));

		const notHtml = evaluateRoutes({
			manifest,
			observations: [
				{ routeId: '/x', path: '/x', status: 200, html: '{}', contentType: 'application/json' },
			],
		});
		assert.ok(notHtml.findings.some((finding) => finding.rule === 'route.not-html'));
	});

	await t.test('a clean document produces no finding', () => {
		const result = evaluateRoutes({
			manifest,
			observations: [
				{
					routeId: '/x',
					path: '/x',
					status: 200,
					html: document('<main><h1>x</h1><p>y</p></main>'),
					contentType: 'text/html; charset=utf-8',
				},
			],
		});
		assert.deepEqual(result.findings, []);
		assert.equal(result.stats.errors, 0);
	});
});

test('a waiver that suppresses nothing fails', () => {
	const manifest = {
		routes: [{ route_id: '/x', path: '/x', mode: 'render', why: 'fixture route for the suite' }],
		waivers: [
			{ route_id: '/x', rule: 'html.duplicate-id', reason: 'fixture waiver that must not survive' },
		],
	};
	const observation = {
		routeId: '/x',
		path: '/x',
		status: 200,
		html: document('<p id="a">one</p><p id="a">two</p>'),
		contentType: 'text/html',
	};
	const used = evaluateRoutes({ manifest, observations: [observation] });
	assert.equal(used.stats.errors, 0, 'a waiver that matches a real finding suppresses it');
	assert.ok(
		used.findings.some((finding) => finding.rule === 'html.duplicate-id' && finding.waived),
	);

	const unused = evaluateRoutes({
		manifest: { ...manifest, waivers: [{ ...manifest.waivers[0], rule: 'html.bad-idref' }] },
		observations: [observation],
	});
	assert.ok(unused.findings.some((finding) => finding.rule === 'waiver.unused'));
	assert.ok(unused.findings.some((finding) => finding.rule === 'html.duplicate-id'));
	assert.equal(
		unused.stats.errors,
		2,
		'the unused waiver fails, and the unwaived defect still fails',
	);
});

test('a waiver is scoped to the message shape it names', () => {
	const base = {
		routes: [{ route_id: '/x', path: '/x', mode: 'render', why: 'fixture route for the suite' }],
	};
	const observation = {
		routeId: '/x',
		path: '/x',
		status: 200,
		html: document('<p id="a">one</p><p id="a">two</p><h1>a</h1><h4>b</h4>'),
		contentType: 'text/html',
	};

	// A message-shaped waiver covers only the shape it names.
	const scoped = evaluateRoutes({
		manifest: {
			...base,
			waivers: [
				{
					rule: 'html.duplicate-id',
					message_pattern: 'Duplicate ID "a"',
					reason: 'fixture waiver scoped to one message shape for this suite',
				},
			],
		},
		observations: [observation],
	});
	assert.equal(scoped.findings.filter((finding) => finding.rule === 'html.duplicate-id').length, 1);
	assert.ok(scoped.findings.some((finding) => finding.waived));
	assert.ok(
		scoped.findings.some(
			(finding) => finding.rule === 'html.heading-level-skip' && !finding.waived,
		),
		'a waiver for one rule does not mute another',
	);

	// A waiver that names neither a route nor a message shape is a blanket,
	// and the manifest loader refuses to load it. `version` is carried over
	// from the shipped manifest because the fixture only exercises waivers.
	const blanket = {
		version: loadManifest(MANIFEST_PATH).version,
		fixtures: loadManifest(MANIFEST_PATH).fixtures,
		...base,
		waivers: [{ rule: 'html.duplicate-id', reason: 'fixture blanket waiver for this suite' }],
	};
	assert.throws(() => loadManifestFixture(blanket), /route_id or message_pattern/);
});

test('the exit code and the statistics must count the same errors', async (t) => {
	const manifest = loadManifest(MANIFEST_PATH);

	/** The three defects the shipped ledger waives, as one document. */
	const waivedDocument = document(
		'<main><h1>x</h1><nav><ul><a href="/">home</a></ul></nav><section><h2>y</h2>' +
			'<button type="button"><div class="icon"></div></button>' +
			'<input type="search" aria-controls="epr-search-id" aria-label="q"></section></main>',
	);
	// One renderable route (the ledger covers `/`), everything else declared
	// `excluded` so the offline half's roster check still matches
	// `src/routes/**` and contributes no errors of its own.
	const singleRoute = {
		...manifest,
		routes: manifest.routes.map((route) =>
			route.route_id === '/'
				? route
				: { ...route, mode: 'excluded', reason: 'not served by the loopback fixture origin' },
		),
	};

	await t.test('a waived finding never counts against the exit code', () => {
		const findings = [
			{ rule: 'html.duplicate-id', severity: 'error', waived: true },
			{ rule: 'html.bad-idref', severity: 'error' },
			{ rule: 'html.heading-level-skip', severity: 'warning', waived: true },
			{ rule: 'html.heading-level-skip', severity: 'warning' },
		];
		assert.deepEqual(
			effectiveFindings(findings).map((finding) => finding.rule),
			['html.bad-idref'],
		);
	});

	await t.test('effectiveFindings agrees with stats.errors', () => {
		const result = evaluateRoutes({
			manifest: singleRoute,
			observations: [
				{
					routeId: '/',
					path: '/',
					status: 200,
					html: waivedDocument,
					contentType: 'text/html',
					requestFailed: false,
				},
			],
			severities: severitiesFrom(singleRoute),
		});
		assert.equal(result.findings.filter((finding) => finding.waived).length, 3);
		assert.equal(result.stats.errors, 0);
		assert.equal(
			effectiveFindings(result.findings).length,
			result.stats.errors,
			'the exit-code view and the statistics must not disagree',
		);
	});

	await t.test('the live CLI exits 0 while the waivers are in force', async () => {
		// The reproduction command the verification note documents
		// (`--live <baseUrl>`) must exit 0 on a codebase whose defects are
		// all covered by the ledger. It used to count the waived findings
		// and print three PRE-EXISTING defects as FAIL.
		await withServer(waivedDocument, async (baseUrl) => {
			const covered = await runChecker([
				'--live',
				baseUrl,
				'--json',
				'--manifest',
				writeManifestFixture(singleRoute),
			]);
			assert.equal(covered.code, 0, covered.stdout + covered.stderr);
			const parsed = JSON.parse(covered.stdout);
			assert.equal(parsed.ok, true, covered.stdout);
			assert.equal(parsed.live.stats.errors, 0);
			assert.equal(parsed.live.findings.length, 3);
			assert.ok(parsed.live.findings.every((finding) => finding.waived === true));

			// The same document with no ledger at all must still fail, or the
			// assertion above would prove nothing.
			const uncovered = await runChecker([
				'--live',
				baseUrl,
				'--json',
				'--manifest',
				writeManifestFixture({ ...singleRoute, waivers: [] }),
			]);
			assert.equal(uncovered.code, 1);
			const parsedUncovered = JSON.parse(uncovered.stdout);
			assert.equal(parsedUncovered.ok, false);
			assert.equal(parsedUncovered.live.stats.errors, 3);
		});
	});
});

test('the offline CLI half — exit codes and fail-closed behaviour', async (t) => {
	await t.test('the shipped repository passes', () => {
		const run = spawnSync(process.execPath, [CHECKER], { cwd: REPO_ROOT, encoding: 'utf8' });
		assert.equal(run.status, 0, run.stdout + run.stderr);
		assert.match(run.stdout, /valid=0 error\(s\) \/ invalid=\d+ error\(s\)/);
	});

	await t.test('--json reports the fixtures, the inventory and the rules', () => {
		const run = spawnSync(process.execPath, [CHECKER, '--json'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		});
		assert.equal(run.status, 0);
		const parsed = JSON.parse(run.stdout);
		assert.equal(parsed.ok, true);
		assert.equal(parsed.offline.fixtures.length, 2);
		assert.ok(parsed.manifest.rules['duplicate-id']);
	});

	await t.test('an unusable manifest exits 2 rather than passing', () => {
		const run = spawnSync(process.execPath, [CHECKER, '--manifest', 'package.json'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		});
		assert.equal(run.status, 2);
		assert.match(run.stderr, /manifest is unusable/);
	});

	await t.test('a manifest whose roster lost a route exits 1', () => {
		const run = spawnSync(
			process.execPath,
			[CHECKER, '--manifest', 'quality/browser-baseline.json'],
			{
				cwd: REPO_ROOT,
				encoding: 'utf8',
			},
		);
		assert.equal(run.status, 2, 'a manifest of the wrong shape is unusable, not a pass');
	});
});

test('the manifest loader rejects placeholder policies', () => {
	const manifest = loadManifest(MANIFEST_PATH);
	assert.throws(
		() =>
			loadManifestFixture({
				...manifest,
				routes: [{ route_id: '/x', path: '/x', mode: 'excluded', reason: 'n/a' }],
			}),
		/reason/,
	);
	assert.throws(
		() => loadManifestFixture({ ...manifest, version: 2 }),
		/unsupported manifest version/,
	);
	assert.throws(() => loadManifest({}), ManifestError);

	// A manifest that dropped its fixture paths must be UNUSABLE (exit 2),
	// not a raw `TypeError` out of `runOfflineCheck`.
	const { fixtures: _dropped, ...withoutFixtures } = manifest;
	assert.throws(() => loadManifestFixture(withoutFixtures), /fixtures\.valid/);
	assert.throws(
		() =>
			loadManifestFixture({
				...manifest,
				fixtures: { ...manifest.fixtures, invalid: '   ' },
			}),
		/fixtures\.invalid/,
	);
});

/** Write a candidate manifest to a temp file and load it through the real loader. */
function loadManifestFixture(value) {
	return loadManifest(writeManifestFixture(value));
}

/** The same, but returns the path so the CLI can be pointed at it. */
function writeManifestFixture(value) {
	const dir = mkdtempSync(join(tmpdir(), 'html-standards-manifest-'));
	const path = join(dir, 'manifest.json');
	writeFileSync(path, JSON.stringify(value));
	return path;
}

/** Run the checker CLI asynchronously, so a loopback server can answer it. */
function runChecker(args) {
	return new Promise((settle) => {
		const child = spawn(process.execPath, [CHECKER, ...args], { cwd: REPO_ROOT });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('close', (code) => settle({ code, stdout, stderr }));
	});
}

/** Serve one document on loopback and run `body` against its origin. */
async function withServer(html, body) {
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		response.end(html);
	});
	await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
	try {
		return await body(`http://127.0.0.1:${server.address().port}`);
	} finally {
		await new Promise((closed) => server.close(closed));
	}
}
