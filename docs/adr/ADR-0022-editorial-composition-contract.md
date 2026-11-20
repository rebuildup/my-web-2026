# ADR-0022 — Editorial composition contract と UI 品質の機械的強制

- Status: **Accepted** — 本文の採択は **engineering decision**。owner が
  示したのは「v0.11.0 RC をデザイン品質未達として差し戻し、UI 設計と
  品質保証システムを根本的に再構築する」という**要件**であり、
  構成契約の各条文・トークン値・画面構成の採否は agent が決定優先順位
  （AGENTS.md §8）から導出した engineering decision である（§0）。
- Date: 2026-11-21
- Ticket: Epic #1104 / #1105（正本化）/ #1106（プリミティブ）/
  #1107（静的ゲート）/ #1108（HOME）/ #1109（ページ適用）/
  #1110（視覚検証）
- Target release: `release-0-11-0`（0.11.0）
- Supersedes / revises:
  - `docs/verification/design/direction-comparison-0-8-1.md` §4 の運用規則
    「彩色面積は 1 画面 5% 前後を上限」（数値上限としては失効。§3.3）
  - `src/editorial/semantic-tokens.ts` 冒頭コメントが記述する
    direction B の「color survives only in the classification layer」
    という表面規則の**厳格解釈**（§3.3 — 無彩色グラウンドと墨の操作色は
    維持し、色面の役割を「分類」から「セクションの面」へ拡張する）
  - `src/editorial/layout-system.md`（全面改訂は実装 ticket で行う。
    本 ADR が改訂の決定記録、同ファイルが運用正本になる）
- Evidence: T3 Code（`github.com/pingdotgg/t3code`）の実装調査
  （`.reference/t3code`: `AGENTS.md` "Taste"、`docs/internals/web-ui.md`、
  `.macroscope/check-run-agents/ui-consistency.md`、
  `apps/web/src/components/ui/*`、`vite.config.ts` の `@shadcn/lint`
  設定）。本リポジトリ側の構造診断は §1。

> **決定の記録。** owner の指示原文は「既存コンポーネントへの小規模な
> CSS 調整、色の変更、余白の微修正で完了扱いにしない」「既存実装を
> 少し改善して終わることを禁止」「デザインシステムは部品集ではなく、
> 品質の低い画面を組み立てにくくするための制約システムとする」。
> 本 ADR の各条文はその要件を充足するための engineering decision で
> あり、owner の個別画面・個別トークンの承認を意味しない
> （AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。

## 0. 決定の出所

| 事項 | 誰が決めたか | 出所 |
| --- | --- | --- |
| v0.11.0 RC をデザイン品質未達として差し戻す | **owner** | 本タスク指示（2026-11-21） |
| UI 設計と品質保証システムの根本的再構築 | **owner** | 同上 |
| HOME の大胆な再設計・長大な羅列の廃止 | **owner** | 同上 |
| 主要画面への統制適用・機械的強制・実画面レビュー工程化 | **owner** | 同上 |
| 構成契約の条文・primitive API・色面トーンの語彙 | engineering decision | 本 ADR §2–§5 |
| 旧制約（direction B の厳格解釈・彩色面積 5%）の改訂 | engineering decision | 本 ADR §3.3 — owner は「古い制約は絶対視せず設計意図を調査して正本を改訂せよ」と指示 |

## 1. Context — なぜ現状は構造的に低品質なのか

### 1.1 T3 Code の調査結果（抽出した機構）

T3 Code が UI 一貫性を維持する仕組みは「部品の美しさ」ではなく
**所有権と機械的強制**にある。

1. **プリミティブが見た目を所有する**。`apps/web/src/components/ui/`
   の約 50 プリミティブは `cva` の `variant` × `size` で外観を完結させ、
   呼び出し側は variant を選ぶだけ。`className` での上書きは
   `shadcn/no-restyle` が error にする（許可は layout 系のみ）。
   レイアウト系 class（width / flex / margin / position）は親が持つ、
   という分担が規則として明文化されている。
2. **slot composition**。`ComposerBanner.tsx` は小さな slot の集合を
   export し、各 slot が自身の class を所有・`className` を受け・
   残り props を spread・`cn` で merge する。variant / density は
   `Root` の prop。stack の振る舞い（優先度・展開）は
   `ComposerBannerStack` が所有する。
3. **静的解析による強制**。`@shadcn/lint`（oxlint JS plugin）で
   `no-restyle` / `no-raw-colors` / `no-arbitrary-values`（カテゴリ別
   allowlist 付き）/ `require-static-classes` / `no-unknown-classes`
   を `apps/web/src/**` に error で適用。`components/ui/**` のみ
   生のスタイル記述を許す exclude 設計。
4. **規則の文書化**。`AGENTS.md` "Taste" と `docs/internals/web-ui.md`
   が「何をどこに書くか」を正本化し、review agent
   （`.macroscope/check-run-agents/ui-consistency.md`）が diff 範囲に
   限定して 3 つの質問（プリミティブ迂回 / グローバル CSS 迂回 /
   composition 違反）だけを検査する。finding ゼロなら `All clear`。

my-web-2026 への写像: Tailwind class 文字列の代わりに Panda CSS の
`css({...})` オブジェクトリテラルが解析対象になる（静的に検査しやすい）。
Biome 1.9 は JS plugin を持たないため、oxlint 相当は本リポジトリの
規約どおり `scripts/check-*.mjs` + `quality/profile.yaml` の決定的
ゲートとして実装する。

### 1.2 my-web-2026 の構造診断

1. **プリミティブが少なすぎ、かつ弱い**。`src/editorial/primitives/`
   は `Container` / `SectionHeading` / `Badge` / `StateMark` /
   `MaterialSymbol` の 5 種。Button / Panel / Grid / 行リスト /
   disclosure のプリミティブが存在しないため、全 feature が
   `css({...})` を手書きする（`src/**` に約 1,700 の `css({` 呼出、
   119 ファイル）。余白・色・幅・形状の決定がコンポーネントごとに
   再発明され、収束する構造がない。
2. **レイアウト契約は文書のみで機械的強制がない**。
   `src/editorial/layout-system.md` は「public surface に箱を描くな」
   「4/8 split の唯一のグリッド」等を定めるが、それを検査する
   ゲートが存在しない。#968 の field panel のように owner 指示で
   例外が増えるたびに文書と実装が乖離する。
3. **HOME は obligation の連結であり composition ではない**。
   `src/home/composer.tsx` は masthead → ad banner → hero → guide
   （924 行）→ projects → ad → data-source badge → capabilities →
   ad → status（5 つの h3 小節）→ ad → contact → footer を縦に
   積み、xl では右に sticky の広告 rail を並走させる。各 section が
   独立 Issue で追加され、それぞれが自前の padding / 見出しリズムを
   持つため、ページ全体としてのリズム・密度・視線誘導を決める主体が
   どこにもいない。
4. **色が構造を担えない**。direction B（MONOCHROME / SIGNAL）の
   厳格解釈で CTA は墨・リンクは下線のみ・色は分類マークと小さな
   field panel に限定され、「彩色面積 5% 前後を上限」という運用
   規則が面積の上限として機能していた。結果として色は情報階層の
   表現手段から外れ、面の構成はすべて無彩色の明度差だけで支えられ、
   長大な羅列を視覚的に区切る手段が不足した。
5. **品質ゲートは技術契約を検査するが構成契約を検査しない**。
   contrast / a11y / architecture / content-links は揃っているが、
   「この画面はなぜ長大で単調か」「余白は近接を表現しているか」
   「色面は意味を持つか」を判定する仕組みがない。axe が PASS しても
   デザイン品質は何も保証されない。

## 2. Decision — デザインシステムは制約システムである

### 2.1 層と所有権

デザインシステムを次の 4 層の**制約の連鎖**として再定義する。
各層は「何を自由に変えられ、何を変えられないか」を型と静的解析で
表現する。

```text
L0 tokens        色・書体・余白・radius の生値と semantic token
                 （src/editorial/tokens.ts / semantic-tokens.ts）
                 → 変更理由: visual language の決定のみ
L1 layout        面の構成プリミティブ: PageSection / Container /
                 Grid / Stack / Cluster / Split
                 （src/editorial/primitives/ 配下に追加）
                 → 変更理由: 構成契約（本 ADR §3）の改訂のみ
L2 components    操作・表示プリミティブ: Button / TextLink / Panel /
                 Badge / StateMark / RecordList / Disclosure /
                 MediaFrame 等
                 → 変更理由: 同一 governing invariant を持つ消費者が
                   2 つ以上観測されたとき（token-audit §3-4 と同じ
                   昇格規則）
L3 pages         obligation（home / portfolio / about / …）と
                 routes。L1/L2 を組み合わせて画面を構成する。
                 → 余白・色面・グリッド・密度の**セクション級**決定は
                   ここでは行わない。許されるのはコンテンツの選択・
                   順序・文言・データ投影のみ
```

### 2.2 構成契約の条文（運用正本は `src/editorial/layout-system.md` 改訂版）

以下は `scripts/check-ui-contract.mjs`（§5）が機械的に検査する条文の
骨格である。条文 ID はゲートの違反コードと 1:1 対応させる。

- **C-1 面（surface）の所有**: `<section>` の `paddingBlock`、
  ページ地の `background`、セクション区切りの `borderTop` は
  `PageSection` だけが持つ。feature 側の `css()` に
  `paddingBlock` / `padding`（block 方向）を書くことを禁ずる。
  例外は inline な cluster 内部の padding（Panel / Button 等
  L2 プリミティブの内部実装）に限る。
- **C-2 色の所有**: `backgroundColor` / `background` / `color` /
  `borderColor` の値は semantic token（`bg.*` / `text.*` /
  `border.*` / `accent.*` / `mono.*`）のみ。raw palette 参照
  （`{colors.brand.*}` 等）・hex / rgb / hsl リテラルは
  `src/editorial/**` と明示 allowlist を除き禁止。
- **C-3 セクション tone**: 面の色は `PageSection` の `tone` prop
  （§3.3 の語彙）でのみ指定する。feature が任意の `backgroundColor`
  で面を作ることを禁ずる（Panel の variant を経由する）。
- **C-4 グリッド**: `gridTemplateColumns` の直接記述は
  `src/editorial/**` と明示 allowlist（ページ構成ファイル）に限る。
  feature は `Grid` / `Split` の preset を使う。
- **C-5 行・リスト**: ラベル/値の行は `RecordList`、カード状の反復は
  `Panel` の grid 配置、縦の流れは `Stack` の named gap を使う。
  feature 内での `<ul>` 直接スタイル指定は `Stack`/`Grid` + `listStyle`
  リセットの定型に限定する。
- **C-6 操作要素**: button / link の見た目は `Button` / `TextLink`
  の variant で選ぶ。生の `<a>` / `<button>` への padding・radius・
  background の手書きスタイルを禁ずる（semantic row・tab・
  resize handle 等、T3 Code と同じ「意図的にプリミティブでない」
  例外は allowlist で個別登録する）。
- **C-7 重複の禁止**: 同一の正規化 `css({...})` リテラルが 3 ファイル
  以上に出現したら L2 プリミティブへの抽出を要求する。
- **C-8 情報量**: HOME を含む公開ページで、データ一覧をそのまま
  全件描画する構造を禁ずる。上限は「代表 N 件 + 全件への導線」
  （N はセクション契約で定める）か、全件が主目的の専用 index
  route（`/portfolio`・`/tools`・`/activity` 等）に限定する。
  機械検査は `.map(` を含む一覧描画に `slice` / `limit` /
  `Disclosure` / 専用 route への link のいずれかを要求する
  ヒューリスティック検査とし、最終判定は §6 の実画面レビューが
  行う。

### 2.3 variant / slot / composition の規則

- L2 プリミティブは `variant` × `size`（Panda `cva` または同等の
  variant props）で外観を完結させる。call site が padding・色・
  radius・border を個別上書きする props（`className` のスタイル
  迂回）を公開しない。layout 系の調整（`width` / `flex` / `margin` /
  `position`）だけは親側の責務として許す — T3 Code の
  `no-restyle allow: ["layout"]` と同じ分担。
- 複合コンポーネントは slot 合成で作る。slot は自身の class を所有し、
  `className` を受けて merge し、残り props を spread する。
  variant / density は root の prop が持つ。
- 「同じ見た目を 2 箇所で使いたい」は variant 追加か slot 追加の
  合図であり、コピー＆スタイルの合図ではない。

## 3. Decision — 色と面の設計

### 3.1 維持するもの

- 無彩色グラウンド（`mono.*` の明度階層）と、操作色としての墨
  （`bg.accent` = inverse ground、`text.inverse` ラベル）は維持する。
  CTA を彩色にする必然性はなく、墨の操作色は direction B の最も
  成功した部分である。
- `accent.category.*`（マークの 3:1 ステップ）と `accent.field.*`
  （面の 500 ステップ）、`mono.ink.onColour` / `onColourInverse`
  の ink-pairing 規則、contrast gate（`scripts/check-a11y-contrast.mjs`）
  は維持する。

### 3.2 追加するもの — セクション tone

面の色を「分類の借用」から「セクションの tone」へ格上げする。
`PageSection` は `tone` prop を持ち、tone は semantic token の
**面とその上の ink の組**を一つの名前で指す。

```text
tone: 'ground'    mono.surface.ground  + 通常 ink（既定）
tone: 'sunken'    mono.surface.sunken  + 通常 ink（沈んだ帯）
tone: 'raised'    mono.surface.raised  + 通常 ink（持ち上げた帯）
tone: 'inverse'   mono.surface.inverse + mono.ink.inverse（墨の反転帯）
tone: 'field.<class>'  accent.field.<class> + mono.ink.onColour
                        （design / code / writing / tool）
```

tone の実装機構: `PageSection` は tone に対応する CSS クラスを
`<section>` に付け、そのクラスが Panda の semantic token が発行する
CSS custom property（`--colors-bg-*` / `--colors-text-*` /
`--colors-border-*` / `--colors-accent-*`）を subtree 内で再束縛する。
これにより **既存コンポーネントは tone を意識せず正しい ink / 面で
描画される**。新しい色値は増やさず、既存 semantic token の
再束縛だけで実現する。

### 3.3 改訂するもの — 数値上限の失効

- 「彩色面積 1 画面 5% 前後を上限」（direction-comparison §4 の
  運用規則）は**数値上限として失効**する。代わりに「色面は意味を
  持つ」という構成契約（C-3）と、tone の語彙制限（§3.2 の 7 種）
  が制約になる。色を増やすこと自体は禁じないが、**どの面にどの
  tone を使うかはセクションの情報分類が決める**。
- direction B の「color survives only in the classification layer」
  は「色は分類とセクション tone に限定され、本文・操作・装飾には
  使わない」へ改訂する。本文テキストの彩色・装飾的色面・
  ステータス hue の導入は引き続き禁止。
- 面積の健全性は数値ゲートではなく §6 の実画面レビューと、
  chromatic share の**計測記録**（閾値なし・観測値として
  `docs/verification/design/` に残す）で担保する。

### 3.4 tone 割当の原則（ページ設計の指針）

- tone は**情報の分類か強調の度**を表す。同じ tone を連続する
  2 セクションに使わない（面の対比が意味を失う）。
- `field.*` はそのセクションのコンテンツ分類と一致させる
  （Tools の紹介セクションが `field.tool`、制作物が `field.design`
  等）。分類と無関係な色面は禁止。
- `inverse` はページ内で高々 1〜2 箇所（closing / CTA 等、
  「ここが転換点」という意味を持つ場所）。
- `sunken` / `raised` は無彩色の抑制・強調の帯。連続使用可だが
  隣接セクションと同一 tone にしない。

## 4. Decision — HOME の情報設計

### 4.1 原則

- HOME は**キュレーションされた入口**であり、全データの表示先
  ではない。情報の重要度・鮮度・種類で代表を選び、全件への
  アクセスは専用 route / 導線に移す。
- 現行の「現在地プロジェクト一覧の全件表示」（Issue #316 の
  "no cap, no paging, no see more" 契約）は**HOME では失効**する。
  全件表示は専用 route（新設 `/now` 相当）へ移し、HOME は
  代表数件 + 「すべて見る」導線を持つ。全件を隠さない原則
  （stopped project を隠さない）は専用 route 側で維持する。
- 広い viewport で「大きな空白 + 細長い一覧」が共存する構造を
  廃止する。情報の関連性・読み順・視覚的重みでグリッドを組む。

### 4.2 HOME の構成（確定版は実装 ticket の設計レビューで確定）

```text
masthead（簡素化: wordmark + 最小 nav）
hero          tone: ground / inverse 検討 — identity + lead + 主 CTA
now band      現在地の要約: 代表 project 数件 + 稼働 signal + /now への導線
guide index   サイト案内をコンパクトな索引化（capabilities と統合検討）
explore       capabilities + 主要 route への分散リンク
digest        status / reactions / counter / activity / presence を
              1 セクションの signal panel に集約（h3 5 連発を廃止）
contact       CTA（tone: inverse 候補）
footer        現行維持 + privacy notice
```

- 広告は独立した割り込み契約を維持するが、**名前付き slot**
  （masthead leaderboard / in-feed unit / sponsored rail）として
  配置し、セクションの rhythm・tone を乱さない。sticky rail は
  構成の質を損なう場合は廃止し、記事カラム内の in-feed 配置へ
  移す（最終判断は実画面レビュー）。
- PetCompanion の floating overlay 契約は維持。

### 4.3 他ページ

About / Portfolio / Tools / Stack / Activity / Contact / Links /
Keyboard / projects.dotfiles / design-system を同一契約に載せる。
ページごとの意味差（portfolio の作品 grid、tools の一覧、activity
の時系列）は残し、同一カード化で押し込まない — C-4/C-5 の preset
と `Panel` variant の組合せで表現する。

## 5. Decision — 品質の機械的強制

T3 Code の `@shadcn/lint` + Macroscope review agent に相当する
ものを本リポジトリの規約で実装する。

### 5.1 静的ゲート `ui:contract:check`

`scripts/check-ui-contract.mjs`（`quality/profile.yaml` の
`validate:fast` component として登録、`scripts/*.test.mjs` で
fixture 検証）:

- C-1〜C-8 の違反検出（§2.2）。`css({...})` オブジェクトリテラルと
  JSX を対象に、owner ごとの allowlist を
  `quality/ui-contract.json` に記録する。
- `src/editorial/**` は制約の**定義側**であり検査対象外
  （例外は明示 allowlist として列挙）。
- 検査は決定的・offline・status-only。違反は file:line + 条文 ID
  で報告する。

### 5.2 レンダリング計測と画像レビュー

- `scripts/capture-design-matrix.mjs`: 主要 route ×
  {desktop 1440 / mobile 390} × {light / dark} の screenshot を
  `.tmp/` に生成し、freeze 証拠用に `docs/verification/design/`
  へ昇格する運用は既存 capture 系 script の規約に従う。
- `scripts/measure-chromatic-share.mjs`: 887-current と同じ
  chromatic share 計測を script 化し、**閾値なしの観測値**として
  記録する（合否はレビューが判断）。
- 実画面レビューの手順書 `docs/runbook/ui-visual-review.md`:
  desktop/mobile × light/dark の全体像を取得し、余白・整列・近接・
  対比・反復・視線誘導・情報密度・色面構成をチェックリストで
  評価する。コードや axe の結果だけでデザイン良否を判定しない
  （quality-gate skill §19 の rendered UI verification を
  デザイン品質へ拡張する）。
- レビュー観点は `.macroscope/check-run-agents/ui-consistency.md`
  と同じく **diff 範囲に限定した 3 問**にする
  （プリミティブ迂回 / 契約外のスタイル / composition 違反）。
  PR テンプレートまたは review checklist として
  `docs/runbook/ui-visual-review.md` に収録する。

### 5.3 やらないこと

- 数字合わせのための例外・曖昧な閾値・「テストを通すためだけの
  例外」は追加しない。
- 全ページを同一カード・同一セクション形状に押し込む規則は
  設けない（§4.3）。
- T3 Code の Tailwind / shadcn 機構をそのまま輸入しない。
  Panda CSS と obligation architecture の上で同じ**原理**
  （所有権・variant・slot・静的強制・diff レビュー）を実現する。

## 6. Consequences

### Positive

- 「技術テスト PASS なのにデザインが低い」構造的原因
  （プリミティブ不足・契約の非強制・色の構造的不在・HOME の
  obligation 連結）に対し、層・条文・機械検査・レビュー工程の
  4 点で直接対応する。
- 既存の Panda / semantic token / contrast gate / capture 基盤を
  そのまま使い、新規依存を増やさない。
- C-1〜C-8 は `check-architecture.mjs` と同じ「宣言 → 機械検査 →
  fixture test」の規約で追加でき、stacked ticket の並列化を妨げない。

### Negative / Trade-offs

- `css()` の全面的な primitive 移行は大規模 diff になる。
  移行は ticket 分割し、各 PR は変更範囲の最小検証で
  `release-0-11-0` に統合する。
- tone の CSS var 再束縛は Panda の semantic token 実装詳細に
  依存する。Panda 更新で var 名が変わった場合は §5.1 のゲートと
  component test で検出する。
- C-8 の一覧検査はヒューリスティックであり、誤検出を
  allowlist で個別処理する運用コストがある。

## 7. Re-evaluation triggers

- Panda CSS のメジャー更新で semantic token の var 構造が変わった。
- 第 2 の visual language（dashboard / product UI）が実装された
  （ADR-0005 §"Re-evaluation triggers" と同じ条件）。
- tone 語彙が 7 種で不足し、増やす判断が必要になった。
- C-8 の誤検出率がレビューを阻害するレベルに達した。
