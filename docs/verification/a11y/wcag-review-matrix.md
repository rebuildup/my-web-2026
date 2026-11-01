# WCAG 2.2 A/AA の手動検査表と、その記録を管理する gate（Issue #410 / Issue #722）

> 検証対象: **機械では判定できない WCAG 2.2 A/AA の項目**について、
> どの surface の **どの state** を、**誰が** 判断したかを記録する表と、
> その記録が壊れていないことを検査する gate。
> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の **A / AA**。
>
> - 表（機械可読）: `quality/wcag-review-matrix.json`
> - gate: `scripts/check-a11y-wcag-review-matrix.mjs`
> - gate の fixture: `scripts/fixtures/a11y-wcag-review-matrix/{pass,fail}/`
> - 適用範囲の決定の fixture: `scripts/fixtures/a11y-wcag-review-matrix/scope/{pass,fail}/`
> - 検証画像: `docs/verification/a11y/wcag-review-matrix.webp`

## この Issue が追加したもの

自動検査（#393 / #396 / #397 / #398 / #399）が決めるのは、
**機械が決められるもの**（名前・役割・コントラスト・見出し構造・alt 文字）である。
キーボードだけで最後まで操作できるか、フォーカスの順序が意味の順序と一致するか、
200 % に拡大しても文字が重なったり欠けたりしないか、スクリーンリーダーの読み順が正しいか。
これらは **機械では判定できない**。

この Issue が追加したのは、その判定を **誰が・いつ・どの環境で・結果として** 記録したか
を保持する **表** と、その表が壊れていないことを **機械で** 検査する gate である。

**Issue #722 が追加したもの**は、**表の外側にある 25 基準の「決定」**の
**記録** である。それまでは **理由が 1 つ**（多くの場合
「この表に検査項目が無い」）しか無く、**「適用外」と「見ていない」が
区別できなかった**。今は **区分（disposition）** が **3 通り** の
どれかで **必ず** 決着し、
- `not-applicable` は **製品についての事実**（証跡）を要求し、
- `applicable-unverified` は **検査者と再現手順** を要求し、
- `applicable-and-verified` は **人間の実測記録** を要求する（このリポジトリには無い）。

**「この表に項目が無い」は適用外の理由にならない。** それは「見ていない」という
宣言であり、gate は `scope-exclusion-not-a-product-fact` で red にする。
併せて、**台帳の構造が green** であることと **監査された品質が pass であること**を
**別の こと** として報告する（下の「リリース評価」）。

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
  下の「適用範囲の決定」に記す。**那里的 25 個は 1 つ残らず
  「意味のある区分」を持つ**（`not-applicable` / `applicable-unverified` /
  `applicable-and-verified`）。**空欄も「表に項目が無い」も無い。**
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
| 表の適用外 | 語彙にある A/AA の基準のうち、この表が覆わないもの（今は 1.2.2 / 1.2.4 / 3.3.7） | 表の `excluded` | `criterion-undisposed` / `criterion-exclusion-reason-missing` / `criterion-conflict` / `scope-exclusion-not-a-product-fact` |
| スコープの決定 | 語彙の **外側** にある A/AA の基準（下の 25 個） | この文書の「適用範囲の決定」 | `scope-decision-doc-mismatch` / `criterion-universe-mismatch` / `scope-disposition-invalid` / `scope-exclusion-not-a-product-fact` / `scope-unverified-missing-review-plan` / `scope-verified-without-review-record` |

**どちらが単一の事実源か**:

- `excluded` は **表の語彙（gate の `WCAG_22_CRITERIA`）が持つ基準だけ** を
  受け付ける。語彙に無い番号を書くと `item-sc-unknown` で red になる。
- **25 個のリストと理由の事実源は gate の定数 `SCOPE_DECISIONS`** であり、
  下の表は **その写し** である。ずれると `scope-decision-doc-mismatch` で red になる
  （表の SC 番号・レベル・名前・**区分**・理由・証跡・検査者・手順が
  1 つでも違えば red）。
- **どちらのリストも「表に項目が無い」を理由にしてはいけない。**
  `excluded` の理由も `SCOPE_DECISIONS` の理由も **製品についての事実** で
  なければ `scope-exclusion-not-a-product-fact` で red になる。
- **レベルと名前の事実源は `WCAG_22_A_AA_UNIVERSE`** であり、
  2 つのリストはそこから **参照する**（書き写さない）。だから
  「表の語彙」と「適用範囲の決定」が同じ基準について **違うレベル** を
  持つことはない。
- **AAA は `excluded` に書かない**（書くと `item-sc-unknown` で red になる）。
  AAA は **この表が扱う粒度（適合の主張に含める粒度）の外側** であり、
  この表は AAA を「覆うとも適用外とも」主張しない。つまり AAA は
  「黙って無視」ではなく **「この表の対象外」** として決着している。

### 適用範囲の決定（表の外側にある 25 基準）

WCAG 2.2 の Level A / AA の基準のうち、**この表が扱わない 25 基準** と、
**その基準についての決定（disposition）**。**これは表の `excluded` とは別の決着**である
（上の表を参照）。**事実源は gate の定数 `SCOPE_DECISIONS`** で、この表はその写し。
SC 番号・レベル・名前・**区分**・理由・証跡・検査者・手順の **1 つでも違えば**
`scope-decision-doc-mismatch` で gate が red になる。

#### 区分（disposition）の語彙 — 「見ていない」を「適用外」にしない

適用範囲の判断には **3 通りしかなく**、25 基準の **どれか 1 つ** を必ず持つ。
**空欄は無い。**

| 区分 | 意味 | 必須のフィールド | 閉じ方 |
| --- | --- | --- | --- |
| `not-applicable` | **出荷している制品が** その基準の対象を持たない | 理由 + 証跡（**製品についての事実**） | 製品についての事実だけで閉じる。理由が「この表に項目が無い」なら **red** |
| `applicable-unverified` | 基準は公開サイトに当てはまるが **誰も見ていない** | 理由 + 証跡（何をすれば閉じるか）+ 検査者 + 手順 | **人が** 手順どおりに確認して初めて閉じる |
| `applicable-and-verified` | 当てはまり、**人が実測した** | 理由 + 証跡 + 検査者 + 手順 + 実測記録 | 人間の実測記録があるときだけ成立する |

**このリポジトリの `applicable-and-verified` は 0 件である。**
owner の実測記録が 1 件も無いので、**この状態を書き込むことは許されない**
（`scope-verified-without-review-record` で red にする）。

**「この表に検査項目が無い」「担当者が居ない」は適用外の理由にならない。**
それは「見ていない」という宣言であって、適用範囲の議論ではない。
gate は理由と証跡の文言をパターンで判定し、`scope-exclusion-not-a-product-fact`
で red にする。負の対照 fixture は
`scripts/fixtures/a11y-wcag-review-matrix/scope/fail/01-table-coverage-exclusion.json`
（削除した「…をこの表に持たない」という文言そのものを再現している）。

**`applicable-unverified` には「誰が・どうやるか」が要る。**
`reviewer`（役割。agent ではない）と `steps`（人が再現できる手順）が
無いと `scope-unverified-missing-review-plan` で red にする
（負の対照 fixture: `scope/fail/02-unverified-without-steps.json`）。

#### 25 基準の決定

| SC | レベル | 名前 | 区分 | 理由 | 証跡 | 検査者 | 手順 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.2.1 | A | Audio-only and Video-only (Prerecorded) | not-applicable | 事前録音の音声・動画だけのコンテンツを出荷していない。 | `src/**` に `<audio>` / `<video>` 要素も `autoplay` 属性も無く（`src/editorial/reduced-motion.ts` の該当箇所は将来の自動再生メディアを検出する条文）、事前録音のメディアを同梱する Tool も無い（`src/tools/manifest.json` にメディアの記載が無い）。 | — | — |
| 1.2.3 | A | Audio Description or Media Alternative (Prerecorded) | not-applicable | 事前録音の映像を出荷していない（1.2.1 と同じ理由）。 | 1.2.1 と同じ。`src/**` に `<video>` 要素が無く、事前録音の映像を同梱する Tool も無い。 | — | — |
| 1.2.5 | AA | Audio Description (Prerecorded) | not-applicable | 事前録音の映像・音声を出荷していないため、音声説明の代替手段を用意しない（1.2.1 と同じ理由）。 | 1.2.1 と同じ。`src/**` に `<video>` / `<audio>` 要素が無く、事前録音の映像・音声を同梱する Tool も無い。 | — | — |
| 1.3.3 | A | Sensory Characteristics | applicable-unverified | 感覚的な特徴（位置・形・色・音）に依存した指示の候補が 1 件ある。ホームのリアクション欄の空表示は「下のボタンから送ってみましょう」と位置で指示している（`src/home/reactions/widget.tsx`）。ただしコントロールの種類「ボタン」も併記しているため、位置だけに依存しているかは未判定。 | 公開画面の指示文を人が読み、感覚的な特徴だけで操作を特定している文が 1 件も無いことを確認する。候補は上記の空表示文と、各フォームの説明文。 | owner | 開発サーバーを起動して `/` を開き、リアクション欄が空のときの文言を読む（`src/home/reactions/widget.tsx`）。<br>`/about`・`/contact`・`/portfolio`・`/tools` を開き、指示文が位置・形・色・音のどれか 1 つにだけ依存していないか読む。<br>位置だけに依存する文があれば、その文がコントロールの種類や役割を併記しているかを判断する。<br>判定と根拠（該当した文と併記の有無）を記録する。 |
| 1.4.2 | A | Audio Control | not-applicable | 2 秒以上鳴り止まない音が自動再生する UI を持たない。 | `src/**` に `<audio>` / `<video>` 要素も `autoplay` 属性も無く、音声を自動再生するコードも無い。 | — | — |
| 1.4.5 | AA | Images of Text | applicable-unverified | 文字を画像として描画している箇所がある。ホームのアクセスカウンタは数字を WebP の 1 枚ずつ（`src/home/digits/*.webp`）で描画している。 | カウンタの桁を実際のテキスト（等幅数字）に置き換えられるか、例外（特定の表示上の必然性）が成立するかを人が判断する。 | owner | `/` を開き、アクセスカウンタの桁が `<img>` 画像で描画されていることを確認する（`src/home/digits/*.webp`）。<br>桁を囲む `role="img"` の `aria-label` が数値を読み上げられることを確認する。<br>桁をテキスト描画（`font-variant-numeric: tabular-nums`）に置き換えられるかを判断する。<br>置き換え可能なら例外は成立しない。判定と根拠を記録する。 |
| 2.1.4 | A | Character Key Shortcuts | not-applicable | 1 文字のショートカットキーを使う操作を用意していない。 | `src/**` の keydown ハンドラは `Escape`・矢印キー・`Home` / `End` のみで、単一文字のショートカットは無い（`src/editorial/nav/PublicNav.tsx`、`src/keyboard/components/KeyboardPage.tsx`、`src/home/reactions/widget.tsx`）。 | — | — |
| 2.2.1 | A | Timing Adjustable | applicable-unverified | 時間の制限のある操作を 1 つ出荷している。管理画面の API キー発行には 5 分の step-up 確認窓（`STEP_UP_MAX_AGE_SECONDS` = 300）が残り、窓が切れると発行できなくなる。公開画面には時間制限が無いが、管理画面を適合の主張の範囲に含めるかどうかの判断がまだ無い。 | step-up 窓が SC 2.2.1 の「内容による時間の制限」に当たるかどうかと、管理画面を適合の主張の範囲に含めるかどうかを判断する。 | owner | 管理画面にログインして `/admin/keys` を開き、step-up 確認（パスワード確認）の窓が 5 分であることを表示していることを確認する（`src/admin/keys/step-up-panel.tsx`）。<br>窓が切れたあとの挙動（step-up が失われ、発行できなくなる等）を確認する。<br>認証前の画面（`/`・`/about`・`/contact`・`/portfolio`・`/tools`・`/admin/login`・`/admin/invitations_/accept`）に時間制限のある操作が無いかを確認する。<br>管理画面を適合の主張に含めるかどうか、含める場合はこの窓が SC 2.2.1 に当たるかを判断し、判定と根拠を記録する。 |
| 2.2.2 | A | Pause, Stop, Hide | not-applicable | 2 秒以上動き続ける自動更新アニメーションを使っていない。 | `src/**` で発行される `animation-name` はカウンタの桁ロールアップ（320 ms）のみで、無限ループも 5 秒を超える自動更新も無い（`src/home/access/tiles.tsx`）。 | — | — |
| 2.3.1 | A | Three Flashes or Below Threshold | not-applicable | 1 秒間に 3 回以上点滅する表現を使っていない。 | `src/**` に点滅するアニメーションが無く、唯一のアニメーション（カウンタの桁ロールアップ）は 320 ms で 1 回だけ再生される（`src/home/access/tiles.tsx`）。 | — | — |
| 2.4.4 | A | Link Purpose (In Context) | applicable-unverified | リンクの目的が文脈だけでは判断しにくい可能性がある。リンク文言だけの記録はできるが、文脈ごとの判断は人がする必要がある（例: 「Portfolio を開く」「記録を開く / Open the record」「← Previous」）。 | 各公開画面のリンク文言を、リンク先を見ずに記録し、直前の文・ページの主題・リンク文言だけで目的が分かるかを判断する。 | owner | 公開画面（`/`・`/about`・`/contact`・`/portfolio`・`/portfolio/my-web-2026`・`/tools`・`/design-system`・`/keyboard`・`/projects/dotfiles`）を 1 枚ずつ開く。<br>各ページのリンク文言を、リンク先を見ずにそのまま記録する。<br>各リンクが「リンク文言 + 直前の文 + ページの主題」だけで目的が分かるかを判断する。<br>判断できないリンクがあれば、文言と前後の文を添えて報告し、判定を記録する。 |
| 2.4.5 | AA | Multiple Ways | applicable-unverified | 複数の到達経路を出す必要がある。公開ナビ（`src/editorial/nav/PublicNav.tsx`）と `GET /sitemap.xml` は同じ URL 群を advertise するが、公開ナビを表示しない画面がある（`/`・`/tools`・`/tools/<slug>`）。公開ナビからも内部リンクからも到達できず、Sitemap にも無い URL があれば、到達経路は 1 通りしかない。 | 各公開 URL について、公開ナビ・内部リンク・サイトマップの何通りで到達できるかを数え、1 通りしかない URL を洗い出す。 | owner | `GET /sitemap.xml` を取得し、掲載されている URL を記録する。<br>各公開 URL について、(a) 公開ナビ、(b) 内部リンク、(c) サイトマップ のうち何通りで到達できるかを記録する。<br>1 通りしかない URL を洗い出す（`/projects/dotfiles` が候補）。<br>判定と、1 通りしかない URL が有ればその URL を記録する。 |
| 2.5.1 | A | Pointer Gestures | not-applicable | パス操作（スワイプなど）を使う操作を用意していない。 | `src/**` に `touchstart` / `touchmove` やパスベクトルのハンドラが無い。 | — | — |
| 2.5.2 | A | Pointer Cancellation | not-applicable | 単一のポインタ操作だけで操作できる UI に絞っている。 | `src/**` に複数ポインタ（マルチタッチ）の操作が無い。`onPointer*` と `touch*` のハンドラ自体が無い。 | — | — |
| 2.5.3 | A | Label in Name | applicable-unverified | 可視ラベルとアクセシブル名の不一致が既知の違反として残っている。`/` の capability リンクは可視テキストが「Portfolio を開く」で `aria-label` は「ポートフォリオ を開く」、`/portfolio` の facet ボタンも可視テキストと `aria-label` が食い違う（`e2e/a11y/axe-baseline.json` の `label-content-name-mismatch`）。 | 可視テキストが `aria-label` に含まれるかを全リンク・ボタンで判断し、食い違う箇所を洗い出す。 | owner | `pnpm run a11y:axe:check` を実行し、`e2e/a11y/axe-baseline.json` の `label-content-name-mismatch` 記録（`/` の `a[aria-label="ポートフォリオ を開く"]` と `/portfolio` の facet ボタン）を確認する。<br>`/` の capability リンクごとに、可視テキストと `aria-label` を突き合わせる。<br>`/portfolio` の facet ボタンごとに、可視テキストと `aria-label` を突き合わせる。<br>不一致ごとに `aria-label` を直すか可視テキストを直すかを判断し、判定と該当箇所を記録する。 |
| 2.5.4 | A | Motion Actuation | not-applicable | 端末を振って操作する機能を持たない。 | `src/**` に `DeviceMotion` / `DeviceOrientation` を使うコードが無い。 | — | — |
| 2.5.7 | AA | Dragging Movements | not-applicable | ドラッグで操作する UI（スライダーなど）を持たない。 | `src/**` にドラッグ操作のハンドラが無い。`draggable="false"`（`src/home/access/tiles.tsx`）は画像のドラッグ抑止で、ドラッグ操作の提供ではない。 | — | — |
| 3.2.1 | A | On Focus | not-applicable | フォーカスしただけで自動で開く UI を持たない。 | `src/**` に `onFocus` / `onFocusCapture` のハンドラが無い。 | — | — |
| 3.2.2 | A | On Input | not-applicable | 入力値の変更で画面が自動で切り替わる UI を持たない。 | `src/**` の `onChange` は制御された入力の状態更新だけで、ページ遷移・フォーカス移動・別の表示の生成を起こさない（`src/routes/admin.emoji-catalog.tsx`、`src/routes/admin.keys.tsx`、`src/admin/invitations/accept-view.tsx`）。 | — | — |
| 3.2.3 | AA | Consistent Navigation | applicable-unverified | ページを越えたナビゲーションがある。公開ナビは全画面で共通の 1 つのコンポーネント（`src/editorial/nav/PublicNav.tsx`）だが、公開ナビを表示しない画面もある（`/`・`/tools`・`/tools/<slug>`）。順序が全画面で一致するかは未判定。 | 公開ナビを表示する全画面でリンクの相対順序を記録し、一致するかを確認する。 | owner | 公開ナビを表示する画面（`/about`・`/contact`・`/portfolio`・`/portfolio/my-web-2026`・`/design-system`・`/keyboard`・`/projects/dotfiles`）を開く。<br>各画面の `<nav>` 内のリンク順序を左から右へ記録する。<br>記録した順序が全画面で一致するかを確認する。<br>公開ナビを表示しない画面（`/`・`/tools`・`/tools/<slug>`）が他の画面と同じ順序の経路を提供しているかを確認する。<br>順序が異なる画面があれば、その画面と該当箇所を記録する。 |
| 3.2.4 | AA | Consistent Identification | applicable-unverified | 同じ機能の名称がページを越えて揃っているかを確認する必要がある。公開ナビのラベルとパンくずのラベルは複数の画面で使われる（`src/editorial/nav/route-labels.ts`）。揃っているかは未判定。 | 同じ機能に付けられる名称（例: 「お問い合わせ / Contact」「Portfolio」）を画面間で突き合わせ、揃っていない機能を洗い出す。 | owner | 公開ナビを表示する全画面を開く。<br>同じ機能（ナビ項目・パンくず・ページの主題）が画面を越えて同じ名称で示されているかを比較する。<br>名称が異なる機能があれば、その機能名と画面を記録する。 |
| 3.2.6 | A | Consistent Help | applicable-unverified | 助け（問い合わせ）の入口がある。`/contact` への入口がホームの Contact 節と公開ナビにあり、その位置が画面によって異なる可能性がある。相対順序が揃っているかは未判定。 | 各公開画面に助けの入口があるか、ある場合その位置（何番目のリンクか・何の直後か）を記録して比較する。 | owner | 公開画面（`/`・`/about`・`/contact`・`/portfolio`・`/tools`・`/design-system`・`/keyboard`・`/projects/dotfiles`）を開き、助けの入口（`/contact` へのリンク）があるかを記録する。<br>入口がある画面について、その位置（何番目のリンクか・何の直後か）を記録する。<br>位置が画面間で揃っているかを確認する。<br>揃っていない画面があれば、その画面と位置を記録する。 |
| 3.3.3 | AA | Error Suggestion | applicable-unverified | 入力の拒否メッセージを持つフォームがある。`/admin/invitations_/accept` は `FAILURE_COPY`（`src/admin/invitations/accept-view.tsx`）で修正の提案を含む文言を持つが、`/admin/login` は Better Auth の 401 を受けて独自のパスワードエラーを描かない。すべての拒否に提案が揃っているかは未判定。 | 各拒否状態のメッセージが修正の提案を含むかを確認し、提案が欠けている拒否を洗い出す。 | owner | `/admin/invitations_/accept` を開き、無効なトークン・期限切れ・使用済み・メールアドレス重複・パスワード不足の各状態を再現する（`FAILURE_COPY` の各文言）。<br>各メッセージが修正の提案を含むか（例: 「管理者から再発行を受けてください」「8 文字以上」）を記録する。<br>`/admin/login` で誤ったパスワードを投入し、画面のフィードバックを記録する（`src/routes/admin.login.tsx` は Better Auth の 401 を受けて独自のエラーを描かない）。<br>提案が欠けている拒否があれば、判定と該当文言を記録する。 |
| 3.3.4 | AA | Error Prevention (Legal, Financial, Data) | applicable-unverified | データを送信する入力がある。管理画面の招待作成・API キー発行・画像登録はデータを変更するが、送信前の確認・送信後の取り消し・入力値の確認のいずれかが SC 3.3.4 の例外に当たるかは未判定。 | 各送信が SC 3.3.4 の対象（法的・財務・利用者制御可能データ）に当たるかを確認し、3 つの例外のいずれかで満たされるかを判断する。 | owner | 管理画面のデータ送信面（`/admin/invitations` の招待作成、`/admin/keys` の API キー発行、`/admin/images` の画像登録）を開く。<br>各送信が SC 3.3.4 の対象に当たるか（法的・財務・利用者制御可能データの変更か）を判断する。<br>変更前の確認・変更後の取り消し（招待の revoke、キーと画像の削除）が用意されているかを画面上で確認する。<br>3 つの例外のいずれかで満たされるかを判断し、判定と根拠を記録する。 |
| 3.3.8 | AA | Accessible Authentication (Minimum) | applicable-unverified | 認証の画面を公開している。`/admin/login` はメールアドレスとパスワードの認証で、記憶テストや謎解きは無いが、貼り付け可否とパスワードマネージャ対応は未判定。 | 貼り付け可否・パスワードマネージャの挿入可否・認知機能テストの有無を人が確認する。 | owner | `/admin/login` を開く。<br>パスワード欄とメールアドレス欄をそれぞれクリックして貼り付け（Cmd / Ctrl + V）し、貼り付けが拒否されないことを確認する。<br>パスワードマネージャが値を挿入できるかを確認する（`autoComplete="username"` / `current-password`）。<br>記憶テスト・謎解きのような認知機能テストが要求されていないことを確認する。<br>3 点が満たされているかを判断し、判定と根拠を記録する。 |

#### この 25 基準の集計（2026-11-01 時点）

| 区分 | 件数 | 中身 |
| --- | --- | --- |
| `not-applicable` | **13** | いずれも **出荷している制品についての事実** を理由に持つ（事前録音メディアが無い / 単一文字ショートカットが無い / 公開画面に時間制限が無い / 点滅が無い / パス操作が無い / ドラッグが無い / 端末を振る操作が無い / フォーカスで開く UI が無い / 入力値で画面が切り替わらない …） |
| `applicable-unverified` | **12** | いずれも **検査者と手順** を持ち、**まだ誰も見ていない** |
| `applicable-and-verified` | **0** | 人間の実測記録が 1 件も無い（owner の作業待ち） |

#### Issue #722 で変わったところ

**「表に項目が無い」を理由にしていた基準は、すべて `applicable-unverified` に変わった。**
Issue #722 が名指しした 6 基準（2.4.4 / 2.4.5 / 3.2.3 / 3.2.4 / 3.2.6 / 3.3.3）に加え、
同じ種類の理由を持っていた 2.5.3 と 3.3.8 も `applicable-unverified` になった。

さらに、**リポジトリと矛盾していた理由が 3 件** 見つかった（前 reasons は
「製品についての事実」を名乗っていたが、実装が別のことをしていた）。

| SC | 前の理由 | 何が矛盾していたか | 今の区分 |
| --- | --- | --- | --- |
| 1.3.3 | 「感覚的な特徴だけに頼って指示する表現を使っていない」 | ホームのリアクション欄の空表示が「下のボタンから送ってみましょう」と **位置で指示している**（`src/home/reactions/widget.tsx`）。位置 **だけ** に依存しているかは人が判定する | `applicable-unverified` |
| 1.4.5 | 「画像の中に文字を埋め込む表現を使っていない」 | ホームのアクセスカウンタは数字を **WebP のビットマップ** で描画している（`src/home/digits/*.webp`）— 文字を画像で描画している。テキスト描画に置き換えられるかは人が判定する | `applicable-unverified` |
| 2.2.1 | 「時間の制限のある操作を用意していない」 | 管理画面の API キー発行には **5 分の step-up 確認窓** がある（`STEP_UP_MAX_AGE_SECONDS` = 300）。公開画面には無いが、管理画面を適合の主張の範囲に含めるかどうかの判断がまだ無い | `applicable-unverified` |

2.5.3 には **既知の違反** が残っている。`/` の capability リンクは
可視テキストが「Portfolio を開く」で `aria-label` は「ポートフォリオ を開く」、
`/portfolio` の facet ボタンも可視テキストと `aria-label` が食い違う
（`e2e/a11y/axe-baseline.json` の `label-content-name-mismatch`、**Issue #718 が追跡中**）。
この **既知の違反** は Issue #718 の追跡対象であり、この gate は **閉じない**。

#### この表の「対象範囲」の読み方

- この表が対象とするのは **canonical origin が返す公開画面** と **story**、
  および **認証なしで到達できる管理画面の入口**（`/admin/login`、`/admin/invitations_/accept`）。
- **認証済み管理画面の内部**（`/admin/*`）は、この表の公開スコープの **外側** にある。
  2.2.1 と 3.3.4 の review plan は、この **スコープ判断そのもの** を owner に託している。
- どちらの扱いにするかは **owner の決定** であり、agent が勝手に決めない。

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

## リリース評価（台帳の構造と、監査された品質は別のもの）

gate の出力は **2 つを分けて** 報告する。**混ぜない。**

| 評価 | 2026-11-01 時点の値 | 何を意味するか |
| --- | --- | --- |
| **台帳の構造** | **green** | すべての基準に **意味のある区分** がある / 適用範囲の決定が文書と一致する / fixture が期待どおりに振る舞う |
| **監査された品質** | **not passed** | 手動項目は **22 件が未実施**、人が確認した項目は **0 件**、表の外側の基準は **12 件が適用だが未検証** |

**「台帳が green」は「このサイトが WCAG 2.2 AA に適合している」ことを意味しない。**
`auto-pass` の 5 項目は **npm の gate が判定した** 記録であって、
**人が確認した** 記録ではない。
**gate は、ブラウザやスクリーンリーダーの挙動について，人的確認の代用には
ならない**（画面上の読み順・キーボード経路・文脈の中のリンクの読みやすさは、
機械の gate では判定できない）。

### 何を証拠として «closed» にするか

| 対象 | 閉じる条件 | 閉じないもの |
| --- | --- | --- |
| **台帳の構造** | すべての基準に区分があり、適用範囲の決定が gate の定数と文書で一致し、fixture が期待どおりに振る舞う | — |
| **表の 1 項目** | 人が review を行い `review.state` を `human-verified`（または `human-failed`）に書き、`reviewer`・`performedAt`・`environment`・`result` の **4 つ** を **すべて** 書く。証跡が review 窓（365 日）を越えると `item-evidence-stale` で red になる | `auto-pass`（機械の pass）、日付だけを書き換える |
| **表の外の 1 基準**（`not-applicable`） | **出荷している制品についての事実**（証跡）があること | 「この表に項目が無い」「担当者が居ない」 |
| **表の外の 1 基準**（`applicable-unverified`） | 手順どおりに **人が** 確認し、その結果を記録すること。記録が無い限り `applicable-unverified` のまま | gate の green |
| **表の外の 1 基準**（`applicable-and-verified`） | **人間の実測記録**（`verifiedBy` と `verifiedAt`）があること | 記録が無いまま書いていただけの記述 |
| **AA 準拠の主張** | **手動項目が 1 件残らず `human-verified`** で、その行が **この表を正確に指している** ときだけ | `auto-pass` だけの台帳 |

**未実施の項目は「未実施」のまま報告する。** 「不合格」とも「合格」とも書かない。
**Issue #718 が追跡している既知の axe 違反**（`e2e/a11y/axe-baseline.json` と
`e2e/a11y/axe-storybook-baseline.json`）は **別の、未解決の品質項目** であり、
この gate はそれを **閉じても許さない**（ excuse もしない）。
台帳に `releaseAssessment.aaAuditComplete: true` と書いた場合は
`release-assessment-unbacked` で red になる。

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
| `scope-decision-doc-mismatch` | 適用範囲の決定（表の外側にある基準）が gate の定数と文書で食い違っている（SC 番号・レベル・名前・**区分**・理由・証跡・検査者・手順の **どれか 1 つ** でも違う） |
| `scope-disposition-invalid` | 適用範囲の決定に区分が無い / 区分が 3 種類のどちらでもない / 区分が要求するフィールドが欠落 / 区分が禁じるフィールドを持つ |
| `scope-exclusion-not-a-product-fact` | `not-applicable` の理由や証跡が「**この表に項目が無い**」「担当者が居ない」という **「見ていない」宣言** で、**製品についての事実** になっていない（表の `excluded` にも同じ規則が効く） |
| `scope-unverified-missing-review-plan` | `applicable-unverified` に **検査者** か **再現手順** が無い |
| `scope-verified-without-review-record` | `applicable-and-verified` に **人間の実測記録** が無い（このリポジトリには 1 件も無い） |
| `release-assessment-unbacked` | 台帳のリリース評価が「AA 監査は完了」と書いているのに、記録がそうでない（未実施項目がある / 人が 1 つも確認していない / 適用だが未検証の基準がある） |
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
| `fail/13-release-assessment-unbacked.json` | `release-assessment-unbacked`（台帳が「AA 監査は完了」と書いているのに記録がそうでない） |

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

### 適用範囲の決定の fixture（Issue #722）

表の **外側** にある 25 基準の判定は `quality/wcag-review-matrix.json` に無い
（事実源は gate の定数 `SCOPE_DECISIONS`）。だから **判定そのものを fixture で
固定する**。この fixture 集合も完全一致で管理する。

| fixture | 期待 |
| --- | --- |
| `scope/pass/01-product-fact-exclusion.json` | 違反 0 件（製品についての事実で閉じる `not-applicable` は受理する） |
| `scope/fail/01-table-coverage-exclusion.json` | `scope-exclusion-not-a-product-fact`（「…をこの表に持たない」「検査項目が無い」） |
| `scope/fail/02-unverified-without-steps.json` | `scope-unverified-missing-review-plan`（`applicable-unverified` に手順が無い） |
| `scope/fail/03-verified-without-review-record.json` | `scope-verified-without-review-record`（`applicable-and-verified` に人間の実測記録が無い） |

**負の対照は gate 自身でも実行できる。** `--scope-decisions=<path>` で
判定ファイルを差し込むと、そのファイルに対して同じ rule が働く。

```bash
node scripts/check-a11y-wcag-review-matrix.mjs \
  --scope-decisions=scripts/fixtures/a11y-wcag-review-matrix/scope/fail/01-table-coverage-exclusion.json
echo "exit=$?"   # 1
```

この option は **判定だけ** を差し替える（文書の表は常に **出荷している
判定** と照合する）。

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
| 適用範囲の決定（表の外側にある基準）がずれた | gate の定数 `SCOPE_DECISIONS` とこの文書の表を **どちらかに合わせて** 揃える。番号・レベル・名前・**区分**・理由・証跡・検査者・手順の 1 つでも違えば `scope-decision-doc-mismatch` で red になる |
| 適用範囲の決定の理由が「この表に項目が無い」になっている | **製品についての事実** に書き換える — その基準が **当たらなくなった** 事情を **出荷している制品** について述べる（例: 「事前録音の音声・動画を出荷していない」）。**表の項目が足りないことでは閉じない。** 書き換えられないなら `applicable-unverified` にして **検査者と手順** を書く（`scope-exclusion-not-a-product-fact`） |
| `applicable-unverified` に手順が無い | **人が再現できる手順**（どの画面を開き、何を見て、どう判定するか）を `steps` に書く。検査者が分からないなら `reviewer` に役割を書く（`scope-unverified-missing-review-plan`） |
| `applicable-and-verified` を書きたい | **書けない。** 人間の実測記録（`verifiedBy` と `verifiedAt`）が無い。owner が実測して記録に残すまで `applicable-unverified` のままにする（`scope-verified-without-review-record`） |
| 台帳が「AA 監査は完了」と書いているのに、記録がそうなっていない | `releaseAssessment.aaAuditComplete` を `false` に戻す。未実施の項目がある / 人が 1 つも確認していない / 適用だが未検証の基準がある のどれか 1 つでも該当する間は `true` は書けない（`release-assessment-unbacked`） |
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
# 適用範囲の決定を差し替えて、判定の rule を負の対照として実行する
node scripts/check-a11y-wcag-review-matrix.mjs \
  --scope-decisions=scripts/fixtures/a11y-wcag-review-matrix/scope/fail/01-table-coverage-exclusion.json
echo "exit=$?"   # 1 (scope-exclusion-not-a-product-fact)
# 表が読めないとき（存在しないパス）は判断できないので終了コード 2
node scripts/check-a11y-wcag-review-matrix.mjs --matrix=quality/does-not-exist.json; echo "exit=$?"
```

## 既知の制約

- **`human-verified` は 0 件。** 22 項目すべてが `not-reviewed` である。
  実際の検査（キーボード操作、拡大、スクリーンリーダー）是 **人が** やるもので、
  gate はその **記録** を管理する。**gate は代理で検査しない。**
- **`not-reviewed` は「不合格」ではない。** 「まだ見ていない」を
  「失敗した」とは書かない。gate の出力は `outstanding` として数える。
- **表の外側の 25 基準のうち 12 基準は `applicable-unverified`（未検証）。**
  `not-applicable` 13 件は **製品についての事実** で閉じているが、
  `applicable-unverified` の 12 件は **まだ誰も見ていない**。
  **gate が緑であることは、この 12 件が閉じていることを意味しない。**
- **`applicable-and-verified` は 0 件。** owner の実測記録が 1 件も無いので、
  この状態を書き込むことは許されない（`scope-verified-without-review-record`）。
- **Issue #718 が追跡している既知の axe 違反は別の項目。** 例えば
  `label-content-name-mismatch`（`/` の capability リンクと `/portfolio` の
  facet ボタン）は **SC 2.5.3 の既知の違反** として記録されている。
  この gate は **それを閉じない**。台帳の構造と、監査された品質は別のものです。
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
