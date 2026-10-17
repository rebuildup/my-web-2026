# D1 query budget — Portfolio 一覧ページ (Issue #491)

Portfolio loader の代表読み取り面（`/portfolio` 一覧ページ = 可変行数を
D1 から読む唯一のページ）について、**statement 数 / 索引利用 / 所要時間**を
fixture 環境で実測し、N+1 を検出できる境界値をコードとして固定した記録。

- 測定コード: `src/portfolio/load.query-budget.test.ts`（workerd pool / 実 D1 binding）
- レポート生成: `scripts/d1-query-plan-report.mjs`（+ `scripts/d1-query-plan-report.test.mjs`）
- スクリーンショット: [`d1-query-plan.png`](./d1-query-plan.png)
- 対象 PR: #546 / Issue #491 / base `release-0-6-3`

## 1. 何が壊れていたか

修正前の `listPortfolioProjects` は、ページ内の**1 行ごとに**
`fetchLinks` と `fetchMedia` を await していた。

```ts
// 修正前（5d257d8）
for (const row of filteredRows) {
  const [links, media] = await Promise.all([fetchLinks(db, row.id), fetchMedia(db, row.id)]);
  projects.push(rowToProject(row, links, mediaWithUrls));
}
```

つまり 1 ページの statement 数は **`1 + 2N`**（N = ページ内の作品数）。
作品数が増えれば読点回数がそのまま増える、教科書的な N+1 だった。
索引利用自体は誤っていなかった（`EXPLAIN QUERY PLAN` でも
`idx_portfolio_link_project` を使っている）ので、**欠陥は索引選択では
なく round-trip 数**だった。修正はここ 1 要素に限定している。

## 2. 修正後の形（境界値）

`src/portfolio/load.ts` で link / media をページ単位のバッチ取得に変更した。

```ts
const [linksByProject, mediaByProject] = await Promise.all([
  fetchLinksForProjects(db, filteredRows.map((row) => row.id)),
  fetchMediaForProjects(db, filteredRows.map((row) => row.id)),
]);
```

| 面 | 境界値（export 済み） | 意味 |
| --- | --- | --- |
| 一覧 `/portfolio` | `portfolioListQueryBudget(n) = 1 + 2 * ceil(n / D1_BATCH_ID_CHUNK)` | `n ≤ 100` なら常に 3 |
| 詳細 `/portfolio/<slug>` | `PORTFOLIO_DETAIL_QUERY_BUDGET = 3` | 対象 1 + link 1 + media 1 |
| id chunk | `D1_BATCH_ID_CHUNK = 100` | D1 の bound parameter 上限（1 query あたり 100） |

D1 は 1 query あたりの bound parameter を 100 個までに制限する
（Cloudflare D1 platform limits）。バッチ query は id 1 個につき
bind 1 個しか使わないため、chunk サイズは上限と同じ 100 になる。
500 行ページでも 1 文で 500 bind は投げない。

`ORDER BY project_id, ...` は先頭に `project_id` を足すことで
プロジェクト単位の順序（`display_order ASC, created_at ASC` /
`is_cover DESC, display_order ASC, created_at ASC`）を保存している。
つまり `media[0]` が cover であること、link の並び順は従来と同一。

## 3. 実測（fixture 環境）

### 3.1 再現条件

| 項目 | ローカル（記録した実行） | CI |
| --- | --- | --- |
| source SHA | `eef3359`（このブランチの測定時 HEAD） | PR の head commit |
| OS / CPU | macOS 27.0.1 (Darwin 27.0.0), arm64, Apple M5 ×10, 24 GiB | `ubuntu-latest`（`.github/workflows/ci.yml`、標準 4 vCPUランナー） |
| Node / pnpm | v26.12.0 / 12.3.4 | 22.18 / 12.3.4（`quality/profile.yaml#ci.bootstrap`） |
| D1 | `vitest.config.ts` の **local miniflare SQLite binding**（`d1Databases.DB`）。本番 D1 には一切接続しない | 同左（`validate:integration` 内の `pnpm run test`） |
| Browser | なし（loader 呼び出し 1 回あたりの測定。ページ chrome は含まない） | なし |
| Network | なし（D1 binding は同一プロセス内のローカル SQLite） | なし |
| スキーマ | `migrations/0007_portfolio.sql` を `?raw` で読み込んで適用（コピーを手書きしていないため索引が乖離しない） | 同左 |
| fixture | public+published のみ。作品ごとに link 3 / media 2、作品数は 1 / 2 / 5 / 10 / 25 / 50 / 100 / 250 / 500 | 同左 |

再現コマンド:

```bash
# 1) 測定（console.log を残すため reporter を明示する）
pnpm exec vitest run src/portfolio/load.query-budget.test.ts --reporter=verbose \
  > .tmp/perf/vitest.log 2>&1

# 2) HTML レポート
node scripts/d1-query-plan-report.mjs \
  --input .tmp/perf/vitest.log \
  --out .tmp/perf/d1-query-plan.html \
  --source-sha "$(git rev-parse --short HEAD)"

# 3) スクリーンショット（Issue が要求する PNG）
pnpm exec playwright screenshot --full-page --viewport-size=1280,1000 \
  "file://$PWD/.tmp/perf/d1-query-plan.html" \
  docs/verification/perf/d1-query-plan.png
```

`d1-query-plan-report.mjs` は測定レコードが無い / 行が壊れている場合に
必ず exit 1 で失敗する（「何も走らなかった」を「N+1 なし」と読ませない）。

### 3.2 結果（statement 数）

| ページ内の作品数 | 修正前（N+1 形状） | 修正後 | 予算 | 所要時間（観測値） |
| --- | --- | --- | --- | --- |
| 1 | 3 | 3 | 3 | 6 ms |
| 2 | 5 | 3 | 3 | 5 ms |
| 5 | 11 | 3 | 3 | 2 ms |
| 10 | 21 | 3 | 3 | 6 ms |
| 25 | 51 | 3 | 3 | 5 ms |
| 50 | 101 | 3 | 3 | 9 ms |
| 100 | 201 | 3 | 3 | 12 ms |
| 250 | 501 | 7 | 7 | 22 ms |
| 500 | 1001 | 11 | 11 | 30 ms |

- 修正前の成長率 = **作品 1 あたり 2.000 statement**（線形 = N+1 の定義）。
- 修正後の成長率 = **作品 1 あたり 0.016 statement**（= `2 / 100`）。
  1 chunk に収まるページサイズ（≤ 100）では成長率 0。
- 500 作品ページで 1001 → 11 statement（**約 91 倍**の削減）。
- 詳細面 `/portfolio/<slug>` は全 fixture で 3 statement のまま（作品的
  link / media 件数に依存しない）。

### 3.3 索引利用（EXPLAIN QUERY PLAN）

| statement | plan |
| --- | --- |
| link（バッチ） | `SEARCH portfolio_link USING INDEX idx_portfolio_link_project (project_id=?)` + `USE TEMP B-TREE FOR LAST TERM OF ORDER BY` |
| media（バッチ） | `SEARCH portfolio_media USING INDEX idx_portfolio_media_project (project_id=?)` + `USE TEMP B-TREE FOR LAST 3 TERMS OF ORDER BY` |
| page（一覧） | `SEARCH portfolio_project USING INDEX idx_portfolio_project_status (status=? AND visibility=?)` + `USE TEMP B-TREE FOR ORDER BY` |
| link（修正前の per-row） | `SEARCH portfolio_link USING INDEX idx_portfolio_link_project (project_id=?)` + `USE TEMP B-TREE FOR LAST TERM OF ORDER BY` |

- 3 つの statement すべて **full scan ではなく index search**。
- 修正前も同じ索引を使っていた → N+1 の原因が索引選択ではないことを
  レポート自身が証明している。
- `USE TEMP B-TREE` は `created_at`（および `is_cover` / `pinned`）が索引の
  後ろにあるため。ソート対象は「そのチャンクに含まれる link / media 行」
  に閉じており、500 作品ページでも link 1500 / media 1000 行が上限。

## 4. 合格基準（gate の意味）

この Issue が gate に載せるのは **deterministic な statement 数だけ**。

1. 全 fixture サイズで `statements <= portfolioListQueryBudget(pageSize)`。
2. `pageSize <= D1_BATCH_ID_CHUNK` の範囲で statement 数が **一定**
   （成長率 0）。ここが N+1 検出の本体。
3. 成長率 `Δstatements / ΔpageSize <= 2 / D1_BATCH_ID_CHUNK = 0.02`。
4. 詳細面は全 fixture で `<= 3` かつ一定。
5. 3 つの statement が index search であること（`SCAN` が出ない）。
6. 1 文の bind 数が D1 上限 100 を超えないこと。
7. **検出器自体の検証**: 修正前の row-at-a-time 形状を同じハーネスで
   再生し、`1 + 2N` であることと budget 超過であることを assert する。
   これがないと「budget を通してしまう検出器」になってしまう。

## 5. 時間を gate にしない理由

所要時間は 2 ms 〜 30 ms の範囲で、実行環境（CI ランナー負荷・SQLite の
ページキャッシュ状態）で大きく動く。CPU / ネットワーク条件に依存する
gate を **この Issue で** 足すと、flaky な赤が「何が壊れたのか」を
覆い隠す。よって今回は:

- 時間は**観測値としてレポートに記録**する（gate ではない）。
- 実測時間にも合格基準を要求するのは #384（Lighthouse 再現コマンド）、
  #385（release gate）、#386（Web Vitals budget）の責務であり、本 Issue は
  それらの土台（deterministic な statement 数境界）だけを作る。

## 6. `quality/profile.yaml` への影響

- **gate の追加なし**。`gates.fast.components` の既存 `pnpm run test`
  （`vitest run`）の中で走るため、`validate:fast` / `validate:integration`
  の構成は変わらない。
- 追加されたのは **既存 `test` component 内の 1 ファイル**と、
  `package.json#scripts.test` に並んだ `scripts/d1-query-plan-report.test.mjs` 1 本。
- `change_risk_mapping` の区分は `src_unit`（`src/portfolio/**` のロジックと
  そのテスト）。binding 追加・entrypoint 変更・CI workflow 変更はないため
  `integration` gate への引き上げは不要。
- 意図的に **追加しなかったもの**: coverage threshold（ADR-0007 で 0.2.0
  まで延期）、Lighthouse / Web Vitals gate（#384–#386）、slow query の
  実時間 gate（§5）。

## 7. 既知の制約 / 今回の 1 要素に絞った理由

- 一覧クエリの `LIMIT ?` は `clampLimit` の上限 500。statement 数は
  chunk 数だけ増えるので、将来 limit を上げても線形にはならない。
- `fetchLinksForProjects` / `fetchMediaForProjects` は地図をメモリ上に
  持つ。500 作品 × (link 3 + media 2) で 2500 行程度であり、測定でも
  問題になるサイズではない。将来、作品数が数千件に増えた場合のみ
  cursor 分割（1 文あたり行数を抑える）を再検討する。
- 本 Issue は「検出できる状態 + この 1 要素の修正」まで。 Portfolio の
  実データ投入（publication curation）は別 Issue の責務であり、ここで
  fixture でサンプル作品数を作ることで代替していない。
- admin/preview 面のローダーは public 契約外（本ローダーは public-only）。
  したがって今回の statement 境界も public 面のみを対象としている。

## 8. 関連 Issue との重複回避

| Issue | 責務 | 関係 |
| --- | --- | --- |
| #384 | Lighthouse 測定を再現可能にする（計測基盤） | 時間・devtools 系の計測は **こちらではない**。本 Issue は statement 数 |
| #385 | Lighthouse 95 点の release gate | gate の追加は **していない** |
| #386 | Web Vitals / 転送量の budget | 同上。時間 budget の責務 |
| #387 | PR に画像を必須化する仕組み | 本 PR の画像は `docs/verification/perf/d1-query-plan.png`（Issue #491 指定パス）。要求仕組み自体は別 Issue |

`docs/release.md` のリリースフローは変更していない。