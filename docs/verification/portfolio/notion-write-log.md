# Notion への単発書き込みの実行記録

ADR-0018 §2.11。1 回の実行につき 1 行。**この表は操作の記録であり、
作者の承認の代行ではない。**

| 日付 | 操作 | 件数 | バイト | 実行 | 参照 |
| --- | --- | --- | --- | --- | --- |
| 2026-11-04 | 記事本文 + メディアの投入 | 69 ページ / 916 ブロック / 画像 137 | 114,950,713 | `--apply` 成功・失敗 0 | `notion-media-write-2026-11-04.md` |
| 2026-11-06 | 旧テストフィクスチャ 9 ページ（`test-otu-*`）を `Draft` / `Draft` へ変更 | 9 ページ | 0 | PATCH 200 × 9 | `notion-reingest-2026-11-06.md` |
| 2026-11-06 | `kosen-fes-2025` の死んだ外部 image block（www.ube-k.ac.jp — 到達不能）を削除し、同一位置へ file_upload の image block として再配置 | 1 ブロック / 388,074 B | 388,074 | 成功・失敗 0 | `notion-reingest-2026-11-06.md` |
| 2026-11-06 | ingest 再実行（`sync-portfolio-notion.mjs`）→ committed snapshot 更新 | records 60 / media 139 / would_upload 5 / reused 134 | 112,383,184 | 成功（media_skipped 1 は policy skip） | `notion-reingest-2026-11-06.md` |
