---
name: composition-review
description: >
  Use to audit the compositional quality of a finished Web page or screen as a
  whole — Gestalt grouping, CRAP, hierarchy, grid/asymmetry, typography measure,
  color/surface, whitespace rhythm, media art direction, balance, unity,
  responsive recomposition, IA-to-visual mapping, and cognitive load. Judges the
  rendered whole against general design principles; does not create layouts,
  enforce token contracts, or replace regression/screenshot review.
---

# Composition Review

完成した Web 画面・ページ全体の**構図**が、一般的なデザイン原則を満たすかを監査する Skill。対象は「できあがった画面が、初見の人に意図した構造として読めるか」という問いであり、個々の component の良し悪しや token の遵守ではない。

これは知識集でもチェックリストの機械適用でもない。各原則について **何を見て、どう判定し、何を見逃しうるか** までを定義した監査手順である。基礎的品質を下回る成果物を構造的に通しにくくする層であり、「AI が優れたデザインを自動生成する」ことを宣言しない。

詳細な判定基準は [references/principles.md](./references/principles.md) の原則カードにある。SKILL.md は監査の進め方と境界を定める。

## 責務境界

この Skill は **完成形の総合監査** を担う。以下の既存 Skill とは責務が異なり、相互に参照する。

| Skill | 担当 | 本 Skill との境界 |
| --- | --- | --- |
| `layout-system` | 構図を**設計・実装する**側 | 本 Skill は作らない。完成形を監査するだけ |
| `visual-hierarchy` | 優先順位の**設計** | 本 Skill では階層は 1 観点。ページ全体の総合判定をしない単独 Skill |
| `information-density` | 密度の設計・mode | 本 Skill は密度を空白・リズムの 1 観点として参照するのみ |
| `visual-review` | rendered UI の regression / coherence の screenshot review | 本 Skill は原則適合の構図監査。diff・回帰検出は `visual-review` の領分 |
| `design-system-enforcement` | 定義済み契約の**静的強制** | 本 Skill は契約が定義しない文脈的判断を担う。色 token・余白 scale の再定義はしない |
| `design-review-routing` | レビューのタイミングとルーティング | 本 Skill は「何を監査するか」。いつ誰がやるかは routing の領分 |
| `typesetting` / `color-system` / `responsive-design` / `navigation-design` / `cognitive-accessibility` / `accessibility-audit` | 各専門領域の設計・監査 | 本 Skill はそれらを構図の 1 観点として参照し、専門判定そのものは委ねる |

機械的に検査可能な契約（token 値・scale・lint で検出できる規則）は project 側の contract と `design-system-enforcement` の領分であり、本 Skill では再定義しない。

## Workflow

### 1. Fix the artifact and the evidence

監査対象を固定する。少なくとも以下を揃える。

- 対象 route / view / state（default に加え、empty・long content・error など構図が変わる state）
- viewport の組（desktop と mobile を最低限。tablet は内容に応じて）
- theme / locale / font loading / zoom の条件
- rendered artifact（screenshot）と、必要に応じた DOM geometry（bounding box、computed style）

スクリーンショットが取得できない場合は **未実施** と記録し、想像で判定しない。code だけでは rendered 上の構図は確定できないが、逆に screenshot だけでは「意図」を確認できないため、両方を使い分ける。

### 2. Establish intent before judging

構図の良し悪しは意図に依存する。判定前に以下を確認する。

- 情報設計（IA）: この画面が伝えるべき内容と優先順位は何か
- 内容の性質: 長文か、スキャン対象か、操作中心か
- 表現の意図: ブランド・編集方針として意図された非対称・非標準的構図があるか
- project の既存 design language: その画面が従うべきはずの規則

意図が確認できない場合、「意図不明のまま欠陥と断定しない」ことを原則とし、finding の confidence を下げる。

### 3. Run the principle passes

[references/principles.md](./references/principles.md) の原則カードに従い、ページ全体を対象に各原則を一巡する。すべての原則を毎回フル適用する必要はなく、変更範囲と surface の性質に応じて観点を絞る。各カードの「検出方法」に従い、rendered artifact / DOM geometry / code のどれを見るかを選ぶ。

特に以下はページ全体で必ず確認する:

- **Gestalt grouping**: 関連要素が近接・共通領域でまとまり、無関係な要素が分離されているか
- **Hierarchy / focal point**: 最初に目に入るものが意図した主役か。font-size だけの階層になっていないか
- **Alignment / grid**: 要素が共有する座標系に乗っているか。意図的非対称と無秩序を区別できるか
- **Responsive recomposition**: 各 breakpoint で構図が再構成されているか、単純縦積みになっていないか
- **IA-to-visual mapping**: 情報の優先順位と視覚的重みの対応が取れているか

### 4. Classify findings

各 finding は principles.md のカードにある「違反となる状態」「正当な例外」「誤検出の可能性」を照合してから報告する。形式:

```text
Principle / surface / viewport / state:
Observation (what the rendered artifact shows):
Expected relation (and its source — intent, IA, or principle):
Impact: blocker | major | minor | note
Confidence / alternative explanation:
Detection method used (rendered / DOM geometry / code):
```

「なんとなく散らかっている」「洗練されていない」は単独では finding にしない。観察可能な特徴に分解できない指摘は `note` に留め、修正 Issue の根拠にしない。

### 5. Verify

- 指摘した問題が rendered artifact で再現することを確認する（DOM だけの推測で終わらない）
- 修正後は同じ capture 条件で再撮影し、問題の解消と新たな構図回帰の両方を確認する
- 画像で確認できない領域（keyboard、screen reader、motion、performance）は本 Skill の対象外として明示し、別の検証へ渡す

## References

- [NN/g — 5 Principles of Visual Design in UX](https://www.nngroup.com/articles/principles-visual-design/)
  - Observe: scale / visual hierarchy / balance / contrast / Gestalt を実例画面でどう分解するか
  - Useful for: hierarchy・balance・contrast の判定軸
- [NN/g — Proximity Principle in Visual Design](https://www.nngroup.com/articles/gestalt-proximity/)
  - Observe: proximity が他の視覚 cue を上書きする条件、responsive で grouping が変わる例
  - Useful for: Gestalt grouping、responsive recomposition の判定
- [NN/g — Why Does a Design Look Good?](https://www.nngroup.com/articles/why-does-design-look-good/)
  - Observe: 実在ページを grid alignment / whitespace rhythm / refined palette / imagery に分解する手順
  - Useful for: 「良い構図」を観察可能な特徴へ分解する訓練
- [UW–Madison DesignLab — CRAP Principles](https://designlab.wisc.edu/resources/design-tips-and-tricks/crap-principles/)
  - Observe: CRAP（Contrast / Repetition / Alignment / Proximity）をページ単位へ適用する問い
  - Useful for: CRAP のページ全体への拡張。原典は Robin Williams『The Non-Designer's Design Book』
- [Practical Typography — Line length](https://practicaltypography.com/line-length.html)
  - Observe: measure の判定基準（45–90 characters、alphabet test）と responsive での失敗例
  - Useful for: typography / measure の判定
- [Practical Typography — Maxims of Page Layout](https://practicaltypography.com/maxims-of-page-layout.html)
  - Observe: figure-ground、consistency、white space、grid への page 全体の原則
  - Useful for: balance / proportion / unity / whitespace の判定
- [Refactoring UI](https://www.refactoringui.com/)
  - Observe: hierarchy は size だけではない、ambiguous spacing、grid は万能でない、画像の intended size
  - Useful for: hierarchy・spacing・image の判定。「Size isn't everything」等の章立てがそのまま監査軸になる
- [Smashing Magazine — Responsive Images Done Right](https://www.smashingmagazine.com/2014/05/responsive-images-done-right-guide-picture-srcset/)
  - Observe: art direction use case（crop・focal point を breakpoint で変える）と `sizes`/`srcset` の役割
  - Useful for: media / art direction、responsive での構図再編成の判定
- [Pentagram](https://www.pentagram.com/)
  - Observe: editorial / portfolio 系の完成形が grid・asymmetry・media・typography をどう統合するか
  - Useful for: 優れた構図の実例観察。clone ではなく構造の参照として使う

## Avoid

- 単一の pixel 値・scale・token を絶対基準にしない。それは project の contract の領分
- 「もっと余白を」「もっと大きく」のような方向感だけの指摘を finding にしない
- 意図的な非対称・experimental layout を無秩序と混同しない。intent を確認してから判定する
- rendered 確認なしに code の class 名や DOM 順だけで構図を断定しない
- この Skill の pass/fail を「デザインが良い」の証明として扱わない。構造的欠陥の検出が目的

## Verify

- 監査は rendered artifact（最低 desktop + mobile viewport）に対して行われたか
- 各 finding が principles.md のカードの「違反・例外・誤検出」と照合されているか
- IA・意図・project 規則の確認が判定より先に行われたか
- 未実施の検証（motion、keyboard、実機など）を pass としていないか

品質改善の実証は **trial-pending**。実 project での trial evidence が得られるまで stable に昇格しない。単体 install でもこの手順を利用できる。
