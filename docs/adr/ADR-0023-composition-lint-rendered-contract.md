# ADR-0023 — Composition lint: rendered-structure contract とデザイン原則対応表

- Status: **Accepted** — 本文の採択は **engineering decision**。owner が
  示したのは「人間が個別のデザイン不備を指摘しなくても、一般的な
  デザイン原則から低品質な構成を自動検出・拒否できるシステムを
  構築する」という**要件**であり、ルール ID・閾値・構成原語の API・
  fixture の構成は agent が決定優先順位（AGENTS.md §8）から導出した
  engineering decision である（§0）。
- Date: 2026-11-22
- Ticket: Epic #1128 / #1129（本 ADR と対応表）/ #1130（構成原語）/
  #1131（collector）/ #1132（judge + fixtures）/ #1133（orchestrator）/
  #1134（media usage contract）/ #1135（HOME）/ #1136（ページ適用）/
  #1137（Skill vendoring）
- Target release: `release-0-12-0`（0.12.0）
- Supersedes / revises:
  - なし（ADR-0022 の構成契約 C-1〜C-8・tone 語彙・rhythm 語彙は
    **維持**する。本 ADR はその上にレンダリング構図層を追加し、
    rhythm 語彙と Grid preset を**拡張**する。§3）
- Depends on:
  - `rebuildup/design-skills` Issue #191 — `composition-review` Skill
    （原則の正本側。vendoring は #1137）

> **決定の記録。** owner の指示原文は「既存画面への局所的な CSS 修正を
> 成果として扱わない」「Lint が PASS するだけでなく、既知の低品質な
> 画面が確実に FAIL することを保証する」「検査可能な品質保証と、
> 人間・視覚モデルによる評価の保証範囲が明確に分離されている」。
> 本 ADR の各条文はその要件を充足するための engineering decision で
> あり、owner の個別画面・個別ルールの承認を意味しない
> （AGENTS.md §6）。

## 0. 決定の出所

| 事項 | 誰が決めたか | 出所 |
| --- | --- | --- |
| 低品質構図を自動検出・拒否するシステムの構築 | **owner** | 本タスク指示（2026-11-22） |
| 人間による個別欠陥指摘の終了・自律的な Issue 分解と統合 | **owner** | 同上 |
| 検査層の分離（静的 / レンダリング / 視覚評価） | engineering decision | 本 ADR §2 — 既存の observe/judge 分離規約の一般化 |
| ルール ID・閾値・構成原語 API・fixture 構成 | engineering decision | 本 ADR §3–§6 |

## 1. Context — ADR-0022 で保証できたこと、できなかったこと

ADR-0022（Epic #1104、v0.11.0）は「デザインシステムは制約システム」
として、所有権ベースの静的契約（C-1〜C-8）と実画面レビュー工程を
確立した。これは「作る側が契約を破りにくい」状態を作った。

しかし残る構造的ギャップがある:

1. **静的契約は構図を見ない**。C-1〜C-8 は「誰が surface / 色 /
   grid を所有するか」を検査するが、「その結果としてページ全体が
   どう見えるか」は検査しない。契約を守ったまま全セクションが
   同じ左揃え縦積みになることは可能であり、実際に起きてきた。
2. **レビューは人間/agent の目に依存する**。`ui-visual-review.md`
   のチェックリストは正しいが、実行は ticket PR ごとの判断に委ね
   られ、網羅的・再現的な判定ではない。
3. **構成原語が均質化を招く**。Grid presets（等分カラム）と
   SectionHeading `spread`（4/8 split）だけでは、非対称・
   breakout・media-led・色面主体の構図を表現する手段がなく、
   「契約内で書ける構図」が事実上 1 種類に収束する。
4. **メディアの不在を検出できない**。「画像を持つ作品をテキスト
   だけで列挙する」はコンテンツ↔アセットの対応を知る層がないと
   機械判定できない。

## 2. Decision — 検査は 3 層に分離する

```text
L-A 静的解析      scripts/check-ui-contract.mjs（C-1〜C-8）+ 将来の
                 composition 静的検査。ソースを対象。決定的・offline・
                 validate:fast 入り。判定できるのは「契約の所有権と
                 書き方」だけで、構図の良否は判定しない。
L-B レンダリング  composition lint（本 ADR）。browser で DOM geometry
解析             と computed style を収集し、正規化した構図モデルを
                 純粋関数の judge が判定する。判定できるのは
                 「レンダリング結果として観測可能な構造的欠陥」だけ。
L-C 視覚評価      composition-review Skill（design-skills#191）+
                 ui-visual-review.md の人間レビュー。美的判断・
                 brand expression・文脈依存の評価。機械判定の
                 対象外であり、PASS/FAIL の保証対象にしない。
```

保証範囲の分離（完了条件 8）:

- **機械的に保証するもの**: L-A/L-B が検出する Blocking Error。
  「既知の低品質画面が確実に FAIL する」は L-B の negative fixture
  で証明する。
- **機械的に保証しないもの**: 構図の美しさ・意図の妥当性・
  brand への適合。これらは L-C の領分であり、モデル評価を使う
  場合も「再現可能な機械的検査」とは別物として記録する。
- **Warning の扱い**: L-B が「構図上の疑義」として出す Warning は
  merge を止めないが、L-C レビューの必須入力になる。Warning を
  根拠なく allowlist で黙らせることは禁止（§6）。

### 2.1 観測と判定の分離

`e2e/viewport/contract.ts` の確立済み規約を一般化する:

- **collector**（browser half）は事実だけを集める。route ×
  viewport ごとに正規化した構図モデル JSON を出力する。判定も
  スタイル解釈もしない。
- **judge**（pure half）はモデル JSON だけを入力に verdict を返す
  純粋関数。DOM・browser・時刻に依存しない。`scripts/*.test.mjs`
  で offline 検証し、validate:fast に入る。
- **fail-closed**: collector が未実行・モデルが不完全・judge が
  未知ルールを受け取った場合は pass ではなく fail/skip 明示とする
  （`layout-stress.mjs`・viewport grid report の「未実行は pass に
  しない」規約）。

## 3. Decision — 構成原語の拡張（均質化を防ぐ表現層）

現行プリミティブは「等分カラム + 4/8 split + tone」で、契約内で
書ける構図が事実上 1 系統に収束する。表現の自由度を戻すため、
L1 に次の構成原語を追加する（実装は #1130、契約は本 ADR と
layout-system.md 改訂）。

| 原語 | 契約 |
| --- | --- |
| `Grid template="12"` | 12 分割トラック。`GridItem` が `span` / `start` / `end` を持ち、非対称配置・意図的な空きトラックを表現する。`span` は `{base, md, lg}` の responsive object を取り、mobile では既定で全幅（構図の再編成を強制する） |
| `Breakout` | `PageSection` 内のブロックを canonical measure（1024px）から意図的に逸脱させる宣言的手段。media・figure・大判 quote に限定し、任意 negative margin は引き続き禁止（C-4 の精神） |
| `Overlap` | 同一グリッドセルへの重ね配置（grid-area 共有）。図と地の反転・キャプションの重なり等に使う。重なりは宣言的 prop のみで、z-index の任意指定は公開しない |
| `PageSection rhythm="feature"` | rhythm 語彙に `feature` を追加（body より一段大きい beat）。セクション間リズム変化のための正規の手段で、連続使用は review 対象 |
| `data-*` observability | `PageSection` が `data-tone` / `data-rhythm` / `data-section` を出力し、collector が構図を分類できるようにする（#1130 に含める） |

**制約の原則**: 新しい原語は「自由度」ではなく「意図の宣言手段」
である。どの原語も「いつ使うか/使わないか」を layout-system.md に
明記し、乱用は L-B の judge（例: CL-5 uniform-grid、CL-8
color-field-absent）と L-C レビューが検出する。

## 4. Decision — 正規化構図モデル

collector が出力するモデル（`composition-model/v1`）の骨格。
判定に必要な最小限の事実だけを持ち、コンテンツ文字列・個人情報・
secret を含まない（status-only 原則）。

```text
model
├─ route, viewport {width,height}, colorScheme
├─ document {width, height, contentWidth}
├─ sections[]           // <section> を文書順に。PageSection 由来は
│   │                   //   data-tone / data-rhythm で分類
│   ├─ tone, rhythm, rect {x,y,w,h}, backgroundStep
│   ├─ alignment {dominantLeft, leftEdges[]}   // 左端クラスタ
│   ├─ blocks[]         // heading|text|media|list|panel|control|ad
│   │   ├─ kind, rect, area, fontSize?, fontWeight?,
│   │   │  inkContrast?, mediaArea?
│   ├─ grid {tracks[], columnRatio[]} | null
│   ├─ mediaArea, textArea
│   └─ signature        // 正規化した構成ベクトル（judge が比較）
├─ media {totalArea, byKind{img,video,svg,canvas}}
└─ metrics {elementsPerPixel, whitespaceRatio, ...}
```

`signature` は「セクションの構成の正規形」— tone・カラム数・
メディア有無・見出し様式・ブロック種別の組を量子化したベクトル。
コンポーネント名が違ってもレンダリング結果が同じなら同じ
signature になる（指示の「構図の正規化・比較」要件）。

## 5. Decision — ルール体系（CL-1〜CL-9）

各ルールは `quality/composition-contract.json` に機械可読な形で
保持し、対応表の正本は `docs/visual/composition-principles.md`。
severity は **Blocking**（merge 阻止）/ **Warning**（レビュー必須
入力）/ **Info**（観測値）の 3 段階。

| ID | 原則 | 検出する欠陥 | severity |
| --- | --- | --- | --- |
| CL-1 | Proximity / Unity | 全セクションが同一 tone・同一 signature の縦積み（≥4 セクション） | Blocking |
| CL-2 | Repetition / Variation | 同一 signature のセクションが ≥3 連続し、ページに構成変化がない | Blocking |
| CL-3 | Visual hierarchy | ブロック重みの階層が成立しない（最大/最小比・面積支配・型の段差がすべて閾値未満） | Blocking |
| CL-4 | White space | desktop でコンテンツカラムが measure を大きく下回り、breakout/media/第2カラムの意図的根拠がない | Warning |
| CL-5 | Grid / equality | 等分カラム反復で span/offset/breakout の意図的変化が一切ない（≥3 トラック均等） | Warning |
| CL-6 | Media art direction | route がメディア保有を宣言しているのに mediaArea が閾値未満、または media 項目が text-only 描画 | Blocking |
| CL-7 | Responsive composition | desktop の多カラム構図が mobile で単純縦積みに退化（並び替え・再構成の兆候なし） | Warning |
| CL-8 | Color/surface | ≥4 body セクションで非 ground tone が 0（意図的モノクロは例外登録制） | Warning |
| CL-9 | Focal point | ページ内に視覚的主役が存在しない（支配ブロック・display 型・面の対比がすべて不在） | Warning |

閾値・適用 route・例外は `quality/composition-contract.json` が正本。
各ルールの「検出できる欠陥 / 検出できない欠陥 / 誤検出リスク /
検証 fixture」は対応表（`docs/visual/composition-principles.md`）
に記録する。

## 6. Decision — 例外と負債の扱い

- 既知の負債は `composition-contract.json` の allowlist に
  **signature ベース**で記録する（`ui-contract.json` の方式を踏襲:
  `{route|file, rule, reason, signatures}`）。負債が減ると stale
  entry として fail し、縮小を強制する。
- 例外には必ず理由・適用範囲・検証根拠を書く。安易な allowlist
  追加は禁止（Epic #1128 の禁止事項）。
- 「Lint を通すためだけの色面・画像・装飾」の追加は禁止。
  positive fixture は原則上正当な画面で構成する。

## 7. Decision — メディア usage contract への接続

「画像を持つ作品をテキストだけで列挙する」を検出するには、
コンテンツ側が「この項目はこのメディアを持つ」を宣言する必要が
ある。portfolio obligation が既に media-approval / media-visibility
を所有しているため、#1134 でその延長として「メディア対応の
宣言」を追加し、composition lint の CL-6 がそれを参照する。
アセットの公開可否・ライセンス・情報公開境界は既存契約を維持する。

## 8. Consequences

### Positive

- 「静的ゲートも axe も PASS なのに構図が低い」状態に対し、
  レンダリング構図という観測可能な層で Blocking Error を出せる。
- 原則→違反→特徴量→検出→例外→fixture の対応表により、
  「なぜこのルールがあるか」を後から検証できる。
- 構成原語の拡張で、契約内で書ける構図の種類が増え、
  均質化の構造的原因を除く。
- collector/judge 分離により、判定ロジックは offline で
  高速に fixture 検証でき、browser half は再現可能な capture
  として分離できる。

### Negative / Trade-offs

- browser half は dev server / preview と Playwright を必要とし、
  fast gate には入らない。統合/e2e 層での実行コストが増える。
- signature ベースの類似判定は完全ではなく、閾値調整の運用
  コストがある（誤検出は fixture と実画面で継続観察する）。
- 新しい構成原語は学習コストを増やす。layout-system.md の
  「いつ使うか」を整備して緩和する。

## 9. Re-evaluation triggers

- judge の誤検出率がレビューを阻害するレベルに達した。
- 新しい構成原語が契約の意図に反して均質化を再生産した。
- L-C（composition-review Skill / 人間レビュー）の運用で、
  L-B が検出すべきだった欠陥の体系的な見逃しが判明した。
- Panda CSS / React のメジャー更新で geometry 収集の前提が変わった。
