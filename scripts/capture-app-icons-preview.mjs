#!/usr/bin/env node
/**
 * Verification screen for the app-icon family (Issue #504).
 *
 * The committed artefact is `docs/verification/web/app-icons-preview.webp`
 * — the Issue-required evidence that the icon family is real. A capture
 * nobody can regenerate is an assertion, not evidence, so the generator
 * is committed next to `scripts/generate-app-icons.mjs` (which produces
 * the icons themselves) and the exact capture conditions are fixed here.
 *
 * The Issue named a `.png` path; the artefact is committed as `.webp`
 * instead. A 2360 px device-pixel PNG of a text-dense screen is
 * 351,784 bytes of mostly-flat rows, which bloats the repository
 * permanently; the same content as a moderately compressed WebP is
 * 102,544 bytes (about 3.4x smaller) and renders identically in every
 * browser that can render the site. Playwright cannot emit WebP itself,
 * so the shot is taken into a Buffer and encoded here with the `sharp`
 * devDependency that already generates the icons (no new dependency,
 * no network, offline).
 *
 * What the screen shows, all read from the RUNNING server rather than
 * from source:
 *   - the live `<head>` of a real page (`/contact`, a route with its own
 *     `head()` so the merge is visible),
 *   - each declared link fetched by the browser: status, content type,
 *     decoded pixel size,
 *   - the manifest fetched by the browser with its served content type
 *     and its service-worker registration count (0 — no offline claim),
 *   - the maskable icon under the launcher's circle mask with the
 *     manifest safe zone drawn over it.
 *
 * Capture conditions (pinned, so the artefact is reproducible):
 *   - route `/contact`, Chromium via `@playwright/test`,
 *   - viewport 1180 × 1460 CSS px, `deviceScaleFactor: 2`,
 *   - `colorScheme: 'light'`, `waitUntil: 'networkidle'`,
 *   - clip = the verification panel's own bounding box (never the raw
 *     viewport, which can silently cut the last section off),
 *   - encoding: long edge width 1600 px (`withoutEnlargement`),
 *     WebP `quality: 80`. The capture is 2x device pixels (2360 px
 *     wide), so the resize is a downscale, and the committed file stays
 *     far below the ~300 KB artefact budget.
 *
 * Byte-identity: the encode step is deterministic for a given capture
 * Buffer, but the browser capture itself is not bit-reproducible across
 * processes (sub-pixel text rasterisation), so a re-run yields a
 * visually identical file, not an identical file. The committed artefact
 * is one concrete run of this script.
 *
 * Usage:
 *   pnpm run build && pnpm run preview &     # or any served base URL
 *   pnpm run capture:app-icons-preview       # writes the committed path
 *   pnpm run capture:app-icons-preview -- http://127.0.0.1:4600 .tmp/out.webp
 *
 * No secrets are involved: the page read is `/contact`, and the only
 * values captured are `document.head` and the public static assets.
 */

import { mkdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

/** The one committed artefact path (see module docstring). */
const DEFAULT_OUT = 'docs/verification/web/app-icons-preview.webp';

const baseURL = process.argv[2] ?? 'http://127.0.0.1:4600';
const outPath = resolve(process.argv[3] ?? DEFAULT_OUT);
const route = '/contact';

// The Issue required this artefact as a `.png`; it is committed as
// `.webp` (PNG bloats the repo). Refuse a silent mismatch instead of
// writing a PNG back into `docs/` under a `.webp` name.
if (extname(outPath) !== '.webp') {
	throw new Error(
		`out path must end in .webp (got ${extname(outPath) || '(none)'}: ${outPath}) — this generator commits WebP, never PNG`,
	);
}

/** Encode a raw screenshot Buffer as the committed WebP artefact. */
async function encodeVerificationWebp(screenshot, target) {
	await sharp(screenshot)
		.resize({ width: 1600, withoutEnlargement: true })
		.webp({ quality: 80 })
		.toFile(target);
	return sharp(target).metadata();
}

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 1180, height: 1460 },
	colorScheme: 'light',
	deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto(`${baseURL}${route}`, { waitUntil: 'networkidle' });

const evidence = await page.evaluate(async () => {
	const links = [...document.querySelectorAll('head link')]
		.map((element) => ({
			rel: element.getAttribute('rel') ?? '',
			type: element.getAttribute('type'),
			sizes: element.getAttribute('sizes'),
			href: element.getAttribute('href') ?? '',
		}))
		.filter((link) => ['icon', 'apple-touch-icon', 'manifest'].includes(link.rel));

	const probes = await Promise.all(
		links.map(async (link) => {
			const response = await fetch(link.href, { cache: 'no-store' });
			const decoded =
				link.type === 'image/png'
					? await new Promise((resolve) => {
							const image = new Image();
							image.onload = () => resolve({ width: image.width, height: image.height });
							image.onerror = () => resolve(null);
							image.src = link.href;
						})
					: null;
			return {
				...link,
				status: response.status,
				contentType: response.headers.get('content-type') ?? '(none)',
				decoded,
			};
		}),
	);

	const manifestResponse = await fetch(
		document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? '/site.webmanifest',
		{ cache: 'no-store' },
	);
	const manifest = JSON.parse(await manifestResponse.text());
	const manifestProbe = await Promise.all(
		manifest.icons.map(async (icon) => {
			const response = await fetch(icon.src, { cache: 'no-store' });
			return {
				...icon,
				status: response.status,
				contentType: response.headers.get('content-type'),
			};
		}),
	);

	return {
		pageTitle: document.title,
		probes,
		manifest,
		manifestStatus: manifestResponse.status,
		manifestContentType: manifestResponse.headers.get('content-type') ?? '(none)',
		manifestProbe,
		themeColors: [...document.querySelectorAll('meta[name="theme-color"]')].map((element) => ({
			media: element.getAttribute('media'),
			content: element.getAttribute('content'),
		})),
		serviceWorkers: await navigator.serviceWorker.getRegistrations().then((r) => r.length),
	};
});

await page.evaluate((data) => {
	const css = `
		#icon-verification { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
			background: #ffffff; color: #0f172a; border-bottom: 1px solid #e2e8f0;
			padding: 20px 24px 24px; }
		#icon-verification h1 { font: 700 15px/1.4 ui-monospace, Menlo, monospace; margin: 0 0 2px; letter-spacing: -0.01em; }
		#icon-verification h2 { font: 600 10px/1.4 ui-monospace, Menlo, monospace; margin: 20px 0 8px;
			text-transform: uppercase; letter-spacing: 0.08em; color: #0369a1; }
		#icon-verification p { margin: 0; font-size: 11px; line-height: 1.7; color: #475569; }
		#icon-verification table { border-collapse: collapse; width: 100%; font-size: 11px; }
		#icon-verification th { text-align: left; font-weight: 600; color: #64748b; padding: 4px 8px 4px 0;
			border-bottom: 1px solid #e2e8f0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
		#icon-verification td { padding: 4px 8px 4px 0; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
		#icon-verification code { color: #0369a1; }
		#icon-verification .strip { display: flex; gap: 18px; align-items: flex-end; flex-wrap: wrap; }
		#icon-verification figure { margin: 0; text-align: center; }
		#icon-verification figcaption { font-size: 9px; color: #64748b; margin-top: 6px; line-height: 1.5; }
		#icon-verification .frame { border: 1px solid #e2e8f0; background: #f8fafc; padding: 8px; display: inline-block; }
		#icon-verification .ok { color: #047857; }
	`;
	const style = document.createElement('style');
	style.textContent = css;
	document.head.append(style);

	const panel = document.createElement('section');
	panel.id = 'icon-verification';

	const rows = data.probes
		.map(
			(probe) => `<tr>
				<td><code>${probe.rel}</code></td>
				<td>${probe.sizes ?? '—'}</td>
				<td><code>${probe.href}</code></td>
				<td>${probe.status} ${probe.contentType}</td>
				<td>${probe.decoded ? `${probe.decoded.width}×${probe.decoded.height}` : 'vector'}</td>
			</tr>`,
		)
		.join('');

	const manifestRows = data.manifestProbe
		.map(
			(icon) =>
				`<tr><td><code>${icon.src}</code></td><td>${icon.sizes}</td><td>${icon.purpose}</td><td>${icon.status} ${icon.contentType}</td></tr>`,
		)
		.join('');

	const previewStrip = data.probes
		.filter((probe) => probe.type === 'image/png')
		.map(
			(
				probe,
			) => `<figure><div class="frame"><img src="${probe.href}" width="64" height="64" alt=""></div>
				<figcaption>${probe.sizes}<br>${probe.href.replace('/icons/', '')}</figcaption></figure>`,
		)
		.join('');

	panel.innerHTML = `
		<h1>my-web-2026 — app icon family verification (Issue #504)</h1>
		<p>Live document head read from <code>${location.origin}${location.pathname}</code> — “${data.pageTitle}” —
		Chromium, ${innerWidth}×${innerHeight} CSS px, prefers-color-scheme: light.
		Served by the local preview of the production build.</p>

		<h2>Rendered head links (${data.probes.length})</h2>
		<table><thead><tr><th>rel</th><th>sizes</th><th>href</th><th>response</th><th>decoded</th></tr></thead>
		<tbody>${rows}</tbody></table>

		<h2>Icons as the browser fetched them</h2>
		<div class="strip">${previewStrip}</div>

		<h2>Web App Manifest — ${data.manifestStatus} ${data.manifestContentType}</h2>
		<table><thead><tr><th>src</th><th>sizes</th><th>purpose</th><th>response</th></tr></thead>
		<tbody>${manifestRows}</tbody></table>
		<p style="margin-top:8px">name <code>${data.manifest.name}</code> · short_name <code>${data.manifest.short_name}</code> ·
		display <code>${data.manifest.display}</code> · theme_color <code>${data.manifest.theme_color}</code> ·
		background_color <code>${data.manifest.background_color}</code> ·
		service worker registrations <span class="ok">${data.serviceWorkers}</span> (no offline behaviour declared)</p>

		<h2>theme-color metas</h2>
		<p>${data.themeColors.map((meta) => `<code>${meta.media} → ${meta.content}</code>`).join(' &nbsp;·&nbsp; ')}</p>

		<h2>Maskable crop (Android launcher)</h2>
		<div class="strip">
			<figure><div class="frame" style="position:relative;width:96px;height:96px;overflow:hidden;border-radius:50%">
				<img src="/icons/icon-maskable-512x512.png" width="96" height="96" alt=""
					style="position:absolute;inset:0">
			</div><figcaption>circle mask<br>icon-maskable-512x512.png</figcaption></figure>
			<figure><div class="frame" style="position:relative;width:96px;height:96px;border-radius:22px;overflow:hidden">
				<img src="/icons/icon-maskable-512x512.png" width="96" height="96" alt=""
					style="position:absolute;inset:0">
				<span style="position:absolute;left:9.6px;top:9.6px;width:76.8px;height:76.8px;border:1px dashed #0369a1;border-radius:50%"></span>
			</div><figcaption>squircle mask<br>safe zone = 80% circle</figcaption></figure>
		</div>
	`;
	document.body.prepend(panel);
}, evidence);

// Clip to the panel itself: a viewport shot could cut the last section
// off, and an artefact that silently drops rows is worse than none.
const panel = page.locator('#icon-verification');
const box = await panel.boundingBox();
if (!box) throw new Error('verification panel is not laid out');
mkdirSync(dirname(outPath), { recursive: true });
// No `path`: keep the bytes in memory so they can be re-encoded as WebP
// (Playwright itself only writes PNG/JPEG).
const screenshot = await page.screenshot({ clip: box });
const encoded = await encodeVerificationWebp(screenshot, outPath);
console.log(
	JSON.stringify(
		{
			outPath,
			format: encoded.format,
			width: encoded.width,
			height: encoded.height,
			bytes: encoded.size,
			page: `${baseURL}${route}`,
			links: evidence.probes.length,
			clip: box,
			conditions: {
				viewport: '1180x1460 CSS px',
				deviceScaleFactor: 2,
				colorScheme: 'light',
				waitUntil: 'networkidle',
				clip: 'verification panel bounding box',
				encode: 'sharp resize width<=1600 withoutEnlargement, webp quality 80',
			},
			manifestContentType: evidence.manifestContentType,
			serviceWorkers: evidence.serviceWorkers,
		},
		null,
		2,
	),
);
await browser.close();
