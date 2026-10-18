#!/usr/bin/env node
/**
 * Verification report generator for Issue #420 — the XML sitemap.
 *
 * Renders the REAL builder (`src/http/seo/sitemap.ts`) over a
 * deterministic fixture, serves the result as `application/xml`, and
 * captures the browser view into
 * `docs/verification/seo/sitemap-browser.webp` — the path Issue #420
 * requires in the PR body, with the `.webp` extension substituted for
 * the Issue's literal `.png`.
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the
 * capture is taken into a Buffer and re-encoded with the existing
 * `sharp` devDependency as `resize({ width: 1280, withoutEnlargement:
 * true })` followed by `webp({ quality: 80 })`. No intermediate PNG is
 * written to disk (sharp only sees the in-memory Buffer), and the
 * target extension is asserted to be `.webp` so a PNG can never drift
 * back into `docs/`. `sharp` stays a devDependency and is never
 * imported by the Worker / SSR.
 *
 * Why it runs offline instead of against `pnpm run dev`:
 * `pnpm dev` is wired through Infisical (ADR-0015), which a
 * verification artefact must not depend on. The document under test is
 * produced by the same pure module the Worker serves, so the browser
 * view shows the shipped bytes; only the D1-backed project list is
 * replaced by a fixture.
 *
 * Fixture: `PORTFOLIO_SEED` (`src/portfolio/seed.ts`) — the repo's own
 * skeleton portfolio corpus, whose entries are grounded in
 * `docs/personal/domain.md`. Seed rows carry no `updated_at`, so the
 * builder omits `<lastmod>` for them, which is exactly the documented
 * "never guess a modification date" behaviour.
 *
 * This script is committed so the required screenshot has a reviewable,
 * reproducible source instead of an uncommitted helper. It reads no
 * secret and touches no Cloudflare resource.
 *
 *   node --experimental-strip-types scripts/make-sitemap-verification-report.mjs
 *   pnpm run verify:sitemap-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present — `pnpm run e2e:install`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const XML_PATH = join(ROOT, '.tmp', 'sitemap-verification', 'sitemap.xml');
const WEBP_TARGET = join(ROOT, 'docs/verification/seo/sitemap-browser.webp');
const WEBP_WIDTH = 1280;
const WEBP_QUALITY = 80;

/**
 * Chromium's built-in XML viewer has no layout box that grows, so
 * `fullPage: true` never settles and times out. The viewport is sized
 * to fit the whole fixture document and the capture is viewport-bound.
 */
const VIEWPORT = { width: WEBP_WIDTH, height: 1600 };

/** Build the document from the shipped module, not from a copy of it. */
async function renderFixture() {
	const sitemap = await import(pathToFileURL(resolve(ROOT, 'src/http/seo/sitemap.ts')).href);
	const seed = await import(pathToFileURL(resolve(ROOT, 'src/portfolio/seed.ts')).href);
	const projects = seed.PORTFOLIO_SEED.map((entry) => ({
		slug: entry.slug,
		// No `updated_at` on a seed row: NaN is the "unknown timestamp"
		// input the builder must omit rather than guess.
		updatedAt: Number.NaN,
	}));
	return { xml: sitemap.renderSitemapXml(projects), projects };
}

async function shoot(xml, target) {
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');

	const server = createServer((req, res) => {
		if (req.url === '/sitemap.xml') {
			res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
			res.end(xml);
			return;
		}
		res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
		res.end('not found');
	});
	await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
	const { port } = server.address();

	mkdirSync(dirname(target), { recursive: true });
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
		await page.goto(`http://127.0.0.1:${port}/sitemap.xml`, { waitUntil: 'load' });
		const capture = await page.screenshot();
		const info = await sharp(capture)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);
		return info;
	} finally {
		await browser.close();
		await new Promise((closed) => server.close(closed));
	}
}

const { xml, projects } = await renderFixture();
mkdirSync(dirname(XML_PATH), { recursive: true });
writeFileSync(XML_PATH, xml, 'utf8');
process.stdout.write(`wrote ${XML_PATH} (${projects.length} fixture projects, ${xml.length} B)\n`);
const info = await shoot(xml, WEBP_TARGET);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
);
