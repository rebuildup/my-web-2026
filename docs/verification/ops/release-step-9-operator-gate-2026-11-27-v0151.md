# release step 9（operator ゲート）実行記録 — v0.15.1

- 対象: release ブランチ `release-0-15-1` の freeze 対象 commit
  `e4380a46ee9f889d2bb1c5fbaca38a4770dd86b0`
- 状態: **実施済み・全 PASS**。agent が operator 権限のある環境
  （本機の Infisical CLI 認証済みセッション）で実行した。
- 手順の正本: [`docs/release.md`](../../release.md) step 9、
  [`docs/runbook/r2-media-key-set-audit.md`](../../runbook/r2-media-key-set-audit.md)、
  [`docs/runbook/secret-rotation-status.md`](../../runbook/secret-rotation-status.md)
- 前回の同工程の実測例:
  [v0.15.0 の記録](./release-step-9-operator-gate-2026-11-27.md)

**値は一切出力・記録していない**（status-only 契約、AGENTS.md §4）。

## 実行結果サマリ

| 半分 | 検査 | verdict | 状態 |
| --- | --- | --- | --- |
| A | R2 key-set audit（production read-only） | `OK` | **PASS** |
| B-1 | Infisical prod 契約観測（`check-cf-secrets --execute`） | `all checks OK` | **PASS** |
| B-2 | secret 名 parity 分類（`secrets:status:check --observation`） | `OK`（drift_failures=0 / overdue=0 / advisory=5） | **PASS** |
| B-3 | Cloudflare live Worker binding 観測（Tier 3） | `final contract` 一致 | **PASS** |

## A. R2 key-set audit

```text
[r2-key-set] verdict=OK
[r2-key-set] keys_total=163 keys_inside_allowlist=163 keys_outside_allowlist=0
[r2-key-set] enumeration=complete diff=none
```

exit 0。v0.15.0 実測から増減なし。

## B-1 / B-3. Infisical 契約観測 + live Worker

```text
[OK] Infisical runtime contract (4-name)
  extra:   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_API_TOKEN, CLOUDFLARE_R2_API_TOKEN, RELEASE_SMOKE_ADMIN_EMAIL, RELEASE_SMOKE_ADMIN_PASSWORD
[OK] Build Output binding contract (shared runtime, exact 3-name)
[check-cf-secrets] live Worker matches the "final" contract (auto-detected)
[OK] Cloudflare Worker (live) final contract
[execute] all checks OK
```

## B-2. secret 名 parity 分類

```text
[secret-status] verdict=OK reason=-
[secret-status] counts rows=11 required=5 audit_only=1 drift_failures=0 overdue=0 advisory=5
```

## v0.15.1 固有の補足

- runtime secret の増減なし。変更は `src/http/stats/router.ts` の
  ingest body 上限（route 個別 1 MiB）のみで、binding / secret /
  migration / wrangler 設定に差分はない。
- D1 migration の追加なし（0013 は v0.15.0 で適用済み）。
