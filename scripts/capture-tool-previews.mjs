#!/usr/bin/env node
/**
 * Tool preview capture (Issue #785).
 *
 * The `/tools` index shows a screenshot for the Tools whose screen
 * explains them better than a sentence does (owner instruction
 * 2026-11-01: ツールの内容が分かりづらい。スクショなど貼ると適切). The
 * committed artefacts are `public/tool-previews/<slug>.webp`; this
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
 *   - encoding: width 1200 px (`withoutEnlargement`), WebP `quality: 80`
 *     with the `sharp` devDependency — the same encoder the other
 *     capture scripts use, no new dependency. The width is a layout
 *     requirement, not a taste: the index card is 468 px wide on the
 *     2-up body grid, so a 2× surface needs ≥ 936 px, and the first
 *     committed preview (800 px) was rejected for being under it
 *     (owner decision 2026-11-01). The context renders at
 *     `deviceScaleFactor: 2` so the downscale to 1200 px comes from a
 *     real 2× raster rather than an upscale.
 *
 * Byte-identity: the WebP encode is deterministic for a given PNG, but
 * browser rasterisation is not bit-reproducible across processes, so a
 * re-run yields a visually identical file, not an identical one. The
 * committed artefact is one concrete run of this script.
 *
 * Usage:
 *   pnpm run build && pnpm run preview &        # serves on 4173
 *   pnpm run capture:tool-previews              # writes every target
 *   pnpm run capture:tool-previews -- http://127.0.0.1:4174 .tmp/previews
 *
 * No secrets are involved: the only reads are the local preview server
 * and the Tool frames it serves.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

/**
 * The Tools that ship a preview. Keep in step with
 * `TOOL_PREVIEWS` in `src/routes/tools.index.tsx`.
 *
 * `readmark` returned as a target with the Issue #786 fix: the
 * sandboxed frame used to stop on 「読み込み中…」 (an opaque-origin
 * frame is denied every storage API), and the index therefore
 * carried no image for it. readmark no longer uses browser storage
 * at all (readmark ADR-0008 — session-scoped, stated in one line on
 * screen), so the frame renders the real library screen and the
 * capture photographs it as it is: the owner's rule (an image may
 * not be faked, a defect may not be shown) is satisfied by
 * photographing a working screen.
 *
 * Issue #817 added the first four activated Tools (qr-generator /
 * text-counter / sequential-png-preview / svg2tsx). Their frames are
 * photographed through the same sandboxed iframe a visitor gets, so
 * a blank frame fails the run — the `expect` line of each target is
 * the human re-check for what the committed image must show.
 *
 * `mic-level` is the eighth target (Issue #817 第2陣). Its frame is
 * photographed in the state a visitor meets before any permission
 * decision: the privacy note and the 「マイクを使用する」 button. The
 * capture never grants the microphone, so the image shows the screen
 * as it is — not a simulated meter reading.
 */
export const PREVIEW_TARGETS = [
	{
		slug: 'prototype',
		/** What the committed artefact must show, for a human re-check. */
		expect: 'ProtoType のタイピングゲーム画面',
	},
	{
		slug: 'readmark',
		/** What the committed artefact must show, for a human re-check. */
		expect: 'readmark のライブラリ画面（保存しない一行明示 + 空一覧 + import CTA）',
	},
	{
		slug: 'color-palette',
		/** What the committed artefact must show, for a human re-check. */
		expect:
			'Color Palette Generator の初期画面（左: Algorithm & Limits の設定欄と保存済みパレット欄、右: Generate Colors / Save の操作と生成パレットの表示欄）',
	},
	{
		slug: 'qr-generator',
		/** What the committed artefact must show, for a human re-check. */
		expect:
			'QR Code Generator の画面。左に入力・QRパラメータ・色の設定、右に「Generated QR Code」パネル（初期状態は [ No Data ]）',
	},
	{
		slug: 'text-counter',
		/** What the committed artefact must show, for a human re-check. */
		expect:
			'Text Counter の画面。テキスト入力欄と、文字数・単語数・行数・バイト数などのカウント結果',
	},
	{
		slug: 'sequential-png-preview',
		/** What the committed artefact must show, for a human re-check. */
		expect:
			'Sequential PNG Preview の初期画面。複数ファイル・フォルダ・ZIP の3タブと、PNG を読み込むドロップ領域',
	},
	{
		slug: 'svg2tsx',
		/** What the committed artefact must show, for a human re-check. */
		expect: 'SVG to TSX の画面。SVG入力欄と変換オプション、TSX出力のペイン',
	},
	{
		slug: 'business-mail-block',
		/** What the committed artefact must show, for a human re-check. */
		expect:
			'Business Mail Block Tool の初期画面。見出しと説明の上に「Business」バッジと検索欄・カテゴリフィルタ（全カテゴリ / お気に入り）、タブ（テンプレート / バリデーション / ガイドライン / カスタムブロック）、左に「利用可能なブロック」の挨拶ブロックの一覧、右に「メール作成エリア」（「ここにブロックをドラッグ&ドロップしてください」）',
		slug: 'pomodoro',
		/** What the committed artefact must show, for a human re-check. */
		expect:
			'Pomodoro の実行中の画面。左上に「Warm up」のフェーズ表示、その下にカウントダウン表示（15:00.00 から減っている）、下に作業／休憩のスケジュール一覧',
		/**
		 * The Tool shows its countdown only after the timer is started,
		 * and the first frame of the timer is an empty ring with a
		 * phase label — a faithful picture that says nothing about what
		 * the Tool does. Pressing the timer is what a visitor does, and
		 * the capture waits until the displayed time has actually moved
		 * (i.e. the countdown is running) before it photographs.
		 */
		prepare: async ({ frame, page }) => {
			const timer = frame.locator('button').first();
			const before = (await timer.innerText()).trim();
			await timer.click();
			const deadline = Date.now() + 15_000;
			while (Date.now() < deadline) {
				const now = (await timer.innerText()).trim();
				if (now.length > 0 && now !== before) return;
				await page.waitForTimeout(200);
			}
			throw new Error('pomodoro: the countdown did not start — refusing to commit a still frame');
		},
	},
	{
		slug: 'pi-game',
		/** What the committed artefact must show, for a human re-check. */
		expect:
			'Pi Memory Game の初期画面。タイトルと説明文、左に「全画面」ボタン、中央に「3 to Start」と数字の盤面（7 8 9 / 4 5 6 / 1 2 3）',
	},
	{
		slug: 'fillgen',
		/** What the committed artefact must show, for a human re-check. */
		expect:
			'穴埋めプリントジェネレーターの初期画面。ページ追加ボタン付きのエディタ（ページ1）と、プレビュー／HTML／React タブの出力欄',
	},
	{
		slug: 'code-type-p5',
		/** What the committed artefact must show, for a human re-check. */
		expect:
			'Code Type p5 の再生中の画面。操作欄に「Play」と「Edit Code」のボタンがあり、下のキャンバスにサンプルプログラム（Rust）が色付きソースコードとして描かれている',
		/**
		 * The Tool renders its sample program on the p5 canvas only
		 * while the playback runs, so the un-prepared frame is an empty
		 * canvas. Pressing "Play" is what a visitor does; the capture
		 * then waits until the canvas actually carries ink (measured as
		 * a non-zero channel deviation in the canvas bitmap), so a
		 * blank canvas can never be committed.
		 */
		prepare: async ({ frame, page }) => {
			await frame.getByRole('button', { name: 'Play' }).click();
			const canvas = frame.locator('canvas').first();
			const deadline = Date.now() + 20_000;
			while (Date.now() < deadline) {
				const png = await canvas.screenshot();
				const stats = await sharp(png).stats();
				if (stats.channels.some((channel) => channel.stdev > 1)) return;
				await page.waitForTimeout(300);
			}
			throw new Error('code-type-p5: the canvas stayed blank — refusing to commit a blank frame');
		},
	},
	{
		slug: 'mic-level',
		/** What the committed artefact must show, for a human re-check. */
		expect:
			'Mic Level Checker の初期画面。冒頭に Home / Tools / Mic Level Checker のパンくず、タイトル「Mic Level Checker」、プライバシーに関する注記（音声はこのブラウザ内だけで処理します）、そして「マイクを使用する」ボタン',
	},
];

const OUTPUT_WIDTH = 1200;
const WEBP_QUALITY = 80;

// `pnpm run … -- <arg>` forwards the `--` separator to the script.
const cliArgs = process.argv.slice(2).filter((arg) => arg !== '--');
const baseUrl = cliArgs[0] ?? 'http://127.0.0.1:4173';
const outputRoot = resolve(cliArgs[1] ?? 'public/tool-previews');

const browser = await chromium.launch();
try {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 2,
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
		// A Tool whose own screen only appears after the visitor acts on
		// it (a countdown that must be started, a canvas that only
		// draws while it plays) is prepared the way a visitor would
		// prepare it, and the preparation WAITS for the state it wants
		// (a moved countdown, ink on the canvas). A target that cannot
		// reach its state fails the capture instead of committing the
		// empty state it started from.
		if (target.prepare) {
			await target.prepare({ frame, page });
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

		// One flat namespace, deliberately OUTSIDE `/tools/<slug>/`: that
		// path is the Tool's own artifact tree, and the deploy-artifact
		// gates compare it file-for-file with the built bundle.
		const outPath = join(outputRoot, `${target.slug}.webp`);
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
