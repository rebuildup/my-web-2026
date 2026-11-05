# release step 9（operator ゲート）の実測 — v0.8.1

- 対象: release ブランチ `release-0-8-1` の head `d8239132`
- 状態: **2 つの半分とも OK**（R2 key-set audit / Infisical ↔ Cloudflare の secret 名 parity）
- 手順: [`docs/release.md`](../../release.md) step 9、
  [`docs/runbook/r2-media-key-set-audit.md`](../../runbook/r2-media-key-set-audit.md)、
  [`docs/runbook/secret-rotation-status.md`](../../runbook/secret-rotation-status.md)
- 実行日時: 2026-11-05 15:03–15:05 JST

step 9 は「CI では実行できない operator 側のゲート」である。GitHub Actions は
Cloudflare の credential を保持しないため、`validate:*` の 3 entry point にも
CI の step にも入っていない。本記録は、v0.8.1 のリリース判断のために
**リリース head に対して 2 つの半分を実行した結果**を残す。

## 1. 半分 A — production R2 の key-set audit

```text
$ infisical run --projectId=<prod> --env=prod -- \
    node scripts/check-r2-media-key-set.mjs --target=production
[r2-key-set] source=production target=production bucket=my-web-2026
[r2-key-set] verdict=OK
[r2-key-set] reason=-
[r2-key-set] keys_total=119 keys_inside_allowlist=119 keys_outside_allowlist=0
[r2-key-set] allowlist_prefixes=2 prefix_source=src/cloudflare/media-visibility.ts
[r2-key-set] pages_walked=1 enumeration=complete
[r2-key-set] diff=none
[r2-key-set] printed=verdict,counts,reason-codes only (no object key, no key fragment, no credential)
```

- verdict は `OK`。allowlist 外の object は **0**、enumeration は **complete**（打ち切りなし）。
- 出力は verdict / 件数 / reason code のみで、**object key・key の断片・credential は
  1 つも出していない**（runbook の status-only 契約）。
- この audit が言えるのは「bucket の key 集合が allowlist の内側にある」ことだけである。
  **配信が正しいことの証明ではない**（それはデプロイ後の本番 smoke の担当）。

## 2. 半分 B — Infisical ↔ Cloudflare の secret 名 parity

### 2.1 観測（`infisical:check:cf --execute`）

```text
$ INFISICAL_TOKEN=<CLI の access token> \
    node scripts/check-cf-secrets.mjs --execute --environment=prod
[check-cf-secrets] environment=prod
[check-cf-secrets] deploy-time secret bindings=["BETTER_AUTH_SECRETS","GOOGLE_ANALYTICS_MEASUREMENT_ID","MY_WEB_2026_CONSUMER_API_KEY"] (from Build Output, mode=production)
[execute] Using pre-authenticated INFISICAL_TOKEN from parent process
[execute] Listing Infisical prod secrets...
[OK] Infisical runtime contract (4-name)
  extra:   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_API_TOKEN, CLOUDFLARE_R2_API_TOKEN, RELEASE_SMOKE_ADMIN_EMAIL, RELEASE_SMOKE_ADMIN_PASSWORD
[OK] Build Output binding contract (shared runtime, exact 3-name)
[execute] [NOTE] Tier 3 (live Worker) skipped: CLOUDFLARE_API_TOKEN not set. Set it to enable drift detection against actual bound Worker secrets.
[execute] all checks OK
```

- Tier 1（Infisical の runtime 4-name）は充足。`extra` は operator 用 credential で、
  契約が要求する 3-name の外側にあることが**名前として**観測されただけである。
- Tier 2（Build Output の binding 契約）は **3-name ちょうど**で一致（不足も余剰もなし）。
- **Tier 3（実 Worker の binding 名）は未実行**。`CLOUDFLARE_API_TOKEN` を渡していないため
  script 自身が skip を宣言している。ここを緑と読み替えない。

### 2.2 分類（`secrets:status:check --observation`）

観測 transcript をそのまま分類器に渡した結果:

```text
[secret-status] source=repository ledger=quality/secret-rotation-ledger.json contract=scripts/_cloudflare-contract.mjs
[secret-status] verdict=OK reason=-
[secret-status] now=2026-11-05
[secret-status] counts rows=9 required=3 audit_only=1 drift_failures=0 overdue=0 advisory=6
[secret-status] row=BETTER_AUTH_SECRET tier=audit_only drift=MATCH deadline=EVENT_DRIVEN cadence=event_driven
[secret-status] row=BETTER_AUTH_SECRETS tier=runtime_required drift=MATCH deadline=UNRECORDED cadence=calendar:90d
[secret-status] row=GOOGLE_ANALYTICS_MEASUREMENT_ID tier=runtime_required drift=MATCH deadline=EVENT_DRIVEN cadence=event_driven
[secret-status] row=MY_WEB_2026_CONSUMER_API_KEY tier=runtime_required drift=MATCH deadline=EVENT_DRIVEN cadence=event_driven
[secret-status] row=CLOUDFLARE_ACCOUNT_ID tier=unowned drift=UNEXPECTED
[secret-status] row=CLOUDFLARE_D1_API_TOKEN tier=unowned drift=UNEXPECTED
[secret-status] row=CLOUDFLARE_R2_API_TOKEN tier=unowned drift=UNEXPECTED
[secret-status] row=RELEASE_SMOKE_ADMIN_EMAIL tier=unowned drift=UNEXPECTED
[secret-status] row=RELEASE_SMOKE_ADMIN_PASSWORD tier=unowned drift=UNEXPECTED
[secret-status] warn=UNRECORDED name=BETTER_AUTH_SECRETS detail=no rotation date recorded; the owner records it with the rotation
[secret-status] printed=status only (names, verdicts, counts, dates). No secret value is read, fetched, stored or printed; see AGENTS.md section 4
```

- verdict は `OK`。**drift failure 0 / overdue 0**。
- advisory は 6 件で、いずれも失敗ではない:
  - `UNRECORDED` 1 件（`BETTER_AUTH_SECRETS` のローテーション日が台帳に無い）。
    これは owner がローテーション時に記録する項目で、エージェントは日付を捏造しない。
  - `UNEXPECTED` 5 件（operator 用 credential が環境に在るが契約は binding を要求しない）。
    契約上は binding されない名前なので、観測されること自体が想定内である。
- 出力は名前・verdict・件数・日付のみ。**secret の value は読まず、取得せず、保存せず、
  印刷していない**（AGENTS.md §4）。

## 3. 実行時の注意（pnpm の `--` 透過）

この環境の pnpm では `pnpm run <script> -- --flag` の `--` が子プロセスに
**リテラルの引数として渡り**、script 側が `unknown argument: --` で落ちた。
本記録のコマンドは `node scripts/…` を直接呼んでいる。CI とローカルで同じ script を
実行していることに変わりはない。

## 4. この記録が主張しないこと

| 主張しない | 理由 |
| --- | --- |
| 本番が正しく配信している | key 集合と binding 名しか見ていない。配信の検証はデプロイ後の本番 smoke |
| 実 Worker の binding 名が Infisical と一致する | Tier 3 は `CLOUDFLARE_API_TOKEN` 未指定で skip された |
| secret の value が正しい | value は一度も読んでいない。名前 parity だけを見ている |
| `BETTER_AUTH_SECRETS` のローテーションが期限内 | 台帳に日付が無い（`UNRECORDED`）。owner の記録を待つ |
| リリースが完了した | step 9 はリリース手順の 1 工程である。merge / tag / Release 公開は owner ゲート |

## 5. 再現手順

```bash
# 半分 A（R2 key-set audit、read-only）
infisical run --projectId=<prod project id> --env=prod -- \
  node scripts/check-r2-media-key-set.mjs --target=production

# 半分 B-1（名前 parity の観測。transcript を保存する）
INFISICAL_TOKEN="$(infisical user get token --silent)" \
  node scripts/check-cf-secrets.mjs --execute --environment=prod \
  | tee .tmp/cf-secrets-prod.txt

# 半分 B-2（観測の分類）
node scripts/check-secret-rotation-status.mjs --observation=.tmp/cf-secrets-prod.txt
```

`INFISICAL_TOKEN` は CLI が返す access token で、値は表示しない。transcript には
名前だけが残る（`scripts/check-cf-secrets.mjs` の不変条件）。
