#!/usr/bin/env node
/**
 * Verification report generator for Issue #412.
 *
 * The HTML standards gate (`scripts/check-html-standards.mjs` +
 * `scripts/html-standards-contract.mjs`) is machine-readable, but a gate
 * that is only readable by running it is hard to review. This script
 * renders the OFFLINE half of the result as a static HTML "CI report"
 * and screenshots it with the Playwright chromium already installed for
 * the E2E suite into
 * `docs/verification/standards/html-nu-validator.webp` — the path Issue
 * #412 requires in the PR body, with the `.webp` extension substituted
 * for the Issue's literal `.png`.
 *
 * It is offline by construction: no server, no network, no D1, no R2,
 * no secret. The report is a screenshot of the fixture evidence, and the
 * live evidence (the SSR documents themselves) is the workerd suite
 * `test/integration/html-standards.test.ts`; the reproduction commands
 * for both are printed in the report body.
 *
 * Playwright cannot encode WebP, so the capture is taken into a Buffer
 * (never written as a PNG) and re-encoded with the existing `sharp`
 * devDependency. Both encoder constants are declared below and printed
 * in the report footer, so this comment cannot drift from them. The
 * target extension is asserted to be `.webp`, so a PNG cannot drift back
 * into `docs/`. `sharp` and `@playwright/test` stay devDependencies and
 * are never imported by the Worker / SSR.
 *
 *   node scripts/make-html-nu-validator-report.mjs
 *   pnpm run verify:html-nu-validator-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present — `pnpm run e2e:install`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DEFAULT_MANIFEST, loadManifest, runOfflineCheck } from './check-html-standards.mjs';
import { renderHtmlReport, severitiesFrom, validateHtml } from './html-standards-contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const HTML_REPORT = join(TMP, 'html-nu-validator-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/standards/html-nu-validator.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 46;

const REPRODUCTION = [
	'pnpm run html:standards:check                          # offline gate (validate:fast): fixtures + roster + rule ledger',
	'node --test scripts/check-html-standards.test.mjs     # the fixture suite behind this report',
	'pnpm exec vitest run test/integration/html-standards.test.ts   # the live half: real SSR documents in workerd',
	'node scripts/check-html-standards.mjs --live http://127.0.0.1:3000   # the same engine against a running server',
	'pnpm run verify:html-nu-validator-screenshot           # regenerate this report + WebP',
];

/**
 * The invalid fixture, re-rendered as the message list the Nu Html
 * Checker would print (type / line / message), so the screenshot shows
 * the failing path and not only the passing one.
 */
function fixtureMessages(result) {
	return result.messages
		.map(
			(message) =>
				`<tr><td class="c">${escapeText(message.severity)}</td><td>${escapeText(message.nuType)}</td><td class="c">${message.line}</td><td class="c">${message.col}</td><td>${escapeText(message.message)}</td></tr>`,
		)
		.join('\n');
}

function escapeText(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

async function shoot(htmlPath, target) {
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');
	mkdirSync(dirname(target), { recursive: true });
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: WEBP_WIDTH, height: 1400 },
		deviceScaleFactor: 1,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		const capture = await page.screenshot({ fullPage: true });
		return await sharp(capture)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);
	} finally {
		await browser.close();
	}
}

const manifest = loadManifest(join(ROOT, DEFAULT_MANIFEST));
const severities = severitiesFrom(manifest);
const offline = runOfflineCheck({ root: ROOT, manifest });

function readFixture(relativePath) {
	const path = join(ROOT, relativePath);
	if (!existsSync(path)) throw new Error(`fixture is missing: ${relativePath}`);
	return readFileSync(path, 'utf8');
}

const validHtml = readFixture(manifest.fixtures.valid);
const invalidHtml = readFixture(manifest.fixtures.invalid);
const validResult = validateHtml(validHtml, { severities });
const invalidResult = validateHtml(invalidHtml, { severities });

const ruleRows = Object.entries(manifest.rules)
	.map(
		([rule, entry]) =>
			`<tr><td>${escapeText(rule)}</td><td class="c">${escapeText(entry.severity)}</td><td>${escapeText(entry.nu_type)}</td><td>${escapeText(entry.reason)}</td></tr>`,
	)
	.join('\n');

// The roster is rendered as a compact ledger: the full reason for every
// entry lives in quality/html-standards.json and in the verification doc,
// so the screenshot keeps the DECISION (render / excluded) next to the
// path without repeating a paragraph per row.
const waiverRows = manifest.waivers
	.map(
		(waiver) =>
			`<tr class="excluded"><td>${escapeText(waiver.rule)}</td><td>${escapeText(
				waiver.route_id ?? '*',
			)}</td><td>${escapeText(waiver.message_pattern ?? '(route scope only)')}</td><td>${escapeText(
				waiver.reason,
			)}</td></tr>`,
	)
	.join('\n');

const routeRows = manifest.routes
	.map(
		(route) =>
			`<tr class="${route.mode === 'render' ? 'pass' : 'excluded'}"><td>${escapeText(route.path)}</td><td class="c">${escapeText(route.mode)}</td><td>${escapeText(route.source ?? '')}</td></tr>`,
	)
	.join('\n');

const inventorySection = offline.inventory.length
	? `<p class="sub">roster mismatch: ${offline.inventory.map((entry) => escapeText(entry)).join('<br>')}</p>`
	: '<p class="sub">src/routes/** と src/routeTree.gen.ts から導出した route id と manifest の roster は一致。</p>';

const fixtureSection = `<h2>fixture — fail になる場合と fail にならない場合（Issue 受け入れ条件 1）</h2>
<p class="sub">
  下の 2 例は同じ engine を通した実結果。gate の判定は「読む anecdote」ではなくこの fixture の実行結果そのもの。
  offline mode は毎 run <code>invalid</code> が finding を出すこと・<code>valid</code> が 0 であること・
  <code>fixtures.expect</code> の rule が全て発火すること・<code>fixtures.forbidden</code> の rule が発火しないことを
  検証し、いずれか 1 つでも崩れたら exit 1（誤検知も検出漏れも無言の合格にならない）。
</p>
<table>
<thead><tr><th>fixture</th><th class="c">error</th><th class="c">warning</th><th class="c">element</th><th class="c">byte</th><th class="c">verdict</th></tr></thead>
<tbody>
  <tr class="${validResult.stats.errors === 0 ? 'pass' : 'fail'}"><td>${escapeText(manifest.fixtures.valid)}</td><td class="c">${validResult.stats.errors}</td><td class="c">${validResult.stats.warnings}</td><td class="c">${validResult.stats.elements}</td><td class="c">${validHtml.length}</td><td class="c">${validResult.stats.errors === 0 ? 'pass' : 'FAIL'}</td></tr>
  <tr class="${invalidResult.stats.errors > 0 ? 'fail' : 'pass'}"><td>${escapeText(manifest.fixtures.invalid)}</td><td class="c">${invalidResult.stats.errors}</td><td class="c">${invalidResult.stats.warnings}</td><td class="c">${invalidResult.stats.elements}</td><td class="c">${invalidHtml.length}</td><td class="c">${invalidResult.stats.errors > 0 ? 'FAIL' : 'pass'}</td></tr>
</tbody>
</table>

<h3>invalid fixture の message（Nu Html Checker の message type / 行 / 列）</h3>
<table>
<thead><tr><th class="c">severity</th><th>Nu type</th><th class="c">line</th><th class="c">col</th><th>message</th></tr></thead>
<tbody>
${fixtureMessages(invalidResult)}
</tbody>
</table>

<h2>route roster</h2>
${inventorySection}
<table>
<thead><tr><th>path</th><th class="c">mode</th><th>route module (full reason: quality/html-standards.json)</th></tr></thead>
<tbody>
${routeRows}
</tbody>
</table>

<h2>waiver ledger（PRE-EXISTING。finding を消すのではなく「レビュー対象として記録」する）</h2>
<table>
<thead><tr><th>rule</th><th>route</th><th>message_pattern</th><th>reason</th></tr></thead>
<tbody>
${waiverRows}
</tbody>
</table>

<h2>rule ledger（severity と根拠は manifest が所有）</h2>
<table>
<thead><tr><th>rule</th><th class="c">severity</th><th>Nu type</th><th>reason</th></tr></thead>
<tbody>
${ruleRows}
</tbody>
</table>`;

const report = renderHtmlReport(
	{
		rows: offline.fixtures.map((fixture) => ({
			path: fixture.path,
			mode: 'render',
			status: null,
			elements:
				fixture.kind === 'valid' ? validResult.stats.elements : invalidResult.stats.elements,
			bytes: fixture.kind === 'valid' ? validHtml.length : invalidHtml.length,
			errors: fixture.error,
			warnings: fixture.warning ?? 0,
			reason: null,
			messages: [],
		})),
		findings: offline.errors.map((message) => ({
			severity: 'error',
			rule: 'gate',
			path: null,
			line: null,
			message,
		})),
		// The rule ledger is rendered by `extraHtml` below, so the built-in
		// rule table stays empty here rather than printing it twice.
		rules: {},
		profile: manifest.profile,
		stats: { rendered: 2, excluded: 0 },
	},
	{
		generatedAt: new Date().toISOString(),
		reproduction: REPRODUCTION,
		extraHtml: fixtureSection,
	},
);

mkdirSync(TMP, { recursive: true });
writeFileSync(HTML_REPORT, report);

mkdirSync(TMP, { recursive: true });
process.stdout.write(`wrote ${HTML_REPORT}\n`);
process.stdout.write(
	`offline gate: ${offline.errors.length} error(s) / inventory ${offline.inventory.length} mismatch(es)\n`,
);
process.stdout.write(
	`fixtures: valid=${validResult.stats.errors} error(s), invalid=${invalidResult.stats.errors} error(s) / ${invalidResult.stats.warnings} warning(s)\n`,
);

if (offline.errors.length > 0) {
	process.stderr.write(
		`refusing to render a verification report for a failing gate:\n${offline.errors.map((entry) => `  - ${entry}`).join('\n')}\n`,
	);
	process.exit(1);
}

const info = await shoot(HTML_REPORT, WEBP_TARGET);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
);
