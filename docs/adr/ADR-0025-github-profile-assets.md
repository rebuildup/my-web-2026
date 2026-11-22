# ADR-0025 — GitHub プロフィール画像アセットの再設計（作品静的画像 + 独立ステータス）

- Status: **Accepted** — Issue #1196 の設計正本。README 側の対応は
  rebuildup/rebuildup#5
- Date: 2026-11-23
- Supersedes: ADR-0024 の「1 枚カード集約」前提（`/card` エンド
  ポイント自体は deprecation 期間中も契約を維持して配信する）
- Design record: `docs/visual/github-profile-readme.md`

## 1. Context

v0.11.3 で配信した `GET /api/v1/github-profile/card`（ADR-0024）は
「名刺 = 1 枚の画像」の前提で設計され、実制作物カバーを `data:` URI
として埋め込む。実測で 1,232,011 bytes・TTFB 0.8–1.4s に達し、
Issue #1193 が軽量化を追跡していた。

オーナー判断により、1 枚集約の方針を撤回し、GitHub README の
セクション構造を活かした複数画像構成へ再設計する
（rebuildup/rebuildup#5）。README がネイティブ `<img>` / Markdown
画像を使える以上、SVG へのラスタ埋め込みは不要であり、作品画像は
**静的アセットとして直接配信する方が構造的に正しい**。

## 2. Decision

### 2.1 作品画像はコミット済み最適化 WebP（Static Assets）

- 配置: `public/github-profile/works/<slug>.webp`。Cloudflare
  Workers Static Assets がそのまま配信し、README は
  `https://rebuildup.dev/github-profile/works/<slug>.webp` を
  `<img>` で参照する。
- 生成: `scripts/build-github-profile-works.mjs`（sharp、
  devDependency 既存）。ソースは公開 portfolio スナップショット
  （`published` + `public`）の `isCover` ラスタメディアを
  production `/media/<key>` 経由で取得し、最大 1200px・WebP q80 に
  変換する。`/media` が 200 を返すキーだけが使えるため、公開境界
  （`isPublicMediaKey` / Issue #634）の fail-closed 性は経路上で
  保たれる。
- 選定: `src/http/github-profile/works.json` が slug + レイアウ
  役割（hero / grid）を宣言し、`works.ts` がスナップショットへ
  fail-closed に解決する。作品の増減はこの 2 ファイル + スクリプ
  ト再実行 + README 更新で行う。
- キャッシュ: `public/_headers` に `/github-profile/*` →
  `Cache-Control: public, max-age=86400` を追加。slug URL は安定
  だが bytes は再生成で変わり得るため `immutable` にはしない。
  Camo は画像ごとにキャッシュするため、作品画像の更新頻度は
  実質「README を編集した時」と同じでよい。

**比較して退けた案**:

| 案 | 不採用理由 |
| --- | --- |
| `/media/<key>` を README から直接参照 | 原寸（最大 ~2MB/枚）のまま配信され、作品ごとの最適な切り出し・形式を制御できない。Camo 転送量が旧カード並みに戻る |
| リクエスト時に派生画像を生成するエンドポイント | Worker に画像リサイズ基盤がなく、Cloudflare Images 等の新規サービスは AGENTS.md §4 の ADR + ticket 対象。得られるのは動的性だけで、作品画像はほぼ不変なので静的で十分 |
| 派生版を R2 にアップロード | ローカルに本番 R2 への書き込み経路がなく（Issue #1193 で確認済み）、新規の配信・権限設計が必要。コミット済み Static Assets で同じ公開境界・より単純な構成になる |

### 2.2 動的ステータスは独立した軽量 SVG

- `GET /api/v1/github-profile/status` を新設。GitHub activity
  （D1 `github_activity_snapshot`）と Discord presence（D1
  `discord_presence_snapshot` + `DISCORD_PRESENCE_USER_ID` +
  15 分鮮度窓）の 2 パネルだけを描く 1200×172 の SVG で、ラスタ
  メディアを一切含まない（応答は数 KB）。
- データ契約は `/card` と同一: `model.ts` の `githubSummary` /
  `discordSummary` を再利用し、`unavailable` / `stale` を正直に
  描画、観測時刻を画像内に表示、常時 200。
- `Cache-Control: public, max-age=300, s-maxage=300`（
  `cache-policy.ts` の shared-cache opt-in）。Camo のキャッシュ窓は
  origin より長いため、画像内の観測時刻が鮮度の正本であり続ける
  （ADR-0024 §2.4 を継承）。

### 2.3 README の情報設計（配信側の前提）

- 作品画像は作品ごとに独立 URL を持ち、Markdown の `<a>` で個別
  リンクできる。`works.json` の `role` が hero / grid の主従を宣言
  する。
- セクション構成・ビジュアル比較・採用根拠は
  `docs/visual/github-profile-readme.md` が正本。

### 2.4 `/api/v1/github-profile/card` の廃止方針

- **即時削除はしない**。外部からの参照（旧 README の Camo キャッ
  シュ、ブックマーク、第三者の埋め込み）を壊さないため、
  deprecation 期間中は現行契約のまま配信を継続する。
- 応答に `Deprecation: true`（RFC 8594）を付与し、API
  ディレクトリ（`catalog.ts`）と runbook に deprecated を明記する。
- README 切替（rebuildup/rebuildup#5）が本番で確認できた後、
  次の minor リリースで削除する。削除判断は Camo キャッシュの
  実測（最悪でも数日）を待って行う。
- `/card` のコード（`card.ts` / `media-embed.ts` / works tile
  描画）は削除まで凍結する。`/status` はその panel レンダラを
  再利用するため、panel 部分の共有は維持する。

## 3. Consequences

- README 全体の画像転送量は旧カード 1 枚 ~1.23MB から、作品
  WebP 計 ~250KB + status SVG ~5KB + GitHub 標準要素へ減る。
- 作品画像はリクエスト時に R2 を読まない。Static Assets の配信で
  Worker CPU・D1・R2 のコストが発生しない。
- 作品選定・画像内容の変更は「snapshot 更新 → build script →
  commit → README 更新」の人手フローになる。`works.test.ts` が
  slug の公開整合を fail-closed で検証し、license inventory
  （`quality/asset-license-inventory.json`）が public/ 配下の
  出所を監査する。
- `/card` は deprecated のまま残り、`media-embed.ts` の R2
  アクセス経路も残る。削除リリースで `card.ts` の works tile・
  `media-embed.ts`・`FEATURED_SLUGS` / `WORK_TILE_COUNT` を
  まとめて除去する（`model.ts` の github/discord 射影は `/status`
  が使い続ける）。
- `http -> portfolio`（works 解決）と `http -> cloudflare`
  （isPublicMediaKey）の依存辺は変わらない。新しい owner・
  binding・外部サービスは追加しない。
