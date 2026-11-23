# release step 9（operator ゲート）実行記録 — v0.13.0

- 対象: release ブランチ `release-0-13-0` の freeze 対象 commit
  `90bc3bc429519ea2791d4dc87845b1c2b5c62535`
- 状態: **実施済み・全 PASS**。agent が operator 権限のある環境
  （本機の Infisical CLI 認証済みセッション）で実行した。
- 手順の正本: [`docs/release.md`](../../release.md) step 9、
  [`docs/runbook/r2-media-key-set-audit.md`](../../runbook/r2-media-key-set-audit.md)、
  [`docs/runbook/secret-rotation-status.md`](../../runbook/secret-rotation-status.md)
- 前回の同工程の実測例:
  [v0.12.0 の記録](./release-step-9-operator-gate-2026-11-22.md)

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

exit 0。allowlist 外 key は 0、enumeration complete。v0.12.0 実測
（133 keys）と同数で、すべて allowlist 内。v0.13.0 で追加した
`public/github-profile/works/*.webp` は静的 asset であり R2 key-set
の対象外である。

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

## B-2. secret 名 parity 分類

```text
$ node scripts/check-secret-rotation-status.mjs --observation=.tmp/cf-secrets-prod.txt
[secret-status] verdict=OK reason=-
[secret-status] observation=observed environment=prod
[secret-status] counts rows=11 required=5 audit_only=1 drift_failures=0 overdue=0 advisory=5
```

exit 0。runtime_required 5 名はすべて `MATCH`。`UNEXPECTED` の警告は
operator 用 credential 5 名（CLOUDFLARE_ACCOUNT_ID /
CLOUDFLARE_D1_API_TOKEN / CLOUDFLARE_R2_API_TOKEN /
RELEASE_SMOKE_ADMIN_EMAIL / RELEASE_SMOKE_ADMIN_PASSWORD）で、契約の
外側にある想定内の観測（v0.12.0 記録と同じ）。

## B-3. Cloudflare live Worker binding 観測（Tier 3）

`CLOUDFLARE_API_TOKEN` は deploy-time credential であり Infisical `dev`
env の `/` path に格納されている（v0.12.0 記録と同じ経路）。
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
