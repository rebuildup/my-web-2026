# GitHub profile v3 review evidence — 2026-11-23

Scope: PR #1208 (release-0-13-1) 差し戻し指摘への修正証跡。
第1ラウンド: ticket PR #1209 / #1210（candidate `11c2c4c0` → freeze `04a78909`）。
第2ラウンド（本版）: 実画面レビューで確認された残件3件への修正。

## 1. `/api/v1/github-profile/now` — Issue #1205

### 第2ラウンドの変更点

- **高さ 840 → 700**（情報の取捨選択と階層化で圧縮。パネル高を増やす
  のではなく ACT_H=146 / BOT_H=156 に再配分）。
- **`IN PROGRESS` → `DECLARED FOCUS`**: `roster.ts` の
  `Owner confirmation: PENDING` と矛盾しない表記に修正。
  GitHub で活動確認されたプロジェクトではなく、オーナー宣言の
  注力領域であることをラベルと出典行 `declared · rebuildup.dev`
  で明示。repo 活動カウントは従来通り `repos active in the window`
  + `not projects in progress` 注意書きで分離。
- **観測時刻をコンパクト化**: `Nov 22 · 06:11 UTC` 形式。
  680px / ~308px 表示で省略されにくい。
- **プロジェクト名と出典の重なり解消**: 4行目ベースライン
  `y+125`、出典ベースライン `y+148`（ベースライン差 23px、
  フォント 19/16）。パネル下端までの余白 ~5px を確保。

### レイアウト計測（SVG 座標）

| パネル | y 範囲 | 高さ |
| --- | --- | --- |
| 統計 2×2 | 56–368 | cell 150 |
| GITHUB ACTIVITY | 380–526 | 146 |
| DISCORD / DECLARED FOCUS | 538–694 | 156 |

DECLARED FOCUS 内: タイトル y+40、行 y+62/83/104/125（font 19）、
出典 y+148（font 16）。行4 下端 ~667 → 出典上端 ~674 で非重なり。

### モバイル可読性（実効フォントサイズ）

GitHub モバイル ~308px 幅での縮尺は 308/680 ≈ **0.453**。

| 要素 | SVG px | 実効 px |
| --- | --- | --- |
| パネルタイトル | 22 | ~10.0 |
| 本文（detail / 観測時刻） | 18–19 | ~8.2–8.6 |
| プロジェクト名 | 19 | ~8.6 |
| 出典注記 | 16 | ~7.3 |
| 値・見出し | 28–56 | ~12.7–25.4 |

### 検証

- `vitest run src/http/github-profile/` **51 tests PASS**
- `tsc --noEmit` / `biome check` / `check-architecture.mjs` PASS
- ラスタライズ証跡: `now-680.png`（原寸）/ `now-308.png`（モバイル相当）

## 2. `public/github-profile/reel.webp` — Issue #1204

### 第2ラウンドの変更点

- **黒い縦シームの残存原因を特定・修正**: cropdetect の union
  クロップは「いずれかのフレームで明るい画素がある列」を内容扱い
  するため、ほぼ全フレームで黒い境界列がフォアグラウンド端に残り、
  シャープ映像とブラー背景の境界に細い黒線として描画されていた。
- **検出方式を変更**: 動画を ~30 フレーム等間隔サンプリングし、
  行/列の**平均輝度**が閾値（>3）を超える範囲のみを内容領域とする。
  純黒バーは平均 0 なので確実に除外され、一過性の明点では
  クロップが広がらない。検出後に 2px インセット。
- **Isogasii → Shinkansen に差替え**: isogasii-demo の代表フレームは
  画面大半が白余白で作品内容が伝わらないため、公開 portfolio の
  別作品 `shinkansen`（p5.js ジェネラティブアート、640×360）を
  `at: 0.27` で採用。輝度ゲートだけでなくフレーム構成を考慮した
  代表フレーム選定。

### 計測値

| 項目 | 値 |
| --- | --- |
| 出力 | 560×314 @ 4fps animated WebP |
| サイズ | **578,194 bytes** |
| セグメント | 5作品 × 2.5s（multislicer / flashbeat / ugoita / usoto / shinkansen） |
| ソース解決 | portfolio snapshot の published+public video link のみ（fail-closed） |

MultiSlicer 先頭フレームの列平均輝度プロファイル（10px ビン）:

- 前版: フォアグラウンド端付近に ~24–29 の黒列（シーム）
- 今版: 同領域 ~46–69。純黒列は消失し、残る落差は
  `eq=brightness=-0.15` のブラー背景側の自然な暗さ。

### 証跡ファイル

- `reel-seg{1..5}-*.png`: 出力 WebP から抽出した各セグメント先頭フレーム
- `reel-transition-{01..10}.png`: セグメント境界前後のフレーム
- `*-first.png`: ソースクリップの先頭フレーム

## 3. operator gate B（v0.13.1 限定例外）

- gate B（`check-cf-secrets --execute`）は agent 環境に `INFISICAL_TOKEN`
  が無く **未実施**。PASS ではない。
- 例外根拠: v0.13.0（同日）で Infisical prod parity / live Worker
  binding 全検証 PASS の実測証跡 + 本差分に secret・binding・
  wrangler 変更 0 件。
- 本修正でも secret/binding/wrangler 契約の変更なし。契約が
  変わった場合は例外を無効とする。
- 次回以降の標準運用に省略を一般化しない。

## 4. 未了（正直な記録）

- エージェント環境では画像の目視確認ができないため、上記は画素計測と
  生成物の提出であり、**GitHub 実画面（desktop/mobile・light/dark）での
  最終視覚受入はデプロイ後に実施する**。
- リールの切替はハードカット（2.5s/作品）。演出強化が必要なら別途対応。
- Isogasii の差替えは「内容が伝わるフレームが無い」という判断。
  別タイムスタンプの再選定も可能だが、現状は作品構成の多様性
  （Web アプリ・音楽・イラスト・映像 PV・ジェネラティブアート）を
  優先した。
