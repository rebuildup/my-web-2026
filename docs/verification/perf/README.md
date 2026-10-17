# Performance verification — `docs/verification/perf`

このディレクトリは **1 Issue の検証成果物**置き場です（AGENTS.md §9 の
`.tmp/` は throwaway なので、レビューで再確認できる測定結果はここへ
置きます）。Issue #387 が「UI 以外の 1 Issue/1 PR にも画像付き検証を
必須化する」ticket として独立して走っており、本ディレクトリは #487 が
先に作った先例です。#387 とは重複しません（#387 は policy、本ファイル
は 1 チケットの測定記録）。

---

## Lazy media / iframe の遅延ロード契約（Issue #487）

![Lazy media / iframe waterfall](lazy-media-waterfall.webp)

### 何を保証しているか

初回 Home 表示は、**訪問者がまだ求めていない asset を持ってこない**。
Its rules are pinned in two places, on purpose:

| 层 | ファイル | 種別 | 実行場所 |
| --- | --- | --- | --- |
| markup 契約 | `test/integration/lazy-media-contract.test.ts` | 決定的な契約 | `validate:fast`（全 PR / 全 release push） |
| browser 測定 | `e2e/lazy-media.spec.ts` | 分散のある実測 | Playwright E2E（main / release push、`ui-change` PR） |
| 画像レポート | `scripts/render-lazy-media-report.mjs` | 成果物生成 | 手動（PR 作成時） |

契約の内容:

1. `/` の markup に `<iframe>` / `<video>` / `<audio>` が無い。
2. `/` の markup が Tool artifact（`/tools/<slug>/app/**`）を参照しない。
3. `/` が Tool artifact に対する `preload` / `prefetch` hint を出さない。
4. `/` の `<img>` は **全て** `loading` を明示する（暗黙の `eager` を残さない）。
5. 逆向きの保証: `/tools/<slug>` は **今まで通り** sandbox 付き iframe を
   即時 mount する。Tool artifact の取得は「明示的な遷移の後」にだけ起きる。

規則 5 がない測定は「何もロードしない」ことで全部通ってしまうため、
positive control として必ず残す。

### 実測結果（`docs/verification/perf/lazy-media-waterfall.webp`）

- surface: `pnpm run build` の出力（dev server ではない）
- browser: Playwright 同梱 Chromium
- network: CDP `Network.emulateNetworkConditions` = Fast 4G（9 Mbit/s / 150 ms RTT）
- CPU: CDP `Emulation.setCPUThrottlingRate` = ×4
- third-party: GA4 / Google Fonts は遮断（オフライン再現を保証するため）
- 測定は `.tmp/lazy-media/*.json` に書き出され、画像はその JSON から
  レンダリングされる（数値だけを切り貼りした画像にしない）。
- 画像の source SHA は **2facadc**（tracked tree clean）。その後に積まれた
  コミットは `test/integration/lazy-media-contract.test.ts` の型 narrowed
  1 件だけで、測定対象のコード（`src/**`, `e2e/**`, ビルド出力）には
  差分が無い。ソース SHA を head に合わせる必要はありません。

### before / after と合格基準

| 項目 | before（#487 以前の markup） | after（`loading="lazy"` 宣言） |
| --- | --- | --- |
| 初回 Home の Tool artifact リクエスト | 0 | **0** |
| 初回 Home の iframe / video / audio | 0 | **0** |
| 初回 Home の `<img>` で loading 明示 | 0 / 7 | **7 / 7** |
| 初回 Home の image / media 応答 | 0 | **0** |
| document bytes | 90,179 | 90,284（属性のコスト = 105 bytes = 7 × ` loading="lazy"`） |
| スクロール後に復号できた digit | — | **7 / 7** |
| `/tools/<slug>` の iframe src | `/tools/prototype/app/index.html` | 同一 |
| `/tools/<slug>` の Tool artifact 応答 | 2 | 2（明示遷移後のみ） |

**重要 — 「7 → 0 リクエスト」は主張しません。** 本番ビルドでは桁 WebP
（0.2–0.9 KB/枚）が Vite の `assetsInlineLimit` 未満なので
`data:image/webp;base64` として home HTML に inline される。すなわち
本番 document には digit の network リクエストが存在せず、`loading` 属性が
効くのは decode スケジューリング（viewport 接近まで復号しない）である。
wire 上の before / after は 0 / 0 で、差が出ないのが実測結果そのもの。

桁が独立した asset として配信される環境（dev SSR document）では同じ
A/B が 7 → 0 になる。`e2e/lazy-media.spec.ts` は測定した document が
どちらの形だったかを `digitImagesInlined` として記録し、control leg は
自分の測定した形のほうを assert する（二つの別物を黙って比較しないため）。

### CI 実測（counter disabled = 既定の E2E 状態）

CI の `Playwright E2E` step（run 39073724283 / SHA 6a0be54, 69 passed）では
`.dev.vars` が無いため桁ストリップは描画されない。その状態でも契約は検証される:

| 項目 | 値 |
| --- | --- |
| `/` の `<img>` 数 | 0（counter disabled） |
| document bytes | 20,371（enabled 時の 90,284 と対照） |
| Tool artifact 応答 / iframe / media 応答 | 0 / 0 / 0 |
| first-party 応答の内訳 | document 1 / stylesheet 1 / script 4 |
| `/tools/prototype` | iframe 1 / Tool artifact 2 |

### 再現手順

```bash
pnpm run build                                   # vite build + scripts/build-tools.mjs
pnpm run e2e -- e2e/lazy-media.spec.ts           # .tmp/lazy-media/{home-before,home-after,tool-route}.json
pnpm run lazy-media:report                       # docs/verification/perf/lazy-media-waterfall.webp
```

dev SSR document の形を測りたい場合（桁が独立リクエストになる）:

```bash
pnpm dev &
PLAYWRIGHT_BASE_URL=http://localhost:3001 \
LAZY_MEDIA_REPORT_DIR=.tmp/lazy-media-dev \
LAZY_MEDIA_ENV='dev server (vite dev)' \
  pnpm exec playwright test e2e/lazy-media.spec.ts
```

**前提**: digit strip は counter が enabled のときだけ描画される
（`MY_WEB_2026_CONSUMER_API_KEY` がないと `—` の disabled 状態になる）。
`.dev.vars` に **dummy 文字列**を 1 つ置いて測定すると桁が現れる。
CI の既定 E2E 状態には `.dev.vars` が無く、その場合 spec は「counter が
disabled」と annotation 付きで記録し、digit 固有の assertion だけを
スキップする（Tool / iframe / loading 属性の規則はそのまま検証される）。
enabled 状態の markup 規則は workerd 側（`validate:fast`）が常に検証する。

### CI での再現

`e2e/lazy-media.spec.ts` は `pnpm run e2e` に含まれる。CI は

- `main` / `release-*` への push
- `ui-change` label の付いた PR

のどちらかで `validate` job 内の Playwright step を実行し、測定 JSON は
`playwright-report` artifact の test attachment として残る
（`ui-change` PR では screenshot も一緒にアップロードされる）。

### `quality/profile.yaml` への影響

**なし（意図的に変更なし）。**

- markup 契約テストは既存 `gates.fast` の `pnpm run test`（`vitest run`）に
  Automatic に入る。新しい gate step は追加していない。
- browser 測定は **gate ではない**。throttle 下の数値は分散があり、
  `validate:*` に入れると flaky になる。gate 化は #384（再現可能な
  Lighthouse コマンド）/ #385（Lighthouse release gate）/ #386
  （Core Web Vitals budget）の所有物であり、本チケットはそこには触れない。
- `change_risk_mapping` の risk 分類にも影響なし（`src_unit` の範囲）。

### 既知の制約

- 桁 WebP は本番ビルドで inline されるため、network レベルの before / after
  差分は出ない（上記のとおり）。差分が見えるのは dev SSR document。
- asset / document のバイト数は**非圧縮**（preview server は gzip しない）。
  leg 間比較には使えるが、帯域の推定には使わない。
- 本測定は **production に一切触らない**。ローカル `vite preview` と
  ローカル D1 state（`.tmp/d1state`）だけで完結する。
- 本 Issue は「1 要素のみ」を修正する指示に従い、product コードの変更は
  `src/home/access/tiles.tsx` の `<img loading>` 明示だけ。GA4・フォント・
  Tool 本体の bundle 分割などは範囲外（それぞれ別 ticket の領域）。