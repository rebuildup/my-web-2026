#!/usr/bin/env node

/**
 * capture-a11y-dialog-focus — capture the Issue #406 verification screen
 * into `docs/verification/a11y/dialog-focus.webp`.
 *
 * What this captures
 * ------------------
 * The REAL application, not a synthetic page: the local preview server
 * (`scripts/e2e-local-bootstrap.mjs`, the same one Playwright's
 * `webServer` uses) serves the built Worker on loopback, Chromium opens
 * `/design-system` (the Issue #394 fixture that mounts the SHIPPED
 * `PickerModal`), and the script drives the modal with the keyboard only:
 *
 *   - the dialog is MODAL (`dialog.matches(':modal')`), so the user agent
 *     owns the focus trap,
 *   - Tab keeps the focus inside the dialog,
 *   - the page behind the dialog is inert (a background control cannot
 *     take the focus while the dialog is open),
 *   - `Escape` closes the dialog,
 *   - the focus returns to the trigger that opened it.
 *
 * It is also an ASSERTION, not only a screenshot. If the observations
 * contradict the contract, the script exits non-zero and writes NO
 * artefact, so the picture can never be the evidence for a broken
 * contract.
 *
 * Negative control
 * ----------------
 * The capture runs the SAME measurement twice: once against the shipped
 * component and once with the defect injected (`showModal` replaced by
 * `show`, i.e. a non-modal open). The second run MUST fail the verdict —
 * if it passes, the assertion is not looking at the modal contract at
 * all, and the capture fails for that reason instead of writing a green
 * picture.
 *
 * What is deliberately NOT captured
 * ---------------------------------
 * The focus ring's contrast and visibility (Issue #399 / the reviewer),
 * the screen-reader announcement order, and the reading comfort. The
 * artefact says so on its face instead of implying a machine verdict.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The preview server is loopback-only.
 *   - The screenshot shows the public design-system fixture. No private
 *     data is on it.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG, but a verification artefact does not justify a
 * permanently large binary in the tree. The capture is taken into `.tmp/`,
 * encoded with the existing `sharp` devDependency at width <= 1600 /
 * quality 80, and the committed file is the `.webp` sibling. The script
 * REFUSES any non-`.webp` output path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-dialog-focus.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/dialog-focus.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-dialog-focus)
 *   --json-out=<path>    report destination (default .tmp/a11y-dialog-focus/report.json)
 *   --port=<n>           preview server port (default 3124)
 *   --no-capture         start nothing browser-side; write no artefact
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	PANEL_WIDTH,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SCREENSHOT_QUALITY,
	assertWebpOutputPath,
	composeArtefact,
	escapeXml,
	screenshotBudgetVerdict,
	waitForServer,
} from './capture-a11y-keyboard-nav.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Re-exported so the capture's own test can assert the WebP-only policy
// without importing the keyboard-nav capture directly.
export { assertWebpOutputPath };

/** The committed artefact. */
export const ARTEFACT = 'docs/verification/a11y/dialog-focus.webp';

/** The browser geometry. */
export const VIEWPORT = { width: 1280, height: 900 };
export const DEVICE_SCALE_FACTOR = 2;

/** How many Tabs the trap check presses. */
export const TAB_PRESSES = 12;

/** The WCAG 2.2 criteria this artefact speaks to, with their levels. */
export const WCAG_MAPPING = [
	{ sc: '2.1.2', name: 'No Keyboard Trap', level: 'A' },
	{ sc: '2.4.3', name: 'Focus Order', level: 'A' },
	{ sc: '2.4.7', name: 'Focus Visible', level: 'AA' },
];

/**
 * Decide whether the observations honour the modal focus contract (pure).
 *
 * Kept pure and exported so the verdict can be reasoned about without a
 * browser, and so the negative control can be judged by the SAME function
 * that judges the shipped component.
 */
export function evaluateObservation(observation) {
	const failures = [];
	if (observation.dialogIsModal !== true) {
		failures.push(
			'the dialog is not modal (not opened with showModal()); the user agent gives a non-modal dialog no focus trap and no focus return (SC 2.1.2)',
		);
	}
	if (observation.focusTrapped !== true) {
		failures.push('Tab left the dialog: the focus is not trapped inside it (SC 2.1.2)');
	}
	if (observation.backgroundInert !== true) {
		failures.push(
			'a control behind the dialog could take the focus while it was open; the background is not inert (SC 2.1.2)',
		);
	}
	if (observation.escapeClosed !== true) {
		failures.push('Escape did not close the dialog; the keyboard had no way out (SC 2.1.2)');
	}
	if (observation.focusReturnedToTrigger !== true) {
		failures.push(
			'the dialog closed but the focus did not return to the trigger that opened it (SC 2.4.3)',
		);
	}
	return { ok: failures.length === 0, failures };
}

/**
 * Drive the shipped picker dialog and record its keyboard contract.
 *
 * `nonModal` injects the defect the Issue hypothesised: the component's
 * `showModal()` call is redirected to `show()`, so the SAME dialog opens
 * NON-modally. The observation then has to fail `evaluateObservation`; that
 * is the capture's negative control.
 */
export async function observeDialog(
	page,
	baseUrl,
	{ nonModal = false, screenshotPath = null } = {},
) {
	if (nonModal) {
		await page.addInitScript(() => {
			HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.show;
		});
	}
	await page.goto(`${baseUrl}/design-system`, { waitUntil: 'domcontentloaded' });
	const trigger = page.getByTestId('design-system-reaction-picker-open');
	await trigger.waitFor({ state: 'visible', timeout: 15_000 });
	await trigger.focus();
	await page.keyboard.press('Enter');

	const dialog = page.locator('dialog[aria-label="Add a reaction"]');
	await dialog.waitFor({ state: 'visible', timeout: 15_000 });

	const dialogIsModal = await dialog.evaluate((element) => element.matches(':modal'));

	let focusTrapped = true;
	for (let index = 0; index < TAB_PRESSES; index += 1) {
		await page.keyboard.press('Tab');
		const inside = await dialog.evaluate(
			(element) => element === document.activeElement || element.contains(document.activeElement),
		);
		if (!inside) focusTrapped = false;
	}

	// The background must be inert: a focusable control behind the dialog
	// cannot take the focus while the modal is open.
	const backgroundInert = await dialog.evaluate((element) => {
		const candidate = document.querySelector(
			'a[href], button, input, select, textarea, [tabindex]',
		);
		if (!candidate || element.contains(candidate)) return true;
		candidate.focus();
		return document.activeElement !== candidate;
	});

	if (screenshotPath) {
		writeFileSync(screenshotPath, await page.screenshot({ type: 'png' }));
	}

	await page.keyboard.press('Escape');
	const escapeClosed = await dialog.isHidden();
	const after = await page.evaluate(() => {
		const element = document.activeElement;
		return {
			tag: element?.tagName ?? 'NONE',
			testId: element?.getAttribute('data-testid') ?? null,
		};
	});

	return {
		dialogIsModal,
		focusTrapped,
		backgroundInert,
		escapeClosed,
		focusReturnedToTrigger:
			escapeClosed &&
			after.tag === 'BUTTON' &&
			after.testId === 'design-system-reaction-picker-open',
		activeAfterEscape: after,
	};
}

/** The header band: what was rendered, what was measured, what was not. */
export function headerSvg({ observation, width = SCREENSHOT_MAX_WIDTH }) {
	const title = 'modal focus contract — Issue #406';
	const rows = [
		`route /design-system · viewport ${VIEWPORT.width}x${VIEWPORT.height} · Chromium · the shipped picker dialog is open`,
		'machine-checked: the dialog is modal (showModal), Tab stays inside it, the page behind it is inert (SC 2.1.2)',
		'machine-checked: Escape closes the dialog and the focus returns to the trigger (SC 2.1.2 / 2.4.3)',
		'not machine-checked: focus-ring contrast, screen-reader announcement, reading order (human evaluation)',
	];
	const rowTop = 52;
	const height = rowTop + rows.length * 22 + 16;
	const lines = rows
		.map(
			(row, index) =>
				`<text x="16" y="${rowTop + index * 22}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" fill="#1c2030">${escapeXml(row)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#f4efdf" />
	<text x="16" y="34" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="20" font-weight="700" fill="#0b1020">${escapeXml(title)}</text>
	${lines}
</svg>
`,
	};
}

/** The evidence panel: the recorded contract, and what was NOT measured. */
export function evidencePanelSvg({ observation, width }) {
	const rows = [
		'machine-checked (Issue #406)',
		'',
		`dialog is modal (:modal): ${observation.dialogIsModal ? 'yes' : 'NO'}`,
		`Tab stays inside the dialog (${TAB_PRESSES} presses): ${observation.focusTrapped ? 'yes' : 'NO'}`,
		`the page behind the dialog is inert: ${observation.backgroundInert ? 'yes' : 'NO'}`,
		`Escape closed the dialog: ${observation.escapeClosed ? 'yes' : 'NO'}`,
		`focus returned to the trigger: ${observation.focusReturnedToTrigger ? 'yes' : 'NO'}`,
		`active element after Escape: <${observation.activeAfterEscape?.tag ?? 'NONE'}> ${observation.activeAfterEscape?.testId ?? ''}`,
		'',
		`WCAG 2.2: ${WCAG_MAPPING.map((entry) => `${entry.sc} ${entry.level}`).join(' · ')}`,
		'',
		'human evaluation (not measured here)',
		'- focus-ring contrast and visibility at 200% zoom (SC 2.4.7)',
		'- screen-reader announcement of the dialog, its label and its role',
		'- reading comfort of the focused surface',
		'',
		'negative control (injected defect)',
		`non-modal open (showModal -> show): ${observation.negativeControlOk === false ? 'caught (the verdict failed, as required)' : 'NOT caught (the verdict passed — the assertion is not looking)'}`,
	];
	const rowTop = 18;
	const step = 20;
	const height = rows.length * step + rowTop + 16;
	const lines = rows
		.map(
			(row, index) =>
				`<text x="14" y="${rowTop + index * step}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#1c2030">${escapeXml(row)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#ffffff" />
	<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#d8d2c0" stroke-width="2" />
	${lines}
</svg>
`,
	};
}

function parseArgs(argv) {
	const options = {
		screenshot: ARTEFACT,
		pngDir: '.tmp/a11y-dialog-focus',
		jsonOut: '.tmp/a11y-dialog-focus/report.json',
		port: 3124,
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
				options.screenshot = value;
				break;
			case 'png-dir':
				options.pngDir = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'port':
				options.port = Number(value);
				break;
			case 'no-capture':
				options.capture = false;
				break;
			default:
				throw new Error(`unknown option: --${flag}`);
		}
	}
	return options;
}

function ensureDir(path) {
	mkdirSync(dirname(resolve(REPO_ROOT, path)), { recursive: true });
}

/** Start the local preview server (the same one Playwright's webServer uses). */
function startPreviewServer(port) {
	const child = spawn(process.execPath, ['scripts/e2e-local-bootstrap.mjs', `--port=${port}`], {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const log = [];
	child.stdout.on('data', (chunk) => log.push(String(chunk)));
	child.stderr.on('data', (chunk) => log.push(String(chunk)));
	return { child, log };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	if (!existsSync(join(REPO_ROOT, 'dist/client/bundle-graph.json'))) {
		throw new Error(
			'no build output found — run `pnpm run build` before the capture (the capture drives the built Worker, not the dev server)',
		);
	}

	const baseUrl = `http://127.0.0.1:${options.port}`;
	const server = startPreviewServer(options.port);
	let observation = null;
	let verdict = null;
	let negative = null;
	let capture = null;

	try {
		const ready = await waitForServer(baseUrl);
		if (!ready) {
			throw new Error(
				`the local preview server never answered on ${baseUrl}; the capture would photograph nothing`,
			);
		}

		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: nothing browser-side was written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			ensureDir(join(options.pngDir, 'x.png'));
			const pagePng = resolve(REPO_ROOT, options.pngDir, 'dialog-open.png');

			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: VIEWPORT,
					deviceScaleFactor: DEVICE_SCALE_FACTOR,
				});
				const page = await context.newPage();
				observation = await observeDialog(page, baseUrl, { screenshotPath: pagePng });
				await context.close();

				// Negative control: the same measurement with the defect
				// injected. It must FAIL the verdict, or the assertion is
				// not looking at the modal contract.
				const controlContext = await browser.newContext({ viewport: VIEWPORT });
				const controlPage = await controlContext.newPage();
				negative = await observeDialog(controlPage, baseUrl, { nonModal: true });
				await controlContext.close();
			} finally {
				await browser.close();
			}

			const negativeVerdict = evaluateObservation(negative);
			observation.negativeControlOk = negativeVerdict.ok;
			observation.negativeControlFailures = negativeVerdict.failures;

			verdict = evaluateObservation(observation);
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the browser observations contradict the modal focus contract (${verdict.failures.length} failure(s)); no artefact was written`,
				);
			}
			if (negativeVerdict.ok) {
				throw new Error(
					'the negative control (a non-modal open) passed the verdict; the assertion is not looking at the modal contract, so no artefact was written',
				);
			}
			process.stdout.write(
				`[capture] negative control: the non-modal open was caught (${negativeVerdict.failures.length} failure(s))\n`,
			);

			const header = headerSvg({ observation });
			const panel = evidencePanelSvg({ observation, width: PANEL_WIDTH });
			const outPath = resolve(REPO_ROOT, options.screenshot);
			ensureDir(options.screenshot);
			const geometry = await composeArtefact({
				sharp,
				pagePng,
				header,
				panelSvg: panel,
				outPath,
			});
			const meta = await sharp(outPath).metadata();
			const budget = screenshotBudgetVerdict(statSync(outPath).size);
			// The intermediate PNG never reaches the repository.
			rmSync(pagePng, { force: true });
			if (!budget.withinBudget) {
				throw new Error(
					`capture is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
				);
			}
			capture = {
				artefact: options.screenshot,
				viewport: VIEWPORT,
				deviceScaleFactor: DEVICE_SCALE_FACTOR,
				quality: SCREENSHOT_QUALITY,
				width: meta.width ?? null,
				height: meta.height ?? null,
				...geometry,
				...budget,
			};
			process.stdout.write(
				`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${budget.kb} kB)\n`,
			);
		}
	} finally {
		server.child.kill('SIGTERM');
	}

	const report = {
		issue: '#406',
		generatedBy: 'scripts/capture-a11y-dialog-focus.mjs',
		observation,
		negative,
		verdict,
		wcag: WCAG_MAPPING,
		humanEvaluation: [
			'focus-ring contrast and visibility at 200% zoom (SC 2.4.7)',
			'screen-reader announcement of the dialog, its label and its role',
			'reading comfort of the focused surface',
		],
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted:
				'docs/verification/a11y/dialog-focus-return.png -> docs/verification/a11y/dialog-focus.webp',
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
		},
		capture,
	};
	ensureDir(options.jsonOut);
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] wrote ${options.jsonOut}\n`);
	return 0;
}

if (process.argv[1]?.endsWith('capture-a11y-dialog-focus.mjs')) {
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
