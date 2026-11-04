# #903 ポートフォリオメディア描画の実測 — preview では検証不能 / dev では検証可能

Issue: [#903](https://github.com/rebuildup/my-web-2026/issues/903)
branch: `903` / base: `release-0-8-1` @ **`e32f1684`**
記録日: 2026-11-05（JST）。capture 実行 01:13–01:37、curl 証跡取得 01:43。
証跡: [`903/`](903/) の WebP **272 ファイル**（quality 82、合計 17 MB）。

> 既存記録は書き換えていない。#887 段階5の [`887-site-wide-application.md`](887-site-wide-application.md) §6
> （preview harness の coverage gap）と対になる新規追補である。

## 0. 結論（実測値）

| 項目 | 値 |
| --- | --- |
| 対象 | `/portfolio` + その detail 66 ルート = **67 ルート × 390/1280 × light/dark = 268 capture** |
| HTTP 200 | **268/268** |
| failure surface 検出（NOT CAPTURED） | **0** |
| **`naturalWidth === 0` の `<img>`** | **0 件**（目標 0 件を達成） |
| `<img>` loaded / total | **184/184**（全要素 `naturalWidth > 0`） |
| `loaded !== total`（未完了・失敗を含む）の capture | **0** |
| img を持つ capture | 96（24 ルート × 4）／img 不在 capture 172 |
| WebP | 272 ファイル（268 capture + `/portfolio` の tile 分割 +4） |

#887 段階5（preview、356 capture）で失敗したのは 95 capture・失敗 img 180 個・24 ルートだった。
本 run の img 対象 24 ルートは**その 24 ルートと完全一致**し、すべて 0 失敗である（§3.2）。
つまり「素材の欠如でも design system の欠陥でもなく、preview harness が production の絶対 URL を
焼き込むため」という #887 §6 の帰属を、dev harness での再実測で裏付けた。

## 1. なぜ preview では検証不能で、dev では検証可能か

コード（`src/portfolio/media.ts`）:

- `mediaBase()`（`:98`）の解決順: ① `MEDIA_PUBLIC_BASE_URL` → ② `MY_WEB_2026_DATA_SOURCE` が
  あれば `DEVELOPMENT_MEDIA_BASE = '/media'`（`:88`、相対） → ③ どちらも無ければ `null`
  （fail-closed）。**本作業でこの契約は変更していない。**
- `cloudflare.config.ts`: `MEDIA_PUBLIC_BASE_URL` は `ctx.mode === 'production'`（`vite build`）
  のときだけ注入（`:213`）。`vite dev` は development mode なので注入されず、かわりに
  `MY_WEB_2026_DATA_SOURCE` が注入される（`:158`）。

| harness | 配信物 | `mediaBase()` の結果 | `<img src>` | 描画 |
| --- | --- | --- | --- | --- |
| `pnpm dev`（本 run） | source bundle（dev mode） | ② `/media`（相対・同一 origin） | `/media/portfolio/…` | local R2 object が 200 → **描画可能（本 run 実測）** |
| `pnpm preview`（#887） | production build 成果物 | ① `https://rebuildup.dev/media`（build 時に焼き込み） | `https://rebuildup.dev/media/…`（絶対） | production R2 に object 無し → 404 → **検証不能** |

- 焼き込みの出所（#887 §6 再現コマンド (4)、2026-11-04 実測）:
  `.cloudflare/output/v0/workers/default/worker.config.json` に
  `"MEDIA_PUBLIC_BASE_URL":{"type":"text","value":"https://rebuildup.dev/media"}`。
- production の同一 key が 404 であることも #887 §6 で 2026-11-04 に実測済み
  （**本セッションの本番 GET は未実施**）。
- dev の相対 base 自体は #808 / PR #809 の既存記録
  [`../portfolio/dev-media-delivery.md`](../portfolio/dev-media-delivery.md) のもの。
  本 doc はそれを書き換えず、#887 §6 の gap を埋める追補として本 run を記録する。

## 2. 方法

- harness: `.tmp/903-capture.mjs`（#887 stage-5 harness の派生。**gitignored・未追跡**。
  server を `pnpm preview` から `pnpm dev` に変更し、roster を `/portfolio` 系に限定したもの）
- server: `node scripts/e2e-local-bootstrap.mjs --port=17093 -- pnpm dev -- --port 17093 --strictPort`
  （local D1/R2 state `.tmp/d1state/v3` を使用。migrate + seed は idempotent）
- roster: 起動後に `/portfolio` の SSR HTML から `a[href^="/portfolio/"]` を discovery（66 detail）
  + `/portfolio` 自身 = 67
- 手順（#887 §2 と同一）: 全 `<img>` を `loading="eager"` 化 → scroll-through →
  `img.decode()` 明示呼び出し → Chromium fullPage screenshot（WebP quality 82）。
  `scrollHeight > 16000px` は 16000px tile に分割（該当は `/portfolio` のみ、4 capture が各
  2 tile = +4 ファイル）。viewport height 900、`reducedMotion: reduce`、Chromium のみ。
- 測定: `EAGER_PASS` の `loaded = complete && naturalWidth > 0`、
  `failed = complete && naturalWidth === 0`。判定基準は **capture ごとに `loaded === total`**。
- 集計: `.tmp/903-capture-results.json`（268 records、**gitignored・未追跡**）を上記基準で走査。
  本 doc の数値はこの JSON の集計結果である。
- 実行: 2026-11-05 01:13:29（最初の WebP）– 01:36:57（結果 JSON 書き込み）JST。

## 3. 実測値

### 3.1 全体

| 指標 | 値 |
| --- | --- |
| capture 完了 | 268/268 |
| HTTP 200 | 268 |
| NOT CAPTURED（failure surface / エラー） | 0 |
| `<img>` total / loaded / failed（naturalWidth === 0） | 184 / 184 / **0** |
| `loaded !== total` の capture | 0 |
| img 不在（`total === 0`）の capture | 172 |

### 3.2 img を持つ 24 ルート（すべて `loaded === total`）

| ルート | img（4 capture 合算） | failed |
| --- | --- | --- |
| `/portfolio` | 92/92 | 0 |
| 以下 23 detail ルート | 各 4/4 | 0 |

24 ルート（#887 §6 の失敗 24 ルートと**完全一致**）:
`/portfolio`、`icon-tegaki-anime`、`my-sns-icon`、`seishun`、`m5-clock`、`pomodoroom`、
`my-web-2025`、`kosen-fes2025-ending`、`nulloto`、`bansankai`、`kosen-fes-2025`、
`cclub-brochure-2025`、`tegaki-anime`、`reel-2024`、`prototype-brochure`、`liteglow`、
`multislicer`、`ch4nge`、`propose`、`kakumei`、`homura`、`design-001`、`blue-white-design`、
`cclub-brochure-2024`

### 3.3 img 不在の 172 capture

66 detail のうち 43 ルート × 4 = 172 capture は `<img>` 要素が 0 個（`total = 0`）。
描画対象が無いため pass に数えているが、**画像の描画を証明するものではない**。

## 4. curl 証跡（dev origin、2026-11-05 01:43 JST）

```sh
# server: node scripts/e2e-local-bootstrap.mjs --port=17097 -- pnpm dev -- --port 17097 --strictPort

$ curl -s http://127.0.0.1:17097/portfolio | grep -c 'https://rebuildup.dev/media/'
0
$ curl -s http://127.0.0.1:17097/portfolio | grep -oE 'src="/media/[^"]+"' | sort -u | wc -l
23
$ curl -s -o /dev/null -w 'status=%{http_code} type=%{content_type} bytes=%{size_download}\n' \
    http://127.0.0.1:17097/media/portfolio/bansankai/bansankai/media_1762425899069_vg3qtaccj-vlcsnap-2025-08-13-21h49m26s292.png
status=200 type=image/png bytes=2191192
$ … /media/portfolio/blue-white-design/blue-white-design/media_1762423994805_n30y22jcq-Web-1920-2.png
status=200 type=image/png bytes=452648
$ … /media/portfolio/icon-tegaki-anime/icon-tegaki-anime/media_1786783446233_a4460f179e314d3fae4fd0ffc319fd9e-20260408_gif.gif
status=200 type=image/gif bytes=298372
```

- 最初は port 17095 で試したが、**別の process**（他 worktree の server。`lsof` 実測で
  LISTEN 5686）が応答して 404 を返した。`--strictPort` の vite は17095 使用中で起動に失敗する。
  空き port 17097 に差し替えて再取得した（上の値は 17097 の実測）。

## 5. 証跡

- WebP 272 ファイル: [`903/`](903/)。命名
  `portfolio[--<slug>]--{390|1280}-{light|dark}[--partN].webp`。
- 目視確認: `903/portfolio-icon-tegaki-anime--1280-light.webp`（1280×1923）でカバー画像の
  **実像素**（手書きフレーム）を確認。同一枚には GA4 consent バナーが重なって写る。
  **他の capture でのバナー有無は未観測。**
- run log: `.tmp/903-capture-run.log`、結果 JSON: `.tmp/903-capture-results.json`
  （ともに gitignored・未追跡）。

## 6. この記録が証明しないこと

- **production の media 描画**: 本番 R2 未移行（#850）。本セッションの本番 GET は
  **未実施**（#887 §6 の 2026-11-04 実測 404 を引用）。本番への書き込みも行っていない。
- **preview harness の改善**: `src/portfolio/media.ts` の fail-closed 契約は変更していない。
  preview でも media 描画を検証可能にするかは owner 判断（#903 の完了条件）。
- **img 不在 172 capture**: `<img>` が無いだけで、画像の描画を示していない。
- Chromium 単独・静止画・interaction / hover / focus は未検証。
- 画像の**可視領域**（consent バナー等に遮蔽されるか）は測っていない。
  `naturalWidth` は読み込みの測定である。

## 7. 再現コマンド（実測日 2026-11-05）

```sh
# capture（server 起動込み。本 run は 01:13–01:36 の約 24 分）
node .tmp/903-capture.mjs                 # CAPTURE_PORT 既定 17093

# curl 証跡（別ターミナル）
node scripts/e2e-local-bootstrap.mjs --port=17097 -- pnpm dev -- --port 17097 --strictPort
curl -s http://127.0.0.1:17097/portfolio | grep -c 'https://rebuildup.dev/media/'   # → 0
curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' \
  http://127.0.0.1:17097/media/<key>                                                  # → 200 image/* <bytes>
```

> `.tmp/903-capture.mjs` は gitignored・未追跡（#887 の harness も同様に未追跡）。
> 手順の実体は §2 の記述が正であり、roster 発見・eager/decode・tile 分割はすべて
> `scripts/e2e-local-bootstrap.mjs`（tracked）と §2 の記述から再現できる。
