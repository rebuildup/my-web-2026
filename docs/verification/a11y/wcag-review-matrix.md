# WCAG 2.2 A/AA の手動検査表と、その記録を管理する gate（Issue #410）

> 検証対象: **機械では判定できない WCAG 2.2 A/AA の項目**について、
> どの surface の **どの state** を、**誰が** 判断したかを記録する表と、
> その記録が壊れていないことを検査する gate。
> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の **A / AA**。
>
> - 表（機械可読）: `quality/wcag-review-matrix.json`
> - gate: `scripts/check-a11y-wcag-review-matrix.mjs`
> - gate の fixture: `scripts/fixtures/a11y-wcag-review-matrix/{pass,fail}/`
> - 検証画像: `docs/verification/a11y/wcag-review-matrix.webp`

## この Issue が追加したもの

自動検査（#393 / #396 / #397 / #398 / #399）が決めるのは、
**機械が決められるもの**（名前・役割・コントラスト・見出し構造・alt 文字）である。
キーボードだけで最後まで操作できるか、フォーカスの順序が意味の順序と一致するか、
200 % に拡大しても文字が重なったり欠けたりしないか、スクリーンリーダーの読み順が正しいか。
これらは **機械では判定できない**。

この Issue が追加したのは、その判定を **誰が・いつ・どの環境で・結果として** 記録したか
を保持する **表** と、その表が壊れていないことを **機械で** 検査する gate である。

### 中核の規則: 「機械で合格」と「人が確認済み」は別の state

| state | 意味 | 記録が持つもの |
| --- | --- | --- |
| `auto-pass` | npm の gate が **機械で** 判定した | 判定した gate の名前 **だけ** |
| `human-verified` | **人が** 検査して合格した | 検査者・実施日・環境・結果 |
| `human-failed` | **人が** 検査して不合格だった | 検査者・実施日・環境・結果 |
| `not-reviewed` | まだ誰も検査していない | 検査の責任を持つ者 **だけ** |

この 4 つは **別の state** であり、**相互に変換できない**。

- `auto-pass` の記録に **検査者・実施日・環境・結果は書けない**
  （誰も見ていないので、証跡は無い）。書くと gate が
  `item-review-state-invalid` で red にする。
- `human-verified` の記録には **検査者・実施日・環境・結果** が **必ず** 要る。
  1 つでも空なら `item-evidence-missing` で red にする。
- `method` が `machine` の項目が `human-verified` になっても、
  `method` が `human` の項目が `auto-pass` になっても、
  どちらも `item-review-state-invalid` で red にする。
  **`auto-pass` から `human-verified` へ書き換える経路はコードに存在しない。**

### 「自動 pass だけで AA 準拠完了と表示しない」を物理的に無くす

上の state の分離だけでは、**文書側が**「機械の pass を AA 準拠の根拠として書く」
余地が残る。だから gate は **表記そのものを** 検査する。

1. gate は **完成主張の語句**（`scripts/check-a11y-wcag-review-matrix.mjs` の
   `CLAIM_PHRASES`）を **ドキュメント全体**（`README.md` と `docs/**`）から探す。
2. 同じ行に **否定・禁止の修飾語**（`CLAIM_QUALIFIERS`。「無い / 禁止 /
   主張 しない」など）があれば、その行は **語句の言及** であり **主張ではない**。
   （だからこの文書も語句を **列挙** できる。）
3. 主張と判定された行があるとき、**次の両方を満たすこと** を要求する。
   - 表に `human-verified` の項目が **1 件以上** ある（機械の pass は証跡ではない）
   - その行が **この表を指している**（`wcag-review-matrix` を含む）
4. どちらかを欠く行は `compliance-claim-unbacked` で red にする。

**現在の状態**: 表に `human-verified` は **0 件** なので、
**どの文書も AA 準拠を主張できない**。gate の出力にも
`site-level conformance claim: NOT available` と出る。

> 語句の具体形（この表：**禁止**）：
>
> | 語句 | gate の扱い |
> | --- | --- |
> | `AA 準拠完了` | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
> | `AA 適合完了` | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
> | `AA 準拠済み` | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
> | `AA 適合済み` | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
> | `WCAG 2.2 AA 適合済み` | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
> | `WCAG 2.2 AA 準拠済み` | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
> | `WCAG 2.2 AA compliant` | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |

## 適用対象・対象外・基準

### 基準（SC）

gate が扱えるのは **Level A / Level AA の達成基準だけ** である
（`WCAG_22_CRITERIA`）。**AAA の基準は混ざらない** — 適合の主張の粒度を
ぼかさないため。A/AA 30 項目が **この表のスコープ** で、
各項目は **「項目で覆っている」** か **「理由つきで適用外」** の
どちらかで **必ず** 決着している。

| 基準 | レベル | 扱い |
| --- | --- | --- |
| SC 1.1.1 Non-text Content | A | 機械（`a11y:image-alt:check`） |
| SC 1.3.1 Info and Relationships | A | 機械（表 / コード）と人（フォーム） |
| SC 1.3.2 Meaningful Sequence | A | 人（読み上げ順序） |
| SC 1.3.4 Orientation | AA | 人（縦 / 横） |
| SC 1.3.5 Identify Input Purpose | AA | 人（`autocomplete` 属性） |
| SC 1.4.1 Use of Color | A | 人（色だけで意味を伝えないか） |
| SC 1.4.3 Contrast (Minimum) | AA | 機械（`a11y:contrast:check`） |
| SC 1.4.4 Resize Text | AA | 人（200 % 拡大） |
| SC 1.4.10 Reflow | AA | 人（320 px） |
| SC 1.4.11 Non-text Contrast | AA | 機械（`a11y:contrast:check`） |
| SC 1.4.12 Text Spacing | AA | 人（text-spacing 差し込み） |
| SC 1.4.13 Content on Hover or Focus | AA | 人（Tool の同意表示） |
| SC 2.1.1 Keyboard | A | 人（キーボードのみ） |
| SC 2.1.2 No Keyboard Trap | A | 人（フォーカス順序全体） |
| SC 2.4.1 Bypass Blocks | A | 人（skip link とランドマーク） |
| SC 2.4.2 Page Titled | A | 人（各公開ルートの title） |
| SC 2.4.3 Focus Order | A | 人（タブ順序） |
| SC 2.4.6 Headings and Labels | AA | 人（見出しの文言） |
| SC 2.4.7 Focus Visible | AA | 人（フォーカスリング） |
| SC 2.4.11 Focus Not Obscured (Minimum) | AA | 人（固定ヘッダー） |
| SC 2.5.8 Target Size (Minimum) | AA | 人（24 × 24 CSS px） |
| SC 3.1.1 Language of Page | A | 人（`html lang`） |
| SC 3.1.2 Language of Parts | A | 機械（`a11y:language-of-parts:check`） |
| SC 3.3.1 Error Identification | A | 人（失敗パネル） |
| SC 3.3.2 Labels or Instructions | A | 人（空欄パネル） |
| SC 4.1.2 Name, Role, Value | A | 機械（アイコンボタン）と人（フォーム control） |
| SC 4.1.3 Status Messages | AA | 人（ErrorSummary） |
| SC 1.2.2 Captions (Prerecorded) | A | **適用外** — 事前録音の音声・動画を出荷していない |
| SC 1.2.4 Audio Description (Prerecorded) | A | **適用外** — 同じ理由 |
| SC 3.3.7 Redundant Entry | AA | **適用外** — 公開画面には複数手順のフォームが無い（招待フローは認証された管理画面） |

**適用外は「黙って無視する」のではなく「理由つきの決定」** である。
理由の無い適用外は `criterion-exclusion-reason-missing` で red になる。
また、**覆うとも適用外とも決着していない基準** は
`criterion-undisposed` で red になる（「見ていない」は決定ではない）。

### state（検査の対象状態）

検査する状態を **明示的に列挙** する。gate の語彙
（`REVIEW_STATES`）は 9 状態で、表は **全部** を列挙しなければならず、
**各状態を覆う項目が 1 件以上** なければならない。

| state | 種別 | 意味 |
| --- | --- | --- |
| `normal` | 既定 | その surface が出荷状態のままのとき |
| `empty` | markup | まだ何も入っていないとき |
| `error` | markup | 失敗した状態（拒否・必須の欠落） |
| `narrow` | markup | CSS 320 px 幅 |
| `zoomed` | interaction | 文字を 200 % に拡大 |
| `text-spacing` | interaction | SC 1.4.12 の text-spacing 差し込み |
| `keyboard-only` | interaction | キーボードだけで操作 |
| `focus-visible` | interaction | control にフォーカスリングがある |
| `screen-reader` | interaction | スクリーンリーダーで読み上げ |

- **markup 状態**は surface 自身が **描画する** 状態なので、surface は
  **その状態を表す語**（`export:MobileWidth` のような story の export 名や、
  パネルの見出し語）を宣言し、gate は **その語がソースにまだあるか** を
  検査する。語が消えたら `surface-state-missing` で red になる
  （**fixture が検査対象の state を再現しなくなった** ため）。
- **interaction 状態**は **検査者が操作して作る** 状態なので、語は不要。
- どちらの state でも、**その (surface, state) の組み合わせが宣言されていない**
  なら `surface-state-missing` で red になる。

### surface（検査対象の fixture / 画面）

**新規の公開文言は作らない。** 検査対象の state は **既存の story**と
**既存の公開画面**で再現する。表が指す surface が消えた場合、
検査は `surface-missing` で red になる。

| surface | 種別 | 場所 | 再現する markup 状態 |
| --- | --- | --- | --- |
| `form-gallery` | story | `src/editorial/forms/form-errors.stories.tsx#Gallery` | `empty`（空欄）/ `error`（失敗）/ `narrow`（縮小表示） |
| `table-code-story` | story | `src/editorial/table-code.stories.tsx#MobileWidth` | `narrow` |
| `status-tiles-story` | story | `src/home/status/tiles.stories.tsx#AllOk` | `empty` / `narrow` |
| `glyph-headings-story` | story | `src/editorial/glyph-headings.stories.tsx#Default` | — |
| `embed-consent-story` | story | `src/tools/embed-consent-notice.stories.tsx#ClickToLoad` | `error`（purpose が無い状態） |
| `home-route` | route | `src/routes/index.tsx` | — |
| `contact-route` | route | `src/routes/contact.tsx` | — |
| `app-source` | source | `src` | — |
| `editorial-source` | source | `src/editorial` | — |

`form-gallery` は **Issue #404 が揃えて出荷した状態ギャラリー** そのもので、
本 Issue は **状態を追加していない**（正常 / 空欄 / 形式違反 / 失敗 / 縮小表示 の
5 状態は Issue #404 の story が既に出荷している）。

## 機械検査と人間の評価の区別

表の 27 項目は、**どちらが判断するか** で分かれる。

### 機械が判断する（5 項目 / `auto-pass`）

| 項目 | 基準 | 判定する gate |
| --- | --- | --- |
| `image-alt` | SC 1.1.1 | `pnpm run a11y:image-alt:check` |
| `contrast` | SC 1.4.3 / 1.4.11 | `pnpm run a11y:contrast:check` |
| `icon-button-names` | SC 4.1.2 | `pnpm run a11y:icon-button-names:check` |
| `language-of-parts` | SC 3.1.2 | `pnpm run a11y:language-of-parts:check` |
| `table-semantics` | SC 1.3.1 | `pnpm run a11y:table:code:check` |

**この 5 項目は「機械で合格」であり、「人が確認済み」ではない。**
表はそれを `auto-pass` と記録し、**検査者・実施日・環境・結果は書かない**
（書くと red になる）。**AA 準拠の根拠にはならない。**

### 人が判断する（22 項目 / 現在は全件 `not-reviewed`）

| 項目 | 基準 | surface | state |
| --- | --- | --- | --- |
| `keyboard-navigation` | SC 2.1.1 | `home-route` | `keyboard-only` |
| `keyboard-trap` | SC 2.1.2 | `home-route` | `keyboard-only` |
| `focus-order` | SC 2.4.3 | `home-route` | `keyboard-only` |
| `focus-visible` | SC 2.4.7 | `home-route` | `focus-visible` |
| `focus-not-obscured` | SC 2.4.11 | `home-route` | `focus-visible` |
| `target-size` | SC 2.5.8 | `form-gallery` | `normal` |
| `reading-order` | SC 1.3.2 | `home-route` | `screen-reader` |
| `heading-labels` | SC 2.4.6 | `glyph-headings-story` | `normal` |
| `resize-text` | SC 1.4.4 | `form-gallery` | `zoomed` |
| `text-spacing` | SC 1.4.12 | `form-gallery` | `text-spacing` |
| `reflow` | SC 1.4.10 | `table-code-story` | `narrow` |
| `status-colour` | SC 1.4.1 | `status-tiles-story` | `normal` |
| `form-error-identification` | SC 3.3.1 | `form-gallery` | `error` |
| `form-labels` | SC 3.3.2 | `form-gallery` | `empty` |
| `status-messages` | SC 4.1.3 | `form-gallery` | `error` |
| `control-names` | SC 4.1.2 | `contact-route` | `normal` |
| `contact-input-purpose` | SC 1.3.5 | `contact-route` | `normal` |
| `embed-consent-hover` | SC 1.4.13 | `embed-consent-story` | `normal` |
| `orientation` | SC 1.3.4 | `home-route` | `normal` |
| `bypass-blocks` | SC 2.4.1 | `home-route` | `normal` |
| `page-titles` | SC 2.4.2 | `app-source` | `normal` |
| `language-of-page` | SC 3.1.1 | `app-source` | `normal` |

**現在の状態: 22 項目すべて `not-reviewed`（検査待ち）。**
`assignedTo` に **検査の責任を持つ者**（owner）が記録されている。
**1 件も `human-verified` ではない**ので、**どの文書も AA 準拠を主張できない**。

`autoGates` に `a11y:axe:check` を書いている項目は、
**機械が判定できる部分**（各ページの title、向き、スキップ、control の名前）が
**既に axe の走査で決まっている** ことを示すもので、
**その項目全体が機械で決まっている** ことを意味しない
（`method` は `human` のまま）。`a11y:axe:check` は preview サーバを要する
ので **fast gate ではなく release lane** で走る。

## 必須フィールド（fail-closed）

| フィールド | 必須 | 意味 |
| --- | --- | --- |
| `id` / `subject` / `scope` / `surface` / `state` / `method` | 常に | 項目を識別する情報と **誰が判断するか** |
| `sc` | 常に | 覆う SC 番号（1 個以上） |
| `autoGates` | 常に（配列） | 機械の半分を決める npm script。`auto-pass` では **1 件以上** |
| `review.state` | 常に | `auto-pass` / `human-verified` / `human-failed` / `not-reviewed` |
| `review.assignedTo` | `human` の項目で常に | 検査の責任を持つ者（**`not-reviewed` なら必須**） |
| `review.reviewer` | 実施した検査で必須 | **検査者**（`auto-pass` / `not-reviewed` では **禁止**） |
| `review.performedAt` | 実施した検査で必須 | **実施日**（ISO 日付） |
| `review.environment` | 実施した検査で必須 | **環境**（ブラウザ・OS・支援技術など） |
| `review.result` | 実施した検査で必須 | `pass` / `fail`（`auto-pass` / `not-reviewed` では **禁止**） |

- 必須フィールドが 1 つでも空なら `item-field-missing` / `item-evidence-missing`。
- **未記入を「合格」にしない。** 検査がまだなら `not-reviewed` として
  **未実施として報告**する（`state-uncovered` のような「空の項目」で
  覆したふりはしない）。
- **証跡が古くなれば red になる。** `reviewWindowDays`（今は 365 日）を
  超えた `performedAt` は `item-evidence-stale`、未来の日付も同 rule。
  日付だけを書き直すのは「記録の更新」ではなく「検査の再実施」である。

## gate が報告する rule

| rule | 意味 |
| --- | --- |
| `item-field-missing` | 必須フィールドが欠落 / 空 |
| `item-duplicate-id` | id が重複 |
| `item-sc-unknown` | 語彙に無い SC 番号（**推測しない**） |
| `item-state-unknown` | 語彙に無い state |
| `item-method-invalid` | `method` が `machine` / `human` 以外 |
| `item-review-state-invalid` | 記録 state が method と合わない / 禁じられた証跡を持つ |
| `item-evidence-missing` | 実施した検査の証跡が足りない / 結果と state が食い違う |
| `item-evidence-stale` | 証跡が窓より古い / 未来の日付 |
| `item-auto-gate-missing` | 参照した npm script が存在しない |
| `surface-missing` | surface が宣言されていない / ファイルが無い |
| `surface-state-missing` | その surface が state を再現しなくなった |
| `state-undisposed` | 語彙の state が表に列挙されていない |
| `state-uncovered` | 列挙された state を覆う項目が無い |
| `criterion-undisposed` | 基準が覆うとも適用外とも決着していない |
| `criterion-exclusion-reason-missing` | 適用外理由が無い |
| `criterion-conflict` | 同じ基準が覆われ、かつ適用外 |
| `compliance-claim-unbacked` | 人の確認が無いまま AA 準拠を主張している |
| `fixture-expectation-mismatch` | fixture が自分の期待どおりに振る舞っていない |
| `fixture-contract-missing` | fixture が読めない / ディレクトリが空 |

**終了コード**: 0 = 記録が壊れていない / 1 = 違反がある / 2 = 判断できない
（表が読めない・表の形が違う）。

**gate が緑の意味**: **表が壊れていない** ことだけである。
**「このサイトが WCAG 2.2 AA に適合している」ことを意味しない。**
出力には `a green run of this gate means the TABLE is intact. It does not mean
the site conforms to WCAG 2.2 AA.` と明示される。

## 2 段判定（gate は自分の fixture を読む）

| fixture | 期待 |
| --- | --- |
| `pass/01-intact-matrix.json` | 違反 0 件 |
| `pass/02-claim-with-human-verification.json` | 違反 0 件（人の確認があり表を指す主張は受理する） |
| `fail/01-review-without-reviewer.json` | `item-evidence-missing` |
| `fail/02-unknown-state.json` | `item-state-unknown` |
| `fail/03-not-reviewed-with-evidence.json` | `item-review-state-invalid` |
| `fail/04-missing-surface.json` | `surface-missing` |
| `fail/05-unbacked-claim.json` | `compliance-claim-unbacked` |
| `fail/06-exclusion-without-reason.json` | `criterion-exclusion-reason-missing` |
| `fail/07-unknown-auto-gate.json` | `item-auto-gate-missing` |
| `fail/08-stale-evidence.json` | `item-evidence-stale` |
| `fail/09-uncovered-state.json` | `state-uncovered` |
| `fail/10-conflicting-criterion.json` | `criterion-conflict` |

fixture 集合は **完全一致** で管理する（1 個落としても
`fixture-expectation-mismatch` で gate が red になる）。

## 誤検知・誤陰性を見つけたときの解除手順

| 状況 | 対応 |
| --- | --- |
| state の語彙に足りない state がある | `REVIEW_STATES`（gate の語彙）に **追加** する。語彙は gate 側にあるので、**表だけの変更では state を増やせない** |
| 表が列挙すべき state を忘れている | 表の `states` に **追加**し、覆う項目を 1 件足す（`state-uncovered` が red になる） |
| surface が指す story が改名された | 表の `surface`（path / export）と `reproduces` のマーカーを **現実に合わせて更新**する。`surface-missing` / `surface-state-missing` が red になる |
| story が検査対象の state を持たなくなった | **新しい state を作るのではなく**、その検査を別の surface に向けるか、その項目を `excluded` 相当（基準の適用外）にする |
| 項目に SC 番号を書きたいが語彙に無い | 語彙は **Level A / AA だけ** を持つ。AAA の基準は **この表の対象外**（`excluded` に理由を書いて除外する） |
| 機械が決められる部分が増えた | `method` を `machine` に **変えずに**、`autoGates` に gate 名を追加する。`auto-pass` へ変更するのは **人が確認したあとのみ** |
| 人が確認した項目を記録したい | `review.state` を `human-verified`（または `human-failed`）にし、**検査者・実施日・環境・結果** を **すべて** 書く。1 つでも空なら red |
| 検査した時期が古くなった | 検査を **再実施** して `performedAt` を更新する。**日付だけ書き換えてはならない**（`item-evidence-stale` が red になる） |
| 主張の語句を誤検知した | その行に **否定・禁止の修飾語**があるか確認する。語句の **列挙** だけなら `CLAIM_QUALIFIERS` による言及扱いで red にならない |
| 機械の pass を AA 準拠の根拠として書きたい | **書けない。** 人の確認（`human-verified`）が 1 件出来たら、その行は **この表を指す** 必要があり、語句そのものは **禁止** のまま |

## スクリーンショット

`docs/verification/a11y/wcag-review-matrix.webp`
（Issue #410 が指定する `wcag-review-matrix.png` の WebP 版。
**PNG はリポジトリに置いていない** — capture script が `.png` を拒否する規約のため）。

- 生成: `pnpm run capture:a11y-wcag-review-matrix`
- 中身（Issue が要求する 3 つ）:
  1. **実表示** — 出荷している状態ギャラリー
     （`src/editorial/forms/form-errors.stories.tsx#Gallery`）が **実際に描画された** 画面。
     検査対象の `empty` / `error` / `narrow` の state を含む。
  2. **支援技術の結果** — 失敗パネルに対する Chromium のアクセシビリティツリー
     （`alert` 見出し、field へのリンク、`[invalid]` の textbox）。
  3. **検証レポート** — gate 自身の出力（機械で合格した項目 / 検査待ちの項目 /
     適用外の基準 / 「表が壊れていない」ことと「AA 準拠ではない」ことの区別）。
- 失敗条件: 出力パスが `.webp` でなければ拒否（PNG は書かない）。
  中間 PNG は `.tmp/` に作り、最後に削除する。gate が違反を報告しているときは
  **成果物を書かずに** exit 1。
- **画像は合格の代用ではない。** 画像は「state が存在する」「ブラウザが
  解決した名前」までを示すだけで、**手動検査そのものは実施していない**。

## 検証コマンド

```bash
pnpm run a11y:wcag-review-matrix:check    # 機械検査（gate）
pnpm run capture:a11y-wcag-review-matrix  # Chromium で実測して WebP を生成
node --test scripts/check-a11y-wcag-review-matrix.test.mjs
node --test scripts/capture-a11y-wcag-review-matrix.test.mjs
node --test scripts/_quality-gate-plan.test.mjs
```

## 既知の制約

- **`human-verified` は 0 件。** 22 項目すべてが `not-reviewed` である。
  実際の検査（キーボード操作、拡大、スクリーンリーダー）是 **人が** やるもので、
  gate はその **記録** を管理する。**gate は代理で検査しない。**
- **`not-reviewed` は「不合格」ではない。** 「まだ見ていない」を
  「失敗した」とは書かない。gate の出力は `outstanding` として数える。
- **`auto-pass` の 5 項目は「その範囲」に限る。** 例えば
  `icon-button-names` は `src/**` のアイコンボタンの **名前** だけを扱う。
  基準全体の適合ではない。
- **日付に依存する。** `item-evidence-stale` は `today` との差で判定する
  （`--today=YYYY-MM-DD` で固定できる）。証跡が 1 年を超えた項目は
  **再検査が必要** として red になる。
- **支援技術の実挙動は測っていない。** 検証画像のアクセシビリティツリーは
  **Chromium が解決した** ツリーであって、VoiceOver / NVDA の読み上げではない。
  実機での読み上げは `screen-reader` state の人による検査の対象である。
- **story の state はマーカー語でしか見ていない。** `export:MobileWidth` のような
  export 名やパネル見出し語が **まだあるか** を見ているので、
  「その export が **どの state を描くか**」の正しさは人の判断に依存する。
- **入力の出典は 2 つの典拠だけ**（WCAG 2.2 と
  <https://zenn.dev/catnose99/articles/547cbf57e5ad28>）。後者はこの表の
  検査項目の並びの参考であり、判定の物差しではない。
