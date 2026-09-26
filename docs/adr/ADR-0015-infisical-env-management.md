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
| `BETTER_AUTH_SECRET` | **Infisical (prod / dev)** | runtime secret |
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
| secrets (envごと) | `BETTER_AUTH_SECRET`, `MY_WEB_2026_CONSUMER_API_KEY` |

### 3. Universal Auth (二段階 + self-host domain)

Workers Builds の CI 経路で Universal Auth を使う。短命 access token を `infisical login` で取得し、`infisical run --token` に渡す二段階方式:

```bash
export INFISICAL_API_URL=https://secrets.rebuildup.dev
TOKEN=$(infisical login --method=universal-auth \
  --client-id="$INFISICAL_CLIENT_ID" \
  --client-secret="$INFISICAL_CLIENT_SECRET" \
  --silent --plain)

infisical run --token="$TOKEN" \
  --projectId="<workspaceId-from-.infisical.json>" \
  --env=prod \
  -- <command>
```

`projectId` の SoT は `.infisical.json#workspaceId`。`INFISICAL_PROJECT_ID` を Cloudflare UI に重複して持たない。

### 4. Deploy script (`scripts/deploy-with-secrets.mjs`)

`deploy-with-secrets.mjs` は Node のみで完結する。bash / jq / shell pipe を使わず、secret 値を shell の argv にも環境変数にも出さない。

```text
deploy-with-secrets.mjs
├─ .infisical.json から workspaceId を読む
├─ INFISICAL_API_URL=https://secrets.rebuildup.dev を export
├─ infisical login → TOKEN を取得 (子プロセスの stdout のみ)
├─ infisical run --token=$TOKEN --projectId=$WORKSPACE_ID --env=prod --
│ └─ 子 process (injected env)
│        ├─ process.env から BETTER_AUTH_SECRET / MY_WEB_2026_CONSUMER_API_KEY を取得
│        ├─ fs.writeFileSync('secrets.json', JSON.stringify({...}), { mode: 0o600 })
│        ├─ pnpm run db:migrate:production (子 process として spawn)
│        ├─ pnpm exec wrangler deploy -c wrangler.production.jsonc --secrets-file secrets.json (子 process として spawn)
│        └─ finally: fs.unlinkSync('secrets.json')
└─ 親 process は TOKEN を即座に release
```

**Invariant**: secret 値を shell の argv / shell 環境変数 / `ps` の出力に露出させない。これは ADR の invariant として固定する。

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

Infisical 変更だけで rotate しない。D1 provision が必ず先:

```
1. pnpm run bootstrap:home-api-key --target=remote
   → 新 plaintext を1回だけ出力。D1 の apikey に SHA-256 hash 行が追加される
2. Infisical prod の MY_WEB_2026_CONSUMER_API_KEY を新 plaintext で更新
3. pnpm run deploy:production:prepared
   → scripts/deploy-with-secrets.mjs が新 key を Cloudflare Worker に反映
4. production smoke で新 key での reactions / access_counter の write を確認
5. old key の revoke: D1 apikey.enabled = 0 に update (or delete row)
```

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
  "required": ["BETTER_AUTH_SECRET", "MY_WEB_2026_CONSUMER_API_KEY"]
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

### 新しい env を追加する手順 (Infisical 変更のみで完結)

| 種類 | 手順 |
| --- | --- |
| runtime secret | (1) Infisical に secret 追加 → (2) `wrangler.jsonc` の `secrets.required` に追記 → (3) `pnpm run check:infisical-coverage` で静的整合確認 → (4) `pnpm run deploy:production:prepared` で反映 |
| static non-secret vars | (1) Infisical に value 追加 OR Wrangler config に追記 (任意) → (2) `wrangler types` で型更新 |
| GAID (Google Analytics ID 等) | (1) Infisical に value 追加 → (2) `src/<obligation>/<feature>/load.ts` で `process.env.X` 参照 → (3) `pnpm run deploy:production:prepared` で反映 (Wrangler config 変更不要) |

### Trade-offs accepted

- **`build_token_uuid` と `CLOUDFLARE_API_TOKEN` の 2 系統を避け、Build token に集約**: Build token のみが Cloudflare 認証を担う。`CLOUDFLARE_API_TOKEN` を別途 Infisical に置かない。
- **dev 用 Machine Identity は最初は発行しない**: credential 数を最小化。人間の dev は通常の `infisical login` で行う。非対話 agent 用途が必要になった時点で追加。
- **`.dev.vars` 生成は fallback**: まず `infisical run --env=dev -- pnpm dev` の fileless 経路を検証 → 通れば `.dev.vars` 不要。fallback は `pnpm run generate:dev-vars` で残す。
- **`NODE_VERSION` / `PNPM_VERSION` を Infisical に置かない**: Cloudflare が build image 起動前に決めるため、Infisical 経由では間に合わない。Cloudflare build vars か `.nvmrc` / `package.json#engines` に残す。
- **drift 検出の値比較はやらない**: Cloudflare secret 値は読み出せないため不可能。代わりに delivery evidence (`deploy-with-secrets.mjs` の log) と静的整合で担保する。

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
- `.infisical.json` (new in Phase 1, gitignored OR committed per Phase 1 decision)
- `scripts/deploy-with-secrets.mjs` (new in Phase 2)