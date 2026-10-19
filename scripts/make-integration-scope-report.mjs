#!/usr/bin/env node

/**
 * Verification report + screenshot generator for Issue #464.
 *
 * Renders the connection scope / retention ledger as a static HTML page
 * at `.tmp/integration-scope-review.html` and screenshots it with the
 * Playwright chromium already installed for the E2E suite into
 * `docs/verification/security/integration-scope-review.webp` — the
 * path Issue #464 names in the PR body, with the `.webp` extension
 * substituted for the Issue's literal `.png` (Playwright cannot encode
 * WebP, so the capture is re-encoded from memory with the existing
 * `sharp` devDependency and no intermediate PNG is committed).
 *
 * The page is rendered from the working tree only: no Worker, no
 * network, no D1/R2, no secret, no clock read. The verdicts in the
 * connection table are the ones `scripts/check-integration-scope.mjs`
 * just measured by running `reviewConnection()` from
 * `src/http/integrations/scope-review.ts`, so the image cannot claim a
 * verdict the adapter does not produce.
 *
 * The image is evidence, not the test: `node --test
 * scripts/check-integration-scope.test.mjs` and
 * `pnpm run integration:scope:check` are the authority.
 *
 *   node scripts/make-integration-scope-report.mjs
 *   pnpm run verify:integration-scope-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	PROBE_FIXTURES,
	checkIntegrationScope,
	evaluateFixture,
} from './check-integration-scope.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_REPORT = join(ROOT, '.tmp/integration-scope-review.html');
const TARGET = join(ROOT, 'docs/verification/security/integration-scope-review.webp');
const WEBP_WIDTH = 1600;
/**
 * The page is text-dense, so it is encoded near-lossless first: lossy
 * WebP keeps the byte count down only by smearing the rows a reviewer
 * has to read. The ladder starts at the sharpest step that fits the
 * budget and steps down; grayscale is the last resort, not the plan.
 */
const WEBP_QUALITY_LADDER = [
	{ quality: 80, nearLossless: true, grayscale: false },
	{ quality: 70, nearLossless: true, grayscale: false },
	{ quality: 60, nearLossless: true, grayscale: false },
	{ quality: 50, nearLossless: true, grayscale: false },
	{ quality: 40, nearLossless: true, grayscale: false },
	{ quality: 30, nearLossless: true, grayscale: false },
	{ quality: 48, nearLossless: false, grayscale: true },
	{ quality: 40, nearLossless: false, grayscale: true },
	{ quality: 32, nearLossless: false, grayscale: true },
];
const WEBP_MAX_BYTES = 300 * 1024;

function headSha() {
	return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
		cwd: ROOT,
		encoding: 'utf8',
	}).trim();
}

const escapeHtml = (value) =>
	String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');

/** Scope lists are data; render each name as its own code cell. */
function scopes(values) {
	if (!Array.isArray(values) || values.length === 0) return '<span class="muted">—</span>';
	return values.map((scope) => `<code>${escapeHtml(scope)}</code>`).join(' ');
}

function toneFor(verdict) {
	if (verdict === 'approved') return 'ok';
	if (verdict === 'reauth_required') return 'reauth';
	return 'refuse';
}

function renderCandidates(rows) {
	return rows
		.map((row) => {
			if (row.review === 'deferred') {
				return `<tr class="deferred">
					<td><code>${escapeHtml(row.id)}</code></td>
					<td>${escapeHtml(row.service)}</td>
					<td>${escapeHtml(row.status)}</td>
					<td colspan="6" class="wrap">${escapeHtml(row.deferred_reason)}</td>
				</tr>`;
			}
			return `<tr>
				<td><code>${escapeHtml(row.id)}</code></td>
				<td>${escapeHtml(row.service)}</td>
				<td>${escapeHtml(row.status)}</td>
				<td><code>${escapeHtml(row.grant)}</code></td>
				<td>${scopes(row.least_privilege.required_scopes)}</td>
				<td>${scopes(row.least_privilege.optional_scopes)}</td>
				<td>${scopes(row.least_privilege.denied_scopes)}</td>
				<td class="num">${escapeHtml(row.token_retention.max_age_days)}d</td>
				<td>${escapeHtml(row.revocation.deadline_hours)}h</td>
			</tr>`;
		})
		.join('\n\t\t');
}

function renderConnections(rows) {
	return rows
		.map((row) => {
			const retention =
				row.ageDays === null || row.ageDays === undefined
					? '<span class="muted">—</span>'
					: `${row.ageDays}d / ${row.retentionDays}d`;
			// `unknown_integration` has no requirement, so the granted
			// scopes are not "unapproved" — nothing reviewed them. Calling
			// them unapproved would put a scope verdict on a row whose whole
			// point is that no scope review exists.
			const detail =
				row.verdict === 'unknown_integration'
					? 'no reviewed requirement for this candidate'
					: row.unapproved.length > 0
						? `unapproved: ${row.unapproved.join(', ')}`
						: row.missing.length > 0
							? `missing: ${row.missing.join(', ')}`
							: row.reauth.length > 0
								? `re-authorize: ${row.reauth.join(', ')}`
								: 'least privilege satisfied';
			return `<tr class="${toneFor(row.verdict)}">
				<td><code>${escapeHtml(row.id)}</code></td>
				<td>${escapeHtml(row.integration)}</td>
				<td>${scopes(row.granted.split(', ').filter(Boolean))}</td>
				<td class="wrap">${escapeHtml(row.scenario)}</td>
				<td class="num">${retention}</td>
				<td><strong>${escapeHtml(row.verdict)}</strong><br /><code>${escapeHtml(row.code)}</code></td>
				<td class="wrap">${escapeHtml(detail)}</td>
			</tr>`;
		})
		.join('\n\t\t');
}

function renderProbes(probes) {
	return probes
		.map((probe) => {
			const failed = probe.verdict !== 'pass';
			const shown = probe.errors.slice(0, 2);
			return `<tr class="${failed ? 'refuse' : 'ok'}">
				<td><code>${escapeHtml(probe.file)}</code></td>
				<td>${probe.expectError === null ? '<span class="muted">no error at all</span>' : `<code>${escapeHtml(probe.expectError)}</code>`}</td>
				<td class="wrap">${escapeHtml(probe.note)}</td>
				<td>${failed ? 'FAIL' : `${probe.errors.length} error(s), as expected`}</td>
			</tr>`;
		})
		.join('\n\t\t');
}

/**
 * The whole page, as a pure function of the gate's result — so the
 * test asserts on the same HTML the screenshot is taken from.
 */
export function renderIntegrationScopeReport({ result, probes, sourceSha }) {
	const { rows, connections, manifest, summary } = result;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Integration scope / retention review — Issue #464</title>
<style>
  :root { color-scheme: light; }
  body { font: 13px/1.5 ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
         margin: 0; padding: 28px; background: #ffffff; color: #111111; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 22px 0 6px; }
  p.lede { margin: 0 0 14px; color: #333333; max-width: 118ch; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; table-layout: fixed; }
  caption { text-align: left; padding-bottom: 6px; color: #444444; }
  th, td { border-bottom: 1px solid #d8d8d8; padding: 5px 8px; text-align: left; vertical-align: top;
           overflow-wrap: anywhere; }
  th { background: #f4f4f4; font-weight: 600; }
  td.num { text-align: right; white-space: nowrap; }
  td.wrap { white-space: normal; }
  code { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #f2f2f2;
         padding: 1px 4px; border-radius: 3px; }
  tr.ok td:nth-child(6) strong, tr.ok td:last-child { color: #0a6b2d; }
  tr.reauth td:nth-child(6) strong { color: #6b3c00; }
  tr.refuse td:nth-child(6) strong, tr.refuse td:last-child { color: #a11212; }
  tr.deferred { background: #fbfbfb; }
  .muted { color: #888888; }
  .summary { display: flex; gap: 18px; flex-wrap: wrap; margin: 10px 0 0; padding: 10px 12px;
             border: 1px solid #d8d8d8; }
  .summary div { min-width: 150px; }
  .summary strong { display: block; font-size: 18px; }
  footer { margin-top: 18px; color: #555555; font-size: 11px; }
</style>
</head>
<body>
  <h1>Integration scope / retention review — Issue #464</h1>
  <p class="lede">Scope NAMES, retention and revocation only. No token value, no account address, no
  bucket or key listing is read, rendered or stored by this report. The verdicts below are
  <em>measured</em>: <code>scripts/check-integration-scope.mjs</code> ran every connection through
  <code>reviewConnection()</code> (<code>src/http/integrations/scope-review.ts</code>), the same
  function the Vitest suite asserts on, against the ledger <code>quality/integration-scope.json</code>.</p>

  <div class="summary">
    <div><strong>${summary.candidates}</strong>candidates reviewed</div>
    <div><strong>${summary.approved}</strong>approved connection(s)</div>
    <div><strong>${summary.refused}</strong>refused connection(s)</div>
    <div><strong>${summary.allowlisted}</strong>owner allowlist entries</div>
    <div><strong>${summary.mounts}</strong>mounted <code>/integrations/*</code> routes</div>
  </div>

  <h2>1. What each candidate may hold, and how a token is taken back</h2>
  <table>
    <caption><code>quality/integration-scope.json</code> — the ledger is the source of truth; the roster
    comes from <code>docs/domain/integrations.md</code> and a candidate that appears in one and not the
    other fails the gate.</caption>
    <thead><tr>
      <th style="width:8%">id</th><th style="width:9%">service</th><th style="width:10%">status</th>
      <th style="width:13%">grant</th><th style="width:14%">required</th><th style="width:11%">optional</th>
      <th style="width:20%">never accepted</th><th style="width:8%">retention</th><th style="width:7%">revoke</th>
    </tr></thead>
    <tbody>
		${renderCandidates(rows)}
    </tbody>
  </table>

  <h2>2. Reviewed connections, executed against the adapter (as of ${escapeHtml(manifest.as_of)})</h2>
  <table>
    <caption>Local fixtures only: scope names and frozen timestamps. No provider was contacted, and a
    fixture that carries a token value is refused by the gate before a row is rendered.</caption>
    <thead><tr>
      <th style="width:16%">connection</th><th style="width:8%">candidate</th><th style="width:15%">granted scopes</th>
      <th style="width:24%">scenario</th><th style="width:11%">age / ceiling</th>
      <th style="width:14%">verdict</th><th style="width:12%">what was wrong</th>
    </tr></thead>
    <tbody>
		${renderConnections(connections)}
    </tbody>
  </table>

  <h2>3. False-green probes (${probes.filter((probe) => probe.verdict === 'pass').length}/${probes.length} refused as intended)</h2>
  <table>
    <caption>Each probe is a patch applied to the shipped ledger, so it cannot drift from the repository
    it is supposed to break.</caption>
    <thead><tr>
      <th style="width:20%">probe</th><th style="width:20%">expected refusal</th>
      <th style="width:46%">what it proves</th><th style="width:14%">result</th>
    </tr></thead>
    <tbody>
		${renderProbes(probes)}
    </tbody>
  </table>

  <footer>
    Regenerate with <code>pnpm run verify:integration-scope-screenshot</code>; the verdict comes from
    <code>pnpm run integration:scope:check</code>, the contract from
    <code>docs/security/integration-token-scope.md</code>. Ledger evaluated at
    <code>${escapeHtml(manifest.as_of)}</code> from source <code>${escapeHtml(sourceSha)}</code>.
  </footer>
</body>
</html>
`;
}

async function shoot(page, target) {
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
	const { default: sharp } = await import('sharp');
	mkdirSync(dirname(target), { recursive: true });
	const capture = await page.screenshot({ fullPage: true });

	for (const step of WEBP_QUALITY_LADDER) {
		let pipeline = sharp(capture).resize({ width: WEBP_WIDTH, withoutEnlargement: true });
		if (step.grayscale) pipeline = pipeline.grayscale();
		const buffer = await pipeline
			.webp({ quality: step.quality, nearLossless: step.nearLossless, effort: 6 })
			.toBuffer();
		if (buffer.length <= WEBP_MAX_BYTES) {
			const info = await sharp(buffer).metadata();
			writeFileSync(target, buffer);
			return {
				target,
				width: info.width,
				height: info.height,
				bytes: buffer.length,
				quality: step.quality,
				nearLossless: step.nearLossless,
				grayscale: step.grayscale,
			};
		}
	}
	throw new Error(
		`${target} does not fit in ${Math.round(WEBP_MAX_BYTES / 1024)} KB of WebP at width ${WEBP_WIDTH} — narrow the report instead of committing a heavier image`,
	);
}

async function captureAll(htmlPath) {
	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 1280, height: 1200 },
		deviceScaleFactor: 1,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		return await shoot(page, TARGET);
	} finally {
		await browser.close();
	}
}

/**
 * The whole run: evaluate the ledger, render the page, shoot the
 * artefact. Guarded so the renderer can be imported (and unit-tested)
 * without starting chromium.
 */
async function main() {
	const result = checkIntegrationScope({ root: ROOT });
	if (result.errors.length > 0) {
		process.stderr.write(
			`refusing to render a report for a failing ledger: ${result.errors.length} problem(s)\n`,
		);
		for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
		return 1;
	}

	const probes = PROBE_FIXTURES.map((file) => evaluateFixture(ROOT, file));
	if (probes.some((probe) => probe.verdict !== 'pass')) {
		process.stderr.write('refusing to render a report whose false-green probes do not fail\n');
		return 1;
	}

	mkdirSync(dirname(HTML_REPORT), { recursive: true });
	writeFileSync(
		HTML_REPORT,
		renderIntegrationScopeReport({ result, probes, sourceSha: headSha() }),
	);
	process.stdout.write(`wrote ${HTML_REPORT}\n`);

	const shot = await captureAll(HTML_REPORT);
	process.stdout.write(
		`wrote ${shot.target.replace(`${ROOT}/`, '')} (webp ${shot.width}x${shot.height}, ${statSync(shot.target).size} B, quality ${shot.quality}${shot.nearLossless ? ' nearLossless' : ' lossy'}${shot.grayscale ? ' grayscale' : ''})\n`,
	);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(await main());
}
