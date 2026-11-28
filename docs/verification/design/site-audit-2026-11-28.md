# 全ページ・全画面種別デザイン監査 — 2026-11-28（Issue #1292 / Epic #1266）

baseline: `release-0-16-0` 相当（branch `1280` = ページ差分なし + capture script 修正のみ）。
証拠: `.tmp/dm-audit-baseline/`（全公開 route × desktop 1440 / mobile 390 × light/dark = 60 cell、`loading="lazy"` settle 済み）、`.tmp/audit-1266/models/`（composition-model/v1 × 26）、`.tmp/audit-1266/reviews/`（73 batch art-director review）、agy `agent review run`（claude-sonnet-5-5-low、home desktop）。

## ページ別 verdict

| route | docH d/m (px) | sections d/m | 総合 | 主な構造的問題 |
|---|---|---|---|---|
| `/` home | 7,756 / 10,321 | 6 / 6 | **mediocre** | 「作品の証拠」が hero→explore→now→status の奥に埋没。status 2,006px + sponsored + 広告 2 面が就活の文脈で作品より先に目に入る。dev dashboard 的印象 |
| `/about` | 7,627 / 9,632 | 10 / 10 | good | skills の平坦な一覧が momentum を殺す。career に未来日付（2026/2028）があり就活文脈と緊張。sticky TOC 不在。末尾の cookie/privacy ブロックが editorial トーンを破壊 |
| `/portfolio` | 14,506 / **40,410** | 2 / 2 | mediocre | `clampLimit` default 100 で全 74 件を一括描画。「NO MEDIA」プレースホルダが未完成品に見える。featured work / カテゴリ構造なし。締めの CTA なし |
| `/portfolio/ch4nge` | 3,785 / 2,984 | 5 / 5 | good | hero media-led は機能。copy の重複（title/motivation）、metadata/evidence の設計不足 |
| `/tools` | 5,075 / 8,067 | 2 / 2 | good | hero の INVENTORY sidebar が直後の全件リストと重複。カテゴリ手がかりなし |
| `/tools/<slug>` | host | — | （環境依存） | mock 環境では app artifact 未生成で iframe が空に見える。実機検証が必要 |
| `/stack` | 12,361 / 17,126 | 13 / 13 | mediocre | 技術 spec sheet。Biome 設定 dump・コードブロック羅列で「語り」がない。案件へのリンクなし。締め CTA なし |
| `/activity` | 5,709 / 12,251 | 2 / 2 | mediocre | 年別の生 GitHub feed。1970 年の placeholder data が露出。媒体なし・等質テキスト |
| `/contact` | 1,486 / 1,699 | 2 / 2 | mediocre | 末尾が reaction ボタン+legal 文で「連絡手段」が不明瞭。CHANNELS preview と section の重複 |
| `/links` | 3,876 / 4,408 | 5 / 5 | good | 汎用 link directory。favicon/アイコンなし、グループ別の視覚的手がかりなし |
| `/now` | 5,377 / 5,311 | **1** / 1 | mediocre | 全件が hero rhythm の単一 section 内（~14 件、weight group 別）。「非公開プロジェクト」重複、上位作品の媒体なし |
| `/keyboard` | 5,056 / 6,069 | 9 / 9 | good | 最良の視覚資産（keyboard 図）が技術表の下に埋没。hero は text-only |
| `/projects/dotfiles` | 6,078 / 7,585 | 10 / 10 | good→poor | README mirror で「so what」がない。visual anchor なし。末尾 privacy copy |
| `/commission` | ~4,600 / ~5,000 | 複数 | good | 「Intake suspended」が冒頭で就活導線を弱める。text-only |
| `/design-system` | **24,610** / **33,179** | 49 / 49 | mediocre | 公開 specimen としては巨大。grid 系の説明が declarative で視覚実証が弱い区画あり |

## 横断的所見（上流問題）

1. **「作品の証拠 < メタ情報」の優先順位逆転**: home は status/ads/analytics が portfolio 証拠より前。就活サイトとして「何ができるか」を最初の viewport で証明できていない。
2. **等質カードグリッドの乱用**: portfolio / tools / explore / links が同じ「均一カードの積層」。視線誘導・強弱・媒体の違いがない。
3. **「NO MEDIA」「未整備」プレースホルダの放置**: portfolio の no-media カードが未完成品に見える（agy/vision 共通指摘）。
4. **index route の全件一括描画**: portfolio は limit=100 で事実上全件。mobile 40k px は scroll marathon。C-8 の「index は全件」で正しいが、キュレーション層（featured/pinned 相当）の不在が問題。
5. **セクション内 rhythm の欠如**: `/now` `/activity` `/tools` `/portfolio` は事実上単一 section。tone/rhythm の変化がなく「ページ=長いリスト」。
6. **legal/privacy/cookie copy の挿入位置**: 複数ページ末尾で editorial トーンを破壊（about/contact/projects-dotfiles）。footer への集約または別表現が必要。
7. **締めの CTA 不在**: stack/activity/portfolio 等が dead-end で終わる。contact/commission への導線がページの役割を閉じない。
8. **未来日付・placeholder data の露出**: about の 2026/2028 career 項目、activity の 1970 placeholder。
9. **テキストのみのページが多い**: stack/dotfiles/keyboard は視覚資産（図・screenshot・demo）を持ちながら text-first。job hunting では「見せる」ことが証明になる。

## 変更不要と判断する領域（根拠付き）

- `/portfolio/ch4nge` hero の media-led 構成（#1285 で再構成済み、agy 再レビューも構造を確認）
- `/contact` の 2 section 骨格自体（問題は末尾コンテンツの構成であって IA ではない）
- keyboard の情報構造（問題は媒体の優先順位であって section 順ではない）
- composition-lint CL-1..13 の機械的契約違反は 0 件 — 構造的欠陥は「契約が測らない次元」（hierarchy・distinctiveness・curation）に集中している

## 証拠ファイル

- captures: `.tmp/dm-audit-baseline/{route}--{viewport}-{scheme}[-partN].png`
- composition models: `.tmp/audit-1266/models/{route}.{w1440,w390}.json`
- vision reviews: `.tmp/audit-1266/reviews/*.md`（73 batch、`_run-summary.json` に失敗記録）
- agy review: `.tmp/audit-1266/agy/agy-review-9ec79fd6-*.json`（home desktop、claude-sonnet-5-5-low）

## 次工程

#1293（サイト全体デザインコンセプト再構築）へ入力。ページ別再設計 Issue は concept 確定後に起票する。
