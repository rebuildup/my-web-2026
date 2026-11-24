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

### 2.3 Selected Work はシーン構成のモーションコラージュ

`public/github-profile/showcase.webp`（800×360@8fps、約21秒ループ、
約2.9MB）は、横長・高さ抑制の animated WebP である。均一タイルの
スクロールでも固定グリッドでもなく、**シーンごとに構図・作品の
サイズ・主役になる時間を変える**:

- 4 シーン + ループバックの 5 セグメントを、斜め方向のワイプ
  （ffmpeg xfade `diagtl/diagbr/diagtr/diagbl` を巡回）で接続。
  画面全体が一様に動くのではなく、マスク境界を通じて主役が
  有機的に入れ替わる。
- hero アイテムはシーン尺いっぱいの緩やかな push-in
  （`scale eval=frame` + センタークロップの Ken Burns）、脇役は
  位相の異なる正弦ドリフト。作品自体の映像モーションも生きる。
- 末尾セグメントは先頭シーンの再生で、最後のワイプが S1 冒頭へ
  戻る。ループ継ぎ目は先頭/末尾 0.35 秒の背景色フェード
  （bookend）で構造的にシームレス化する。
- シーン定義は `src/http/github-profile/showcase.json`
  （schema `github-profile-showcase.v2`）、出典は
  `src/http/github-profile/clips.json`。出典は公開 portfolio
  スナップショットの `published + public` レコードに限定
  （fail-closed）。出力全域のサンプルフレームに輝度ゲートをかけ、
  暗転・ローディングフレームをビルド時に拒否する。

経緯: 3×3 グリッド（v3）と縦マーキー（v3.1、480×680@6fps）は
いずれもレビューで不採用となり、横コラージュと斜めマスクの
2 プロトタイプを実素材で比較した上でシーン構成案を採用した
（Issue #1214、証跡 `docs/verification/github-profile/v5/`）。
作品ごとの個別リンクは README 側のテキスト一覧が担う。

### 2.4 スキルアイコンは旧 48 技術を起点に再構成

`my-web-2025/src/app/about/data.ts` のスキルツリー（48 技術）を調査ベースライン
とし、現在も使用する技術を `tandpfun/skill-icons`（MIT）から
`public/github-profile/skills/` へ light/dark バリアント付きで配信する。
件数の削減は「現在使っていないものを外した」根拠に基づき、無根拠の縮小はしない。

## 3. 結果

- 活動の可視化: リポジトリ別バー・feed・private 集約・JST 時刻・観測スタンプ。
- 更新独立性: activity / presence / 静的クリップ / 静的アイコンが別経路。
- 作品: 9 領域（Web アプリ・AE ツール・ツール・映像・UI）を
  シーン構成コラージュで順に主役化し、斜めワイプで有機的に遷移。
- 旧実装の退化なし: 旧 STATUS の stats/streak/top-langs/activity グラフ相当は
  `/api/github-readme-stats/*` の既存カード群 + 新 activity カードで回復する。

## 4. 移行

1. 本 ADR の実装を release ブランチへ統合・デプロイ。
2. `rebuildup/rebuildup` README を新構成へ切替（Camo 実測後）。
3. `/now`・`/status`・`/card`・`reel.webp`・`works/*.webp` の撤去は
   README 切替と deprecation 窓の後に行う。
