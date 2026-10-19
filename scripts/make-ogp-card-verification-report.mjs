#!/usr/bin/env node
/**
 * Verification report generator for Issue #421.
 *
 * Renders the Open Graph / Twitter card evidence as a static HTML page
 * at `.tmp/ogp-card-report.html` and screenshots that page with the
 * Playwright chromium already installed for the E2E suite into
 * `docs/verification/seo/ogp-preview.webp` — the path Issue #421
 * requires in the PR body, with the `.webp` extension substituted for
 * the Issue's literal `.png` (a committed PNG of this report is about
 * twice the size of the WebP and bloats the repository for no
 * evidentiary gain).
 *
 * What the report shows, and why it is not a screenshot of prose:
 *
 *   1. **the card previews** — one unfurl-shaped card per
 *      representative URL, drawn from the observed `og:*` / `twitter:*`
 *      metadata. The fallback card is embedded inline (it is same-origin
 *      and committed); a `content` image is printed as its URL with an
 *      explicit "not embedded offline" panel instead of an `<img>`,
 *      because a report must render the same on an offline machine as
 *      on CI and a remote media host would silently become a broken box;
 *   2. **the observed metadata table** per surface, including the image
 *      SOURCE (`content` / `fallback`) the engine derived from the
 *      emitted `og:image`;
 *   3. **the contract** (`src/editorial/social-card/contract.json`) the
 *      rows are judged against, including the deferred surfaces;
 *   4. **the gate's own test run** — the real integration suite, not a
 *      re-render.
 *
 * The data comes from `test/integration/fixtures/ogp-card-snapshot.json`,
 * which `test/integration/ogp-card.test.ts` compares with `toEqual`
 * against the real SSR HTML. So the screenshot cannot describe a
 * document CI does not verify (same arrangement as Issue #422's
 * structured-data report).
 *
 * This script is committed so the required screenshot has a reviewable,
 * reproducible source instead of an uncommitted helper. It reads no
 * secret: the suite runs in the workerd pool with dummy bindings and
 * fetches nothing but the Worker under test.
 *
 *   node scripts/make-ogp-card-verification-report.mjs
 *   pnpm run verify:ogp-card-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present — `pnpm run e2e:install`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const JSON_REPORT = join(TMP, 'ogp-card-results.json');
const HTML_REPORT = join(TMP, 'ogp-card-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/seo/ogp-preview.webp');
// The report is a tall, text-dense page, so the width/quality pair is
// tuned for legibility at a committed size well under 300 KB rather
// than for the largest possible image: at 1280px the body copy is
// ~12 px, which reads fine at 100% and keeps the artefact reviewable.
const WEBP_WIDTH = 1200;
const WEBP_QUALITY = 68;

const SUITE = 'test/integration/ogp-card.test.ts';
const SNAPSHOT = join(ROOT, 'test/integration/fixtures/ogp-card-snapshot.json');
const CONTRACT = join(ROOT, 'src/editorial/social-card/contract.json');

/** The policy, in the words a reviewer needs to judge a verdict. */
const RULES = [
	[
		'cardPolicy content-first',
		'og:type / site_name / locale / title / description / url を出し、og:image は「surface 自身の media URL」か「fallbackCard」のどちらか',
	],
	['cardPolicy content-first', 'og:image:alt は空でない（alt の無い画像は公開しない）'],
	[
		'cardPolicy content-first',
		'fallbackCard なら og:image:width / height が contract の宣言値と一致',
	],
	[
		'cardPolicy content-first',
		'twitter:card=summary_large_image、twitter:image = og:image、title / description も og 側と一致',
	],
	[
		'cardPolicy content-first',
		'twitter:image:alt = og:image:alt（Twitter は og 名前空間を読まないため、代替テキストも mirror する）',
	],
	[
		'cardPolicy none',
		'og:image / twitter:image を出さない（出した瞬間に card.undeclared-image finding）',
	],
	['coverage', 'router が serving する /admin 以外の route に entry が無ければ finding'],
	[
		'coverage',
		'declared された fallbackCard が実在する asset でなければ finding（到達不能な og:image を契約しない）',
	],
	['coverage', 'deferredSurfaces（Issue #421 の「記事」）が実 route に化した時点で finding'],
	['inventory', '観測されなかった surface、fetch 失敗、非 200 はいずれも skip ではなく finding'],
];

/** The origin a preview's domain line shows, without the scheme noise. */
function domainOf(url) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function readInputs() {
	return {
		contract: JSON.parse(readFileSync(CONTRACT, 'utf8')),
		snapshot: JSON.parse(readFileSync(SNAPSHOT, 'utf8')),
	};
}

/**
 * One unfurl-shaped card per representative URL.
 *
 * `fallbackImageDataUri` is inlined for the site fallback only; a
 * content image stays a URL with a stated reason, because the report is
 * generated on machines that cannot reach the media host.
 */
function renderCards({ contract, snapshot, fallbackImageDataUri }) {
	const bySamplePath = new Map(contract.routes.map((entry) => [entry.samplePath, entry]));

	return Object.entries(snapshot)
		.map(([samplePath, head]) => {
			const surface = bySamplePath.get(samplePath);
			const isFallback =
				head.ogImage === `${contract.canonicalOrigin}${contract.fallbackCard.path}`;
			const source = head.ogImage ? (isFallback ? 'fallback' : 'content') : 'none';
			const media = isFallback
				? `<img src="${escapeHtml(fallbackImageDataUri)}" alt="${escapeHtml(head.ogImageAlt ?? '')}" />`
				: head.ogImage
					? `<div class="remote">${escapeHtml(head.ogImage)}<span>リモート URL のため埋め込まない（オフラインでも CI でも同じ描画になること優先）</span></div>`
					: `<div class="remote none">og:image なし（contract が cardPolicy none と宣言）<span>summary card: 画像は crawler's own choice</span></div>`;

			return `<section class="card card-${escapeHtml(source)}">
    <header>
      <div class="domain">${escapeHtml(domainOf(head.ogUrl ?? samplePath))}</div>
      <div class="title">${escapeHtml(head.ogTitle ?? '(og:title なし)')}</div>
      <div class="desc">${escapeHtml(head.ogDescription ?? '(og:description なし)')}</div>
    </header>
    <div class="media">${media}</div>
    <footer>
      <code>${escapeHtml(samplePath)}</code>
      <span class="tag">og:image source: ${escapeHtml(source)}</span>
      <span class="tag">${escapeHtml(head.twitterCard ?? '(twitter:card なし)')}</span>
      ${surface ? `<span class="tag muted">contract: ${escapeHtml(surface.path)} / ${escapeHtml(surface.cardPolicy)}</span>` : ''}
    </footer>
  </section>`;
		})
		.join('\n');
}

function renderRows({ contract, snapshot }) {
	const bySamplePath = new Map(contract.routes.map((entry) => [entry.samplePath, entry]));
	return Object.entries(snapshot)
		.map(([samplePath, head]) => {
			const surface = bySamplePath.get(samplePath);
			const isFallback =
				head.ogImage === `${contract.canonicalOrigin}${contract.fallbackCard.path}`;
			const source = head.ogImage ? (isFallback ? 'fallback' : 'content') : 'none';
			return `<tr>
    <td><code>${escapeHtml(samplePath)}</code></td>
    <td><code>${escapeHtml(surface?.cardPolicy ?? '(未宣言)')}</code></td>
    <td><code>${escapeHtml(head.ogType ?? '(absent)')}</code></td>
    <td><code>${escapeHtml(source)}</code></td>
    <td><code>${escapeHtml(head.ogImage ?? '(absent)')}</code></td>
    <td><code>${escapeHtml(head.twitterCard ?? '(absent)')}</code></td>
  </tr>`;
		})
		.join('\n');
}

function renderContract(contract) {
	return contract.routes
		.map(
			(entry) => `<tr>
    <td><code>${escapeHtml(entry.path)}</code></td>
    <td>${entry.public ? 'public' : 'non-public'}</td>
    <td><code>${escapeHtml(entry.status)}</code></td>
    <td><code>${escapeHtml(entry.ogType ?? '—')}</code></td>
    <td><code>${escapeHtml(entry.cardPolicy)}</code></td>
    <td><code>${escapeHtml(entry.samplePath)}</code></td>
    <td class="note">${escapeHtml(entry.note)}</td>
  </tr>`,
		)
		.concat(
			contract.deferredSurfaces
				.map(
					(entry) => `<tr class="deferred">
    <td><code>${escapeHtml(entry.id)}（deferred）</code></td>
    <td>—</td>
    <td><code>not-declared</code></td>
    <td>—</td>
    <td>—</td>
    <td>—</td>
    <td class="note">${escapeHtml(entry.reason)}</td>
  </tr>`,
				)
				.join(''),
		)
		.join('\n');
}

export function renderReport({ report, contract, snapshot, fallbackImageDataUri }) {
	const results = report.testResults ?? [];
	const assertions = results.flatMap((file) =>
		(file.assertionResults ?? []).map((test) => ({
			title: test.fullName ?? test.title,
			status: test.status,
		})),
	);
	const passed = assertions.filter((item) => item.status === 'passed').length;
	const failed = assertions.filter((item) => item.status === 'failed').length;
	const fallbackRows = Object.values(snapshot).filter(
		(head) => head.ogImage === `${contract.canonicalOrigin}${contract.fallbackCard.path}`,
	).length;

	const testRows = assertions
		.map(
			(test) => `<tr class="${escapeHtml(test.status)}">
    <td class="status">${test.status === 'passed' ? 'PASS' : escapeHtml(test.status.toUpperCase())}</td>
    <td>${escapeHtml(test.title)}</td>
  </tr>`,
		)
		.join('\n');

	const ruleRows = RULES.map(
		([scope, text]) =>
			`<tr><td><code>${escapeHtml(scope)}</code></td><td>${escapeHtml(text)}</td></tr>`,
	).join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Open Graph / Twitter card preview — Issue #421</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: 0.02em; color: #5a5a4e; }
  .sub { color: #5a5a4e; margin: 0 0 18px; font-size: 13px; max-width: 1000px; }
  .cards { display: flex; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
  .stat { border: 1px solid #dedcd2; background: #fff; padding: 10px 16px; min-width: 140px; }
  .stat .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .stat .v { font-size: 22px; font-weight: 600; }
  .ok { color: #1c6b3a; }
  .bad { color: #a12020; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
  .card { border: 1px solid #dedcd2; background: #fff; display: flex; flex-direction: column; }
  .card header { padding: 10px 12px 8px; }
  .domain { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #77776a; }
  .title { font-weight: 600; font-size: 15px; margin: 2px 0 4px; }
  .desc { font-size: 12.5px; color: #4a4a40; }
  .media { background: #f1efe6; border-top: 1px solid #eceadf; border-bottom: 1px solid #eceadf; min-height: 116px;
           display: flex; align-items: center; justify-content: center; }
  .media img { width: 100%; display: block; }
  .remote { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #5a5a4e;
            padding: 10px 12px; text-align: center; word-break: break-all; }
  .remote.none { color: #8a5a20; }
  .remote span { display: block; font-family: inherit; margin-top: 6px; color: #8b9099; font-size: 10.5px; }
  .card footer { padding: 8px 12px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .tag { font-size: 10.5px; border: 1px solid #cfd8c9; color: #1c6b3a; padding: 1px 6px; border-radius: 3px; }
  .tag.muted { border-color: #d8cfc9; color: #8a5a20; }
  .card-fallback { border-color: #b9d4c2; }
  .card-none { border-color: #e0d3c8; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; word-break: break-all; }
  tr:last-child td { border-bottom: none; }
  tr.passed .status { color: #1c6b3a; }
  tr.failed .status, tr.failed td { color: #a12020; }
  .status { font-weight: 700; width: 64px; }
  
  .note { color: #4a4a40; font-size: 12.5px; }
  tr.deferred td { background: #fbf7f0; }
  footer.page { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>Open Graph / Twitter card — 代表URLの card preview（Issue #421）</h1>
  <p class="sub">
    workerd test pool 上の <code>${escapeHtml(SUITE)}</code> が実 SSR HTML から観測した meta を
    <code>test/integration/fixtures/ogp-card-snapshot.json</code> に固定し、それをこの report が描いている（同じ gate が同じ値を
    <code>toEqual</code> で照合しているので、画像は CI が検証していない document を描写し得ない）。
    canonical origin は <code>${escapeHtml(contract.canonicalOrigin)}</code>、fallback card は
    <code>${escapeHtml(contract.fallbackCard.path)}</code>（${contract.fallbackCard.width}×${contract.fallbackCard.height}、生成: <code>${escapeHtml(contract.fallbackCard.generator)}</code>）。
  </p>

  <div class="cards">
    <div class="stat"><div class="k">surfaces observed</div><div class="v">${Object.keys(snapshot).length}</div></div>
    <div class="stat"><div class="k">fallback cards</div><div class="v">${fallbackRows}</div></div>
    <div class="stat"><div class="k">tests</div><div class="v">${assertions.length}</div></div>
    <div class="stat"><div class="k">passed</div><div class="v ok">${passed}</div></div>
    <div class="stat"><div class="k">failed</div><div class="v ${failed === 0 ? 'ok' : 'bad'}">${failed}</div></div>
    <div class="stat"><div class="k">deferred</div><div class="v">${contract.deferredSurfaces.length}</div></div>
  </div>

  <h2>card preview</h2>
  <div class="grid">
${renderCards({ contract, snapshot, fallbackImageDataUri })}
  </div>

  <h2>観測された meta</h2>
  <table>
    <thead><tr><th style="width:190px">sample path</th><th style="width:100px">policy</th><th style="width:70px">og:type</th><th style="width:80px">image</th><th>og:image</th><th style="width:150px">twitter:card</th></tr></thead>
    <tbody>
${renderRows({ contract, snapshot })}
    </tbody>
  </table>

  <h2>契約（src/editorial/social-card/contract.json）</h2>
  <table>
    <thead><tr><th style="width:130px">route</th><th style="width:90px">public</th><th style="width:120px">status</th><th style="width:70px">og:type</th><th style="width:110px">cardPolicy</th><th style="width:190px">sample</th><th>note</th></tr></thead>
    <tbody>
${renderContract(contract)}
    </tbody>
  </table>

  <h2>ポリシー</h2>
  <table>
    <thead><tr><th style="width:200px">scope</th><th>判定内容</th></tr></thead>
    <tbody>
${ruleRows}
    </tbody>
  </table>

  <h2>実行結果</h2>
  <table>
    <thead><tr><th style="width:64px">result</th><th>test</th></tr></thead>
    <tbody>
${testRows}
    </tbody>
  </table>

  <footer class="page">my-web-2026 · Issue #421 · report generated locally from the workerd test pool by scripts/make-ogp-card-verification-report.mjs (no CI token, no production access) · committed as docs/verification/seo/ogp-preview.webp (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}).</footer>
</body>
</html>
`;
}

function runSuite() {
	mkdirSync(TMP, { recursive: true });
	execFileSync(
		'pnpm',
		['exec', 'vitest', 'run', SUITE, '--reporter=json', `--outputFile=${JSON_REPORT}`],
		{
			cwd: ROOT,
			stdio: 'inherit',
		},
	);
	return JSON.parse(readFileSync(JSON_REPORT, 'utf8'));
}

async function shoot(htmlPath, target) {
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');
	mkdirSync(dirname(target), { recursive: true });
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 1280, height: 1600 },
		deviceScaleFactor: 1,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		// Playwright cannot emit WebP, so capture into a Buffer (never a
		// file) and re-encode with sharp. The PNG bytes stay in memory.
		const capture = await page.screenshot({ fullPage: true });
		return await sharp(capture)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);
	} finally {
		await browser.close();
	}
}

async function main() {
	const { contract, snapshot } = readInputs();
	const report = runSuite();
	const { default: sharp } = await import('sharp');
	const fallbackImageDataUri = await sharp(join(ROOT, 'public', contract.fallbackCard.path))
		.png()
		.toBuffer()
		.then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`);

	writeFileSync(HTML_REPORT, renderReport({ report, contract, snapshot, fallbackImageDataUri }));
	process.stdout.write(`wrote ${HTML_REPORT}\n`);
	const info = await shoot(HTML_REPORT, WEBP_TARGET);
	process.stdout.write(
		`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
	);
}

const invokedDirectly =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	await main();
}
