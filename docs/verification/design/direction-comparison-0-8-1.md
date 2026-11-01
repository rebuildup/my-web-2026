# direction 比較ハーネスの記録（0.8.1 / Issue #764)

作成: 2026-11-02 / design workstream
位置づけ: **製品の surface ではない。** owner が A / B / C を画面上で判断するための比較ハーネスで、
判断が終わったらハーネスごと捨てる。ここに残すのは「何を、どの条件で、何が出たか」の記録であって、
実装ではない。実装は `docs/verification/design/` のこの記録を根拠に、別 Issue / 別 PR で行う。

## 1. 何を決めるためのハーネスか

- direction（A: INK / SIGNAL、B: MONOCHROME / SIGNAL、C: SHARPENED CURRENT）の選択。
- B が選ばれた後、**モノクロの明度階層**が実用に耐えるか。
- 色を 1 色に収斂させずに済むか。**コンテンツが色を持つ**とき、1 画面に何色まで同居できるか。

owner の判定は 2026-11-02 に B（MONOCHROME / SIGNAL）。ただし「このままでは使えない」。
色は「候補から 1 色を選ぶ」話ではなく、黄色しか使えない状況にしないこと、という訂正が付いた。

## 2. 再現手順

```sh
# worktree .764 / branch 764（base release-0-8-1）
pnpm dev -- --port 3300 --strictPort
```

| 目的 | URL |
| --- | --- |
| 比較ボード | `http://localhost:3300/compare?path=/&theme=dark` |
| モノクロ階層（節 1） | `http://localhost:3300/compare?path=/&theme=dark#scale` |
| 色の体系（節 2） | `http://localhost:3300/compare?path=/&theme=dark#colour` |
| 方向別の実画面 | `http://localhost:3300/?direction=a&theme=dark`（a / b / c × dark / light） |

方向別の実画面は、head の parser-blocking script が
`/preview-assets/dir-{a,b,c}-{dark,light}.css` を link するだけの仕組みで、hydration には触れない。
CSS は `pnpm run preview:css`（`scripts/generate-preview-css.mjs`）で再生成する。生成物は
`public/preview-assets/`（5.2 MB。大半は self-host した Material Symbols の woff2）。

## 3. 節 1 — モノクロ階層（B）

11 役割を、その面の上に本文・補助文字・hairline・強い罫線を載せた状態で描いた。hex の表は出していない。

役割: ページ地 / 沈んだ面 / 上がった面 / 押せる面 / hairline / 強い罫線 / 補助文字 / 副次文字 /
本文 / 反転地 / 無効。

- light と dark は反転ではない。それぞれの地から独立に組んだ。
- 面の分離は塗りの差だけで、装飾 border は使っていない（owner 判定: border は残せない）。
- `bg.control`（押せる面）は「地から一段上の塗り」としてだけ現れる。

実装（ハーネス内）: `src/preview/scale-b.mjs`（値）、`src/preview/specimens.tsx`（描画）。

## 4. 節 2 — 色の体系

3 案。どれも**同じ題材**（同じ 3 作品・同じ 3 状態・同じ操作）で描くので、差は色の載り方だけになる。
数値は描画後の DOM（`[data-coloured]` の `getBoundingClientRect()` 合計 ÷ 標本面積）から測る。

| 案 | 系統数 | 同時に色を持つ色相 | 彩色面積（実測） | 状態 | 操作 |
| --- | --- | --- | --- | --- | --- |
| I — 少数高彩度 | 4 | 4 | 2.4% | 無彩色ピル | 紫 1 系統 |
| II — 多数中彩度 | 7 | 7 | 3.7% | 状態ごとに系統 | 紫 1 系統 |
| III — コンテンツ分類固定 | 3 | 3 | 2.7% | 分類の色を借りる | 墨（色を足さない） |

全案に共通の運用規則:

- 色は slug / 分類から決定的に導く（乱数で振らない）。
- 長文・大きな面の塗りには色を置かない。色は 1 行・1 語・1 ピルまで。
- 操作の系統は 1 つに固定する。散らすのは内容側だけ。
- 地は無彩色。彩色面積は 1 画面 5% 前後を上限とし、実測して超えたら色を減らす。

実装（ハーネス内）: `src/preview/colour-systems.mjs`、`src/preview/colour-specimens.tsx`。

## 5. 同意帯（解析停止の表示）

実アプリの同意通知は `position: fixed; bottom: 12px` のカード。ハーネスでは標本 iframe が
それぞれ自分の viewport に対して固定するため、ボード上に複数浮いていた。

- 標本 iframe 側: `onLoad` 後に `contentDocument` から `[data-testid="analytics-consent"]` を除去
  （`MutationObserver` で再出現も除去）。**ハーネス側だけの変更**で、`src/routes/**` /
  `src/editorial/**` の実装には触れていない。
- ボード側: 1 個だけを viewport 下端に固定し、全幅帯として描く（border / radius / shadow なし、
  内容列は 960px 中央）。

DNT と GPC を有効にした実測（`.tmp/preview/verify-consent3.mjs`）:

| viewport | トップ文書 | iframe 6 文書 | bottom / innerHeight | スクロール後 |
| --- | --- | --- | --- | --- |
| 1440×900 | 1 | 0 | 900 / 900 | 743（不変） |
| 390×844 | 1 | 0 | 844 / 844 | 640（不変） |

## 6. ゲートを通すために何をしたか

ハーネスを載せると、リポジトリの契約が「新しい published route」として正しく反応する。緩めず、
その route を**分類する**方向で通した（すべてこのブランチ限りで、閉じれば消える）。

| ゲート | 反応 | 対応 |
| --- | --- | --- |
| `log:redaction:check` | `src/preview/generate-css.mjs` が `console` に触れていた | 生成器を `scripts/generate-preview-css.mjs` へ移した（`scripts/**` は logger を経由しない規約）。`pnpm run preview:css` |
| `seo:status:check` | `/compare` が未分類 | `harness-compare-noindex` 行（200 / noindex / sitemap 対象外）+ workerd の proof テスト。`/compare` の head に `robots: noindex, nofollow` |
| `routes:quality:check` | `/compare` が manifest に無い | `quality/route-coverage.json` に 6 family すべて `excluded` + 理由 |
| `bundle:budget:check` | `/compare` の cap が無い | 実測して cap を追加（下記） |

新規の owner ディレクトリ（`src/preview/**`）は**作らない**方針で閉じた。`src/preview/**` は
比較ハーネスの一時実装で、AGENTS.md §3 の obligation を持たない。製品に入れるのは、選ばれた
direction の token と primitive の変更だけで、`src/preview/**` は持ち込まない。

## 7. 閉じ方

1. 判断が済んだら PR #798 は **close**（merge しない）。この記録は release ブランチへ
   ドキュメントとして切り出す（ハーネスは含めない）。
2. 実装は `implementation-map.md` の手順で、1 Issue / 1 PR（base は次の release ブランチ）。
3. モノクロ階層の値と色の体系は、実装 PR で `src/editorial/tokens.ts` /
   `semantic-tokens.ts` に落とす。ハーネスの inline style は引き継がない。
