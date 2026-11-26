# v5 検証記録 — 横長シーンコラージュ showcase.webp（Issue #1214）

2026-11-24。rebuildup/rebuildup#8 レビュー第2弾の指摘（縦マーキーも
不採用）を受け、Selected Work を **横長・高さ抑制のシーン構成
モーションコラージュ** として再設計した記録。

## 設計判断

プロトタイプ2案を実素材で比較した（本ディレクトリの `proto-a.webp` /
`proto-b.webp` と各時刻フレーム）。

- **proto-a**: 大判背景 + 複数タイルの常時ドリフト型コラージュ。
  雰囲気は良いが「主役が時間とともに変わる」構造が弱い。
- **proto-b**: シーン単位の構図 + 斜めマスク（xfade diagonal）遷移。
  作品ごとのサイズ・構図・主役時間の差異、有機的な主役交代を
  すべて満たすため **採用**。

採用案に Ken Burns 的な緩やかなズーム（hero のみ）と脇役の
正弦ドリフトを加えた完成版を `public/github-profile/showcase.webp`
として生成した。

## 完成版仕様

- 800×360 @ 8fps、約 20.9 秒ループ、約 2.9MB
- 4 シーン + ループバック（計 5 セグメント、4 回の斜めワイプ）:
  - S1: prototype を hero（620×349）+ flashbeat を小タイル脇役
  - S2: multislicer 全高 hero + aulymo-v02 を右上脇役
  - S3: foldlayers / ugoita / homura の 3 作品トリオ構図（8 秒）
  - S4: kosen 全高 hero + tegaki を右脇役
  - 末尾で S1 を再生し、最後の斜めワイプで S1 冒頭へ戻る
- hero アイテムはシーン尺いっぱいの緩やかな push-in
  （scale eval=frame + センタークロップ）、脇役は位相の異なる
  正弦ドリフト
- ループ継ぎ目は bookend フェード（先頭 0.35s / 末尾 0.35s を
  背景色へ）で構造的にシームレス化。コンテンツ位相合わせに
  依存しない

## 検証内容と方法の限界

このエージェントのモデルは画像を直接解釈できないため、以下の
計測・構造検証で確認した。**美的最終判定は GitHub/Camo 実画面での
確認が必要**であり、本記録はその代替ではない。

- 全編 167 フレーム生成、輝度ゲート（中間 80% の 12 サンプル、
  YAVG ≥ 18）PASS
- ASCII 輝度マップによる構図確認:
  - S1/S4→S1 境界で斜めワイプのブレンドが観測できる
  - S2 の左右非対称分割、S3 の 3 領域トリオ、S4 の全高 hero +
    脇役タイルが設計座標どおりに描画されている
  - `final-frame-002-fadein.png` / `final-frame-165-fadeout.png` で
    ループ両端が背景色へフェードすることを確認
- Ken Burns ズームのフィルタ式を単体で検証（eval=frame の `t`
  がシーンローカル時刻として機能、出力 620×348）
- 実ファイルサイズ 2.9MB（Camo 経由配信前提）

## 証跡ファイル

- `proto-a.webp` / `proto-b.webp` — 比較プロトタイプ（A=コラージュ、
  B=シーン+斜めマスク）
- `proto-{a,b}-t*.png` — プロトタイプの代表フレーム
- `final-showcase-*.png` — 完成版の 12 サンプルフレーム
- `final-frame-002-fadein.png` / `final-frame-030-wipe.png` /
  `final-frame-165-fadeout.png` — フェードイン・斜めワイプ・
  フェードアウトの個別確認フレーム

## 生成手順（再現）

```bash
node scripts/build-github-profile-collage-proto.mjs   # プロトタイプ
node scripts/build-github-profile-showcase.mjs        # 完成版
node scripts/build-github-profile-showcase.mjs --review  # フレーム書き出し
```

出典は `clips.json` + 公開 portfolio スナップショットの
published+public レコードに限定（fail-closed）。
