# L-C 実画面レビュー記録（Issue #1135 / #1136、Epic #1128）

> `docs/runbook/ui-visual-review.md`（L-C）と `docs/adr/ADR-0023`（L-B）の
> 間に位置する、**実際の画面画像に基づく評価の記録**。
> 機械判定（composition lint）が PASS する画面にも視覚的欠陥は残る —
> この記録はその差を証拠として残す場所である。

## 0. 結論

| 対象 | 実施 | 結果 |
| --- | --- | --- |
| HOME `/` | desktop 1440×900 / mobile 390×844 × light / dark | 重大 4 件・軽微 2 件・注記 2 件 → **重大 4 件を改修** |
| `/portfolio` | 同上 | 重大 2 件 → **2 件を改修** |
| `/about` `/tools` `/stack` `/activity` `/contact` `/now` `/links` `/keyboard` `/projects/dotfiles` | desktop / mobile × light / dark | 系統的な欠陥 1 件（hero の右半分空域）と各ページ固有の所見を**未解決として記録** |

- 実画面画像は `docs/verification/design/1135-lc-review/` に昇格した（前後比較 6 枚）。
- 機械判定と実画面の差（CL-12 / CL-13 の新設）は Issue #1149 で接続済み。
- 残存課題と未検証事項は §6 に列挙する。**このレビューは「サイト全体が
  一般的なデザイン基礎を満たす水準にある」ことの証明ではない** —
  証明できるのは §4 の改修と、その 再発防止の検査だけである。

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
node scripts/capture-design-matrix.mjs http://127.0.0.1:3000 --routes=/,/portfolio
node scripts/collect-composition.mjs --base-url=http://127.0.0.1:3000
node scripts/composition-lint.mjs
```

判定は `design-skills` の `composition-review` Skill（原則カード）に従い、
各所見を「観察 → 期待する関係 → 影響 → 確度 → 検出方法」の形で記録した。
コードや DOM だけで結論を出さず、**必ず画像を先に見た**。

## 3. 検出（所見）

### 3.1 HOME `/`

**F-1 — hero の右半分が空域（重大）**

- 観察: hero の記述は-container 幅の左半分（640px 程度）に収まり、
  1440px viewport の右 45% は masthead から最初の section まで空白のまま。
  画面全体を「左揃えの縦積み」に見せる主要因。
- 期待する関係: ページ talentoは 12 track の非対称構成（ADR-0023 §3）か、
  右列に目的ある内容（索引・状態・メディア）を持つ。
- 影響: major ／ 確度: high ／ 検出: rendered + DOM geometry
- 対応: `src/home/hero.tsx` — `Grid template="12"` とし、記述を 7 track、
  ページ自身の section index を 4 track（`start=9`）に置いて**下端揃え**に
  した。index のラベルはページが既に公開している section 見出しの再掲で、
  新しい日本語文言は追加していない。

**F-2 — アイデンティティ・マークが付箋状（軽微）**

- 観察: h1 の SiteMark は 94×64px の小Spoilerで、主語Statement（32px）の
  脇に付いただけ。サイト名の見える wordmark は masthead のみ。
- 期待する関係: 入口の主役は 1 つに絞る（CL-9 相当）。
- 影響: minor ／ 確度: medium ／ 検出: rendered

**F-3 — 「現在地」が単調な羅列（重大）**

- 観察: 4 件の記録が同一形（名称 + 小さな label/value 表 + リンク）の縦積みで、
  走査できない。行間の密度も同一。
- 期待する関係: 反復単位は「1 件 = 1 レコード」として読める形（番号・名称・
  計測値が同じ軸に載る）。
- 影響: major ／ 確度: high ／ 検出: rendered

**F-4 — 状態セクションの 4 行折り返し（重大）**

- 観察: 「external HTTP boundary endpoints mounted」が 150px 幅の列で
  4 行に折り返され、表が壊れて見えた（6/6 分割の左列に状態行を置いていたため）。
- 期待する関係: ラベル・値・バッジは 1 行で決まる（`src/home/status/tiles.tsx`
  の測定コメントが 613px を前提にしている）。
- 影響: major ／ 確度: high ／ 検出: rendered + DOM geometry

**F-5 — カード見出しの矢印がタイトルから離れた（軽微）**

- 観察: 2 行，见出しの矢印がカード右端に浮いていた（flex item が
  折り返したテキストの横に残った）。
- 影響: minor ／ 確度: high ／ 検出: rendered

**F-6 — ページ末尾の空白帯（注記・未改修）**

- 観察: HOME 末尾に 176px の空帯（PetCompanion の固定オーバーレイの予約領域）。
- 判定: **契約どおりの意図**。`src/styles.css` の focus 補償チェーン
  （`--pet-overlay-offset` → `body { padding-bottom }`）が要求する領域で、
  解除すると WCAG 2.2 SC 2.4.11 の焦点非遮蔽が壊れる。視覚的な残存課題として
  記録し、**今回は未改修**。

**F-7 — モバイルで companion が index rail に重なる（注記・未改修）**

- 観察: mobile（390px）では hero の index rail の「02 サイトの状態」行が
  固定 companion の上に乗って読みにくくなる。`petSafeAreaStyle` の inline-end
  通行帯は `md` 以上で.reserve されるため、phone 幅では重なりが残る。
- 判定: **未改修**。companion の表示契約（`docs/domain/pet-companion.md` §5.2、
  Issue #274）は owner 指示で smartphone では自動 mount しない契約だが、
  今回の capture では mount が見えている。契約と実挙動の不一致は companion
  側の Issue として切り出す必要があり、この PR の範囲（構図）では扱わない。

**F-8 — 広告ユニット（注記・対象外）**

- 観察: 広告の card 形状と CTA の位置は広告契約（Issue #925）の解剖に
  従っている。構図契約の管轄外。
- 判定: 対象外。広告の件数・配置は変更していない。

### 3.2 `/portfolio`

**F-9 — カードが空の器になる（重大）**

- 観察: media を持たない project の card が、行の高さに引き伸ばされて
  表面積の 2/3 が空白の白い平面になっていた（card-shaped void）。
- 期待する関係: 反復単位の表面は内容に従う（CL-12 の新設根拠）。
- 影響: major ／ 確度: high ／ 検出: rendered + DOM geometry

**F-10 — リアクション帯がページの左軸を外れる（重大）**

- 観察: `/portfolio` のリアクション帯が viewport 左端（x=0）から始まり、
  ページ全体の左 key line（x=240）と一致していなかった。
- 影響: major ／ 確度: high ／ 検出: rendered + DOM geometry

**F-11 — 画像が読み込めない（軽微・環境起因）**

- 観察: 作品カバー 3 枚が broken 表示。原因是**ローカル環境で R2 の
  media に到達できない**こと（Issue #903 と同じ前提）。production の
  絶対 URL を焼き込む preview では検証できない。
- 判定: 機械判定 CL-13（新設）がこの状態を検出する。環境起因である旨を
  ここへ記録する（CL-13 の例外は「silence」しない）。

### 3.3 他ページ（未解決として記録）

**F-12 — 全ページの hero が左一列（重大・系統的・未改修）**

- 観察: `/about` `/tools` `/stack` `/activity` `/now` `/links` の hero は
  いずれも 1024px container の左側に 1 ブロックだけがあり、右側が空域。
  HOME と同じ構図欠陥がページごとに繰り返されている。
- 判定: **未改修**。理由は §6 の残存課題。 Affects: HOME 以外の主要ページ。

**F-13 — 色面の不在（軽微）**

- 観察: `/about` `/keyboard` `/projects/dotfiles` は 8〜9 個の body section が
  すべて `ground` tone で、面の遷移がない（CL-8 warning）。
- 判定: 未改修。section の役割差异に基づく tone 割当はページ側の決定であり、
  本 Issue の範囲（HOME と主ページ）Pairs で順送り。

**F-14 — 時系列の単調羅列（軽微）**

- 観察: `/activity` の chronology は同形の小文字行の連続。
- 判定: 未改修。

## 4. 改修と前後比較

| # | 対象 | 改修 | 前 | 後 |
| --- | --- | --- | --- | --- |
| F-1 | HOME hero | 12 track の非対称 hero + section index 軸 | `home-hero--before.webp` | `home-hero--after.webp` |
| F-3 | HOME 現在地 | 2 列レコード（番号 / 名称 / 計測値 + 罫線） | `home-now--before.webp` | `home-now--after.webp` |
| F-9 / F-10 | `/portfolio` | card の stretch 解除 + media placeholder frame + リアクション帯の Container 化 | `portfolio-cards--before.webp` | `portfolio-cards--after.webp` |
| F-10 | `/portfolio` | リアクション帯を Container へ（ページの左軸へ） | `portfolio-top--before.webp` | `portfolio-top--after.webp` |

- F-2（identity mark の拡大）・F-4（状態行の全幅化）・F-5（矢印の追従）は
  上記の比較画像に含まれる。
- F-4 の改修は `src/home/composer.tsx` の状態セクション再構成、
  F-5 は `src/home/explore/ExploreSection.tsx`（共有 primitive
  `cardTitleLinkClassName` へ統一）。

## 5. 機械判定との接続（Issue #1149）

実画面で見つかった欠陥のうち、機械検証できるものをルールに落とした。

| 欠陥 | ルール | 判定 | fixture |
| --- | --- | --- | --- |
| card-shaped void（F-8） | **CL-12**（新設） | warning — 反復単位の下半が空 | `negative/empty-cards` / `positive/filled-cards` |
| 読み込み失敗した画像（F-10） | **CL-13**（新設） | warning | `negative/broken-media` / `positive/loaded-media` |
| hero 欠落の fail-open | CL-6 修正 | blocking — hero が無ければ fail | `negative/text-only-portfolio` |
| 面積だけでは media 対応を判定できない | CL-6 修正 | blocking — hero にラスター画像必须是 | `positive/media-led-detail` |
| block 種別列を構成証拠と誤認 | CL-7 修正 | 視覚順の変化を証拠にする | `negative/mobile-kind-shift` / `positive/mobile-reading-order` |
| prose 免除がルート全体 | CL-11 修正 | 免除は名前指定の section 単位に | `scripts/judge-composition.test.mjs` |

CL-12 の閾値（`repeatTailGapRatioMax: 0.5`）は実測で決めた。
`/portfolio` の card グリッドは stretch 解消前 0.52、解消後 0.10、
HOME のレコードは 0.15、状態行は 0.02。

## 6. 残存課題と未検証事項

**残存（未改修）**

1. F-11: `/about` `/tools` `/stack` `/activity` `/now` `/links` の hero 右半分の空域。
2. F-12: 8〜9 body section が全て `ground` tone のページ（CL-8 warning）。
3. F-13: `/activity` の chronology の単調さ。
4. F-6: ページ末尾の 176px 予約帯（a11y 契約）。
5. `/portfolio` の mobile は 43,000px 長い（index route として許容範囲だが、
   index route としての密度設計は未実施）。

**未検証（今回対象外）**

- motion / keyboard / 実機（`reduced-motion` と keyboard は既存の a11y ゲートが担当）。
- production の R2 media 描画（CL-13 の warning は環境起因。production では
  画像が解決され、warning が消えることを確認する必要がある）。
- Storybook / design-system ページの全 variant。
- スクリーンショットは Chromium のみ（Firefox / WebKit は既存の compat ゲートが担当）。

## 7. 参照

- runbook: `docs/runbook/ui-visual-review.md`
- 原則対応表: `docs/visual/composition-principles.md`
- ADR: `docs/adr/ADR-0022-editorial-composition-contract.md` /
  `docs/adr/ADR-0023-composition-lint-rendered-contract.md`
- 機械判定: `quality/composition-contract.json` / `scripts/judge-composition.mjs`
