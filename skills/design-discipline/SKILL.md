---
name: design-discipline
description: >
  Use before generating or substantially redesigning a 2D visual artifact, UI, graphic, document,
  or motion piece. Reconstructs meaning independently of input-spec structure, selects honest
  visual/interactive media over prose defaults, composes text and visuals as shared spatial form,
  explores off-default options by making, and validates delivered outcomes without adding fixed
  ceremony to narrow fixes.
---

# Design Discipline

**Design は仕様書・素材・内部データ構造をそのまま視覚化する作業ではない。** 与えられた項目をカードや既定テンプレートへ写して表層を磨くだけでは、基礎品質を満たしても意図のない成果物になる。

> Purpose → Reconstruct → Represent → Compose → Explore by making → Express → Verify experience

これは固定の工程表でも必須テンプレートでもない。変えるべきは **レイアウトとコンポーネントを決める前に、意味の再構成・表現媒体・空間構造・結果を左右する判断を下すこと** である。魅力や適切さを「AI っぽさの排除」やカード枚数・美観スコアへ還元しない。

## 1. Break input-spec transcription and template anchoring

入力文書の見出しや箇条書き構造を、そのまま画面構造へ転写しない。実験（Exp 0 / 1A）でも、仕様書に「N 個の機能」「M ステップ」とあるだけで同数のカード列へ直列化される強い傾向が確認されている。

- **事実不変条件と入力形式を分離する**: 必須の事実・数値・機能・制約（Must）だけを抽出し、仕様書の見出し数・番号リスト・表の並びはいったん解体する
- **既定連想を疑う**:
  - 機能 6 個 → 同じ形のカード 6 個、とは限らない（中核の操作デモや構成図へ統合・埋め込みできる）
  - 手順 4 個 → 同型ステップカード 4 枚、とは限らない（実コマンドの流れや実行結果へ統合できる）
  - 製品紹介 → ダーク系 Hero / 機能グリッド / 3 列価格 / CTA、とは限らない
  - DB / 組織構造 → ナビゲーション / IA、とは限らない
- **禁止ルールにしない**: カード・文章・単列・標準 UI 自体は欠陥ではない。目的に対する根拠があれば採用し、無自覚な既定形への流用だけを避ける
- **狭小修正・承認済み仕様の再現では再設計しない**: 方向が確定している精密修正やテキスト主体画面の軽微修正では、目的・構造を勝手に組み替えない

## 2. Establish purpose and audience situation

実際の依頼、製品、既存素材・コード・観察事実を読む。**誰がどんな状況で触れ／見るのか、何を理解・比較・判断・操作・感じる必要があるのか** を特定する。

- 明示要件、客観的制約、仮説を区別し、架空のペルソナ調査や根拠のない実績数値を捏造しない
- 具体的な閲覧・利用場面（viewing / decision situation）を最低 1 つ置き、設計上の帰結を確認する
- 感情・視覚的発見・余韻が目的の作品を、無理に作業効率や CVR へ言い換えない

## 3. Reconstruct meaning independently of spec order

情報を仕様書順ではなく **受け手の理解・意思決定・体験の順序** で選び直す（例: 課題と実物証明 → 仕組みの納得 → 性能・信頼根拠 → 導入判断）。

- **Must**: 欠けると意味・判断・機能・表現が成立しない核
- **Supporting**: 理解・比較・信頼・リズムを支える補助要素（主役へ統合・内包してよい）
- **Optional / remove**: 内部都合、重複、惰性、未検証の主張
- **Missing**: 必要だが未整備の材料。見た目で隠さず、確認・調査・制作（モデル表現等）を検討する

## 4. Choose representation media honestly

情報や体験に適した表現媒体を選ぶ。文章説明を既定値にしない。

- **実体と仕組みを見せる**: 操作環境・インタラクティブモデル・データフロー図・時系列・状態遷移・実寸比較など、視覚・操作媒体で直感的に伝わるものを文章へ退行させない
- **素材の扱い**: 新規・改修とも `Actual`（実物・実データ）、`Fixture`（管理済みサンプル）、`Model`（仕様に基づく模式表現）、`Prototype`（実行試作）、`Original`（自作図版）を許容する。サンプル・モデルを実測・実顧客実績として偽装しない
- **視覚的誠実性（Factual Visual Honesty）**: 数値のない項目に比例バー風の帯を描かない（例: メモリ未計測の比較対象に根拠のない部分幅バーを引く）。比較バーやグラフは共有スケール・正確な比率・範囲表現を守り、視覚量と数値ラベルを矛盾させない
- **テキスト主体の正当性を守る**: 技術仕様・ドキュメント・コード・ターミナル・表・設定フォームなど文章が主役であるべき場面に、無理な図表やカード装飾を足さない

## 5. Compose spatial structure — treat text as visual form

**情報の論理構造（意味）と空間構造（視覚）は同一ではない。** 見出し・本文・図解・操作面・余白を共通の視覚要素として扱い、関係と強弱で構図を組む（テキストの画像化やアクセシビリティ・選択・検索性の破壊は行わない）。

- **主従と配分**: 重要度の異なる情報へ同じ面積・同じ枠・同じ強調を与えない。主役（成果物・異常状態・核心の図解）へ視覚領域とコントラストを配分し、補助要素を従属させる
- **グリッドは共通座標系**: 均等分割の檻にせず、近接・類同・図と地・整列・余白のリズム・読み順で意味的関係を表現する
- **実画面で頻発する空間破綻を初回から防ぐ**:
  - 2 カラム（一覧＋詳細、図＋説明）の極端な高さ差による大きな空白死領域を避ける
  - 日本語・CJK 混在見出しの単語途中折返しや 1 文字孤立（例: `て。`、`を、`）を避け、幅・改行位置・`text-wrap` / `word-break` を意識する
  - 狭い画面幅（モバイル等）で、主要コマンドや重要ラベルが `overflow-x: auto` 等の局所コンテナ内で静かに見切れないよう折返し・縦積みで可視性を保つ

## 6. Explore off-default options by making, then commit

最初の案が「仕様順の標準コンポーネント化」や「参照例の表層模倣」に見える場合、言葉で比較して捨てず、安い実物（小規模 HTML/SVG/ワイヤー/1 枚レンダー）を作って比較する。色や角丸だけの違いは別案と数えない。

- 実物から見えた決定的な差・衝突に基づき、**何を主役に据え、構成・表現がどう変わるか** を根拠付きで決める（`clean` / `modern` 等の抽象語だけで正当化しない）
- 評価軸自体が分かれ、ブランドや方向性を大きく左右する選択だけ標準案と並べて人間へ提示する
- 狭小修正・承認済み仕様の再現・強い制約がある場合は探索を省略する。既存の延長にない発想自体が課題なら `idea-discovery` を使う

## 7. Express, verify experience, and keep boundaries clean

| 責務 | 担当 Skill | 境界 |
| --- | --- | --- |
| 目的・意味再構成・媒体選択・空間構図・実物探索（上流） | **`design-discipline`**（本 Skill） | 配置前の判断と体験整合。個別 token 値や詳細 lint を抱え込まない |
| 視覚方向・トーンの定義と `DESIGN-BRIEF.md` 永続化 | `design-intent` | 複数画面・継続案件で方向共有が必要なときだけ併用 |
| 完成画面の構図原則監査（Gestalt / CRAP / 余白 / 均衡） | `composition-review` | 実装・描画後の構造監査 |
| 実描画スクリーンショット検証・独立コールドレビュー | `visual-review` | **本 Skill は品質下限の検証や独立レビューを代替しない** |
| プロジェクト固有の品質ゲート・検証鮮度・handoff | `quality-gate` | DOM/機能/鮮度保証と実行境界 |
| 専門領域（文言・階層・図表・モーション・表層修理） | `content-design` / `visual-hierarchy` / domain Skills / [UI craft review](./references/ui-craft-review.md) | 意味や構造の誤りを表層 polish で隠さない |

成果物は必ず実レンダリング／再生で確認する。可能なら意図を伏せた独立レビューで初見理解（First encounter）と仕様適合（After reveal）を分けて確認し、自己検査のみの場合は「自己検査」と明示して独立確認と混同しない。意味・構成の欠陥は余白や装飾で誤魔化さず上流へ戻る。

## Proportionality and evidence

- 全タスクに新 brief・複数案・長大な手順を強制しない。小さな修正は既存意図との整合と最小差分を優先する
- **実証状況（v0.7.0 / 2026-11-27）**: 静止画 2D・Web UI 領域では `#170`（3 ジャンル＋反例 3–0–1）、`#205`（Experiment 1A: `gemini-4-neon-medium` / GPT-6 盲検 10 ペア、導入のみ 2–0・早期ルーティング 2–0・自己描画前の `first-write` 直接比較 2–0・狭小修正 2 行差分パス）、`#209`（`claude-sonnet-5-5-medium` / GPT-6 盲検 2 ペア、受動未起動 0/1 に対する早期ルーティング 2/2 起動、`v0.6.0` 比較で `first-write` 4 軸全勝・`final` 総合勝利）、および `project-init#129` の 4 ケース live dispatch（過剰発火・trigger 衝突なし）により有効性と適用境界を実証済み
- **未実証範囲（本リリース条件と分離して記録）**: 動画・モーション等の時間軸成果物での比較追試、および独立した人間評価者による校正は未実施（`unavailable / unexecuted`）であり、静止画 2D / UI の実証済み適用範囲とは明確に区別する

## Research references

- [Visual Design Capability — Concept and Research Direction](../../docs/research/visual-design-capability.md) — 意味と空間構造の分離、上限能力と品質下限の分離
- [Design Council — Double Diamond](https://www.designcouncil.org.uk/resources/the-double-diamond/) — 問題の捉え直しと探索（固定工程化しない）
- [Dow et al., Parallel Prototyping (2010)](https://doi.org/10.1145/1879831.1879836) — 初期案固定を避ける並行試作
- [Jansson & Smith, Design Fixation (1991)](https://doi.org/10.1016/0142-694X%2891%2990003-F) — 既定例への無自覚な固着の回避
- [NN/g — Aesthetic-Usability Effect](https://www.nngroup.com/articles/aesthetic-usability-effect/) — 視覚的魅力と機能評価の分離
- [Damir Sokolovsky — unslop](https://github.com/heydamir/unslop) (CC BY 4.0) — 現物監査と製品固有性の保持
