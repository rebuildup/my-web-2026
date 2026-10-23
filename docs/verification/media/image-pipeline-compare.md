# TanStack の画像機能と現行 R2 / sharp 経路の比較（Issue #532）

> このファイルは spike の記録であり、**本番の画像配信方式は変更しない**
> （`docs/verification/media/image-pipeline-compare.webp` が検証画像）。
> 判定は「インストール済みの実物」を第一根拠にし、公式ドキュメントで裏を取る。
> 確認できなかったものは「確認できなかった」と書く。

## 結論（採否の推奨）

**TanStack Start の画像最適化への置換は行わない。** インストール済みの
`@tanstack/react-start` 1.168.61 にも、npm の最新 1.169.4 にも、画像を変換
（リサイズ / フォーマット変換 / 画質調整）する API は **存在しない**。
公式ドキュメントも、画像とフォントの扱いを
「CSS・画像サービス・デプロイ先の integration から選ぶ」ものとしており、
Next.js の `next/image` のような組込みは提供していない。

現行の R2 / Worker 配信経路は **バイトをそのまま返す**（変換責務なし）。
もし WebP 化による重量削減を行いたいなら、その責務は
**ビルド / アップロード時** に置き、既存の `sharp` devDependency で
事前変換したバイトを R2 へ入れるのが、この構成での唯一実行可能な選択肢である。
同じサンプル画像で `sharp` WebP q80 は **417,357 → 226,844 bytes（−45.6%）**、
SSIM 0.99396 / PSNR 42.49 dB だった（機械計測）。

TanStack Start 側で**相乗りできる**のは次の 2 つで、どちらも画像バイトを
変えない: ルート `head().links` による Early Hints の `preload as=image`、
および `transformAssets` による asset URL の書き換え。採否は別 ticket の判断とする。

## 出典表（実在 / 非対応 / 未提供）

「実在」「この版には存在しない」「本 PR では採用しない」を分けて書く。

| 機能 | 判定 | 出典 | 確認方法（この worktree で実行） |
| --- | --- | --- | --- |
| TanStack Start の画像変換 API（リサイズ / 形式変換 / 画質） | **この版には存在しない** | `@tanstack/react-start@1.168.61`（`package.json` の依存） | `node_modules/@tanstack/react-start/dist` 全体に `image` の文字列が無い（`grep -ril image …` が 0 件）。`exports` は `.` / `./client` / `./server` / `./plugin/vite` 等のみで画像向け export なし |
| npm 最新版の画像変換 API | **存在しない（最新でも）** | `@tanstack/react-start@1.169.4`（npm `dist-tags.latest`、確認日 2026-10-23） | `npm view @tanstack/react-start version` → 1.169.4。tarball を展開して `dist` に `image` が無いことを確認 |
| 公式ドキュメントの画像最適化ページ | **未提供** | TanStack Start docs index（`https://tanstack.com/start/latest/llms.txt`） | 全 144 行の index に image optimization のページが 1 つも無い（`grep -i image` は "CDN Asset URLs" / "GEO" の語のみ） |
| 画像・フォントの組込み | **この版には存在しない**（公式が明記） | `https://tanstack.com/start/latest/docs/framework/react/comparison` | 表の "Image and font handling" 行が Start = "Choose CSS, an image service, or an integration for your deployment"、Next.js = 組込み `next/image` / `next/font` |
| `transformAssets`（asset URL 書換え） | **実在するが変換ではない** | `https://tanstack.com/start/latest/docs/framework/react/guide/cdn-asset-urls` | manifest 管理の JS / CSS の URL prefix を書き換える機能。ドキュメント自身が "It does not rewrite every URL in your app" と明記（画像バイトの変換ではない） |
| Early Hints の画像 preload | **実在するが変換ではない** | `https://tanstack.com/start/latest/docs/framework/react/guide/early-hints` | ルート `head().links` に `{ rel: 'preload', href, as: 'image' }` を書ける。`imageSrcSet` / `imageSizes` は 103 には serialize されない、と明記 |
| sitemap の `images` | **実在するが変換ではない** | `@tanstack/start-plugin-core`（installed 1.171.50）`dist/esm/rsbuild/schema.d.ts:126` | sitemap エントリの `{ loc, caption, title }`（`<image:image>` 用メタデータ）。画像変換ではない |
| Workers 実行時の画像変換コード | **この版には存在しない** | `src/**` に `sharp` の import が無い | `grep -rn "from 'sharp'" src` が 0 件。`sharp` は `package.json` の **devDependency**（`^0.35.4`）で、capture / report スクリプト専用 |

補足: `@tanstack/*` パッケージ全体（installed の全 17 パッケージ）を
`grep -ril image --include=*.d.ts --include=*.js` で走査した結果、ヒットは
上表の 3 件（router-core のコメント、start-plugin-core の sitemap schema、
start-server-core の `as: 'image'`）だけで、**画像変換 API は 1 つも無い**。

## 現行の R2 / sharp 経路（コード上の根拠）

| 観点 | 事実 | 根拠 |
| --- | --- | --- |
| 配信 | `GET / HEAD /media/:key` が R2 のバイトをそのまま返す。content-type は allowlist（png / jpeg / webp / gif / avif / mp4 / webm）で検査されるだけ | `src/http/media/router.ts` |
| 変換責務 | **リクエスト時は変換しない**。`src/**` に画像コーデックは無い。`sharp` は devDependency で `scripts/**`（capture / report）専用 | `src/http/media/router.ts` / `grep -rn "from 'sharp'" src` = 0 件 / `package.json` |
| cache | オブジェクトに保存された `cacheControl` が最優先。無い portfolio key は `public, max-age=3600`、`reactions/` は content-addressed の immutable | `src/http/media/router.ts`（`mediaCacheControlFor`） |
| CDN | リクエストは Worker を 1 度通り、その後は edge / HTTP cache が新鮮窓の間だけ返す。R2 custom domain が残っている間は Worker を迂回しうる（運用課題として記録済み） | `src/portfolio/media.ts` の doc comment / `src/http/media/router.ts` |
| R2 storage / egress | storage 課金は Standard $0.015/GB-month、egress は **$0.00**（R2 は egress fee なし）。Class B（読み）は $0.36/million | `https://developers.cloudflare.com/r2/pricing/`（2026-10-23 取得） |
| 公開ゲート | namespace（`isPublicMediaKey`）+ 公開承認（D1 の publication 行）を通過したものだけ配信。拒否は常に理由なし 404 | `src/cloudflare/media-visibility.ts` / `src/portfolio/media-approval.ts` |
| アップロード | `scripts/publish-portfolio-production.mjs` は manifest の SHA-256 を検証して **バイトをそのまま** put する（再エンコードしない）。content-type は `image/jpeg` のまま | `scripts/publish-portfolio-production.mjs` / `release-assets/portfolio/0.8.0/manifest.json` |

## 測定（同じサンプル 1 画像）

サンプル: `release-assets/portfolio/0.8.0/multislicer/20250503_multi.jpg`
（1920×1920、417,357 bytes、`image/jpeg`）。**リポジトリに commit 済みの
release asset**で、provenance は同ディレクトリの `manifest.json` に記録されている
（`legacy_blob` / project-owned）。人物の顔・氏名・連絡先・秘密値は含まれない
（画像を目視確認。詳細は「誤読・秘匿情報チェック」）。

| 経路 | 変換 | bytes | 削減 | PSNR (dB) | SSIM (8×8 luma) |
| --- | --- | --- | --- | --- | --- |
| A. 入力（commit 済み asset） | — | 417,357 | — | — | — |
| B. 現行 R2 配信 = TanStack 経路 | なし（保存バイトをそのまま） | **417,357** | 0% | ∞ | 1.00000 |
| C. `sharp` WebP q80（ビルド時候補） | JPEG → WebP | **226,844** | **−45.6%** | 42.49 | 0.99396 |

- B が「現行」と「TanStack 経路」で同じなのは、**TanStack 側に変換機能が
  存在しないため**（=. A と同一バイト）。仮に導入しても B を置き換える
  ものではない。
- PSNR / SSIM は Rec.601 luma・8×8 非重複ウィンドウで機械計算
  （`C1=(0.01·255)²`, `C2=(0.03·255)²`）。数値は
  `.tmp/image-pipeline-compare/report.json`（未 commit）にも残る。
- **画質の主観評価はしていない**（「この見た目でよいか」は人が評価する）。

## コストと SSR への影響

**コスト（実測 / 見込 / 未実測 を区別）**

| 項目 | 種別 | 値 |
| --- | --- | --- |
| R2 storage（入力 JPEG） | **見込**（公表単価 × 1 object） | 417,357 B = 0.000417 GB × $0.015/GB-month ≈ **$0.0000063/月/object**（1,000 objects で $0.0063/月） |
| R2 storage（WebP q80） | **見込** | 226,844 B ≈ $0.0000034/月/object（1,000 objects で $0.0034/月、差 $0.0029/月） |
| R2 egress | **公表値** | $0.00（R2 は egress fee なし） |
| R2 Class B（読み） | **見込** | $0.36/million requests（バイト数に依存しない） |
| Worker CPU（現行） | **実測していない**（画像処理コードが無いため画像由来の CPU は無い、という設計上の主張のみ） | — |
| Worker CPU（リクエスト時変換を足した場合） | **未実測**（このスタックに Worker 側変換は無く、追加実装していない） | — |

金額は Cloudflare の公表単価からの**見込**であり、請求書は読んでいない
（`実測していない`）。

**SSR への影響**

- **現行**: 変換はリクエスト時に走らない。画像は R2 のバイトをストリームする
  だけで、Worker の CPU に画像処理は乗らない（namespace / 承認ゲートの D1
  読みと stream のみ）。`composeMediaUrl` の doc comment は「`srcset` は同じ URL の
  複数サイズを並べられる」と述べており、**サイズ別バリアントの生成責務は
  現状どこにも無い**。
- **`sharp`**: Node 専用。`src/**` にも Worker bundle にも入らない。
  変換するならビルド / アップロード時（`scripts/**`）に閉じる。
- **TanStack Start**: 画像変換の API が無いので、採用しても SSR の変換責務は
  増えない。相乗りできるのは Early Hints の preload と `transformAssets`
  （URL 書換え）のみで、どちらもバイトを変えない。

## 再現手順

中間産物は `.tmp/`（**gitignore 済み**）に置く。commit するのは
`docs/verification/media/image-pipeline-compare.webp` と本ファイルだけ。
新しい npm 依存は追加しない（既存の `sharp` devDependency と `@playwright/test`
を使う）。

```bash
# 1. 出典の確認（インストール済み実物）
node -e "console.log(require('./node_modules/@tanstack/react-start/package.json').version)"
grep -ril "image" node_modules/@tanstack/react-start/dist --include=*.d.ts --include=*.js   # → 0 件
grep -rn "from 'sharp'" src --include=*.ts --include=*.tsx                                  # → 0 件
grep -n '"sharp"' package.json                                                              # → devDependencies

# 2. 計測 + 画像生成（下のスクリプトを .tmp/ に書き出して実行）
mkdir -p .tmp
cat > .tmp/image-pipeline-compare.mjs <<'SCRIPT'
```

/**
 * Issue #532 spike measurement + artefact (kept in .tmp/, gitignored, NOT committed).
 *
 * Input:  release-assets/portfolio/0.8.0/multislicer/20250503_multi.jpg (committed asset)
 * Output: docs/verification/media/image-pipeline-compare.webp
 *         .tmp/image-pipeline-compare/report.json
 *
 * Only the WebP artefact is committed. No new dependency: this uses the existing
 * `sharp` devDependency, exactly like the docs/verification captures.
 */
import sharp from 'sharp';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';

const REPO = process.cwd();
const INPUT = `${REPO}/release-assets/portfolio/0.8.0/multislicer/20250503_multi.jpg`;
const OUT_DIR = `${REPO}/.tmp/image-pipeline-compare`;
const ARTEFACT = `${REPO}/docs/verification/media/image-pipeline-compare.webp`;
const SHARP_QUALITY = 80;
const WIDTH = 1600;
mkdirSync(OUT_DIR, { recursive: true });

const inputMeta = await sharp(INPUT).metadata();
const inputBytes = statSync(INPUT).size;

function grayscale(buffer, info) {
	const { width, height, channels } = info;
	const out = new Float64Array(width * height);
	for (let i = 0; i < width * height; i += 1) {
		out[i] =
			0.299 * buffer[i * channels] +
			0.587 * buffer[i * channels + 1] +
			0.114 * buffer[i * channels + 2];
	}
	return out;
}
function psnr(a, b) {
	let mse = 0;
	for (let i = 0; i < a.length; i += 1) {
		const d = a[i] - b[i];
		mse += d * d;
	}
	mse /= a.length;
	return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}
function ssim(a, b, width, height, window = 8) {
	const C1 = (0.01 * 255) ** 2;
	const C2 = (0.03 * 255) ** 2;
	let total = 0;
	let windows = 0;
	for (let wy = 0; wy + window <= height; wy += window) {
		for (let wx = 0; wx + window <= width; wx += window) {
			let sa = 0;
			let sb = 0;
			let n = 0;
			for (let y = 0; y < window; y += 1) {
				for (let x = 0; x < window; x += 1) {
					const i = (wy + y) * width + (wx + x);
					sa += a[i];
					sb += b[i];
					n += 1;
				}
			}
			const ma = sa / n;
			const mb = sb / n;
			let va = 0;
			let vb = 0;
			let cov = 0;
			for (let y = 0; y < window; y += 1) {
				for (let x = 0; x < window; x += 1) {
					const i = (wy + y) * width + (wx + x);
					const da = a[i] - ma;
					const db = b[i] - mb;
					va += da * da;
					vb += db * db;
					cov += da * db;
				}
			}
			va /= n - 1;
			vb /= n - 1;
			cov /= n - 1;
			total +=
				((2 * ma * mb + C1) * (2 * cov + C2)) /
				((ma * ma + mb * mb + C1) * (va + vb + C2));
			windows += 1;
		}
	}
	return total / windows;
}

// ---- measurements ---------------------------------------------------------
const inputRaw = await sharp(INPUT).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const inputGray = grayscale(inputRaw.data, inputRaw.info);
const sharpPath = `${OUT_DIR}/sharp-webp-q${SHARP_QUALITY}.webp`;
const sharpInfo = await sharp(INPUT).webp({ quality: SHARP_QUALITY }).toFile(sharpPath);
const sharpRaw = await sharp(sharpPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const sharpGray = grayscale(sharpRaw.data, sharpRaw.info);
const sharpPsnr = psnr(inputGray, sharpGray);
const sharpSsim = ssim(inputGray, sharpGray, sharpInfo.width, sharpInfo.height);
const reductionPct = (1 - sharpInfo.size / inputBytes) * 100;

// ---- panels ---------------------------------------------------------------
const PANEL = 372;
const THUMB = 340;
const DIFF_GAIN = 24;
const differ = Buffer.alloc(inputRaw.info.width * inputRaw.info.height);
let diffSum = 0;
for (let i = 0; i < differ.length; i += 1) {
	const d = Math.round(Math.abs(inputGray[i] - sharpGray[i]) * DIFF_GAIN);
	diffSum += Math.abs(inputGray[i] - sharpGray[i]);
	differ[i] = Math.min(255, d);
}
const meanAbsDiff = diffSum / differ.length;

const thumb = (source, name) =>
	sharp(source).resize(THUMB, THUMB, { fit: 'cover' }).png().toFile(`${OUT_DIR}/${name}.png`);
await thumb(INPUT, 'input-thumb');
await thumb(sharpPath, 'sharp-thumb');
await sharp(differ, {
	raw: { width: inputRaw.info.width, height: inputRaw.info.height, channels: 1 },
})
	.resize(THUMB, THUMB, { fit: 'cover' })
	.png()
	.toFile(`${OUT_DIR}/diff.png`);

const esc = (s) =>
	String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

const headerLines = [
	'Issue #532 spike — TanStack Start image features vs the current R2 / sharp path',
	`input: release-assets/portfolio/0.8.0/multislicer/20250503_multi.jpg — ${inputBytes} bytes, ${inputMeta.width}x${inputMeta.height}, ${inputMeta.format}`,
	'@tanstack/react-start 1.168.61 (installed): no image-optimization export; 1.169.4 (npm latest) also has none; the docs index has no image page',
	'machine-checked: bytes / dimensions / format (sharp metadata), PSNR and 8x8-windowed SSIM on Rec.601 luma',
	'not machine-checked: whether the q80 WebP "looks good enough" for the portfolio, and whether preload helps here (human evaluation)',
];
const headerHeight = 30 + headerLines.length * 21 + 34;
const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${headerHeight}">
	<rect width="${WIDTH}" height="${headerHeight}" fill="#f4efdf" />
	<text x="16" y="27" font-family="ui-monospace, Menlo, monospace" font-size="19" font-weight="700" fill="#0b1020">${esc(headerLines[0])}</text>
	${headerLines
		.slice(1)
		.map(
			(line, i) =>
				`<text x="16" y="${51 + 21 * i}" font-family="ui-monospace, Menlo, monospace" font-size="12" fill="#1c2030">${esc(line)}</text>`,
		)
		.join('\n\t')}
</svg>`;

const captions = [
	{
		title: 'A. input (committed asset)',
		sub: '20250503_multi.jpg',
		value: `${inputBytes} bytes · jpeg · 1920x1920`,
	},
	{
		title: 'B. current R2 path = TanStack path',
		sub: 'bytes as stored, no transform',
		value: `${inputBytes} bytes · jpeg · SSIM 1.00000`,
	},
	{
		title: `C. sharp WebP q${SHARP_QUALITY} (build-time candidate)`,
		sub: `sharp-webp-q${SHARP_QUALITY}.webp`,
		value: `${sharpInfo.size} bytes · webp · PSNR ${sharpPsnr.toFixed(2)} dB · SSIM ${sharpSsim.toFixed(5)} · −${reductionPct.toFixed(1)}%`,
	},
	{
		title: 'D. difference (C vs A, x24)',
		sub: 'machine-computed amplification',
		value: `mean abs diff ${meanAbsDiff.toFixed(2)} / 255`,
	},
];
const panels = captions
	.map(
		(panel, i) => `<div class="panel">
		<div class="cap"><strong>${esc(panel.title)}</strong><br/><code>${esc(panel.sub)}</code><br/>${esc(panel.value)}</div>
		<img src="${['input-thumb', 'input-thumb', 'sharp-thumb', 'diff'][i]}.png" width="${THUMB}" height="${THUMB}" />
	</div>`,
	)
	.join('\n\t');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>
	* { box-sizing: border-box; }
	body { margin: 0; padding: 16px 20px 24px; width: ${WIDTH}px; background: #ffffff;
		font-family: ui-monospace, Menlo, monospace; color: #101828; font-size: 12px; }
	.row { display: flex; gap: 16px; align-items: flex-start; }
	.panel { width: ${PANEL}px; }
	.cap { height: 96px; margin-bottom: 8px; line-height: 1.5; }
	.cap code { color: #344054; }
	.panel img { display: block; border: 1px solid #d0d5dd; }
</style></head>
<body><div class="row">
	${panels}
</div></body></html>`;

writeFileSync(`${OUT_DIR}/index.html`, html);

// Render the HTML with Chromium (same devDependency path as the other captures).
const { chromium } = await import('@playwright/test');
const { createServer } = await import('node:http');
const { createReadStream } = await import('node:fs');
const server = createServer((req, res) => {
	const name = (req.url ?? '/').replace(/^\//, '') || 'index.html';
	const type = name.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
	res.writeHead(200, { 'content-type': type });
	createReadStream(`${OUT_DIR}/${name}`).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: WIDTH, height: 400 },
	deviceScaleFactor: 1,
});
const page = await context.newPage();
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });
const pagePng = `${OUT_DIR}/body.png`;
writeFileSync(pagePng, await page.screenshot({ fullPage: true, type: 'png' }));
await context.close();
await browser.close();
server.closeAllConnections?.();
server.close();

const body = await sharp(pagePng)
	.extend({ top: headerHeight, bottom: 0, left: 0, right: 0, background: { r: 244, g: 239, b: 223 } })
	.png()
	.toBuffer();
await sharp(body)
	.composite([{ input: Buffer.from(headerSvg), left: 0, top: 0 }])
	.webp({ quality: 82 })
	.toFile(ARTEFACT);
const artefactMeta = await sharp(ARTEFACT).metadata();
const artefactBytes = statSync(ARTEFACT).size;

const report = {
	issue: '#532',
	input: {
		path: 'release-assets/portfolio/0.8.0/multislicer/20250503_multi.jpg',
		bytes: inputBytes,
		width: inputMeta.width,
		height: inputMeta.height,
		format: inputMeta.format,
	},
	methods: {
		sharpWebp: { quality: SHARP_QUALITY },
		psnr: '10*log10(255^2/MSE) on Rec.601 luma',
		ssim: '8x8 non-overlapping windows on Rec.601 luma, C1=(0.01*255)^2, C2=(0.03*255)^2',
	},
	paths: {
		currentR2: { bytes: inputBytes, transform: 'none (bytes as stored)', ssim: 1 },
		tanstack: { bytes: inputBytes, transform: 'none — no image API in 1.168.61 or 1.169.4', ssim: 1 },
		sharpWebp80: {
			bytes: sharpInfo.size,
			width: sharpInfo.width,
			height: sharpInfo.height,
			psnr: sharpPsnr,
			ssim: sharpSsim,
			reductionPct,
		},
	},
	artefact: { path: 'docs/verification/media/image-pipeline-compare.webp', bytes: artefactBytes, ...artefactMeta },
};
writeFileSync(`${OUT_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

```bash
SCRIPT
node .tmp/image-pipeline-compare.mjs

# 3. 成果物の確認（WebP のみ。PNG は .tmp/ の中間産物だけで commit しない）
file docs/verification/media/image-pipeline-compare.webp   # → RIFF ... Web/P image, 1600x653
git status --short                                          # → PNG が無いこと
```

## 誤読・秘匿情報チェック

- サンプルは `release-assets/portfolio/0.8.0/multislicer/20250503_multi.jpg`。
  **リポジトリに commit 済みの release asset** で、`release-assets/portfolio/0.8.0/manifest.json`
  が provenance（`legacy_blob`、my-web-2025 の media BLOB 由来、project-owned）と
  SHA-256 を記録している。既に公開前提で管理されている画像であり、
  このスパイクで新たな公開物を増やしていない。
- 画像を**目視確認**した: MultiSlicer for Ae（After Effects プラグイン）の
  宣伝グラフィックで、**人物の顔・氏名・連絡先・アカウント・秘密値は写っていない**。
  個人情報（メールアドレス / 電話番号 / 住所 / 鍵）を含まない。
- 本ファイル・検証画像に **R2 の credential、API key、`BETTER_AUTH_*`、
  `MEDIA_PUBLIC_BASE_URL` の実値、bucket 名以外の内部識別子は出していない**。
- 画像生成の中間 PNG（`.tmp/image-pipeline-compare/*.png`）は gitignore され、
  commit していない。リポジトリに新しい PNG は無い。
- 「TanStack に画像機能がある」と読める曖昧な記述をしていない。
  実在（Early Hints preload / `transformAssets` / sitemap `images`）と、
  非提供（画像変換 API が無いこと）を上表で分けている。

## 機械検査と人間の評価の区別

**機械で決まること（この spike が計測したもの）**

- インストール済み package の export と `dist` の文字列（画像 API の有無）
- 画像の bytes / width / height / format（`sharp` metadata）
- PSNR / SSIM（Rec.601 luma、8×8 ウィンドウ、決定的な計算）
- R2 の公表単価に対する storage 見込額（単価 × バイト数）

**人が評価すること（機械では決めない）**

- q80 WebP の見た目が portfolio の作品として**十分か**（劣化の許容判断）
- 作品の視覚的な性格（グラフィックの質感・文字の輪郭）が保たれているか
- Early Hints の preload がこの構成で実際に体感を改善するか
- 画像サービスを導入する運用コストに見合うか

この 2 つは混ぜない。上の測定表は数値であり、「この見た目でよい」は
本 spike の結論ではない。

## この PR で行わないこと

- **本番の画像配信方式の置換**（R2 / Worker 経路はそのまま。`src/**` を変更しない）。
- 新しい npm 依存の追加、`package.json` / `quality/profile.yaml` /
  `scripts/_quality-gate-plan.test.mjs` の変更。
- Storybook の追加（「目視可能」は本 Markdown と WebP で満たす）。
- ビルド時 WebP 変換の実装（採否は別 ticket。ここでは**測定候補**としてのみ提示）。
- Early Hints preload / `transformAssets` の導入（別 ticket の判断）。
- `external/**`（submodule）の変更。

## 既知の制約

- 変換の実測は `sharp`（Node）のビルド時変換 1 点のみ。**Worker 実行時変換は
  このスタックに存在しないため実測していない**。
- SSIM / PSNR は luma 8×8 ウィンドウの実装であり、商用ツールの値と
  厳密一致はしない（手法は上に明記）。参照実装との差は未検証。
- R2 の金額は公表単価からの**見込**で、実請求の確認はしていない。
- TanStack のバージョンは installed 1.168.61 / npm latest 1.169.4（2026-10-23 時点）。
  将来のバージョンで画像 API が追加される可能性は排除しない
  （`export` と `dist` の再確認が必要）。
