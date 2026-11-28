# サイト全体デザインコンセプト — 2026-11-28（Issue #1293 / Epic #1266）

入力: `docs/verification/design/site-audit-2026-11-28.md`（全ページ監査）、composition-model/v1、73 件の art-director review、agy 独立レビュー、実在サイト調査（Brittany Chiang / Rauno Freiberg / Paco Coursey）。

## 0. テーゼ

**このサイトは「作品の目録」ではなく「編集された記録」である。**

現状の最大の問題は部品の欠陥ではなく、**優先順位の逆転**にある:訪問者（採用担当）が最初に知りたい「この人は何を作れるか」の証拠が、サイト案内・状態ダッシュボード・広告・法律文の奥に埋まっている。74 件の作品・15 の tool・独自 design system という資産は十分にあるが、**選択と編集がない**ため全てが等価に見える。

ビジュアル言語（MONOCHROME/SIGNAL、paper ground、分類 field tone、golden-ratio rhythm、Zen Kaku Gothic + Noto Sans JP）は既に独自性を持ち、Paco Coursey / Rauno Freiberg 系の「静かな職人性」スクールに位置する — 一般的な就活テンプレートとは別の方向で正しい。**言語は維持し、構成と編集を変える。**

## 1. 検討した構成案

### 案 A — 「証拠先行 / Selected Works first」（採用）

home を「 positioning statement → 厳選作品 → 現在地 → 探索 → 状態 → 連絡」の読み順に再構成。portfolio index に featured band + facet 別セクションを導入。全ページに「entry hero → 証拠 → 文脈 → closing CTA」の共通リズムを敷く。

- 長所: 監査の全所見（優先順位逆転・等質グリッド・dead-end・legal 挿入位置）を構造で解決。既存の field.* tone と facet の対応で IA と視覚が一致する
- 短所: home/portfolio の大規模再構成が必要

### 案 B — 「index/ledger としての徹底」（不採用）

サイト全体を番号付き目録・帳簿として統一し、display tier と罫線で編集的緊張を作る案。about の TOC 的構造を全ページに拡張。

- 長所: mono 言語との親和性が高い、実装量が相対的に小さい
- 不採用理由: 監査が示す問題（作品証拠の埋没・メディア不在・等質カード）は解決しない。ledger 化は「更にテキスト化」を招き、stack/dotfiles で既に指摘された text-first の問題を全サイトに拡大する

### 案 C — 「case-study magazine」（不採用）

各 project を長文エッセイとして再編集し、home は magazine 的 hero + 記事導線にする案。

- 長所: portfolio detail の質を上げられる
- 不採用理由: 74 件のコンテンツ再編集は現実的でなく、採用担当のスキャン行動（数十秒で判断）に逆らう。detail ページの部分適用に留める

## 2. サイト全体 IA（改訂案）

```
/            home — positioning → selected works → now → explore → status → contact
/portfolio   index — hero → selected band → facet sections (design/develop/video) → full index
/portfolio/$slug — case study（現行を基盤に evidence/next 導線を強化）
/about       identity narrative（skills 統合・future 日付の分離・sticky TOC）
/now         enumeration（group 構造を維持しつつ媒体・重複整理）
/stack       工程の物語（spec dump を畳み、decision-first に再編集）
/activity    年別 timeline（placeholder 除去・媒体導線）
/tools       index + 15 host（カテゴリ tag・hero の重複 inventory 撤去）
/links /contact /keyboard /projects/dotfiles /commission /design-system — 個別方針はページ別 Issue
```

グローバルナビは現行 3 項目（Tools/Portfolio/About）を維持。footer が全ページの closing を担う現行構造を保ちつつ、**各ページ本文の末尾にも「次の一手」（contact / 関連 project / index）を置く** — dead-end をなくす。

## 3. グリッドと構成の方針

- 12-track coordinate grid（`Grid template="12"` + `GridItem`）を hero・feature・index の主要構成に積極使用。現状は Split(4/12+8/12) 中心で、非対称の使い方が限定的
- hero は原則「copy cluster（左 4–5 track）+ media/証拠（右 7–8 track）」の Split。media を持たないページは typographic hero（大きな display + meta 列）で緩急をつける
- index/一覧は preset Grid（3–5 列）を維持するが、**featured band は全幅・大媒体**で通常グリッドと明確に差別化する
- rhythm: `hero`/`body`/`feature`/`closing` の役割体系を維持。連続 feature は review finding のまま。ページ末尾に `closing` 相当の CTA 帯を各ページが持つ

## 4. 色面・書体・階層

- token / semantic layer は**変更しない**（mono ground + field.* tone + golden-ratio type/spacing は監査で「独自性あり」と評価）。変更は構成側
- `field.*` tone を IA に接続: portfolio の facet section を `field.design` / `field.code`(develop) / tool(field.tool) の tone で分類表示 — 「色が分類を意味する」契約を index でも実演する
- display tier（4xl=64px）を hero とページ級の節目に限定的に使用。現状は Footer 装飾のみ — hero の positioning statement での使用を検討
- hierarchy は font-size 差だけでなく面積・位置・media で作る（composition-review §3）

## 5. キュレーション機構（データ管理の再設計）

`pinned` flag の有無を制約にしない。**committed editorial selection** を導入する:

- `src/portfolio/selected.ts`（仮）— owner が repo 内で編集する slug リスト。`PROJECT_ROSTER`（home/current）と同じ「committed artefact」パターン。Notion 書き込み不要・レビュー可能・版管理される
- portfolio index: selected band（最大 ~6）→ facet 別 section → 全件 index
- home: Selected Works section が同じ selection を読む（home は curated entrance、index は全件 — C-8 と整合）
- 選定基準の初期案: cover media あり + case study 本文あり + facet バランス。最終 slug は owner 確認（コンテンツの taste 判断は承認境界）
- `NO MEDIA` カードは index では「media 未整備」として区別表示するか、selected band からは除外。placeholder が未完成品に見える問題を構造で解消

## 6. ページ別方針（要約、詳細は個別 Issue）

| route | 方針 |
|---|---|
| `/` | hero 強化（positioning を display で）→ Selected Works（媒体大）→ Now 圧縮 → Explore 削減 or 統合 → Status を 1 row に圧縮 or 後方へ → Contact。広告は named slot のまま最小限 |
| `/portfolio` | selected band + facet sections + 全件 index。NO MEDIA の扱いを規定 |
| `/about` | skills を project 文脈に統合、career の未来日付を Goals へ分離、sticky TOC 検討、末尾 legal を footer へ |
| `/now` | group 構造維持 + 媒体/重複整理 + page variant に rhythm 付与 |
| `/stack` | decision-first 再編集（spec dump を Disclosure/別節へ） |
| `/activity` | placeholder 除去・年別 rhythm・媒体導線 |
| `/tools` | hero inventory 重複撤去・カテゴリ tag |
| `/contact` `/links` `/keyboard` `/projects/dotfiles` `/commission` `/design-system` | 個別 Issue で監査所見を反映 |

## 7. デザインシステムへの影響

- `editorial` の token/primitive 追加は最小限: FeaturedWorkCard 相当の L2 component、facet→tone マッピング、closing CTA 帯の primitive が必要になる可能性
- composition-contract / ui-contract への影響: 「selected band」「facet section」は新しい構成語彙 → contract 改訂または page-level 実装で済むかを実装時に判定
- 品質契約（#1128 系）: CL ルールは現状維持。監査で「契約が測らない次元」（hierarchy/distinctiveness/curation）をレビュー観点に追加することを #1292 の成果として提案済み

## 8. Owner 判断が必要な点

1. **selected works の slug 確定**（taste 判断・Notion 不要の committed file で実施）
2. home の Status セクションの扱い（圧縮/後方移動/現状維持）— サイトの「生きている感」を残すかどうか
3. `/design-system` の公開継続と分量（specimen として残すか圧縮するか）
4. 既存 PR #1281–#1285 の扱い（再設計に吸収される部分は close、本当に独立な改善のみ残す）

## 9. 評価計画

- 実装後: 同一 capture matrix で before/after を取得し、同一 art-director prompt で再レビュー。外部基準（Brittany Chiang / Paco Coursey 系）との比較を review spec に明記
- 合格条件: home/portfolio で「作品証拠が第一印象」を art-director が確認、NO MEDIA/等質グリッド/dead-end の指摘が解消、mobile の scroll 長が有意に短縮
