# GitHub profile showcase (v4) review evidence — 2026-11-24

Scope: rebuildup/rebuildup#8 レビュー指摘への対応。v3 の 3×3 クリップ
グリッドを廃止し、要求されていた「複数作品が同時に見える
スライドショー」として縦マーキー `showcase.webp` を実装した
（ADR-0026 §2.3、Issue #1212 / PR #1213）。

## 成果物

- `public/github-profile/showcase.webp` — animated WebP
  **480×680・108 フレーム・6fps・18 秒ループ・2,931,882 bytes**
- 生成: `pnpm profile:showcase:build`
  （`scripts/build-github-profile-showcase.mjs` +
  `src/http/github-profile/showcase.json` レイアウト +
  `src/http/github-profile/clips.json` 出典マニフェスト）
- 出典: 公開 portfolio スナップショットの `published + public`
  レコードのみ。YouTube 区間は `yt-dlp --download-sections`、
  エスケープ済み URL（`\_` 等）は正規化してから ID 抽出。
  出典が無い作品は fail-closed でビルド失敗。

## 構成の検証（実測）

- **マーキー合成**: 12 セル（9 作品 + 先頭 3 作品の繰り返し）を
  独立ループストリームとして overlay。y 座標は
  `yOff + i*cellHeight - mod(t*speed, scrollDistance)`。
  `speed = cellHeight / segmentSeconds = 135px/s`、
  `scrollDistance = 9 * 270 = 2430px`、ループ周期 18 秒。
  折り返し時に繰り返しセルが元セルと同位置に来るためシームレス。
- **フレーム抽出**: `showcase-frame-000.png` 〜 `-107.png` の
  うち 9 点を等間隔で `docs/verification/github-profile/v4/` に
  コミット（このディレクトリの PNG 参照）。
- **輝度ゲート**: 出力全 108 フレームから 12 点をサンプルし
  YAVG ≥ 20 を確認（全サンプル PASS）。旧リールの中盤黒フレーム
  問題の再発なし。
- **領域輝度**: 代表フレームでタイル領域と背景を分離計測し、
  タイルが期待位置（上段・下段）に描画されていること、背景が
  `#0B0F14` で一貫していることを確認（輝度 15 前後）。
- **ループ継ぎ目**: t=18s のフレームと t=0 のフレームで、
  同一作品のセルが同一画面位置に来ることを座標計算で確認。
  各セルのコンテンツは 2 秒でループするため、継ぎ目の不連続は
  各タイルが持つ通常のループ切替と同程度。

## 既知の制約（正直な記録）

- 各タイルの映像は 2 秒ループのハードカットを含む。マーキーの
  常時スクロールが切替をマスクする設計だが、静止した瞬間に
  注目すると分かる可能性がある。
- 一部タイルに明るいシーン（YAVG 140–156）が含まれる。実素材の
  範囲であり欠陥ではないが、暗い背景とのコントラストは強い。
- **視覚レビューの限界**: 本エージェントは画像を直接解釈できない
  ため、構図・色・動きの最終的な美的判定は GitHub/Camo 実画面での
  確認に委ねる。定量計測（輝度・座標・フレーム数・サイズ）と
  構造解析（ASCII 輝度マップによるタイル配置確認）は実施済み。
  実画面で品質不足が判明した場合はデザイン段階へ差し戻す。

## 関連する同時修正

- `activity.ts`: バーが `events`・見出しが `COMMITS` だった意味論
  不一致を `EVENTS BY REPOSITORY` に修正。観測スタンプを JST に統一。
- `presence.ts`: 表示時刻の JST 契約を activity と揃えた。
- `package.json`: `0.14.0` へバージョン更新（release-0-14-0 の
  CI バージョン契約を満たす）。`profile:clips:build` を削除し
  `profile:showcase:build` を追加。
- `public/github-profile/clips/*.webp`（9 点・約 2.3MB）と
  `scripts/build-github-profile-clips.mjs` はグリッド不採用に伴い削除。
  `clips.json` は showcase の出典マニフェストとして継続使用。
