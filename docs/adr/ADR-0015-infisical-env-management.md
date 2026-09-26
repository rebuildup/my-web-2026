# ADR-0015 — Infisical による runtime / build credentials の SoT 統合

- Status: Proposed
- Date: 2026-09-26
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
| `BETTER_AUTH_SECRET` | **Infisical (prod / dev)** | Better Auth legacy single form (Phase 1-2 移行期間の backward compat。Phase 3 で `BETTER_AUTH_SECRETS` 必須化後、本行は任意運用。legacy singular の完全削除は Phase 5 runbook で明示) |
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

**F. `scripts/rotate-home-api-key.mjs` (Phase 2 新規)**: step 0-5 を 1 つの
script にまとめ、`oldKeyId` query → bootstrap → operator smoke 確認 →
disable を atomic に近い形で実行する。手動実行時のミスを減らす。`--dry-run`
で新 key 作成 / smoke 確認 / 旧 disable の plan だけ出力できる。

### 7. drift 検出

| 種類 | 置き場 | 認証 |
| --- | --- | --- |
| wrangler.jsonc `secrets.required` ↔ wrangler.production.jsonc `secrets.required` ↔ deploy script `REQUIRED_SECRETS` | **GitHub Actions 通常 CI** | 不要 (静的整合) |
| Infisical ↔ Cloudflare Worker secret name / type | **operator diagnostic (`pnpm run check:cf-secrets`)** または **Workers Builds preflight** | Infisical / Cloudflare 認証必要 |
| value drift (値の比較) | **やらない** | Cloudflare secret は Wrangler / Dashboard からも読み出せないため不可能 |

AGENTS.md §6「GitHub Actions は validation only、production deployment authority は Cloudflare Workers Builds」の境界を守る。production credential を GitHub Actions に追加しない。

### 8. Build token の維持

Cloudflare Workers Builds の **custom Build API token (Workers Scripts:Edit + Routes:Edit + D1:Edit + R2:Edit)** を維持する。Cloudflare が自動生成する token には D1:Edit が含まれないため、deploy 前の `wrangler d1 migrations apply` が失敗する。これは現状 (eccd31e) の運用からの継続。

### 9. `wrangler.jsonc` への `secrets.required` 追加

`wrangler.production.jsonc` には `secrets.required` が既にあるが、`wrangler.jsonc` (default / local-dev) にはない。Phase 3 で default にも追加して `process.env` からの required secrets の自動ロード経路を成立させる。

```jsonc
// wrangler.jsonc (default / local-dev)
"secrets": {
  "required": ["BETTER_AUTH_SECRETS", "BETTER_AUTH_SECRET", "MY_WEB_2026_CONSUMER_API_KEY"]
}
```

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

`§F scripts/rotate-home-api-key.mjs` (Phase 2 新規) で上記 step 0-5 を 1 つ
の script にまとめると手動運用時のミスが減る。Migration 0006 の UNIQUE INDEX
uq_apikey_key が SHA-256 hash 衝突時の re-run / concurrent を安全にする
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
- **Semantics** (Better Auth 1.5+): 先頭 entry が新規 signing key、残りは
  decryption-only。Cookie は version 識別子付きで署名され、decryption は
  version から直接 lookup するため trial decrypt 不要。Database migration /
  downtime は不要。
- **Validation** (`src/cloudflare/auth/better-auth.ts` parser):
  `BETTER_AUTH_SECRETS` env var の parser は comma-separated `version:value`
  pairs について以下を厳格に検証する (誤投入で old key が current として
  使われるのを防ぐ):
  - **version は unique** — 重複した version を許可しない
  - **strictly descending order** — 先頭 entry が current key。`1:old,2:new`
    のような逆順を許可しない (誤ると old が current として扱われる)
  - version は positive integer、value は non-empty string
  - error message には raw value / entry 文字列を含めない (invariant: argv /
    log への secret 露出禁止)
- **Session impact**: Better Auth の session token は **HMAC-signed** (暗号化
  ではない)。旧 secret で署名された cookie は、versioned form 移行後、新
  secret 単体では検証失敗する。`BETTER_AUTH_SECRETS` で旧 secret を
  decryption-only として登録すれば、in-flight session を継続可能にしなくて
  はいけない (これが Phase 1 sub-step の目的)。
- **Encryption impact**: Better Auth は encrypted column を保持しない
  (`account.password` 等はハッシュ)。`BETTER_AUTH_SECRET` rotation で persisted
  row corruption は発生しない。
- **Operator gate**: 旧 plaintext が本当に回収不能で、新 secret に swap する
  場合は、in-flight session の再 sign-in を許容する旨を **operator が明示
  承認**する。これは ADR の decision boundary を越えるため、operator gate 必須。

### 11.3 移行の invariant

- **production credential は GitHub Actions に追加しない** (AGENTS.md §6「
  GitHub Actions は validation only、production delivery は Cloudflare Workers
  Builds」)
- **Production deploy authority は Cloudflare Workers Builds**。Operator による
  `pnpm run deploy:production` の手動実行は recovery / debugging 用途のみ。
- **Recoverable 分岐**: Better Auth versioned rotation を **必須** とする。
  `secrets: [{version:2, value:"<new>"}, {version:1, value:"<old>"}]` または
  `BETTER_AUTH_SECRETS=2:<new>,1:<old>` env var で旧 secret を decryption-only
  として保持し、in-flight session の検証失敗 window を排除する。
- **Unrecoverable 分岐**: 旧 plaintext が回収不能なため、Better Auth versioned
  secrets 配列に旧 key を含められない。**新 secret 単体 deploy** となり、旧
  secret で署名された in-flight cookie は検証失敗する。これは ADR の decision
  boundary を越えるため、operator gate (§11.2) を満たす (in-flight session の
  再 sign-in を許容する旨を operator が明示承認) ことが前提。**「検証失敗
  window ゼロ」を保証する記述は誤り**で、本 invariant は「operator gate を
  通じた unrecoverable 分岐のみ deploy を許可する」と言い換える。

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
- `docs/runbook/cloudflare-workers-builds.md` (new in Phase 5)
- `docs/runbook/consumer-api-key-rotation.md` (new in Phase 5)
- `.infisical.json` (new in Phase 1, **committed** — holds only `workspaceId` project pointer; no secrets. `scripts/deploy-with-secrets.mjs` reads `workspaceId` from it as SoT. `.gitignore` does NOT add `.infisical.json`. Schema: `{ "workspaceId": "<uuid>", "defaultEnvironment"?: "dev" | "prod" }`. `INFISICAL_API_URL` は `scripts/deploy-with-secrets.mjs` 内の committed constant (`https://secrets.rebuildup.dev` を default とする) + env var override の二段構えで提供される。operator shell rc に依存しない — Workers Builds ephemeral container には shell rc が存在しないため)
- `scripts/deploy-with-secrets.mjs` (new in Phase 2)