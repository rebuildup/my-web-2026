# Portfolio 動画の click-to-load 実測（Issue #870）

**この記録は実測値であり、owner の承認ではない。**
記載した数値は、下の「再現手順」で誰でも取り直せる。取れなかった項目は
§7 に「測っていないこと」として残す。

対象: `src/portfolio/video-facade.ts`、`src/portfolio/components/PortfolioVideoFacade.tsx`、
`src/portfolio/components/PortfolioDetail.tsx`、`src/routes/portfolio/$slug.tsx`（変更なし）。

## 1. 前提（旧サイトの動画は何だったか）

- `docs/migration/portfolio-2025-inventory.json` の `media` 297 行の MIME は
  png 258 / jpeg 33 / gif 3 / webp 2 / svg 1。**mp4 / webm は 0 件**。
- `content_assets` の `type` は `video/youtube` のみで **44 件**。
- `scripts/seed-portfolio-path-a.mjs#linkKindFromUrl` は YouTube の URL を
  `portfolio_link.kind = 'video'` として保存する。つまり動画は既に D1 に
  **リンクとして**存在しており、欠けていたのは表示契約だけだった。

したがって本 Issue は移行（#850）ではなく表示（この面）の作業である。
新しいカラムもマイグレーションも追加していない。

## 2. 契約（実装が保証すること）

| 項目 | 実装 | テスト |
| --- | --- | --- |
| 受け付ける URL は `watch?v=` / `youtu.be/<id>` / `embed/<id>` の 3 形式のみ | `parseYouTubeVideoId` | `src/portfolio/video-facade.test.ts`（受理 10 / 拒否 19） |
| 動画 id は `[A-Za-z0-9_-]` の 11 文字 | `YOUTUBE_VIDEO_ID_PATTERN` | 同上 |
| iframe の `src` は保存 URL ではなく id から組み立てる | `composeVideoEmbedUrl` | 同上 |
| 埋込 origin は `youtube-nocookie.com`、`autoplay` なし | `PortfolioVideoFacade` | `PortfolioVideoFacade.client.test.tsx` |
| 押す前は iframe 0 個 | 同上 | 同上 |
| 押す前から出所（YouTube）と id を見せる | 同上 | 同上 |
| 押さない利用者に通常リンクを残す | 同上 | 同上 |

## 3. 再現手順（実測した環境）

```bash
# 1. worktree の local D1 に fixture を入れる（production には触れない）
pnpm run db:migrate:apply:local
node_modules/.bin/cf d1 raw d761ddb7-8179-48dd-855f-c8b7b2924bad \
  --local --persist-to .tmp/d1state --sql "<§3.1 の SQL>"

# 2. build して preview
pnpm run build
node scripts/sync-cf-build-output.mjs
pnpm exec vite preview --port 4399 --strictPort

# 3. Playwright（@playwright/test 同梱 Chromium, headless, DPR 2）で
#    /portfolio/fixture-video と /portfolio/fixture-bogus-video を巡回し、
#    request イベントを全件記録 → クリック → 再記録
node .tmp/870-measure.mjs
```

測定条件: `viewport 1440×900` / `390×844`、`colorScheme light` / `dark`、
`deviceScaleFactor: 2`。GA4 同意バンドは全ページで「拒否する」を先に押した
（未同意なので GA4 は何も読み込まない）。

### 3.1 fixture（local D1 のみ）

```sql
INSERT INTO portfolio_project (id, slug, title, summary, role, period_start,
  period_end, period_label, motivation_md, architecture_md, constraints_md,
  implementation_md, evidence_md, retrospective_md, facets, technologies,
  visibility, status, pinned, display_order, created_at, updated_at)
VALUES ('fixture_video', 'fixture-video', 'Fixture Video Project',
  'A fixture row used only to measure the click-to-load facade.', '',
  1700000000000, NULL, '2023 - 2024', 'Fixture motivation body.',
  NULL, NULL, NULL, NULL, NULL, '["video"]', '[]', 'public', 'published',
  0, 0, 1700000000000, 1700000000000);

INSERT INTO portfolio_link (id, project_id, kind, label, url, display_order, created_at)
VALUES
  ('fixture_link_repo', 'fixture_video', 'repo', NULL,
   'https://github.com/rebuildup', 0, 1700000000000),
  ('fixture_link_video', 'fixture_video', 'video', NULL,
   'https://www.youtube.com/watch?v=SewXH0Bbm-c&t=12', 1, 1700000000000);
```

`fixture-bogus-video` は同じ形で、リンクだけ
`https://youtube.com.example.test/watch?v=SewXH0Bbm-c`（`kind: video`）。
これは「保存 URL を信用しない」ことの対照実験である。

## 4. 実測結果

`docs/verification/portfolio/video-facade/measurement-summary.json` が生データの
要約（ページ × viewport ごとの iframe 数・YouTube 系 origin への要求数・第三者
host 名・文書幅）。フォント URL の全件リストは 1 ページ 32〜34 行あり
差分の価値が無いので、件数とホスト名だけを残している。

### 4.1 押す前（アクティベーション前）

| ページ / viewport | iframe | YouTube 系 origin への要求 | 文書幅 vs viewport | 押下ボタン |
| --- | --- | --- | --- | --- |
| fixture-video 1440 light | 0 | **0** | 1440 / 1440 | あり |
| fixture-video 1440 dark | 0 | **0** | 1440 / 1440 | あり |
| fixture-video 390 light | 0 | **0** | 390 / 390 | あり |
| fixture-video 390 dark | 0 | **0** | 390 / 390 | あり |
| fixture-bogus-video 1440 light | 0 | 0 | 1440 / 1440 | **なし** |
| fixture-bogus-video 1440 dark | 0 | 0 | 1440 / 1440 | **なし** |
| fixture-bogus-video 390 light | 0 | 0 | 390 / 390 | **なし** |
| fixture-bogus-video 390 dark | 0 | 0 | 390 / 390 | **なし** |

「YouTube 系 origin」= `youtube.com` / `youtu.be` / `youtube-nocookie.com` /
`ytimg.com` / `googlevideo.com` / `googleusercontent.com` とそのサブドメイン。
**サムネイル（`i.ytimg.com`）も取得していない。**

同じページからは Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`) への
要求が出ている（1 ページあたり 32〜34 件）。これはサイト共通の chrome が
読み込んでいるもので、本 Issue の変更前から存在する。したがって
画面の文言は「押すまで **YouTube へ**の要求は送信しません」と範囲を限っている。
「外部への要求は 0」とは書かない — それは事実ではない。

### 4.2 押した後

4 通りすべてで次のとおり:

| 観測 | 値 |
| --- | --- |
| iframe 数 | 1 |
| `src` | `https://www.youtube-nocookie.com/embed/SewXH0Bbm-c` |
| `referrerpolicy` | `strict-origin-when-cross-origin` |
| `allow` | `accelerometer; encrypted-media; picture-in-picture` |
| `autoplay` | 文字列を含まない |
| 押下ボタン | 消える（同じ場所に frame が入る） |
| YouTube 系 origin への要求 | 8（押した後に初めて発生） |

保存 URL は `…&t=12` を含むが、`src` に `t=12` は現れない。
frame は id から組み立てられている（保存 URL の写しではない）。

### 4.3 fail closed

`kind: 'video'` でも URL が解釈できない行（lookalike host）では、
**facade を描画しない**（ボタンも iframe も無い）。§07 Links には従来どおり
1 本の通常リンクとして残る。これは「facade がリンクも埋込も生成しない」という
意味であり、既存のリンク一覧を消す変更ではない。

## 5. スクリーンショット

`docs/verification/portfolio/video-facade/` 配下、WebP（DPR 2）:

- `fixture-video-desktop-light-before.webp` / `-after.webp`
- `fixture-video-desktop-dark-before.webp` / `-after.webp`
- `fixture-video-mobile-light-before.webp` / `-after.webp`
- `fixture-video-mobile-dark-before.webp` / `-after.webp`
- `fixture-bogus-video-*.webp`（4 枚、`-after` は無い = 押せないため）

`-after` は実物の YouTube プレイヤーが描画された状態である（headless から
`youtube-nocookie.com` に到達できた）。

## 6. テスト

- `src/portfolio/video-facade.test.ts` — 29 assertions（受理 10 / 拒否 19）
- `src/portfolio/components/PortfolioVideoFacade.client.test.tsx` — 6 tests
- `src/portfolio` 全体: node pool 387 tests / client pool 23 tests green

## 7. 測っていないこと

- **production の実ページ**。本測定はローカル preview + ローカル D1 fixture で
  行った。production の `media.rebuildup.dev` と実プロジェクトの組み合わせは
  測っていない（#850 の `--execute` が owner 判断待ちのため、production の
  データで「動画リンクを持つ project」を確認していない）。
- **iOS Safari / Firefox**。Chromium のみ。
- **iframe 内の再生操作**。プレイヤーが描画されるところまでで、再生・音声・
  全画面は操作していない。
- **StrictMode 二重レンダ時の iframe 再マウント**。`useState` のみなので
  サーバ markup は常に「押す前」だが、開発時の二重レンダは測っていない。
- **#506（公開日本語コピーの承認）**。新しい公開文言を 3 つ追加した
  （「この動画は YouTube から配信されます。押すまで YouTube への要求は送信しません。」
  「動画を読み込む」「YouTube で開く」）。owner レビューは未実施で、
  `copy:approval:check` は `not run`（advisory）になる。**承認記録は作っていない。**

## 8. 測定中に見つけた別件

- **Issue #871**: §07 Links が折り返し機会の無い長い URL で 390px の文書幅を
  超える（390 → 410）。本 Issue の変更とは独立で、この PR では直していない。
