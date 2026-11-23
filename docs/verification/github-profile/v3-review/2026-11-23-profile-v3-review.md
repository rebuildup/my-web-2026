# GitHub profile v3 review evidence — 2026-11-23

Scope: PR #1208 (release-0-13-1) 差し戻し指摘3件への修正証跡。
Candidate SHA: `11c2c4c0`（ticket PR #1209 / #1210 マージ後の release-0-13-1 head）。

## 1. `/api/v1/github-profile/now` — Issue #1205

### 変更点

- 1200×400 横長 → **680×840 縦長**。統計 2×2 グリッド + GITHUB ACTIVITY /
  DISCORD / IN PROGRESS の縦積みパネル構成。
- **IN PROGRESS パネル新設**: `src/home/current/roster.ts` の確定済み
  エントリ名のみ表示（my-web-2026 / Tastile / After Effects /
  AI coding agent）。weightLevel・日付・活動状況は未記入のため補わない。
  出典 `declared roster · rebuildup.dev` を画像内に明記。
- 活動件数の表記を `repos active in the window` 系に修正し、
  `window repo activity, not projects in progress` の注意書きを併記。
  リポジトリ活動と進行中プロジェクトを別パネルに分離。
- `http/github-profile -> home/current` 依存は
  `isGithubProfileRosterEdge`（`scripts/check-architecture.mjs`）で
  ファイル限定の例外として許可。AGENTS.md §3 に記録。

### モバイル可読性（実効フォントサイズ）

GitHub モバイル表示 ~308px 幅での縮尺は 308/680 ≈ **0.453**。

| 要素 | SVG px | 実効 px |
| --- | --- | --- |
| パネルタイトル・ラベル | 24 | ~10.9 |
| 本文（activity detail / Discord detail / プロジェクト名） | 20–22 | ~9.1–10.0 |
| 値・見出し | 30–56 | ~13.6–25.4 |
| 最小（フッター注記） | 18 | ~8.2 |

旧構成（1200×400、15px ラベル）は同条件で ~3.9px だった。

### 検証

- `vitest run src/http/github-profile/` **51 tests PASS**
  （IN PROGRESS・セマンティクス文言・unavailable 正直表示・決定性・
  ラスタ画像非含有を検証）
- `tsc --noEmit` / `biome check` / `check-architecture.mjs` 全て PASS
- ラスタライズ証跡: `now-680.png`（原寸）/ `now-308.png`（モバイル相当）

## 2. `public/github-profile/reel.webp` — Issue #1204

### 原因と対応

- MultiSlicer ソース（540×480）には**黒帯が焼き付いており**、
  `fit: crop` では上下見切れ、`fit: blur` でも黒帯が残存していた。
  輝度ゲート（平均 YAVG）は構図を評価できない。
- ビルドに **cropdetect 自動クロップ**を追加: 各セグメント全フレームの
  検出結果の union（= 全フレーム共通で黒い領域のみ）を除去。
  いずれかのフレームに実コンテンツがある端は残るため誤クロップしない。
- MultiSlicer を `blur` 構図へ変更（全フレーム表示・上部文字の見切れ解消）。

### 計測値

| 項目 | 値 |
| --- | --- |
| 出力 | 560×314 @ 4fps animated WebP |
| サイズ | **563,370 bytes** |
| 同一ソース GIF | 1,041,609 bytes（WebP 継続採用） |
| セグメント | 5作品 × 2.5s（multislicer / flashbeat / ugoita / usoto / isogasii-demo） |
| ソース解決 | portfolio snapshot の published+public video link のみ（fail-closed） |

MultiSlicer 先頭フレームの左右端輝度（列平均 YAVG）:

- 修正前: 両端 ~1.5（ほぼ純黒の黒帯）
- 修正後: ~65–147（ブラー背景の実画像。黒帯解消）

他4作品は 640×360 の 16:9 ソースで cropdetect は全フレーム検出なし。
ugoita は上下レターボックス（~48–54px）を検出・除去済み。

### 証跡ファイル

- `reel-seg{1..5}-*.png`: 出力 WebP から抽出した各セグメント先頭フレーム
- `reel-transition-{01..11}.png`: セグメント境界前後のフレーム
- `*-first.png`: ソースクリップの先頭フレーム（`--review` 出力）

## 3. operator gate B（v0.13.1 限定例外）

- gate B（`check-cf-secrets --execute`）は agent 環境に `INFISICAL_TOKEN`
  が無く **未実施**。PASS ではない。
- 例外根拠: v0.13.0（同日）で Infisical prod parity / live Worker
  binding 全検証 PASS の実測証跡 + 本差分に secret・binding・
  wrangler 変更 0 件。
- 本修正でも secret/binding/wrangler 契約の変更なし（差分は
  `src/http/github-profile/**`、`scripts/`、`public/`、`docs/`、
  `AGENTS.md` のみ）。契約が変わった場合は例外を無効とする。
- 次回以降の標準運用に省略を一般化しない。

## 4. 未了（正直な記録）

- エージェント環境では画像の目視確認ができないため、上記は画素計測と
  生成物の提出であり、**GitHub 実画面（desktop/mobile・light/dark）での
  最終視覚受入はデプロイ後に実施する**。
- リールの切替はハードカット（2.5s/作品）。演出強化が必要なら別途対応。
