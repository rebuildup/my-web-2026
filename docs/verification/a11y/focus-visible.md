# フォーカス表示とフォーカス非隠蔽を検証する（Issue #395）

> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 2.4.7 Focus Visible（レベル AA）** と
> **SC 2.4.11 Focus Not Obscured (Minimum)（レベル AA）**。
> 「キーボードでフォーカスを動かしたとき、フォーカス位置が見えること」
> 「そのフォーカス位置が、サイト側で作った content で隠されないこと」を
> 機械検査で固定する。

## 適用対象 / 対象外 / 基準

### 適用対象

| 対象 | 範囲 | 備考 |
| --- | --- | --- |
| `src/**/*.{ts,tsx}` | 出荷するソースすべて | `css({...})` 呼び出しの対象を走査対象とする（ブラウザがコンパイルする同じもの）。**入れ子**のフォーカス条件（`'& a': { _focusVisible: { … } }`）も再帰して読む |
| `src/**/*.css` | 出荷する素のスタイルシート | フォーカスブロックの outline 解除・不可視を走査する（`focus-indicator-removed-in-css`）。補償（compensation）の宣言もここにある。TS だけを見ると鎖の片端しか見えない |
| ソース内の文字列の CSS | 出荷するソースが持つ `<style>` ブロック | ブラウザが同じものとして解釈する CSS なので、スタイルシートと同じ規則で走査する（例: `src/editorial/error-states/ssr-fallback.ts` の fallback 文書） |
| フォーカスブロック | `_focus` / `_focusVisible` / `_focusWithin` / `&:focus` / `&:focus-visible` / `&:focus-within` | Panda の condition と素の CSS セレクタの両方。**どの深さでも**読む（入れ子のセレクタオブジェクトの中の条件も対象） |
| オーバーレイ | `position: fixed` / `position: sticky` | サイト側で作った content であり、フォーカスを覆いうるもの |

### 対象外（除外の理由も gate の出力に明記する）

| 対象外 | 理由 |
| --- | --- |
| `*.test.ts` / `*.test.tsx` | テストは描画を検証するファイルであり、除去すべき欠陥は出荷コード側にある |
| `*.stories.tsx` | Storybook の story はコンポーネントのプレビュー用ハーネスであり、訪問者が到達する表面ではない（コンポーネント本体は別途走査される） |
| `**/fixtures/**` | fixture は形を持つために存在し、本 gate が拒否する形も含む。出荷する同じデータは別途走査される |
| `src/routes/design-system/**` | design-system ルートはリポジトリ内部のコンポーネントギャラリーであり、公開表面ではない（実 primitives は別途走査される） |
| ネイティブのモーダル `<dialog>` | `showModal()` で開いた `<dialog>` は、UA が文書全体を inert にする。開いている間にダイアログの外へフォーカスできる要素は存在せず、覆いようがない。非モーダルの signal は **要素ごとに** 読む: `open` 属性（`css({...})` 呼び出しの前後どちらにあっても）と、その要素の `ref` に対する `.show()` 呼び出し（`dialogRef.current.show()`）。同じファイルのどこかにある `showModal()` だけでは exempt にしない。**限界**: 要素が `ref` を束縛しておらず、別名の handle で `.show()` される `<dialog>` は帰属できないため exempt のままになりうる（見逃し側に倒す保守的な判断） |
| 素の CSS の `position: fixed` / `sticky` オーバーレイ | 補償の鎖の判定はオーバーレイを TS の `css({...})` 呼び出しから採集するため、素の CSS で宣言されたオーバーレイは本 gate のオーバーレイとして数えない。素の CSS の outline 解除は対象（`focus-indicator-removed-in-css`） |
| `:not(:focus-visible)` を含むセレクタ（例: `:focus:not(:focus-visible)`） | pointer focus。ブラウザ既定の指示子は **pointer 操作**には不要で、**キーボード操作のインジケータには影響しない**。`:focus-visible` 側（keyboard focus）は対象のままなので、キーボード利用者がインジケータを失うことはない。**セレクタリストは 1 項目ずつ判定する**（`:focus-visible, :focus:not(:focus-visible)` なら `:focus-visible` の項目が対象で、リスト全体を除外しない） |

### 基準

| 基準 | レベル | 該当箇所 | 判定 |
| --- | --- | --- | --- |
| SC 2.4.7 Focus Visible | AA | すべてのフォーカスブロック | 適合 — 指示子が外されたまま・見えないままのブロックを機械検査（`scripts/check-a11y-focus-visible.mjs`） |
| SC 2.4.11 Focus Not Obscured (Minimum) | AA | すべての author-created overlay | 適合 — 補償の鎖が閉じていないオーバーレイを機械検査（同上） |
| `:focus-within` | AA（SC 2.4.7 と同じ物差し） | 素の CSS の `:focus-within` と `css({...})` の `_focusWithin` / `&:focus-within` | 対象 — フォーカス可能要素**ではない**ラッパ（例: `.field:focus-within { outline: none }`）に適用した `outline: none` は**誤検知の候補**で、解除手順 4 と同じ扱いにする |

## 規則一覧

| rule | 意味 | 判定 |
| --- | --- | --- |
| `focus-indicator-removed` | フォーカスブロックが指示子を消す（`outline: none` / `0` / `outlineWidth: 0` / `outlineStyle: none` / `none !important`）が、代替の表示（`boxShadow`・枠・下線など）を declares しない | 違反 |
| `focus-indicator-invisible` | フォーカスブロックが見えない輪郭を宣言する（`outline: transparent` / `outlineColor: transparent` / `outline: 2px solid transparent` のような透明色を含む shorthand）が、代替の表示を宣言しない | 違反 |
| `focus-indicator-removed-in-css` | 素の CSS（スタイルシートのファイルとソース内の `<style>` ブロック）の `:focus` / `:focus-visible` / `[focus-visible]` 系ルールが指示子を消す / 見えなくする（`outline: none` / `0` / `transparent` / `outline-color: transparent` / `outline-style: none` / `none !important`）が、代替の表示を宣言しない。**セレクタリストは 1 項目ずつ**判定する | 違反 |
| `focus-obscured-no-compensation` | `position: fixed` / `sticky` のオーバーレイが Compensation に束縛されていない。**下端固定**のオーバーレイは「文書の末尾の余白」と「scroll-padding」の**両方**が必要（片端では閉じない） | 違反 |
| `fixture-pass-violation` | pass fixture が違反を報告した（pass の状態が再現できていない） | 違反（fixture の陳腐化） |
| `fixture-pass-no-case` | pass fixture がフォーカスブロックもオーバーレイも持ちません。何の規則も行使していない | 違反（空の pass fixture は何も証明しない） |
| `fixture-fail-not-detected` | fail fixture が期待する rule を報告しなくなった | 違反（検出漏れ） |
| `fixture-fail-unexpected` | fail fixture が stood-for 以外の rule を報告した | 違反（fixture の取り違え） |
| `fixture-file-missing` / `fixture-file-unexpected` | fixture の目録と実体が食い違っている | 違反（目録の陳腐化） |

## 補償（compensation）の契約

2.4.11 の違反を 없すには、オーバーレイの分だけ**場所をあける**必要がある。
この gate が認める補償は **鎖** であり、両端が必要である:

1. **文書が消費する** — `scroll-padding: 0 0 var(--<offset>) 0`
   （スクロールのスクロールポートに予約する）と
   `padding-bottom: var(--<offset>)`（文書の末尾に場所を作る）。
2. **オーバーレイのファイルが公開する** — 同じ `--<offset>` を
   `document.documentElement.style.setProperty('--<offset>', …)` で公開する。

片端だけの宣言は**死んだ宣言**であり、違反として報告する。
`var(--x, 0px)` のフォールバックはフォールバックに過ぎず、
`--x` を公開する側がなければ何も予約されない。

**消費側は文書のスクロール要素に宣言されていなければならない。**
`scroll-padding*` は `html` / `body` / `:root`、`padding-bottom` は
`body` / `html` でだけ効く。オーバーレイ自身の要素に同じ宣言を付けても
何も予約されないため、鎖は閉じない（`isDocumentScrollConsumer`）。

**下端固定のオーバーレイには「両方」が必要である。** どちらか片方では
閉じたことになる:

- `scroll-padding-bottom` だけ: 途中の要素はスクロール時に避けられるが、
  ブラウザは文書の末尾より先にスクロールできないため、**最後のフォーカス
  可能要素**は文書の最下端に留まり、その位置はビューポートの下端 —
  つまり固定オーバーレイのある位置である。
- `padding-bottom` だけ: 最後の要素は持ち上がるが、途中の要素は
  ブラウザがビューポートの端までスクロールするため、覆い隠される。

上端固定（`top`）のオーバーレイは `scroll-padding` だけで足りる
（末尾の余白は上端固定のオーバーレイの位置ではないため）。
ゲートは宣言の `bottom` / `top` を見てどちらの型かを判断する
（`overlayAnchor`）。`scroll-margin*` は補償の候補に**含まれない** —
scroll margin は宣言した要素自身のスクロール位置に作用するので、
子孫のフォーカス要素のためにスクロールポートを予約しない。

## 出荷時の修正（実測で見つかった欠陥）

| 場所 | 欠陥 | 修正 |
| --- | --- | --- |
| `src/editorial/analytics/AnalyticsConsent.tsx`（同意パネルの `position: fixed`） | 固定オーバーレイに補償が無く、ページ末尾のフォーカス可能要素がパネルに隠れる | 表面が占有する高さを `--analytics-consent-offset` として公開 |
| `src/editorial/analytics/AnalyticsConsent.tsx`（折りたたみ状態ボタンの `position: fixed`） | 同じ | 同じ仕組み |
| `src/styles.css` | 補償の消費側が存在しなかった | `:root` に `scroll-padding`、`body` に `padding-bottom`（どちらも `var(--analytics-consent-offset, 0px)`） |

**視覚的な副作用**: 同意パネルが開いている間、ページ下端にパネルと同じ
高さの余白が空く。フッターは背景色を持たない（キャンバス色）なので、
余白は「隙間」ではなく「ページ」として見える。reserve した場所は
パネルが被さる位置と重なる。

**shorthand を使う理由**: `scroll-padding-bottom`（longhand）は
`quality/css-standards.json` の語彙録に載っていないため
`pnpm run css:check` が `unknown_property` として落とす。shorthand
`scroll-padding` は載っており、意味は同一である longhand 群をまとめて
設定する。語彙録（Issue #413 の記録）を緩めることはしていない。

## 機械で判定することと人が判定すること

green な gate は適合の主張ではない。以下の区別は本 gate の中核である。

| 主張 | 判定方法 |
| --- | --- |
| フォーカスブロックが指示子を消していない（形） | **機械** — `check-a11y-focus-visible.mjs` |
| オーバーレイに補償の鎖が閉じている（形） | **機械** — 同上 |
| フォーカスリングが背景に対して読めるか（色） | **人** — 色の契約は Issue #399（`a11y:contrast:check`）が持つ |
| 予約した場所が全ビューポート幅で十分か | **人** |
| フォーカス順序が妥当か | **人** |
| すべての経路でダイアログが modally 開いているか | **人** |
| スクリーンリーダーがフォーカス要素を正しく読み上げるか | **人** — VoiceOver / NVDA での実機確認 |

## fixture

| ファイル | 属 | 再現する状態 |
| --- | --- | --- |
| `pass/visible-focus-outline.tsx` | pass | 可視のフォーカスリング（`outline: 2px solid …`） |
| `pass/focus-replacement-shadow.tsx` | pass | 輪郭を消すが `boxShadow` で代替する |
| `pass/modal-dialog-overlay.tsx` | pass | ネイティブのモーダル `<dialog>`（`showModal()`） |
| `pass/compensated-bottom-overlay.tsx` | pass | 固定オーバーレイ + スクロール補償 + 文書末尾の部屋（**両方**で鎖が閉じている） |
| `fail/focus-outline-removed.tsx` | fail | `focus-indicator-removed` |
| `fail/focus-outline-transparent.tsx` | fail | `focus-indicator-invisible` |
| `fail/focus-outline-transparent-shorthand.tsx` | fail | `focus-indicator-invisible`（`outline: 2px solid transparent`） |
| `fail/uncompensated-fixed-overlay.tsx` | fail | `focus-obscured-no-compensation` |
| `fail/overlay-self-compensation.tsx` | fail | `focus-obscured-no-compensation`（補償をオーバーレイ自身に付けた no-op） |
| `fail/scroll-padding-only-overlay.tsx` | fail | `focus-obscured-no-compensation`（**下端固定**のオーバーレイにスクロール補償だけ — 末尾の余白が無く、最後の要素は隠れる） |
| `fail/end-of-document-room-only-overlay.tsx` | fail | `focus-obscured-no-compensation`（下端固定のオーバーレイに末尾の余白だけ — 途中の要素が隠れる） |
| `fail/dialog-open-not-modal.tsx` | fail | `focus-obscured-no-compensation`（`showModal()` があるファイルの `<dialog open>`） |
| `fail/dialog-open-after-classname.tsx` | fail | `focus-obscured-no-compensation`（`open` が `className={css({...})}` の**後ろ**にある `<dialog open>`） |

fixture は gate 自身が読む。各 fail fixture は期待する rule をちょうど
1 つ報告しなければならず、pass fixture は 0 件でなければならない。
空の pass fixture（規則を 1 つも行使していないもの）は
`fixture-pass-no-case` として gate を赤にする — 何も証明しない
pass が gate を green に保つことを許さないため。

## 検証画像

`docs/verification/a11y/focus-visible.webp`（1600 × 790 / 41 kB）。

左パネルは**補償なし**、右パネルは**出荷している補償あり**の同じページである。
差分は `src/styles.css` の補償ルールだけ — フォーカスの輪郭は
`src/editorial/nav/PublicNav.tsx` が宣言しているもの
（`2px solid {colors.border.focus}`）をトークンモジュールから解決して
描いている。リングは**要素ではなく `:focus-visible` の状態で**描かれる
（要素にリングを書くと、どの状態でもリングが見えてしまい、
キーボードのインジケータであることを示せないため）。
capture はブラウザで次を**実測**し、期待と食い違えば
画像を一切書かずに exit 1 になる:

| 実測 | 補償なし | 補償あり | pointer 対照 |
| --- | --- | --- | --- |
| `getComputedStyle(target).outlineStyle` / `outlineWidth` | `solid` / `2px` | `solid` / `2px` | `none` / `0px` |
| `target.matches(':focus-visible')` | `true` | `true` | `false` |
| フォーカス要素の矩形（ビューポート座標） | 548 – 600 | 408 – 460 | 408 – 460 |
| オーバーレイの矩形 | 460 – 600 | 460 – 600 | 460 – 600 |
| `document.elementFromPoint(中心)` | `focus-overlay` | `focus-target` | `focus-target` |
| 判定 | **隠れている** | **隠れていない** | **リングが出ない** |

**pointer 対照**は測定の**ネガティブコントロール**である。フォーカスを
先に解除してから**マウス**で同じ要素をクリックし、`:focus-visible` が
成立しない状態でリングが**描かれていない**ことを確かめる。リングが
要素に直接書かれていればこの対照でもリングが見えてしまい、capture は
「キーボードのインジケータ」を証明していないことになる（その場合
capture は exit 1 になり、画像は書かれない）。

### WebP, not PNG

Chromium は PNG しか書けず、Issue #395 は `.png` のパスを要求しているが、
このリポジトリの規約は WebP のみである。capture は `.tmp/` に PNG を
取り、`sharp`（既存の devDependency）で幅 <= 1600 / quality 80 に
エンコードし、コミットするのは `.webp` の兄弟ファイルである。スクリプトは
`.webp` 以外の出力パスを**拒否**し、中間の PNG は削除する。
**PNG ファイルは作らない。**

## 誤検知が起きたときの解除手順

gate は「形」を判定する。以下の 4 つは誤検知の候補であり、**gate を緩め
ずに**個別の契約として扱う:

1. **`focus-indicator-removed` が「代替の表示なし」と誤認した**
   - 代替は `boxShadow` / `borderColor` / `borderWidth` / `borderStyle` /
     `backgroundColor` / `color` / `textDecoration` / `outline` の 8 種で
     判定している（`REPLACEMENT_PROPERTIES`）。`color: inherit` /
     `currentColor` / `unset` / `revert` / `initial` のような**計算値が
     変わらない値**は代替と数えない（`NO_OP_VALUES`）。**何も描かない値**
     （`borderWidth: 0` / `0px`、`borderStyle: none` / `hidden`）も
     プロパティごとに除外する（`INVISIBLE_VALUES_BY_PROPERTY`）。
     別の手段（例: 背景画像の差し替え、`filter`）で指示子を作っている場合は、**その実装を
     `REPLACEMENT_PROPERTIES` に加えて再レビューする**。gate の閾値を
     下げるのではなく、実装の記録を足す。
2. **`focus-obscured-no-compensation` が「実際には覆わない」を誤認した**
   - オーバーレイが `pointer-events: none` の要素の上にあり、フォーカス
     可能要素がその下に回らない場合など。**その場合は fixture
     （`pass/`）に 1 件追加して、判定が「覆わない」を表現できる
     形であることを示す**。既存の gate を緩めてはならない。
   - **下端固定のオーバーレイ**には「末尾の余白」と「scroll-padding」の
     両方が必要だと契約している（片端だけでは閉じない）。片端しか
     書けていないコードは**出荷側の修正**であり、gate の緩め方では
     ない。
3. **固定オーバーレイではないのに `position: fixed` として検出された**
   - `position: fixed` は「サイト側で作った content」であって、「常に
     覆うもの」ではない。重ね合わせの順序や `pointer-events` を人工で
     確認したうえで、**対象外とするなら除外理由を `EXCLUSIONS` に
     1 行足す**（理由の文章つき。gate の出力にそのまま出る）。
4. **`focus-indicator-removed-in-css` が「ラッパの解除」を「フォーカス可能要素の解除」と取り違えた**
   - `:focus-within` は**一律で対象**である（`focus-within` を持つセレクタは
     すべて走査される）。フォーカス可能要素**ではない**ラッパ
     （例: `.field:focus-within { outline: none }`）に適用すると、
     その下のフォーカス可能要素の指示子は消えていないのに
     `focus-indicator-removed-in-css` として報告される。
   - 確認: そのルールの適用の下に**実際にフォーカスできる要素**があるか、
     かつその要素が**自分の** `:focus-visible` で指示子を持つかを、
     コードで確かめる（ラッパ自身がフォーカス可能かどうかではない）。
   - 解除: 解除は**フォーカス可能要素側の指示子**で担保する
     （ラッパは `outline: none` のままでよい）。gate の閾値は下げず、
     要素側の指示子の実装を記録として足す（1 と同じ扱い）。
     判定の形だけを示したいときは `pass/` に fixture を 1 件追加する
     （2 と同じ扱い）。
   - **owner へ仰ぐ条件**: フォーカス可能要素が**どの rule にも**指示子を
     持たないとき（＝実際の欠陥）は、解除ではなく**出荷の修正**である。

いずれも、解除は「gate の判定を緩める」ことではなく「契約の記録を
増やす」こととして扱う。判断と記録は PR の本文に残す。

## 再現手順

```sh
# 1. 機械 gate（pnpm run validate:fast にも含まれる）
pnpm run a11y:focus-visible:check

# 2. gate のテストと fixture 目録
node --test scripts/check-a11y-focus-visible.test.mjs
node --test scripts/capture-a11y-focus-visible.test.mjs

# 3. ブラウザで 2 状態を実測し、画像を書き出す
pnpm run capture:a11y-focus-visible
```

capture は `.tmp/a11y-focus-visible/report.json` に実測値
（両状態の矩形・`elementFromPoint` の結果・計算済み outline）、gate の
判定、補償ルール、WCAG 対応表、ビューポートとエンコード設定を記録する。
`。tmp/a11y-focus-visible/harness` に生成されるハーネスは
`src/styles.css` の補償ルールと `src/editorial/nav/PublicNav.tsx` の
フォーカスリングだけを持ち込む。デプロイも、リモート binding への
アクセスも、secret の読み取りも行わない。

## 既存 gate との関係

- **Issue #399（色のコントラスト）** が「指示子が背景に対して読めるか」を
  持つ。この gate は「指示子が存在するか」「隠されないか」のみを持つ。
  2 つの gate は別の rule として共存し、どちらも緩めない。
- **Issue #407 / #397 / #396 / #409** の各 gate と同じ型
  （純 Node / offline / status-only・2 段の自己検査・fixture 目録の
  完全一致・fast gate への登録）継っている。
