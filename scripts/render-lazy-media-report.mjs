#!/usr/bin/env node
/**
 * render-lazy-media-report — turn the Issue #487 browser measurement
 * into the committed verification image.
 *
 * Input  : `.tmp/lazy-media/{home-before,home-after,tool-route}.json`
 *          (written by `e2e/lazy-media.spec.ts`)
 * Output : `docs/verification/perf/lazy-media-waterfall.webp`
 *
 * Usage:
 *   node scripts/render-lazy-media-report.mjs [--in=<dir>] [--out=<file>]
 *                                          [--tmp=<png path>]
 *
 * Why a script and not a hand-written screenshot
 * ---------------------------------------------
 * The verification image has to be traceable to a measurement, and a
 * measurement has to be reproducible by the next person. Both facts
 * are stronger if the image is *rendered from the same JSON* the CI
 * run produced than if someone cropped a DevTools panel by hand. The
 * image therefore restates the pass criteria and the conditions
 * (browser / network / CPU / source SHA) next to the numbers, so a
 * number can never travel without the context that produced it.
 *
 * Playwright cannot emit WebP, so the page is screenshotted as a PNG
 * under `.tmp/` (AGENTS.md §9: ephemeral verification artefacts are
 * never committed) and converted with the `sharp` devDependency the
 * rest of the tooling already uses. The committed artefact is the
 * WebP; the PNG is disposable.
 */

import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

import { MAX_EVIDENCE_WIDTH, assertEvidenceSize } from './_lazy-media-image.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function arg(name, fallback) {
	const hit = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
}

const inDir = resolve(root, arg('in', '.tmp/lazy-media'));
const outFile = resolve(root, arg('out', 'docs/verification/perf/lazy-media-waterfall.webp'));
const tmpPng = resolve(root, arg('tmp', '.tmp/lazy-media/lazy-media-waterfall.png'));

async function readLeg(file) {
	return JSON.parse(await readFile(join(inDir, file), 'utf8'));
}

function kb(bytes) {
	if (!bytes) return '0 B';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Short, human-readable identity for the commit under measurement. */
function shortSha(leg) {
	return typeof leg.sourceSha === 'string' ? leg.sourceSha.slice(0, 12) : 'unknown';
}

function rule(ok) {
	return `<span class="pill ${ok ? 'ok' : 'ng'}">${ok ? 'PASS' : 'FAIL'}</span>`;
}

function row(label, expected, measured, ok) {
	return `<tr><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(expected)}</td><td class="num">${escapeHtml(measured)}</td><td>${rule(ok)}</td></tr>`;
}

/** Tag a response so the reader can see media / Tool rows at a glance. */
function tagFor(response) {
	if (/^\/tools\/[^/]+\/app\//.test(response.path)) return 'tool';
	if (response.resourceType === 'image' || response.resourceType === 'media') return 'media';
	return '';
}

/** DevTools-style waterfall: the largest first-party responses. */
function waterfallRows(leg) {
	const responses = leg.topResponses ?? [];
	const max = Math.max(1, ...responses.map((response) => response.bytes));
	return responses
		.map(
			(response) => `<tr>
				<td class="path">${escapeHtml(response.path)}</td>
				<td>${escapeHtml(response.resourceType)}</td>
				<td>${tagFor(response) ? `<span class="tag ${tagFor(response)}">${tagFor(response)}</span>` : ''}</td>
				<td class="num">${kb(response.bytes)}</td>
				<td class="bar"><span style="width:${Math.max(2, Math.round((response.bytes / max) * 100))}%"></span></td>
			</tr>`,
		)
		.join('\n');
}

/**
 * The `image` / `media` claim, qualified by the document shape that was
 * actually measured.
 *
 * On the production build the digit WebPs are inlined `data:` URIs, so
 * zero image responses really does mean "no image left the wire for the
 * first paint". On the dev SSR document they are ordinary asset
 * requests, and the same sentence would be false — so the two shapes
 * get different wording instead of one optimistic line.
 */
function mediaCountClaim(leg) {
	const images = leg.resourceTypeCounts?.image ?? 0;
	const media = leg.resourceTypeCounts?.media ?? 0;
	if (leg.digitImagesInlined) {
		return '<code>image</code> / <code>media</code> が 0 であること自体が「初回 Home で画像は 1 枚も wire に出ない」測定結果。';
	}
	return `桁が独立した asset として配信された document（<code>digitImagesInlined=false</code>）なので digit が <code>image</code> 応答として出るのは仕様どおり: image ${images} / media ${media}。`;
}

/**
 * Which document shape the digits were served in, in words the reader
 * of the image can act on. A disabled counter renders no digits at all,
 * which is a third case that is neither "inlined" nor "separate asset".
 */
function inlineShape(leg) {
	if (leg.digitImageCount === 0) {
		return '桁ストリップ未描画（counter disabled）のため、桁の inline 判定は該当しない。';
	}
	if (leg.digitImagesInlined) {
		return '本番ビルドは桁 WebP（0.2–0.9 KB/枚）を <code>data:image/webp;base64</code> として HTML に inline する（Vite <code>assetsInlineLimit</code>）。したがって本番 document には digit の network リクエストが存在せず、<code>loading</code> 属性は decode スケジューリング（viewport 接近まで復号しない）に効く。wire 上は before / after とも 0 リクエストで差が出ないのが実測であり、この Ticket が 7 → 0 を主張していないのはそのため。';
	}
	return '桁 WebP は独立した asset リクエストとして配信されている。';
}

/**
 * One honest sentence about which document was measured.
 *
 * Derived from the recorded `environment`, never asserted outright: the
 * documented `LAZY_MEDIA_ENV='dev server (vite dev)'` run measures a
 * dev SSR document, and printing "pnpm run build output, not the dev
 * server" over it would caption a different document shape as
 * production evidence.
 */
function surfaceDescription(leg) {
	const environment = String(leg.environment ?? '');
	if (/dev server|\bdev\b/i.test(environment)) {
		return 'dev SSR document（<code>vite dev</code> の出力。桁が独立 asset になる環境）';
	}
	return '<code>pnpm run build</code> 出力（dev server ではない）';
}

function render({ before, after, tool }) {
	const hasDigits = after.digitImageCount > 0;
	const conditions = `
		<h2>測定条件 / measurement conditions</h2>
		<table class="kv">
			<tr><th>surface</th><td><code>${escapeHtml(after.environment)}</code> — ${surfaceDescription(after)}</td></tr>
			<tr><th>browser</th><td>${escapeHtml(after.browser)}（Playwright 同梱）</td></tr>
			<tr><th>network</th><td>${escapeHtml(after.profile)} / CDP <code>Network.emulateNetworkConditions</code></td></tr>
			<tr><th>CPU</th><td>×${escapeHtml(after.cpuThrottlingRate)} / CDP <code>Emulation.setCPUThrottlingRate</code></td></tr>
			<tr><th>viewport</th><td>${after.viewport.width}×${after.viewport.height} / context ごとに cache 空</td></tr>
			<tr><th>third-party</th><td>GA4 / Google Fonts は遮断（本 Issue の対象外。オフライン再現を保証するため）</td></tr>
			<tr><th>source SHA</th><td><code>${escapeHtml(shortSha(after))}</code>${after.trackedTreeDirty ? ' <em>(dirty: 追跡ファイルに未コミットの変更あり)</em>' : ' (tracked tree clean)'}</td></tr>
			<tr><th>measured at</th><td>${escapeHtml(after.generatedAt)}</td></tr>
		</table>`;

	const digitRows = hasDigits
		? [
				row(
					'初回 Home の digit WebP リクエスト（load イベントまで）',
					'0',
					String(after.digitImagesBeforeLoad),
					after.digitImagesBeforeLoad === 0,
				),
				row(
					'スクロール後に復号できた digit',
					'7',
					String(after.loadedImageCount),
					after.loadedImageCount === 7,
				),
			].join('\n')
		: `<tr><td colspan="4"><em>counter disabled（<code>MY_WEB_2026_CONSUMER_API_KEY</code> 未設定）: digit strip 自体が未描画のため該当なし</em></td></tr>`;

	const criteria = `
		<h2>合格基準 / pass criteria</h2>
		<table class="grid">
			<thead><tr><th>rule</th><th>expected</th><th>measured</th><th>result</th></tr></thead>
			<tbody>
				${row(
					'初回 Home の Tool artifact リクエスト（/tools/&lt;slug&gt;/app/**）',
					'0',
					String(after.toolArtifactResponses.length),
					after.toolArtifactResponses.length === 0,
				)}
				${row(
					'初回 Home の iframe / video / audio 数（hydration 後の live DOM）',
					'0',
					String(after.embeddedMediaCount ?? after.iframeSrcs.length),
					(after.embeddedMediaCount ?? after.iframeSrcs.length) === 0,
				)}
				${row(
					'&lt;img&gt; の loading 明示',
					'全件',
					`${after.imgTags.filter((tag) => /loading="(lazy|eager)"/.test(tag)).length}/${after.imgTags.length}`,
					after.imgTags.length > 0 &&
						after.imgTags.every((tag) => /loading="(lazy|eager)"/.test(tag)),
				)}
				${digitRows}
				${row(
					'/tools/&lt;slug&gt; の iframe src（操作開始で装载）',
					'/tools/prototype/app/index.html',
					escapeHtml(tool.iframeSrcs[0] ?? '(none)'),
					tool.iframeSrcs[0] === '/tools/prototype/app/index.html',
				)}
				${row(
					'/tools/&lt;slug&gt; の Tool artifact リクエスト（明示遷移後に必ず取得）',
					'>= 1',
					String(tool.toolArtifactResponses.length),
					tool.toolArtifactResponses.length > 0,
				)}
			</tbody>
		</table>`;

	const shape = inlineShape(after);

	const ab = `
		<h2>before / after（同一ビルド・同一ブラウザ・同一 throttle、<code>loading</code> 属性だけを変えた A/B）</h2>
		<table class="grid">
			<thead><tr><th>leg</th><th class="num">digit 取得（load 前）</th><th class="num">digit 取得（合計）</th><th class="num">応答数</th><th class="num">document bytes</th><th class="num">asset bytes</th></tr></thead>
			<tbody>
				<tr><td>before — #487 以前の markup（<code>loading</code> / <code>decoding</code> 属性を除去した同一 body）</td><td class="num">${before.digitImagesBeforeLoad}</td><td class="num">${before.digitImagesAfterScroll}</td><td class="num">${before.responseCount}</td><td class="num">${after.documentBytesPreTicket.toLocaleString('en-US')}</td><td class="num">${kb(before.totalBytes)}</td></tr>
				<tr><td>after — <code>loading="lazy"</code> 宣言（main）</td><td class="num">${after.digitImagesBeforeLoad}</td><td class="num">${after.digitImagesAfterScroll}</td><td class="num">${after.responseCount}</td><td class="num">${after.documentBytes.toLocaleString('en-US')}</td><td class="num">${kb(after.totalBytes)}</td></tr>
			</tbody>
		</table>
		<p class="note">${shape} この 2 属性そのものが home HTML に載せるコストは ${(
			after.documentBytes - after.documentBytesPreTicket
		).toLocaleString(
			'en-US',
		)} bytes（7 枚 × （<code> loading="lazy"</code> + <code> decoding="async"</code>））。</p>`;

	const waterfall = `
		<h2>waterfall — home first paint（after leg, first-party responses）</h2>
		<table class="grid">
			<thead><tr><th>path</th><th>type</th><th>tag</th><th class="num">bytes</th><th></th></tr></thead>
			<tbody>${waterfallRows(after)}</tbody>
		</table>
		<p class="note">resource type 内訳: ${escapeHtml(
			Object.entries(after.resourceTypeCounts ?? {})
				.map(([type, count]) => `${type} ${count}`)
				.join(' / '),
		)} — ${mediaCountClaim(after)}
		/tool 側: <code>${escapeHtml(tool.path)}</code> で Tool artifact ${tool.toolArtifactResponses.length} 件、document ${kb(tool.documentBytes)}。</p>`;

	return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 44px; background: #fbfbfd; color: #0b1020;
         font-family: -apple-system, "Helvetica Neue", "Hiragino Sans", "Noto Sans JP", sans-serif; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 15px; margin: 28px 0 10px; text-transform: uppercase; letter-spacing: 0.08em;
       color: #556; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  p.lead { margin: 0 0 6px; color: #334; font-size: 14px; }
  p.note { margin: 8px 0 0; color: #44506a; font-size: 12.5px; line-height: 1.65; }
  .tag { display: inline-block; padding: 0 7px; border-radius: 999px; font-size: 10.5px;
         font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
  .tag.tool { background: #fde3d6; color: #a3441b; }
  .tag.media { background: #dce7fd; color: #1c3f9e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
         background: #eef1f7; padding: 1px 5px; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; background: #fff;
          border: 1px solid #dfe3ec; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #eceff5; vertical-align: top; }
  thead th { background: #f2f4f9; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #556; }
  tbody tr:last-child td { border-bottom: 0; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
            word-break: break-all; }
  table.kv th { width: 170px; background: #f7f8fc; font-weight: 600; color: #334; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px;
          font-weight: 700; letter-spacing: 0.06em; }
  .pill.ok { background: #dcf5e6; color: #0a6b39; }
  .pill.ng { background: #fde0e0; color: #97121b; }
  td.bar { width: 34%; }
  td.bar span { display: block; height: 8px; border-radius: 4px; background: #4f6bed; }
  .foot { margin-top: 26px; font-size: 12px; color: #667; }
</style></head>
<body>
  <h1>Lazy media / iframe contract — browser waterfall</h1>
  <p class="lead">Issue #487 ・ 初回 Home 表示が訪問者未要求の asset を取得しないことの測定</p>
  ${conditions}
  ${criteria}
  ${ab}
  ${waterfall}
  <p class="foot">再現: <code>pnpm run build &amp;&amp; pnpm run e2e -- e2e/lazy-media.spec.ts &amp;&amp; pnpm run lazy-media:report</code>
  / 契約テスト: <code>test/integration/lazy-media-contract.test.ts</code>（validate:fast で常時実行）</p>
</body></html>`;
}

/**
 * Refuse to render an A/B from legs that did not come from the same
 * run.
 *
 * `.tmp/lazy-media/` is per-leg JSON, so re-running one Playwright test
 * overwrites only its own file and leaves the other two behind. Without
 * this check the report would silently pair a fresh `after` with a stale
 * `before` / `tool` leg — different commit, different profile, different
 * build — and print the `after` leg's SHA and conditions at the top as if
 * they described all of them. A wrong number wearing a right caption is
 * the exact failure mode this script exists to prevent.
 */
const RUN_IDENTITY_FIELDS = [
	'sourceSha',
	'environment',
	'profile',
	'cpuThrottlingRate',
	'trackedTreeDirty',
	'viewport',
];

function assertSameRun(legs) {
	const [reference, ...rest] = legs;
	for (const leg of rest) {
		for (const field of RUN_IDENTITY_FIELDS) {
			const a = JSON.stringify(reference[field] ?? null);
			const b = JSON.stringify(leg[field] ?? null);
			if (a !== b) {
				throw new Error(
					`render-lazy-media-report: leg "${leg.label}" has ${field}=${b}, but "${reference.label}" has ${a} — the legs come from different runs, so the A/B would compare unrelated numbers. Re-run the whole spec: pnpm run e2e -- e2e/lazy-media.spec.ts`,
				);
			}
		}
	}
}

const [before, after, tool] = await Promise.all([
	readLeg('home-before.json'),
	readLeg('home-after.json'),
	readLeg('tool-route.json'),
]);

assertSameRun([after, before, tool]);

const html = render({ before, after, tool });
// A verification image is evidence. An `undefined` or a `NaN` inside it
// is not a rendering glitch to be ignored — it is a measurement that
// failed, and shipping it would put a wrong number in front of a
// reviewer. Fail the render instead.
for (const poison of ['undefined', 'NaN']) {
	if (html.includes(poison)) {
		throw new Error(
			`render-lazy-media-report: the report contains "${poison}" — a measurement field is missing, so the image would be evidence of nothing`,
		);
	}
}
await mkdir(dirname(tmpPng), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
	viewport: { width: 1600, height: 900 },
	deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: 'load' });
const png = await page.screenshot({ fullPage: true });
await browser.close();

await mkdir(dirname(outFile), { recursive: true });
// Encode to a staging path first: the README promises an over-budget
// image is never committed, and the only way to keep that promise when
// the check fails is to not have put the file at the committed path yet.
const staging = `${outFile}.staging`;
const info = await sharp(png)
	.resize({ width: MAX_EVIDENCE_WIDTH, withoutEnlargement: true })
	.webp({ quality: 80 })
	.toFile(staging);
try {
	assertEvidenceSize(info.size, outFile.replace(`${root}/`, ''));
	await rename(staging, outFile);
} catch (error) {
	await rm(staging, { force: true });
	throw error;
}

console.log(
	[
		`report: ${shortSha(after)} · ${after.profile}`,
		`digit images before load: before=${before.digitImagesBeforeLoad} after=${after.digitImagesBeforeLoad}`,
		`tool artifact requests on home: ${after.toolArtifactResponses.length} / on tool route: ${tool.toolArtifactResponses.length}`,
		`wrote ${outFile.replace(`${root}/`, '')} (${Math.round(info.size / 1024)} KB)`,
	].join('\n'),
);
