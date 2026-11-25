# GitHub プロフィール README デザイン記録（Issue #1196 / rebuildup/rebuildup#5）

v0.11.3 の単一カード構成（ADR-0024）を撤回し、`github.com/rebuildup`
の README 全体をセクション構造で再設計した記録。配信側の契約は
`docs/adr/ADR-0025-github-profile-assets.md`、旧カードの契約は
ADR-0024（deprecated）が正本。

## 1. 媒体としての制約（GitHub README の実測に基づく）

- カスタム CSS・`style` 属性・`class` はサニタイズされる。使える
  レイアウト手段は Markdown・`<img width>`・`<table>`・
  `<div align>`・`<sub>` 程度。
- 画像は Camo プロキシ経由の `<img>` として配信される。SVG を
  `<img>` で読む場合、外部サブリソースも data URI 以外の参照も
  読めない（ADR-0024 §2.1）。
- `<table>` はモバイルで縮まず、セル内画像は `width="100%"` で
  セル幅に追随する。列数を増やすほどモバイルのサムネイルは小さく
  なる — 「作品を十分な大きさで見せる」要求と直接トレードオフ。
- Pinned repositories と Contribution Graph は GitHub 標準で
  README の下に自動表示される。README 側で repo 一覧や草を
  再現すると重複になるため、README は「人物・作品・現在」の
  3 役割に絞る。

## 2. 検討した構造案

実素材（公開 portfolio の isCover ラスタ、最大 1200px WebP
~10–120KB/枚）を使い、GitHub が実際に受け付けるマークアップだけで
4 案を作成し、デスクトップ（830px）・モバイル（360px）で実
レンダリングした。スクリーンショットは
`docs/verification/github-profile/` に保存。

| 案 | 構造 | 画像数 | desk 高さ | mob 高さ | 評価 |
| --- | --- | --- | --- | --- | --- |
| A `a-grid` | hero 2 枚 + 4 列モザイク + Now | 7 | 772px | 506px | コンパクトだがモバイルで 4 列サムネイルが ~80px と小さく作品の訴求が弱い |
| B `b-index` | 縦リスト型（サムネイル+テキスト行） | 7 | 652px | 1276px | 一覧性は高いがモバイルで縦に伸び、作品が「行」になりビジュアルの主役にならない |
| C `c-hero` | 大 hero + カテゴリ別 4 列 ×2 + Now | 10 | 1056px | 653px | 媒体別分類は分かりやすいが画像 10 枚で転送量最大、AE ツールの正方形カバーを 4/3 に潰す構図が作品の個性を損なう |
| D `d-final` | hero 1 枚 + 4 列モザイク + Now | 6 | 969px | 635px | A の改良。hero で主従を作ったが 4 列のモバイル問題は残る |
| **E `e-final`（採用）** | hero 1 枚 + 2×2 グリッド + Now | 6 | 1467px | 835px | 作品が desk ~400px / mob ~160px と十分な大きさ。情報密度より作品の見せ方を優先 |

### 採用案 E の構成

```
After Effects tools · Web apps · Motion design
Website · Booth · X dev · X design          ← 最小リンク行

## Selected work
  ┌──────────────────────────────────────┐
  │  hero: my-web-2025（中央、幅720px）    │
  │  + 作品名キャプション（個別リンク）     │
  └──────────────────────────────────────┘
  ┌─────────┬─────────┐
  │multislicer│ seishun │   ← 2×2、各作品が個別リンク
  ├─────────┼─────────┤
  │kosen-fes│pomodoroom│
  └─────────┴─────────┘
  <sub>全作品 → rebuildup.dev/portfolio</sub>

## Now
  <status strip: GitHub activity + Discord presence>
```

## 3. 採用判断の根拠

- **作品の主役化**: 要求の中心は「実際の制作実績を一目で」。
  A/D の 4 列モザイクはデスクトップでは成立するが、GitHub
  プロフィールの主要流入であるモバイルで ~80px まで縮み、
  作品の視覚的個性（映像作品の構図、Web アプリの画面）が
  失われる。E の 2×2 はモバイルでも ~160px を確保する。
- **hero の役割**: `my-web-2025`（このサイト自身）を hero に
  置くのは「何を作っている人か」の最短回答になる。映像作品
  （seishun）は grid で十分な大きさを持つ。
- **B を退けた理由**: テキストリストは CV 的で分かりやすいが、
  「ビジュアルデザインから再構築」の要求に対し作品画像が
  従属要素に留まる。モバイル高さも最大。
- **C を退けた理由**: 10 枚は Camo フェッチ数・転送量ともに
  最大で、カテゴリ分け（Tools & apps / Motion & web）の境界が
  実際の作品分類（AE ツール・Web アプリ・映像・Web デザイン）
  と一致せず、かえって探しにくい。
- **転送量**: E の作品画像は最適化 WebP 5 枚で計 ~250KB、
  status SVG は ~5KB。旧カード 1.23MB より 1/5 以下。

## 4. 作品選定

`src/http/github-profile/works.json` が正本。選定基準:

- 公開 portfolio（published + public）に実在し、isCover の
  ラスタメディアを持つこと
- 媒体の多様性: Web プラットフォーム（hero）/ AE ツール /
  映像作品 / Web デザイン / Web アプリ
- 商用・顧客案件は公開面で既に公開済みのもののみ

`FEATURED_SLUGS`（model.ts、旧カード用）とは独立。旧カードは
deprecated のため選定を共有しない。

## 5. 動的ステータスの分離

作品画像（静的・ほぼ不変）と GitHub activity / Discord presence
（数分〜15 分鮮度）は更新頻度が異なるため、`Now` セクションに
独立した SVG（`GET /api/v1/github-profile/status`、数 KB・
ラスタなし）を置く。画像内に観測時刻を描く契約は ADR-0024 から
継承し、stale / unavailable を偽装しない。

## 6. 残課題・運用

- 作品の増減は `works.json` + `build-github-profile-works.mjs`
  の再生成 + README の表更新で行う（runbook 参照）。
- 掲載作品と portfolio 公開状態の整合は `works.test.ts` が
  fail-closed で検証する。
- Camo のキャッシュ特性・実画面検証はリリース後に
  `docs/runbook/github-profile-card.md` の手順で実測する。

## 7. v2 再設計（Issue #1204 / #1205 / rebuildup/rebuildup#8）

v0.13.0 の「hero + 2×2 グリッド + status」は、Selected Work の
縦占有・status の視認性・テキスト主体の自己紹介が課題となり、
rebuildup/rebuildup#8 のレビューで**単一リール構成をベースに全面
再設計**が決定した（案Bの2×2アニメタイルは不採用）。

- **作品リール**: `reel.webp`（animated WebP 560×315@4fps）1本が
  5作品の公開 YouTube 映像を巡回。縦横比は crop/blur 構図で吸収、
  先頭フレーム輝度ゲートでローディング/暗転を排除。GIF 比較は
  約1.7倍の容量で WebP 採用。生成は `profile:reel:build`、
  公開境界は snapshot の published+public 解決で fail-closed。
- **スキルアイコン**: tandpfun/skill-icons（MIT）を自前ホストの
  静的 SVG として配信（描画システムは自作しない）。
- **統合 now**: `/api/v1/github-profile/now` が contributions /
  streak / top language / activity / Discord を1枚の SVG に統合。
  カード4枚の横並びは不採用。`/status` は互換のため残す。

## 8. v3 全面再設計（rebuildup/rebuildup#8、ADR-0026）

v2（リール + 8 アイコン + 統合 `/now`）は不採用。旧 STATUS のグラフ・動き・
独立更新を回復しつつ、ゼロから再設計した。

- **作品**: 単一リールを廃止し、`clips/<slug>.webp` の animated WebP
  タイル 9 点を 3 列グリッドで同時視認。Web アプリ・AE ツール・
  ツール・映像・UI の領域を混在させた。全フレーム輝度ゲート付き。
- **活動**: `/api/v1/github-profile/activity` がリポジトリ別活動バー +
  公開 feed を 1 枚の SVG で返す。時刻は Asia/Tokyo、観測スタンプは UTC。
- **Presence**: `/api/v1/github-profile/presence` が独立チップを返す。
  activity と別レスポンス・別キャッシュ。
- **スタック**: 旧 48 技術ツリーを起点に 48 技術の light/dark アイコン。
- **比較**: A=3×3 グリッド + 活動カード案を採用（B=スポットライト案は
  1 作品への偏りで不採用）。デスクトップ/モバイル・ライト/ダークの
  実レンダリング比較は `.tmp/profile-design/` のモックと
  `shots/` スクリーンショット、および本節のプロトタイプ評価を参照。

## 9. v3.1 修正（2026-11-24、レビュー指摘対応）

- **Selected Work**: 3×3 クリップグリッドは「動く一覧」であり要求の
  スライドショーではないとして不採用。`showcase.webp`（480×680 縦
  マーキー、6fps・18秒ループ・約2.9MB）に変更 — 作品タイルが
  セル状に常時上スクロールし、複数作品が常に同時視認・静止
  フレームなし・シームレスループ。個別リンクは README の
  テキスト一覧が担う。
- **Activity**: バーが events・見出しが commits だった意味論不一致を
  `EVENTS BY REPOSITORY` に修正。観測スタンプも JST に統一
  （presence チップ同様）。
- **スキル照合**: 旧 48 技術（my-web-2025 `skillRows`）と掲載アイコンを
  全件照合した結果、48 技術すべてが対応アイコンとして存在する
  （`C#`→`csharp`、`C++`→`cpp`、`Go`→`golang`、`tailwind css`→`tailwind`、
  `Adobe XD`→`xd` 等の命名差のみで欠落なし）。使用実績は my-web-2026 の
  依存関係と portfolio `technologies` メタデータと照合済み。
- **証跡**: レンダリング結果とレビュー用フレームを
  `docs/verification/github-profile/v4/` にコミットし PR から参照可能にする。

## 10. v3.2 修正（2026-11-24、レビュー第2弾対応・Issue #1214）

縦マーキー（v3.1）も「均一タイルの単調スクロール」として不採用。
横長・高さ抑制の **シーン構成モーションコラージュ** へ再設計した。

- **比較**: 実素材のプロトタイプ2案（A=常時ドリフトコラージュ、
  B=シーン構図+斜めマスク遷移）を生成・比較し B を採用。
  証跡は `docs/verification/github-profile/v5/`。
- **採用構成**: `showcase.webp`（800×360@8fps、約21秒、約2.9MB）。
  4 シーン + ループバックを斜めワイプ（xfade diagtl/diagbr/
  diagtr/diagbl 巡回）で接続。シーンごとに hero/脇役のサイズ・
  構図・尺が異なり（hero+脇役、左右分割、3作品トリオ、全高
  hero+脇役）、hero は Ken Burns push-in、脇役は位相の異なる
  正弦ドリフト。ループ継ぎ目は先頭/末尾の背景色 bookend フェード
  で構造的にシームレス化。
- **定義**: `showcase.json` を schema v2（scenes/items/wipes/
  loopBack）へ更新。生成は `profile:showcase:build`、
  `--review` で全編サンプルフレームを書き出せる。

## 11. v3.3 設計意図の修正（2026-11-24、レビュー第3弾・Issue #1214 継続）

v3.2 シーンコラージュも未受入。**表現手段（コラージュ・横スクロール・
斜めマスク・同時複数表示）を目的と混同していた**ことが根本原因。
設計意図を main/sub/decor のモーションデザインへ修正した（ADR-0026 §2.3）。

- **メイン**: その瞬間の主役。視線の中心。
- **サブ**: メインを補完する作品・ディテール。競合しない。
- **装飾**: 視線誘導・空間構成・場面転換を支える。

要素ごとの個別動作割当ではなく、構図・視線・動きの因果・時間展開を
一体設計。作品の常時複数表示は要件ではない。横長・低占有面積は維持。

- **視覚レビュー**: `agent review run`（dotfiles の vision 対応
  ハーネス）への委譲を必須化。輝度計測・ASCII マップは補助証跡で
  あり美的検証の代替にしない。
- **成果物**: 公開前プレビュー（プロフィール全体・ステータス拡大・
  showcase 実アニメ・desktop/mobile・light/dark）を `docs/verification/`
  に残す。
- **プロフィール全体監査**: 進行中プロジェクト表示とステータスの
  直感的アイコン表現のギャップを Issue #1216 として起票。

## 12. v4 実装（2026-11-24、main/sub/decor リレー）

v3.3 の設計意図を実装に落とした。`showcase.json` を schema v3
（`acts`/`slots`/`transition`/`fade`/`breathing`/`drift`）へ更新し、
`build-github-profile-showcase.mjs` を単一パスの合成へ書き換えた。

- **構図**: メイン 520×293 中央 + サブ 190×107 を3枠（次主役
  プレビュー・直前主役・コンテキスト脇役）+ 装飾レイヤー
  （サブ枠パネル・メイン枠線 PNG）。
- **リレー**: 5 act（prototype → flashbeat → foldlayers → homura →
  multislicer が順に主役、尺 6.0/5.0/5.5/6.0/5.5 秒で不均一。
  kosen の PV は動きのある区間が約 3 秒しかなく長い主役時間に
  向かないため脇役/ドックに回し、終幕は連続した画面収録の
  multislicer が務める）。PREVIEW
  は常に次 act の MAIN、PREV は直前 act の MAIN を指し、折り返し
  でも連鎖が一貫する。act 境界 0.75 秒の smoothstep で役割の変わる
  全要素がスロット間を移動し、移動は境界時刻に完了 — 次主役が
  プレビュー枠から拡大、退く主役がサブへ縮小する因果的受け渡し。
  act 順は素材のフリーズ区間（freezedetect 実測: kosen 16.5–19.6s、
  foldlayers 15.9–18.1s）を主役時間に重ねないよう配置。
  作品は 8 点（tegaki は素材が 1.46 秒・大半白紙の GIF のみで
  展示に耐えないため v5 レビューを受けて除外）。
- **ドック**: 役割を持たない作品は右下ドック（2×2・44×25、
  下部に配置し上部遷移経路と分離）へ退避。スロットは作品ごとに
  安定割当で毎 act の並び替えをしない。ドック背面に半透明
  プレート（fill+border）を敷き、全要素より先に描画する
  （通過中のカードはプレートの上を渡る）。
- **装飾モーション**: 全編 28 秒周期の緩やかな呼吸スケール
  （要素ごと位相差）+ 役割比例ドリフト（サブ ~3px、メイン 0）。
  サブ/ドックは役割スケール比例で減光（床 0.32・sub≒0.45）＋
  彩度 0.75＋18% 白リム（暗い UI を背景から分離）。素材ごとの
  `grade` 輝度イコライザ（暗い UI を持ち上げ・白飛び素材を抑える）
  を主役/サブ両方に適用する。
- **ループ**: 配置復帰のトランジションは bookend フェード開始前に
  完了し、先頭/末尾 0.35 秒の背景フェードで継ぎ目を構造的に
  シームレス化。要素は素材窓（既定は取得した全区間）を
  `elementSeconds` までループ再生する。
- **素材補正**: `clips.json` の各クリップに `crop`（レターボックス
  除去）・`offset`+`trim`（窓切り出し）・`segments`（区間連結で
  内部の白フラッシュ等を除去）・`grade`（輝度個別グレード、
  kosen=0.72）を許可。multislicer は 1.7–2.4s の白フラッシュを
  `segments` で除去して 7.0s を採用、kosen はソース末尾の
  フリーズ end-card と静止区間を `offset:0.3`+`trim:2.7` で
  切り出す。
- **合成**: フレームごとに sharp で決定的に合成（ffmpeg overlay の
  framesync が可変サイズストリームでフレームを誤ペアする問題を
  回避）。角丸マスク・役割比例ディム＋彩度低下・面積順 z-order・
  主役追従のアクセント枠をフレームごとに描画。
- **出力**: 800×360@8fps・224 フレーム。PNG シーケンスを
  img2webp（q70・sharp_yuv）で直接 animated WebP 化
  （ffmpeg→GIF 経路の 256 色ポスタリズムを解消）。輝度ゲート通過、
  `agent review run` によるフレーム列レビュー実施。
## 13. v4 リレー化とプロフィール全体収束（2026-11-24、Issue #1214 / #1216）

シーンコラージュ（v3.2）もレビューで「均一タイルの反復」と指摘され、
**メイン・サブ・装飾の3層リレー**へ再設計した（PR #1218）。
個別パラメータの調整ではなく遷移構造自体を見直し、作品の魅力が
伝わる構図（hero 大・脇役小・装飾は縁のアクセント）を優先した。

- **README 全体の収束**: ドラフトを
  `.tmp/rebuildup-profile/README.md` に確定。構成は
  タグライン+リンク → Selected work（showcase リレー）→ Now
  （`/current` 進行中カード + `/presence` Discord チップ）→
  GitHub activity（`/activity` + stats/top-langs/streak）→ Stack
  （48 技術のスキルアイコン、light/dark `<picture>` 対応）。
- **ステータス視覚の修正**（PR #1219）: `agent review run` の
  拡大カードレビューで検出した衝突・可読性問題を解消。
  `/activity` はパネル帯の再配置（ヒーロー数値とセクションラベルの
  衝突、行ピッチ、JST コンパクト表記、イベント種別グリフ、
  public/private の表記分離）、`/current` は行メトリクスの
  weight → 実測 → 更新日の優先順位と weight 色バレット、
  `/presence` は last seen のコントラスト向上。
- **github-readme-stats のアニメーション無効化**: stats /
  top-langs / streak カードは CSS キーフレームで `opacity: 0`
  開始するため、SVG を `<img>` として消費する環境（GitHub/camo
  含む）で行が不可視になり得る。パーソナル固定配信
  （Issue #1164）の方針に合わせ `disable_animations` を常時有効化し、
  streak-card にも同等オプションを追加した。
- **証跡**: `docs/verification/github-profile/v7/` — 全体
  レンダリング（desk/mob × light/dark）、拡大カード、
  showcase リレー動画（showcase-relay.mp4）、agent review JSON。

### 残存指摘と判断

- **モバイルでの SVG 縮小**: 840px カードが 390px viewport で
  約45%に縮み文字が小さくなるのは GitHub README の `<img>` 制約で
  あり、カード分割やフォント縮小では解決しない。→ §14 で
  `<picture><source media>` によるモバイル専用バリアントを導入し
  解消した。
- **stats/top-langs/streak の白テーマ**: カードは light 固定で
  カスタム暗色カードと色調が異なる。`<picture>` によるテーマ
  出し分けは query param が personal-fixed で無視されるため
  現状不可。暗色テーマ統一は別 Issue 候補。
- **current カードの weight ラベル**: weight level は
  `home/current/roster.ts` の手書き facts が公開された時のみ
  表示される（現行 roster は未公開）。メトリクスは実測値で
  代替表示しており、嘘をつかない設計を優先した。
- **フィード行の同一 PR 複数イベント**: `ref.state`
  （open/closed/merged）をラベルに含めて区別可能にしたが、
  同一 state の連続イベント（例: commented 連発）は snapshot の
  契約上これ以上区別できない。

## 14. 全体構成の作り直しとモバイルバリアント（2026-11-24、rebuildup/rebuildup#8 継続）

ユーザー指摘「無駄に縦長・横長で全体として綺麗に見えない」を受け、
カードの単純な縦積みをやめて構成自体を再設計した。カードを
そのまま並べるのではなく、要素をページ全体の中で組み合わせる
方針に転換し、既存の統合エンドポイント `/now`（stats + activity
+ presence + DECLARED FOCUS を 1 枚に描く SVG）を主役に据えた。

### `/now` の再構成（800×512）

従来は 680×700 で lifetime stats が上半分を占め「今」を埋めて
いた。ライブステータス優先のベンツォに組み替えた:

- 上段: GITHUB ACTIVITY（全幅・最新公開イベント + repo 活動数）
- 中段: DISCORD presence と DECLARED FOCUS を左右に並置
- 下段: contributions / streak / top language の 4 セルを
  コンパクト 1 行に集約

あわせて JST 表記への統一（`/activity` とタイムゾーンを一致）、
`PullRequestEvent` 等の生イベント名の人間可読化
（`friendlyEventType`）、全カードの角丸 + 1px `panelStroke`
（ダークモードでの輪郭確保）を行った。

### `/activity` の改善

- 左パネルを PAD マージンに揃え、右パネルとの左右対称を確保
- フィード行のタイムスタンプを 2 行目に下げ、ラベルが全幅を
  使えるようにして `Issue #158 ·…` 型の途切れを解消
- 同一 repo+type+ref の連続イベント（PR の open/close が数秒差で
  2 件出る GitHub 仕様）を最新 1 件に dedupe
- private repo 集計行を `(aggregated):` 表記 + 11px フットノート化
  してパネル内 overflow を解消
- repo 行ピッチ 30→32px、バーと次行アイコンの干渉を解消

### モバイルバリアント（`?layout=mobile` + `<picture>`）

§13 で「README 媒体制約上不可能」と記録したモバイル専用
レイアウトは、`<picture><source media="(max-width: 767px)">`
で実現できることが判明し導入した。`/now` と `/activity` の
両方が 560px 幅の積み上げ型 SVG を `?layout=mobile` で返す:

- `/now` mobile: GITHUB ACTIVITY → DISCORD → DECLARED FOCUS を
  全幅で縦積み、stats は 2×2 グリッド。狭いパネルでは冗長な
  補足コピー（`(activity, not projects)`、二重タイムスタンプ）を
  省略して中途半端な省略記号を防ぐ
- `/activity` mobile: EVENTS BY REPOSITORY と RECENT ACTIVITY を
  全幅パネルで縦積み。0 イベント repo は高さ節約のため除外、
  フッター下余白を拡大

### レビュー結果

`agent review run` を 4 ラウンド実施（v9 request-changes → v10
request-changes → v11 request-changes → **v12 approve**）。
全 11 件の前回指摘 + 4 件の追加修正が desk/mob × light/dark で
検証済み。残存は polish 級のみ: フィード最終行タイムスタンプと
パネルフッターの間隔、mobile の muted メタ文字サイズ、
repo 件数表示の desktop/mobile 差、Selected work WebP の
角丸なし（ラスタ資産の別パイプライン）、Stack の孤立アイコン。

- **証跡**: `docs/verification/github-profile/v8/` — 全体
  レンダリング 4 枚、モバイル activity 拡大、agent review JSON
  4 件（v9–v12）、preview-index.html。

## 15. Selected Work ドック遷移の収束試行（2026-11-24、Issue #1214 継続）

公開前収束で Selected Work の残存指摘（遷移中のドックプレート
周辺の衝突・滞留・デッドスペース）に対し、モーションと z-order
の両面から 9 ラウンドの `agent review run` を実施した。

### 採用した変更

- `transition` 0.75s → 1.0s、works ごとの出発 stagger 拡大
- park 行きカードの scale 早期縮小を 0.8s 前倒し（プレート到達
  時に必ずサムネイルサイズ）
- protagonist の z-order / アクセントボーダー移管を遷移終盤
  62% 地点へ
- 減光フロア 0.32 → 0.38、リム 0.18 → 0.26
- ドックプレートは全カードより下に固定（occlusion 変種は全て
  「消える/切れる」系の退行を生んだため撤去）

### 残存指摘（受理判断の記録）

- 遷移中 ~1s の intra-dock カード通過衝突（park スロット間の
  直進経路が駐機サムネイルと一時的に重なる）。スロット経路の
  再設計が必要な構造課題で、パラメータ調整では解消しない
- 遷移途中の一時的デッドスペース（Act 1→2 / 4→5）、極暗
  ソースコマの 350px での沈み込み、WebP 暗部ゴースト
- settled act・主役ハンドオフ・350px 可読性は全ラウンドで
  高評価。v6 以降の ACCEPT WITH FIXES 系譜と同水準であり、
  公開 README 切替時の実画面目視を最終確認とする

### 証跡

`docs/verification/github-profile/v9/` — agy review JSON 9 件、
遷移フレーム 12 枚、レビュー記録 md。

### GitHub/Camo・データ検証の整理（公開前収束）

- `<picture><source media="(max-width: 767px)" srcset>` は
  GitHub 公式ドキュメントおよび第三者実測でサニタイズ許可が
  確認済み（`media` 属性自体は値を問わず許可、メディアクエリは
  ブラウザ評価）。`srcset` の絶対 URL は Camo プロキシ対象、
  仮にプロキシされなくても rebuildup.dev への直接参照で成立。
  最悪ケースは `<img>` フォールバックによる desktop 表示で、
  graceful degradation する。100% の確定は公開 README での
  実測待ち（承認境界）。
- SVG カード（`/api/v1/github-profile/*`）は既存の
  github-readme-stats 系と同じ Camo 経路で実績あり。
- animated WebP（showcase.webp）は `data-animated-image` 対象外
  でも WebP アニメーションは GitHub で再生される（img タグ経由）。
- 検証データ: ローカル `pnpm dev` は **seeded D1**
  （`.tmp/d1state/v3` + `.tmp/seed-d1.mjs` で activity/presence
  スナップショットを注入）。**実データ検証は未実施** —
  `pnpm dev:production-data`（`MY_WEB_2026_DATA_SOURCE=
  production-readonly` + remote bindings）は `wrangler login`
  が必要で、現在未認証のため operator 作業待ち。非公開データの
  公開境界は seeded 検証で維持。

## 16. Selected Work 構造再設計（2026-11-24、第2次収束）

v9 までのドック・スロット・主役リレー方式は、遷移中のドック内
衝突・滞留・デッドスペースをパラメータ調整では解消できなかった
ため、要求の意味的構造（メイン=主役 / サブ=文脈 / 装飾=縁取り）
に立ち返って再設計した。

### 構造変更

- **ドック撤去**: `slots.parks` を空にし、役割を持たない作品は
  `off`（画面外）へ。2x2 ドックプレートと occlusion 分岐を全廃。
- **off は「移動」ではなく「出現/消滅」**: `off` を端点に持つ
  遷移では、入場側は目的スロットへ不可視のままスナップしてから
  alpha フェードイン、退場側は現スロットでフェードアウト後に
  不可視で退避。**キャンバスを横断する移動はゼロ**となり、
  エッジでのクリップ・角丸なし切れ端は構造上発生しない。
- **alpha 実装**: sharp `modulate()` に alpha チャンネルは無い
  ため、uniform-alpha の `dest-in` マスクを追加適用
  （`alphaMask()`、accent frame にも同じフェードを適用）。
- **homura クリップ**: 元映像が静止イラスト中心の歌ってみた
  MV で、モーションは 1 秒級のバーストのみ。`segments`
  [[4,5.5],[6.3,7.8],[20,21.5]] でモーション区間のみを連結し
  常時動画が流れるよう再構成（作品の内容上の限界として記録）。

### レビュー結果（agy、v10〜v19）

- v12/v13: エッジクリッピングが残存（alpha 未適用だったため
  `modulate({alpha})` が no-op だったことが判明 → dest-in 修正）
- v14: **クリッピング系 defect ゼロ**を確認。残存 major は
  homura の静止映像のみ
- v15〜v19: homura を segments でモーション区間に限定。
  v19 verdict: **ACCEPT WITH FIXES**
  - 構造的条件は全フレーム PASS（クリップ無し・角丸維持・
    横断移動無し・dissolve/materialize 滑らか・因果的ハンドオフ）
  - major 残存: Act の静止区間が残る（映像ソースの内容限界。
    パラメータではこれ以上改善不能）
  - minor: BR デッドスペース恒常化・暗いサブのコントラスト・
    WebP 暗部マクロブロック・主役ボーダーの白背景での視認性

### #1216 コンテンツ改善（同リリース同梱）

- `roster.ts` に `weightLevel` を記述（my-web-2026=primary /
  ai-coding-agent=active / tastile=side / after-effects=side）。
  `/current` カードと `/now` DECLARED FOCUS の両方に反映。
- `statusJa` を内部構造の説明ではなく現在の活動が直感的に
  分かる表現へ書き換え（「〜を再構築中」「〜を開発中」等、
  進行形で統一）。

### 実データ検証（新規）

- Infisical prod の `CLOUDFLARE_D1_API_TOKEN`（スコープ付き
  API トークン、wrangler login 不要の正規経路）で本番 D1 の
  `github_activity_snapshot` / `discord_presence_snapshot` を
  読み取り、ローカル seeded D1 に投入して実データでカードを
  検証済み。非公開データ境界は維持（読み取りのみ）。

### GitHub/Camo 実レンダリング検証

- `docs/verification/github-profile/camo-render-test.md` に
  README ドラフトと同一の `<picture>/<source media>` 構文を
  配置。github.com の blob ビューでサニタイズ後の実レンダリング
  を確認するためのプローブ（公開プロフィールは不変）。

## 17. Selected Work 仕上げ反復（2026-11-25、第3次収束）

v19 以降の残存指摘（z-order ハンドオフ・デッドスペース・
WebP ghosting・白背景でのボーダー視認性・サブカードの
テキスト欠け）に対し、agy レビュー v20〜v26 の 7 ラウンドで
収束させた。

### 採用した変更

- **主役ハンドオフを時間基準へ**: `progActIndex()` を新設し、
  各 act 境界の **0.8 秒前**に incoming hero へ z-top +
  アクセントボーダーを移管（境界またぎのカード経路交差
  より前）。ボーダーの alpha はカードに追従するため、
  早期フリップでも半透明カードに枠だけ浮かない。
- **空きコーナーの全面ローテーション**: `VACANT_ORDER`
  [TL,TR,BR,TL,TR] で 4 スロット全てを巡回。BL は全 act で
  常に充填され、Act4 の空きが BR×暗い TR と重なる不均衡も
  解消（v23 指摘）。
- **サブカードの内側シーム vignette**: 主役カードに隠れる
  内側エッジへ向かう暗いグラデーション（帯域 w*0.55 /
  h*0.5、プラトー型 opacity 0.88）。hero の縁で切れる
  テキストが「断ち切り」に見えず奥行きとして読める。
  **罠**: sharp の `composite()` は先行 composite を置き換える
  ため、vignette は mask/rim と同一 ops 配列の先頭に置く
  必要がある（v21〜v24 は別呼び出しで毎回消えていた）。
  さらにハンドオフ中は slotOf 上まだ sub の incoming hero
  にも vignette が掛かるため `p.slug !== protagonistSlug`
  で除外（v25 の major regression を修正）。
- **アクセントボーダー強化**: 3px ストローク
  `rgba(140,188,246,0.78)` + 5px 暗色キーラインで、
  Act5 の白系グリッドや Act2 の黄カードでも 350px で視認。
- **WebP 圧縮**: quality 80、`-m 6`、`-kmin 8 -kmax 12`
  （全 act 遷移内にキーフレームが落ちる頻度）、サブの
  alpha 描画フロア 0.08。`-near_lossless` は高負荷下で
  エンコードが現実的時間に収まらず断念（検証済み: フラグ
  自体は受理される）。
- **aulymo-v02 grade 1.6→1.8**: Act2 BR の暗い UI クリップの
  潰れ込みを軽減。

### レビュー結果（agy、v20〜v26）

- v20: request-changes — サブテキスト欠け・Act4→5 z-order
  逆転（サイズ基準ハンドオフが outgoing 優位を継続）
- v21: request-changes — vignette 追加も効かず（後に
  composite 置換バグと判明）、z-order/border は改善
- v22: request-changes — 全 major 解消、残り minor のみ
  （vignette のシーム側・帯域・WebP ghosting・Act4 右側の
  不均衡）
- v23: request-changes — vignette の上下辺を修正するも
  帯域が min(w,h) 基準でシームに届かず、Act4→5 で
  vignette が incoming hero を半分黒くする regression
- v24: request-changes — 帯域を w/h 基準に修正・空き
  コーナー再編・alpha フロア 0.08。vignette は依然
  別 composite で消失（実効ゼロ）
- v25: request-changes — vignette を ops 内へ移し実効化。
  ただし incoming hero への誤適用が major regression
  として顕在化
- v26（PNG フレーム、圧縮前）: **APPROVE (ACCEPT)** —
  全 major 解消。残存は minor polish のみ:
  - サブ役のテキスト入りクリップ区間（FoldLayers 等）を
    sub 配置時に選ぶと mid-word 欠けが更に減る（コンテンツ
    改善、構造問題ではない）
  - Act2 BR・Act5 TL の暗いサブの視認性（クリップ輝度
    選定または dim floor 調整）
  - t≈21.75 の遷移中に全コーナーが一瞬空く beats
    （Act1→2 より sub materialize を ~0.25s 早めると揃う）
  - WebP 圧縮アーティファクトはエンコード後の最終
    showcase.webp で別途確認
