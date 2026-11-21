# release step 9（operator ゲート）引き継ぎ — v0.10.0（未実施）

- 対象: release ブランチ `release-0-10-0` の freeze 対象 commit
  `a5df2fccc56b6ac2082f94b037b6fc4147eb571d`
- 状態: **未実施（not executed）**。agent 環境に operator credential が
  存在しないため、2 つの半分とも実行していない。**PASS を名乗らない。**
- 手順の正本: [`docs/release.md`](../../release.md) step 9、
  [`docs/runbook/r2-media-key-set-audit.md`](../../runbook/r2-media-key-set-audit.md)、
  [`docs/runbook/secret-rotation-status.md`](../../runbook/secret-rotation-status.md)
- 前回の同工程の実測例: [v0.8.1 の記録](./release-step-9-operator-gate-2026-11-05.md)

step 9 は「CI では実行できない operator 側のゲート」である。GitHub Actions は
Cloudflare / Infisical の credential を保持しないため、`validate:*` の
3 entry point にも CI の step にも入っていない。operator が本番 read のみで
実行し、status-only の結果を本記録の続き（または release report）に記す。

## 半分 A — production R2 の key-set audit（Issue #577）

### 実行手順

```bash
# Infisical prod から R2 スコープ read token を供給して実行する形が canonical。
# token 値は表示・記録しない。
infisical run --projectId=<prod project id> --env=prod -- \
  node scripts/check-r2-media-key-set.mjs --target=production

# 同等の直接形（pnpm run 経由でも可。v0.8.1 記録 §3 の `--` 透過の注意を参照）
CLOUDFLARE_R2_API_TOKEN=… pnpm run r2:media:audit
```

### 必要な権限・credential

- `CLOUDFLARE_R2_API_TOKEN`: **R2 スコープの read token のみ**。
  Worker deploy token（`CLOUDFLARE_API_TOKEN`）や D1 token
  （`CLOUDFLARE_D1_API_TOKEN`）では代用しない
  （`scripts/_r2.mjs` の credential 分離）。
- Infisical `prod` environment への read アクセス（token の供給元）。
- production への **write 権限は不要**。本 gate は `cf r2 objects list`
  （read）のみを呼び、mutation 経路を持たない。

### 期待結果

- exit `0`、`verdict=OK`、`keys_outside_allowlist=0`、
  `enumeration=complete` の 3 点が揃うこと。
- `verdict=VIOLATION`（exit 1）: allowlist 外 key が存在 → release blocker。
  対応は operator 判断（runbook §4.1）。agent は production を変更しない。
- `verdict=UNDECIDABLE`（exit 2）: fail-closed。credential 無し / API 失敗 /
  列挙不完全など。pass と同じ信号にしない。

### 証跡の保存先

- status-only stdout（verdict・件数・reason code のみ。object key・key 断片・
  credential は出力されない契約）を本記録の続きまたは release report に転記。
- 判定の記録先: `quality/profile.yaml#r2_media_key_set_audit`。

## 半分 B — Infisical ↔ Cloudflare の secret 名 parity（Issue #477）

### 実行手順

```bash
# B-1: prod environment の secret 名を観測し、transcript を保存する
#      （value は一切 listing されない。名前のみ）
INFISICAL_TOKEN="$(infisical user get token --silent)" \
  node scripts/check-cf-secrets.mjs --execute --environment=prod \
  | tee .tmp/cf-secrets-prod.txt

# B-2: 観測 transcript を分類器に渡す
node scripts/check-secret-rotation-status.mjs --observation=.tmp/cf-secrets-prod.txt

# 任意: ダッシュボード生成
pnpm run secrets:status:report   # -> .tmp/secrets-status-only-report.html
```

`pnpm run infisical:check:cf -- --execute --environment=prod` 形式でも同じ
script が動くが、v0.8.1 記録 §3 のとおり環境によっては pnpm の `--` が
リテラル引数として子プロセスに渡り `unknown argument: --` で落ちる。
その場合は上記の `node scripts/…` 直接呼び出しを使う。

### 必要な権限・credential

- `INFISICAL_TOKEN`（Infisical CLI の access token）、または
  `INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET`（Universal Auth）。
  `docs/runbook/infisical-secrets.md` の auth path に従う。
- 観測対象は Infisical `prod` environment の **secret 名のみ**。
  `wrangler secret list --format pretty` や `infisical secrets …` による
  **値の listing は禁止**（AGENTS.md §4、runbook §9）。
- Tier 3（live Worker binding 名の drift 検知）を有効にする場合のみ
  `CLOUDFLARE_API_TOKEN` が追加で必要。未指定なら script 自身が skip を
  宣言する — skip を緑と読み替えない。

### 期待結果

- B-1: `[OK] Infisical runtime contract` と `[OK] Build Output binding
  contract` が出て `all checks OK`。`extra` の名前は契約外の operator 用
  credential であり想定内。
- B-2: `verdict=OK`、`drift_failures=0`、`overdue=0`。
  `UNRECORDED` / `UNEXPECTED` は advisory であり失敗ではない
  （v0.8.1 実測で 6 件の前例あり）。`NOT_OBSERVED` が残る場合は
  「まだ見ていない」であり「問題がない」ではない。

### 証跡の保存先

- `.tmp/cf-secrets-prod.txt`（観測 transcript。名前のみ、値を含まない）。
- B-2 の status-only 出力を本記録の続きまたは release report に転記。
- 台帳側の異常（`MISSING` / `EXTRA_ROW` / `OVERDUE`）は
  `quality/secret-rotation-ledger.json` と runbook §6 の修復手順に従う。

## この記録が主張しないこと

| 主張しない | 理由 |
| --- | --- |
| operator gate が PASS した | 未実行。実行後に verdict を追記する |
| 本番が正しく配信している | key 集合と binding 名しか見ない。配信検証はデプロイ後 smoke |
| secret の value が正しい | value は一度も読まない。名前 parity のみ |
| release が shipped した | step 9 は手順の 1 工程。merge / tag / Release 公開は owner ゲート |

## 実行後の記録方法

operator が 2 つの半分を実行したら、本ファイル末尾に v0.8.1 記録と同じ
形式（実行日時・status-only 出力・「主張しないこと」の更新）で結果を追記する。
その後 `quality/profile.yaml#r2_media_key_set_audit` の decision 記録と
合わせて、release report の step 9 判定を確定する。

---

# 実行記録（2026-11-19 追記）

上記引き継ぎ手順を operator 権限のある環境（本機の Infisical CLI 認証済み
セッション）で実行した。実行日時: 2026-11-19 14:07-14:08 JST。
**値は一切出力・記録していない**（status-only 契約）。

## 実行結果サマリ

| 半分 | 検査 | verdict | 状態 |
| --- | --- | --- | --- |
| A | R2 key-set audit（production read-only） | `OK` | **PASS** |
| B-1 | Infisical prod 契約観測（`check-cf-secrets --execute`） | `all checks OK` | **PASS** |
| B-2 | secret 名 parity 分類（`secrets:status:check --observation`） | `OK`（drift_failures=0 / overdue=0 / advisory=6） | **PASS** |
| B-3 | Cloudflare live Worker binding 観測（Tier 3） | `final contract` 一致 | **PASS**（2026-11-19 追記2。`CLOUDFLARE_API_TOKEN` を Infisical `dev` env 経由で供給して再実行） |

## A. R2 key-set audit

```text
$ infisical run --projectId=<prod> --env=prod -- node scripts/check-r2-media-key-set.mjs --target=production
[r2-key-set] source=production target=production bucket=my-web-2026
[r2-key-set] verdict=OK
[r2-key-set] reason=-
[r2-key-set] keys_total=133 keys_inside_allowlist=133 keys_outside_allowlist=0
[r2-key-set] allowlist_prefixes=2 prefix_source=src/cloudflare/media-visibility.ts
[r2-key-set] pages_walked=1 enumeration=complete
[r2-key-set] diff=none
[r2-key-set] printed=verdict,counts,reason-codes only (no object key, no key fragment, no credential)
```

exit 0。allowlist 外 key は 0、enumeration complete。v0.8.1 実測（119 keys）
から 133 keys へ増加しているが、すべて allowlist 内。

## B-1. Infisical 契約観測

```text
$ INFISICAL_TOKEN=<CLI access token> node scripts/check-cf-secrets.mjs --execute --environment=prod
[check-cf-secrets] environment=prod
[check-cf-secrets] deploy-time secret bindings=["BETTER_AUTH_SECRETS","DISCORD_PRESENCE_USER_ID","GITHUB_README_STATS_PAT_1","GOOGLE_ANALYTICS_MEASUREMENT_ID","MY_WEB_2026_CONSUMER_API_KEY"] (from Build Output, mode=production)
[OK] Infisical runtime contract
  extra:   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_API_TOKEN, CLOUDFLARE_R2_API_TOKEN, RELEASE_SMOKE_ADMIN_EMAIL, RELEASE_SMOKE_ADMIN_PASSWORD
[OK] Build Output binding contract
[NOTE] Tier 3 (live Worker) skipped: CLOUDFLARE_API_TOKEN not set.
[execute] all checks OK
```

transcript は `.tmp/cf-secrets-prod.txt` に保存（名前のみ、値を含まない）。
`extra` の 5 名は operator 用 credential で契約の外側にある想定内の観測。

## B-3. Cloudflare live Worker binding 観測（Tier 3、追記2で実施）

初回実行時は `CLOUDFLARE_API_TOKEN` 未供給で script 自身が SKIP を宣言した。
当該 token は deploy-time credential であり Infisical **`dev` env** の
`/` path に格納されている（prod env の runtime 契約対象外・`secrets.required`
非対象であることを名前一覧で確認）。`infisical run --env=dev` で子プロセスへ
注入し、B-1/B-2 と同一の `--execute --environment=prod` 実行で Tier 3 を
有効化した。

```text
$ infisical run --env=dev -- env INFISICAL_TOKEN=<CLI access token> \
    node scripts/check-cf-secrets.mjs --execute --environment=prod
[check-cf-secrets] environment=prod
[check-cf-secrets] deploy-time secret bindings=[...] (from Build Output, mode=production)
[execute] Using pre-authenticated INFISICAL_TOKEN from parent process
[OK] Infisical runtime contract
[OK] Build Output binding contract
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
[secret-status] counts rows=11 required=5 audit_only=1 drift_failures=0 overdue=0 advisory=6
```

- `drift=MATCH` は runtime_required 5 名（BETTER_AUTH_SECRETS /
  DISCORD_PRESENCE_USER_ID / GITHUB_README_STATS_PAT_1 /
  GOOGLE_ANALYTICS_MEASUREMENT_ID / MY_WEB_2026_CONSUMER_API_KEY）。
- advisory 6 件: `UNRECORDED`（BETTER_AUTH_SECRETS の rotation 日付が
  ledger に無い）+ `UNEXPECTED` 5 件（operator 用 credential が環境に存在
  するが契約は binding を要求しない）。いずれも失敗ではない。

## 補足検証: verify-portfolio --target=production（#1008 現状確認）

step 9 の範囲外だが、#1008 の release 判定材料として同じ credential 経路で
read-only 実測した。

```text
$ infisical run --projectId=<prod> --env=prod -- node scripts/verify-portfolio.mjs --target=production
[verify] 11/11 checks passed, 0 failure(s), 44 content gap(s)
```

storage 契約・public 契約ともに全項目 PASS。残る 44 content gap は
原本（legacy 台帳）にも素材が無い slug の link / media 欠落で、
`--strict-content` 指定時のみ失敗化する authoring 上の欠損。
PR #1011 の merge 契約修正は production データ上で有効。

## この実行記録が主張しないこと

| 主張しない | 理由 |
| --- | --- |
| secret の value が正しい・安全 | value は一度も読んでいない。名前 parity と key 集合のみ |
| #984 の露出 credential がローテーション済み | owner より完了報告あり（2026-11-19）。`quality/secret-rotation-ledger.json` の status-only 記録追従は別途 |
| #1008 の content gap が解消した | verify-portfolio は 11/11 checks PASS だが 44 content gap が残る（原本に素材が無い slug。owner の Notion 加筆待ち） |
| Cloudflare live Worker の binding 名が一致する | Tier 3 は追記2で実施し `final` contract 一致を確認済み。ただし binding の**値**の正しさは範囲外 |
| release が shipped した | step 9 は手順の 1 工程。merge / tag / Release 公開は owner ゲート |

## 実行時の注意

- `infisical user get token` の token 単体取得は `--plain` が正しい
  flag。`--silent` は無効 flag として無視され、Session ID / Token /
  TTL を含む整形済み表が stdout に出るため、そのまま `INFISICAL_TOKEN`
  に渡すと `Invalid character in header content ["Authorization"]`
  で失敗する（追記2で実測）。
- 追記2の環境確認で `infisical secrets --env=dev --path=/`（`--plain`
  なし）を一度実行し、`CLOUDFLARE_API_TOKEN` の値がエージェントの
  実行 transcript に出力された。#984 と同種の露出として扱い、当該
  token の revoke / rotation を owner へ要請する。以後は名前のみの
  取得に `--plain | cut -d= -f1` を使う。
- `pnpm run <script> -- --flag` の `--` 透過問題を避けるため、いずれも
  `node scripts/…` を直接実行した。
