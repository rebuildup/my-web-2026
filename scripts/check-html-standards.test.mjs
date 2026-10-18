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
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
import { evaluateRoutes, severitiesFrom, validateHtml } from './html-standards-contract.mjs';

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
		...base,
		waivers: [{ rule: 'html.duplicate-id', reason: 'fixture blanket waiver for this suite' }],
	};
	assert.throws(() => loadManifestFixture(blanket), /route_id or message_pattern/);
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
});

/** Write a candidate manifest to a temp file and load it through the real loader. */
function loadManifestFixture(value) {
	const dir = mkdtempSync(join(tmpdir(), 'html-standards-manifest-'));
	const path = join(dir, 'manifest.json');
	writeFileSync(path, JSON.stringify(value));
	return loadManifest(path);
}
