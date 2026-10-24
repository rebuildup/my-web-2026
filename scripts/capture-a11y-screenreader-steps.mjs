#!/usr/bin/env node

/**
 * capture-a11y-screenreader-steps — capture the Issue #402 record sheet
 * into `docs/verification/a11y/screenreader-steps.webp`.
 *
 * What this captures
 * ------------------
 * The **record sheet** of the screen-reader procedure ledger
 * (`quality/screenreader-steps.json`): every operation a person has to
 * perform, the surface and the state it happens on, the assistive
 * technology and the environment it has to be performed in, and the
 * announcement the step expects.
 *
 * The two halves of the sheet are drawn differently on purpose:
 *
 *   - the columns the MACHINE fills (the operation, the surface, the
 *     assistive technology, the environment, the expected announcement)
 *     are printed as text;
 *   - the columns a PERSON fills (the observed announcement, the
 *     performer, the date, the result) are printed as **empty cells**
 *     with a visible "not entered" marker, because no review has been
 *     performed yet.
 *
 * The image is NOT a screen-reader result
 * ---------------------------------------
 * The picture shows the design of the record, not a reading. It must
 * never look like an assistive-technology observation: the observation
 * columns stay empty, the header states the same thing the gate
 * prints, and the capture never invents an announcement.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The sheet is rendered from a committed record.
 *   - The page is rendered from an in-memory HTML string: no request
 *     leaves the process, and no origin is needed.
 *
 * WebP, not PNG
 * -------------
 * Issue #402 names a `.png` path, but Chromium only writes PNG and a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture goes to `.tmp/`, is re-encoded with the existing
 * `sharp` devDependency (width <= 1600, quality 80), and the committed
 * file is the `.webp` sibling of the Issue's path. The script REFUSES
 * any non-`.webp` output path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-screenreader-steps.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/screenreader-steps.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-screenreader-steps)
 *   --json-out=<path>    report destination
 *                         (default .tmp/a11y-screenreader-steps/report.json)
 *   --width=<n>          CSS viewport width (default 1600)
 *   --no-capture         write no artefact
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	LEDGER_PATH,
	evaluateLedger,
	renderReport,
	repoFileExists,
	summarizeLedger,
} from './check-a11y-screenreader-steps.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The committed ledger the sheet is rendered from. */
export const LEDGER = LEDGER_PATH;

/** The committed artefact. */
export const ARTEFACT = 'docs/verification/a11y/screenreader-steps.webp';

/** Committed captures are WebP: width cap, quality and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 400 * 1024;

/** The columns a person fills. They stay empty until a review happens. */
export const HUMAN_COLUMNS = ['observedAnnounce', 'performer', 'performedAt', 'result'];

/** The label the empty observation cells carry. */
export const NOT_ENTERED = '未記入';

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES,
	};
}

/** Escape a value for the HTML (pure). */
export function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * The value a cell shows (pure).
 *
 * A column a person fills shows the "not entered" marker while the
 * observation is empty, and the observation itself once it exists.
 */
export function cellValue(step, column) {
	const value = step?.[column];
	if (value === undefined || value === null || String(value).trim() === '') {
		return NOT_ENTERED;
	}
	return String(value);
}

/** The rows of the sheet (pure): one per step, in ledger order. */
export function sheetRows(ledger) {
	const steps = Array.isArray(ledger?.steps) ? ledger.steps : [];
	return steps.map((step) => ({
		id: step.id,
		subject: step.subject,
		operation: step.operation,
		surface: step.surface,
		assistiveTechnology: step.assistiveTechnology,
		environment: step.environment,
		expectedAnnounce: step.expectedAnnounce,
		observedAnnounce: cellValue(step, 'observedAnnounce'),
		performer: cellValue(step, 'performer'),
		performedAt: cellValue(step, 'performedAt'),
		result: cellValue(step, 'result'),
	}));
}

/** The header lines of the sheet (pure). */
export function sheetHeader(ledger, summary, violations) {
	return [
		'screen reader procedure ledger — Issue #402',
		`${summary.steps} step(s) · ${summary.performed} performed · ${summary.notPerformed} not performed`,
		`machine-checked: ${violations.length === 0 ? 'no violations' : `${violations.length} violation(s)`}`,
		'the observation columns are filled by a person with an assistive technology. They are empty here: no review has been performed.',
	];
}

/** The HTML of the sheet (pure). */
export function renderSheetHtml(ledger, summary, violations) {
	const rows = sheetRows(ledger)
		.map((row) => {
			const surface = `${row.surface?.route ?? row.surface?.kind ?? ''} ${
				row.surface?.state ? `(${row.surface.state})` : ''
			}`.trim();
			return `<tr>
				<td class="id">${escapeHtml(row.id)}</td>
				<td class="subject">${escapeHtml(row.subject)}</td>
				<td class="operation">${escapeHtml(row.operation)}<div class="path">${escapeHtml(
					row.surface?.path ?? '',
				)}</div></td>
				<td>${escapeHtml(surface)}</td>
				<td>${escapeHtml(row.assistiveTechnology)}<div class="env">${escapeHtml(
					row.environment,
				)}</div></td>
				<td class="expected">${escapeHtml(row.expectedAnnounce)}</td>
				<td class="human">${escapeHtml(row.observedAnnounce)}</td>
				<td class="human">${escapeHtml(row.performer)}</td>
				<td class="human">${escapeHtml(row.performedAt)}</td>
				<td class="human">${escapeHtml(row.result)}</td>
			</tr>`;
		})
		.join('\n');

	const header = sheetHeader(ledger, summary, violations)
		.map((line) => `<div class="headline">${escapeHtml(line)}</div>`)
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>screen reader procedure ledger</title>
<style>
	:root { color-scheme: light; }
	* { box-sizing: border-box; }
	body {
		margin: 0;
		padding: 24px;
		background: #f4efdf;
		color: #0b1020;
		font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
		font-size: 13px;
		line-height: 1.5;
	}
	.panel { background: #fffdf7; border: 1px solid #d8cfb4; border-radius: 10px; overflow: hidden; }
	.head { padding: 18px 20px; background: #0b1020; color: #f4efdf; }
	.headline { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
	.headline:first-child { font-size: 15px; font-weight: 700; margin-bottom: 6px; }
	.legend { display: flex; gap: 18px; padding: 10px 20px; border-bottom: 1px solid #e7dfc8; font-size: 12px; }
	.legend span { display: inline-flex; align-items: center; gap: 6px; }
	.swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
	.swatch.machine { background: #1f6feb; }
	.swatch.human { background: #ffffff; border: 1px dashed #b26a00; }
	table { width: 100%; border-collapse: collapse; }
	th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid #ece4cd; }
	th { background: #f7f1e0; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
	td.id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; white-space: nowrap; }
	td.subject { white-space: nowrap; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
	td.operation { min-width: 260px; }
	td.expected { min-width: 240px; }
	td.human { background: #fffdf7; border-left: 1px dashed #d9c08a; color: #8a5a00; font-style: italic; white-space: nowrap; }
	td.human:empty::after { content: "—"; }
	.path, .env { color: #5b6472; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	.foot { padding: 12px 20px; font-size: 11px; color: #5b6472; }
</style>
</head>
<body>
	<div class="panel">
		<div class="head">${header}</div>
		<div class="legend">
			<span><i class="swatch machine"></i>機械が埋める欄（手順・対象・環境・期待する announce）</span>
			<span><i class="swatch human"></i>人が記入する欄（実測の announce・実行者・日付・結果）— 未実施</span>
		</div>
		<table>
			<thead>
				<tr>
					<th>id</th><th>対象</th><th>手順 / surface</th><th>route / state</th>
					<th>支援技術 / 実行環境</th><th>期待する announce</th>
					<th>実測の announce</th><th>実行者</th><th>日付</th><th>結果</th>
				</tr>
			</thead>
			<tbody>
${rows}
			</tbody>
		</table>
		<div class="foot">この画像は記録の設計の見本です。読み上げの実測結果ではありません（実測欄は未記入のままです）。</div>
	</div>
</body>
</html>`;
}

function parseArgs(argv) {
	const options = {
		screenshot: ARTEFACT,
		pngDir: '.tmp/a11y-screenreader-steps',
		jsonOut: '.tmp/a11y-screenreader-steps/report.json',
		width: SCREENSHOT_MAX_WIDTH,
		capture: true,
	};
	for (const arg of argv) {
		const separator = arg.indexOf('=');
		const flag = (
			arg.startsWith('--') ? arg.slice(2, separator === -1 ? undefined : separator) : arg
		).replace(/^--/, '');
		const value = separator === -1 ? null : arg.slice(separator + 1);
		switch (flag) {
			case 'screenshot':
				options.screenshot = value ?? options.screenshot;
				break;
			case 'png-dir':
				options.pngDir = value ?? options.pngDir;
				break;
			case 'json-out':
				options.jsonOut = value ?? options.jsonOut;
				break;
			case 'width':
				options.width = Number(value ?? options.width);
				break;
			case 'no-capture':
				options.capture = false;
				break;
			default:
				break;
		}
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const destination = resolve(REPO_ROOT, options.screenshot);
	if (extname(destination) !== '.webp') {
		process.stderr.write(
			`[capture] refusing to write outside the repository's WebP contract: ${options.screenshot}\n`,
		);
		process.exit(1);
	}

	const ledgerPath = join(REPO_ROOT, LEDGER);
	if (!existsSync(ledgerPath)) {
		process.stderr.write(`[capture] cannot read ${LEDGER}\n`);
		process.exit(2);
	}
	const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
	const today = new Date();
	const violations = evaluateLedger({
		ledger,
		exists: (path) => repoFileExists(path),
		readFile: (path) =>
			existsSync(join(REPO_ROOT, path)) ? readFileSync(join(REPO_ROOT, path), 'utf8') : null,
		today,
	});
	const summary = summarizeLedger(ledger);
	const html = renderSheetHtml(ledger, summary, violations);

	const pngDir = resolve(REPO_ROOT, options.pngDir);
	mkdirSync(pngDir, { recursive: true });
	const pngPath = join(pngDir, 'sheet.png');
	const report = {
		issue: '#402',
		ledger: LEDGER,
		summary,
		violations,
		rows: sheetRows(ledger).length,
		gateReport: renderReport({ ledger, summary, violations }),
	};

	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({
			viewport: { width: options.width, height: 900 },
			deviceScaleFactor: 1,
		});
		const page = await context.newPage();
		await page.setContent(html, { waitUntil: 'load' });
		const png = await page.screenshot({ fullPage: true });
		report.browser = { name: 'chromium', version: browser.version(), deviceScaleFactor: 1 };
		report.viewport = { width: options.width, height: 900 };
		writeFileSync(pngPath, png);
		await context.close();
	} finally {
		await browser.close();
	}

	if (options.capture) {
		const { default: sharp } = await import('sharp');
		const staged = join(pngDir, 'sheet.webp');
		await sharp(pngPath)
			.resize({ width: SCREENSHOT_MAX_WIDTH })
			.webp({ quality: SCREENSHOT_QUALITY })
			.toFile(staged);
		const size = statSync(staged).size;
		const budget = screenshotBudgetVerdict(size);
		if (!budget.withinBudget) {
			process.stderr.write(`[capture] the artefact is ${budget.kb} kB, over the budget\n`);
			process.exit(1);
		}
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, readFileSync(staged));
		rmSync(pngPath, { force: true });
		report.artefact = {
			path: relative(REPO_ROOT, destination),
			bytes: budget.bytes,
			kb: budget.kb,
		};
		process.stdout.write(`[capture] wrote ${relative(REPO_ROOT, destination)} (${budget.kb} kB)\n`);
	} else {
		process.stdout.write('[capture] --no-capture: nothing captured\n');
	}

	const reportPath = resolve(REPO_ROOT, options.jsonOut);
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, '\t')}\n`);
	process.stdout.write(`[capture] report → ${relative(REPO_ROOT, reportPath)}\n`);
}

if (process.argv[1]?.endsWith('capture-a11y-screenreader-steps.mjs')) {
	main().catch((error) => {
		process.stderr.write(`[capture] failed: ${error?.stack ?? error}\n`);
		process.exit(1);
	});
}
