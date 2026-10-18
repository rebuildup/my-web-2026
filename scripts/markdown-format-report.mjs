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
 *   node scripts/markdown-format-report.mjs [--out <dir>]
 *
 * `--out` defaults to `.tmp/markdown-format-report/`, which is gitignored.
 * The committed artefact is the screenshot the PR embeds, not this page.
 *
 * Why a Vite server: the renderer is a `.tsx` component whose class names
 * come from the generated Panda package, so Node cannot import it directly.
 * Vite already ships as the build tool and runs the same transform Storybook
 * runs, which keeps the report's styling identical to the preview's.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportHtml, evaluateContract, markupIsInert } from './_markdown-format-report.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(REPO_ROOT, 'src/portfolio/fixtures/markdown');
const DEFAULT_OUT_DIR = join(REPO_ROOT, '.tmp/markdown-format-report');
const SITE_ORIGIN = 'https://rebuildup.dev';

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

function parseArgs(argv) {
	const outIndex = argv.indexOf('--out');
	return {
		outDir: outIndex === -1 ? DEFAULT_OUT_DIR : resolve(REPO_ROOT, argv[outIndex + 1]),
	};
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
		const [{ PortfolioMarkdown }, { createElement }, { renderToStaticMarkup }] = await Promise.all([
			server.ssrLoadModule('/src/portfolio/components/Markdown.tsx'),
			import('react'),
			import('react-dom/server'),
		]);
		return FIXTURES.map((fixture) => {
			const source = readFileSync(join(FIXTURE_DIR, fixture.file), 'utf8');
			const html = renderToStaticMarkup(
				createElement(PortfolioMarkdown, { source, siteOrigin: SITE_ORIGIN }),
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
	const { outDir } = parseArgs(process.argv.slice(2));
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
	process.stdout.write(`\nwrote ${reportPath}\n`);
	if (notInert.length > 0) {
		process.stderr.write(
			`error: rendered markup was not inert for: ${notInert.map((f) => f.id)}\n`,
		);
		process.exitCode = 1;
	}
}

await main();
