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

1. gate は **完成主張のパターン**（`scripts/check-a11y-wcag-review-matrix.mjs` の
   `CLAIM_PATTERNS`）を **ドキュメント全体**（`README.md` と `docs/**`）から探す。
   **固定のフレーズ列ではなく「レベル + 基準 + 主張」の組み合わせ**で判定するので、
   文の終わり（済み / 完了 / しています）や語順（`conforms to WCAG 2.2 AA` /
   `WCAG 2.2 AA に適合しています`）に依存しない。
2. **述語に隣接した** 否定・禁止の修飾語（`CLAIM_QUALIFIERS` / `CLAIM_NEGATIONS`。
   「無い / 禁止 / 主張 しない / not / never」など）があれば、その行は
   **語句の言及** であり **主張ではない**。
   修飾語の位置は **述語との距離** で判定する — 同じ文のうしろなら隣接、
   うしろではなく **直前 10 文字以内**（英語は **6 語**）なら隣接とみなす。
   ただし途中に句読点があれば **別の節** なので隣接ではない。
   **行のどこかにあればよい、ではない。**
   英文の文は **行をまたぐ** ことがあるので、修飾語を探す範囲は **行ではなく段落** である
   （`It does not mean the site` / `conforms to WCAG 2.2 AA.` の否定は前の行にある）。
3. 主張と判定された行があるとき、**次のすべて**を満たすことを要求する。
   - 表の **手動項目が 1 件残らず `human-verified`** である
     （`not-reviewed` が 0 件、かつ `human-failed` が 0 件。
     1 件だけ合格しただけでは **サイト全体の適合** には足りない）
   - その **主張の段落** が **この表を正確に指している**
     （`quality/wcag-review-matrix.json` か
     `docs/verification/a11y/wcag-review-matrix.md` を **ファイル名として** 書いていて、
     そのファイルが **実在する**。`wcag-review-matrix-old.md` のような
     **正規でない名前** や **存在しないファイル** は引用にならない）
4. どれかを欠く行は `compliance-claim-unbacked` で red にする。

**現在の状態**: 表に `human-verified` は **0 件** なので、
**どの文書も AA 準拠を主張できない**。gate の出力にも
`site-level conformance claim: NOT available` と出る。

> 検出パターン（この表：**禁止**）：
>
> | パターン | 含む書き方 | gate の扱い |
> | --- | --- | --- |
> | `ja-level` | 「AA 準拠」「AA に適合」「AA 適合済み」 | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
> | `en-level` | 「WCAG 2.2 AA compliant」 | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
> | `en-standard` | 「conforms to WCAG 2.2 AA」 | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
> | `en-meets` | 「meets WCAG 2.2」 | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
> | `en-noun` | 「WCAG 2.2 AA conformance」 | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
> | `ja-standard` | 「WCAG 2.2 AA に適合しています」 | 検出したら `compliance-claim-unbacked`（**この語句は禁止**） |
>
> 修飾語が別の節にあるときは **主張のままである**。たとえば
> 「根拠がないが、このサイトは WCAG 2.2 AA 適合済みです」**という行は主張である**
> （gate が red にする）。この判定は fixture
> `fail/12-claim-negated-in-another-clause.json` が固定している。

## 適用対象・対象外・基準

### 基準（SC）

gate が扱えるのは **Level A / Level AA の達成基準だけ** である
（`WCAG_22_CRITERIA`）。**AAA の基準は混ざらない** — 適合の主張の粒度を
ぼかさないため。

**基準の母集合**は gate の定数 `WCAG_22_A_AA_UNIVERSE` **1 か所**に持つ。
これは **WCAG 2.2 仕様**（W3C, <https://www.w3.org/TR/WCAG22/>）の達成基準の
一覧から **2026-10-23 に写した** もので、**55 個**（Level A 31 個 + Level AA 24 個）である。

- この表が扱うのは **30 個**（A 15 個 + AA 15 個）。
- 残りの **25 個**（A 16 個 + AA 9 個）は **表の外側の決定**として
  下の「適用範囲の決定」に記す。
- **2 つのリスト（表の語彙 + 適用範囲の決定）の和集合が母集合と一致すること**を
  gate が **両方向**（漏れ / 余剰）で検査する
  （`criterion-universe-mismatch`）。つまり **基準が 1 つも黙って消えない**。

この表の 30 項目は **「項目で覆っている」** か **「理由つきで適用外」** の
どちらかで **必ず** 決着している。

> **WCAG 2.2 で削除された基準**: `4.1.1 Parsing` は WCAG 2.2 で
> **obsolete（適合要件から削除）** と明記されている。したがって **A/AA の母集合には
> 含まれない** — A 適合の主張の一部ではない。黙って外すのではなく
> `WCAG_22_OBSOLETE_CRITERIA` に **名前と理由を載せて** 記録しており、
> 表や適用範囲の決定にこれを書くと `criterion-universe-mismatch` で red になる。

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
| SC 3.1.2 Language of Parts | AA | 機械（`a11y:language-of-parts:check`） |
| SC 3.3.1 Error Identification | A | 人（失敗パネル） |
| SC 3.3.2 Labels or Instructions | A | 人（空欄パネル） |
| SC 4.1.2 Name, Role, Value | A | 機械（アイコンボタン）と人（フォーム control） |
| SC 4.1.3 Status Messages | AA | 人（ErrorSummary） |
| SC 1.2.2 Captions (Prerecorded) | A | **適用外** — 事前録音の音声・動画を出荷していない |
| SC 1.2.4 Captions (Live) | AA | **適用外** — 同じ理由 |
| SC 3.3.7 Redundant Entry | A | **適用外** — 公開画面には複数手順のフォームが無い（招待フローは認証された管理画面） |

**適用外は「黙って無視する」のではなく「理由つきの決定」** である。
理由の無い適用外は `criterion-exclusion-reason-missing` で red になる。
また、**覆うとも適用外とも決着していない基準** は
`criterion-undisposed` で red になる（「見ていない」は決定ではない）。

#### 適用外の 2 種類（混ざらない）

| 種類 | 対象 | 書く場所 | 検査される rule |
| --- | --- | --- | --- |
| 表の適用外 | 語彙にある A/AA の基準のうち、この表が覆わないもの（今は 1.2.2 / 1.2.4 / 3.3.7） | 表の `excluded` | `criterion-undisposed` / `criterion-exclusion-reason-missing` / `criterion-conflict` |
| スコープの決定 | 語彙の **外側** にある A/AA の基準（下の 25 個） | この文書の「適用範囲の決定」 | `scope-decision-doc-mismatch` / `criterion-universe-mismatch` |

**どちらが単一の事実源か**:

- `excluded` は **表の語彙（gate の `WCAG_22_CRITERIA`）が持つ基準だけ** を
  受け付ける。語彙に無い番号を書くと `item-sc-unknown` で red になる。
- **25 個のリストと理由の事実源は gate の定数 `SCOPE_DECISIONS`** であり、
  下の表は **その写し** である。ずれると `scope-decision-doc-mismatch` で red になる
  （表の SC 番号・レベル・名前・理由が 1 つでも違えば red）。
- **レベルと名前の事実源は `WCAG_22_A_AA_UNIVERSE`** であり、
  2 つのリストはそこから **参照する**（書き写さない）。だから
  「表の語彙」と「適用範囲の決定」が同じ基準について **違うレベル** を
  持つことはない。
- **AAA は `excluded` に書かない**（書くと `item-sc-unknown` で red になる）。
  AAA は **この表が扱う粒度（適合の主張に含める粒度）の外側** であり、
  この表は AAA を「覆うとも適用外とも」主張しない。つまり AAA は
  「黙って無視」ではなく **「この表の対象外」** として決着している。

### 適用範囲の決定（表の外側にある 25 基準）

WCAG 2.2 の Level A / AA の基準のうち、**この表が扱わない 25 基準** と
その理由。**これは表の `excluded` とは別の決着**である（上の表を参照）。
**事実源は gate の定数 `SCOPE_DECISIONS`** で、この表はその写し。
1 つでも違えば `scope-decision-doc-mismatch` で gate が red になる。

| SC | レベル | 名前 | 理由 |
| --- | --- | --- | --- |
| 1.2.1 | A | Audio-only and Video-only (Prerecorded) | 事前録音の音声・動画だけのコンテンツを出荷していない。 |
| 1.2.3 | A | Audio Description or Media Alternative (Prerecorded) | 事前録音の映像を出荷していない（1.2.1 と同じ理由）。 |
| 1.2.5 | AA | Audio Description (Prerecorded) | 事前録音の映像・音声を出荷していないため、音声説明の代替手段を用意しない（1.2.1 と同じ理由）。 |
| 1.3.3 | A | Sensory Characteristics | 感覚的な特徴だけに頼って指示する表現を使っていない。 |
| 1.4.2 | A | Audio Control | 2 秒以上鳴り止まない音が自動再生する UI を持たない。 |
| 1.4.5 | AA | Images of Text | 画像の中に文字を埋め込む表現を使っていない。 |
| 2.1.4 | A | Character Key Shortcuts | 1 文字のショートカットキーを使う操作を用意していない。 |
| 2.2.1 | A | Timing Adjustable | 時間の制限のある操作を用意していない。 |
| 2.2.2 | A | Pause, Stop, Hide | 2 秒以上動き続ける自動更新アニメーションを使っていない。 |
| 2.3.1 | A | Three Flashes or Below Threshold | 1 秒間に 3 回以上点滅する表現を使っていない。 |
| 2.4.4 | A | Link Purpose (In Context) | リンクの目的を文脈ごとに検査する項目をこの表に持たない。 |
| 2.4.5 | AA | Multiple Ways | 複数の到達経路を検査する項目をこの表に持たない。 |
| 2.5.1 | A | Pointer Gestures | パス操作（スワイプなど）を使う操作を用意していない。 |
| 2.5.2 | A | Pointer Cancellation | 単一のポインタ操作だけで操作できる UI に絞っている。 |
| 2.5.3 | A | Label in Name | アクセシブル名の検査は SC 4.1.2 側に集約している。 |
| 2.5.4 | A | Motion Actuation | 端末を振って操作する機能を持たない。 |
| 2.5.7 | AA | Dragging Movements | ドラッグで操作する UI（スライダーなど）を持たない。 |
| 3.2.1 | A | On Focus | フォーカスしただけで自動で開く UI を持たない。 |
| 3.2.2 | A | On Input | 入力値の変更で画面が自動で切り替わる UI を持たない。 |
| 3.2.3 | AA | Consistent Navigation | ページを越えたナビゲーションの順序を検査する項目をこの表に持たない。 |
| 3.2.4 | AA | Consistent Identification | 同じ機能の名称がページを越えて揃っているかを検査する項目をこの表に持たない。 |
| 3.2.6 | A | Consistent Help | ヘルプの置き方の検査項目をこの表に持たない。 |
| 3.3.3 | AA | Error Suggestion | エラーメッセージの修正提案を個別に検査する項目をこの表に持たない。 |
| 3.3.4 | AA | Error Prevention (Legal, Financial, Data) | 法的 / 財務 / データの送信を扱う入力が無い。 |
| 3.3.8 | AA | Accessible Authentication (Minimum) | 認証は管理画面の対象で、この表（公開画面と story）は扱わない。 |

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

**検査の順番**: surface の **実体**（ファイル / story の export）は
**どの state の検査より先に** 確かめる。story の export が消えたとき
`surface-state-missing` だけでは「その state を再現しなくなった」ことしか
分からないが、**実体が消えた**ことは `surface-missing` で分かる。
反过来、**state の種別が markup でも interaction でも default でも
実体の確認は変わらない**（実体が無い surface の検査は何も意味しないため）。

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
| `criterion-universe-mismatch` | A/AA の母集合（55 個）のどれかが、表の語彙と適用範囲の決定の **どちらでも決着していない**（または obsolete な基準を並べている） |
| `compliance-claim-unbacked` | 人の確認が無いまま AA 準拠を主張している |
| `scope-decision-doc-mismatch` | 適用範囲の決定（表の外側にある基準）が gate の定数と文書で食い違っている |
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
| `fail/02-unknown-state.json` | `item-state-unknown` + `state-uncovered` + `surface-state-missing` |
| `fail/03-not-reviewed-with-evidence.json` | `item-review-state-invalid` |
| `fail/04-missing-surface.json` | `surface-missing` |
| `fail/05-unbacked-claim.json` | `compliance-claim-unbacked` |
| `fail/06-exclusion-without-reason.json` | `criterion-exclusion-reason-missing` + `criterion-undisposed` |
| `fail/07-unknown-auto-gate.json` | `item-auto-gate-missing` |
| `fail/08-stale-evidence.json` | `item-evidence-stale` |
| `fail/09-uncovered-state.json` | `state-uncovered` |
| `fail/10-conflicting-criterion.json` | `criterion-conflict` |
| `fail/11-claim-predicate-without-qualifier.json` | `compliance-claim-unbacked` |
| `fail/12-claim-negated-in-another-clause.json` | `compliance-claim-unbacked` |

fixture 集合は **完全一致** で管理する（1 個落としても
`fixture-expectation-mismatch` で gate が red になる）。
**fail fixture の期待は「ちょうどその集合」で判定する** — 期待に無い rule が
出ても、期待した rule が出なくても `fixture-expectation-mismatch` になる
（表は「出てきうる rule を全部宣言する」）。
**fixture は自分のものだけで判断される** — 監査中はリポジトリの
ドキュメントを走査しないので、fixture の判定が「その日の文書の書き方」に
左右されることはない。

**fixture の判定は日付に依存しない** — fixture の証跡の鮮度は
**固定の基準日**（gate の定数 `FIXTURE_REFERENCE_DATE` = 2026-10-23）と
比べる。gate を 「2099 年」 に走らせても fixture の判定は変わらない
（実行日は **リポジトリ自身の表**の鮮さだけを決める）。

## 誤検知・誤陰性を見つけたときの解除手順

| 状況 | 対応 |
| --- | --- |
| state の語彙に足りない state がある | `REVIEW_STATES`（gate の語彙）に **追加** する。語彙は gate 側にあるので、**表だけの変更では state を増やせない** |
| 表が列挙すべき state を忘れている | 表の `states` に **追加**し、覆う項目を 1 件足す（`state-uncovered` が red になる） |
| surface が指す story が改名された | 表の `surface`（path / export）と `reproduces` のマーカーを **現実に合わせて更新**する。`surface-missing` / `surface-state-missing` が red になる |
| story が検査対象の state を持たなくなった | **新しい state を作るのではなく**、その検査を別の surface に向けるか、その項目を `excluded` 相当（基準の適用外）にする |
| 項目に SC 番号を書きたいが語彙に無い | `excluded` には **語彙（Level A / AA）がある基準だけ** を書ける。語彙に無い番号を書くと `item-sc-unknown` で red になる。**AAA は `excluded` に書かない** — 「この表の対象外」として上の「適用範囲の決定」側で扱う |
| 機械が決められる部分が増えた | `method` を `machine` に **変えずに**、`autoGates` に gate 名を追加する。`auto-pass` へ変更するのは **人が確認したあとのみ** |
| 人が確認した項目を記録したい | `review.state` を `human-verified`（または `human-failed`）にし、**検査者・実施日・環境・結果** を **すべて** 書く。1 つでも空なら red |
| 検査した時期が古くなった | 検査を **再実施** して `performedAt` を更新する。**日付だけ書き換えてはならない**（`item-evidence-stale` が red になる） |
| 主張の語句を誤検知した | その行に **述語に隣接した** 否定・禁止の修飾語があるか確認する。語句の **列挙** だけなら `CLAIM_QUALIFIERS` による言及扱いで red にならない。修飾語が **別の節** にある場合は **主張のまま** なので、文の作り直しか記録の追加が必要 |
| 適用範囲の決定（表の外側にある基準）がずれた | gate の定数 `SCOPE_DECISIONS` とこの文書の表を **どちらかに合わせて** 揃える。番号・レベル・名前・理由の 1 つでも違えば `scope-decision-doc-mismatch` で red になる |
| 母集合に無い基準が表や適用範囲の決定に混ざった | `WCAG_22_A_AA_UNIVERSE`（仕様と照合した保存書き起こし）を **仕様と照合し直して** 更新する。`criterion-universe-mismatch` で red になる |
| 消えた基準が黙って抜けている | 消えた基準は **表の語彙** か **適用範囲の決定** の **どちらかに残す**。両方から消えると `criterion-universe-mismatch` で red になる（**黙って無視はできない**） |
| 主張の検出が新しい言い回しを拾わない | `CLAIM_PATTERNS` にパターンを足す。**修飾語（否定）が隣接している** 場合は「言及」なので red にならない |
| 機械の pass を AA 準拠の根拠として書きたい | **書けない。** 主張が許されるのは **手動項目が 1 件残らず `human-verified`** で、その行が **この表を正確に指している** ときだけ。語句そのものは **禁止** のまま |

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

# オプションは「値付き」「値なし」のどちらの書き方も使える
node scripts/check-a11y-wcag-review-matrix.mjs --today=2026-10-23
node scripts/check-a11y-wcag-review-matrix.mjs --today 2026-10-23
node scripts/check-a11y-wcag-review-matrix.mjs --matrix=quality/wcag-review-matrix.json
# 表が読めないとき（存在しないパス）は判断できないので終了コード 2
node scripts/check-a11y-wcag-review-matrix.mjs --matrix=quality/does-not-exist.json; echo "exit=$?"
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
- **基準の母集合は仕様から読み取ったもので、2026-10-23 に照合した。**
  A/AA が **55 個**（Level A 31 個 + Level AA 24 個）である根拠は
  [WCAG 2.2 仕様](https://www.w3.org/TR/WCAG22/) の達成基準の一覧である
  （**2026-10-23 時点で取得・照合**。この保存書き起こしは
  `WCAG_22_A_AA_UNIVERSE` に 1 か所で持つ）。
  `4.1.1 Parsing` は WCAG 2.2 で **obsolete（削除）** と明記されているので
  A/AA の母集合には入らない（`WCAG_22_OBSOLETE_CRITERIA` に理由を載せて記録）。
  gate は **母集合と 2 つのリスト（表の語彙 30 個 + 適用範囲の決定 25 個）の
  和集合が一致すること**を両方向で検査するので、基準が黙って消えることはない
  （`criterion-universe-mismatch`）。
- **照合は 2026-10-23 の時点でしかしていない。** 仕様が改定されたら
  `WCAG_22_A_AA_UNIVERSE` を **仕様と照合し直して** 更新する必要がある。
  gate はこの保存書き起こしとの整合しか見ないので、**仕様そのものの変化は
  検出しない**。
- **AA の適合主張は機械が判定しない。** gate が緑でも、文書が
  「AA 適合済み」と書くことは **禁止** のままである。主張が許されるのは
  **手動項目が 1 件残らず `human-verified`** で、その行が **この表を
  正確に指している**（`quality/wcag-review-matrix.json` か
  `docs/verification/a11y/wcag-review-matrix.md` をファイル名として書いていて、
  そのファイルが実在するとき）ときだけである。**1 件の合格はサイト全体の
  適合の根拠にならない。**
- **主張の検出はパターン依存である。** 検出は `CLAIM_PATTERNS` の
  **パターン**で行うので、**英語表現**（`en-level` / `en-standard` /
  `en-meets` / `en-noun`）と **日本語表現**（`ja-level` / `ja-standard`）を
  別々に持つ。**新しい言い回し**（ほかの言語での同種の表現など）は
  **検出されない** — 検出できない表現は「適合を主張していない」ことではない。
