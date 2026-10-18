#!/usr/bin/env node
/**
 * Layout stress gate for Issue #416 — narrow viewport + long content +
 * visible scrollbar.
 *
 * This is the executable form of `scripts/layout-stress.mjs`: it renders
 * the fixture, drives the Playwright chromium already required by the
 * E2E suite, measures each variant with the browser half of the
 * detector and judges it with the pure half.
 *
 *   node scripts/check-layout-stress.mjs            # human-readable
 *   node scripts/check-layout-stress.mjs --json     # machine-readable
 *   node scripts/check-layout-stress.mjs --width 375
 *
 * Why the controls are not optional
 * ---------------------------------
 * A layout check that cannot fail is a screenshot with a green tint. So
 * every run also measures two deliberately broken variants of the same
 * document (`control-gutter`, `control-overflow`) and requires each to
 * be caught by a specific rule. A control that survives is reported as
 * `detector_unproven` with exit code 2 — deliberately different from the
 * exit 1 that means "the fixture is broken", so a reviewer can tell the
 * two apart.
 *
 * Exit codes:
 *   0  the baseline fixture is clean and every control was caught
 *   1  the baseline fixture broke (a real layout finding)
 *   2  the run did not happen, or a control survived (no evidence)
 *   3  bad usage
 *
 * Chromium must be present (`pnpm run e2e:install`). Offline, no secret,
 * no D1 / R2, no production access. This gate is intentionally NOT part
 * of `validate:fast` — that entry point is offline, read-only and cheap,
 * and launching a browser in it would change that contract. The pure
 * half of the same detector does run in CI: it is covered by
 * `scripts/check-layout-stress.test.mjs`, which is wired into
 * `pnpm run test`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	STRESS_VIEWPORT,
	VARIANTS,
	collectLayoutSnapshot,
	evaluateStressRun,
	renderStressFixture,
	requiredControlRules,
} from './layout-stress.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp/layout-stress');

function parseArgs(argv) {
	const options = { json: false, width: STRESS_VIEWPORT.width, height: STRESS_VIEWPORT.height };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--json') options.json = true;
		else if (arg === '--width') {
			index += 1;
			options.width = Number(argv[index]);
		} else if (arg === '--height') {
			index += 1;
			options.height = Number(argv[index]);
		} else throw new Error(`unknown argument: ${arg}`);
	}
	if (!Number.isInteger(options.width) || options.width < 240 || options.width > 1024) {
		throw new Error(`--width must be an integer between 240 and 1024 (got ${options.width})`);
	}
	if (!Number.isInteger(options.height) || options.height < 320 || options.height > 4096) {
		throw new Error(`--height must be an integer between 320 and 4096 (got ${options.height})`);
	}
	return options;
}

/**
 * Measure one fixture variant in a real browser.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} variant one of the keys of `VARIANTS`
 * @param {{width: number, height: number}} viewport
 * @returns {Promise<{withScrollbar: object, withoutScrollbar: object, chromium: string}>}
 */
async function measureVariant(browser, variant, viewport) {
	const htmlPath = join(TMP, `${variant}.html`);
	mkdirSync(TMP, { recursive: true });
	writeFileSync(htmlPath, renderStressFixture({ variant }));

	const context = await browser.newContext({
		viewport: { width: viewport.width, height: viewport.height },
		deviceScaleFactor: STRESS_VIEWPORT.deviceScaleFactor,
		reducedMotion: 'reduce',
	});
	try {
		const page = await context.newPage();
		await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
		await page.evaluate(() => document.fonts.ready);
		const withScrollbar = await page.evaluate(collectLayoutSnapshot, { overflowY: 'scroll' });
		const withoutScrollbar = await page.evaluate(collectLayoutSnapshot, { overflowY: 'hidden' });
		return {
			withScrollbar,
			withoutScrollbar,
			chromium: browser.version(),
			htmlPath: htmlPath.replace(`${ROOT}/`, ''),
		};
	} finally {
		await context.close();
	}
}

/**
 * Run every variant through one browser session.
 *
 * @param {{width?: number, height?: number, quiet?: boolean}} [options]
 * @returns {Promise<object>} a machine-readable result
 */
export async function runLayoutStressCheck(options = {}) {
	const width = options.width ?? STRESS_VIEWPORT.width;
	const height = options.height ?? STRESS_VIEWPORT.height;
	const { chromium: playwright } = await import('@playwright/test');
	const browser = await playwright.launch();
	const runs = [];
	try {
		for (const variantId of Object.keys(VARIANTS)) {
			const measured = await measureVariant(browser, variantId, { width, height });
			const verdict = evaluateStressRun(measured);
			runs.push({
				id: variantId,
				mustPass: VARIANTS[variantId].mustPass,
				defect: VARIANTS[variantId].defect,
				...measured,
				...verdict,
			});
		}
	} finally {
		await browser.close();
	}

	const baseline = runs.find((run) => run.id === 'baseline');
	const controls = runs.filter((run) => !run.mustPass);
	const unproven = [];
	for (const control of controls) {
		const rules = control.errors.map((error) => error.rule);
		const required = requiredControlRules(control.id, {
			gutterObservable: control.stats.gutterObservable,
		});
		const missing = required.filter((rule) => !rules.includes(rule));
		if (control.errors.length === 0 || missing.length > 0) {
			unproven.push({ id: control.id, required, caught: rules, missing });
		}
	}

	const blocking = baseline.errors.map((error) => `${error.rule}: ${error.message}`);
	if (unproven.length > 0) {
		blocking.push(
			`detector_unproven: ${unproven
				.map(
					(entry) =>
						`control "${entry.id}" was ${entry.caught.length === 0 ? 'not caught at all' : `caught only by ${entry.caught.join(', ')}`}, expected ${entry.required.join(' + ')}`,
				)
				.join('; ')}`,
		);
	}

	return {
		ok: blocking.length === 0,
		viewport: { width, height },
		chromium: runs[0]?.chromium ?? null,
		environment: runs[0]?.withScrollbar?.environment ?? null,
		runs,
		unproven,
		errors: blocking,
	};
}

function formatReport(result) {
	const lines = [];
	lines.push(
		`layout stress (Issue #416) · viewport ${result.viewport.width}x${result.viewport.height} · chromium ${result.chromium ?? 'unknown'}`,
	);
	if (result.environment) {
		lines.push(
			`environment: ${result.environment.userAgent} · language ${result.environment.language}`,
		);
	}
	for (const run of result.runs) {
		const gate = run.mustPass ? (run.errors.length === 0 ? 'PASS' : 'FAIL') : 'CONTROL';
		lines.push('');
		lines.push(`${gate}  ${run.id}${run.defect ? `  (deliberate defect: ${run.defect})` : ''}`);
		lines.push(
			`  sections ${run.stats.sections} · targets ${run.stats.targets} · scrollWidth ${run.stats.scrollWidth} / clientWidth ${run.stats.clientWidth} · scrollbar ${run.stats.scrollbarWidth}px · gutter declared "${run.stats.gutterDeclaration}"${run.stats.gutterObservable ? '' : ' (overlay scrollbars: shift not observable)'}`,
		);
		for (const shift of run.stats.shifts ?? []) {
			if (shift.withScrollbar === null || shift.withoutScrollbar === null) continue;
			const delta = (shift.withScrollbar - shift.withoutScrollbar).toFixed(2);
			lines.push(
				`  gutter probe ${shift.id}: ${shift.withScrollbar.toFixed(2)}px with scrollbar / ${shift.withoutScrollbar.toFixed(2)}px without (Δ ${delta}px)`,
			);
		}
		for (const error of run.errors) lines.push(`  ERROR ${error.rule}: ${error.message}`);
		for (const warning of run.warnings) lines.push(`  WARN  ${warning.rule}: ${warning.message}`);
	}
	lines.push('');
	lines.push(`errors (${result.errors.length})`);
	for (const error of result.errors) lines.push(`  - ${error}`);
	return lines.join('\n');
}

async function main(argv) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		return 3;
	}

	let result;
	try {
		result = await runLayoutStressCheck(options);
	} catch (error) {
		process.stderr.write(
			`layout stress did not run (${error.message}). Chromium is required: pnpm run e2e:install\n`,
		);
		return 2;
	}

	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, '\t')}\n`);
		return result.ok ? 0 : result.unproven.length > 0 ? 2 : 1;
	}

	const report = formatReport(result);
	if (result.ok) process.stdout.write(`${report}\n`);
	else process.stderr.write(`${report}\n`);
	return result.ok ? 0 : result.unproven.length > 0 ? 2 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(await main(process.argv.slice(2)));
}
