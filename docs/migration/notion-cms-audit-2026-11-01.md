# Notion CMS 採用前の現状監査（2026-11-01 / Issue #765）

> Status: **監査記録**。決定ではない。決定は
> [`ADR-0018`](../adr/ADR-0018-notion-as-portfolio-cms-source-of-truth.md)（Accepted 2026-11-01）。
> 測定は repository と `.reference/my-web-2025`（HEAD `ed1b9df`）に対して行った。

## 1. 目的

「Notion を CMS の SoT として採用する」と言ったとき、この repository の
どこが変わり、どこが変わってはいけないのかを、実装前に固定する。

対象: `src/portfolio/**`、`src/projects/**`（同期の前例）、`src/legal/**`（権利）、
`src/tools/artifact-inventory.ts`（隣接する別 owner）、`src/http/integrations/**` と
`quality/integration-scope.json`（接続の境界）。

## 2. portfolio の現在のデータ経路

```
Notion（未接続）        D1 portfolio_project / portfolio_link / portfolio_media
      ✗                          ▲
                                 │  offline script（seed / migrate / publish）
                    src/portfolio/load.ts  ──▶  src/portfolio/public.ts (server fn)
                                                      │
                                     src/routes/portfolio/{index,$slug}.tsx
                                     src/http/seo/sitemap.ts（公開 index のみ）
```

| 事実 | 出典 |
| --- | --- |
| 公開データの読み先は D1。R2 は `MEDIA` binding 経由のメディア実体のみ | `migrations/0007_portfolio.sql`, `src/portfolio/contract.ts` |
| 公開境界は `status='published' AND visibility='public'` で、SQL に固定されている | `src/portfolio/load.ts` `isVisible` + 各クエリ |
| 公開 server fn は `visibility` selector を受け取らない（公開面から unlisted を列挙できない） | `src/portfolio/public.ts` ヘッダ |
| detail の 1 リクエストは **3 query 以下**、list の budget は page size に対し sub-linear | `PORTFOLIO_DETAIL_QUERY_BUDGET = 3`, `portfolioListQueryBudget()` |
| D1 の公開データを書く runtime 経路は存在しない（書き手は `scripts/{seed,migrate,publish}-*` のみ） | `grep -rn portfolio_project src scripts` |
| メディア URL は 1 箇所でしか合成されない。`portfolio/` 以外の key は `null` になる | `src/portfolio/media.ts` `composeMediaUrl` |
| 公開された project の media 行だけが配信対象。行が外れれば即座に配信停止 | `src/portfolio/media-approval.ts` |
| 不正な href は inert な marker として描画される（silent rewrite しない） | `src/portfolio/markdown.lexer.ts` `classifyHref` |
| Notion 由来 HTML の sanitizer は存在するが **ingest 経路に接続されていない** | `src/portfolio/markdown.notion.ts`, `docs/portfolio/decisions.md` Decision 6 |
| admin に portfolio の編集 surface はない（emoji / images / invitations / keys のみ） | `src/admin/**` |

**含意**: Notion を入れる作業は「読み先を足す」ことではなく、
**D1 に到達する前段の authoring 境界を足す**ことである。runtime の読み先を
変えない限り、既存の公開境界・pagination・query budget は無傷で残る。

## 3. 同期の前例 — `src/projects/**`（Issue #621）

| 要素 | 実装 |
| --- | --- |
| 取得 | `scripts/sync-project-introductions.mjs`。3 つの allowlist 付き GitHub 公開 endpoint のみ |
| 成果物 | `src/projects/snapshots/dotfiles.json`（committed） |
| 検証 | reader 側 `isSnapshot()` は **shape check**、digest は offline gate（`node:crypto`） |
| freshness | `MAX_AGE_HOURS = 336`。`current` / `stale` / `unavailable` / `unknown` |
| 失敗 | transport 失敗は **何も書かない**、source-state 失敗は `availability: unavailable` + reason |
| 伝播 | `.github/workflows/projects-sync.yml` が PR を開く。base は repository variable。merge は human gate |
| runtime 通信 | 0 件（JSON は compile-time import） |

この形は ADR-0018 §2 の既定案の直接の前例である。**移植できない部分**は
2 つ: (a) `src/projects/**` は 1 件の introduction しか持たないが portfolio は
151 件規模、(b) portfolio には既存の D1 loader と公開境界がある。

## 4. 権利（`src/legal/**`）— 旧メディアは全て「未記録」

| 事実 | 出典 |
| --- | --- |
| 権利記録は `quality/asset-license-inventory.json`（`asset-license-inventory.v1`） | `src/legal/inventory.ts` `INVENTORY_SCHEMA` |
| 判定は記録から **導出** され、記録の無い asset は cleared にならない（fail-closed） | `src/legal/contract.ts` `evaluateAssetLicense` |
| 記録の scope は `public/**` と訪問者が取得する参照資産 | `quality/asset-license-inventory.json#scope` |
| **旧サイト由来の asset は 1 件も記録されていない**（`my-web-2025` / `legacy` / `portfolio/` の記載なし） | `grep` |

したがって #766 のメディア移行は、**全件が「権利未記録」から始まる**。
`src/portfolio/media.ts` は公開 prefix と公開判定しか見ないので、権利の
未記録を「非公開」に変換する層は **まだ存在しない**。ADR-0018 §2.6 は
この層を公開判定の一部として要求している。

## 5. 隣接する別 owner — `src/tools/artifact-inventory.ts`（Issue #466）

| 事実 | 出典 |
| --- | --- |
| Tool の checkout の licence と dependency を検証する **純粋 policy** | 同モジュール ヘッダ |
| gate は `scripts/check-tool-artifact-inventory.mjs`、build gate は `scripts/build-tools.mjs` | AGENTS.md §3 |
| 対象は `external/<slug>/` のバイトであり、portfolio が配信するメディアではない | AGENTS.md §3 legal 節 |

**含意**: portfolio メディアの権利は `src/legal/**` が所有し、
`artifact-inventory` に寄せない。2 つの owner が同じファイルを主張しない
（AGENTS.md §3 の legal 節が既に宣言している境界）。

## 6. 接続の境界

| 事実 | 出典 |
| --- | --- |
| notion は roster 上 `uncommitted`、`published_surface: none` | `docs/domain/integrations.md`, `quality/integration-scope.json` |
| allowlist は空。entry が無い状態で `published_surface` を `none` 以外にすると gate は error | `scripts/check-integration-scope.mjs` |
| `/integrations/*` は 404 固定。route を出す ticket は `boundary.test.ts` を同時に変える義務を負う | `src/http/integrations/boundary.test.ts` |
| scope 判定は `reviewConnection()` が唯一の oracle。ledger の宣言は gate が測定する | `src/http/integrations/scope-review.ts` |
| Notion の authority は scope string ではなく workspace の page / database 単位の capability。未 review の capability は `scope_outside_review` として拒否 | `docs/security/integration-token-scope.md` §2 |
| retention は notion 90 日、revocation は 24h 以内・手順 2 つ以上 | 同 §3–§4 |
| `wrangler*.jsonc` に integration token の名前を足すと、allowlist が空のうちは gate が error | 同 §6 |

**含意**: snapshot 方式では token は offline tooling の credential であり、
Worker の secret ではない。したがって `wrangler*.jsonc#secrets.required` を
**触らない**のが正しい実装である（触ると gate が落ちる）。

## 7. 既存 #78 成果物との関係（重複を作らないための整理）

Issue #78（closed 2026-10-03）は legacy 151 件の分類と D1 への移行経路を
すでに作っている。

| 資産 | 内容 | #765/#766 での扱い |
| --- | --- | --- |
| `docs/migration/portfolio-2025-to-2026-classification.json` | 159 行（151 legacy + 8 NEW）の二軸分類。eligible 48 / rewrite_required 12 / mechanical_drop 91 / new_candidate 8 | 台帳の **基礎として再利用** する（再分類は差分確認のみ） |
| `docs/migration/portfolio-2025-owner-review.md` | blocker 別の owner 判断面 | 同じ判断面を Notion 移行に引き継ぐ |
| `docs/migration/portfolio-2025-role-overrides.json` | `role_overrides` 4 件、`publication_overrides` **空** | owner 承認は 0 件のまま。agent は追加しない |
| `scripts/classify-portfolio-from-2025.mjs` | 分類器 | そのまま使える |
| `scripts/migrate-portfolio-from-2025.mjs` | D1 への apply。collision を exit 3 で拒否 | D1 への projection の前例。ADR-0018 §3.1 案 A の apply と同型 |
| `scripts/verify-portfolio.mjs` | 公開条件の検証 | 公開条件の SoT として再利用 |

**差分**: #78 は「legacy SQLite → D1」だった。#765 以降は
「Notion → snapshot → D1」になる。**authoring の SoT が移る**ので、
#78 の `role_overrides` / `publication_overrides` を Notion 側の property と
どう対応させるかが新しい決定点になる（ADR-0018 §5-4）。

## 8. 実装が触らなければならない穴（現状で存在しないもの）

1. **snapshot reader** — `src/portfolio` に Notion snapshot の schema / validation は無い。
2. **sync script** — Notion を読むコードは 1 行も無い。
3. **apply** — snapshot → D1 の投影経路（#78 の SQL 生成とは別物）。
4. **権利の非公開化** — 権利未記録の asset を公開対象から外す層。
5. **runtime の freshness 表示** — 現在 portfolio の page に「最終同期」の概念は無い。
6. **integration scope の昇格** — notion 行の status / allowlist entry は未変更。

## 9. 再測定コマンド（この監査を再現する）

```bash
# 旧サイトの clone（AGENTS.md §9）
git clone https://github.com/rebuildup/my-web-2025 .reference/my-web-2025

# 旧 DB の件数（read-only）
#   scripts/audit-legacy-portfolio.mjs は Issue #766 で追加する（この監査時点では未実装。
#   本監査の数値は sqlite3 の直接走査で採取した）
node scripts/audit-legacy-portfolio.mjs --source .reference/my-web-2025 --format=summary

# 既存の権利記録に legacy asset が無いこと
grep -c 'my-web-2025\|legacy' quality/asset-license-inventory.json   # → 0

# 接続境界
pnpm run integration:scope:check
```
