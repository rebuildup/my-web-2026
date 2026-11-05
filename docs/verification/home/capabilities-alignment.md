# できごとセクションの行頭 — 検証記録 (Issue #782)

> Home の「できごと / What's here」(`src/home/capabilities/grid.tsx`) で、
> live 行だけが `md` 以上で 24px 右にずれていた問題の**実描画の検証記録**。
> 親 Issue は #767 (レイアウト崩れ / AI Slop の棚卸し)。新しい装飾は足していない。

## 何を変えたか

- `li` の `paddingInlineStart` から `md: isLive ? 6 : 0` の分岐を削除し、
  live / planned を同じ開始 x にした。
- live 行だけに出ていた 2px の絶対配置バー (`accent.positive`、`aria-hidden`) を削除した。
- live / planned の違いは **badge** (`live` / `planned`) だけで表す。代替の装飾は無い。

`md` 未満では元から `paddingInlineStart` は 0 で、ずれは発生していなかった。
削除したのは `md` 以上でだけ効いていた分岐とバーである。

## 実測 (DOM、before → after)

`getBoundingClientRect()` を全 `li` と各行の `h3` で読み、
`drift = h3.left - li.left` を求めた。`bar` は「`li` 直下の、computed
`position: absolute` な `span`」を探した結果。

### desktop 1440

| capability | 状態 | li 左端 (before → after) | h3 左端 (before → after) | drift | バー |
| --- | --- | --- | --- | --- | --- |
| ポートフォリオ | live | 586.7 → **586.7** | 610.7 → **586.7** | 24 → **0** | 有 → **無** |
| ツール | live | 905.3 → **905.3** | 929.3 → **905.3** | 24 → **0** | 有 → **無** |
| コンテンツ | planned | 586.7 → 586.7 | 586.7 → 586.7 | 0 → 0 | 無 → 無 |
| アクティビティ | planned | 905.3 → 905.3 | 905.3 → 905.3 | 0 → 0 | 無 → 無 |

`ul` の左端は 586.7。after では**全 4 行の `li` / `h3` / CTA の左端が、
その行の列の開始 x と一致**する (1 列目 586.7 / 2 列目 905.3)。

### mobile 390

| capability | 状態 | li 左端 | h3 左端 | drift | バー |
| --- | --- | --- | --- | --- | --- |
| ポートフォリオ | live | 16 → 16 | 16 → 16 | 0 → 0 | 有 → **無** |
| ツール | live | 16 → 16 | 16 → 16 | 0 → 0 | 有 → **無** |
| コンテンツ | planned | 16 → 16 | 16 → 16 | 0 → 0 | 無 → 無 |
| アクティビティ | planned | 16 → 16 | 16 → 16 | 0 → 0 | 無 → 無 |

390 では before から x のずれは無かったが、live 行の左端にバーが重なっていた。
after ではバーが無い。

### 行内の見出しベースライン (after)

同じ行の 2 列は同じ `h3.top` を持つ (desktop: 1 行目 1382.5 / 2 行目 1631.5、
mobile は 1 カラムのため行ごとに異なる)。行の高さは grid 行で揃う
(desktop 1 行目 209 / 2 行目 172)。列・`columnGap`・`rowGap` は変更していない。

### 「囲み (枠線)」の確認

owner の Q1 指摘 (囲みも AI Slop) について、このセクションの `li` は
**before の時点で枠線も面の塗りも持っていなかった**。

| 項目 | 実測 (after) |
| --- | --- |
| `li` の `border-top-width` | `0px` |
| `li` の `background-color` | `rgba(0, 0, 0, 0)` (透明) |

したがって外す border は無く、面を塗りで分ける変更も行っていない。
「囲み」に見えていたのは live 行の左バーであり、それを削除した。
状態を示す badge は従来どおり残る (情報を増やさない・減らさない)。

## 証跡

- before (desktop 1440): `capabilities-alignment-before-desktop-1440.webp`
- before (mobile 390): `capabilities-alignment-before-mobile-390.webp`
- after (desktop 1440): `capabilities-alignment-after-desktop-1440.webp`
- after (mobile 390): `capabilities-alignment-after-mobile-390.webp`

撮影時のみ解析同意パネルを `display: none` にして、セクションのクロップを撮っている。

## 回帰の gate

`e2e/smoke.spec.ts` の capabilities テストに、1440 で
「各 `li` の左端と `h3` の左端の差が 0.5px 以下」かつ
「`li` 直下に `position: absolute` な `span` (バー) が 0 個」を追加した。
行の開始 x とバーの再導入は、両方ともこの gate で落ちる。

## 再現手順

```sh
pnpm exec vite dev --port <port>            # 固定 preview
node .tmp/supervisor/home/capabilities-782.mjs http://localhost:<port> after ./out
pnpm exec playwright test e2e/smoke.spec.ts # capabilities テストを含む
```
