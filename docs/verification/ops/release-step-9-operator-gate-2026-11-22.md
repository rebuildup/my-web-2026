# release step 9（operator ゲート）実行記録 — v0.12.0

- 対象: release ブランチ `release-0-12-0` の freeze 対象 commit
  `b7ec6e39f1a3285eaa9e5a969b0e87dae272161d`
- 状態: **実施済み・全 PASS**。owner が 2026-11-22 にリリース候補
  `b7ec6e39` の本番リリースを明示承認したうえで、agent が operator
  権限のある環境（本機の Infisical CLI 認証済みセッション）で実行した。
- 手順の正本: [`docs/release.md`](../../release.md) step 9、
  [`docs/runbook/r2-media-key-set-audit.md`](../../runbook/r2-media-key-set-audit.md)、
  [`docs/runbook/secret-rotation-status.md`](../../runbook/secret-rotation-status.md)
- 前回の同工程の実測例:
  [v0.10.0 の記録](./release-step-9-operator-gate-2026-11-19.md)

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
$ infisical run --env=prod -- node scripts/check-r2-media-key-set.mjs --target=production
[r2-key-set] source=production target=production bucket=my-web-2026
[r2-key-set] verdict=OK
[r2-key-set] reason=-
[r2-key-set] keys_total=133 keys_inside_allowlist=133 keys_outside_allowlist=0
[r2-key-set] allowlist_prefixes=2 prefix_source=src/cloudflare/media-visibility.ts
[r2-key-set] pages_walked=1 enumeration=complete
[r2-key-set] diff=none
[r2-key-set] printed=verdict,counts,reason-codes only (no object key, no key fragment, no credential)
```

exit 0。allowlist 外 key は 0、enumeration complete。v0.10.0 実測
（133 keys）と同数で、すべて allowlist 内。

## B-1. Infisical 契約観測

```text
$ INFISICAL_TOKEN=<CLI access token> node scripts/check-cf-secrets.mjs --execute --environment=prod
[check-cf-secrets] environment=prod
[check-cf-secrets] deploy-time secret bindings=["BETTER_AUTH_SECRETS","DISCORD_PRESENCE_USER_ID","GITHUB_README_STATS_PAT_1","GOOGLE_ANALYTICS_MEASUREMENT_ID","MY_WEB_2026_CONSUMER_API_KEY"] (from Build Output, mode=production)
[execute] Using pre-authenticated INFISICAL_TOKEN from parent process
[OK] Infisical runtime contract (4-name)
  extra:   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_API_TOKEN, CLOUDFLARE_R2_API_TOKEN, RELEASE_SMOKE_ADMIN_EMAIL, RELEASE_SMOKE_ADMIN_PASSWORD
[OK] Build Output binding contract (shared runtime, exact 3-name)
[NOTE] Tier 3 (live Worker) skipped: CLOUDFLARE_API_TOKEN not set.
[execute] all checks OK
```

transcript は `.tmp/cf-secrets-prod.txt` に保存（名前のみ、値を含まない）。
`extra` の 5 名は operator 用 credential で契約の外側にある想定内の観測。

## B-3. Cloudflare live Worker binding 観測（Tier 3）

`CLOUDFLARE_API_TOKEN` は deploy-time credential であり Infisical `dev`
env の `/` path に格納されている（v0.10.0 記録と同じ経路）。
`infisical run --env=dev` で子プロセスへ注入し、B-1/B-2 と同一の
`--execute --environment=prod` 実行で Tier 3 を有効化した。

```text
$ infisical run --env=dev -- env INFISICAL_TOKEN=<CLI access token> \
    node scripts/check-cf-secrets.mjs --execute --environment=prod
[execute] Using pre-authenticated INFISICAL_TOKEN from parent process
[OK] Infisical runtime contract (4-name)
[OK] Build Output binding contract (shared runtime, exact 3-name)
[check-cf-secrets] live Worker matches the "final" contract (auto-detected)
[OK] Cloudflare Worker (live) final contract
[execute] all checks OK
```

exit 0。live Worker の binding **名** が `final` contract と一致することを
`wrangler secret list`（names only）で確認した。secret の値そのものは
一切読んでいない。

## B-2. secret 名 parity 分類

```text
$ node scripts/check-secret-rotation-status.mjs --observation=.tmp/cf-secrets-prod.txt
[secret-status] verdict=OK reason=-
[secret-status] counts rows=11 required=5 audit_only=1 drift_failures=0 overdue=0 advisory=5
```

- `drift=MATCH` は runtime_required 5 名（BETTER_AUTH_SECRETS /
  DISCORD_PRESENCE_USER_ID / GITHUB_README_STATS_PAT_1 /
  GOOGLE_ANALYTICS_MEASUREMENT_ID / MY_WEB_2026_CONSUMER_API_KEY）。
- advisory 5 件: `UNEXPECTED`（operator 用 credential が環境に存在するが
  契約は binding を要求しない）。いずれも失敗ではない。

## この実行記録が主張しないこと

| 主張しない | 理由 |
| --- | --- |
| secret の value が正しい・安全 | value は一度も読んでいない。名前 parity と key 集合のみ |
| 本番が正しく配信している | key 集合と binding 名しか見ない。配信検証はデプロイ後 smoke |
| release が shipped した | step 9 は手順の 1 工程。merge / tag / Release 公開は owner ゲート（本件は owner 承認済み） |
