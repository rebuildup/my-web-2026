#!/usr/bin/env node
/**
 * Verification report generator for Issue #468 — `security.txt`.
 *
 * Serves the shipped RENDERER (`src/http/security-txt/document.ts`) at
 * the shipped path, under the shipped media type, over the same local
 * HTTP surface the Worker boundary serves — and captures the browser
 * view into `docs/verification/security/security-txt-browser.webp`, the
 * path Issue #468 requires in the PR body with the `.webp` extension
 * substituted for the Issue's literal `.png`.
 *
 * Why a local fixture, and why an APPROVED one
 * --------------------------------------------
 * Issue #468's acceptance conditions say the run happens on a local
 * fixture / test resource and that no destructive production operation
 * may be performed — and the deployed endpoint answers `404` today,
 * because no owner has approved a reporting channel to publish. A `404`
 * screenshot would prove that the gate is closed and nothing about what
 * the acceptance condition actually asks for: a document a browser can
 * read, with the right MIME type and a live expiry.
 *
 * So this script renders an APPROVED fixture the repository does NOT
 * ship, built from RFC 2606 reserved names (`example.invalid`), through
 * the shipped renderer. What it proves is the rendering and the browser
 * view; the deployed `404`, the publication gate, the expiry gate and
 * the cache policy are asserted in
 * `src/http/security-txt/policy.test.ts` and
 * `src/http/security-txt/router.test.ts`, which drive the real router
 * through workerd, through `externalBoundary` and through `SELF.fetch`.
 * This is the same split
 * `scripts/make-sitemap-verification-report.mjs` makes for Issue #420.
 *
 * What the capture cannot show
 * ----------------------------
 *   - HTTPS. The document is served from a loopback HTTP server bound
 *     to `127.0.0.1`, because a local capture needs no certificate.
 *     RFC 9116 §5.7 anticipates exactly this case ("such as localhost")
 *     and asks for extra human validation instead, and TLS itself is a
 *     Cloudflare deployment property — `https://rebuildup.dev` is the
 *     only origin this repository publishes (§3 + ADR-0014).
 *   - the router, the gate and the derived `Canonical:` field. The
 *     shipped `renderSecurityTxt` is the rendering path, but the HTTP
 *     contract lives in `router.test.ts`.
 *
 * Why only the renderer is imported
 * ---------------------------------
 * The repo's `src/**` uses extensionless relative imports, which plain
 * Node ESM cannot resolve, so a Node script can import a
 * dependency-free module (`./document.ts`, which is deliberately
 * import-free) and nothing else. `renderSecurityTxt` is the shipped
 * rendering path, so the bytes on screen are the bytes the Worker would
 * serve.
 *
 * What it deliberately does not do
 * --------------------------------
 *   - no `pnpm run dev` (that path is wired through Infisical, ADR-0015,
 *     and a verification artefact must not depend on a credential store)
 *   - no request to `https://rebuildup.dev` or any other remote origin
 *   - no secret, no Cloudflare binding, no D1 / R2 call
 *   - no `.png` written to disk: Playwright can only encode PNG/JPEG, so
 *     the capture is taken as an in-memory Buffer and re-encoded with
 *     the existing `sharp` devDependency. The target extension is
 *     asserted to be `.webp` before anything is captured.
 *
 * This script is committed so the required screenshot has a
 * reviewable, reproducible source instead of an uncommitted helper
 * (the Issue #452 / #420 convention).
 *
 *   node --experimental-strip-types scripts/make-security-txt-verification-report.mjs
 *   pnpm run verify:security-txt-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/security-txt-verification/`;
 * only the WebP is committed. Chromium must be present
 * (`pnpm run e2e:install`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, '.tmp', 'security-txt-verification');
const DOCUMENT_PATH = join(OUT_DIR, 'security.txt');
const WEBP_TARGET = join(ROOT, 'docs/verification/security/security-txt-browser.webp');
const WEBP_WIDTH = 1280;
const WEBP_QUALITY = 80;

/**
 * Viewport-bound capture: a plain-text document has no growing box, so
 * `fullPage: true` never settles. The height is sized to the fixture's
 * six rendered lines — measured: the last inked row of the capture is
 * row 102 at Chromium's default monospace metrics — plus a margin, so
 * the committed WebP is the document and not mostly empty background.
 */
const VIEWPORT = { width: WEBP_WIDTH, height: 140 };

/**
 * Mirrors `SECURITY_TXT_CACHE_CONTROL` in
 * `src/http/security-txt/router.ts`. It cannot be imported (see the
 * module note above), and the value is pinned by
 * `router.test.ts`; stating it here keeps the local server honest about
 * what the boundary serves.
 */
const CACHE_CONTROL = 'public, max-age=300, must-revalidate';

/**
 * The APPROVED fixture.
 *
 * A deadline derived from the CLOCK rather than a hard-coded year, so
 * the document on screen is always live — RFC 9116 §2.5.5 asks for an
 * `Expires` in the future, and its "less than a year" advice is a
 * RECOMMENDED practice that a fixture can follow without pretending to
 * be a ten-year promise. Reserved-domain contacts, so nothing here can
 * be read as a real reporting channel (RFC 2606 reserves `.invalid` so
 * it can never resolve). The field set is the one RFC 9116 §2 defines,
 * so the screenshot shows what an owner-approved manifest renders.
 */
const APPROVED_FIXTURE = Object.freeze({
	contacts: ['mailto:security@example.invalid', 'https://example.invalid/advisories/new'],
	expires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
	preferredLanguages: ['ja', 'en'],
	encryption: ['https://example.invalid/pgp-key.txt'],
	acknowledgments: ['https://example.invalid/security/acknowledgments'],
});

const renderer = await import(
	pathToFileURL(resolve(ROOT, 'src/http/security-txt/document.ts')).href
);
const { SECURITY_TXT_CONTENT_TYPE, SECURITY_TXT_PATH, renderSecurityTxt } = renderer;

/** Render the fixture with the shipped renderer, not with a copy of it. */
function renderFixture() {
	const body = renderSecurityTxt(APPROVED_FIXTURE);
	// A renderer that ever stopped emitting the ordering the §4 ABNF
	// requires would still produce a screenshot; these checks make the
	// capture fail instead of quietly documenting a broken document.
	const lines = body.replace(/\n$/, '').split('\n');
	const indexOfField = (field) => lines.findIndex((line) => line.startsWith(`${field}: `));
	if (indexOfField('Contact') !== 0) {
		throw new Error(`RFC 9116 §4 violated: Contact is not the first line (${lines[0]})`);
	}
	const expires = indexOfField('Expires');
	if (expires < 1 || lines.length - 1 < expires + 1) {
		throw new Error(`RFC 9116 §4 violated: Expires is missing or misplaced (${lines.at(-1)})`);
	}
	// §2.5.8: one comma-separated field, never one line per language.
	const languages = lines.filter((line) => line.startsWith('Preferred-Languages: '));
	if (languages.length !== 1 || languages[0]?.includes('\n')) {
		throw new Error(
			`RFC 9116 §2.5.8 violated: Preferred-Languages must appear exactly once (${languages.length} lines)`,
		);
	}
	return body;
}

async function shoot(body, target) {
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');

	const server = createServer((req, res) => {
		if (req.url === SECURITY_TXT_PATH) {
			res.writeHead(200, {
				'content-type': SECURITY_TXT_CONTENT_TYPE,
				'cache-control': CACHE_CONTROL,
			});
			res.end(body);
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
		await page.goto(`http://127.0.0.1:${port}${SECURITY_TXT_PATH}`, { waitUntil: 'load' });
		const capture = await page.screenshot();
		return await sharp(capture)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);
	} finally {
		await browser.close();
		await new Promise((closed) => server.close(closed));
	}
}

const body = renderFixture();
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(DOCUMENT_PATH, body, 'utf8');
process.stdout.write(
	`wrote ${DOCUMENT_PATH} (${body.length} B, ${SECURITY_TXT_CONTENT_TYPE}, expires ${APPROVED_FIXTURE.expires})\n${body}`,
);
const info = await shoot(body, WEBP_TARGET);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
);
