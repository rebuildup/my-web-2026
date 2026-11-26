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
