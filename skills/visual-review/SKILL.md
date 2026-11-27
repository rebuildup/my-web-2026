---
name: visual-review
description: >
  Use to review and refine a rendered Web/application UI using screenshots,
  comparable baselines, independent image critique, optional automated
  reviewer harnesses, and bounded rerendering.
  Distinguishes objective visual regressions from context-dependent aesthetics.
---

# Visual Review

UI の source、lint、成功ログから「見た目が整った」と結論しない。**実際に表示された画面**の問題を、観察可能な evidence に結び付けてレビューし、必要な部分だけ直して再表示する。

対象は Web / application UI の screenshot-driven review。ブランドの方向性、コンテンツの正しさ、機能・keyboard・animation 全体の合格判定は代替しない。静止画で証明できることとできないことを常に区別する。

## 1. Decide what this review should catch

開始前に current project の user requirements、Spec / ADR、既存 design system、既知の successful UI と、今回触れる routes / components / states を確認する。次を分ける。

- **Regression:** baseline に存在しない clip、overflow、missing content、broken alignment、unexpected theme/state
- **Visual coherence:** typography hierarchy、spacing rhythm、visual attention、density、color / icon / surface の role consistency
- **Purpose and expression:** 何を強調すべきかが伝わるか、brand / content に合うか。baseline に忠実でも不十分なことがある
- **Non-visual:** keyboard、screen reader、state transitions、scroll、motion / performance、data integrity。画像だけで pass としない

変更範囲に応じて対象を絞り、すべての PR に全画面の撮影を要求しない。大きな visual change と release candidate の review は広くする。

## 2. Capture comparable evidence

表示結果を renderer / browser / target app から取得する。スクリーンショットを実際に取得できない場合は **未実施** と記録し、想像で評価しない。

### Separate four Quality Floor concerns (Experiment 0 / 1B)

UI の基礎品質検証では、次の 4 層を混同せず独立に満たす（詳細根拠: [Experiment 1B](../../docs/research/experiment-1b-quality-floor.md)）。

1. **検証摩擦の低減（Verification friction）**: 毎回 ad-hoc にブラウザ起動スクリプトを書くとパス不一致・一時サーバー終了で検証が失敗または断念されやすい。project-local の単一検証コマンド（既存ブラウザ＋ローカルサーバー＋撮影＋DOM 基礎チェック）を優先して使う
2. **最終リビジョン鮮度（Final-revision freshness）**: 最後のソース編集より前に取得したスクリーンショットや DOM 通過結果を最終版の証拠へ流用しない。最終編集後に再撮影・再実行し、対象ソースの SHA / build と検証証跡の一致を確認する
3. **機械検査の適用範囲（Mechanical check boundary）**: `documentElement.scrollWidth` によるページ水平溢れ（画面外を含む）、console / page / network エラー、broken image、主要操作の機能テストは機械検査で確実に拾える。一方、`overflow-x: auto` 等の局所コンテナ内での主要コマンド見切れ、低コントラストで不可視な比較バー、数値と不整合なグラフ尺度などはページ単位 DOM 検査だけでは検出できない
4. **独立コールドレビュー（Independent review vs self-inspection）**: ページ溢れ 0 かつ生成者自身がスクリーンショットを目視していても、局所見切れや尺度歪みを見落とす盲点がある。生成者自身の目視（self-check）と独立したコールド視覚レビューを区別し、重要な視覚変更や release candidate では独立レビューを併用する（軽微な非視覚変更へ一律に全画面レビューを強制しない）

- 対象の route / component / view と **state**（default、empty、loading、error、long content、focus / selected など影響するもの）を明示
- viewport、DPR、browser / OS、theme、locale、font loading、zoom、test data、scroll position、focus / hover の条件を記録
- comparable before/after は条件を揃える。全画面図と問題箇所の **原寸 crop** を必要に応じ併用し、縮小表示の錯覚を検証
- timers、randomness、network、animation などの非決定性は fixture / deterministic capture で安定化。mask はその領域を検証対象から外すため、理由・対象を明記し最小限にする
- privacy / credentials / third-party assets を含む生画面を public PR / 外部 AI reviewer に無断送信しない。必要なら匿名・ローカル・非公開に切替

pixel / perceptual diff は **変わった領域の検出**。意図した変更の良否や美観は自動決定できない。baseline 更新は意図が確認された場合だけ行う。

## 3. Review in two passes

### Pass A — first encounter (when independent review is useful)

必要なら実装 brief や変更理由を伏せ、reviewer に artifact と対象媒体だけ渡す。自由回答で「最初に目に入るもの」「何の画面か」「理解・操作上の違和感」を聞く。仕様の適合はまだ採点しない。

### Pass B — grounded critique

次に意図・制約・expected state・baseline を開示し、**実際の表示と期待の差**を見る。少なくとも必要な観点を選ぶ。

- content hierarchy と focus / reading order の視覚的手掛かり
- recurring edges、component spacing、density、scroll area、text crop
- font weight / line height、contrast、muted vs disabled、state differentiation
- component family、radius、icon stroke、border / surface hierarchy
- responsive / theme / localization / long text 等の崩れ
- product-specific visual character と、目的のない decoration

AI image reviewers は optional。可能なら実装担当とは別の reviewer と独立 critique を使う。複数モデルの意見や 10点評価を**合格の真値にしない**。不一致は見直す場所を示す signal。特定 pixel の指摘は原寸 crop、再撮影、DOM / computed styles などで裏取りする。

### Automated screenshot review

project が `agent review`（dotfiles の視覚レビューハーネス）等の自動 reviewer を提供する場合、同じ capture 条件の画像へ canonical spec（[references/agent-review-spec.md](./references/agent-review-spec.md)）を与えて局所チェックを実行できる。自動結果は Pass B への仮説入力であり、verdict をそのまま採用しない — 指摘は原寸画像・DOM・computed styles で裏取りする。

- spec は finding を `[defect]`（観察可能な具体的問題）/ `[spec-mismatch]`（明示要件・確立した規約との不一致）/ `[suggestion]`（欠陥ではない主観的改善提案）に区別する。`suggestion` を defect として修正 Issue にしない
- `approve` はその run の画像・spec 範囲の判断に限定される。製品全体の品質保証・人間の最終受入ではない
- capture artifact（broken-image icon、consent overlay 等）や画像不足・未検証 state は `unverified` として記録し、pass にしない
- 証跡として result JSON の model・specSha256・入力画像・findings・quota 消費を残す

## 4. Turn comments into evidence-based findings

finding の最小形式:

```text
Surface / state / viewport:
Observation (what pixels show):
Expected relation / purpose (and source):
Impact: blocker | major | minor | note
Confidence / alternative explanation:
Proposed correction owner: content | structure | token/primitive | local UI | unknown
Evidence: before / after / crop / baseline links:
```

「もっと polished」「点数が低い」は単独では修正 Issue にしない。好み、表現の違い、renderer 差を defect と断定しない。問題がなければ **no material finding** と報告し、変更を捏造しない。

## Review routing and owner decisions

静的な design system 契約は `design-system-enforcement`、primitive の設計は `ui-primitive-architecture` 相当の役割に分ける。AI reviewer は「発見と仮説」までとし、owner が明示した brand / product choice を model の多数決や score で上書きしない。T3 Code の [redesign PR #24865](https://github.com/pingdotgg/t3code/pull/24865) も council result とは別に維持する owner calls を記録し、大きな変更は off-by-default Beta toggle とした。

- 細かな修正は self-check + narrow evidence を基本とし、毎回の human review gate にしない
- 構造・ブランド等の未確定かつ consequential な選択だけ、安い実物で早い時点に人間へ判断材料を出す
- 大規模で可逆的な変更は候補 / preview / feature flag を使い、必要な human acceptance を default-on / release 前へ集約する
- 実際の権限境界と受入要件は current project を優先。`design-review-routing` 相当の review selection を用い、未実施の受入を pass としない

## 5. Repair, rerender, stop

1. 大きな意味・導線・情報の欠陥があれば表層の polish で隠さず既存要件・設計判断へ返す
2. shared visual drift は token / primitive へ、局所欠陥は owning feature へ最小修正する
3. **同じ capture 条件**で affected screen と逆状態を再表示し、問題が直ったかと新しい回帰を確認する
4. 重大な差が収束すれば終了。根拠なしの endless rating hill climb は行わず、時間・cost・見込みで停止する
5. 画像で確認できない keyboard / interaction / accessibility / performance / motion は対象に応じた別の検証を指定し、未実施を pass としない

通常 ticket は変更領域だけ短くレビューし、フル screenshot matrix / wide browser coverage は project 方針の release candidate freeze 後に集約できる。重大な視覚リスクは影響範囲を限定して早期確認する。

## 6. Report

確認した artifact / commit、capture matrix、問題ごとの観察と影響、修正・意図的維持、before/after、各未実施検証を記録。reviewer 数や点数ではなく、**再現可能な指摘と、成果物で確かめた変化**を主要 evidence とする。

参考比較・制約は [Research: screenshot-driven review](./references/research.md) を参照。Experiment 1B（`#206` / `#210`）で Quality Floor 4 層分離と独立コールドレビューの必要性を検証し手順へ統合済みだが、Skill 全体の `stable` 昇格に向けた実プロジェクト継続 trial は **trial-pending**。単体 install でもこの手順を利用できる。
