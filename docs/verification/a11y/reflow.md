# 文字 200%・画面 400% での再フローを検証する（Issue #400）

> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 1.4.10 Reflow（レベル AA）** と **SC 1.4.4 Resize Text（レベル AA）**。
> 「長い語・長い URL・改行できない連続テキスト」を 320 CSS px（400% ズーム相当）
> と 200% テキストで描画したとき、水平スクロールを要求しないことを
> **静的検査（gate）** と **実測（Chromium）** の 2 段で固定する。

## 適用対象 / 対象外 / 基準

### 適用対象

| 対象 | 範囲 | 備考 |
| --- | --- | --- |
| `src/styles.css` の `:where(body)` ルール | 出荷する長文の折り返し下限（wrap floor） | `overflow-wrap` は継承するので 1 宣言が全テキスト面に届く |
| `scripts/fixtures/a11y-reflow/{pass,fail}/*.tsx` | 長文 / 言語拡張の再現用 fixture | `data-reflow-kind` を持つ specimen |
| 上記 fixture の描画 | Chromium での `scrollWidth > clientWidth` 実測 | capture が 100% と 200% の 2 stage で測る |

### 対象外（理由も gate の出力に明記する）

| 対象外 | 理由 |
| --- | --- |
| 画像・グラデーション内の文字 | 背景画像との合成問題であり、テキストの折り返し契約ではない |
| flex / grid 子要素の `min-width: 0` | 面ごとの設計判断であり、継承する body の floor では決まらない（下記「既知の制約」） |
| `white-space: nowrap` を使う正当な UI（nav ラベル等） | 折り返し不要が意図された短いラベルであり、specimen ではない |
| 実機（物理デバイス）のテキストのみズーム | 機械では再現できない。人は人が評価する |

### 基準

| 基準 | レベル | 該当箇所 | 判定 |
| --- | --- | --- | --- |
| SC 1.4.10 Reflow | AA | 320 CSS px で水平スクロールを要求しないこと | 静的検査（wrap floor / specimen の破断境界）+ Chromium 実測 |
| SC 1.4.4 Resize Text | AA | 200% テキストで内容を失わないこと | Chromium 実測（200% stage） |

## 規則一覧

| rule | 意味 | 判定 |
| --- | --- | --- |
| `reflow-wrap-floor-missing` | 出荷する `:where(body)` ルールに破断境界が無い | 違反（出荷コード） |
| `reflow-specimen-without-break` | 改行不能な specimen に破断境界が無い | 違反（fixture） |
| `reflow-specimen-fixed-width` | specimen が 320 px を超える `width` / `min-width`（px）を固定している | 違反（fixture） |
| `reflow-specimen-nowrap` | 改行不能な specimen が `white-space: nowrap` で折り返しを禁じている | 違反（fixture） |

「破断境界」の定義は gate の **1 か所**（`BREAK_DECLARATIONS`）にまとめてあり、
gate・fixture・ブラウザハーネスが同じ語彙を読む:

- `overflow-wrap: anywhere`
- `overflow-wrap: break-word`
- `word-break: break-word`
- `word-break: break-all`

出荷する下限は `src/styles.css` の `:where(body)` が
`overflow-wrap: break-word` を宣言して満たしている（Issue #400 の表示側修正）。
`break-word` は「その行からはみ出す語だけ」を折るので、通常の散文は変わらない。

## fixture

`scripts/fixtures/a11y-reflow/` に、gate が **実際に読む** fixture を置いている。
各ファイルは `data-reflow-kind` で specimen の種類（`long-word` / `long-url` /
`unbroken-run` / `pseudo-locale`）を宣言する。

| ディレクトリ | ファイル | 期待される結果 |
| --- | --- | --- |
| `pass/` | `01-long-word.tsx` | 違反 0（長い語 + `overflow-wrap: anywhere`） |
| `pass/` | `02-long-url.tsx` | 違反 0（長い URL + `overflow-wrap: break-word`） |
| `pass/` | `03-pseudo-locale.tsx` | 違反 0（言語拡張語 + `overflow-wrap: anywhere`） |
| `fail/` | `01-without-break.tsx` | `reflow-specimen-without-break` |
| `fail/` | `02-fixed-width.tsx` | `reflow-specimen-fixed-width` |
| `fail/` | `03-nowrap.tsx` | `reflow-specimen-nowrap` |

`pass/` が違反を出せば `fixture-pass-violation`、specimen を 1 つも持たなければ
`fixture-pass-no-specimen`、`fail/` が期待した rule を出さなければ
`fixture-fail-not-detected` として **gate 自体が失敗する**。
テスト（`scripts/check-a11y-reflow.test.mjs`）はさらに、fixture ディレクトリの一覧と
期待表が**完全一致**すること（1 個落としても気付けないテストにしない）を assert する。

## 機械検査と人間の評価の区別

### 機械検査（`pnpm run a11y:reflow:check` / `pnpm run capture:a11y-reflow`）

| 検査 | 内容 | 判定方法 |
| --- | --- | --- |
| `reflow-wrap-floor-missing` | 出荷する `:where(body)` に破断境界がある | コメント除去後の CSS 走査（`scripts/check-a11y-reflow.mjs`） |
| `reflow-specimen-without-break` | 改行不能な specimen に破断境界がある | 同上 |
| `reflow-specimen-fixed-width` | specimen が 320 px 超の固定幅を持たない | 同上 |
| `reflow-specimen-nowrap` | 改行不能な specimen が折り返しを禁じていない | 同上 |
| fixture の再現 | `pass/` は違反 0 かつ specimen を持つ、`fail/` は期待した rule | 同上（gate 自身が行う） |
| ブラウザ側の観測 | 各 specimen の `scrollWidth > clientWidth`（100% / 200% の 2 stage、320 px frame） | Chromium 実測（capture） |

capture は **negative control** を内蔵する。`shipped contract` の specimen が
はみ出せば失敗し、`reproduced defect` の specimen がはみ出さなくなったら
（= 欠陥を再現しなくなったら）失敗する。片方だけ緑にはできない。

### 人間の評価（機械では判定しない）

- 折れた URL / 識別子が読み手にとって依然として正しく読めるか
- `overflow-wrap: anywhere` が「ひとまとまりで読みたい語」を割っていないか
- ハイフネーション辞書を使った方が自然に折れる言語があるか
- 320 px / 200% テキストでの読み心地
- 実機（物理デバイス）でのブラウザズーム / テキストのみズーム

これらの項目は gate の出力でも「not machine-checked」として明示され、検証画像内にも
同じ文言が印字される。

## スクリーンショット

`docs/verification/a11y/reflow.webp`（Issue #400 が指定する
`reflow-400-percent.png` の WebP 版。**PNG はリポジトリに置いていない** —
capture script が `.png` を拒否する規約のため）。

- 生成: `pnpm run capture:a11y-reflow`
- 方式: loopback の一時 HTTP サーバに生成したハーネスを置き、Chromium で描画して撮影
- 左（上）: 320 px frame の 100% 描画、右（下）: 同じ frame の 200% テキスト描画
- 各 specimen は 320 px frame の中に描画し、`shipped contract` は収まり、
  `reproduced defect` ははみ出す（frame が clip する）
- 上部バンド: 機械検査の結果（gate 違反数・base floor・各 box の実測）、人間評価項目、WCAG 対応
- 失敗条件: 観測が契約と矛盾した場合、**成果物を書かずに exit 1**

## 誤検知が起きたときの対処

機械検査は **宣言** だけを判定する。誤検知が起きた場合は、次の順で対処する。

1. **その specimen は本当に改行不能か。** 短いラベルを `data-reflow-kind` で
   specimen と宣言していれば、宣言側を直す（specimen の種類が違う）。
2. **破断境界が本当に必要か。** 単一トークンを意図的に切らずに済む設計
   （`<wbr>` を挿す、列幅を広げる）なら、fixture の CSS を直す。
   出荷面で局所的な対処（`overflow-wrap: anywhere` / `min-width: 0`）を
   足す場合も、変更は **既存 surface の CSS に閉じる**。
3. **固定幅が意図的か。** 320 px を超える固定幅が必要な UI は、
   折り返しではなく「横スクロール可能な名前付き領域」として別の契約
   （`a11y:table:code:check` の scroll container）に属する。
4. いずれも該当しない場合は **owner へ判断を仰ぐ**。

## 既知の制約 / 未対応範囲

- **flex / grid 子要素の `min-width: 0` は本 gate の対象外。**
  継承する body の `overflow-wrap` は、flex / grid の min-content サイズを
  下げない。広い単一トークンを flex 子に置く面は、その面が
  `min-width: 0`（または `overflow-wrap: anywhere`）を持つかという
  ローカルの設計判断であり、本 Issue の floor では決まらない。
- **gate は fixture の宣言と出荷する base floor を判定する。**
  「実画面がはみ出さない」ことの保証は capture（Chromium 実測）が担う。
  どちらも「合格の代用の画像」ではない。
- **200% テキストは capture の stage で再現する。**
  実機のテキストのみズームは機械では再現できない。
