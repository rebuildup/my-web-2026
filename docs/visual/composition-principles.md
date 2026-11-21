# Composition principles — 検査対象・判定方法・例外の対応表

> ADR-0023（`docs/adr/ADR-0023-composition-lint-rendered-contract.md`）の
> 運用正本。一般的なデザイン原則ごとに「違反となる状態・検出可能な
> 特徴量・検出方法・正当な例外・誤検出の可能性・検証 fixture」を
> 対応付ける。機械可読な半分は `quality/composition-contract.json`。
>
> 原則の一般形は `rebuildup/design-skills` の `composition-review`
> Skill（design-skills#191）が正本。本書は my-web-2026 の公開面に
> 適用する具体的な判定対応表である。

## 1. 3 層の保証と保証範囲

| 層 | 実装 | 判定できるもの | 判定できないもの |
| --- | --- | --- | --- |
| L-A 静的 | `scripts/check-ui-contract.mjs`（C-1〜C-8） | 所有権・書き方の契約違反 | 構図の良否 |
| L-B レンダリング | `composition:lint`（collector + judge） | レンダリング結果として観測可能な構造的欠陥 | 美的判断・意図の妥当性 |
| L-C 視覚評価 | `composition-review` Skill + `ui-visual-review.md` | 文脈依存の評価・brand 適合 | 機械的再現性 |

**機械的に保証するのは L-B の Blocking Error のみ。** Warning は
L-C レビューの必須入力であり、merge は止めない。モデルによる視覚
評価を使う場合も「再現可能な機械的検査」とは別物として記録する。

## 2. 対応表

凡例 — 検出方法: `geometry` = DOM geometry / computed style、
`static` = ソース静的解析、`review` = 人間/モデル評価。
fixture: `quality/fixtures/composition-lint/` 配下の ID。

### Gestalt — Proximity / Similarity / Common region

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| 近接=関連、離隔=別個 | 全セクションが同一 tone・同一構成で、関連/非関連の区別が空間に現れない | section signature の一意性、tone 遷移の有無 | geometry (CL-1) | 意図的モノクロ設計（理由記録） | 中 — 統一感のあるミニマル設計を欠陥と誤認 | `negative/monotone-stack`, `positive/mono-editorial` |
| 類同=同種、反復=系列 | 同一構成のセクションが 3 連続しページに変化がない | 連続 signature run 長 | geometry (CL-2) | index route の時系列・一覧 | 低〜中 — 同形が意味を持つページ | `negative/repeated-structure`, `positive/list-with-rhythm` |
| 共通領域=グループ | パネル/カードの囲みが内容と無関係に増殖 | panel 密度、面積あたりの bordered 要素数 | geometry + review | 情報の塊を面で示す設計 | 中 — カード UI 自体は正当 | review 領分 |

### CRAP — Contrast / Repetition / Alignment / Proximity

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| Contrast（強調の対比） | 重要/補助の視覚的差がなく全要素が同じ重み | font-size 段差、面積支配、tone 対比 | geometry (CL-3, CL-9) | ユーティリティページ | 中 — tone 駆動の階層を見落とす | `negative/no-hierarchy`, `positive/clear-hierarchy` |
| Repetition（反復の一貫） | 同じ役割の要素が違う見た目で実装される | primitive 迂回・style literal 重複 | static (C-6, C-7) + review | 意図的な変奏 | 低 | 既存 ui-contract が担当 |
| Alignment（整列の共有軸） | 左端・右端が揃わず視線が迷う | alignment leftEdges クラスタ数 | geometry + review | breakout / overlap の意図的逸脱 | 中 — 非対称構図を誤認 | `positive/asymmetric-grid` |
| Proximity（近接の意味） | gap が全て同値で関連性を表現しない | section 内 gap の分散、rhythm role | geometry + review | 均等リズムが内容に合う場合 | 中 | review 領分 |

### Visual hierarchy / Emphasis / Focal point

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| 階層は複数チャネルの合成 | font-size だけが唯一の差別化手段 | type 段差 + 面積 + 面の対比の合成スコア | geometry (CL-3) | — | 中 | `negative/no-hierarchy` |
| Focal point が存在する | どのブロックも支配的でなく視線の入口がない | dominant block 面積比、display 型サイズ、tone 遷移 | geometry (CL-9) | diffuse が自然な utility 面 | 中 — 画像主役は CL-6 で別途計測 | `negative/no-focal`, `positive/anchored-hero` |

### Grid / Asymmetry / Composition

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| グリッドは座標系であり檻ではない | 等分トラックの反復のみで span/offset/breakout が皆無 | track 比率の分散、gridColumn span の使用 | geometry (CL-5) + static (C-4) | 等分が内容に合う index | 高 — warning 級 | `negative/uniform-grid`, `positive/asymmetric-grid` |
| 非対称には意図的根拠がある | ランダムなずれ・孤立要素 | alignment からの逸脱距離の分布 | review | — | 高 — 機械判定しない | review 領分 |

### Typography / Measure / Scale

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| Measure は読みやすさを守る | 本文カラムが極端に広い/狭い | contentWidth、行長推定 | geometry + review | display 面の意図的ワイド | 低 | review 領分（typesetting Skill と共有） |
| Scale に段差がある | 全テキストが同一サイズ級 | fontSizes 分布 | geometry (CL-3 の一部) | — | 低 | `negative/no-hierarchy` |

### Color / Surface composition / Contrast

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| 色面は分類か強調を担う | ≥4 セクションで非 ground tone が 0、または無意味な色面の増殖 | tone 分布、Panel variant 使用 | geometry (CL-8) + static (C-2, C-3) + review | 意図的モノクロ | 高 — warning 級 | `negative/no-tone-variation`, `positive/intentional-mono` |
| 面の対比がリズムを作る | 全セクション同一背景で境界がない | backgroundStep の遷移 | geometry | — | 中 | CL-1 に包含 |

### White space / Density / Rhythm

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| 空白は関係を表現する | 広い viewport で細い列+巨大な未活用領域 | viewport 内コンテンツ幅比、empty area 比 | geometry (CL-4) | 余白主体の意図的構図 | 中 — canonical measure 内の余白は契約どおり | `negative/narrow-column`, `positive/whitespace-led` |
| 密度は情報量に対応する | elementsPerPixel の極端な偏り | elementsPerPixel、セクション高さ分散 | geometry + review | — | 中 | review 領分 |
| リズムに変化がある | 全セクション同一 padding role | rhythm role 分布 | geometry（data-rhythm）+ review | 均一リズムが内容に合う | 中 | review 領分 |

### Image / Media / Art direction

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| メディアは主役として面積を持つ | mediaExpected route で mediaArea が閾値未満 | mediaArea/contentArea 比 | geometry (CL-6) | メディアを持たないコンテンツ | 低 | `negative/text-only-portfolio`, `positive/media-led-detail` |
| 画像と文字の関係が設計されている | テキストのみで作品を列挙（実素材の放棄） | media manifest ↔ 描画の対応 | static+geometry (#1134) | 素材が本当にない作品 | 低 | 同上 |
| crop / aspect / 読み順が適切 | 不自然なトリミング・アスペクト崩壊 | object-fit、aspect 比、配置 | review | — | 中 | review 領分 |

### Balance / Proportion / Visual weight

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| 視覚的重心が存在する | 支配ブロック・display 型・面対比が全て不在 | dominantArea、font ratio、tone 遷移 (CL-9) | geometry | diffuse が自然な面 | 中 | `negative/no-focal` |
| 重量配分が意味を持つ | 全ブロックが等重で釣り合いが「無個性」 | 重み分布の分散 | geometry + review | 対称が意図の設計 | 高 | review 領分 |

### Repetition / Variation / Unity

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| 反復は変化を伴う | 同一 signature の機械的反復 | signature run (CL-2) | geometry | 一覧の反復は正当 | 低〜中 | `negative/repeated-structure` |
| 統一は系の一部 | 同じ役割の要素が別実装 | primitive 使用・style 共有 (C-7) | static | — | 低 | 既存が担当 |

### Responsive composition

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| 構図は viewport で再編成される | desktop 多カラムが mobile で無変更の縦積みに退化 | desktop/mobile の構造差分、高さ伸長率 | geometry (CL-7) | 順序保存は a11y 要件 | 中 — warning 級 | `negative/mobile-naive-stack`, `positive/mobile-recomposed` |

### IA と視覚的表現の対応 / Accessibility・認知負荷

| 原則 | 違反状態 | 検出可能な特徴量 | 検出方法 | 正当な例外 | 誤検出の可能性 | fixture |
| --- | --- | --- | --- | --- | --- | --- |
| 情報構造が面積・位置・型に反映される | 補助情報が主情報と同じ視覚的重み | CL-3/CL-9 の副産物 | geometry | — | 中 | `negative/no-hierarchy` |
| 認知負荷を増やさない | 装飾的要素の増殖、意味不明な色面 | decorative 検出は review 領分 | review + static (C-2/C-3) | — | 高 | review 領分 |

## 3. fixture 規約

- `quality/fixtures/composition-lint/positive/<id>.json` — judge が
  PASS すべき構図モデル。原則上正当であること（それらしい画面
  ではなく、原則で説明できる画面）。
- `quality/fixtures/composition-lint/negative/<id>.json` — judge が
  想定ルールで FAIL すべき構図モデル。
- 実ページ fixture（Storybook story / HTML fixture）が必要な
  ルールは collector 経由の結合テストも持つ。
- fixture の追加は「実際に観測された欠陥」または「原則上明確な
  反例」に基づく。カバレッジ稼ぎの fixture は禁止。

## 4. 運用

- `pnpm run composition:lint`（#1133）で全対象 route を計測し、
  verdict を `.tmp/` + `docs/verification/design/` に残す。
- Blocking Error は merge を止める。Warning は
  `ui-visual-review.md` のレビュー必須入力。
- 例外は `composition-contract.json` の allowlists に理由・範囲・
  検証根拠つきで記録。安易な追加は禁止。
