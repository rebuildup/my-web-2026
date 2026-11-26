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

## 18. 視覚主導への設計転換（2026-11-25、ユーザー受入不合格を受けた再設計）

候補 `5132ce10` はユーザーの視覚的受入で**不合格**。根本原因は
実装の巧拙ではなく、レビュー基準と情報設計の双方が
「テキストをSVGに埋め込むこと・カード化・bento配置」を
視覚化と誤認していたことにある。

### 根本要求（再確認・正本化）

- 文字を順番に読まなくても、情報の概要・関係性・重要度が
  伝わる構成であること。
- ステータス・活動の種類は視覚的に識別できること。
- 進行中プロジェクトの関係性・活動の変化は文字列列挙ではなく
  視覚表現で伝えること。
- GitHub 活動・ストリーク・指標はデータの意味に適した表現を持つ。
- アイコン・形状・色・配置・動きには情報伝達上の役割がある。
- テキストは固有名詞・数値・補足に限定する。
- 情報量を減らして見かけを取り繕わない。既存機能は維持する。

### レビュー基準の改訂

従来 spec（可読性・余白・整列・コントラスト中心）は
「情報がテキスト主体でないか」「視覚要素が情報の意味を担うか」
「一見で概要と重要度が把握できるか」を評価項目に含んでいなかった。
`.tmp/review-specs/profile-v13-proto.md` で M1–M7 の必須評価
（text-dependence / visual semantics / glance test / hierarchy /
honesty+legibility / GitHub fitness / improvement vs current）を
定義し、以後の全レビューで必須化する。

### プロトタイプ比較と採用判断（agy review v13）

実データ（D1 snapshot・presence・stats・streak・top-langs・roster）
を使い 3 案を生成・比較レビュー。結果 **A+B ハイブリッド採用**:

- **Band 1（Identity + Vitals + Focus）**: プロトタイプ A の
  vitals エンコーディング（streak 炎・言語比率バー・貢献 repo
  ドット・rank リング）+ C の editorial な identity ヘッダ。
  Focus は monogram/空リング/偽リンクを廃し、ドメイン意味を持つ
  グリフと weight/状態の正直な符号化による視覚マップへ。
- **Band 2（Repo Activity + 72h Pulse）**: プロトタイプ B の
  活動分解（30日 repo output + 72時間イベントパルス）。
  isotype は固定単位 + 凡例、パルスは now=右の一貫軸・
  イベント種別ダイヤモンド凡例・private 集約行を必須化。
- 単一 800×400 への詰め込み（A単体）・機能欠落（B単体）・
  情報削除による「すっきり」（C）はいずれも棄却。

証跡: `.tmp/profile-proto/`（gen.mjs・SVG×3・スクリーンショット）、
`agent review` JSON（conversationId 44538df8、verdict:
request-changes → ADVANCE A+B hybrid 指示）。

### 実装方針

- 2つのモジュラー SVG アセット（unboxed band）+ light/dark
  `<picture>` ペア + mobile 積み上げ variant。
- 全エンコーディングは線形・正直（比率・個数・時間軸方向）。
- Selected Work の showcase.webp は別系統として維持
  （main/sub/decor 要求は変更なし）。

### プロトタイプ反復と最終判定（2026-11-25）

採用方向を 2-band 構成（Band1: Identity+Vitals+Focus /
Band2: RepoActivity+72hPulse、各 800w desktop + 560w mobile、
dark/light）で精緻化し、agy レビューを v14→v19 まで反復。
主な収束内容:

- v14: 4件目 focus project 欠落・下端クリップ・列衝突・
  ラベル truncate・JST/UTC 不整合・mobile 42-dot 行を修正
- v15→v16: contributed ラベル/weight バー/凡例の衝突、
  72h チャートの右端クリップと mobile 空チャート
  （**根本原因: shape 生成関数の戻り値を `s` に append
  していない実装バグ**）、イベント種別 shape 凡例欠落、
  mobile の PR 指標・言語%・rank tier 削除、dark コントラスト
- v17→v18: desktop PR square/count 衝突（列再配分）、
  mobile PR square の大小逆転（cap 統一 + 'scaled' 正直表記）、
  72h 凡例とプロット領域の分離、weight 凡例復活
  （ヘッダ行右端）、言語 swatch 復活

**最終判定: agy review v19 = APPROVE**（conversationId
481030a2、verdict approve）。Band1/Band2 × dark/light ×
desktop/mobile の全組合せで M1–M7 MET、ブロッカー 0。
残存は ultra-minor 2件のみ（mobile 'day streak' の
字下げ、desktop 'of A+ tier' の折返し）— 非ブロッキング。

証跡: `docs/verification/github-profile/v11/`
（spec v13–v19、agy review JSON×7、承認済み生成器
`proto-gen6-approved.mjs`、v6b desk/mob webp）。
プロトタイプ SVG 実体は `.tmp/profile-proto/`。

### 実装への引き継ぎ

- レイアウト・座標・エンコーディングは
  `proto-gen6-approved.mjs` が正本。実装時はデータ源を
  ハードコードから実バインディング（github-readme-stats
  系・activity feed・presence・roster）へ差し替える。
- 既存 `/now` `/activity` `/current` 等のカード群は
  本バンド資産に置き換えるか併存させるかを Issue #1216
  で確定する（README 構成とあわせて判断）。

### 実装結果（2026-11-25）

- `src/http/github-profile/bands.ts` を新設。承認済み
  `proto-gen6-approved.mjs` のレイアウト・座標・エンコーディングを
  実データへ移植: `composeProfileCardModel` + `NowStats`
  （streak/top-langs/stats）+ `PROJECT_ROSTER` +
  `GitHubActivitySnapshotBody`（repos/feed/sources）を入力とする
  純粋モデル `buildBandsModel`/`composeBand1Model`/`composeBand2Model`
  と SVG レンダラ `renderBand1Svg`/`renderBand2Svg`。
- エンドポイント: `/api/v1/github-profile/identity`（Band1、
  800×360 / mobile 560）と `/api/v1/github-profile/activity-map`
  （Band2、800×340 / mobile 560）。`?theme=dark|light`、
  `?layout=mobile`。
- 72h パルスの x 軸 'now' は**観測時刻（snapshot observedAt）に
  アンカー**する。描画時刻ではなく観測時刻を右端に置くことで、
  未観測の空白期間を活動ゼロと偽らない（impl review v1 で検出・修正）。
- PR square は `ceil(prs/100)` cap 4・凡例 '■ ≈100 PRs' で
  単調性を保証（集約行が上位 repo を視覚的に追い越す逆転を解消）。
- presence が stale/unavailable の場合は橙ドット +
  'Discord stale' 等の正直な状態表示（'on Discord' と偽らない）。
- commit ドットの不透明度下限を引き上げ、集約行でも判読可能に。
- mobile の IN PROGRESS 行に tier pip（13×5）を復活、
  CONTRIBUTED TO はヘッダに総数・右下に '+N over'/'all time'。
- 既存 `/now` `/activity` `/current` `/presence` `/status` `/card`
  は残置（段階移行）。README ドラフトは `/identity` +
  `/activity-map` へ差し替え済み（`.tmp/rebuildup-profile/README.md`、
  `<picture>` は `max-width` × `prefers-color-scheme` の
  compound media で 4 象限を切替、light desktop を img fallback）。

### 実装レビュー（agy、M1–M7）

- impl v1（`.tmp/review-specs/bands-impl-v1.md`）: major 3・minor 2
  → 上記の通り全て修正。
- impl v2（`.tmp/review-specs/bands-impl-v2.md`、証跡
  `.tmp/profile-proto/review-impl2/`、agy-review
  `dc6c72ec`）: **APPROVE、ブロッカー 0**。全 8 領域
  （desk/mob × dark/light）で M1–M7 MET。

### 全体レビュー指摘への対応（2026-11-26、round 3–4）

マージ後の全体レビュー（pre-refresh / 前候補 5132ce10 /
現行 3c8f95ce の同条件比較）で REQUEST CHANGES となった
指摘を、bands.ts の round 3–4 で解消した。

- **mobile 可読性**: モバイル canvas を 560→**400px** に変更し、
  全タイポグラフィ・シェイプ・余白を 390px viewport 前提で
  再設計（band1 580h / band2 660h、vitals 2×2 カード化、
  streak 23px / repo名 13px）。
- **REPO OUTPUT エンコーディング**: commit dots を**比例バー**
  （トラック+塗り、凡例に最大値明示）へ置換。PR square は
  バー終端/トラック直後の固定カラムに移し、単位を適応化
  （`prUnitFor`: 最大行がトラックを埋める単位を算出、凡例に
  '■ ≈N PRs' を明記）。集約行（'+N more public'、
  'private repos · sum'）も同一バーで dim 描画し、
  非表示だった ~40% の 30d 出力を可視化。
- **focus マップ**: デスクトップは左端 'you' ハブ＋水平レール上の
  ノード配置（roster が宣言する関係＝SELF への spoke のみ。
  project 間の関係は捏造しない）。レールは最終ノードで終端。
- **不足メトリクス**: streak セルに '· best NNNd'（longest
  streak）、rank セルに 'NN,NNN all-time'（total contributions）
  を追加。mobile も同様。
- **CONTRIBUTED TO**: ドットの不透明度二重基準（24個明るい/
  残り dim）を廃止し全ドット均一化。'+N over' のみが
  オーバーフローを伝える。
- **72h パルス**: recent events の bullet をチャートと同一の
  per-type シェイプに統一。イベントシェイプを軸基線の上に
  クランプ。mobile のセクション間余白を拡大。
- **構造リファクタ**: 4 レンダラに重複していた
  theme→palette 解決を `skinFor()` に集約（責務境界:
  palette解決 / モデル合成 / SVG描画）。機械的分割は行わず、
  単一 obligation（github-profile bands）内の責務整理に留めた。

レビュー証跡: impl v3（REQUEST CHANGES、major 3 → 全修正）、
impl v4（**APPROVE、ブロッカー 0**、info 2件のみ）。
`docs/verification/github-profile/v11/` に spec・agy JSON を保存。

## 19. 第3フェーズ: アイコン実素材化とレーン型スタック（2026-11-26）

PR #1231 マージ後のユーザー却下（テキスト依存・嘘データ・汎用
ダッシュボード化・mobile 縦長）を受け、第3の再設計を実施した。
agy 独立デザインレビュー（design-review-v9〜v13、証跡
`docs/verification/github-profile/v12/`）で **v13 APPROVE** に到達。

### ユーザー指摘と対応

- **アイコンの文字代用・自作パス禁止**: 自作炎・`r` イニシャル・
  `ROSTER_GLYPH` を全廃。全アイコンは `public/github-profile/skills/`
  の Simple Icons / skill-icons 系 SVG（正規化 256 viewBox）を
  `scripts/build-github-profile-stack-icons.mjs` でキュレート・
  インライン化（`stack-icons.ts`、31 アイコン）。炎は Lucide `flame`。
- **Discord ステータスの模式的再現**: 「Discord」文字+色丸を廃止し、
  アバター右下のリング付きステータスドット（Discord UI 準拠:
  online=緑 filled / idle=黄 / dnd=赤 / offline=灰 hollow ring）+
  Discord ロゴ + ステータス語の1行プレゼンスに再構成。データ取得
  成功とオンライン状態を分離し、stale 時は 'Discord stale' と正直表示。
- **In Progress 虚偽表示の廃止**: 固定 roster / ハードコード文言を
  削除。実データ（GitHub 最新イベント・repo 出力・observed 時刻）に
  紐づく表現のみ残し、測れないものは描かない。
- **スタック縦幅圧縮**: 中央揃え多段羅列を廃止し、カテゴリレーン
  （Design & motion / Languages / Frameworks & runtimes /
  Infra & dev tools）+ デスクトップ 2×2 グリッド + mobile 縦積み。
  chip サイズで階層を表現（craft 40px / substrate 28px、
  mobile 42/30px）。

### agy レビュー推移（design review、実装適合とは別工程）

| round | verdict | 主な指摘→対応 |
|---|---|---|
| v9 | REQUEST CHANGES | Discord status 分断・meta 伸縮・rank% 自虐 stat・Band2 トラック誤読 |
| v10 | REQUEST CHANGES | アイコン位置の font-metric 推定誤差（gulf が左に移動）・metaGrid 右揃え段差 |
| v11 | REQUEST CHANGES | metaGrid 列位置・Discord 右端短fall・Band2 余白・モバイルリズム |
| v12 | REQUEST CHANGES | React アイコン黒 fill（stroke path に fill 未指定→SVG 既定黒）・行トラッキング gulf・dim 行の列揃え |
| v13 | **APPROVE** | minor polish のみ（Total 行の右列化・Band3 ヘッダ罫線・Discord ~15px・middot 間隔） |

設計上の学び: SVG テキストの前方要素配置は **textWidth 推定に依存
しない左アンカー構成**（アイコンは常にテキスト開始の固定オフセット）
が衝突を構造的に排除する。幅推定は「クラスタ全体の開始位置」決定に
のみ使い、要素間の相対位置には使わない。

### 残る minor polish（APPROVE 後の任意改善、次候補で検討）

- Band2 Total 行を commits|PRs 右列に揃える
- Band3 ヘッダ下の罫線（Band2 との構造対称）
- Discord クラスタ右端 ~14-18px の微調整
- Band2 event 行の repo 名↔middot 間隔の微差
- Band1 'BEST 206D' → 'PERSONAL BEST' 等の自然文言

## 20. 設計基盤フェーズ: レイアウト契約の先行構築（2026-11-26、Issue #1235）

PR #1233 マージ後のユーザー却下を受け、局所座標調整を打ち切り
「構造として設計されていない」ことを根本原因として扱う再設計。
ブランチ `1235-profile-layout-foundation`。

### 根本要求（正本化）

- 個別 SVG 生成関数が独立した座標・文字サイズ・余白を決める方式を
  廃止し、プロフィール全体に適用される**共通設計契約**を先に構築
  する。数値の定数化や均等グリッド化は設計システムとみなさない。
- 契約の構成要素: カラムグリッド/ガター/外周余白、ベースライング
  リッド、スペーシングスケール、タイポグラフィスケール（行高・
  ウェイト）、アイコンサイズと光学的整列、情報階層とモジュール構成
  規則、レスポンシブ再構成、モーションと時間的構成規則。
- 既存 `src/editorial/` の規則を活用し、汎用フレームワークは新設
  しない。GitHub 実表示サイズ（~800px / ~400px CSS 幅）で可読性を
  評価し、極小文字による情報詰め込みを禁止する。
- README 本体の見出し・余白・画像幅も設計対象に含める。

### 設計契約モジュール `design.ts`

`src/http/github-profile/design.ts` が契約の実装:

- `canvasSpec(mobile)` — デスクトップ 800px/外周 24/12 カラム/
  ガター 16、モバイル 400px/外周 16/6 カラム/ガター 12、
  ベースライン 4px。
- `gridX`/`gridRight`/`contentWidth`/`colWidth` — 全要素の水平
  配置はカラム境界から導出。`snap` でベースラインへ丸め。
- `SPACE` — editorial spacing トークンの SVG 内射影
  （s1=4/s2=8/s4=16/s6=24/s10=40）。ページ間のビートは README
  markdown 側の責務。
- `TYPE` — サイズではなく**役割**で定義（display/hero/title/
  body/data/meta 等）。`bandText` が全テキストを役割経由で描画
  （11px 下限）。
- `ICON` — アイコンサイズ階梯と `iconCenterY` による光学的整列。
- `MOTION.marqueeSpeed`/`marqueePeriod` — SMIL マーキーの速度と
  周期の規則。
- `gridOverlay(spec,height)` — `?grid=1` で赤ガイド+タイプ凡例を
  重畳する検証モード（ルータで identity/activity-map/stack に配線）。

### 各バンドの再構成

- **Identity（Band1）**: avatar+Discord リングドットの統合カード、
  focal stats（streak/contributions）と totals grid、言語シェア
  ピル、全モジュールが gridX/snap/TYPE を経由。高さは内容から算出
  （固定高さ定数を廃止）。
- **Activity（Band2）**: REPO OUTPUT テーブル（名前+コミット比例
  バー+件数列、集約行は脚注）、LAST 72 HOURS パルス（観測時刻
  アンカー、JST 表記）、RECENT EVENTS リスト（同一 repo ランの
  グループ化、tspan フローで衝突回避）。72h グラフと集約行は
  ユーザー指摘により復活・是正済み。
- **Stack**: 48 アイコン全件を 4 カテゴリレーン
  （Design & motion / Languages / Web & app frameworks /
  Infra & dev tools）に再編。各レーンは `<symbol>`+`<use>` で
  アイコンを1回だけ定義し、複製トラックを SMIL
  `animateTransform` で右→左にシームレスループ。レーン高は
  内容から算出（デスクトップ 332px / モバイル 368px）。GitHub の
  `<img>` 埋め込みでは CSS アニメーションと script が無効なため
  SMIL を採用。エッジフェードで視覚的な抜けを防止。

### 検証方法

- `?grid=1` オーバーレイ付き SVG と通常 SVG を全バリアント
  （3 バンド × 2 テーマ × desktop/mobile）でレンダリング。
- agy 独立デザインレビュー（実装適合とは別工程、全体構図と
  造形品質を評価）を `.tmp/review-specs/design-foundation-v1.md`
  で実施。証跡は `docs/verification/github-profile/` に PNG/WebP
  としてコミット（`.tmp`・トンネル非依存で第三者が確認可能）。

## 21. 全体構図の再設計（Issue #1235 round 2、2026-11-26）

v14（§20）の agy APPROVE は受入判定としない。コミット済み v14
証跡（全ページ・個別資産・グリッド付き PNG）を人間が直接確認した
結果、個別 SVG の整列は達成されたが**縦積み構成そのもの**が不合格
と判定された。本節はその指摘を正本へ反映する。

### 不合格の構造的原因

3 つの独立 SVG（identity / activity-map / stack）を README で縦に
積む構成は、各資産が別ページとして完結するため「貼り合わせ」に
なり、プロフィール全体の構図・視覚的重心・資産間の関係が存在
しない。`design.ts` のグリッドは個別資産の座標計算にのみ使われ、
全体構図には適用されていなかった。

### 新しい設計方針

- **単一の構成済みプロフィール SVG**（`/github-profile/profile`）
  に Identity・GitHub Activity・Stack の 3 セクションを 1 キャン
  バスへ統合する。セクション境界・共通スパイン・モジュール階層を
  グリッド契約から導出し、「縦積み」をやめる。旧 3 エンドポイントは
  互換のため残すが README は使わない。
- **Stack は 4 レーン前提を廃止**。48 技術全件を維持したまま 2 レーン
  のマーキーへ再編し、実測高さを旧静的版（desktop 235px / mobile
  365px）以下にする。高さ削減など定量要求は変更前後を実測する。
- **README 本体も設計対象**: 見出し・リンク・外周余白・画像幅・
  資産間リズムを一つの左スパインに揃える。Selected Work のサブ作
  品リンクは中央揃え羅列をやめ、左揃えの構造化リストにする。
- **Selected Work**: `showcase.webp` に light バリアントを追加し
  `<picture>` でテーマ追従。サブ作品の視認性とカード構造の単調
  さを見直す。
- レビューは agy APPROVE を受入判定とせず、今回の具体的指摘
  （アバター重複、Totals 窮屈、PR テキスト依存、パルスの弱さ、
  イベント極小文字、mobile 縦占有、リンク羅列等）を基準に反復
  する。

### 実測ベースライン（v14 = 049b7dff、2026-11-26 計測）

| 資産 | desktop | mobile |
|---|---|---|
| identity | 316px | 408px |
| activity-map | 468px | 672px |
| stack | 284px | 368px |
| **SVG 合計** | **1068px** | **1448px** |

Stack の旧静的版は desktop 235px / mobile 365px — マーキー化で
高さが増えており、これは定量的に不合格。

## 22. v0.15.0 共通設計契約: プロフィール全体の構図（Issue #1240 / #1241、2026-11-26）

v0.14.0 公開版を before 基準とし、#1240（`/profile` SVG）と #1241
（README Selected Work）が**独立した画面設計を行わない**ための共通
契約。個別資産の座標調整ではなく、ページ全体の構図・色面・情報階層・
資産境界を先に固定する。実装はこの契約の各条項に対応する。

### ページ構成（上から順）

1. 導入 chrome（tagline + リンク）— GitHub markdown 側の余白は制御
   不能なので、契約が決めるのは**資産の順序・画像幅・リスト構造**
   のみ。
2. `## Selected work` — `showcase.webp` をヒーロー媒体、サブ作品は
   構造化インデックス（#1241）。
3. `/profile` SVG — ページを閉じるデータプレート。内部順は
   Identity masthead → ACTIVITY → STACK の 3 ゾーン固定。

### 色面（surface）の三層

- **PAGE**: GitHub の markdown 面。SVG/画像がその上に載る。
- **PLATE**: `/profile` SVG が塗る全面背景 rect — ページ内で唯一の
  全面色面であり、「プロフィールのプレート」として機能する。
  内部モジュールに追加の面（panel）は敷かない — 面を増やすと
  貼り合わせ感が戻る。
- **MEDIA**: `showcase.webp` / works カバー — 内容を持つ画像。
  `<picture>` でテーマ追従（#1242 で light バリアント）。

### 情報階層（プレート内部）

- **H0 display**: セクションヘッドのみ。Identity masthead は
  ヘッドを持たない（それ自体が頭）。`GITHUB ACTIVITY` / `STACK`
  の 2 つだけ。
- **H1 title**: セクション内モジュールヘッド（`REPO OUTPUT` /
  `LAST 72 HOURS` / `RECENT EVENTS`）。
- **無ラベル state**: Identity ゾーンの VITALS / TOP LANGUAGES は
  モジュールヘッドを**持たない**。アイコン + 数値 + 言語バーは
  自己説明的であり、ラベルを外すことがテキスト依存の削減そのもの。
  standalone `/identity` バンドも同一構成を描く（ unlabeled state
  は単体でも自己説明的）。
- **body/strong/data/label/caption**: 既存 TYPE ロールをそのまま使用。

### 構図ルール

- **2 カラム・マストヘッド**（desktop）: 左列（cols 0–5）に
  アバター + 名前 + tagline + Discord presence を縦積み、右列
  （cols 6–11）に VITALS 3列×2行グリッド。全幅の横積みストリップを
  やめ、左右の図と地を作る。モバイルは 6 カラムの再グリッドで
  縦積みを維持（縮小ではなく再配置）。
- **縦予算（実測目標）**: `/profile` desktop ≤ 950px（現行 1092）、
  mobile ≤ 1180px（現行 1368）。
- **Stack レーン分類**: `Design & web` / `Languages & infra` は
  実内容と不一致（nodejs/dotnet/vercel が design 側、vscode/
  markdown/notion が languages 側）。実態に合わせ `Design & media`
  / `Code & platform` に再編し、全 48 アイコンを維持する。
- **モーション**: SMIL マーキー（STACK）と animated WebP
  （showcase）の 2 系統のみ。新規アニメーションは追加しない。
- **資産境界**: README は見出し・順序・リスト構造、SVG はプレート
  内部、WebP は媒体 — いずれも共通の左スパイン思想（GitHub 本文
  カラム内での左揃え）を共有し、SVG 内部は 12/6 カラム契約を継続。

### 検証

- 変更前後を同条件で実測（SVG 高さ・セクション占有）。
- before 基準: v0.14.0 公開版 `.tmp/v16-baseline/`（8 枚の実画面
  PNG + 4 SVG + showcase.webp）。証跡は `docs/verification/
  github-profile/` へコミット。
- レビューは最新全ページレンダリング + 実アニメーションを対象とし、
  過去の APPROVE を品質保証として引き継がない。
