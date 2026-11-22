# L-C 実画面レビュー記録（Issue #1135 / #1136 / #1163 / #1167 / #1172 / #1173 / #1174）

> `docs/runbook/ui-visual-review.md`（L-C）と `docs/adr/ADR-0023`（L-B）の
> 間に位置する、**実際の画面画像に基づく評価の記録**。
> 機械判定（composition lint）が PASS する画面にも視覚的欠陥は残る —
> この記録はその差を証拠として残す場所である。

## 0. 結論

| 対象 | 実施 | 結果 |
| --- | --- | --- |
| HOME `/` | desktop 1440×900 / mobile 390×844 × light / dark | 重大 4 件・軽微 2 件・注記 3 件 → **重大 4 件を改修**（#1135） |
| `/portfolio` | 同上 | 重大 2 件 → **2 件を改修**（#1136） |
| `/activity` | 同上 | 重大 2 件（entry の空域・時系列の単調）→ **改修**（#1172 / #1174） |
| `/about` `/tools` `/stack` `/now` `/links` `/contact` `/keyboard` | 同上 | 系統的な entry の空域（F-12）と平坦な面（F-13）→ **改修**（#1172 / #1173） |
| モバイル companion | 390×844 | 契約と実装の不一致（F-7）→ **根本修正**（#1163） |

- 実画面画像は `docs/verification/design/1135-lc-review/` に昇格した（**前後比較 12 組**）。
- 機械判定と実画面の差（CL-12 / CL-13 の新設、collector の穴 3 件、CL-5 の viewport 誤り）は
  Issue #1168 / #1175 で接続済み。
- 残存課題と未検証事項は §6 に列挙する。**このレビューは「サイト全体が
  一般的なデザイン基礎を満たす水準にある」ことの証明ではない** —
  証明できるのは §4 の改修と、その再発防止の検査だけである。

## 1. 対象・条件

| 条件 | 値 |
| --- | --- |
| viewport | desktop `1440×900` / mobile `390×844` |
| appearance | `colorScheme: light` / `dark`（Panda の `dark` condition は `prefers-color-scheme`） |
| motion | `reducedMotion: 'reduce'` |
| 解析同意 | `localStorage['my-web-2026:analytics-consent'] = 'denied'`（同意パネルが画面を覆わない状態） |
| 読み込み | キャプチャ前に文書を全スクロール（lazy media を実際に読ませる） |
| 出力 | full-page PNG（`deviceScaleFactor: 1`）を 1150px 幅のタイルに分割して評価 |

## 2. 手順（再現可能）

```bash
pnpm run dev                 # 別 terminal で開発サーバ
node scripts/capture-design-matrix.mjs http://127.0.0.1:3000 --routes=/,/about,/portfolio
node scripts/collect-composition.mjs --base-url=http://127.0.0.1:3000
node scripts/composition-lint.mjs
```

判定は `design-skills` の `composition-review` Skill（原則カード）に従い、
各所見を「観察 → 期待する関係 → 影響 → 確度 → 検出方法」の形で記録した。
コードや DOM だけで結論を出さず、**必ず画像を先に見た**。

## 3. 検出（所見）

### 3.1 HOME `/`（#1135）

**F-1 — hero の右半分が空域（重大）**

- 観察: hero の記述は measure の左半分に収まり、1440px viewport の右 45% は
  masthead から最初の section まで空白のまま。画面全体が「左揃えの縦積み」に見えた。
- 期待する関係: 12 track の非対称構図、または右列に目的ある内容。
- 対応: `Grid template="12"` の非対称 hero（記述 7 track / ページ自身の section index
  4 track・下端揃え）。index のラベルはページが既に公開している section 見出しの再掲。
- 影響: major ／ 確度: high ／ 検出: rendered + DOM geometry
- 証拠: `home-hero--{before,after}.webp`

**F-2 — アイデンティティ・マークが付箋状（軽微）**

- 観察: h1 の SiteMark は 94×64px の小ロゴで、主題（32px）に対し重力がない。
- 対応: 118px の display 級アンカーへ。
- 影響: minor ／ 確度: medium ／ 検出: rendered

**F-3 — 「現在地」が単調な羅列（重大）**

- 観察: 4 件の記録が同一形（名称 + 小さな label/value 表 + リンク）の縦積み。
- 対応: 2 列レコード（番号 / 名称・文 / 計測値 + 罫線）。
- 影響: major ／ 確度: high ／ 検出: rendered
- 証拠: `home-now--{before,after}.webp`

**F-4 — 状態セクションの 4 行折り返し（重大）**

- 観察: 「external HTTP boundary endpoints mounted」が 150px の列で 4 行に折り返され、
  表が壊れて見えた（6/6 分割の左列に状態行を置いていたため）。
- 対応: 状態行を全幅へ、訪問者 widget をその下へ。
- 影響: major ／ 確度: high ／ 検出: rendered + DOM geometry

**F-5 — カード見出しの矢印がタイトルから離れた（軽微）**

- 観察: 2 行の見出しで矢印がカード右端に浮いていた（flex item が折り返した
  テキストの横に残った）。
- 対応: リンクを inline 化（共有 primitive `cardTitleLinkClassName` へ統一）。
- 影響: minor ／ 確度: high ／ 検出: rendered

**F-6 — ページ末尾の空白帯（注記・未改修）**

- 観察: HOME 末尾に 176px の空帯（PetCompanion の固定オーバーレイの予約領域）。
- 判定: **契約どおりの意図**。`src/styles.css` の focus 補償チェーン
  （`--pet-overlay-offset` → `body { padding-bottom }`）が要求する領域で、
  解除すると WCAG 2.2 SC 2.4.11 の焦点非遮蔽が壊れる。残存課題として記録。

**F-7 — モバイルで companion が index rail に重なる（重大・契約と実装の不一致 → 根本修正）**

- 観察: 390px で index rail の先頭文字が固定ボタンに覆われた。
- 原因: 契約（`docs/domain/pet-companion.md` §5.4「ボタンなどを使わずに」）に無い
  **画面左下の固定「呼ぶ」ボタン**（Issue #1110 由来）が、**行の頭**に重なっていた。
  契約の休息位置は右下（行末側）。
- 対応（#1163）: 召喚ボタンを廃止し、companion は**全 viewport で自動表示**。
  契約に §5.3.1「狭い viewport — 通行帯を予約しない」を追加し、表的契約に
  「全 viewport で自動表示 / 狭い viewport は通行帯を予約しない」を明記。
- 検証: モバイル実測（390×844）— companion は x=306..366 / y=708..772（右下）、
  召喚ボタン 0 個、横スクロールなし。ブラウザテスト `e2e/pet-companion.spec.ts` が
  自動表示・ボタンなし・右下配置・行頭を覆わないことを固定。
- 影響: major ／ 確度: high ／ 検出: rendered + DOM geometry
- 証拠: `mobile-companion--{before,after}.webp`

### 3.2 `/portfolio`（#1136）

**F-8 — カードが空の器になる（重大）**

- 観察: media を持たない project の card が行高に引伸ばされ、表面積の 2/3 が空白。
- 対応: `equalRows` による行高の引き伸ばしを廃止し、カードは行の上端揃えへ。
  media を持たない project は 16:9 の placeholder frame を占有する。
- 影響: major ／ 確度: high ／ 検出: rendered + DOM geometry
- 証拠: `portfolio-cards--{before,after}.webp`

**F-9 — リアクション帯がページの左軸を外れる（重大）**

- 観察: リアクション帯が viewport 左端から始まり、ページの左 key line と不一致。
- 対応: 帯を `Container` へ。
- 影響: major ／ 確度: high ／ 検出: rendered + DOM geometry
- 証拠: `portfolio-top--{before,after}.webp`

**F-10 — 画像が読み込めない（軽微・環境起因）**

- 観察: 作品カバー 3 枚が broken 表示。原因は**この環境から R2 media に
  到達できない**こと（Issue #903 と同じ前提）。
- 判定: 機械判定 CL-13（新設）がこの状態を検出する。production では解決される。

### 3.3 主要ページの entry（F-12 → #1172）

**F-11 — 主要ページの entry の右半分が空域（重大・系統的）**

- 観察: `/about` `/tools` `/stack` `/activity` `/now` `/links` `/contact` `/keyboard` は
  entry が左のタイトルブロックだけで、1440px の右半分が空域。
- 判断: **HOME の非対称 hero を機械的にコピーしない**。構成（2 列・12 track・
  下端揃え）はデザインシステムが持ち（`src/editorial/primitives/PageHero.tsx`）、
  **右列の中身は各ページが持つ**。
- 対応: `/about` narrative index（7 section への index、リンク付き）、
  `/tools` カタログの inventory（available / in preparation の先頭 6 件 + 他 N 件）、
  `/stack` section index と項目数、`/activity` ソース観測状態、`/now` 集計サマリー、
  `/links` group index と件数、`/contact` channel 一覧（用途と最終確認日）、
  `/keyboard` ページ固有の 3 facts。
- 影響: major ／ 確度: high ／ 検出: rendered + DOM geometry
- 証拠: `{about,tools,stack,activity,now,links,contact,keyboard}-hero--{before,after}.webp`

### 3.4 平坦な面（F-13 → #1173）

**F-12 — 全 ground tone による平坦なページ（軽微）**

- 観察: `/about` `/portfolio/<slug>` `/keyboard` `/projects/dotfiles` は body section が
  全て同じ tone で、面の遷移がない（CL-8 warning）。
- 判断: **装飾としての色面は使わない**（契約 C-3: 装飾的な色面は欠陥）。
  モノクロの面ラダー（sunken / raised）だけで、各帯を**内容の分類**として使う。
- 対応: `/about` 思考・記録・今 = sunken / 締め = raised、`/portfolio/<slug>`
  links = supporting material → sunken、関連作品 = raised、`/keyboard` 同期状態 =
  sunken / source 一覧 = raised、`/projects/dotfiles` publication boundary =
  sunken / provenance = raised。
- **inverse を使わなかった理由**: 中立 Badge は inverse 面に ink pair を持たない
  （明ラベル／明ピルで 1.1:1）。可読性を優先して `raised` にした。
- 影響: minor ／ 確度: medium ／ 検出: rendered + composition lint

### 3.5 `/activity` の時系列（F-14 → #1174）

**F-13 — 時系列が小文字行の繰り返し（軽微）**

- 観察: 日付・種別・出典・題名がいずれも同じ大きさの 1 行連続。20 行読んでも
  「どの月に何があり、どの題名が重いか」が分からない。
- 対応: 3 段階に構造化 — **年**が group heading（件数 + rule）、**日付**が桁揃えの
  独立列、**題名**が主役（md / 600）、種別と出典は控えめな suffix。
  group はソートキー `at` の**年**で、著作者の期間ラベルは行自身が表示する。
- 影響: minor ／ 確度: high ／ 検出: rendered
- 証拠: `activity-timeline--{before,after}.webp`

### 3.6 その他の残件

**F-14 — 時系列の出典の重複（軽微・未改修）**

- 観察: `/now` の全 project が「GitHub 上で活動が観測された公開リポジトリ。」という
  同じ文を表示する。
- 判定: **データの重複**であり構図の欠陥ではない（記録は committed snapshot の
  値）。文言はデータの所有領域であり、構図の改修では直さない。

**F-15 — 広告ユニット（注記・対象外）**

- 観察: 広告の card 形状と CTA の位置は広告契約（Issue #925）の解剖に従う。
- 判定: 対象外。広告の件数・配置は変更していない。

## 4. 改修と前後比較

| # | 対象 | 改修 | 前 | 後 |
| --- | --- | --- | --- | --- |
| F-1 | HOME hero | 12 track の非対称 hero + section index 軸 | `home-hero--before.webp` | `home-hero--after.webp` |
| F-3 | HOME 現在地 | 2 列レコード（番号 / 名称 / 計測値 + 罫線） | `home-now--before.webp` | `home-now--after.webp` |
| F-7 | モバイル companion | 召喚ボタンを廃止し契約どおり自動表示 | `mobile-companion--before.webp` | `mobile-companion--after.webp` |
| F-8 / F-9 | `/portfolio` | card の stretch 解除 + media placeholder frame + リアクション帯の Container 化 | `portfolio-cards--before.webp` | `portfolio-cards--after.webp` |
| F-9 | `/portfolio` | リアクション帯を Container へ | `portfolio-top--before.webp` | `portfolio-top--after.webp` |
| F-11 | 各ページ entry | PageHero primitive + ページごとの aside | `{page}-hero--before.webp` | `{page}-hero--after.webp` |
| F-12 | 各ページ | 面のリズム（sunken / raised） | 上記 hero 画像と同じ頁 | 同左 |
| F-13 | `/activity` | 年・日付・題名の 3 段階 | `activity-timeline--before.webp` | `activity-timeline--after.webp` |

## 5. 機械判定との接続

実画面で見つかった欠陥のうち、機械検証できるものをルールに落とした。

| 欠陥 | ルール | 判定 | fixture / 対応 |
| --- | --- | --- | --- |
| card-shaped void（F-8） | **CL-12**（新設） | warning — 反復単位の下端が 120px 以上空く | `negative/empty-cards` / `positive/filled-cards` |
| 読み込み失敗した画像（F-10） | **CL-13**（新設） | warning | `negative/broken-media` / `positive/loaded-media` |
| 本文と定義リストを数えていない | collector 修正（#1175） | 密度・下端・本文サイズが実測に基づく | 実測: 「現在地」の下端 156px → **22px** |
| CL-5 が mobile を裁んでいた | CL-5 の viewport 固定（#1175） | desktop 構成だけを判定 | — |
| hero 欠落の fail-open | CL-6 修正 | blocking | `negative/text-only-portfolio` |
| 面積だけでは media 対応を判定できない | CL-6 修正 | blocking — ラスター画像必须 | `positive/media-led-detail` |
| block 種別列を構成証拠と誤認 | CL-7 修正 | 視覚順の変化を証拠にする | `negative/mobile-kind-shift` / `positive/mobile-reading-order` |
| prose 免除がルート全体 | CL-11 修正 | 免除は名前指定の section 単位 | `scripts/judge-composition.test.mjs` |
| PageHero の h1 が gate に見えない | heading-landmarks gate に PageHero を登録（#1183） | `<PageHero …>` を level-1 heading として数える | `scripts/check-a11y-heading-landmarks.mjs` |
| `/now` に h1 が無い | route に PageHero を追加（#1185） | entry の題名と規模の一文を hero が担う | `src/routes/now.tsx` |

**CL-12 の指標は「比率」ではなく「絶対の空き（px）」**。比率（0.42 vs 0.21）では
「空の card」と「まばらな一覧行」を分離できない。閾値 120px は実測で決めた
（`/portfolio` の card grid は stretch 解消前 247px → 解消後 93px）。

## 6. 残存課題と未検証事項

**残存（未改修）**

1. F-6: ページ末尾の 176px 予約帯（companion の focus 補償）。accessibility 契約が
   要求する領域であり、解除すると WCAG 2.2 SC 2.4.11 を壊す。
2. F-14: `/now` の project ごとに同じ出典文（データの重複。構図の領域外）。
3. F-15: 広告 unit の解剖（広告契約の領域外）。
4. `/portfolio` の mobile は 36,000px 長い（index route としての密度設計は未実施）。
5. `/about` の hero は「人物像」と.identity の見出しが重複する（情報設計の判断が
   必要なため未着手）。

**未検証（今回対象外）**

- motion / keyboard / 実機（reduced-motion と keyboard は既存の a11y ゲートが担当）。
- production の R2 media 描画（CL-13 の warning は環境起因。production では
  画像が解決され、warning が消えることを確認する必要がある）。
- Storybook / design-system ページの全 variant。
- スクリーンショットは Chromium のみ（Firefox / WebKit は既存の compat ゲートが担当）。
- `/projects/dotfiles` の entry は全幅 flow のままで、右側の余白は残す（密度のある
  entry であり、この余白は意図的なものとして判断）。

## 7. 参照

- runbook: `docs/runbook/ui-visual-review.md`
- 原則対応表: `docs/visual/composition-principles.md`
- ADR: `docs/adr/ADR-0022-editorial-composition-contract.md` /
  `docs/adr/ADR-0023-composition-lint-rendered-contract.md`
- 機械判定: `quality/composition-contract.json` / `scripts/judge-composition.mjs`
- companion 契約: `docs/domain/pet-companion.md` §5.2 / §5.3.1 / §5.4
