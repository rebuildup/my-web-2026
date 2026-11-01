#!/usr/bin/env node
/**
 * Tool preview capture (Issue #785).
 *
 * The `/tools` index shows a screenshot for the Tools whose screen
 * explains them better than a sentence does (owner instruction
 * 2026-11-01: ツールの内容が分かりづらい。スクショなど貼ると適切). The
 * committed artefacts are `public/tools/<slug>/overview.webp`; this
 * script is the committed capture, so the image is evidence rather
 * than an assertion. The files are claimed by
 * `quality/asset-license-inventory.json` (record `tool-preview-screens`),
 * and `scripts/check-asset-licenses.mjs` audits `public/**`, so a
 * preview that nobody recorded is a red gate.
 *
 * What it captures
 * ----------------
 * The Tool's own frame, not the host chrome: the `/tools/<slug>` shell
 * renders the Tool in an `<iframe sandbox="allow-scripts">`, and the
 * screenshot is taken from that element's box. That is the surface a
 * visitor sees after choosing a row, and it keeps the host's nav /
 * breadcrumb out of a thumbnail that illustrates the Tool.
 *
 * Capture conditions (pinned, so a re-run re-renders the same screen):
 *   - Chromium via `@playwright/test`, viewport 1440 × 900,
 *     `deviceScaleFactor: 1`, `colorScheme: 'light'`,
 *   - the page is served by `pnpm run build && pnpm run preview`
 *     (the build is what produces `dist/client/tools/<slug>/app/`),
 *   - `waitUntil: 'networkidle'` plus a non-empty Tool body TEXT check
 *     (polled, because a Tool may draw its screen in absolutely
 *     positioned panels and report a 0-height `<body>`), so a blank
 *     frame fails the capture instead of being committed,
 *   - the host analytics consent banner (Issue #495) and the Tool's
 *     own third-party consent notice are both declined/activated the
 *     way a visitor can, and the frame is aligned to the viewport
 *     before the shot, so the image is the Tool and nothing else,
 *   - encoding: width 800 px (`withoutEnlargement`), WebP `quality: 80`
 *     with the `sharp` devDependency — the same encoder the other
 *     capture scripts use, no new dependency.
 *
 * Byte-identity: the WebP encode is deterministic for a given PNG, but
 * browser rasterisation is not bit-reproducible across processes, so a
 * re-run yields a visually identical file, not an identical one. The
 * committed artefact is one concrete run of this script.
 *
 * Usage:
 *   pnpm run build && pnpm run preview &        # serves on 4173
 *   pnpm run capture:tool-previews              # writes both previews
 *   pnpm run capture:tool-previews -- http://127.0.0.1:4174 .tmp/previews
 *
 * No secrets are involved: the only reads are the local preview server
 * and the Tool frames it serves.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

/** The Tools that ship a preview. Keep in step with the index. */
export const PREVIEW_TARGETS = [
	{
		slug: 'prototype',
		/** What the committed artefact must show, for a human re-check. */
		expect: 'ProtoType のタイピングゲーム画面',
	},
	{
		slug: 'readmark',
		expect: 'readmark の読書画面',
	},
];

const OUTPUT_WIDTH = 800;
const WEBP_QUALITY = 80;

// `pnpm run … -- <arg>` forwards the `--` separator to the script.
const cliArgs = process.argv.slice(2).filter((arg) => arg !== '--');
const baseUrl = cliArgs[0] ?? 'http://127.0.0.1:4173';
const outputRoot = resolve(cliArgs[1] ?? 'public/tools');

const browser = await chromium.launch();
try {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
		colorScheme: 'light',
	});
	const page = await context.newPage();

	for (const target of PREVIEW_TARGETS) {
		const url = `${baseUrl}/tools/${target.slug}`;
		await page.goto(url, { waitUntil: 'networkidle' });

		// The host's own analytics consent banner (Issue #495) floats
		// over the Tool frame and would cover the middle of the
		// screenshot. Decline it the way a visitor can: that sends no
		// measurement and leaves the Tool's screen visible. This is a
		// capture step, not a consent record — the click happens in a
		// throwaway browser context.
		const deny = page.locator('[data-testid="analytics-consent-deny"]');
		if ((await deny.count()) > 0) {
			await deny.first().click();
			await page.waitForTimeout(300);
		}

		// A Tool that declares third-party contacts renders a consent
		// notice and mounts no iframe until the visitor activates it
		// (`src/tools/embed-privacy.ts`). Activate the same way a
		// visitor does; the screenshot is then the Tool's real screen.
		const activate = page.locator('[data-testid="tool-embed-consent-activate"]');
		if ((await activate.count()) > 0) {
			await activate.first().click();
		}

		const frameElement = page.locator('iframe').first();
		await frameElement.waitFor({ state: 'visible', timeout: 30_000 });
		const frame = page.frameLocator('iframe').first();

		// A blank Tool frame is not evidence, so poll its TEXT rather
		// than waiting for `<body>` to be "visible": a Tool that lays
		// its screen out in absolutely positioned panels can report a
		// 0-height body box while the screen is fully drawn (ProtoType
		// does exactly that), so a visibility probe times out on a
		// good frame. Text is the signal that the module actually ran.
		let bodyText = '';
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			bodyText = (
				await frame
					.locator('body')
					.innerText()
					.catch(() => '')
			).trim();
			if (bodyText.length > 20) break;
			await page.waitForTimeout(250);
		}
		if (bodyText.length <= 20) {
			throw new Error(
				`${target.slug}: Tool frame looks blank (${bodyText.length} chars) — not committing a blank preview`,
			);
		}
		// Clicking the consent button scrolls the host page (the button
		// sits below the fold), which leaves the frame's top edge
		// off-screen; an element screenshot then clips that strip and
		// fills it with the host background. Align the frame to the
		// viewport first so the screenshot is the Tool's whole screen.
		await frameElement.evaluate((el) => el.scrollIntoView({ block: 'start' }));
		// Let the first paint after the text settle (fonts, images).
		await page.waitForTimeout(1_000);

		const png = await frameElement.screenshot({ type: 'png' });
		const webp = await sharp(png)
			.resize({ width: OUTPUT_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toBuffer();

		const outPath = join(outputRoot, target.slug, 'overview.webp');
		mkdirSync(dirname(outPath), { recursive: true });
		await sharp(webp).toFile(outPath);
		const meta = await sharp(outPath).metadata();

		console.log(
			`[capture-tool-previews] ${target.slug}: ${url} -> ${outPath} (${meta.width}×${meta.height}, ${webp.length} bytes) — expect: ${target.expect}`,
		);
	}

	console.log(
		`[capture-tool-previews] wrote ${PREVIEW_TARGETS.length} preview(s) under ${outputRoot}`,
	);
} finally {
	await browser.close();
}
