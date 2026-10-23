# ライブ更新通知の読み上げを過剰にしない（Issue #405）

> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 4.1.3 Status Messages（レベル AA）** と **SC 4.1.2 Name, Role, Value（レベル A）**。
> 「状態変化が支援技術に伝わる」ことと「伝え方が過剰でない」ことを、
> 機械で決まる宣言（`aria-live` / `role` / `aria-busy`）と、
> ブラウザ実測（状態遷移ごとの属性と更新回数）の 2 段で固定する。

## 適用対象 / 対象外 / 基準

### 適用対象

| 対象 | 範囲 | 備考 |
| --- | --- | --- |
| `src/**/*.tsx` | 出荷する JSX 表面すべて | `.ts` は JSX を描かないので対象外 |
| 明示的なライブ領域 | `aria-live` 属性、または `role="status" / "alert" / "log" / "timer" / "marquee"` を持つ要素 | `<output>` の暗黙 role は対象外（下記） |
| `aria-busy` | すべての要素 | 値が真偽値でないと batch が黙って止まる |

### 対象外（除外の理由も gate の出力に明記する）

| 対象外 | 理由 |
| --- | --- |
| `*.test.tsx` | テストは描画を検証するファイルであり、除去すべき欠陥は出荷コード側にある |
| `*.stories.tsx` | Storybook の story はコンポーネントのプレビュー用ハーネスであり、訪問者が到達する表面ではない（コンポーネント本体は別途走査される） |
| `**/fixtures/**` | fixture は形を持つために存在し、本 gate が拒否する形も含む。出荷する同じデータは別途走査される |
| `src/routes/design-system/**` | design-system ルートはリポジトリ内部のコンポーネントギャラリーであり、公開表面ではない |
| `<output>` の暗黙 `status` role | `<output>` は暗黙に `status` role を持つが、この gate は明示的な `aria-live` / `role` だけを読む。属性を書いていない `<output>` はライブ領域として数えない（gate の「out of scope」に理由つきで出る） |

### 基準

| 基準 | レベル | 該当箇所 | 判定 |
| --- | --- | --- | --- |
| SC 4.1.3 Status Messages | AA | 状態変化がライブ領域として公開され、過剰に announce されないこと | 静的検査（規則一覧）+ Chromium 実測 |
| SC 4.1.2 Name, Role, Value | A | `aria-busy` が真偽値であり、batch が黙って止まらないこと | 静的検査 |

## 出荷側の修正（Reactions）

対象は 1 箇所に絞った — **リアクションの投稿面（`src/home/reactions/widget.tsx`）**。
`ReactionsWidget` は楽観更新 + fire-and-forget で、失敗だけを `role="alert"` で
通知していた。読み込み中（pending）の表現が無く、結果がどのように伝わるかも
固定されていなかった。

- 進行中の mutation 数を `pendingCount` として持ち、記録済みリアクションの
  領域を **1 つのライブ領域** にした:
  `role="status"` / `aria-live="polite"` / `aria-atomic="true"` /
  `aria-busy={pendingCount > 0}`。
- `aria-busy` は進行中の更新を batch する。楽観更新の 1 回の結果が
  1 回だけ announce され、同じ結果で領域を書き換えない。
- 失敗はこれまでどおり **兄弟の `role="alert"`** が担う。状態領域は失敗で
  書き換わらない（二重通知しない）。
- **文言は変更していない**（公開 copy surface に新しい日本語テキストを
  追加していない）。追加したのは ARIA 属性と進行中カウンタだけ。

## 規則一覧

| rule | 意味 | 判定 |
| --- | --- | --- |
| `live-region-assertive-not-alert` | `aria-live="assertive"` を `role="alert"` 以外で宣言している（割り込みの主因） | 違反 |
| `live-region-nested` | ライブ領域が別のライブ領域の内側にある（1 つの変化が 2 回 announce される） | 違反 |
| `live-region-busy-invalid` | `aria-busy` が真偽値でない literal（batch が黙って止まる） | 違反 |
| `live-region-duplicate-announce` | 1 ファイル内の 2 つのライブ領域が同じ式を publish している（同じ結果を 2 回 announce） | 違反 |

「ライブ領域」の語彙（`status` / `alert` / `log` / `timer` / `marquee` と
`aria-live` の 3 値）は gate の 1 か所（`LIVE_ROLES` / `ARIA_LIVE_VALUES`）に
まとめてあり、gate・fixture・capture が同じ定義を読む。

## fixture

`scripts/fixtures/a11y-live-region/` に、gate が **実際に読む** fixture を置いている。

| ディレクトリ | ファイル | 期待される結果 |
| --- | --- | --- |
| `pass/` | `01-status-region.tsx` | 違反 0（`role="status"` + `aria-busy` 式） |
| `pass/` | `02-alert-error.tsx` | 違反 0（`role="alert"` = 認められた assertive） |
| `pass/` | `03-polite-region.tsx` | 違反 0（`aria-live="polite"`） |
| `fail/` | `01-assertive-not-alert.tsx` | `live-region-assertive-not-alert` |
| `fail/` | `02-nested-regions.tsx` | `live-region-nested` |
| `fail/` | `03-busy-invalid.tsx` | `live-region-busy-invalid` |
| `fail/` | `04-duplicate-announce.tsx` | `live-region-duplicate-announce` |

`pass/` が違反を出せば `fixture-pass-violation`、ライブ領域を 1 つも持たなければ
`fixture-pass-no-region`、`fail/` が期待した rule を出さなければ
`fixture-fail-not-detected` として **gate 自体が失敗する**。
テスト（`scripts/check-a11y-live-region.test.mjs`）はさらに、fixture ディレクトリの
一覧と期待表が**完全一致**すること（1 個落としても気付けないテストにしない）を assert する。

## 機械検査と人間の評価の区別

### 機械検査（`pnpm run a11y:live-region:check` / `pnpm run capture:a11y-live-region`）

| 検査 | 内容 | 判定方法 |
| --- | --- | --- |
| 規則一覧の 4 rule | 出荷する `src/**/*.tsx` のライブ領域と `aria-busy` | コメント除去後のソース走査（`scripts/check-a11y-live-region.mjs`） |
| fixture の再現 | `pass/` は違反 0 かつライブ領域を持つ、`fail/` は期待した rule | 同上（gate 自身が行う） |
| ブラウザ側の観測 | 状態遷移ごとの `role` / `aria-live` / `aria-atomic` / `aria-busy` と、領域の突然変異（mutation）回数 | Chromium 実測（capture） |

capture は **negative control** を内蔵する。状態領域が `assertive` であれば失敗、
pending で `aria-busy` が真でなければ失敗、結果で領域が変化しなければ失敗、
確定後に領域がもう一度変化すれば（= 二重通知）失敗、失敗通知が `role="alert"` で
なければ失敗する。片方だけ緑にはできない。

### 人間の評価（機械では判定しない）

- announce が **実際に** 十分 polite か（タイミング・待ち行列・割り込み）
- announce の文言が「何が変わったか」を伝えているか
- 実機スクリーンリーダー（VoiceOver / NVDA / TalkBack）での読み上げ
- 視覚的な状態と announce された状態が一致しているか
- ある失敗に `role="alert"` が妥当か（緊急度は判断）

この 5 項目は gate の出力でも「not machine-checked」として明示され、検証画像内にも
同じ文言が印字される。

## スクリーンショット

`docs/verification/a11y/live-region-state.webp`（Issue #405 が指定する
`live-region-state.png` の WebP 版）。

- 生成: `pnpm run capture:a11y-live-region`
- 方式: loopback の一時 HTTP サーバに生成したハーネスを置き、Chromium で
  idle → pending → success → settled → failure → empty → 320 px の各状態を
  駆動し、各 step で実測して撮影
- 画像: 上部に実測した全 step（`role` / `aria-live` / `aria-atomic` / `aria-busy` /
  mutation 数 / 領域の文字列）、下に描画したハーネス
- 失敗条件: 観測が契約と矛盾した場合、**成果物を書かずに exit 1**

### ファイル名の乖離（2 点）

1. **ファイル名**: Issue #405 が指定する `live-region-state` をそのまま維持している
   （別名にしていない）。
2. **拡張子**: Issue は `.png` を要求するが、このリポジトリの規約は WebP のみ
   （capture script が `.png` を拒否し、リポジトリに PNG を置かない）ため
   `.webp` にした。#396 / #397 / #399 / #400 と同じ扱い。

## 誤検知が起きたときの解除手順

gate は「宣言」を判定する。以下の 3 つは誤検知の候補であり、**gate を緩めずに**
個別の契約として扱う:

1. **`live-region-assertive-not-alert` が誤検知した**
   - 本当に割り込みが必要な通知であれば `role="alert"` にする（これが認められた
     assertive の書き方）。それでも `aria-live="assertive"` を直接使う必要がある
     場合は、その理由を本 doc に追記し、`LIVE_ROLES` と同じ要領で
     `EXCLUSIONS` ではなく規則の記録を増やす。
2. **`live-region-nested` が誤検知した**
   - 外側と内側が別の結果を publish している場合、外側のライブ領域を外す、
     または内側を `aria-live="off"` にする。どちらも構造の修正で解ける。
3. **`live-region-duplicate-announce` が誤検知した**
   - 2 つの領域が同じ式を publish しているなら、片方を表示専用
     （`aria-hidden="true"`）にするか、`aria-live="off"` にする。
     「同じ文字列だが別の意味」である場合は本 doc に記録する。

いずれも、解除は「gate の判定を緩める」ことではなく「契約の記録を増やす」こととして扱う。

## 既知の制約

- **静的検査であり、実際の読み上げではない。** announce のタイミング・
  キュー・割り込みは測っていない（実機での人評価）。
- **`<output>` の暗黙 role は数えない。** 明示属性だけを読む
  （gate の「out of scope」に理由つきで出る）。
- **同じ結果の「書き換え」の検出は、2 つのライブ領域が同じ式を publish する
  形に限る。** 1 つの領域を同じ文字列で再設定する実装は静的には区別できない。
  capture 側が「確定後の再 mutation が無い」ことを実測で補う。
- **capture のハーネスは生成物であり、出荷する `ReactionsWidget` そのものを
  動かしていない。** 出荷 widget は server fn と cloudflare binding を要求し、
  loopback の静的ハーネスでは動かせない。ハーネスは出荷 widget と同じ
  ライブ領域の契約（`role="status"` / polite / atomic / `aria-busy`）を再現し、
  gate は出荷 widget のソースを別途走査する。
- **`role="alert"` の使用は許容している。** alert は assertive であり、
  失敗の通知には妥当。誤用（成功報告に alert を使う等）は機械では判定しない。

## 再現手順

```bash
pnpm run a11y:live-region:check         # 静的検査（gate）
pnpm run capture:a11y-live-region       # Chromium で状態遷移を実測して WebP を生成
node --test scripts/check-a11y-live-region.test.mjs
node --test scripts/capture-a11y-live-region.test.mjs
```

中間産物は `.tmp/a11y-live-region/`（**gitignore 済み**）に置く。commit するのは
`docs/verification/a11y/live-region-state.webp` と本ファイル、および索引 1 行。
PNG は作らない。
