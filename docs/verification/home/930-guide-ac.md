# #930 構内案内型ホーム導線 — 受入証拠の整理

Issue: [#930](https://github.com/rebuildup/my-web-2026/issues/930)
対象: `release-0-11-0`（2026-11-20 時点のコード）

本記録は #930 の受入条件と実装・テスト証拠の対応を整理する。新規の実装ではなく、既存証拠の索引。

## 受入条件との対応

| AC | 状態 | 証拠 |
| --- | --- | --- |
| 主要ページが同列で見つかる | ✅ | `src/home/guide/ledger.ts` — サイト内駅 6 + 外部スポットを兄弟要素として定義。`GuideSection.test.tsx` が全 href の描画を assert |
| 展開して下位の行き先へ移れる | ⚠️ 部分 | ネイティブ `<details>/<summary>`（`GuideSection.tsx:830`）で展開機構は実装・テスト済み。ただし出荷 ledger で `children` を持つのは `portfolio` のみで、その子は `/portfolio` 自身 — 「下位ページへの展開」の実例は薄い。`/tools`（15 tool）や `/portfolio`（66 作品）の子一覧を ledger に持つかは owner の AC 解釈次第 |
| 案内→プロジェクト→補助情報の順序 | ✅ | `src/home/composer.tsx` — guide が本文先頭セクション、`e2e/smoke.spec.ts` が section nth(1) を assert |
| 視覚案内が使えなくても情報構造は読める | ✅ | `<details>` は JS 不要。`aria-hidden` rail + `aria-label`/`aria-labelledby` で構造化 |
| インタラクションとリンク到達・展開/折畳・キーボード操作をコンポーネント/契約テストで実証 | ✅ | `GuideSection.test.tsx`（href・details・外部リンク）、`ledger.test.ts`（route-tree truth test — ルート rename で fail）、`trail.test.ts`。`e2e/a11y/keyboard-navigation.spec.ts` が Home の tab walk を実施 |
| 意味ある要素にのみ現在地モチーフ | ✅ | 駅ノード = `StateMark` シルエット + `accent.field.*` パネル（#968）、外部は破線 spur + ↗。装飾的な接続線/路線図モチーフなし |
| スマホ/タッチ/キーボード/スクリーンリーダー/reduced-motion | ✅（構造） | ネイティブ要素のみで独自アニメーションなし。`968-field-panels.md` が reduced-motion/no-JS/focus を実測。スクリーンリーダー固有の検証記録はない（構造的 aria のみ） |
| 独自表現はトップのみ | ✅ | guide ledger/section は `src/home/` に閉じ、他ページに伝播しない |

## #968 との関係

#968（closed）の owner 追加受入「アクセント色の平面色面で情報構成」に対し、PR #1039 で各駅が `accent.field.*` フィールドパネル化された（`docs/verification/home/968-field-panels.md` + `docs/verification/design/887-current/` の再測定で chromatic share ≤3.24% を確認）。#930 の「構造・方向・識別・展開状態にのみ現在地モチーフを使う」規則と整合。

## 残件（正直な記録）

1. **下位展開の実例が薄い** — children を持つ駅が実質 portfolio のみ（自己参照）。「展開によって下位ページを発見できる」を厳密に読むと `/tools/$slug` や `/portfolio/$slug` への子リンクが期待される可能性。ledger に子を追加するかは情報設計の owner 判断
2. **スクリーンリーダー実機検証の記録なし** — aria 構造は実装済みだが、支援技術での読み上げ確認記録は未作成
3. **Storybook story なし** — `check-storybook-ownership` の必須対象ではなく AC にも要求なし（ゲート pass 確認済み）

## 結論

機能実装と契約テストは受入条件をほぼ満たす。残るのは「下位展開の情報設計の深さ」という owner 判断項と、支援技術検証記録の追加のみ。close 判断は owner へ。
