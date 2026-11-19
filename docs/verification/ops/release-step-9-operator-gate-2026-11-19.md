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
合わせて、release report の step 9 判定を確定する。<|end_message|><|message_model|>exec<|content_invoke_tool_json|>{