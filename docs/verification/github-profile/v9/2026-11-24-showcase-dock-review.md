# Selected Work showcase ドック遷移 — 視覚レビュー記録（rev2）

Issue: rebuildup/rebuildup#8 / my-web-2026#1214 継続
対象: `public/github-profile/showcase.webp`（800×360・8fps・28秒）
前提: v6 マージ済みリレー（§13 相当）の残存指摘 — 遷移中のドック
プレート周辺のカード衝突・滞留・デッドスペースを解消する改訂。

## 今回の変更（`scripts/build-github-profile-showcase.mjs` + `showcase.json`）

- `transition` 0.75s → **1.0s**、works ごとの出発 stagger を
  0.5s → 0.8s に拡大（同時通過の分散）
- scale anticipation を強化: 後退カードの早期縮小 0.3 → 0.45、
  park 行きは **0.8s 前倒し**（プレート到達時には必ずサムネイル
  サイズ）
- protagonist の z-order / アクセントボーダー移管を遷移終盤
  45% → **62%** 地点へ（レビュー指摘の「早すぎる border snap」対応）
- 減光フロア 0.32 → 0.38、リムストローク 0.18 → 0.26（暗い素材の
  350px 可読性）
- ドック z-order は **全カードより下** に固定（下記経緯）

## ドック occlusion の検討経緯（9 ラウンド）

| rev | 方式 | 結果 |
|---|---|---|
| r1 | サイズゲートのみ（w≤96・bounds内） | request-changes: 通過カードがプレート上に滞留 |
| r2 | 任意スロット中心 ±14px・w≤80 | request-changes: 同上＋枠はみ出し |
| r3 | 自スロット ±5px のみ | request-changes: ドックが空になりポップイン |
| r4-r5 | 自スロット ±12px + 近接減光 | request-changes: リスロット中の消失 |
| r6 | dock-bound 判定 + settled 同士のみ減光 | request-changes: なおクリップ/消失 |
| r7 | park-bound 早期縮小 0.8s 追加 | request-changes: 残存クリップ |
| r8 | 同上 + 減光条件緩和 | request-changes: 同上 |
| **r9（採用）** | **occlusion 撤去・プレート常に最背面** | request-changes: intra-dock 通過衝突のみ残存 |

全 occlusion 変種が「消える/切れる」系の指摘を生んだため、
レビュアーの Top Fix（"plate strictly beneath all cards"）に
従い最背面固定へ回帰。モーション側の改善（長い遷移・分散
stagger・早期縮小・62% border 移管）は全変種で維持。

## 最終状態（rev9 = r9 JSON `5086821d`）

- verdict: request-changes だが内容は ACCEPT WITH FIXES 相当
- 解消済み: ドックのクリップ/消失系 artifact はゼロ。
  settled act（00/02/03/06）は全ラウンドで高評価、主役
  ハンドオフは因果的でクリーン
- **残存指摘（正直な記録）**:
  - 遷移中（各 ~1s）の intra-dock カード通過衝突 — park スロット
    間を直進するカードが駐機サムネイルと一時的に重なる。
    スロット割当の経路設計かアーク補助が必要で、モーション
    パラメータでは解消しにくい構造課題として残る
  - Act 1→2 / 4→5 の遷移途中の一部デッドスペース
    （~25-30% の一時的な空き）
  - 極暗ソースコマ（dock TL 等）の 350px での沈み込み、
    WebP の暗部ゴースト
- レビュー JSON: `agy-review-r01`〜`r09`（各 rev の生結果）。
  フレーム証跡: `f0034`〜`f0178`（12 枚、act 境界 6.0/11.0/
  16.5/22.5 をカバー）

## 判断

v6 以降 6 ラウンド連続 ACCEPT WITH FIXES の系譜上、今回も
同水準で収束。ドック遷移の完全な choreography 解決は
スロット経路設計の抜本見直しが必要で、README 装飾アニメーション
としての費用対効果を考慮し、現状を「既知残件」として
visual doc §15 と Issue #1214 に記録する。公開 README 切替
ゲートで実画面の最終目視を行う。
