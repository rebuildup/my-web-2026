# アイコンボタンのアクセシブル名称を検証する（Issue #396）

> 検証対象: `src/**/*.tsx` のすべての `<button>` 要素（element 単位の走査）と、
> gate 自身的 fixture `scripts/fixtures/a11y-icon-button-names/`。
> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 1.3.1 / SC 2.4.6 / SC 4.1.2**。

## 適用対象 / 対象外 / 基準

| 区分 | 対象 | 理由 |
| --- | --- | --- |
| **適用対象** | `src/**/*.tsx` の `<button>` の開始タグ（element 単位） | 出荷する面のボタン。支援技術には accessible name が要る |
| **適用対象** | 「アイコンのみ」の判定: 子の内側（入れ子を含む）に **可視のテキストが 1 文字もなく**、`<svg>` / `<img>` / `Icon` で終わる要素を含むボタン | テキストを持つボタンは名前が自明であり、本 gate の主題ではない |
| **対象外** | `*.test.tsx` | 単体テストがアサートする markup であり、出荷面ではない |
| **対象外** | `*.stories.tsx` | Storybook のプレビュー面であり、出荷面ではない |
| **対象外** | `**/fixtures/**` | fixture は規則を「わざと」再現するために存在し、正常例であるはずがない |
| **対象外** | `src/routes/design-system/**` | デザイナー向けの状態マトリクスであり、出荷面ではない |
| **対象外** | `<a>` / `<input>` / その他の role | 本 Issue の主題は「アイコンボタン」であり、要素種別をまたぐ判定は別の obligation の領域 |

対象外のファイルは **gate の出力に理由付きで列挙される**（`out of scope` 節）。
理由の説明できない除外は、信頼できない除外だと考える。

## アクセシブル名称の手段（いずれか 1 つで足りる）

1. `aria-label` が非空
2. `aria-labelledby` が非空で、参照先 id が **同じファイル内に存在する**
3. `title` が非空
4. **視覚的に隠されたテキスト**（`visually-hidden` / `visuallyHidden` / `sr-only` / `srOnly` クラス、または `data-visually-hidden` 属性）を持つ子要素

4 のテキストは「見えているテキスト」ではないため、ボタンは **画面にはアイコンしか
見せない** まま名前を持つ。4 の存在知能（手段の 1 つ）はこのために意味を持つ。

## 機械検査する規則

| rule | 意味 | WCAG |
| --- | --- | --- |
| `icon-button-missing-name` | アイコンのみで、名前を与える手段が無い | SC 4.1.2 (A) / SC 2.4.6 (AA) |
| `icon-button-empty-name` | `aria-label=""` / `title=""` など、名前が指定されているが空 | SC 4.1.2 (A) |
| `icon-button-name-target-missing` | `aria-labelledby` の参照先 id がファイル内に存在しない | SC 1.3.1 (A) / SC 4.1.2 (A) |
| `fixture-expectation-mismatch` | gate 自身の整合性規則。`pass/` fixture が違反し、または `fail/` fixture が違反しない | （gate 内部の規則） |

名前を与える手段が **1 つでもあれば** 違反にならない。空の `aria-label` は
「名前が見つからない」のではなく「名前が空」で、aria-label の存在は名称付与の
**証明にはならない**ため、別の rule として切り離している。

壊れた `aria-labelledby` は `icon-button-name-target-missing` だけで報告する
（`icon-button-missing-name` も出ると、原因が 2 つ出たように見えてしまう）。

## 機械検査と人間の評価の区別

本 Issue の要求どおり、**機械で決まること**と**人が評価すること**を混ぜない。

### 機械検査（`pnpm run a11y:icon-button-names:check` / `pnpm run capture:a11y-icon-button-names`）

| 検査 | 内容 | 判定方法 |
| --- | --- | --- |
| `icon-button-missing-name` | `src/**` に、名前的手段の無いアイコンボタンが 1 つも無い | コメント除去後のソース走査（`scripts/check-a11y-icon-button-names.mjs`） |
| `icon-button-empty-name` | `src/**` に、空の `aria-label` / `title` を持つアイコンボタンが 1 つも無い | 同上 |
| `icon-button-name-target-missing` | `src/**` に、参照先 id の無い `aria-labelledby` を持つアイコンボタンが 1 つも無い | 同上 |
| fixture の再現 | `pass/` fixture は 0 違反、`fail/` fixture は 1 違反以上 | 同上（gate が fixture を **実際に読んで** 検証する） |
| 名前が解決する | 名前を持つ側のボタンは、ブラウザが解決した名前が空でない | Chromium 実測（`aria-label` → `aria-labelledby` → `title` → テキスト の順で解決） |
| 名前が無いのも実在する | 名前が無い側のボタンは、ブラウザが解決した名前が空 | Chromium 実測（同じ画面・同じ Chromium） |
| アクセシビリティツリー | 名前を持つボタンは `button "Close"`、名前が無いボタンは `button` として現れる | Chromium `ariaSnapshot()` |

### 人間の評価（機械では判定しない）

- 名前がボタンの実際の挙動（何をするか）を正しく説明しているか
- 名前が sighted な読者が見るアイコンと一致しているか
- 実機でのスクリーンリーダー読み上げ（VoiceOver / NVDA で名前がどう宣言されるか）
- disabled のときに名前が意味のあるままか

この 4 項目は `scripts/check-a11y-icon-button-names.mjs` の出力でも
「not machine-checked」として明示され、検証画像内にも同じ文言が印字される。

## fixture の再現（Issue 完了条件 2）

`scripts/fixtures/a11y-icon-button-names/` に `pass/` 4 ファイル、`fail/` 4 ファイルを置き、
**gate がそのファイルを実際に読んで** 結果を assert する。

| fixture | 内容 | 期待される rule |
| --- | --- | --- |
| `pass/aria-label.tsx` | `aria-label="Close"` のアイコンボタン | 違反 0 |
| `pass/aria-labelledby.tsx` | 同ファイルに宣言された id を参照する `aria-labelledby` | 違反 0 |
| `pass/title.tsx` | 非空の `title` | 違反 0 |
| `pass/hidden-label.tsx` | `sr-only` のテキストで命名されたアイコンボタン | 違反 0 |
| `fail/missing-name.tsx` | 名前的手段が無いアイコンボタン | `icon-button-missing-name` |
| `fail/empty-aria-label.tsx` | `aria-label=""` | `icon-button-empty-name` |
| `fail/empty-title.tsx` | `title=""` | `icon-button-empty-name` |
| `fail/broken-labelledby.tsx` | 存在しない id を参照する `aria-labelledby` | `icon-button-name-target-missing` |

fixture が期待どおりに再現しなくな으면 `fixture-expectation-mismatch` で gate が落ちる。
「3 つしか検証していない」状態で gate が緑になることはない。

## 既存コードの結果

`src/**` を走査した結果、**アイコンボタンは 0 件**であり、名前を持たないアイコンボタンも 0 件。
既存の実装はすでに 4 つの手段のいずれか（主に `aria-label`）で命名されているため、
**public copy を 1 文字も追加せずに** 本 Issue の受け入れ条件を満たした。
新規に日本語文言を追加していないので、copy editorial approval gate の承認待ちも発生しない。

## スクリーンショット

`docs/verification/a11y/icon-button-names.webp`（Issue #396 が指定する
`icon-button-names.png` の WebP 版。PNG はリポジトリに置いていない）。

- 生成: `pnpm run capture:a11y-icon-button-names`
- 対象: 1280 px / deviceScaleFactor 2 の Chromium に、**リポジトリの fixture をそのまま**描画
- 左: 実表示（名前を持つアイコンボタン / 名前のないアイコンボタン を同じ画面に並べる）
- 右: 機械検査の結果（名前 해결の手段 / 解決した名前 / Chromium のアクセシビリティツリー）
- 上部: 検証レポート（WCAG 対応・機械検査項目・人間の評価項目）
- 失敗条件: 名前の解決結果・アイコンの有無・fixture の描画のいずれかが観測と矛盾した場合、
  **成果物を書かずに exit 1**（見栄えのよい画像だけが残ることを防ぐ）

harness は fixture ファイルを **直接 import** するため、fixture を書き換えると
検証画像も変わる（古い画像が残ることはない）。

## 検証コマンド

```bash
pnpm run a11y:icon-button-names:check   # 機械検査（gate）
pnpm run capture:a11y-icon-button-names # Chromium で実測して WebP を生成
node --test scripts/check-a11y-icon-button-names.test.mjs scripts/capture-a11y-icon-button-names.test.mjs
```

## 誤検知時の対応（機械検査が誤検知したら）

1. **その場で直せるもの**（属性の書き忘れ）: `src/**` の該当 `<button>` に、
   既存の隣接テキストへの `aria-labelledby`、既存文言の `aria-label`、
   あるいは `sr-only` のラベルを追加する。**新しい日本語文言は不要**であり、
   既存の文言を参照するのが既定の対処。
2. **文言の追加が必要なもの**: `src/routes/**` / `src/editorial/**` は public copy surface なので、
   日本語テキストを新規追加すると copy editorial approval gate が owner 承認待ちになる。
   その場合は **追加せずに** 本記録の「既知の制約」に owner 承認が必要な旨を書く。
3. **gate 自身が誤って検出した場合**: 判定が「名前無し」だと gate が通常の
   `[{"rule": "icon-button-missing-name", "file": "...", "line": 42}]` として出力される。
   その file:line を確認し、
   - テキストが動的な式で静的に読めないだけなら、**機械は判断できない**ので
     `aria-label` を足す（読める名前が無いので、動的なテキストは安心できない）。
   - `aria-labelledby` の参照先が別ファイルにあるだけなら、それは **前提が誤り**。
     gate は同ファイル内の参照しか解決できないので、参照先を同じファイルに置く
     （あるいは `aria-label` に換える）。
   - 判定の仕様そのものの変更が必要な場合だけ、`scripts/check-a11y-icon-button-names.mjs` の
     doc comment と本記録の双方を更新する。
4. **fixture 側の誤検知**: `pass/` fixture が違反したら、その fixture は
   「名前を持たないアイコンボタン」ではない（テキストか他の手段がある）。
   `fail/` fixture が違反しないなら、書き換えてしまった。
   どちらの場合も `fixture-expectation-mismatch` で gate 自身が落ちる。

## 既知の制約

- **ゲートは静的なソース走査である。** 名前を与える手段の存在と、
  参照の壊れは機械で決められるが、**名前が適切か（読んで意味が分かるか）** は
  人の評価に委ねている（上記「人間の評価」）。
- **動的な `aria-label` / `aria-labelledby` は「あり」とみなす。**
  `aria-label={cond ? 'A' : 'B'}` のような식은静的に読めないため、
  gate は「名前がありそう」とみなす（誤検知を避けるための保守的な判定）。
  逆に **動的に組み立てられる id** は同ファイルに現れないため、
  gate はその参照を壊れているとは判定しない。
- **`aria-hidden` なテキストは「テキスト」と数える。** 仕様どおり、
  JSX テキストノードと `{"…"}` 文字列リテラルは数える。`aria-hidden` な
  グリフだけを持つボタンは本 gate の「アイコンのみ」に該当しないため、
  検出されない（この場合は `aria-label` の有無で別に扱う）。
- **`src/routes/design-system/**` は対象外。** 状態マトリクスのため、
  本番面のボタンではない。対象外にした理由は gate の出力に毎回出る。
