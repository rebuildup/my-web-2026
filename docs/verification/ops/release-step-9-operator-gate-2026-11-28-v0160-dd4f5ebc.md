# release step 9（operator ゲート）実行記録 — v0.16.0 最終候補 dd4f5ebc

- 対象: release ブランチ `release-0-16-0` の freeze 対象 commit
  `dd4f5ebc`（#1282 / #1285 merge 後の head = 最終候補）
- 状態: **実施済み**。agent が operator 権限のある環境
  （本機の Infisical CLI 認証済みセッション）で実行した。
- 手順の正本: [`docs/release.md`](../../release.md) step 9、
  [`docs/runbook/r2-media-key-set-audit.md`](../../runbook/r2-media-key-set-audit.md)、
  [`docs/runbook/secret-rotation-status.md`](../../runbook/secret-rotation-status.md)
- 先行記録（旧候補 a7f0511a）:
  [v0.16.0 a7f0511a](./release-step-9-operator-gate-2026-11-28-v0160.md)、
  [v0.15.2](./release-step-9-operator-gate-2026-11-27-v0152.md)

**値は一切出力・記録していない**（status-only 契約、AGENTS.md §4）。

## 実行結果サマリ

| 半分 | 検査 | verdict | 状態 |
| --- | --- | --- | --- |
| A | R2 key-set audit（production read-only） | `OK` | **PASS** |
| B-1 | Infisical prod 契約観測 + live Worker（`check-cf-secrets --execute`） | `all checks OK`（Tier 3 live Worker 含む） | **PASS** |
| B-2 | secret 名 parity 分類（`secrets:status:check --observation`） | `OK`（drift_failures=0 / overdue=0 / advisory=5） | **PASS** |
| freeze | CI run [46103659171](https://github.com/rebuildup/my-web-2026/actions/runs/46103659171) `workflow_dispatch` @ `dd4f5ebc` | `validate:integration` + E2E + attestation 全 PASS | **PASS** |

## A. R2 key-set audit

```text
[r2-key-set] verdict=OK
[r2-key-set] keys_total=163 keys_inside_allowlist=163 keys_outside_allowlist=0
[r2-key-set] enumeration=complete diff=none
```

exit 0。v0.15.2 / a7f0511a と同一の 163 keys、allowlist 差分なし
（#1282/#1285 は Worker binding・R2 資産に差分を持ち込まない）。

## B-1 / B-3. Infisical 契約観測 + live Worker

```text
[OK] Infisical runtime contract (4-name)
  extra:   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_API_TOKEN, CLOUDFLARE_R2_API_TOKEN, RELEASE_SMOKE_ADMIN_EMAIL, RELEASE_SMOKE_ADMIN_PASSWORD
[OK] Build Output binding contract (shared runtime, exact 3-name)
[check-cf-secrets] live Worker matches the "final" contract (auto-detected)
[OK] Cloudflare Worker (live) final contract
[execute] all checks OK
```

Tier 3（live Worker binding 観測）まで実施 — 前回と同じ
`final contract` 一致。transcript は `.tmp/cf-secrets-prod-dd4f5ebc.txt`
（status-only、値なし）。

## B-2. secret 名 parity 分類

```text
[secret-status] verdict=OK reason=-
[secret-status] counts rows=11 required=5 audit_only=1 drift_failures=0 overdue=0 advisory=5
```

前回と同一の advisory=5（`UNEXPECTED` の運用 secret 5 件は契約外だが
既知・記録済み）。

## 実行上の注記（再現性のための記録）

- `INFISICAL_TOKEN` は `infisical user get token` の `Token:` 行から
  `grep '^Token: ' | awk '{print $2}'` で抽出（v0.15.2 記録と同じ手順）。
- Tier 3 用の `CLOUDFLARE_API_TOKEN` は **dev env `/` にのみ存在**し、
  prod env `/` には無い（v0.15.1 / v0.15.2 / a7f0511a と同じ構成）。
- **順序の注意**: `INFISICAL_TOKEN` を export した後に
  `infisical secrets get` を実行すると CLI が失敗して空を返すため、
  `CLOUDFLARE_API_TOKEN` は **先に** 取得する必要がある（今回の実測で
  判明。`--plain` 出力に upgrade notice が混入する場合があるため
  `tail -1` で最終行を取る）。
- `pnpm run validate:release` のローカル完走は引き続きホスト負荷で
  環境起因 FAIL となり得る（a7f0511a 記録 §step 8 参照）。正規の
  包括的検証は freeze CI run `46103659171` の
  `validate:integration` success が証跡であり、ローカル FAIL 記録は
  区別して維持する。

## v0.16.0 固有の補足（dd4f5ebc 時点）

- runtime secret / binding / migration / wrangler 設定に差分なし
  （#1282 は home 広告・NOW facts の表示修正、#1285 は portfolio
  detail hero の構成変更のみ。D1 migration 追加なし、Worker binding
  追加なし）。
- deploy 後の受入条件（`docs/release.md` Post-release）は不変:
  snapshot-health / prod-smoke（profile block 含む）/ Camo /
  定期同期の最終成功時刻 / catch-up / LKG / 部分失敗の 7 項目。
