# Research — composition-review

Issue: rebuildup/design-skills#191。my-web-2026 Epic rebuildup/my-web-2026#1128（Composition Lint）の正本側として、完成画面の構図監査 Skill を整備した。

## 調査したもの

### 一次・準一次 reference（すべて実際に開いて確認）

- [NN/g — 5 Principles of Visual Design in UX](https://www.nngroup.com/articles/principles-visual-design/) — scale / visual hierarchy / balance / contrast / Gestalt の 5 原則を実例画面で分解。hierarchy が font-size 以外（位置・面積・色・spacing）でも作れることを確認
- [NN/g — Proximity Principle in Visual Design](https://www.nngroup.com/articles/gestalt-proximity/) — proximity が他の視覚 cue を上書きする条件、responsive で grouping が変わる Wellington City Council の例。Gestalt の「近い＝関連」を機械判定できない根拠
- [NN/g — Why Does a Design Look Good?](https://www.nngroup.com/articles/why-does-design-look-good/) — Medium / Ritual の実ページを grid alignment・whitespace rhythm・refined palette・imagery に分解する手順。「良い構図」を観察可能な特徴へ分解する方法の手本
- [UW–Madison DesignLab — CRAP Principles](https://designlab.wisc.edu/resources/design-tips-and-tricks/crap-principles/) — CRAP の出典（Robin Williams『The Non-Designer's Design Book』）と各原則の問い。component 単位の原則をページ全体へ拡張する足場
- [Practical Typography — Line length](https://practicaltypography.com/line-length.html) — measure の定量基準（45–90 chars、alphabet test）と responsive での失敗
- [Practical Typography — Maxims of Page Layout](https://practicaltypography.com/maxims-of-page-layout.html) — figure-ground・consistency・white space・grid を page 全体へ適用する maxims
- [Refactoring UI](https://www.refactoringui.com/) — 「Size isn't everything」「Start with too much white space」「Grids are overrated」「Avoid ambiguous spacing」等の章立てがそのまま監査軸になる。有料書籍だが公開 TOC・無料章で構造を確認
- [Smashing Magazine — Responsive Images Done Right](https://www.smashingmagazine.com/2014/05/responsive-images-done-right-guide-picture-srcset/) — art direction use case（crop・focal point を breakpoint で変える）と `srcset`/`sizes`/`picture` の役割
- [Pentagram](https://www.pentagram.com/) — editorial / portfolio 系の完成形が grid・asymmetry・media・typography をどう統合するかの実例観察用。clone ではなく構造参照

### 境界確認のために読んだ既存 Skill

- `layout-system` — 構図を設計・実装する側。本 Skill は監査側
- `visual-hierarchy` — 優先順位の設計。本 Skill では階層は 1 観点
- `information-density` — 密度の設計・mode。本 Skill は密度を空白・リズムの 1 観点として参照
- `visual-review` — regression / coherence の screenshot review。本 Skill は原則適合の構図監査
- `design-system-enforcement` — 契約の静的強制。本 Skill は契約が定義しない文脈的判断
- `design-review-routing` — レビューのタイミングとルーティング
- `typesetting` / `color-system` / `responsive-design` / `navigation-design` / `cognitive-accessibility` / `accessibility-audit` — 各専門領域。本 Skill は構図の 1 観点として参照し、専門判定は委ねる

## 判断した点

### references/ の要否

**あり**。Issue が要求する 13 の観察軸それぞれに「違反・観察特徴・検出方法・例外・誤検出・fixture」を定義する必要があり、SKILL.md 単体では監査手順と判定基準を両立できない。`references/principles.md` に原則カードを分離し、SKILL.md は workflow・境界・references を担う構成にした。

### 成熟度分類

**trial-pending**。実 project（my-web-2026 等）での trial evidence がまだないため、CONTRIBUTING.md §3 の promotion criteria を満たしていない。release-status manifest に `trial-pending` で登録。

### design-principles.md への追加

**不要**。design-principles.md は「design philosophy の canonical source」であり、composition-review が扱う原則（Gestalt・CRAP・balance 等）はすでに §2・§4・§7 等でカバーされている。「composition is judged on the rendered whole」は §10（Delivered experience and visual verification）に既に含まれる。新規原則の追加はしない。

### roadmap.md の更新

**最小限**。roadmap.md は v0.5.0 release の記録であり、post-release の skill 追加をそこに混ぜると release scope を曖昧にする。manifest（`docs/release-status-v0.5.0.json`）への登録は validator が必須とするため実施したが、roadmap.md 自体は変更しない。

## 残課題

- 実 project での trial（my-web-2026 の Composition Lint 実装時に本 Skill を参照させ、false positive / false negative を計測）
- `visual-review` との実運用での棲み分け検証（regression review と原則監査を同一フローで回したときの重複・漏れ）
- principles.md の各カードの「誤検出の可能性」は仮説段階。trial で較正が必要
