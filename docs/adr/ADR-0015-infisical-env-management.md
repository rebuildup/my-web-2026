# ADR-0015 — Infisical による runtime / build credentials の SoT 統合

- Status: Accepted (Phase 2 complete at e32285d / eccd31e; Phase 1 agent scope amended 2026-09-27 — Issue #67)
- Date: 2026-09-26 (last revised: 2026-09-27)
- Deciders: repository owner
- Consulted: ADR-0009 (Better Auth), ADR-0010 (rate-limit), ADR-0011 (consumer pattern), ADR-0013 (emoji catalog), ADR-0014 (canonical domain)
- Supersedes: なし
- Related: `docs/runbook/cloudflare-workers-builds.md`, `docs/runbook/consumer-api-key-rotation.md`

## Context

my-web-2026 の secret / credential 管理は 0.3.4 時点で 3 箇所に分散している:

1. **Cloudflare Workers「Settings > Variables & Secrets」**: `BETTER_AUTH_SECRET`, `MY_WEB_2026_CONSUMER_API_KEY` (`wrangler secret put` 経由)
2. **Cloudflare Workers Builds「Settings > Builds」**: API token (Workers Scripts:Edit + Routes:Edit + D1:Edit + R2:Edit), Account ID, build vars (`NODE_VERSION` / `PNPM_VERSION`)
3. **Wrangler config (`wrangler.jsonc` / `wrangler.production.jsonc`)**: static vars (`MY_WEB_2026_REACTIONS_TARGET`, `MY_WEB_2026_COUNTER_KEY`, `BETTER_AUTH_URL`)、識別子

GitHub Repository Secrets は現在空 (`production` env を含む全スコープで `total: 0`)。これは eccd31e (PR #51, release-0-3-2) で production deploy を Cloudflare Workers Builds に移管した結果として意図的に空になった。

問題点:

- secret 値のローテーション runbook が存在せず、operator の手作業 (`wrangler secret put`) のみで運用されている
- `MY_WEB_2026_CONSUMER_API_KEY` は D1 の `apikey` 行とペアで運用すべきだが、ペア更新の手順が runbook 化されていない
- Cloudflare Workers Builds UI 設定と Cloudflare Worker secret が手動で同期されており、drift 検出の仕組みがない
- env / secret / credential の SoT が分散しており、新しい env を追加するたびに「Wrangler config を変えるか、Cloudflare UI を変えるか、Infisical / Doppler / 1Password / Vault を使うか」を毎回判断している

## Decision

**Infisical を `runtime / build credentials and secrets` の SoT に据える。** static non-secret vars / 識別子 / Cloudflare 認証境界は SoT の対象外として明示的に除外する。

### 1. SoT 境界

| 項目 | SoT | 理由 |
| --- | --- | --- |
| `BETTER_AUTH_SECRETS` | **Infisical (prod / dev)** | Better Auth 1.5+ versioned rotation (comma-separated `version:value` pairs, highest version first — first entry is the current signing key). Phase 3 で `secrets.required` に登録して必須化 |
| `BETTER_AUTH_SECRET` | **Infisical (prod / dev)** | Better Auth legacy single form (Phase 1-2 移行期間の backward compat。Phase 3 で `BETTER_AUTH_SECRETS` を `secrets.required` に登録した後、本行は **任意運用** — `secrets.required` には含めず (§9 同期)、legacy 完全削除は Phase 5 runbook で明示) |
| `MY_WEB_2026_CONSUMER_API_KEY` | **Infisical (prod / dev)** | runtime secret (D1 とペア、§6 rotation runbook) |
| Workers Builds native Build API token (`build_token_uuid`) | **Cloudflare** | Cloudflare 認証境界。消せない |
| `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` | **Cloudflare Workers Builds env vars** | Universal Auth bootstrap |
| `MY_WEB_2026_REACTIONS_TARGET` | **Wrangler config (`vars`)** | static non-secret vars、`Env` 型契約維持 |
| `MY_WEB_2026_COUNTER_KEY` | **Wrangler config (`vars`)** | 同上 |
| `BETTER_AUTH_URL=https://rebuildup.dev` | **Wrangler config (prod `vars`)** | ADR-0014 で source-controlled として決定 |
| `CLOUDFLARE_ACCOUNT_ID` | **Wrangler config** | 識別子 |
| `NODE_VERSION` / `PNPM_VERSION` | **Cloudflare build vars / repo `.nvmrc`** | Cloudflare が build image 起動前に決める |
| `database_id` / `bucket_name` / `zone_id` / `namespace_id` | **Wrangler config** | 識別子 (secret ではない) |

**Infisical のスコープは限定する**。理由:

- static non-secret vars (`MY_WEB_2026_REACTIONS_TARGET` / `MY_WEB_2026_COUNTER_KEY` / `BETTER_AUTH_URL`) は ADR-0014 で source-controlled config として決定された値であり、`wrangler types` で生成される `worker-configuration.d.ts` の `Env` 型契約に組み込まれている。これらを Infisical に移すと `Env` 型が消える
- Cloudflare Workers Builds の `build_token_uuid` は Cloudflare の認証境界そのもので、消せない
- `NODE_VERSION` / `PNPM_VERSION` は Cloudflare が build image 起動前に消費するため、Infisical 経由では間に合わない

### 2. Infisical project 構成

| Field | Value |
| --- | --- |
| project 名 | `my-web-2026` |
| instance | self-host (`https://secrets.rebuildup.dev`) |
| environments (slug) | `dev` / `prod` (表示名 `Development` / `Production`) |
| secrets (envごと) | `BETTER_AUTH_SECRETS` (preferred, comma-separated `2:<new>,1:<old>` form), `BETTER_AUTH_SECRET` (legacy single form, 移行期間中の backward compat), `MY_WEB_2026_CONSUMER_API_KEY` |

### 3. Universal Auth (HTTPS POST + `INFISICAL_TOKEN` env var + self-host domain)

Workers Builds の CI 経路で Universal Auth を使う。短命 access token を取得するために、`infisical login` CLI を shell-less に呼ばず、**HTTPS POST body** で直接 Universal Auth login API を叩く。**client secret も argv には出さない** (Infisical token / runtime secrets と同じ invariant の対象)。`scripts/deploy-with-secrets.mjs` 内部 (Phase 2 実装):

```text
1. .infisical.json から workspaceId を読む
2. POST ${INFISICAL_API_URL}/api/v1/auth/universal-auth/login
   body: { clientId: process.env.INFISICAL_CLIENT_ID,
           clientSecret: process.env.INFISICAL_CLIENT_SECRET }
   headers: Content-Type: application/json
   → response.accessToken (短命) を取得。argv / log には出さない
3. parent process.env に INFISICAL_TOKEN=<accessToken> を export (Infisical 公式 env var)
4. infisical run --projectId=$WORKSPACE_ID --env=prod -- <command>
   (--token flag は使わない。INFISICAL_TOKEN を env var 経由で渡す)
```

`INFISICAL_API_URL=https://secrets.rebuildup.dev` は `deploy-with-secrets.mjs` 内の **committed constant** で default 設定する (これは secret ではなく、Wrangler `vars` か deploy script 内の `const` で source-controlled として持つ)。env var `INFISICAL_API_URL` で override 可能 (staging / dev override 用)。**operator shell rc に依存しない** — Workers Builds ephemeral container には operator の shell rc が存在しないため、deploy script 内 constant + env var override の二段構えで解決する。

`projectId` の SoT は `.infisical.json#workspaceId`。`INFISICAL_PROJECT_ID` を Cloudflare UI に重複して持たない。

### 4. Deploy script (`scripts/deploy-with-secrets.mjs`)

`deploy-with-secrets.mjs` は Node のみで完結する。bash / jq / shell pipe は使わず、Node `child_process.spawn` (shell-less argv array) で wrangler と db-migrate を直接起動する。`scripts/check-production-deploy.mjs` を template に転用する (prod dry-run と同じ tempdir + `finally rmSync` パターン)。

```text
deploy-with-secrets.mjs
├─ stale tempdir cleanup (冒頭): os.tmpdir() 配下の my-web-2026-deploy-* を scan、
│   24h 以上前のものは削除 (SIGKILL / runner teardown 残留対策、local recovery 用)
├─ .infisical.json から workspaceId を読む
├─ INFISICAL_API_URL は committed constant (default https://secrets.rebuildup.dev)
│   env var override 可 (staging / dev 用)
├─ HTTPS POST ${INFISICAL_API_URL}/api/v1/auth/universal-auth/login
│   body: { clientId: INFISICAL_CLIENT_ID, clientSecret: INFISICAL_CLIENT_SECRET }
│   → response.accessToken を取得 (argv / log に出さない)
├─ INFISICAL_TOKEN=<accessToken> を親 process.env に export (Infisical 公式 env var)
├─ process.env から INFISICAL_CLIENT_ID / INFISICAL_CLIENT_SECRET を削除
│   (post-auth 不要、residency を最小化)
├─ infisical run --projectId=$WORKSPACE_ID --env=prod -- node scripts/run-deploy-inner.mjs
│ └─ 子 process (injected env by `infisical run` の公式 contract)
│        ├─ process.env.BETTER_AUTH_SECRETS / process.env.MY_WEB_2026_CONSUMER_API_KEY を読み取り
│        ├─ fs.mkdtempSync(path.join(os.tmpdir(), 'my-web-2026-deploy-'))
│        ├─ fs.writeFileSync(secretsFile, JSON.stringify({...}), { mode: 0o600 })
│        ├─ sanitizedEnv = { ...process.env } から BETTER_AUTH_SECRETS /
│        │   BETTER_AUTH_SECRET / MY_WEB_2026_CONSUMER_API_KEY / INFISICAL_TOKEN を削除
│        ├─ spawn(pnpm, ['run', 'db:migrate:production'], { env: sanitizedEnv })
│        │   (db:migrate は D1 スキーマ更新のみで runtime secret を必要としない)
│        ├─ spawn(wranglerCli, ['deploy', '-c', 'wrangler.production.jsonc',
│        │                      '--secrets-file', secretsFile], { env: sanitizedEnv })
│        │   (Wrangler は secrets を process.env ではなく --secrets-file から読む)
│        └─ finally: fs.rmSync(dir, { recursive: true, force: true })
└─ 親 process は TOKEN を即座に release (overwrite + unsetenv)
```

**Invariant (fixed)**:

- **runtime secret を argv / log へ出さない。Infisical token / runtime secrets は必要な child process environment にのみ存在させ、永続化しない。**
- **Machine Identity の client secret も argv に出さない** (HTTPS POST body で Universal Auth login API を直接呼ぶ。`infisical login --client-secret` 形式は禁止)。
- **db:migrate / Wrangler deploy child には runtime secret を継承させない** (sanitized env を渡す。Wrangler deploy は `--secrets-file` 経由のみで secrets を受け取る。`infisical run` 配下の wrapper process のみが secrets を `process.env` に持つ)。
- **temp secrets file は repo root ではなく `os.tmpdir()` 配下**、unique directory + `mode: 0o600` + `finally rmSync({recursive:true, force:true})`。

**Abrupt termination handling**:

- **normal exit**: `finally` 句で `os.tmpdir()/my-web-2026-deploy-*` を削除
- **SIGKILL / runner teardown**: Cloudflare Workers Builds ephemeral container は teardown で container ごと消えるため、残留 secret file は container 外に出ない
- **local recovery (operator 手動 deploy)**: deploy script 冒頭で `os.tmpdir()` 配下の `my-web-2026-deploy-*` を scan、24h 以上前の stale tempdir を cleanup (Phase 2 実装詳細)

**Scope note**: child-process env injection (`infisical run` の公式 contract: secret は child `process.env` に inject される) は **scoped to the immediate `node scripts/run-deploy-inner.mjs` invocation** として許可する。invariant は argv / log discipline + db:migrate/Wrangler への secret 継承禁止 を guard するものであって、inner wrapper process の `process.env` 内の secret 存在を否定するものではない。

### 5. `deploy:production` レイヤリング維持

既存の `deploy:production = pnpm run build && pnpm run deploy:production:prepared` の構造を維持する。`deploy:production:prepared` のみ Infisical 経由に置き換える:

| command | 用途 | 動作 |
| --- | --- | --- |
| `pnpm run build` | build 単独 | Vite build |
| `pnpm run deploy:production:prepared` | build 済み deploy | `node scripts/deploy-with-secrets.mjs` |
| `pnpm run deploy:production` | ローカル recovery | `pnpm run build && pnpm run deploy:production:prepared` |

Workers Builds の対応:

| Workers Builds UI | command |
| --- | --- |
| Build command | `pnpm run build` |
| Deploy command | `pnpm run deploy:production:prepared` |

### 6. `MY_WEB_2026_CONSUMER_API_KEY` rotation runbook

Infisical 変更だけで rotate しない。**既存 enabled row の確認 → 新規作成 → deploy → 旧 disable** の順で進める。bootstrap が返すのは **新 key の id** のみで、旧 row id は bootstrap 前の query で確定する。

```
0. 既存 enabled row の確認:
   `home-self-consumption` name で `enabled=1` の apikey 行を query。
   - 0 件: 初回作成。step 1 へ (oldKeyId 不要、step 5 も不要)
   - 1 件: oldKeyId を取得。step 1 へ
   - 2 件以上: 自動 rotation を停止。operator gate (`pnpm run rotate:home-api-key --abort`)
     で原因確認後に再開。中途半端な disable を防ぐ
1. pnpm run bootstrap:home-api-key --target=remote
   → 新 plaintext を 1 回だけ出力。同時に machine-readable 出力 (§E 拡張) として
     1 行 JSON: { "id": "<uuid>", "prefix": "mk_home_", "start": "<plaintext先頭6文字>",
       "createdAt": <epochMs>, "enabled": 1, "name": "home-self-consumption",
       "referenceId": "<admin-user-id>" }
     この `id` は **newKeyId** として step 5 には使わない (step 0 で取得した oldKeyId を使う)
2. Infisical prod の MY_WEB_2026_CONSUMER_API_KEY を新 plaintext で更新
3. pnpm run deploy:production:prepared
   → scripts/deploy-with-secrets.mjs が新 key を Cloudflare Worker に反映
4. production smoke で新 key での reactions / access_counter の write を確認
5. old key の revoke: D1 で `UPDATE apikey SET enabled = 0 WHERE id = <oldKeyId>`
   (step 0 で query した既存 enabled row の id を使う)
```

**E. `bootstrap-home-api-key.mjs` rotate output 拡張 (Phase 2)**: 現状 plaintext
のみ (1 行 console.log) では同名 key 候補が複数ある場合に旧 row を機械的に特定
できない。Phase 2 で plaintext banner 直下に **machine-readable JSON 1 行** を
加える。必須 field は rotation runbook step 0 が要求する query 結果 (`id` /
`prefix` / `start` / `createdAt` / `enabled` / `name` / `referenceId` の 7
field) と整合。Migration 0006 の `UNIQUE INDEX uq_apikey_key` により、SHA-256
hash 衝突時は `INSERT OR IGNORE` 相当で re-run しても安全。

**Idempotency + concurrent-loser semantics**: `INSERT ... WHERE NOT EXISTS`
の atomicity だけでは不十分 — losing process は依然として自プロセスが生成し
た plaintext を保持しているため、hash による re-read
(`SELECT ... WHERE key = <hash> AND enabled = 1`) が必要。winning process は
自 hash で row を見つける (→ plaintext 出力) / losing process は他 process の
hash と異なるため見つからず、name-based reuse 経路に fallback して
`<no new plaintext — ...>` sentinel のみ出力 (自 plaintext は破棄)。
Migration 0006 の `UNIQUE INDEX uq_apikey_key` (hash-unique) が hash re-read
の判定を unambiguous にしている。

**F. `scripts/rotate-home-api-key.mjs` (Phase 3+ follow-up に defer)**: step 0-5 を 1 つの
script にまとめ、`oldKeyId` query → bootstrap → operator smoke 確認 →
disable を atomic に近い形で実行する。手動実行時のミスを減らす。`--dry-run`
で新 key 作成 / smoke 確認 / 旧 disable の plan だけ出力できる。

**Rotation interim (until #74 lands)**: Phase 2 では
`scripts/rotate-home-api-key.mjs` を実装しないため、
`MY_WEB_2026_CONSUMER_API_KEY` の rotation は §6 manual runbook を
operator が手動で実行する。§6 step 0 (既存 enabled row query) と
§6 step 1 (`bootstrap:home-api-key --target=remote`) は bootstrap 側の
idempotency により "step 0 で検出した既存 row と step 1 の bootstrap 出力の
row が同一 id になる" 動作となるが、これは **collapsing** であり新しい
plaintext は生成されない。よって Phase 2 中の rotation は実質的に
"§11.2 Unrecoverable 分岐の operator gate で承認された状態での手動 disable + 新
row 作成" のみ可能で、operator が §6 step 5
(`UPDATE apikey SET enabled = 0 WHERE id = <oldKeyId>`) を直接 D1 に
打ち、`bootstrap:home-api-key --target=remote` を再実行する手順を採る。
#74 (Phase 3+) 着手中はこの手順を `scripts/rotate-home-api-key.mjs` で
automate する。

**Defer rationale (Phase 2 review blocker 5)**: Phase 2 で実装範囲を
`bootstrap-home-api-key.mjs` の idempotent rerun (operator review focus) と
drift detection 強化に絞り、`rotate-home-api-key.mjs` は Phase 3+ 着手時に
別 ticket で実装する。Phase 2 で `bootstrap-home-api-key.mjs` を
`INSERT ... WHERE NOT EXISTS` で idempotent 化した (migration 0006 の
`UNIQUE INDEX uq_apikey_key` との二重防壁) ため、rerun / concurrent は
安全 — **ただし rotation (旧 key revoke + 新 key 作成) は引き続き手動
runbook** で運用する。手動 runbook の step 5 (`UPDATE apikey SET
enabled = 0 WHERE id = <oldKeyId>`) を script 化することが
`rotate-home-api-key.mjs` の Phase 3+ での最小実装。Follow-up Issue
参照。

### 7. drift 検出

| 種類 | 置き場 | 認証 |
| --- | --- | --- |
| wrangler.jsonc `secrets.required` ↔ wrangler.production.jsonc `secrets.required` ↔ deploy script `REQUIRED_SECRETS` | **GitHub Actions 通常 CI** | 不要 (静的整合) |
| Infisical ↔ Cloudflare Worker secret name / type | **operator diagnostic (`pnpm run check:cf-secrets`)** または **Workers Builds preflight** | Infisical / Cloudflare 認証必要 |
| value drift (値の比較) | **やらない** | Cloudflare secret は Wrangler / Dashboard からも読み出せないため不可能 |

**Tier 1 endpoint contract (Phase 2 review correction)**: Infisical secret
LIST は V3 deprecated list endpoint `GET /api/v3/secrets/raw?workspaceId=
<id>&environment=<env>&viewSecretValue=false` で照会する。`/api/v3/secrets`
は 404 (V3 router は `/raw` suffix のみ登録)。V4 (`/api/v4/secrets` with
`projectId`) への移行は scope を増やすため Phase 2 では V3 を維持。V3
`/raw` は `workspaceId` を project pointer として受け付けるため §1
`.infisical.json#workspaceId` SoT 契約と整合する。`viewSecretValue=false`
で values は null 化され `secretValueHidden: true` が per-item に付与される
が、本 script は `secretKey` のみを読むため値の masking は観測に影響しない。
Sources: `Infisical/infisical#backend/src/server/routes/v3/deprecated-secret-router.ts`
(`GET /raw` "List secrets") + OpenAPI
`docs/api-reference/endpoints/deprecated/secrets/list.mdx`
(`openapi: "GET /api/v3/secrets/raw"`).

AGENTS.md §6「GitHub Actions は validation only、production deployment authority は Cloudflare Workers Builds」の境界を守る。production credential を GitHub Actions に追加しない。

### 8. Build token の維持

Cloudflare Workers Builds の **custom Build API token (Workers Scripts:Edit + Routes:Edit + D1:Edit + R2:Edit)** を維持する。Cloudflare が自動生成する token には D1:Edit が含まれないため、deploy 前の `wrangler d1 migrations apply` が失敗する。これは現状 (eccd31e) の運用からの継続。

### 9. `wrangler.jsonc` への `secrets.required` 追加 (Phase 別 staged 設計)

`wrangler.production.jsonc` には `secrets.required` が既にあるが、`wrangler.jsonc` (default / local-dev) にはない。Phase 3 で default にも追加して `process.env` からの required secrets の自動ロード経路を成立させる。

**Wrangler は `secrets.required` の全項目を deploy 時に検証する** (`developers.cloudflare.com/workers/wrangler/configuration/`)。Phase 1 で `BETTER_AUTH_SECRETS` を必須化すると、Infisical seed (Phase 1 operator 手動 work) 完了前の deploy が全て失敗する。Phase 別の staged 設計で対処する (CodeRabbit PR #72 review thread `PRRT_kwDOUW6FgM6mQRul` で発見):

**Phase 1-2 (Infisical seed 完了前)** — legacy 2-name 必須:

```jsonc
// wrangler.jsonc (default / local-dev)
// wrangler.production.jsonc
"secrets": {
  "required": ["BETTER_AUTH_SECRET", "MY_WEB_2026_CONSUMER_API_KEY"]
}
```

- `BETTER_AUTH_SECRET` legacy 単一 form を必須 (既存の Cloudflare secret binding がそのまま deploy できる)
- `BETTER_AUTH_SECRETS` は optional — Infisical seed 完了後、Wrangler secret binding に追加された時点で deploy が自動的に拾う
- local dev (`pnpm dev`) は `infisical run --env=dev --` 経由で `BETTER_AUTH_SECRETS` を渡せる。`secrets.required` に含まれていなくても runtime env にあれば better-auth.ts は versioned form を読む

**Phase 3+ (Initial migration 完了後)** — versioned form 必須 + legacy 任意:

```jsonc
// wrangler.jsonc (default / local-dev)
// wrangler.production.jsonc
"secrets": {
  "required": [
    "BETTER_AUTH_SECRETS",
    "MY_WEB_2026_CONSUMER_API_KEY"
  ]
}
```

- `BETTER_AUTH_SECRETS` を必須化 (Initial migration 完了確認後)
- `BETTER_AUTH_SECRET` legacy は **任意運用** (§1 SoT 境界と同期)。Better
  Auth に `secret` option として渡しても compact cookie cache の署名検証
  には使われない (§11.2 Semantics 参照) ため、 deploy の必須化には含めない
- legacy 完全削除は Phase 5 runbook で明示 (別 ticket で運用)

**Wrangler secret binding への追加順序** (Phase 1 → Phase 3 移行時):
1. Phase 1 operator が Infisical `prod` env に `BETTER_AUTH_SECRETS` を seed
2. `wrangler secret put BETTER_AUTH_SECRETS` で Cloudflare Worker に binding 追加 (Wrangler が `secrets.required` を見るので必須化前に実行)
3. `wrangler.jsonc` の `secrets.required` を Phase 3+ の 2-name contract `["BETTER_AUTH_SECRETS", "MY_WEB_2026_CONSUMER_API_KEY"]` に切り替える (§1 SoT 境界で BETTER_AUTH_SECRET は任意運用としたため、 secrets.required からは外す)
4. 以降の deploy で `BETTER_AUTH_SECRETS` 必須

`BETTER_AUTH_SECRET` legacy 単一 form のみを使う中間期間 (Infisical seed 完了前) でも deploy が通ることを保証する (Phase 1-2 の 2-name contract `["BETTER_AUTH_SECRET", "MY_WEB_2026_CONSUMER_API_KEY"]` で吸収)。

### 10. Machine Identity

| 用途 | identity | 必須 |
| --- | --- | --- |
| prod Workers Builds | Machine Identity (Workers Builds 用) | **必須** |
| dev (人間) | 通常の `infisical login` | 不要 (operator が個別にログイン) |
| dev (非対話 agent) | dev-scoped Machine Identity | 任意 (必要になった時点で追加) |

credential 数を最小化するため、prod 用 Machine Identity のみ必須とし、dev 用は必要な時点で追加する。

## Consequences

### 移行手順 (Phase 1-5)

1. **Phase 1**: Infisical self-host (`https://secrets.rebuildup.dev`) で project / env / secret を登録。prod Workers Builds 用 Machine Identity を発行。`.infisical.json` 雛形を `pnpm run infisical:bootstrap` で生成。
2. **Phase 2**: `scripts/{infisical-bootstrap,deploy-with-secrets,check-cf-secrets,check-infisical-coverage}.mjs` を実装。`@infisical/cli` を `package.json#devDependencies` に pin。
3. **Phase 3**: `wrangler.jsonc` に `secrets.required` を追加。`pnpm dev` を `infisical run --env=dev -- pnpm exec vite dev` に変更。`.dev.vars` 生成は fallback に格下げ。
4. **Phase 4**: Cloudflare Workers Builds の Build command を `pnpm run build`、Deploy command を `pnpm run deploy:production:prepared` に更新。`INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` を env vars として登録。custom Build token (D1 Edit 付き) を維持。
5. **Phase 5**: ドキュメント整備。`docs/release.md`, `docs/development.md`, `README.md`, `AGENTS.md §4` を新方式に書き換え。`docs/runbook/cloudflare-workers-builds.md` と `docs/runbook/consumer-api-key-rotation.md` を新規作成。

### 新しい env を追加する手順 (SoT 境界を反映)

| 種類 | SoT | 手順 |
| --- | --- | --- |
| runtime secret | **Infisical** | (1) Infisical `prod` (と `dev`) に secret 追加 → (2) `wrangler.jsonc` の `secrets.required` に name 追記 → (3) `pnpm run check:infisical-coverage` で静的整合確認 → (4) `pnpm run deploy:production:prepared` で反映 |
| static non-secret vars / 識別子 | **Wrangler config (`vars` / 識別子)** | (1) Wrangler config に追加 → (2) `pnpm run cf-typegen` で `worker-configuration.d.ts` の `Env` 型を更新 → (3) `pnpm run validate:integration`。Infisical は触らない |
| Cloudflare 認証境界 (build_token_uuid 等) | **Cloudflare UI** | Cloudflare 側で更新。Infisical / Wrangler config は触らない |

**注**: 「Infisical 変更のみで完結」という見出しは §1 Decision の SoT 限定 (runtime / build credentials and secrets のみ) と矛盾するため廃止する。runtime secret 追加は `wrangler.jsonc#secrets.required` の name 追記を伴う。static non-secret vars の追加は Wrangler config のみで完結し、Infisical は触らない。

### Trade-offs accepted

- **`build_token_uuid` と `CLOUDFLARE_API_TOKEN` の 2 系統を避け、Build token に集約**: Build token のみが Cloudflare 認証を担う。`CLOUDFLARE_API_TOKEN` を別途 Infisical に置かない。
- **dev 用 Machine Identity は最初は発行しない**: credential 数を最小化。人間の dev は通常の `infisical login` で行う。非対話 agent 用途が必要になった時点で追加。
- **`.dev.vars` 生成は fallback**: まず `infisical run --env=dev -- pnpm dev` の fileless 経路を検証 → 通れば `.dev.vars` 不要。fallback は `pnpm run generate:dev-vars` で残す。
- **`NODE_VERSION` / `PNPM_VERSION` を Infisical に置かない**: Cloudflare が build image 起動前に決めるため、Infisical 経由では間に合わない。Cloudflare build vars か `.nvmrc` / `package.json#engines` に残す。
- **drift 検出の値比較はやらない**: Cloudflare secret 値は読み出せないため不可能。代わりに delivery evidence (`deploy-with-secrets.mjs` の log) と静的整合で担保する。

## 11. Initial migration

Cloudflare Worker の secret 値は Wrangler / Dashboard からも読み戻せない仕様
(Cloudflare API には secret value の取得エンドポイントが存在しない)。Phase 1 で
Infisical へ seed する前に、**既存 plaintext が取得可能か**で初期 migration 経路
が変わる。

### 11.1 Recoverable: 既存 plaintext が安全なソースから取得できる

operator の password manager / 紙 backup / 別 system 等から既存 plaintext を
取得できるケース:

1. 取得値を Infisical `prod` env に手動で seed (`BETTER_AUTH_SECRET` /
   `MY_WEB_2026_CONSUMER_API_KEY`)
2. 同じ値を `dev` env にも seed (任意。local 用)
3. `pnpm run deploy:production:prepared` で `wrangler secret put` の手動経路を置換
4. operator smoke で `/`, `/admin/login`, `/api/v1/health`, reactions,
   access counter を確認 (canonical production domain `https://rebuildup.dev`)

### 11.2 Unrecoverable: Cloudflare UI に残っている値を取得できない

#### `MY_WEB_2026_CONSUMER_API_KEY`

**§6 rotation runbook をそのまま適用する**。bootstrap が新 id しか返さない
ため、bootstrap 前に既存 enabled row を query して `oldKeyId` を確定する手順
が必須:

```
0. 既存 enabled row の確認 (§6 step 0 と同じ):
   `home-self-consumption` name で `enabled=1` の apikey 行を query。
   - 0 件: 初回作成。step 1 へ (oldKeyId 不要、step 5 も不要)
   - 1 件: oldKeyId を取得。step 1 へ
   - 2 件以上: 自動 rotation を停止。operator gate で原因確認後に再開
1. pnpm run bootstrap:home-api-key --target=remote
   → 新 plaintext を 1 回だけ出力。同時に machine-readable JSON 1 行も
     出力される (§E 拡張)。新 plaintext の id は newKeyId として step 5
     には使わない (step 0 で取得した oldKeyId を使う)
2. 新 plaintext を Infisical prod env の MY_WEB_2026_CONSUMER_API_KEY に登録
3. pnpm run deploy:production:prepared
   → scripts/deploy-with-secrets.mjs が新 key を Cloudflare Worker に反映
4. production smoke で新 key での reactions / access_counter の write を確認
5. 旧 row revoke: step 0 で取得した oldKeyId を D1 で
   UPDATE apikey SET enabled = 0 WHERE id = <oldKeyId>
```

`§F scripts/rotate-home-api-key.mjs` (Phase 3+ follow-up に defer) で上記
step 0-5 を 1 つの script にまとめると手動運用時のミスが減る。Migration
0006 の UNIQUE INDEX uq_apikey_key が SHA-256 hash 衝突時の re-run /
concurrent を安全にする
(`INSERT OR IGNORE` 相当)。

#### `BETTER_AUTH_SECRET`

**単純な差替えにしない**。Better Auth 1.5+ の非破壊 rotation を使う。

**現状の integration**: `src/cloudflare/auth/better-auth.ts:71` が
`secret: env.BETTER_AUTH_SECRET` の単一 secret form。これが versioned form を
解釈できないと、移行期間に in-flight session の検証失敗 / 新規 deploy の cookie
署名が旧 secret と不整合になる window が生まれる。**Phase 1 sub-step** で
versioned form に移行する:

- **Runtime 契約**: `secrets: [{ version: 2, value: "<new>" }, { version: 1, value: "<old>" }]`
  を渡せる形にする (または `BETTER_AUTH_SECRETS=2:<new>,1:<old>` env var form を parse する)
- **Semantics** (Better Auth 1.7.5 — implementation-dependent): `secrets`
  配列の先頭 entry が `context.secret` (current signing key) に設定される。
  後続 entry は decryption-only reference として保持される。**Compact
  cookie cache (既定) は `context.secret` 単体で署名検証するため、旧
  secret で署名された in-flight cookie は検証失敗する**。これは
  `packages/better-auth/src/context/create-context.ts` (v1.7.5) の実装に
  基づく。versioned form の意義は「新 secret を current signing key に
  切替 + 旧 secret を後方互換 reference として保持」の意味であり、
  in-flight session 継続を保証するものではない。
- **Validation** (`src/cloudflare/auth/better-auth.ts` parser):
  `BETTER_AUTH_SECRETS` env var の parser は comma-separated `version:value`
  pairs について以下を厳格に検証する (誤投入で old key が current として
  使われるのを防ぐ):
  - **version は unique** — 重複した version を許可しない
  - **strictly descending order** — 先頭 entry が current key。`1:old,2:new`
    のような逆順を許可しない (誤ると old が current として扱われる)
  - version は **decimal digits only** (十進数字のみ — `1e3` / `0x10` の
    ような表記は許可しない)、positive safe integer
  - value は non-empty string、empty segment (`2:new,,1:old` / trailing
    comma) は reject
  - error message には raw value / entry 文字列 / version string を含めない
    (invariant: argv / log への secret 露出禁止)
- **Session impact**: Better Auth の session token は **HMAC-signed**
  (暗号化ではない)。旧 secret で署名された cookie は versioned form 移行後、
  Better Auth 1.7.5 の compact cookie cache 実装では検証失敗する。
  **`BETTER_AUTH_SECRETS` で旧 secret を decryption-only として登録しても
  in-flight session の継続は保証されない**。これは当初 §11.2 で recoverable
  分岐が in-flight session 継続可能としていた前提を破る contract violation
  (CodeRabbit PR #72 review thread `PRRT_kwDOUW6FgM6mQRuu` で発見、v1.7.5
  ソース確認済み)。**Recoverable 分岐でも in-flight session の再サインイン
  は通常コスト**として許容する (operator gate の対象外)。
- **Encryption impact**: Better Auth は encrypted column を保持しない
  (`account.password` 等はハッシュ)。`BETTER_AUTH_SECRET` rotation で
  persisted row corruption は発生しない。
- **Operator gate**: 旧 plaintext が本当に回収不能 (Unrecoverable 分岐)
  で、新 secret に swap する場合は、in-flight session の再サインイン
  + 進行中 OAuth flow / cookie-bound state のリセットを許容する旨を
  **operator が明示承認**する。Recoverable 分岐では versioned rotation を
  必須とするが、in-flight session 継続は保証されない (§11.2 Semantics
  参照)。これは ADR の decision boundary を越えるため、operator gate 必須。

### 11.3 移行の invariant

- **production credential は GitHub Actions に追加しない** (AGENTS.md §6「
  GitHub Actions は validation only、production delivery は Cloudflare Workers
  Builds」)
- **Production deploy authority は Cloudflare Workers Builds**。Operator による
  `pnpm run deploy:production` の手動実行は recovery / debugging 用途のみ。
- **Recoverable 分岐**: Better Auth versioned rotation を **必須** とする。
  `secrets: [{version:2, value:"<new>"}, {version:1, value:"<old>"}]` または
  `BETTER_AUTH_SECRETS=2:<new>,1:<old>` env var で旧 secret を後方互換
  reference として保持。**ただし Better Auth 1.7.5 の compact cookie cache
  実装では in-flight session 継続は保証されない** (§11.2 Semantics)。
  Recoverable 分岐でも再サインインは通常コストとして許容する
  (operator gate の対象外)
- **Unrecoverable 分岐**: 旧 plaintext が回収不能なため、Better Auth
  versioned secrets 配列に旧 key を含められない。**新 secret 単体 deploy**
  となり、旧 secret で署名された in-flight cookie は検証失敗する (compact
  cookie cache 実装上の挙動、§11.2 Semantics 参照)。これは ADR の decision
  boundary を越えるため、operator gate (§11.2) を満たす (in-flight session
  の再 sign-in + 進行中 OAuth flow / cookie-bound state のリセットを許容
  する旨を operator が明示承認) ことが前提

### 11.4 Phase 1 — agent scope (Issue #67, amended 2026-09-27)

Phase 1 のうち agent が自動実行する範囲を明示する。残り (operator
手動 work) は §11.5 で扱う。Phase 2 (`scripts/deploy-with-secrets.mjs`
等) は `release-0-4-0 @ e32285d` で merge 済みであり、本 §11.4 は
Phase 1 (Issue #67) の残作業だけを記述する。

**Phase 1 agent work (Issue #67)**:

1. **Infisical project + environment provisioning** (`scripts/infisical-bootstrap-api.mjs`):
   project `my-web-2026` (既存 dotfiles 用 project とは別物) と `dev`
   / `prod` の 2 environment を idempotent に作成。`.infisical.json`
   (`{ workspaceId, defaultEnvironment }`) を repo root に commit
   (secret を含まない project pointer のみ、`.gitignore` には追加
   しない — §References 参照)。
2. **Machine Identity + Universal Auth** (`scripts/infisical-bootstrap-cf.mjs`):
   Machine Identity `my-web-2026-cf-worker` を project スコープで
   作成、Universal Auth を attach、project membership を確立。
   Client secret は **in-memory only** — 生成 → Worker Builds env
   vars への PATCH 後に即座に `null` 化。ファイル / stdout / log /
   error message には絶対に出さない。
3. **Cloudflare Workers Builds env vars への binding**
   (`scripts/infisical-bootstrap-cf.mjs` 内の `selectProductionTrigger` +
   `buildBuildsEnvVarsPatchBody` 経路): production deployment
   trigger を Worker tag 経由で発見 (wrangler config には trigger
   UUID は存在しない — §11.6 参照)、`PATCH
   /accounts/{accountId}/builds/triggers/{triggerUuid}/environment_variables`
   に **object map keyed by variable name** の body shape で
   `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` (`is_secret=true`)
   を設定。
4. **Dev env 3-name seeding** (`scripts/infisical-seed.mjs --env=dev`):
   `BETTER_AUTH_SECRET` (legacy 単一)、`BETTER_AUTH_SECRETS` (versioned
   `1:<hex>` form)、`MY_WEB_2026_CONSUMER_API_KEY` の 3 secret を
   random 32-byte hex で seed (randomBytes(32).toString('hex'))。
   既存 secret は **update しない** (idempotent re-run は no-op) —
   operator tuning を保護。
5. **Fileless dev smoke** (`scripts/infisical-verify.mjs`): Node
   `spawnSync` (`shell: false`、Windows native PowerShell / cmd
   safe) で `infisical run --projectId=<workspaceId> --env=dev --
   node -e "<presence check>"` を実行。Inner script は `KEY=true|false`
   (Boolean coercion of `process.env[KEY]`) のみ stdout に出し、
   値そのものは絶対に出さない。Prod env は expected: 0 secrets を
   確認 (best-effort — exit non-zero の場合は "skipped" だけ出力)。
6. **`.gitignore` 拡張**: `.infisical/` (machine identity client
   secret などの one-time bootstrap artefacts)、`.tmp/` (CLI
   `--help` introspection 出力)、`.dev.vars` (Phase 3+ fallback
   で生成される runtime secrets file) を追加。

### 11.5 Workers Builds env target — rationale

`INFISIAL_CLIENT_ID` / `INFISIAL_CLIENT_SECRET` を **Cloudflare
Workers Builds の environment variables (build-time env vars)** に
置く理由:

- `wrangler secret put` で Cloudflare Worker の runtime secret に
  入れた場合、Worker 起動時に `process.env` に値が乗ってしまう
  (Wrangler は deploy 時に値を復号して env var として inject する)。
  Universal Auth の短期 access token は親 process (deploy script)
  が取得するため、Worker runtime に `INFISIAL_CLIENT_SECRET` が
  常駐する必要は本来ない。
- 逆に `wrangler secret put` を deploy 前に手動で実行する運用は
  `release-merge-human-gate` の枠を踏み越える — production deploy
  authority は Cloudflare Workers Builds が担う (AGENTS.md §6)。
- Cloudflare Builds API の `PATCH /accounts/{accountId}/builds/
  triggers/{triggerUuid}/environment_variables` は Build container
  起動時に環境変数として inject される build-time env であり、
  Worker runtime には露出しない。`INFISIAL_CLIENT_ID` /
  `INFISIAL_CLIENT_SECRET` は `deploy-with-secrets.mjs` (Phase 2
  で merge 済み) が Universal Auth login を HTTPS POST する際の
  引数として Build container 内でしか読まれない — Worker runtime
  の `Env` 型契約にも影響しない。
- PATCH body shape は **flat object map keyed by variable name**
  (`{ "KEY": { value: "...", is_secret: true } }`) — 配列形式
  (`[{ name, value, is_secret }, ...]`) ではない。Cloudflare API
  契約 (公式 API docs: *Workers Builds > Manage triggers >
  environment variables*) に従う。
- 既存の Cloudflare Workers Builds UI 設定 (Build command /
  Deploy command / custom Build token) との drift は §7 の
  `pnpm run check:cf-secrets` で静的整合を確認する (Infisical
  side の coverage check とは別)。

### 11.6 Trigger UUID discovery — rationale

Cloudflare Workers Builds の production trigger UUID は **wrangler
config には存在しない** (`wrangler.production.jsonc` には Worker
名と `account_id` のみ)。trigger UUID を取得するには Cloudflare
API を辿る必要がある:

```
GET /accounts/{accountId}/workers/scripts/{name}
  → response.tag (Worker tag)
GET /accounts/{accountId}/builds/workers/{tag}/triggers
  → [{ uuid, branch, deployment_enabled, ... }]
filter: deployment_enabled === true AND branch in {main, release-*}
  → triggerUuid
```

Disambiguation: 複数の production-shaped trigger が返る場合
(例: `main` と `release-0-4-0` の両方が deployment_enabled)、
script は ambiguous として abort し、operator が
`CF_TRIGGER_UUID=<explicit>` env var で override して再実行する
(`scripts/infisical-bootstrap-cf.mjs` の `selectProductionTrigger`
は `branch` の `main > release-*` 優先順で決定的に 1 件選ぶが、
該当 0 件 / 異常系の最終判断は operator gate)。

### 11.7 Zero prod seeds rationale

Phase 1 (Issue #67) で prod env は **作成するが secret を 1 つも
seed しない**。これは Phase 2 review blocker の議論で operator
が確定した (2026-09-27 設計 review round 2):

- Phase 2 で merge 済み (`e32285d`) の `deploy-with-secrets.mjs` は
  prod env に `BETTER_AUTH_SECRETS` が存在すれば optional として
  拾う設計。Better Auth 1.5+ の優先順位は `BETTER_AUTH_SECRETS`
  (versioned) > `BETTER_AUTH_SECRET` (legacy)。Phase 1 で prod に
  random `BETTER_AUTH_SECRETS=1:<random-hex>` を入れてしまうと、
  operator の legacy 2 secrets 手動 import が完了する前に Phase 4
  deploy (`pnpm run deploy:production:prepared`) が走った場合、
  random versioned form が active signing key として使われ、
  既存 production session の署名検証が silent に失敗する
  (Better Auth 1.7.5 の compact cookie cache 実装、§11.2
  Semantics)。
- したがって Phase 1 prod env は **「箱だけ用意して中身は空」**
  の状態にする。Operator post-#67 work が legacy 2 secrets
  (`BETTER_AUTH_SECRET` + `MY_WEB_2026_CONSUMER_API_KEY`) を
  `infisical secrets set` で手動 import し、`BETTER_AUTH_SECRETS`
  は Phase 3+ flip 時に operator が明示承認の上で seed する
  (release-merge-human-gate の枠組み)。Phase 1 agent は
  `BETTER_AUTH_SECRETS` を含む prod env への write を一切行わない
  — `--env=prod` を渡したら `infisical-seed.mjs` が hard error
  で reject する (operator-only post-#67 work であることを script
  自身が enforce)。

## Out of scope

- 0.2.0 以降の Cloudflare 認証情報 (e.g. KV namespace, Durable Object の auth token) の移行 — 別 ticket
- Cloudflare Pages / Pages Functions への展開 — 0.x 系外
- Infisical の Terraform provider を使った IaC 化 — 別 ticket

## References

- ADR-0009 — Better Auth foundation
- ADR-0010 — Abuse protection (rate-limit)
- ADR-0011 — Home self-consumption (consumer pattern)
- ADR-0014 — rebuildup.dev canonical production domain
- eccd31e — fix(deploy): move production delivery to Cloudflare Builds
- e32285d — Merge pull request #73 from rebuildup/68 (Phase 2 deploy scripts, `release-0-4-0`)
- `docs/runbook/cloudflare-workers-builds.md` (new in Phase 5)
- `docs/runbook/consumer-api-key-rotation.md` (new in Phase 5)
- `.infisical.json` (new in Phase 1, **committed** — holds only `workspaceId` project pointer; no secrets. `scripts/deploy-with-secrets.mjs` reads `workspaceId` from it as SoT. `.gitignore` does NOT add `.infisical.json`. Schema: `{ "workspaceId": "<uuid>", "defaultEnvironment"?: "dev" | "prod" }`. `INFISICAL_API_URL` は `scripts/deploy-with-secrets.mjs` 内の committed constant (`https://secrets.rebuildup.dev` を default とする) + env var override の二段構えで提供される。operator shell rc に依存しない — Workers Builds ephemeral container には shell rc が存在しないため)
- `scripts/infisical-bootstrap-api.mjs` (new in Phase 1, Issue #67 — project + dev/prod env provisioning via V3 API)
- `scripts/infisical-bootstrap-cf.mjs` (new in Phase 1, Issue #67 — Machine Identity + Universal Auth + Cloudflare Workers Builds env binding, in-memory client secret, decision-tree idempotency without pre-emptive revoke)
- `scripts/infisical-seed.mjs` (new in Phase 1, Issue #67 — dev env 3-name secret seeding; `--env=prod` is hard-rejected, prod zero-seed per §11.7)
- `scripts/infisical-verify.mjs` (new in Phase 1, Issue #67 — fileless dev smoke via Node `spawnSync` with `shell: false`, Windows-native-safe; inner script writes `KEY=true|false` markers only, never values)
- `scripts/deploy-with-secrets.mjs` (new in Phase 2)