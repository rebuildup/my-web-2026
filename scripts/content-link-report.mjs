#!/usr/bin/env node
/**
 * content-link-report — verification artefact for Issue #434.
 *
 * Runs the SAME pure validators as `check-content-links.mjs` and writes
 * one HTML page (plus a Markdown summary) that shows:
 *
 *   1. the real repository scan (public HTML + Portfolio Markdown),
 *   2. counterfactual fixtures proving the severity boundary the Issue
 *      asks for: an internal 404 is an error/release failure, while an
 *      external timeout is a warning that does not block a release.
 *
 * The fixtures are evaluated at generation time, not written by hand,
 * so the table cannot claim a behaviour the gate does not have.
 *
 * Usage:
 *   node --experimental-strip-types scripts/content-link-report.mjs
 *   node --experimental-strip-types scripts/content-link-report.mjs --capture
 *
 * `--capture` screenshots the generated page with the installed
 * Playwright Chromium and re-encodes it to WebP with `sharp` (the
 * committed artefact). The Issue names a `.png` path; the repository
 * stores WebP to avoid a large binary, and the PR body says so.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildReportHtml, renderMarkdownSummary } from './_content-link-report.mjs';
import {
	checkExternalTargets,
	parseHtmlDocument,
	parseMarkdownDocument,
	summarize,
	validateDocuments,
} from './_content-links.mjs';
import { scan } from './check-content-links.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = join(REPO_ROOT, '.tmp/content-link-report');
const CAPTURE_PATH = join(REPO_ROOT, 'docs/verification/content/link-check-report.webp');
const ORIGIN = 'https://rebuildup.dev';

function parseArgs(argv) {
	const options = { capture: false, outDir: DEFAULT_OUT_DIR };
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === '--capture') options.capture = true;
		else if (argv[index] === '--out') {
			options.outDir = resolve(argv[index + 1]);
			index += 1;
		} else {
			throw new Error(`unknown argument: ${argv[index]}`);
		}
	}
	return options;
}

function fixture(id, note, input, findings) {
	return { id, note, input, findings, summary: summarize(findings) };
}

function validateFixture({ id, note, input, html, markdown, urlPath, surface }) {
	const document =
		html !== undefined
			? { ...parseHtmlDocument({ path: `fixture:${id}`, html }), urlPath }
			: {
					...parseMarkdownDocument({ path: `fixture:${id}`, markdown }),
					urlPath,
				};
	const findings = validateDocuments({
		documents: [document],
		surface,
		origin: ORIGIN,
		documentsById: new Map([[urlPath, document]]),
	});
	return fixture(id, note, input, findings);
}

function timeoutError() {
	return Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
}

async function buildFixtures({ surface }) {
	const asset =
		[...surface.publicFiles].find((path) => /\.(?:png|webp|jpg|jpeg)$/.test(path)) ??
		'/share/example/assets/image.webp';

	const internal404 = validateFixture({
		id: 'internal-404',
		note: '内部リンクの 404。Issue の「release fail」側。',
		input: '<a href="/portfolio/does-not-exist">missing</a>',
		html: '<a href="/portfolio/does-not-exist">missing</a>',
		urlPath: '/portfolio/example-project',
		surface,
	});

	const externalTimeoutFindings = await checkExternalTargets(['https://example.com/slow'], {
		fetchImpl: async () => {
			throw timeoutError();
		},
		timeoutMs: 5000,
		origin: ORIGIN,
	});
	const externalTimeout = fixture(
		'external-timeout',
		'外部ホストの timeout。release は止めず warning に区分する。',
		'HEAD https://example.com/slow — 5000 ms timeout',
		externalTimeoutFindings,
	);

	const imageAlt = validateFixture({
		id: 'image-alt-missing',
		note: 'alt の無い画像。アクセシビリティ上の error。',
		input: `<img src="${asset}">`,
		html: `<img src="${asset}">`,
		urlPath: '/portfolio/example-project',
		surface,
	});

	const image404 = validateFixture({
		id: 'image-404',
		note: '存在しない画像 src。release fail。',
		input: '<img alt="broken" src="/share/example/missing.webp">',
		html: '<img alt="broken" src="/share/example/missing.webp">',
		urlPath: '/portfolio/example-project',
		surface,
	});

	const validContent = validateFixture({
		id: 'valid-content',
		note: '内部リンクと画像 alt/src が正しい場合。error も warning も出ない。',
		input: `<a href="/about">about</a> <img alt="cover" src="${asset}">`,
		html: `<a href="/about">about</a> <img alt="cover" src="${asset}">`,
		urlPath: '/portfolio/example-project',
		surface,
	});

	const markdownTimeout = validateFixture({
		id: 'markdown-link',
		note: 'Portfolio Markdown の内部リンクも同じ解決器を通る。',
		input: '[project](/portfolio/does-not-exist)',
		markdown: '[project](/portfolio/does-not-exist)',
		urlPath: '/portfolio/example-project',
		surface,
	});

	return [internal404, externalTimeout, imageAlt, image404, validContent, markdownTimeout];
}

async function capture(reportPath) {
	const { chromium } = await import('@playwright/test');
	const sharp = (await import('sharp')).default;
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({
			viewport: { height: 1000, width: 1440 },
			deviceScaleFactor: 2,
		});
		await page.goto(pathToFileURL(reportPath).href, { waitUntil: 'load' });
		const png = await page.screenshot({ fullPage: true });
		const webp = await sharp(png)
			.resize({ width: 1440, withoutEnlargement: true })
			.webp({ quality: 80 })
			.toBuffer();
		mkdirSync(dirname(CAPTURE_PATH), { recursive: true });
		writeFileSync(CAPTURE_PATH, webp);
		process.stdout.write(`captured ${CAPTURE_PATH} (${Math.round(webp.length / 1024)} KB)\n`);
	} finally {
		await browser.close();
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	mkdirSync(options.outDir, { recursive: true });

	const { scan: report, surface } = await scan({ external: false, externalTimeout: 5000 });
	const fixtures = await buildFixtures({ surface });

	const htmlPath = join(options.outDir, 'report.html');
	const markdownPath = join(options.outDir, 'report.md');
	writeFileSync(htmlPath, buildReportHtml({ scan: report, fixtures }), 'utf8');
	writeFileSync(markdownPath, renderMarkdownSummary({ scan: report, fixtures }), 'utf8');

	for (const item of fixtures) {
		process.stdout.write(
			`${item.summary.verdict === 'fail' ? 'FAIL' : 'PASS'}  ${item.id.padEnd(20)} errors=${item.summary.error} warnings=${item.summary.warning}\n`,
		);
	}
	process.stdout.write(
		`repository scan: ${report.summary.error} error(s), ${report.summary.warning} warning(s), ${report.summary.info} info → ${report.summary.verdict.toUpperCase()}\n`,
	);

	if (options.capture) await capture(htmlPath);
	process.stdout.write(`wrote ${htmlPath}\nwrote ${markdownPath}\n`);

	// The artefact documents the measurement even when it fails; a red
	// verdict still needs to be capturable for review.
	if (report.summary.verdict === 'fail') process.exitCode = 1;
}

await main();
