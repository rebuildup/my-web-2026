# Issue #928 HOME 最終受入記録（2026-11-20）

> Epic #928「現在地」の案内・活動・参加・広告を一つのトップページと
> して成立させる、の最終受入検証。コンポーネントの存在確認ではなく、
> 実ルート `/` の描画・情報優先順位・a11y・モーション・公開データ境界を
> 実測した記録。close 判断は owner レビューに委ねる。

## 環境

- 対象: `release-0-11-0` @ `5747d577`（PR #1099 merge 後の head）
- 描画: `pnpm dev`（production-readonly remote bindings、port 3000）
  の実 `/` ルート。fixture/story ではない
- a11y: `pnpm exec playwright test e2e/a11y/` を **fresh production
  build**（`pnpm run build` → `vite preview`、seeded local D1）で実行
- capture: `scripts/capture-home-928.mjs`（本 PR で追加）

## 実画面キャプチャ（`928-home-*.webp`、全ページ・2x）

| 条件 | ファイル |
| --- | --- |
| desktop 1440 light | `928-home-desktop-light--part{1,2,3}.webp` |
| desktop 1440 dark | `928-home-desktop-dark--part{1,2,3}.webp` |
| mobile 390 light | `928-home-mobile-light--part{1,2,3}.webp` |
| mobile 390 dark | `928-home-mobile-dark--part{1,2,3}.webp` |
| desktop 1440 light + reduced-motion | `928-home-desktop-light-reduced-motion--part{1,2,3}.webp` |

part 分割は WebP の 16383px 上限対策（高さ 24,694–33,602px）。

## 情報優先順位（DOM h2 順、5 条件すべて同一）

1. サイト内案内 Site guide
2. **現在地 / Where I am now**
3. できごと What's here（capabilities）
4. サイトの状態 Site status
5. リアクション（絵文字ピッカー群）
6. Contact / お問い合わせ
7. アクセス解析 consent

案内 → 現在地 → できごと → 状態 → 参加 → 同意 の順で、Epic の
「一つのトップページとしての情報優先順位」を満たす。`activity`
capability は `live` + `/activity` CTA（Issue #352 で遷移済み）、
広告ユニット領域・フッターの「データと保持期間」通知を確認。
skip link・`main#main` landmark あり。

## a11y / モーション

- `e2e/a11y/axe-public-routes.spec.ts`: **20/20 pass**（`/` 含む全公開
  ルート、axe-core WCAG 2.2 A/AA、既知 violation ledger なし）
- `e2e/a11y/keyboard-navigation.spec.ts`: **13/13 pass**（skip link・
  Tab 順・mobile menu・reactions picker dialog の focus trap/Escape
  復帰・negative control 含む）
- reduced-motion: `prefers-reduced-motion: reduce` での全ページ capture
  済み。既存の `current-projects-reduced-motion.webp`（#968）と併せ、
  モーション抑制時も情報が失われないことを確認
- 公開データ境界: `test/integration/privacy-projection.test.ts` の
  契約（owner 未承認の位置・活動・予定データを公開面に出さない）に
  適合。プライバシー通知は footer の「データと保持期間」として描画

## 環境差異の記録（PASS と読み替えないもの）

- 初回 dev server（remote production D1）での axe 走査は
  `/portfolio/my-web-2026` が 404 — **本番データで同 slug が未公開**
  であるためのデータ差異。seeded local D1 では 200 で pass。
  製品コードの欠陥ではないが、manifest の sample path が seed 前提で
  ある点は記録しておく（#765/#766 のデータ棚卸し領域）
- keyboard-navigation の初回失敗 5 件も同じデータ差異
  （reactions catalog が remote で空）で、fresh build + seeded D1
  では全件 pass
- `vite preview` は `dist/` の stale build を配信するため、
  ローカル E2E 前に `pnpm run build` が必須（今回は Oct 24 の
  stale dist が原因で一時 404 を観測し、再 build で解消）

## 判定

HOME の案内・プロジェクト・活動・広告・参加機能の情報優先順位と
視覚的完成度は、desktop/mobile × light/dark の実描画と
a11y/キーボード/reduced-motion の機械検証で確認できた。
**RC 包括 QA の対象として ready。** 残る owner 判断項
（copy approval、roster 値、guide 下位展開、#764 supersede）は
本受入の範囲外として Issue #928 / #1072 に記録済み。
