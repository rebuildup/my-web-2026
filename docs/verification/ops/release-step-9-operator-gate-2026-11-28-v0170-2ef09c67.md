# release step 9（operator ゲート）実行記録 — v0.17.0 候補 2ef09c67

- 対象: release ブランチ `release-0-17-0` の freeze 対象 commit
  `2ef09c67`（PR #1327 merge 後の head = 最終候補。#1299 / #1300 /
  #1305 / #1312 / #1306 / #1313 / #1323 を全て含む）
- 注記: 3 つの live 検査は `bf803427` 時点（2026-11-28）に実行した。
  その後の差分 `ce6eb56b`（bundle budget 再導出 + 本記録）と
  `2ef09c67`（E2E spec 鮮度切れ修正 + /stack の presentational
  component 置換）は runtime secret / binding / R2 / migration /
  wrangler 設定 / Infisical 契約のいずれにも触れないため、
  実測結果は最終候補へそのまま有効。凍結 run は最終候補で
  [46142074171](https://github.com/rebuildup/my-web-2026/actions/runs/46142074171)
  として success（Phase A 記録:
  [`attestation-byte-comparison-2026-11-28-2ef09c67.md`](../supply-chain/attestation-byte-comparison-2026-11-28-2ef09c67.md)）。
- 状態: **実施済み**。agent が operator 権限のある環境
  （本機の Infisical CLI 認証済みセッション）で実行した。
- 手順の正本: [`docs/release.md`](../../release.md) step 9、
  [`docs/runbook/r2-media-key-set-audit.md`](../../runbook/r2-media-key-set-audit.md)、
  [`docs/runbook/secret-rotation-status.md`](../../runbook/secret-rotation-status.md)
- 先行記録: [v0.16.0 dd4f5ebc](./release-step-9-operator-gate-2026-11-28-v0160-dd4f5ebc.md)、
  [v0.15.2](./release-step-9-operator-gate-2026-11-27-v0152.md)

**値は一切出力・記録していない**（status-only 契約、AGENTS.md §4）。

## 実行結果サマリ

| 半分 | 検査 | verdict | 状態 |
| --- | --- | --- | --- |
| A | R2 key-set audit（production read-only） | `OK` | **PASS** |
| B-1 | Infisical prod 契約観測 + live Worker（`check-cf-secrets --execute`） | `all checks OK`（Tier 3 live Worker 含む） | **PASS** |
| B-2 | secret 名 parity 分類（`secrets:status:check --observation`） | `OK`（drift_failures=0 / overdue=0 / advisory=5） | **PASS** |
| freeze | CI run [46142074171](https://github.com/rebuildup/my-web-2026/actions/runs/46142074171) `workflow_dispatch` @ `2ef09c67` | success（validate + storybook axe、Phase A PASS） | **PASS** |

## A. R2 key-set audit

```text
[r2-key-set] verdict=OK
[r2-key-set] reason=-
[r2-key-set] keys_total=163 keys_inside_allowlist=163 keys_outside_allowlist=0
[r2-key-set] allowlist_prefixes=2 prefix_source=src/cloudflare/media-visibility.ts
[r2-key-set] pages_walked=1 enumeration=complete
[r2-key-set] diff=none
```

exit 0。v0.16.0 と同一の 163 keys、allowlist 差分なし
（#1299/#1300/#1305/#1312/#1306/#1313 は Worker binding・R2 資産に
差分を持ち込まない）。

## B-1 / B-3. Infisical 契約観測 + live Worker

```text
[OK] Infisical runtime contract (4-name)
  extra:   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_API_TOKEN, CLOUDFLARE_R2_API_TOKEN, RELEASE_SMOKE_ADMIN_EMAIL, RELEASE_SMOKE_ADMIN_PASSWORD
[OK] Build Output binding contract (shared runtime, exact 3-name)
[check-cf-secrets] live Worker matches the "final" contract (auto-detected)
[OK] Cloudflare Worker (live) final contract
[execute] all checks OK
```

Tier 3（live Worker binding 観測）まで実施 — v0.16.0 と同じ
`final contract` 一致。transcript は `.tmp/cf-secrets-prod-bf803427.txt`
（status-only、値なし）。

## B-2. secret 名 parity 分類

```text
[secret-status] verdict=OK reason=-
[secret-status] counts rows=11 required=5 audit_only=1 drift_failures=0 overdue=0 advisory=5
```

v0.16.0 と同一の advisory=5（`UNEXPECTED` の運用 secret 5 件は契約外だが
既知・記録済み）。

## 実行上の注記（再現性のための記録）

- `CLOUDFLARE_API_TOKEN` は dev env `/` のみに、
  `CLOUDFLARE_R2_API_TOKEN` は prod env `/` のみに存在する構成は
  v0.16.0 と同一（今回も同じ配置を確認）。
- `INFISICAL_TOKEN` は `infisical user get token` の `Token:` 行から
  `grep '^Token: ' | awk '{print $2}'` で抽出。secret 値の取得は
  `INFISICAL_TOKEN` の export **前**に行う（export 後は
  `infisical secrets get` が失敗して空を返す — v0.16.0 記録と同じ
  順序制約を再確認）。
- `pnpm run secrets:status:check` は `-- --observation=` ではなく
  `--observation=`（pnpm の `--` 区切りを付けない）で渡す。
- exec 経由の環境変数はコマンドを跨いで保持されないため、
  token 取得と gate 実行は同一コマンド内で完結させた。

## v0.17.0 固有の補足（最終候補 2ef09c67 時点）

- runtime secret / binding / migration / wrangler 設定に差分なし
- リリース内容は全てアプリケーション層（about 再設計・data-heavy
  ページ・二次ページ・editorial primitive）の変更で、
  配信・secret・binding の契約面に変更を持ち込まない
