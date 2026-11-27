# release step 9（operator ゲート）実行記録 — v0.16.0

- 対象: release ブランチ `release-0-16-0` の freeze 対象 commit
  `a7f0511a`（#1276 merge 後の head）
- 状態: **実施済み**。agent が operator 権限のある環境
  （本機の Infisical CLI 認証済みセッション）で実行した。
- 手順の正本: [`docs/release.md`](../../release.md) step 9、
  [`docs/runbook/r2-media-key-set-audit.md`](../../runbook/r2-media-key-set-audit.md)、
  [`docs/runbook/secret-rotation-status.md`](../../runbook/secret-rotation-status.md)
- 前回の同工程の実測例:
  [v0.15.2 の記録](./release-step-9-operator-gate-2026-11-27-v0152.md)

**値は一切出力・記録していない**（status-only 契約、AGENTS.md §4）。

## 実行結果サマリ

| 半分 | 検査 | verdict | 状態 |
| --- | --- | --- | --- |
| A | R2 key-set audit（production read-only） | `OK` | **PASS** |
| B-1 | Infisical prod 契約観測（`check-cf-secrets --execute`） | `all checks OK`（Tier 3 live Worker 含む） | **PASS** |
| B-2 | secret 名 parity 分類（`secrets:status:check --observation`） | `OK`（drift_failures=0 / overdue=0 / advisory=5） | **PASS** |
| step 8 | `pnpm run validate:release`（release-0-16-0 @ a7f0511a、ローカル） | gate 1–42 PASS、gate 43 `test` で環境起因 FAIL | **要注記** |

## A. R2 key-set audit

```text
[r2-key-set] verdict=OK
[r2-key-set] keys_total=163 keys_inside_allowlist=163 keys_outside_allowlist=0
[r2-key-set] enumeration=complete diff=none
```

exit 0。v0.15.2 実測（163 keys）から増減なし。

## B-1 / B-3. Infisical 契約観測 + live Worker

```text
[OK] Infisical runtime contract (4-name)
  extra:   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_API_TOKEN, CLOUDFLARE_R2_API_TOKEN, RELEASE_SMOKE_ADMIN_EMAIL, RELEASE_SMOKE_ADMIN_PASSWORD
[OK] Build Output binding contract (shared runtime, exact 3-name)
[check-cf-secrets] live Worker matches the "final" contract (auto-detected)
[OK] Cloudflare Worker (live) final contract
[execute] all checks OK
```

Tier 3（live Worker binding 観測）まで実施 — v0.15.2 と同じ
`final contract` 一致。

## B-2. secret 名 parity 分類

```text
[secret-status] verdict=OK reason=-
[secret-status] counts rows=11 required=5 audit_only=1 drift_failures=0 overdue=0 advisory=5
```

v0.15.2 と同一の advisory=5（`UNEXPECTED` の運用 secret 5 件は
契約外だが既知・記録済み）。

## step 8 `validate:release` の実行状況（正直な記録）

`release-0-16-0` @ `a7f0511a` の worktree で `pnpm run validate:release`
（85 gates）を実行。**gate 1–42 は全 PASS**（format / lint /
architecture / cf:config:drift `verdict=MATCH` / typecheck / 各種
contract check を含む）。

**gate 43 `pnpm run test` がローカル環境起因で FAIL**:

- vitest 全体で 245 files 中 3 files・計 3–20 tests が
  `Test timed out in 5000ms`（`test/integration/` の SSR fetch 系）。
- ログに `[warm-up] cold start over budget: 16446–46668ms` —
  workerd の cold start が test timeout 5s を恒常的に超過。
- 原因はホスト負荷: 実行時の load average が **16.98（10 cores）**、
  node/vite/workerd 系プロセス 67 個（複数エージェントセッションの
  dev server / build が並走）。タイムアウト値の問題ではなく
  リソース競合。
- **同一 SHA `a7f0511a` の freeze CI run
  [46046285117](https://github.com/rebuildup/my-web-2026/actions/runs/46046285117)
  は `validate:integration`（同テスト群を含む）を GitHub runner 上で
  全 PASS** — コード差分ではなくローカル環境の問題であることの
  裏付け。
- 対象 3 ファイルのみの再実行でも cold start 16.4s が再現し
  同じ timeout が発生（負荷が継続しているため）。

### 判定

- R2 / Infisical / parity の operator 半分は **全 PASS**。
- `validate:release` のローカル完走はホスト負荷の沈静後に再実行するか、
  freeze CI の `validate:integration` success をもって代替証跡とするかは
  release owner の判断事項。fail-closed の原則に従い、本記録は
  「gate 43 未通過（環境起因）」を偽らず記録する。
- 残り gate 44–85（build・attestation 系）は freeze CI run が同等の
  `validate:integration` step set を完走済み。

## v0.16.0 固有の補足

- runtime secret / binding / migration / wrangler 設定に差分なし
  （#1254 監視系は D1 読み取り + launchd + prod-smoke のみ、
  Worker binding 追加なし。#1262/#1264/#1268/#1286/#1284 は
  github-profile SVG 配信と stats ingest の route 個別 cap のみ）。
- D1 migration の追加なし。
