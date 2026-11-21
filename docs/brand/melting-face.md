# 「時間を溶かしています」モチーフ — melting face preview

> Status: **Preview / brand motif note**（Issue #522）
> Visibility: repository-internal。この preview は公開ページに載っていない。
> Audience: contributor, agent, future-self
> Source: Issue #522 本文（Miro 根拠: 個人 > samuido > 361℃ > 時間を溶かしています / melting face）
> 機械検証: scripts/check-melting-face-preview-parity.test.mjs・scripts/capture-melting-face.mjs
> プレビュー: src/personal/melting-face/MeltingFace.stories.tsx

Issue #522 は、361℃ → 『時間を溶かしています』 → melting face → SNS アイコンのキャラクターというモチーフの連鎖を、文章・アイコン・表情の独立プレビューとして形にする Issue である。#274 Codex ペットとは別の概念であり、ペットの sprite や motion とは無関係。

この文書が記録するのは **モチーフの構造と、その表示上の約束** までである。元画像は未確認なので placeholder で表示し、本番アセットは採用しない。コピーはいずれも候補であり、公開文案の採否は owner の判断である。

---

## モチーフの連鎖

361℃ → 『時間を溶かしています』 → melting face → SNS アイコンのキャラクター。Issue #522 が挙げる連鎖を、そのままの順で示す。

- 連鎖 1: 361℃
- 連鎖 2: 『時間を溶かしています』
- 連鎖 3: melting face
- 連鎖 4: SNS アイコンのキャラクター
- コピー（短文）: 時間を溶かしています
- コピー（長文・候補・未採用）: 361℃——時間を溶かしています。melting face は、溶けていく顔のモチーフで、SNS アイコンのキャラクター案。
- 英語コピー: Lost in time. 🫠 Found it nowhere.
- アイコンの役割: melting face — 溶けていく顔のモチーフ（melting face）のプレースホルダー。元のアートワークは未確認のため、検証用の単純な図形で代用している。
- アセット状態: 元画像は未確認。placeholder であり、本番アセットは採用していない。

## コピーとアイコンの役割

- 短文コピー『時間を溶かしています』、長文コピー候補、英語コピー『Lost in time. 🫠 Found it nowhere.』、アイコン（melting face）の 4 つの役割を分離して表示する。
- アイコンは文章ではない。コピーが説明を担い、アイコンはモチーフの顔だけを担う。
- 長文コピーは候補であり、採用済みの文案ではない。
- この preview は route を持たず、表示位置は未確定。英日以外の locale は必要になってから対応する。

## 説明の候補（未決着）

- 『熱中』『時間を惜しみなく投資』『無駄なこと』の 3 つの説明候補を、矛盾を消さずに併記する。
- 3 案は同じモチーフについて矛盾し得る読み方であり、どれが正しい説明かは決めていない。
- 採否・統合・却下のいずれの決定も行っていない。説明の採用は未決であり、owner の判断を待つ。

## アートワークと fallback

- 元画像は未確認（Miro board にアクセスできない）。placeholder で表示し、本番アセットは採用しない。
- mark は role="img" と alt テキストを持ち、絵文字と文言だけの fallback 表示も別 story で実レンダリングする。
- fallback の文字列表記: 🫠 melting face（placeholder）
- 装飾の drip 動画は prefers-reduced-motion: reduce で止まる。止まっても resting markup が同じ情報を運ぶ。
- light / dark は prefers-color-scheme に追従する。色は editorial の semantic token のみを使う。

## 典拠

- Issue #522 本文 — 対象・完了条件・Miro 上の根拠（個人 > samuido > 361℃ > 時間を溶かしています / melting face）。
- Miro board の付箋本文にはアクセスできない。見出し語以外の由来・背景は創作しない。
- 関連 Issue #380（ページから独立した preview 契約）と #381（技術説明の表示基盤）は参照するが、hard dependency ではない。
- #274 Codex ペットとは別の概念であり、ペットの sprite / motion とは無関係。

## 実装と機械検証

- 参照文書（正本）: docs/brand/melting-face.md
- preview データ: src/personal/melting-face/MeltingFace.preview.ts
- preview component: src/personal/melting-face/MeltingFace.tsx
- preview story: src/personal/melting-face/MeltingFace.stories.tsx（Storybook の Preview / Melting face）
- 一致検証: scripts/check-melting-face-preview-parity.test.mjs（pnpm run test が scripts/*.test.mjs を discovery する）
- 撮影: scripts/capture-melting-face.mjs（node scripts/capture-melting-face.mjs）
- 検証画像: docs/verification/brand/melting-face-preview.png・docs/verification/brand/melting-face-fallback.png
- 一致が壊れたら fail する。差分は「保留」として文書に明記してから直す。判定を緩めて green にする運用は行わない。

## 未確認（owner 確認待ち）

- Miro board の付箋本文由来の情報（アクセス不可）。モチーフの由来・意図の詳細は創作しない。
- 元画像・元アートワークの有無と内容は未確認。確認できるまで placeholder のままとする。
- 3 つの説明候補のどれを（あるいはどれも）採用するかは未決。
- 長文コピー・英語コピーの採用可否は未決。公開案が決まるまで preview の文字列は候補のまま。
- このモチーフをどの公開 surface（SNS アイコン、OG、ヘッダー等）に置くかは未決。route への mount は本 Issue の範囲外。
