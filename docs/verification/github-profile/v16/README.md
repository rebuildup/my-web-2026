# v16 — v0.15.0 構造的再設計の before/after 記録（Issue #1240）

- `before/` — v0.14.0 公開版の実表示（GitHub + Camo 経由、
  desk/mob × light/dark の README 全ページ 8 枚）。
- `after/` — `release-0-15-0` 系の `/github-profile/profile` SVG
  4 バリアント（desk/mob × light/dark）。dev worker のライブ出力。

## 実測（viewBox 高さ）

| | desktop | mobile |
|---|---|---|
| v0.14.0 `/profile` | 1092px | 1368px |
| v0.15.0 r1 `/profile` | 964px | 1328px |

契約 §22 の目標（desktop ≤950 / mobile ≤1180）に対し desktop は
+14px、mobile は +148px 未達 — Activity セクション（モバイルで
REPO OUTPUT + 72H pulse + RECENT EVENTS が全て縦積み）が残る
支配項。次ラウンドで Activity の再構成を行う。

## r2（mobile 圧縮 + agy v20 レビュー反映）

`after-r2/` — r2 適用後の `/profile` SVG 4 バリアント。

| | desktop | mobile |
|---|---|---|
| v0.14.0 `/profile` | 1092px | 1368px |
| r1 `/profile` | 964px | 1328px |
| r2 `/profile` | 964px（不変） | **1176px（予算 ≤1180 達成）** |

r2 の変更（mobile のみ、desktop は画素不変）:

- REPO OUTPUT 集計行はモバイルでバーなし caption 行に集約、
  mobile `topN` 4→3、72H pulse 56→48px、イベント行 4→3
- LAST 72 HOURS + RECENT EVENTS をモバイルで 1 モジュールヘッドに統合
- vitals 行ピッチ・stack レーン間隔をモバイルのみ s4→s2 に tightening

agy 独立レビュー v20（`.tmp/review-v20/`、APPROVE WITH FIXES）の
指摘を全て反映: vitals→言語バーの残存デッドスペース解消、
`bar = commits` 凡例のモバイル復活（Total 下の独立行）、バー
トラックを commits カラム右端へスナップ + ディセンダークリアランス
+2px、集計→Total の間隔 tightening、マージヘッド配下の
サブブロック・リズム差別化、stack フッターキャプションの
8px エア確保（高さ中立）。

## r1 で適用した契約条項

- 2 カラム・マストヘッド（desktop）: 左レール = アバター + 名前 +
  tagline + Discord presence の縦積み、右レール = 無ラベル VITALS
  3列×2行。presence がアバターのドットと同一レールに戻り、
  サービス識別が一つの塊として読める。
- 無ラベル state: VITALS / TOP LANGUAGES のモジュールヘッドを廃止
  （アイコン+数値+バーは自己説明的）。standalone `/identity` も
  同一構成。
- Stack レーン再編: `Design & web` / `Languages & infra`（実内容と
  不一致）→ `Design & media`（11）/ `Code & platform`（37）、
  全 48 アイコン維持。
- tagline 実測: 14px body で右端 394.8px < vitals 左端 408px、
  衝突なし（Playwright canvas 実測）。
