#!/usr/bin/env node

/**
 * capture-a11y-axe-routes — capture the Issue #393 verification screen
 * into `docs/verification/a11y/axe-route-report.webp`.
 *
 * What this captures
 * ------------------
 * The axe-core audit of the rendered public routes, as the GATE
 * measured it: the audit table (route / rule id / node count /
 * baseline?) and one real violating element on screen, side by side.
 *
 * It does NOT re-implement the audit. The gate itself
 * (`e2e/a11y/axe-public-routes.spec.ts`) is executed with Playwright's
 * JSON reporter, and the per-route summaries the spec attaches are
 * what this script renders. The artefact therefore shows the numbers
 * the release gate will act on — not a second, friendlier measurement
 * that could disagree with it.
 *
 * Why the artefact exists
 * -----------------------
 * A ledger of known violations is only trustworthy if a reader can see
 * what is being tolerated. The table says which route violates which
 * rule and how many elements are affected; the screenshot says what
 * the violation looks like on the page. Both are needed: a table
 * alone cannot be judged, and a screenshot alone cannot be counted.
 *
 * Safety
 * ------
 *   - Nothing is deployed. The scan runs against the LOCAL preview
 *     server on loopback (`scripts/e2e-local-bootstrap.mjs`); the
 *     canonical production origin is never called.
 *   - No secret is read or printed. The report carries route paths,
 *     rule ids and element selectors only.
 *   - The report page is served from a loopback-only HTTP server on an
 *     ephemeral port.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG and Issue #393 names a `.png` path, but a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture is taken into `.tmp/`, encoded with the
 * existing `sharp` devDependency at width <= 1600 / quality 80, and
 * the committed file is the `.webp` sibling. The script REFUSES any
 * non-`.webp` output path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-axe-routes.mjs [options]
 *
 *   --screenshot=<path>   committed artefact destination
 *                          (default docs/verification/a11y/axe-route-report.webp)
 *   --base-url=<url>      loopback origin to audit
 *                          (default http://127.0.0.1:3100)
 *   --png-dir=<path>      temporary directory (default .tmp/a11y-axe-routes)
 *   --json-out=<path>     report destination (default .tmp/a11y-axe-routes/report.json)
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 400 * 1024;

/** The temp directory the capture works in. */
export const WORK_DIR = '.tmp/a11y-axe-routes';

/** The gate spec the artefact is rendered from. */
export const SPEC_PATH = 'e2e/a11y/axe-public-routes.spec.ts';

/** The manifest (the audited route set) and the ledger (known violations). */
export const MANIFEST_PATH = 'e2e/a11y/axe-manifest.ts';
export const BASELINE_PATH = 'e2e/a11y/axe-baseline.json';

/** How long the preview server may take to become ready. */
export const SERVER_READY_TIMEOUT_MS = 90_000;

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

/** Is the loopback origin already answering? */
export async function isOriginReady(baseUrl) {
	try {
		const response = await fetch(baseUrl, { redirect: 'manual' });
		return response.status > 0;
	} catch {
		return false;
	}
}

/**
 * Start the local preview server and wait until it answers.
 *
 * The server is the same one the Playwright gate uses
 * (`scripts/e2e-local-bootstrap.mjs`): it migrates and seeds the local
 * D1 first, then hands over to `vite preview`. Nothing is deployed
 * and no binding outside the local state directory is touched.
 */
export async function startPreviewServer(port, repoRoot = REPO_ROOT) {
	const child = spawn(process.execPath, ['scripts/e2e-local-bootstrap.mjs', `--port=${port}`], {
		cwd: repoRoot,
		stdio: ['ignore', 'ignore', 'inherit'],
	});
	const baseUrl = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await isOriginReady(baseUrl)) return { baseUrl, child };
		await new Promise((done) => setTimeout(done, 500));
	}
	child.kill('SIGTERM');
	throw new Error(
		`the local preview server did not become ready within ${SERVER_READY_TIMEOUT_MS} ms`,
	);
}

/**
 * Run the gate spec and return the per-route summaries it attached.
 *
 * The spec is the authority: the artefact must not disagree with the
 * numbers the release gate acts on. A failing gate is not an error
 * here — it is the state the artefact has to show.
 */
export function runGate(baseUrl, workDir, repoRoot = REPO_ROOT) {
	const reportPath = resolve(repoRoot, workDir, 'playwright-report.json');
	mkdirSync(dirname(reportPath), { recursive: true });
	let exitCode = 0;
	try {
		execFileSync('pnpm', ['exec', 'playwright', 'test', SPEC_PATH, '--reporter=json'], {
			cwd: repoRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				PLAYWRIGHT_BASE_URL: baseUrl,
				// The JSON reporter writes to a file, so the summary the
				// artefact renders is read back from the gate's own run
				// instead of being re-derived.
				PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
				PLAYWRIGHT_JSON_OUTPUT_NAME: 'playwright-report.json',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (error) {
		exitCode = typeof error.status === 'number' ? error.status : 1;
	}
	if (!existsSync(reportPath)) {
		throw new Error('the gate run produced no JSON report; the artefact would show nothing');
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
					if (payload && typeof payload.route === 'string') summaries.push(payload);
				}
			}
		}
	}
	return { exitCode, summaries, reportPath };
}

/** Every spec of a report tree — the JSON reporter nests suites. */
function collectSpecs(suites) {
	const specs = [];
	for (const suite of suites ?? []) {
		specs.push(...(suite.specs ?? []));
		specs.push(...collectSpecs(suite.suites ?? []));
	}
	return specs;
}

/**
 * Screenshot one violating element, so the artefact shows the defect
 * and not only its name.
 *
 * The selector comes from the gate's own summary (axe's element
 * selector), so the picture and the table describe the same element.
 */
export async function captureViolationElement(page, baseUrl, route, selector) {
	await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
	const locator = page.locator(selector).first();
	if ((await locator.count()) === 0) return null;
	const box = await locator.boundingBox();
	if (!box) return null;
	await locator.scrollIntoViewIfNeeded();
	return {
		route,
		selector,
		png: await locator.screenshot({ type: 'png' }),
	};
}

/** The audit table: one row per route, one line per rule. */
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
			const known = summary.knownViolations ?? 0;
			const fresh = summary.newViolations ?? 0;
			const state = fresh > 0 ? 'fail' : known > 0 ? 'baseline' : 'pass';
			return `<tr>
      <td class="route"><code>${escapeHtml(summary.route)}</code></td>
      <td class="state ${state}">${state}</td>
      <td class="counts">${known} known / ${fresh} new</td>
      <td class="rules">${rules || '<span class="none">no violation</span>'}</td>
    </tr>`;
		})
		.join('\n');
	return `<table>
  <thead><tr><th>route</th><th>verdict</th><th>ledger</th><th>violations (rule · WCAG tags · elements)</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

/** The report page: the table on the left, the real element on the right. */
export function reportHtml({ summaries, element, baseUrl, gateExitCode, axeVersion }) {
	const totalKnown = summaries.reduce(
		(total, summary) => total + (summary.knownViolations ?? 0),
		0,
	);
	const totalNew = summaries.reduce((total, summary) => total + (summary.newViolations ?? 0), 0);
	const elementPanel = element
		? `<figure>
    <img alt="the element axe-core reported on ${escapeHtml(element.route)}" src="data:image/png;base64,${element.png.toString('base64')}" />
    <figcaption><code>${escapeHtml(element.route)}</code><br /><span class="sel">${escapeHtml(element.selector)}</span></figcaption>
  </figure>`
		: '<figure class="none"><figcaption>no violating element was captured</figcaption></figure>';
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>public route axe-core audit — Issue #393</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; background: #fbfbf9; color: #14140f;
         font: 13px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 21px; margin: 0 0 4px; }
  h2 { font-size: 12px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.07em; color: #5a5a4e; }
  .sub { margin: 0 0 16px; color: #3d3d33; max-width: 900px; }
  .cards { display: flex; gap: 10px; margin-bottom: 16px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 10px 14px; min-width: 120px; }
  .card .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 21px; font-weight: 600; }
  .ok { color: #1c6b3a; } .ng { color: #a12020; } .warn { color: #8a6d1f; }
  .cols { display: flex; gap: 18px; align-items: flex-start; }
  .left { flex: 1 1 auto; min-width: 0; }
  .right { flex: 0 0 460px; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  td.route { width: 190px; }
  td.state { width: 90px; font-weight: 600; }
  td.state.pass { color: #1c6b3a; } td.state.baseline { color: #8a6d1f; } td.state.fail { color: #a12020; }
  td.counts { width: 120px; color: #3d3d33; }
  .rule { margin-bottom: 3px; }
  .tag { color: #77776a; font-size: 11px; margin-left: 6px; }
  .n { color: #77776a; font-size: 11px; margin-left: 6px; }
  .none { color: #77776a; }
  figure { margin: 0; border: 1px solid #dedcd2; background: #fff; padding: 10px; }
  figure img { width: 100%; display: block; border: 1px solid #eceadf; }
  figcaption { font-size: 11.5px; color: #3d3d33; margin-top: 8px; word-break: break-all; }
  ul { margin: 6px 0 0; padding-left: 18px; }
  li { margin-bottom: 3px; }
  footer { margin-top: 18px; color: #77776a; font-size: 11.5px; }
</style>
</head>
<body>
  <h1>public route axe-core audit — Issue #393</h1>
  <p class="sub">
    公開ルートの描画済み DOM を axe-core で走査した実測結果。ゲート本体は
    <code>${escapeHtml(SPEC_PATH)}</code>、検査対象の manifest は
    <code>${escapeHtml(MANIFEST_PATH)}</code>、既知違反の台帳は
    <code>${escapeHtml(BASELINE_PATH)}</code>。機械が判定するのは「違反の有無・rule id・対象要素」までで、
    見た目の妥当性・代替手段の品質・文言の適切性は人の評価として残る。
  </p>

  <div class="cards">
    <div class="card"><div class="k">gate</div><div class="v ${gateExitCode === 0 ? 'ok' : 'ng'}">${gateExitCode === 0 ? 'PASS' : 'FAIL'}</div></div>
    <div class="card"><div class="k">routes audited</div><div class="v">${summaries.length}</div></div>
    <div class="card"><div class="k">known violations</div><div class="v warn">${totalKnown}</div></div>
    <div class="card"><div class="k">new violations</div><div class="v ${totalNew > 0 ? 'ng' : 'ok'}">${totalNew}</div></div>
    <div class="card"><div class="k">axe-core</div><div class="v" style="font-size:15px">${escapeHtml(axeVersion)}</div></div>
  </div>

  <div class="cols">
    <div class="left">
      <h2>audit result (route · verdict · ledger · violations)</h2>
      ${renderTable(summaries)}
      <h2 style="margin-top:16px">human evaluation (not decided by this gate)</h2>
      <ul>
        <li>記録済みの違反を設計判断として許容してよいか（前景色と背景色のコントラストの取值）</li>
        <li>代替テキスト・aria-label の文言が読み手に伝わるか</li>
        <li>キーボード操作だけで主要フローが完了できるか（このゲートは測らない）</li>
        <li>スクリーンリーダー実機での読み上げ品質（このゲートは測らない）</li>
      </ul>
    </div>
    <div class="right">
      <h2>one reported element, on the page</h2>
      ${elementPanel}
      <footer>
        origin ${escapeHtml(baseUrl)} · rendered from the gate's own summary ·
        reproduce with <code>pnpm run capture:a11y-axe-routes</code>.
      </footer>
    </div>
  </div>
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
		screenshot: 'docs/verification/a11y/axe-route-report.webp',
		baseUrl: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3100',
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
			case 'png-dir':
			case 'work-dir':
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

	let server = null;
	let baseUrl = options.baseUrl;
	if (!(await isOriginReady(baseUrl))) {
		const port = Number(new URL(baseUrl).port || 80);
		process.stdout.write(`[capture] starting the local preview server on port ${port}…\n`);
		server = await startPreviewServer(port);
		baseUrl = server.baseUrl;
	}

	const { chromium } = await import('@playwright/test');
	const sharp = (await import('sharp')).default;

	let element = null;
	try {
		const { exitCode, summaries } = runGate(baseUrl, options.workDir);
		if (summaries.length === 0) {
			throw new Error('the gate produced no per-route summary; the artefact would show nothing');
		}
		process.stdout.write(
			`[capture] gate finished with exit code ${exitCode}; ${summaries.length} route(s) measured\n`,
		);

		const firstWithViolation = summaries.find((summary) => (summary.rules ?? []).length > 0);
		if (firstWithViolation) {
			const selector = firstWithViolation.rules[0]?.nodes?.[0];
			if (selector) {
				const browser = await chromium.launch();
				try {
					const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
					const page = await context.newPage();
					element = await captureViolationElement(
						page,
						baseUrl,
						firstWithViolation.route,
						selector,
					);
					await context.close();
				} finally {
					await browser.close();
				}
			}
		}

		const html = reportHtml({
			summaries,
			element,
			baseUrl,
			gateExitCode: exitCode,
			axeVersion,
		});
		writeFileSync(join(workDir, 'index.html'), html);

		const reportServer = await serveDirectory(workDir);
		const pagePng = join(workDir, 'report.png');
		const browser = await chromium.launch();
		try {
			const context = await browser.newContext({
				viewport: { width: SCREENSHOT_MAX_WIDTH, height: 1200 },
				deviceScaleFactor: 1,
			});
			const page = await context.newPage();
			await page.goto(`${reportServer.baseUrl}/`, { waitUntil: 'networkidle' });
			writeFileSync(pagePng, await page.screenshot({ fullPage: true, type: 'png' }));
			await context.close();
		} finally {
			await browser.close();
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
					issue: '#393',
					generatedBy: 'scripts/capture-a11y-axe-routes.mjs',
					origin: baseUrl,
					axeVersion,
					gate: { spec: SPEC_PATH, manifest: MANIFEST_PATH, baseline: BASELINE_PATH },
					summaries,
					element: element ? { route: element.route, selector: element.selector } : null,
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

if (process.argv[1]?.endsWith('capture-a11y-axe-routes.mjs')) {
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
