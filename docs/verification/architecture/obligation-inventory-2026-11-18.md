# Obligation 棚卸し — 消費者不在の 6 obligation（Issue #840 / O-12）

- 測定日: 2026-11-18 / base: `release-0-10-0`
- 方法: `grep -rn "from '.*<dir>/" src/` による importer 実測 + mount / route / test / AGENTS.md §3 宣言の突合
- 注意: 「消費者が今ない」ことは撤去理由にしない（O-12）。各項目の結論は **証拠** に基づく提案であり、撤去・統合の最終判断は owner の決定記録を要する（Issue #720 provenance 要件）

## 集計

| obligation | 本番 importer | mount/route | test/stories | AGENTS.md §3 edge | 提案 |
| --- | --- | --- | --- | --- | --- |
| `src/legal/**` | なし | なし | 5 | `legal -> editorial` 宣言済み | **維持**（配線判断は #822 系で進行中） |
| `src/external-api/**` | なし（コメント参照のみ） | なし | 6 | `external-api -> editorial` 宣言済み | **維持**（promotion 未決定の契約） |
| `src/http/api-directory/**` | なし | なし | 3 | `http` 配下（個別 edge 宣言なし） | **維持**（#530 で責務確定済み・公開面未配線） |
| `src/http/integrations/**` | なし | `/integrations` prefix 宣言済み・handler 未 mount | 3 | `server -> http` 経由 | **維持**（境界 prefix は契約として実在） |
| `src/http/webhooks/**` | なし | `/webhooks` prefix 宣言済み・handler 未 mount | 3 | 同上 | **維持**（同上） |
| `src/http/outbound.ts` | **あり**（`outbound-fetch.ts` 経由で vendor が使用） | — | 2 | `http -> cloudflare` | **維持（現役）** — 棚卸し時点の「import 0」は陳腐化 |

## 各 obligation の証拠

### 1. `src/legal/**`（9 files）

- **消費者**: `grep -rln "legal" src/routes/` → 0 件。`AssetLicenseReview.tsx` / `inventory.ts` を描く route は存在しない
- **テスト**: `inventory.test.ts` / `contract.test.ts` / `AssetLicenseReview.test.tsx` / `AssetLicenseReview.stories.tsx` / `inventory-table.test.ts`
- **宣言**: AGENTS.md §3「`legal -> editorial` … owns the rights / attribution / licence decision for every byte it publishes」。`quality/copy-editorial-surfaces.json` の `publicCopyFiles` に `src/legal/AssetLicenseReview.tsx` / `src/legal/contract.ts` が登録済み（公開 copy 面として宣言済み = 公開意図の証拠）
- **将来用途の根拠**: AGENTS.md §3 の obligation 宣言そのもの + Issue #811/#822（fail-closed 前提の owner 決定 PR が進行中）。配線先は asset license review の公開面
- **提案**: 維持。撤去は #822 の owner 決定を待つ

### 2. `src/external-api/**`（12 files）

- **消費者**: import 0 件。コメント参照のみ（`src/editorial/waiting/WaitingState.tsx:70`、`src/http/middleware/anomaly-monitor.ts`）
- **テスト**: 6 ファイル（contract / ExternalReadCard / boundary 系）
- **宣言**: AGENTS.md §3「`external-api -> editorial` … display primitives only」
- **将来用途の根拠**: `docs/domain/api.md` / Issue #530（API 責務の公開契約）/ #533（外部 read card）。外部データ源の degraded 表示契約として設計済み、promotion（route 配線）は未決定
- **提案**: 維持。未配線は欠陥ではなく「契約先行」の状態。promotion 判断は owner

### 3. `src/http/api-directory/**`（6 files）

- **消費者**: import 0 件。`UsableProductPublication.preview.ts` の記述文に名前が出るのみ
- **テスト**: `catalog.test.ts` / `drift.test.ts` / `catalog.stories.tsx`
- **宣言**: `http` obligation 配下。`catalog.ts` は `package.json` を読み API 一覧を生成、`drift.ts` は宣言と実装の drift 検査（binding 非依存と明記）
- **将来用途の根拠**: Issue #530（closed）で「配布可能な API サービスの責務と公開契約」が確定済み。公開 `/api` directory の preview/catalog 契約
- **提案**: 維持。公開面への配線判断は owner

### 4. `src/http/integrations/**`（6 files）

- **消費者**: import 0 件
- **mount**: `src/server.ts:62` と `src/http/external-boundary-mounts.ts:84-87` が `/integrations` を boundary prefix として宣言。**handler は mount されていない**（mounts ファイルのコメントが「declared, nothing is mounted」と明記 + probe path で契約を固定）
- **テスト**: `boundary.test.ts` / `fixtures.test.ts` / `scope-review.test.ts`
- **将来用途の根拠**: `server.ts` ヘッダの boundary 一覧（`/oauth/*`、`/integrations/*` = third-party integration adapters）
- **提案**: 維持。prefix 宣言 + probe は既に「契約が実在する」形で gate に組み込まれている

### 5. `src/http/webhooks/**`（6 files）

- **消費者**: import 0 件
- **mount**: `/webhooks` prefix 宣言済み・handler 未 mount（integrations と同型、`external-boundary-mounts.ts:73-77`）
- **テスト**: `boundary.test.ts` / `fixtures.test.ts` + `signature.test.ts`（HMAC 署名検証の window/TTL 契約）
- **将来用途の根拠**: `server.ts:23`「inbound webhooks from external services」
- **提案**: 維持。同上

### 6. `src/http/outbound.ts` — 棚卸し時点の記述は陳腐化

- **消費者**: `src/http/outbound-fetch.ts:6` が import し、`src/vendor/github-readme-stats-fast/common/utils.ts` が `fetchExternalUrl` 経由で使用（Issue #453 の deadline/size/redirect policy、#996 で timeout 強化済み）
- **提案**: 維持（現役）。O-12 の 2026-11-02 実測「import 0」はその後の #996/#933 配線で解消済み

## 「バックログ消失を再発させない」仕組み

- 本ファイルを **obligation 棚卸しの追跡可能な正本**とする。各 obligation の結論（維持/統合/撤去）が決まったら、本表の「提案」列を決定記録（Issue / ADR）へのリンクで更新する
- 撤去・統合の実行は owner 決定 + AGENTS.md §6「Issue closure requires evidence」に従い、決定記録なしに obligation を消さない
- 新規 obligation を追加する際は AGENTS.md §3 の依存方向宣言とセットで登録する（`scripts/check-architecture.mjs` が owner graph を検査する既存 gate に乗る）

## 残る owner 判断

1. `src/legal` の公開面配線（#822 系の決定に従属）
2. `external-api` / `api-directory` の promotion（公開 API surface を作るかの製品判断）
3. `integrations` / `webhooks` の handler 実装タイミング（外部連携の需要が立った時点）
4. 上記いずれの撤去・統合も、現時点では証拠上**推奨されない**（いずれも宣言済み契約または境界 prefix を持つ）
