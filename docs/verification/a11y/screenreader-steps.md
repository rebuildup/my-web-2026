# スクリーンリーダーの読み上げ手順と記録欄（Issue #402）

> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 1.3.1 Info and Relationships（A）** /
> **SC 2.4.6 Headings and Labels（AA）** /
> **SC 3.3.1 Error Identification（A）** /
> **SC 4.1.2 Name, Role, Value（A）**。
>
> 読み上げの「内容・順序・自然さ」は機械が決められない。本 Issue は
> **人が支援技術を使って確かめる手順を固定し、その記録の形を機械が守る**。

## この記録が守る 2 つの規則

1. **未実施は失敗でも合格でもない。** 読み上げの確認がまだなら、
   記録の「実測の announce / 実行者 / 日付 / 結果」は**空のまま**でよい。
   gate はその状態を `not-performed` として扱い、違反にしない。
   **空の記録で green になるが、「確認済み」とは書いていない**状態を保つ。
2. **自動の合格は人手確認ではない。** Issue #393 の axe 監査は
   「操作にアクセシブルな名前がある」ことは示すが、
   「その名前が人が聞ける順に読み上げられた」ことは示せない。
   自動監査の結果を人手確認の証拠として書くことは **違反** にする。

## 適用対象 / 対象外 / 基準

### 適用対象

| 対象 | 範囲 | 備考 |
| --- | --- | --- |
| Home（`/`） | `src/routes/index.tsx` | 主要見出し（`src/home/hero.tsx` の `<h1 id="hero-title">`）、スキップリンク、hero の主要リンク |
| About（`/about`） | `src/routes/about.tsx` | 人物の見出し（`src/about/components/AboutPage.tsx` の `<h1 id="about-hero-title">`）、末尾の見出し、パンくずリスト |
| フォーム | `src/editorial/forms/form-errors.stories.tsx`（`Gallery`） | 未入力・失敗・狭幅の各状態。**既存の公開手段（Storybook story）** で再現する |
| 支援技術 | `VoiceOver`（macOS / iOS）または `NVDA`（Windows） | 1 つずつで実行し、**どちらの記録でもよい** |

### 対象外（理由つき）

| 対象外 | 理由 |
| --- | --- |
| 支援技術を使わない操作（マウス操作そのもの、視覚的な装飾） | 本 Issue が対象にするのは**支援技術に伝えられる情報**だけである |
| 読み上げの「自然さ」「妙な間」「不自然な間」 | 機械では決められない。**人が評価する**（下記の「人が評価すること」を参照） |
| 実機のブラウザの補助機能と VoiceOver / NVDA の差 | 支援技術ごとに読み上げの文言は違う。手順は**片方の支援技術**で書き、比較は別の記録として扱う |
| 音声合成の音色・速度・言語の初期設定 | 支援技術のユーザー設定であり、本サイトが決めるものではない |
| 既存公開页面の見出し階層の**機械**判定 | Issue #398（`a11y:heading-landmarks:check`）が持つ。本 Issue は**読み上げ**に限定する |

### 基準

| 基準 | レベル | 該当箇所 | 判定 |
| --- | --- | --- | --- |
| SC 1.3.1 Info and Relationships | A | 見出し・リスト・フォームの構造 | 機械（要素名・role・アクセシブル名の存在）＋ 人（読み上げの内容と順序） |
| SC 2.4.6 Headings and Labels | AA | 見出しとラベル | 同上 |
| SC 3.3.1 Error Identification | A | 入力エラー | 同上 |
| SC 4.1.2 Name, Role, Value | A | 操作の名前・役割・状態 | 同上 |

## 手順書（誰が・どの支援技術で・どの画面で・何を期待するか）

1 つの手順 = 記録の 1 行。各行は次の 9 つの欄を持つ。

| 欄 | 誰が入れるか | 中身 |
| --- | --- | --- |
| `id` | 機械 | 手順の識別子（一意） |
| `subject` | 機械 | 見出し / 操作名 / 入力エラー のいずれか |
| `operation` | 機械 | **何を押すか**を、支援技術側の操作で書いた手順（例: 「Tab を 1 回押して…」） |
| `surface` | 機械 | 対象の surface（route / story）、状態、ファイルパス、再現のしかた |
| `assistiveTechnology` | 機械 | `VoiceOver` または `NVDA` |
| `environment` | 機械 | OS / ブラウザ / 支援技術の版 |
| `expectedAnnounce` | 機械 | **期待する announce**（「〇〇と読み上げられる」まで書いたもの） |
| `observedAnnounce` | **人** | 実際に聞いた内容（未実施なら空） |
| `performer` | **人** | 実施した人（未実施なら空） |
| `performedAt` | **人** | 実施日（未実施なら空） |
| `result` | **人** | `pass` / `fail` / `not-performed`（未実施なら `not-performed`） |
| `wcag` | 機械 | 対応する成功条件 |
| `notes` | 人 | 補足（**自動監査の合格を根拠として書かない**） |

### 実施手順（人）

1. 記録の行が持つ `environment` と同じ環境を用意する（同じ OS / ブラウザ / 支援技術の版）。
2. 支援技術を開始する（VoiceOver は `Cmd+F5`、NVDA は `NVDA+Space`）。
3. `operation` のとおりに操作する。
4. 聞いた内容を `observedAnnounce` に**そのまま**書く（言い換えない。省略もしない）。
5. `performer` と `performedAt` を書き、`result` を `pass` / `fail` にする。
6. `fail` にした場合は、何が読めなかったかを `notes` に書く。

### 未実施のままにする条件

- 対象の surface が公開されていない、または手順の前提が成立しない
- 支援技術の対象版が環境に無い
- 読み上げる順序が要件を満たさないと**判断できない**（判断は人）

この 3 つの場合は `result` を `not-performed` のままにし、`notes` に理由を書く。
**空欄を残したまま「確認済み」とは書かない**（gate はその状態を `not-performed` として扱う）。

## 記録欄（実記入する場所）

記録の実体は `quality/screenreader-steps.json`（gate が読む owner data）。
下の表は**その内容**を人間向けの形にしたもので、
`実測の announce` / `実行者` / `日付` の欄は**未実施なので空欄**である。

表の「手順 / 対象」欄は `surface.reproduce`（実際に触る要素）であり、
対象 surface 自身は `surface.path`（route ファイルまたは story ファイル）が
指す。gate が実在を確かめるのは `surface.path` と story の export である。

| id | 対象 | 手順 / surface | route / state | 支援技術 / 実行環境 | 期待する announce | 実測の announce | 実行者 | 日付 | 結果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `home-skip-link` | 操作名 | ページを開いた直後に Tab を 1 回押し、「本文へスキップ」リンクへフォーカスを移す。`src/home/composer.tsx` | `/` (normal) | VoiceOver / macOS 15 / Safari 18 | 「本文へスキップ、リンク」と読み上げられる。フォーカスが当たるとリンクが画面内に出る。 | 未記入 | 未記入 | 未記入 | `not-performed` |
| `home-h1` | 見出し | 「本文へスキップ」リンクを Enter で押し、そのまま Tab で最初の見出し（hero の h1）へ移す。`src/home/hero.tsx` | `/` (normal) | VoiceOver / macOS 15 / Safari 18 | 「my-web-2026、見出しレベル 1」と読み上げられる（h1 のテキストは視覚的に隠されている）。 | 未記入 | 未記入 | 未記入 | `not-performed` |
| `home-hero-about-link` | 操作名 | hero 見出しの下にある「About me / 自己紹介 →」リンクへフォーカスを移す。`src/home/hero.tsx` | `/` (normal) | VoiceOver / macOS 15 / Safari 18 | 「About me / 自己紹介 →、リンク」と読み上げられる。 | 未記入 | 未記入 | 未記入 | `not-performed` |
| `about-h1` | 見出し | /about を開き、最初の見出し（人物の氏名の h1）へフォーカスを移す。`src/about/components/AboutPage.tsx` | `/about` (normal) | VoiceOver / macOS 15 / Safari 18 | 人物の氏名と「見出しレベル 1」が読み上げられる。 | 未記入 | 未記入 | 未記入 | `not-performed` |
| `about-footer-heading` | 見出し | /about の末尾まで移動し、「他の場所で見つける / Elsewhere」の見出しへフォーカスを移す。`src/about/components/AboutPage.tsx` | `/about` (normal) | NVDA / Windows 11 / Firefox 133 | 「他の場所で見つける / Elsewhere、見出しレベル 2」と読み上げられる。 | 未記入 | 未記入 | 未記入 | `not-performed` |
| `about-breadcrumb` | 操作名 | /about のページ先頭のパンくずリスト（ホーム / 自己紹介）へフォーカスを移し、2 項目を順に読み上げる。`src/editorial/nav/Breadcrumbs.tsx` | `/about` (normal) | VoiceOver / macOS 15 / Safari 18 | 「ホーム、リンク」→「自己紹介、リンク」と順に読み上げられ、パンくずリストとしてまとまって読み上げられる。 | 未記入 | 未記入 | 未記入 | `not-performed` |
| `form-empty-submit` | 入力エラー | フォームの story（Gallery）を開き、必須項目を空のまま送信する。`src/editorial/forms/form-errors.stories.tsx` | story (empty) | NVDA / Windows 11 / Firefox 133 | 送信した項目ごとに「必須」の旨が読み上げられ、エラー summary が件数と項目名を示す。 | 未記入 | 未記入 | 未記入 | `not-performed` |
| `form-error-summary` | 入力エラー | フォームの story（Gallery）でエラー付きの入力を行い、エラー summary にフォーカスを移して各項目へ移動する。`src/editorial/forms/form-errors.stories.tsx` | story (error) | NVDA / Windows 11 / Firefox 133 | 「パスワードが短すぎます (8 文字以上)。」のように、項目名と拒否理由が 1 つのまとまりで読み上げられる。 | 未記入 | 未記入 | 未記入 | `not-performed` |
| `form-narrow-field` | 操作名 | フォームの story（Gallery）を 320 CSS px の幅で開き、入力欄にフォーカスを移す。`src/editorial/forms/form-errors.stories.tsx` | story (narrow) | VoiceOver / macOS 15 / Safari 18 | 入力欄のラベルと必須状態が省略されず、「テキスト入力、必須」のように読み上げられる。 | 未記入 | 未記入 | 未記入 | `not-performed` |

**この表は「確認済み」ではない。** 9 手順すべてが `not-performed` であり、
実測の欄は空である。gate が緑になるのは**記録の形が保たれている**からであり、
読み上げの確認ではない。

## 判定する rule

| rule | 意味 | 判定 |
| --- | --- | --- |
| `step-field-missing` | 手順・surface・支援技術・実行環境・期待する announce などの必須欄が空 | 違反 |
| `step-duplicate-id` | 2 つの手順が同じ id を持つ | 違反 |
| `step-subject-unknown` | 手順が宣言されていない対象（見出し / 操作名 / 入力エラー）を名指す | 違反 |
| `step-state-unknown` | 手順が宣言されていない状態（normal / empty / error / narrow）を名指す | 違反 |
| `step-wcag-unknown` | 手順が宣言されていない成功条件を名指す | 違反 |
| `step-assistive-technology-unknown` | 手順が宣言された支援技術（VoiceOver / NVDA）のどちらかを名指さない | 違反 |
| `step-result-invalid` | 結果が `not-performed` / `pass` / `fail` のいずれでもない | 違反 |
| `step-evidence-missing` | 実施済み（`pass` / `fail`）なのに実測の announce・実行者・日付のいずれかが無い | 違反 |
| `step-evidence-mismatch` | `not-performed` なのに実測の欄がある（またはその逆） | 違反 |
| `step-evidence-stale` | 実施日が review window（365 日）を超えている、未来、または日付でない | 違反 |
| `step-surface-missing` | 手順が指すファイルまたは story の export が存在しない | 違反 |
| `step-axe-substituted` | 自動監査の結果を人手確認の証拠として書いている | 違反 |
| `subject-uncovered` | 宣言した対象のどれかに手順が 1 件も無い | 違反 |
| `state-uncovered` | 宣言した状態のどれかに手順が 1 件も無い | 違反 |
| `criterion-uncovered` | 宣言した成功条件のどれかに手順が 1 件も無い | 違反 |
| `fixture-expectation-mismatch` | fixture が自分の期待どおりに動かない | 違反（fixture の陳腐化） |
| `fixture-contract-missing` | fixture が欠けている / 読めない / 目録に無い | 違反（目録の陳腐化） |

**`not-performed` は違反ではない。** 実測の欄が空のままでも、手順の欄が
揃っていれば gate は緑である。

## 機械で決まること / 人が評価すること

green な gate は適合の主張ではない。以下の区別は本 gate の中核である。

| 主張 | 判定方法 |
| --- | --- |
| 手順が「何を・どこで・どの支援技術・どの環境で・何を期待するか」を書いている | **機械** — `check-a11y-screenreader-steps.mjs` |
| その surface が今も存在している | **機械** — 同上 |
| 実測の欄と実行者・日付の整合（未実施なら空、実施済みなら揃っている） | **機械** — 同上 |
| 自動監査の合格を人手確認の証拠として使っていない | **機械** — 同上 |
| **読み上げが期待どおりだったか**（文言・順序・自然さ） | **人** — 支援技術での実測 |
| **聞き取れなかった情報があったか**（切れたラベル・消えた role・伝わらない状態変化） | **人** — 同上 |
| 手順が現在の surface をまだ有信心して記述できる | **人** — review window は下限であって証明ではない |

## 検証画像

`docs/verification/a11y/screenreader-steps.webp`（1600 × 1078 / 138 kB）。

画像は**記録の設計の見本**である。上部に gate の判定（機械検査の結果）、
その下に記録欄の表がある。

- **機械が埋める欄**（手順 / surface / 支援技術 / 実行環境 / 期待する announce）は
  テキストで印刷される。
- **人が記入する欄**（実測の announce / 実行者 / 日付 / 結果）は
  **空欄のまま**で、「未記入」と記されている。読み上げの実測結果に
  見せかける表現は**書いていない**。

### WebP, not PNG

Issue #402 は `docs/verification/a11y/screenreader-steps.png` を要求しているが、
**このリポジトリの規約は WebP のみ**である（capture script が `.webp` 以外を拒否する）。
よって `docs/verification/a11y/screenreader-steps.webp` を採用し、
**PNG ファイルは作っていない**。乖離は「ファイル名」と「拡張子」の 2 点で、
Issue の要求は「PR 本文に画像を埋める」ことなので満たしている
（#396 / #397 / #399 / #400 / #405 と同じ運用）。

## 再現手順

```sh
# 1. 機械 gate（pnpm run validate:fast にも含まれる）
pnpm run a11y:screenreader-steps:check

# 2. gate のテストと fixture 目録
node --test scripts/check-a11y-screenreader-steps.test.mjs

# 3. 記録欄の画像を書き出す
pnpm run capture:a11y-screenreader-steps
```

## 既存 gate との関係

- **Issue #393（axe 監査）** は**別のもの**である。axe は
  「操作にアクセシブルな名前がある」ことを示すが、「読み上げられた」ことは
  示さない。**axe の合格を人手確認の証拠として書くと `step-axe-substituted`
  になる**ので、2 つの記録は混ぜられない。
- **Issue #410（WCAG AA 手動検査表）** は A/AA 全体の**判定表**であり、
  本 Issue は**読み上げという 1 つの観点**の**手順と記録**である。
  同じ考え（自動合格 ≠ 人手確認）を共有するが、記録する対象は別である。
- **Issue #398（見出しとランドマーク）** が**機械**で見出し階層を、
  **Issue #399（コントラスト）** が**機械**で色を、本 Issue が**人**で
  読み上げを判定する。3 つの gate は別の rule として共存する。

## 残す判断

- 記録の**実施**は人が行う。本 PR は手順と記録欄の準備までで、
  **9 手順すべてが未実施**の状態で公開する。
- `expectedAnnounce` の文言は**期待**であり正解ではない。実施した人が
  読んだ文言と食い違うなら、期待の側を直す（それは記録の更新であり、
  gate の判定の緩めではない）。
