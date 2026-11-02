# 開発面の media URL 合成 — Issue #808 の検証記録

確認用サーバー（`http://localhost:3000`、`MY_WEB_2026_DATA_SOURCE=production-readonly`、
本番 D1 / R2 を remote bindings で読む構成）で、`/portfolio` のカバーが
`placeholder` になっていた件の記録。修正は PR #809。

## 1. 修正前（実測）

`/portfolio` の SSR HTML に `<img>` が **0 個**、`<figure role="img">` が 3 個。
3 件とも placeholder 分岐に入っていた。

```html
<figure role="img" aria-label="Aulymo v1 動作 PV (YouTube SewXH0Bbm-c auto-generated thumbnail)" …>
  <span class="…">placeholder</span>
</figure>
```

同じサーバーの `GET /media/portfolio/multislicer/20250503_multi.jpg` は
`200 image/jpeg 417357 B`。**バイトは配信できており、URL が組まれていなかった。**

本番 D1 を `cf d1 query`（read-only SELECT）で確認した実データ:

| slug | visibility | status | cover r2_key |
| --- | --- | --- | --- |
| `aulymo-v01` | public | published | `portfolio/aulymo-v01/aulymo-v01-maxres.jpg` |
| `aulymo-v02` | public | published | `portfolio/aulymo-v02/aulymo-v02-maxres.jpg` |
| `multislicer` | public | published | `portfolio/multislicer/20250503_multi.jpg` |

## 2. 原因

`composeMediaUrl()`（`src/portfolio/media.ts`）は `MEDIA_PUBLIC_BASE_URL` が無いと
`null` を返す。この var は `wrangler.production.jsonc` にだけ宣言され、
`quality/cloudflare-config-drift.json#development.mode_only_bindings.production_only`
にも本番専用として記録されている。開発面には base URL が存在しなかった。

## 3. 修正

`mediaBase()` に解決順を集約した。

1. `MEDIA_PUBLIC_BASE_URL`（あれば従来どおり。本番は `https://rebuildup.dev/media`）
2. `MY_WEB_2026_DATA_SOURCE`（開発にのみ注入される binding / Issue #377）→ 相対 `/media`
3. どちらも無い → `null`（fail-closed）

相対にしたのは、開発面が**同じ Worker の media route** を自分の origin で配信しており、
port が operator の選択だから。Wrangler 設定・drift 記録・本番の合成結果は無変更。

## 4. 修正後（実測）

同じ `:3000` で:

| 画面 | `<img src="/media/…">` | 壊れ | placeholder | 読み込み寸法 |
| --- | --- | --- | --- | --- |
| `/portfolio`（1440） | 3 | 0 | 0 | 1280×720 / 1280×720 / 1920×1920 |
| `/portfolio`（390） | 3 | 0 | 0 | 同上 |
| `/portfolio/multislicer`（1440） | 1 | 0 | 0 | 1920×1920 |

- 404 になった `/media/…` リクエスト: **0**
- `document.scrollWidth > innerWidth`（横 overflow）: 1440 / 390 とも **false**

画像: [`dev-media-after-1440.webp`](dev-media-after-1440.webp) /
[`dev-media-after-390.webp`](dev-media-after-390.webp)（Chromium、
`page.screenshot()` → WebP quality 82）。

## 5. 再現手順

```sh
cd <worktree>
MY_WEB_2026_DATA_SOURCE=production-readonly pnpm run dev -- --port 3000 --strictPort
curl -s http://localhost:3000/portfolio | grep -o '<img src="/media/portfolio[^"]*"'
```

`pnpm run dev` は Infisical dev の `CLOUDFLARE_API_TOKEN` を自動注入する
（remote bindings の preview session 用。値は表示しない）。

## 6. 回帰の固定

`src/portfolio/media.test.ts` に 6 ケース:

- 開発面では `/media/<key>` の相対 URL
- 本番 var があれば絶対 URL が優先
- 空文字は不在扱い
- 私的 namespace / 不正キーは開発面でも `null`
- 非開発面で base 無しは `null` のまま
