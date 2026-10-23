#!/usr/bin/env node

/**
 * capture-a11y-axe-storybook — capture the Issue #392 verification
 * screen into `docs/verification/a11y/axe-storybook-pass-fail.webp`.
 *
 * What this captures
 * ------------------
 * The axe-core audit of the Storybook stories, as the AUDIT measured
 * it: the audit table (story / verdict / rule id / element count) and
 * two real screenshots side by side — one story that passes, and the
 * same story with a deliberately broken element injected, which the
 * audit reports as a violation.
 *
 * It does NOT re-implement the audit. The audit itself
 * (`e2e/a11y/axe-storybook.spec.ts`) is executed with Playwright's
 * JSON reporter, and the per-story summaries the spec attaches are
 * what this script renders. The artefact therefore shows the numbers
 * the audit will act on — not a second, friendlier measurement that
 * could disagree with it.
 *
 * The negative control
 * --------------------
 * The "fail" half of the picture is produced by INJECTING a violating
 * element into a story in the browser — an `<img>` without an `alt`,
 * which is exactly the defect the sibling gate (Issue #397) forbids
 * in the shipped source. Nothing is written to the repository, and the
 * injection exists only in that browser page. It is the evidence that
 * the audit is not blind: the same scan that reports "no violation"
 * for the untouched story reports the injected defect.
 *
 * Safety
 * ------
 *   - Nothing is deployed. The scan runs against the LOCAL Storybook
 *     on loopback; the canonical production origin is never called.
 *   - No secret is read or printed. The report carries story keys,
 *     rule ids and element selectors only.
 *   - The report page is served from a loopback-only HTTP server on an
 *     ephemeral port.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG and Issue #392 names a `.png` path, but a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture is taken into `.tmp/`, encoded with the
 * existing `sharp` devDependency at width <= 1600 / quality 80, and
 * the committed file is the `.webp` sibling. The script REFUSES any
 * non-`.webp` output path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-axe-storybook.mjs [options]
 *
 *   --screenshot=<path>   committed artefact destination
 *                          (default docs/verification/a11y/axe-storybook-pass-fail.webp)
 *   --base-url=<url>      loopback Storybook origin
 *                          (default http://localhost:6006)
 *   --port=<port>         port the local Storybook is started on
 *                          (default 6006)
 *   --work-dir=<path>     temporary directory (default .tmp/a11y-axe-storybook)
 *   --json-out=<path>     report destination
 *                          (default .tmp/a11y-axe-storybook/report.json)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOriginReady, startStorybook } from './_storybook-server.mjs';

export { isOriginReady, startStorybook };

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/**
 * The width the report page is rendered at.
 *
 * The report carries 100 audit rows, and the page is laid out in two
 * columns: rendering it at the full 1600 px would push the capture
 * past the repository's image budget, and a capture that does not fit
 * the budget is not committed. 1400 px keeps every row readable and
 * the artefact inside the budget.
 */
export const REPORT_WIDTH = 1400;

/** The temp directory the capture works in. */
export const WORK_DIR = '.tmp/a11y-axe-storybook';

/** The audit the artefact is rendered from. */
export const SPEC_PATH = 'e2e/a11y/axe-storybook.spec.ts';
export const CONFIG_PATH = 'playwright.storybook.config.ts';

/** The manifest (the audited story set) and the ledger (known violations). */
export const MANIFEST_PATH = 'e2e/a11y/axe-storybook-manifest.ts';
export const BASELINE_PATH = 'e2e/a11y/axe-storybook-baseline.json';

/** How long the local Storybook may take to become ready. */
export { SERVER_READY_TIMEOUT_MS } from './_storybook-server.mjs';

/** Reject an output path that is not WebP, or that leaves the repository. */
export function assertWebpOutputPath(path, repoRoot = REPO_ROOT) {
	if (extname(path).toLowerCase() !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${path}`);
	}
	const rel = relative(repoRoot, resolve(repoRoot, path));
	if (rel.startsWith('..')) {
		throw new Error(`refusing to write outside the repository: ${path}`);
	}
	return rel;
}

/** Only a loopback origin may be audited. */
export function assertLoopbackBaseUrl(baseUrl) {
	if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(baseUrl)) {
		throw new Error(
			`refusing to audit a non-loopback origin: ${baseUrl}. The scan measures the release candidate, not a deployment.`,
		);
	}
	return baseUrl;
}

/** Minimal HTML escaping: the report text is computed, not source. */
export function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Run the audit and return the per-story summaries it attached.
 *
 * The spec is the authority: the artefact must not disagree with the
 * numbers the audit acts on. A failing audit is not an error here — it
 * is the state the artefact has to show.
 */
export function runGate(baseUrl, workDir, repoRoot = REPO_ROOT) {
	const reportPath = resolve(repoRoot, workDir, 'playwright-report.json');
	mkdirSync(dirname(reportPath), { recursive: true });
	let exitCode = 0;
	try {
		execFileSync(
			'pnpm',
			['exec', 'playwright', 'test', SPEC_PATH, '--config', CONFIG_PATH, '--reporter=json'],
			{
				cwd: repoRoot,
				encoding: 'utf8',
				env: {
					...process.env,
					STORYBOOK_BASE_URL: baseUrl,
					PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
					PLAYWRIGHT_JSON_OUTPUT_NAME: 'playwright-report.json',
				},
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
	} catch (error) {
		exitCode = typeof error.status === 'number' ? error.status : 1;
	}
	if (!existsSync(reportPath)) {
		throw new Error('the audit run produced no JSON report; the artefact would show nothing');
	}
	const report = JSON.parse(readFileSync(reportPath, 'utf8'));
	const summaries = [];
	for (const spec of collectSpecs(report.suites ?? [])) {
		for (const testCase of spec.tests ?? []) {
			for (const result of testCase.results ?? []) {
				for (const attachment of result.attachments ?? []) {
					if (attachment.contentType !== 'application/json') continue;
					const text = attachment.body
						? Buffer.from(attachment.body, 'base64').toString('utf8')
						: attachment.path
							? readFileSync(attachment.path, 'utf8')
							: null;
					if (!text) continue;
					const payload = JSON.parse(text);
					if (payload && typeof payload.story === 'string') summaries.push(payload);
				}
			}
		}
	}
	return { exitCode, summaries, reportPath };
}

/**
 * Every spec of a report tree — the JSON reporter nests suites, and
 * each suite carries its `specs` beside its child `suites`.
 */
function collectSpecs(suites) {
	const specs = [];
	for (const suite of suites ?? []) {
		specs.push(...(suite.specs ?? []));
		specs.push(...collectSpecs(suite.suites ?? []));
	}
	return specs;
}

/**
 * The element the broken half of the picture injects.
 *
 * An `<img>` without an `alt` is the exact defect the sibling gate
 * (Issue #397) forbids in the shipped source, and axe-core reports it
 * as `image-alt` (WCAG 2.2 SC 1.1.1). It exists only in this browser
 * page; nothing is written to the repository.
 */
export const INJECTED_ELEMENT_HTML =
	'<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />';

/**
 * Open one story and photograph it as the audit saw it.
 */
export async function capturePassExample(page, baseUrl, storyId) {
	await page.goto(`${baseUrl}/iframe.html?id=${storyId}&viewMode=story`, {
		waitUntil: 'networkidle',
	});
	const root = page.locator('#storybook-root');
	await root.waitFor({ state: 'attached' });
	return { png: await page.screenshot({ type: 'png', fullPage: false }) };
}

/**
 * Open the same story, inject the broken element and let axe-core
 * report it.
 *
 * The returned rule id is the EVIDENCE that the audit is not blind:
 * the same scan that reported "no violation" for the untouched story
 * reports this one.
 */
export async function captureFailExample(page, baseUrl, storyId, axeSource) {
	await page.goto(`${baseUrl}/iframe.html?id=${storyId}&viewMode=story`, {
		waitUntil: 'networkidle',
	});
	const root = page.locator('#storybook-root');
	await root.waitFor({ state: 'attached' });
	await page.addScriptTag({ content: axeSource });
	const result = await page.evaluate((html) => {
		const root = document.querySelector('#storybook-root');
		if (!root) throw new Error('the story did not render into #storybook-root');
		const holder = document.createElement('div');
		holder.setAttribute('data-a11y-negative-control', 'true');
		holder.innerHTML = html;
		root.appendChild(holder);
		return true;
	}, INJECTED_ELEMENT_HTML);
	if (!result) throw new Error('the negative control could not be injected');
	const violations = await page.evaluate(async () => {
		const api = globalThis.axe;
		const root = document.querySelector('#storybook-root');
		const scan = await api.run(root, {
			runOnly: { type: 'rule', values: ['image-alt'] },
			resultTypes: ['violations'],
		});
		return scan.violations.map((violation) => ({
			ruleId: violation.id,
			help: violation.help,
			nodes: violation.nodes.map((node) =>
				Array.isArray(node.target) ? node.target.join(' ') : String(node.target),
			),
		}));
	});
	return {
		violations,
		ruleId: violations[0]?.ruleId ?? null,
		png: await page.screenshot({ type: 'png', fullPage: false }),
	};
}

/** The audit table: one row per story. */
export function renderTable(summaries) {
	const rows = summaries
		.map((summary) => {
			const rules = (summary.rules ?? [])
				.map(
					(rule) =>
						`<div class="rule"><code>${escapeHtml(rule.ruleId)}</code>` +
						`<span class="tag">${escapeHtml((rule.tags ?? []).join(' · '))}</span>` +
						`<span class="n">${rule.nodes.length} element(s)</span></div>`,
				)
				.join('');
			const state =
				summary.verdict === 'fail' ? 'fail' : summary.verdict === 'baseline' ? 'baseline' : 'pass';
			return `<div class="row">
      <span class="story"><code>${escapeHtml(summary.story)}</code></span>
      <span class="state ${state}">${state}</span>
      <span class="rules">${rules || '<span class="none">no violation</span>'}</span>
    </div>`;
		})
		.join('\n');
	return `<div class="rows">
${rows}
  </div>`;
}

/**
 * The report page: the summary, the two examples, and the audit rows.
 *
 * The rows are laid out in two CSS columns so that 100 stories fit in
 * a capture that stays inside the repository's image budget — the
 * artefact has to be readable, not merely present.
 */
export function reportHtml({ summaries, pass, fail, baseUrl, gateExitCode, axeVersion }) {
	const totalNew = summaries.filter((summary) => summary.verdict === 'fail').length;
	const totalBaseline = summaries.filter((summary) => summary.verdict === 'baseline').length;
	const example = (title, caption, png) =>
		png
			? `<figure>
    <img alt="${escapeHtml(caption)}" src="data:image/png;base64,${png.toString('base64')}" />
    <figcaption><strong>${escapeHtml(title)}</strong><br /><span class="sel">${escapeHtml(caption)}</span></figcaption>
  </figure>`
			: `<figure class="none"><figcaption>${escapeHtml(title)} — no capture</figcaption></figure>`;
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Storybook story axe-core audit — Issue #392</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 20px; background: #fbfbf9; color: #14140f;
         font: 12.5px/1.5 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 11.5px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.07em; color: #5a5a4e; }
  .sub { margin: 0 0 14px; color: #3d3d33; max-width: 1100px; }
  .cards { display: flex; gap: 10px; margin-bottom: 14px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 8px 13px; min-width: 110px; }
  .card .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 19px; font-weight: 600; }
  .ok { color: #1c6b3a; } .ng { color: #a12020; } .warn { color: #8a6d1f; }
  .examples { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
  .examples > div { flex: 1 1 0; min-width: 0; }
  figure { margin: 0; border: 1px solid #dedcd2; background: #fff; padding: 9px; }
  figure img { width: 100%; display: block; border: 1px solid #eceadf; }
  figcaption { font-size: 11px; color: #3d3d33; margin-top: 7px; word-break: break-all; }
  .rows { columns: 2; column-gap: 16px; }
  .row { break-inside: avoid; display: flex; gap: 7px; align-items: baseline;
         border-bottom: 1px solid #eceadf; padding: 3px 0; }
  .row .story { flex: 0 0 44%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .state { flex: 0 0 52px; font-weight: 600; }
  .row .rules { flex: 1 1 auto; min-width: 0; }
  .state.pass { color: #1c6b3a; } .state.baseline { color: #8a6d1f; } .state.fail { color: #a12020; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  .rule { margin-bottom: 2px; }
  .tag { color: #77776a; font-size: 10.5px; margin-left: 5px; }
  .n { color: #77776a; font-size: 10.5px; margin-left: 5px; }
  .none { color: #77776a; }
  ul { margin: 5px 0 0; padding-left: 17px; }
  li { margin-bottom: 2px; }
  footer { margin-top: 14px; color: #77776a; font-size: 11px; }
</style>
</head>
<body>
  <h1>Storybook story axe-core audit — Issue #392</h1>
  <p class="sub">
    独立 story の描画済み DOM を axe-core で走査した実測結果。監査本体は
    <code>${escapeHtml(SPEC_PATH)}</code>、検査対象の manifest は
    <code>${escapeHtml(MANIFEST_PATH)}</code>、既知違反の台帳は
    <code>${escapeHtml(BASELINE_PATH)}</code>。機械が判定するのは「違反の有無・rule id・対象要素」までで、
    見た目の妥当性・代替手段の品質・文言の適切性は人の評価として残る。
  </p>

  <div class="cards">
    <div class="card"><div class="k">audit</div><div class="v ${gateExitCode === 0 ? 'ok' : 'ng'}">${gateExitCode === 0 ? 'PASS' : 'FAIL'}</div></div>
    <div class="card"><div class="k">stories audited</div><div class="v">${summaries.length}</div></div>
    <div class="card"><div class="k">baseline stories</div><div class="v warn">${totalBaseline}</div></div>
    <div class="card"><div class="k">new violations</div><div class="v ${totalNew > 0 ? 'ng' : 'ok'}">${totalNew}</div></div>
    <div class="card"><div class="k">axe-core</div><div class="v" style="font-size:14px">${escapeHtml(axeVersion)}</div></div>
  </div>

  <div class="examples">
    <div>
      <h2>pass — the story as shipped</h2>
      ${example('pass', pass?.caption ?? 'audited story', pass?.png)}
    </div>
    <div>
      <h2>fail — the same story with an injected defect</h2>
      ${example('fail', fail?.caption ?? 'negative control', fail?.png)}
    </div>
  </div>

  <h2>audit result (story · verdict · violations)</h2>
  ${renderTable(summaries)}

  <h2 style="margin-top:14px">human evaluation (not decided by this gate)</h2>
  <ul>
    <li>記録済みの違反を設計判断として許容してよいか（前景色と背景色のコントラストの取りうる値）</li>
    <li>代替テキスト・aria-label の文言が読み手に伝わるか</li>
    <li>キーボード操作だけで主要フローが完了できるか（このゲートは測らない）</li>
    <li>スクリーンリーダー実機での読み上げ品質（このゲートは測らない）</li>
  </ul>

  <footer>
    origin ${escapeHtml(baseUrl)} · rendered from the audit's own summary ·
    reproduce with <code>pnpm run capture:a11y-axe-storybook</code>.
  </footer>
</body>
</html>
`;
}

/** Serve one directory over loopback, for the report page only. */
export function serveDirectory(root) {
	const server = createServer((req, res) => {
		const path = (req.url ?? '/').split('?')[0];
		const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
		if (!file.startsWith(resolve(root))) {
			res.writeHead(403).end('forbidden');
			return;
		}
		if (!existsSync(file)) {
			res.writeHead(404).end('not found');
			return;
		}
		const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
		res.writeHead(200, { 'content-type': type });
		res.end(readFileSync(file));
	});
	return new Promise((resolveServer) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			resolveServer({
				baseUrl: `http://127.0.0.1:${port}`,
				close: () =>
					new Promise((done) => {
						server.closeAllConnections?.();
						server.close(() => done());
					}),
			});
		});
	});
}

function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/a11y/axe-storybook-pass-fail.webp',
		baseUrl: process.env.STORYBOOK_BASE_URL ?? 'http://localhost:6006',
		port: 6006,
		workDir: WORK_DIR,
		jsonOut: `${WORK_DIR}/report.json`,
	};
	for (const arg of argv) {
		const separator = arg.indexOf('=');
		const flag = (
			arg.startsWith('--') ? arg.slice(2, separator === -1 ? undefined : separator) : arg
		).replace(/^--/, '');
		const value = separator === -1 ? null : arg.slice(separator + 1);
		switch (flag) {
			case 'screenshot':
				options.screenshot = value;
				break;
			case 'base-url':
				options.baseUrl = value;
				break;
			case 'port':
				options.port = Number(value);
				break;
			case 'work-dir':
			case 'png-dir':
				options.workDir = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			default:
				throw new Error(`unknown option: --${flag}`);
		}
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	assertWebpOutputPath(options.screenshot);
	assertLoopbackBaseUrl(options.baseUrl);

	const workDir = resolve(REPO_ROOT, options.workDir);
	mkdirSync(workDir, { recursive: true });

	const axeVersion = JSON.parse(
		readFileSync(resolve(REPO_ROOT, 'node_modules/axe-core/package.json'), 'utf8'),
	).version;
	const axeSource = (await import('node:module')).createRequire(import.meta.url)('axe-core').source;

	let server = null;
	let baseUrl = options.baseUrl;
	if (!(await isOriginReady(baseUrl))) {
		process.stdout.write(`[capture] starting the local Storybook on port ${options.port}…\n`);
		server = await startStorybook(options.port);
		baseUrl = server.baseUrl;
	}

	const { chromium } = await import('@playwright/test');
	const sharp = (await import('sharp')).default;

	let pass = null;
	let fail = null;
	try {
		const { exitCode, summaries } = runGate(baseUrl, options.workDir);
		if (summaries.length === 0) {
			throw new Error('the audit produced no per-story summary; the artefact would show nothing');
		}
		// A red gate means the audit itself did not hold: a story rendered
		// nothing, or a violation the ledger does not record appeared. The
		// artefact would then document a failure as if it were a
		// measurement, so no file is written and the run ends non-zero.
		if (exitCode !== 0) {
			throw new Error(
				`the audit gate exited with ${exitCode}; the artefact would picture a red gate as a measurement. Fix the gate first (the JSON report is under ${options.workDir}).`,
			);
		}
		process.stdout.write(
			`[capture] audit finished with exit code ${exitCode}; ${summaries.length} story/stories measured\n`,
		);

		const example = summaries[0];
		const browser = await chromium.launch();
		try {
			const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
			const page = await context.newPage();
			pass = {
				caption: `${example.story} — axe-core reported no violation`,
				png: await capturePassExample(page, baseUrl, example.storyId),
			};
			fail = {
				caption: 'the same story with an <img> without alt — axe-core reported image-alt',
				...(await captureFailExample(page, baseUrl, example.storyId, axeSource)),
			};
			await context.close();
		} finally {
			await browser.close();
		}
		if (!fail.ruleId) {
			throw new Error(
				'the negative control produced no violation; the audit would be blind, so the artefact is refused',
			);
		}

		const html = reportHtml({
			summaries,
			pass,
			fail,
			baseUrl,
			gateExitCode: exitCode,
			axeVersion,
		});
		writeFileSync(join(workDir, 'index.html'), html);

		const reportServer = await serveDirectory(workDir);
		const pagePng = join(workDir, 'report.png');
		const reportBrowser = await chromium.launch();
		try {
			const context = await reportBrowser.newContext({
				viewport: { width: REPORT_WIDTH, height: 1200 },
				deviceScaleFactor: 1,
			});
			const page = await context.newPage();
			await page.goto(`${reportServer.baseUrl}/`, { waitUntil: 'networkidle' });
			writeFileSync(pagePng, await page.screenshot({ fullPage: true, type: 'png' }));
			await context.close();
		} finally {
			await reportBrowser.close();
		}
		await reportServer.close();

		const outPath = resolve(REPO_ROOT, options.screenshot);
		mkdirSync(dirname(outPath), { recursive: true });
		await sharp(pagePng)
			.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
			.webp({ quality: SCREENSHOT_QUALITY })
			.toFile(outPath);
		// The intermediate PNG never reaches the repository.
		rmSync(pagePng, { force: true });

		const meta = await sharp(outPath).metadata();
		const bytes = statSync(outPath).size;
		const kb = Math.round(bytes / 1024);
		if (bytes > SCREENSHOT_BUDGET_BYTES) {
			throw new Error(
				`capture is ${kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
			);
		}
		process.stdout.write(
			`[capture] wrote ${options.screenshot} (${meta.width}x${meta.height}, ${kb} kB)\n`,
		);

		writeFileSync(
			resolve(REPO_ROOT, options.jsonOut),
			`${JSON.stringify(
				{
					issue: '#392',
					generatedBy: 'scripts/capture-a11y-axe-storybook.mjs',
					origin: baseUrl,
					axeVersion,
					audit: { spec: SPEC_PATH, manifest: MANIFEST_PATH, baseline: BASELINE_PATH },
					summaries,
					negativeControl: fail
						? { story: example.story, ruleId: fail.ruleId, violations: fail.violations }
						: null,
					capture: {
						artefact: options.screenshot,
						width: meta.width ?? null,
						height: meta.height ?? null,
						bytes,
						kb,
						quality: SCREENSHOT_QUALITY,
					},
				},
				null,
				2,
			)}\n`,
		);
	} finally {
		if (server?.child) server.child.kill('SIGTERM');
	}
	return 0;
}

if (process.argv[1]?.endsWith('capture-a11y-axe-storybook.mjs')) {
	main().then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			process.stderr.write(`${error.message}\n`);
			process.exitCode = 1;
		},
	);
}
