# portfolio ケーススタディ要素の実描画証跡 (Issue #519)

対象は `src/portfolio/components/PortfolioCaseStudy.tsx` — 作品 1 件の
目的 / 選択肢 / 決定 / 検証結果を、**確定事実・当時の推測・現在の評価**の
3 区分に分けて表示する要素。汎用の振り返り文ではなく、各記述がどの
確度の主張かを読者が区別できることが要件。

## 1. 何を撮ったか

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/portfolio/components/PortfolioCaseStudy.stories.tsx` の `Default` story（story 自身の `render()` 出力） |
| fixture | `src/portfolio/fixtures/case-study.ts` — `my-web-2026` 自身。repository が公開済みの作品で、未公開素材は使っていない |
| capture 手段 | `node scripts/capture-portfolio-case-study.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → PNG） |
| viewport / DPR | 1440 x 900 / 1、`fullPage`（成果物 1440 x 1181 px） |
| 成果物 | `docs/verification/portfolio/decision-case-study.png`（252,679 bytes） |
| 出力形式 | Issue が `decision-case-study.png` を名指しするため PNG。WebP budget の対象外 |
| 再現性 | harness build は決定的。ブラウザ撮影は byte 再現ではない |
| 本番非破壊 | 外部通信なし。loopback 配信のみ。deploy / binding / secret の読み出しは無い |

`build-storybook` がこの repository では manager-only の静的ビルドに
なるため（`scripts/capture-error-state-gallery.mjs` 参照）、capture は
story module を直接 import する harness で行う。撮影されるのは
Storybook surface と同一の `render()` 出力であり、乖離しない。

## 2. 画面が示しているもの

- 作品タイトル・期間・要約の header。
- 凡例 `読み方 / How to read` — 3 つの claim class の定義
  （確定事実 / 当時の推測 / 現在の評価 と各々の説明）。
- 4 つの section — `目的 / Goal`、`選択肢 / Options`、`決定 / Decision`、
  `検証結果 / Verification`。各 entry は class の mark（実円 /
  三角 / リングの 3 種のシルエット）と日英の class 語を併記するため、
  色に依存せず区別できる（direction B の monochrome 規則、
  Issue #764 / #887 / #411 と同じ「形 + 語」の契約）。
- `検証結果` には `当時の推測`（migration 完了目標 2026-10 は計画上の
  推定）と `現在の評価`（移行は継続中、評価は公開時点のもの）を含み、
  完了していないことを隠していない。

## 3. 機械で検証した項目

capture script は撮影に先立ち、描画された DOM を読み戻して以下を
assert する。1 つでも欠ければ非 zero で終了する
（`evaluateObservation`、`scripts/capture-portfolio-case-study.test.mjs`
が pure 部分を単体テストする）。

| 項目 | 判定 |
| --- | --- |
| 凡例 | `読み方 / How to read` が描画されている |
| section 集合と順序 | `目的` → `選択肢` → `決定` → `検証結果` の 4 heading がこの順で存在 |
| claim class | 全 entry が `data-claim-class` を持ち、値は `confirmed` / `period-estimate` / `current-evaluation` のいずれか |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10） |

## 4. 典拠（content provenance）

fixture の各文の根拠:

- `確定事実` — `src/portfolio/seed.ts` の `motivationMd` /
  `architectureMd` / `evidenceMd`、`docs/personal/domain.md` §8/§9、
  shipped の 0.1.0 release 記録（2026-09-11）。いずれも公開済みの
  記述の再掲であり、新しい事実を作っていない。
- `当時の推測` — 開始時の棚卸し未完了・完了目標 2026-10 は計画値で
  あり実績ではない、という「当時の状態」の記述。fixture 執筆時点の
  認識として明示的に class を分けている。
- `現在の評価` — 移行継続中・評価は公開時点のもの、という
  執筆時点の評価。時間で減衰する主張なので class を分離した。

採用 / 保留の判断: 本 Issue は要素と fixture・Storybook・証跡の
実装まで。D1 schema への case-study フィールド追加と実 project への
適用は、公開 copy の owner 承認と schema 変更を伴うため本 PR の
範囲外（acceptance の「単独 fixture / Storybook / 文書 preview で
完成する 1 Issue / 1 PR」に従う）。実 project への展開は別 Issue
で判断する。

## 5. 再現手順

```bash
node scripts/capture-portfolio-case-study.mjs
# → docs/verification/portfolio/decision-case-study.png
# → .tmp/portfolio-case-study/report.json（観測値と判定）
```

option は `--out=` / `--json-out=` / `--no-build` / `--no-capture`。

## 6. 機械で検証していない項目（人手での判断）

- fixture の日本語の文言が読みやすいか・事実と推測の線引きが
  妥当か（mechanically には「3 class が描画され区別できる」こと
  しか確認していない）。
- 採用 / 保留の判断が妥当か（owner 判断）。
