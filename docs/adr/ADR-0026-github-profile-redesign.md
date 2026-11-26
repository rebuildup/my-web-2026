# ADR-0026: GitHub プロフィール全面再設計 — 分割 SVG・作品クリップ・JST 活動カード

- Status: Accepted (2026-11-24)
- Supersedes: ADR-0025 の「単一リール + 8 アイコン + 統合 `/now`」構成部分。
  ADR-0024（deprecated `/card`）と ADR-0025 の静的 works 資産・権利境界は継続有効。
- Issue: rebuildup/rebuildup#8, my-web-2026#1212, my-web-2026#1214

## 1. 背景

v0.13.x のプロフィール（`Stack / Selected Work / Now`）は次の理由で不採用となった。

- `/now` が stats・streak・top languages・activity・Discord を 1 枚の SVG に集約し、
  データごとの取得・キャッシュ・鮮度の独立性を失った。
- 時刻表示が UTC 固定で、閲覧者（オーナーの JST）にとって意味のある日付境界になっていない。
- スキルアイコンが旧サイトの 48 技術から根拠なく 8 技術へ縮小された。
- `reel.webp` は低解像度・低 fps のハードカットで、「複数作品を同時に見せる
  スライドショー」要求を満たさなかった。映像作品への偏りもあった。

## 2. 決定

### 2.1 動的データは関心ごとに分割する

| Endpoint | 内容 | データ源 | 鮮度 |
| --- | --- | --- | --- |
| `GET /api/v1/github-profile/activity` | リポジトリ別活動バー（イベント数）+ 公開 feed（JST 表示） | D1 `github_activity_snapshot` | snapshot 鮮度に従う |
| `GET /api/v1/github-profile/presence` | Discord presence チップ | D1 `discord_presence_snapshot` | 15 分 freshness |

`/now`・`/status`・`/card` は README が参照しなくなった時点で deprecated
シグナルを付し、撤去リリースで削除する。活動データと presence は別レスポンス・
別キャッシュ（`max-age=300`）とし、一方の stale が他方を止めない。

### 2.2 時刻は Asia/Tokyo で描く

feed 行・期間ラベル・観測スタンプ（`observedAt`）はすべて
`Asia/Tokyo`（UTC+9、DST なし）でレンダリングする — 利用者向け表示の
時刻契約を JST に統一する。UTC の観測値は payload 内部に保持し、
キャッシュされた画像を現在値と誤認させない契約（ADR-0024 §2.4）は
「観測済みである旨と時刻が画像に残る」ことで維持する。

### 2.3 Selected Work は main/sub/decor のモーションデザイン

**設計意図（第3弾レビューで確定）**: コラージュ・横スクロール・
斜めマスク・複数作品の同時表示は目的ではなく、必要に応じて選ぶ
表現手段にすぎない。求めるのは **メイン（その瞬間の主役）・
サブ（補完する情報・作品）・装飾（視線誘導・空間・場面転換を
支える要素）** の明確な関係で成立するモーションデザインである。
役割は時間軸上で変化してよいが、各場面で何を見せたいかが明確で
なければならない。要素ごとに個別の動きを割り当てるのではなく、
画面全体の構図・視線の流れ・動きの因果関係・時間的展開を
一体として設計する。作品の常時複数表示は要件ではなく、単独・
部分・補助の表示を作品特性に応じて使い分ける。横長で占有面積を
抑える制約は維持する。

`public/github-profile/showcase.webp` はこの意図に沿った
animated WebP とし、**メイン/サブ/装飾の役割が時間とともに
「渡される」リレー構成**を採る（v4）:

- `acts[]` が各 act の MAIN（中央ステージ）・PREVIEW（次の
  主役候補・上段サブ）・PREV（直前の主役・中段サブ）・
  CONTEXT（脇役・下段サブ）を定義する。act 尺は意図的に
  不均一で、主役の登場時間に緩急をつける。
- act 境界では、役割の変わる全要素が `transition` 秒の
  smoothstep でスロット間を移動し、移動は境界時刻に完了する
  （各 act は整った配置から始まる）。次の作品がプレビュー
  枠から拡大してメインへ「育ち」、退く作品がメインから
  サブへ「縮む」因果的な受け渡しであり、カットや一様な
  スクロールではない。PREVIEW/PREV の連鎖はループ折り返し
  まで一貫させ、最終 act の PREVIEW は先頭 act の MAIN を
  指す。
- 役割を持たない作品は右下のドックへ退避する。ドック
  スロットは作品ごとに安定割当（毎 act で並び替えない）。
- 全編を通して緩やかな「呼吸」スケール（要素ごとに位相を
  ずらす）と、役割に比例したドリフト（サブのみ微動、メイン
  は静止）を載せ、装飾レイヤー（サブ枠パネル・メイン枠線）
  が空間構成を支える。サブ/ドックは役割スケールに比例して
  減光・減彩する。
- 最終 act の配置復帰は bookend フェード開始前に完了させ、
  先頭/末尾の背景フェードでループの継ぎ目を構造的に
  シームレス化する（コンテンツ位相合わせに依存しない）。
- 素材側の個別補正として、出典クリップに任意の `crop`
  （レターボックス除去）・`offset`+`trim`（窓切り出し）・
  `segments`（区間連結：内部フラッシュ除去）・`grade`（輝度の
  個別グレード）を許可する。act の順序と素材窓は、freezedetect
  とフレーム統計の実測でフリーズ/空白区間を主役時間に
  重ねないよう配置する。

シーン定義は `src/http/github-profile/showcase.json`（schema
v3: canvas/slots/acts/transition/fade/breathing/drift）、
出典は `src/http/github-profile/clips.json`。出典は公開
portfolio スナップショットの `published + public` レコードに
限定（fail-closed）。要素は素材窓（既定は取得した全区間、
`offset`/`trim`/`segments` で調整可）を `elementSeconds` まで
ループ再生し、出力全域のサンプルフレームに輝度
ゲートをかけ、暗転・ローディングフレームをビルド時に拒否する。

経緯: 3×3 グリッド（v3）・縦マーキー（v3.1）・シーンコラージュ
（v3.2、800×360@8fps）はいずれもレビューで不採用となり、
プロトタイプ比較と視覚レビュー委譲（`agent review run`）を
経て main/sub/decor 設計へ再設計した（Issue #1214、
証跡 `docs/verification/github-profile/v5/` 以降）。
作品ごとの個別リンクは README 側のテキスト一覧が担う。

### 2.4 スキルアイコンは旧 48 技術を起点に再構成

`my-web-2025/src/app/about/data.ts` のスキルツリー（48 技術）を調査ベースライン
とし、現在も使用する技術を `tandpfun/skill-icons`（MIT）から
`public/github-profile/skills/` へ light/dark バリアント付きで配信する。
件数の削減は「現在使っていないものを外した」根拠に基づき、無根拠の縮小はしない。

## 3. 結果

- 活動の可視化: リポジトリ別バー・feed・private 集約・JST 時刻・観測スタンプ。
- 更新独立性: activity / presence / 静的クリップ / 静的アイコンが別経路。
- 作品: 8 領域（Web アプリ・ゲーム・AE ツール・映像・
  開発ツール）を main/sub/decor のリレーで順に主役化し、
  役割の受け渡しを因果的なスロット移動で表現。
  （tegaki-anime は公開素材が 1.46 秒・大半白紙の GIF のみで
  展示品質を満たさず、視覚レビューを受けて showcase から除外。
  ポートフォリオ自体は存続。）
- 旧実装の退化なし: 旧 STATUS の stats/streak/top-langs/activity グラフ相当は
  `/api/github-readme-stats/*` の既存カード群 + 新 activity カードで回復する。

## 4. 移行

1. 本 ADR の実装を release ブランチへ統合・デプロイ。
2. `rebuildup/rebuildup` README を新構成へ切替（Camo 実測後）。
3. `/now`・`/status`・`/card`・`reel.webp`・`works/*.webp` の撤去は
   README 切替と deprecation 窓の後に行う。
