#!/usr/bin/env node
/**
 * Verification report generator for the Actions pin / permission gate
 * (Issue #472).
 *
 *   node scripts/workflow-pin-report.mjs
 *
 * Writes the screenshots the Issue asks for under
 * `docs/verification/supply-chain/`:
 *
 *   - `actions-pin-check.png`          the audit of the shipped
 *                                       workflows (normal observation)
 *   - `actions-pin-check-fixture-fail.png`
 *                                       the same gate pointed at the
 *                                       committed abnormal fixture
 *                                       (abnormal observation)
 *
 * Both images are rendered from the SAME function the CI gate uses
 * (`auditWorkflows`), so a screenshot cannot claim a pin the gate does
 * not accept. The report contains names, SHAs, permission scopes and
 * rule ids only: nothing secret is read, printed or captured, and no
 * network or production host is contacted. The page is served from
 * loopback only.
 *
 * This is a documentation tool, not a gate: it never runs inside
 * `validate:*`. Re-run it whenever a workflow, the pin manifest or the
 * gate rules change, and commit the regenerated PNGs in the same
 * change.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
	RULES,
	auditWorkflows,
	parseManifest,
	renderTextReport,
} from './check-workflow-pinning.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(root, 'docs/verification/supply-chain');
const PORT = 4602;

const realAudit = auditWorkflows({
	workflowsDir: resolve(root, '.github/workflows'),
	manifest: parseManifest(readFileSync(resolve(root, 'quality/actions-pins.json'), 'utf8')),
	manifestSource: 'quality/actions-pins.json',
});

const fixtureDir = resolve(root, 'quality/fixtures/actions-pinning');
const fixtureAudit = auditWorkflows({
	workflowsDir: fixtureDir,
	manifest: parseManifest(readFileSync(resolve(fixtureDir, 'manifest.json'), 'utf8')),
	manifestSource: 'quality/fixtures/actions-pinning/manifest.json',
});

const rel = (file) => file.replace(`${root}/`, '');
const escapeHtml = (value) =>
	String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function pinTable(audit) {
	const rows = audit.pins
		.map(
			(pin) => `<tr>
				<td>${escapeHtml(rel(pin.file))}</td>
				<td>${escapeHtml(pin.job)}</td>
				<td>${escapeHtml(pin.repo)}</td>
				<td class="ok">${escapeHtml(pin.ref)}</td>
				<td>${escapeHtml(pin.sha)}</td>
			</tr>`,
		)
		.join('');
	return `<table>
			<thead><tr><th>workflow</th><th>job</th><th>action</th><th>upstream ref</th><th>pinned commit sha</th></tr></thead>
			<tbody>${rows}</tbody>
		</table>`;
}

function permissionTable(audit) {
	const rows = audit.workflows
		.flatMap((workflow) =>
			workflow.jobs.map((job) => {
				const effective = job.permissions ?? workflow.permissions;
				const text =
					effective === null
						? '(none declared)'
						: effective.mode === 'map'
							? effective.scopes.map((s) => `${s.scope}=${s.level}`).join(' ')
							: effective.mode;
				const leaked = /write/.test(text);
				return `<tr>
					<td>${escapeHtml(`${rel(workflow.file)} › ${job.name}`)}</td>
					<td class="${leaked ? 'no' : 'ok'}">${escapeHtml(text)}</td>
				</tr>`;
			}),
		)
		.join('');
	return `<table>
			<thead><tr><th>job</th><th>effective GITHUB_TOKEN permissions</th></tr></thead>
			<tbody>${rows}</tbody>
		</table>`;
}

function findingsList(audit) {
	if (audit.findings.length === 0) return '<p class="muted">findings: 0</p>';
	const items = audit.findings
		.map(
			(finding) => `<li>
				<code>${escapeHtml(rel(finding.file))}:${finding.line}</code>
				<span class="tag">${escapeHtml(finding.rule)}</span>
				${escapeHtml(finding.message)}
				<span class="muted">— ${escapeHtml(RULES[finding.rule] ?? '')}</span>
			</li>`,
		)
		.join('');
	return `<p>findings: ${audit.findings.length}</p><ul class="findings">${items}</ul>`;
}

function section({ id, title, subtitle, audit, showTables }) {
	const badge = audit.summary.status === 'PASS' ? 'PASS' : 'FAIL';
	return `<section id="${id}">
		<h2>${escapeHtml(title)} <span class="badge ${badge.toLowerCase()}">${badge}</span></h2>
		<p class="muted">${escapeHtml(subtitle)}</p>
		${showTables ? pinTable(audit) : ''}
		${showTables ? permissionTable(audit) : ''}
		${findingsList(audit)}
		<pre>${escapeHtml(renderTextReport(audit).split('\n').slice(-1)[0])}</pre>
	</section>`;
}

function page() {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Actions pin / permission audit</title>
<style>
	:root { color-scheme: light; }
	body { margin: 0; padding: 28px 32px; background: #fbfbfa; color: #16150f;
		font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
	h1 { font-size: 19px; margin: 0 0 4px; }
	h2 { font-size: 15px; margin: 0 0 2px; }
	p { margin: 2px 0 10px; }
	.muted { color: #5d5b52; }
	section { margin-top: 22px; padding-top: 14px; border-top: 1px solid #dcd9d0; }
	table { border-collapse: collapse; margin: 8px 0 12px; font-size: 12px; }
	th, td { border: 1px solid #dcd9d0; padding: 3px 8px; text-align: left; vertical-align: top; }
	th { background: #f0eee7; font-weight: 600; }
	.ok { color: #0a6b3d; }
	.no { color: #9b1c1c; font-weight: 600; }
	.badge { display: inline-block; padding: 1px 8px; border-radius: 3px; color: #fff; font-size: 11px; }
	.badge.pass { background: #0a6b3d; }
	.badge.fail { background: #9b1c1c; }
	.tag { display: inline-block; margin: 0 6px; padding: 0 5px; border-radius: 3px;
		background: #ecebe4; border: 1px solid #dcd9d0; font-size: 11px; }
	ul.findings { margin: 6px 0 12px; padding-left: 18px; }
	ul.findings li { margin-bottom: 3px; }
	pre { background: #16150f; color: #f2f1e7; padding: 8px 10px; border-radius: 4px;
		overflow-x: auto; font-size: 12px; }
	footer { margin-top: 24px; color: #5d5b52; font-size: 12px; }
	code { background: #ecebe4; padding: 0 3px; border-radius: 3px; }
</style></head>
<body>
	<h1>GitHub Actions supply-chain audit — normal and abnormal observation</h1>
	<p class="muted">my-web-2026 · Issue #472 · generated by <code>node scripts/workflow-pin-report.mjs</code></p>
	${section({
		id: 'normal',
		title: 'Shipped workflows — normal observation',
		subtitle:
			'.github/workflows/*.yml against quality/actions-pins.json. This is exactly what `pnpm run ci:pins:check` runs inside validate:fast.',
		audit: realAudit,
		showTables: true,
	})}
	${section({
		id: 'abnormal',
		title: 'Committed abnormal fixture — the gate failing',
		subtitle:
			'quality/fixtures/actions-pinning/ — a workflow that was never pinned. Never executed; the finding list below is the repair table in docs/security/supply-chain-actions-pinning.md §8.',
		audit: fixtureAudit,
		showTables: false,
	})}
	<footer>
		Reproduce: <code>pnpm run ci:pins:check</code> ·
		<code>pnpm run ci:pins:check --manifest=quality/fixtures/actions-pinning/manifest.json --workflows-dir=quality/fixtures/actions-pinning</code><br>
		Rules and update procedure: docs/security/supply-chain-actions-pinning.md — status-only output, no secret value is read or rendered.
	</footer>
</body></html>`;
}

const html = page();
const server = createServer((_req, res) => {
	res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
	res.end(html);
});
await new Promise((resolveListen) => server.listen(PORT, '127.0.0.1', resolveListen));

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
	const pageHandle = await browser.newPage({
		viewport: { width: 1240, height: 900 },
		deviceScaleFactor: 2,
	});
	await pageHandle.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
	await pageHandle.screenshot({
		path: resolve(OUT_DIR, 'actions-pin-check.png'),
		fullPage: true,
	});

	// The abnormal half on its own, for the "the gate must be seen
	// failing" evidence in the doc and the PR. An element screenshot
	// rather than a viewport one, so the image is exactly the section.
	await pageHandle.locator('#abnormal').screenshot({
		path: resolve(OUT_DIR, 'actions-pin-check-fixture-fail.png'),
	});
	// Status-only self-check that the rendered page is not blank: what
	// the browser actually painted, not what the generator intended to
	// paint. A blank PNG would otherwise look like a passing check.
	const painted = (await pageHandle.locator('body').innerText()).trim();
	if (
		!painted.includes(realAudit.summary.status) ||
		!painted.includes(fixtureAudit.summary.status)
	) {
		throw new Error(`rendered report is missing its verdict lines:\n${painted.slice(0, 400)}`);
	}
	await pageHandle.close();
	writeFileSync(
		resolve(OUT_DIR, 'audit.json'),
		`${JSON.stringify({ real: realAudit.summary, fixture: fixtureAudit.summary }, null, '\t')}\n`,
	);
} finally {
	await browser.close();
	server.close();
}

const summarise = (audit) =>
	`${audit.summary.status} ${audit.summary.findings} findings / ${audit.summary.pins} pins`;
console.log(
	`[workflow-pin-report] wrote docs/verification/supply-chain/actions-pin-check.png and actions-pin-check-fixture-fail.png (real: ${summarise(realAudit)}, fixture: ${summarise(fixtureAudit)})`,
);
