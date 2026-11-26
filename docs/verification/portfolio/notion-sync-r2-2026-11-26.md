# Notion portfolio sync — production R2 実測と credential 配置の記録（Issue #1225）

- 日付: 2026-11-26（計測は同日 03:19–03:35 JST）
- 対象: production R2 bucket `my-web-2026` / `portfolio/notion/*` media
- 関連: PR #1230（`release-0-14-0` に merge 済み、merge commit `045a9782`）
- 手順の正本: [`docs/runbook/notion-portfolio-sync.md`](../../runbook/notion-portfolio-sync.md)

## 0. この記録が名乗ること・名乗らないこと

**名乗ること**: 2026-11-26 に status-only で実測した production の状態。
snapshot が参照する新規 24 object key が bucket に存在し、公開 media origin が
全件 200 を返すこと。release branch 上の 12 作品ページが production-readonly
データで描画され、cover 画像・alt・caption が揃うこと。

**名乗らないこと**:

1. **24 object を誰が・いつ upload したかの実行主体は本記録では特定しない。**
   key は content-addressed（`portfolio/notion/<sha256>.<ext>`）なので、key の
   存在は内容の一致を意味するが、upload 経路の attestation ではない。
2. **production deploy の検証ではない。** 公開面 `rebuildup.dev` は v0.13.0 の
   ままであり、`release-0-14-0`（v0.14.0）の deploy は通常の release 工程に
   委ねる。サイト上の最終確認は deploy 後に行う。

## 1. 実測（値・secret は出さない）

| 検査 | 方法 | 結果 |
| --- | --- | --- |
| bucket key 集合 | `infisical run --env=prod` 配下で `cf r2 objects list --bucket-name my-web-2026 --per-page 1000`（`CLOUDFLARE_R2_API_TOKEN` を `CLOUDFLARE_API_TOKEN` として子プロセスへ渡す `_r2.mjs` と同じ形） | 157 object。snapshot が参照する新規 24 key は**全件存在** |
| 公開配信 | `curl -I https://media.rebuildup.dev/<key>` × 24 | **全件 200** |
| release branch 描画 | `MY_WEB_2026_DATA_SOURCE=production-readonly pnpm dev:production-data`（worktree、release-0-14-0）で `/portfolio/<slug>` × 12 | 全件 200。cover `<img>` は `naturalWidth>0` で読込、alt/caption あり、broken 画像 0、横スクロールなし。`/portfolio` index に 12 slug 全件掲載 |

対象 slug（12）: `my-web-2026`, `herdr-t3`, `herdr-plugins`, `ac-test`,
`react-compiler-marker-cli`, `ae-test`, `ube-kosen-map`, `ido-bata-website`,
`looker`, `ae-devtools`, `ae-a8n`, `flashbeat-v02`。

## 2. 解消した不整合

先行する dry-run 記録（`records=74 findings=0 media=159 would_upload=143
reused=16`）は **local target の計画値**であり、「production への upload が
未実施」を意味しない。実測の結果、content-addressed key は既に production
bucket に存在していた。したがって本 Issue の 12 作品について追加の upload は
不要であり、snapshot commit（PR #1230）が指す key は全て deploy 先 bucket で
解決する（runbook §6.1 の commit 前確認と同じ判定を事後に実施）。

## 3. 再現性の gap（要 operator 対応）

`scripts/sync-portfolio-notion.mjs --r2-target=production` は 1 プロセスで
次の 2 系統の credential を同時に必要とする:

| 系統 | secret | 現在の所在（2026-11-26 実測） |
| --- | --- | --- |
| Notion 読み取り | `NOTION_TOKEN`, `NOTION_PORTFOLIO_DB_ID` | Infisical `dev` のみ |
| production R2 | `CLOUDFLARE_R2_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Infisical `prod` のみ |

`infisical run` は 1 env しか注入しないため、現状のままでは:

- `--env=dev` → `r2_list_failed`（R2 credential 不在）で sync abort
- `--env=prod` → `missing credential: NOTION_TOKEN is not set`（exit 3）

`NOTION_TOKEN` を `prod` に置くことは runbook §4 の方針（prod は本番
runtime が読む secret のみ）に反する。ty-plus 再撮影・server-bot など今後の
CMS 更新で本経路を再現するには、operator が次のいずれかを決める必要がある:

1. **`dev` env に R2 scoped credential をミラーする**（推奨候補）。
   `CLOUDFLARE_R2_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` は Worker runtime が
   binding 経由で使う値ではなく offline tooling credential であり、
   `NOTION_TOKEN` と同じ class。`dev` に置けば既存の documented 手順
   `infisical run --env=dev -- node scripts/sync-portfolio-notion.mjs
   --r2-target=production` がそのまま動く。
2. Infisical の secret import 等で `dev` 実行時に prod 側 secret を合成する
   （環境設定は operator 判断）。
3. `prod` 側に Notion 読み取り credential を置く — **非推奨**（§4 方針違反）。

いずれも secret の配置判断なので agent は実行しない。決定後は本記録と
`docs/runbook/notion-portfolio-sync.md` を更新する。
