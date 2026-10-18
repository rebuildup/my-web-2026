#!/usr/bin/env node
/**
 * Markdown format regression report (Issue #435).
 *
 * Renders the two Markdown fixtures through the REAL `PortfolioMarkdown`
 * component and writes one standalone HTML page that shows, side by side,
 * the source and what a reader actually gets — plus the five contract
 * checks measured on that render.
 *
 * The fixtures are the same files the Vitest suite and the Storybook
 * stories read, so the artefact cannot drift away from the assertions:
 *
 *   src/portfolio/fixtures/markdown/technical-article.md
 *   src/portfolio/fixtures/markdown/hostile.md
 *
 * Usage:
 *   node scripts/markdown-format-report.mjs [--out <dir>] [--capture]
 *
 * `--out` defaults to `.tmp/markdown-format-report/`, which is gitignored.
 * `--capture` additionally screenshots the generated page and rewrites the
 * committed verification artefact.
 *
 * Why a Vite server: the renderer is a `.tsx` component whose class names
 * come from the generated Panda package, so Node cannot import it directly.
 * Vite already ships as the build tool and runs the same transform Storybook
 * runs, which keeps the report's styling identical to the preview's.
 *
 * Why WebP and not PNG: the Issue names a `.png` path, but Playwright can only
 * write PNG and this artefact is a flat UI screenshot that bloats the repo in
 * that format. The capture therefore screenshots into memory and re-encodes it
 * with `sharp` (width <= 1440, WebP quality 80). No intermediate PNG is ever
 * written to disk.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildReportHtml, evaluateContract, markupIsInert } from './_markdown-format-report.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(REPO_ROOT, 'src/portfolio/fixtures/markdown');
const DEFAULT_OUT_DIR = join(REPO_ROOT, '.tmp/markdown-format-report');
const CAPTURE_PATH = join(REPO_ROOT, 'docs/verification/content/markdown-format-regression.webp');

const FIXTURES = [
	{
		id: 'technical-article',
		title: 'technical-article.md — 対応構文と未対応構文が混在した記事',
		note: '数値・否定・権限の記述が 1 文字も書き換えられないこと。未対応構文は文字として残ることを含む。',
		file: 'technical-article.md',
	},
	{
		id: 'hostile',
		title: 'hostile.md — script / event handler / 危険 scheme の payload',
		note: '実行可能な要素が 1 つも無く、payload は削除されずに inert なテキストとして可視であること。',
		file: 'hostile.md',
	},
];

const USAGE = 'usage: node scripts/markdown-format-report.mjs [--out <dir>] [--capture]';

function parseArgs(argv) {
	const outIndex = argv.indexOf('--out');
	const outValue = outIndex === -1 ? undefined : argv[outIndex + 1];
	if (outIndex !== -1 && !outValue) {
		// `--out` with no directory is a usage error, not a crash with a
		// raw TypeError from `resolve(undefined)`.
		process.stderr.write(`error: --out requires a directory argument\n${USAGE}\n`);
		process.exit(2);
	}
	return {
		capture: argv.includes('--capture'),
		outDir: outValue === undefined ? DEFAULT_OUT_DIR : resolve(REPO_ROOT, outValue),
	};
}

/**
 * Screenshot the report into the committed verification artefact.
 *
 * A FAIL verdict is captured on purpose: the artefact documents a
 * measurement, so a future regression belongs in the diff rather than
 * being hidden by the generator. The generator still exits non-zero when
 * the rendered markup was not inert.
 */
async function captureReport(reportPath) {
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

/**
 * Panda stylesheet for the report, generated from the same tokens the app
 * ships. Missing CSS degrades the artefact to unstyled text; it never
 * fails the run, because the verdict table is the part reviewers read.
 */
function readPandaCss(outDir) {
	const cssPath = join(outDir, 'panda.css');
	try {
		execFileSync('pnpm', ['exec', 'panda', 'cssgen', '--outfile', cssPath], {
			cwd: REPO_ROOT,
			stdio: 'pipe',
		});
		return readFileSync(cssPath, 'utf8');
	} catch (error) {
		process.stderr.write(
			`warning: panda cssgen failed (${error.message.split('\n')[0]}); the report renders unstyled.\n`,
		);
		return '';
	}
}

async function renderFixtures() {
	const { createServer } = await import('vite');
	const server = await createServer({
		configFile: false,
		appType: 'custom',
		logLevel: 'error',
		server: { middlewareMode: true },
	});
	try {
		const [
			{ PortfolioMarkdown, DEFAULT_SITE_ORIGIN },
			{ createElement },
			{ renderToStaticMarkup },
		] = await Promise.all([
			server.ssrLoadModule('/src/portfolio/components/Markdown.tsx'),
			import('react'),
			import('react-dom/server'),
		]);
		return FIXTURES.map((fixture) => {
			const source = readFileSync(join(FIXTURE_DIR, fixture.file), 'utf8');
			const html = renderToStaticMarkup(
				createElement(PortfolioMarkdown, { source, siteOrigin: DEFAULT_SITE_ORIGIN }),
			);
			return {
				...fixture,
				source,
				html,
				checks: evaluateContract({ source, html }),
			};
		});
	} finally {
		await server.close();
	}
}

async function main() {
	const { capture, outDir } = parseArgs(process.argv.slice(2));
	mkdirSync(outDir, { recursive: true });

	const fixtures = await renderFixtures();
	const css = readPandaCss(outDir);
	const reportPath = join(outDir, 'report.html');
	writeFileSync(
		reportPath,
		buildReportHtml({
			heading: 'Markdown 書式 regression レポート (Issue #435)',
			lede: '生成コマンド: node scripts/markdown-format-report.mjs — fixture: src/portfolio/fixtures/markdown/ — レンダラは本番と同じ PortfolioMarkdown を Vite SSR で実行している。',
			css,
			fixtures,
		}),
		'utf8',
	);

	for (const fixture of fixtures) {
		for (const check of fixture.checks) {
			process.stdout.write(
				`${check.status === 'pass' ? 'PASS' : 'FAIL'}  ${fixture.id.padEnd(18)} ${check.id}\n`,
			);
		}
	}
	const notInert = fixtures.filter((fixture) => !markupIsInert(fixture.html));
	if (capture) await captureReport(reportPath);
	process.stdout.write(`\nwrote ${reportPath}\n`);
	if (notInert.length > 0) {
		process.stderr.write(
			`error: rendered markup was not inert for: ${notInert.map((f) => f.id)}\n`,
		);
		process.exitCode = 1;
	}
}

await main();
