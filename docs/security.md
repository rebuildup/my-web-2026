# Security

> my-web-2026 security policy and current controls.

## Reporting vulnerabilities

- Open a GitHub Issue tagged `security`, target a release.
- Implement the fix in a normal ticket branch
  (`<issue-number>`) or a patch release branch.
- Run `pnpm run validate:release`.
- Land via the canonical release PR flow.

For urgent / out-of-band reports (live site exploitation, credential
leaks), contact the maintainer directly via the channel listed in
`CODEOWNERS` / repository Settings → Code security before opening a
public Issue. If you find a leaked credential, assume it is
compromised: revoke and rotate immediately. Do not wait for the
patch release.

## CSRF

TanStack Start's **default CSRF middleware** is the canonical
mutation-protection mechanism for server functions. It is enabled by
default because `src/start.ts` is intentionally absent — adding a
custom `startInstance` override would disable the default
middleware, so do not add one without an ADR.

External boundary handlers under `src/http/**` are not protected by
the default CSRF middleware; they are responsible for their own
authentication and origin checks per ADR-0002.

## API key scope and revocation

The API keys that guard `/api/v1/access/*` and `/api/v1/reactions/*`
have two decision layers: the boundary middleware
(`src/http/api-keys/middleware.ts`) owns the `Authorization` shape and
the resource/action scope lookup, and `@better-auth/api-key` owns hash
verification, revocation, and expiry. Every denial collapses to a single
shape (`401 missing_authorization`, `401 invalid_api_key`, or
`403 missing_scope`) so a refusal cannot become an oracle.

The scope matrix, the fixtures that pin each refusal, and the
secret-handling invariants live in
[`docs/security/api-key-scope.md`](security/api-key-scope.md). Its
measured artefact is
[`docs/verification/security/api-key-scope-matrix.webp`](verification/security/api-key-scope-matrix.webp)
(regenerate with `pnpm run verification:api-key-scope`). Verification is
local-only: fixtures live in a throwaway Miniflare D1 database, and no
production endpoint, secret, or operator account is read or written.

## Cache isolation

Responses whose body depends on who asked for them (per-principal
counters, per-visitor reaction state, sessions, `/admin*`, and
server-function payloads) are marked so that a **shared** cache — CDN
edge, corporate proxy — cannot store them: `private, no-store` on the
external boundary, `private, no-cache` on caller-specific SSR
documents, `no-store` under `/admin*`. Public immutable payloads opt
in explicitly with `public, max-age=…, immutable`.

The full contract, the audit it came from, and the verification
suites are documented in
[`docs/security/cache-isolation.md`](security/cache-isolation.md).

## Open redirect

Every `returnTo`-shaped value that crosses the external boundary is
untrusted. `src/http/security/**` refuses anything that is not an
internal absolute path, and is mounted in front of the Better Auth
handler at `/api/v1/auth/*`. `BETTER_AUTH_URL` is the trusted-origin
allow-list; when it is unset the guard refuses every absolute URL
(fail-closed). The shipped contract, operator duties and known limits:
[`docs/security/open-redirect.md`](security/open-redirect.md).

## D1 parameter binding (Issue #452)

### Rule

Every D1 statement that user input reaches must bind that input with
`?` / `?N` + `.bind(...)`. Splicing a value into the statement text is
a defect even when the value is escaped today: the statement text is
the part a reviewer reads as structure, and a bound value cannot change
the parse tree.

### Where it is enforced

Two gates, both run by `pnpm run test` (and therefore by
`pnpm run validate:fast` and CI):

| Gate | What it proves | Where |
| --- | --- | --- |
| Runtime suite | Attack fixtures reach the real endpoints through `externalBoundary`; the recorded SQL text is byte-identical to the benign run, no payload appears in a statement, and the seeded rows survive. | `test/integration/d1-parameter-binding.test.ts` (workerd pool) |
| Static gate | The **literal argument** of every `prepare()` / `exec()` / `batch()` call in `src/**` contains no `${…}` interpolation. A statement assembled into a variable before the call is out of scope by design — that is a dataflow judgement, not a scan. | `scripts/check-d1-sql-binding.mjs`, wired via `scripts/check-d1-sql-binding.test.mjs` |

Run the static gate on its own with `node scripts/check-d1-sql-binding.mjs`.
Exit 1 means one of two things: an interpolated statement, or an
`SQL_STRUCTURE_ALLOWLIST` entry the scan never reached (dead
configuration). Adding an entry is a reviewable decision: it must name
the file, the interpolated identifier, and why the value cannot carry
user input. The single current entry is `cursorPredicate` in
`src/portfolio/load.ts` — a fixed chain of `?` placeholders whose
components are all bound — and it is **live** only because that file
passes its list statement to `prepare()` inline. Write the statement
inline; a `const sql = …` in front of it hides the interpolation from
the gate, and the gate then fails on the unreachable entry rather than
letting it rot.

### Known unscanned inventory

The static gate reads literal arguments, so these D1 statements are
**not** covered by it. None of them interpolates — each is a constant,
or a choice between two literals — so what actually guards them is the
combination of that reading and review:

| Site | Shape | Other coverage |
| --- | --- | --- |
| `src/http/reactions/reactions.ts` (`REACTION_INSERT_SQL`, `REACTION_LOOKUP_SQL`) | module-level string constant | runtime suite (`PUT` / `DELETE` / `GET /api/v1/reactions`) |
| `src/portfolio/load.ts` (`prevSql`, `nextSql` in `loadPortfolioAdjacent`) | local string constant | runtime suite (portfolio slug read) |
| `src/reactions/emoji-catalog.ts` (`loadCatalog`) | `cond ? 'literal A' : 'literal B'` | `src/reactions/emoji-catalog.test.ts` (home widget read; no user input reaches either branch) |

Two further limits are deliberate and documented in the gate's own
docstring: string concatenation inside a call argument
(`db.prepare('… WHERE k = ' + key)`) is not inspected, and `exec`
also matches `RegExp.prototype.exec` — all five `.exec(` sites in
`src/**` today are regexes, so D1 `exec()` / `batch()` have no shipped
call site yet (the fixture test covers both).

### Covered surfaces

Only endpoints that exist today (Issue #452 forbids inventing one):

- `POST /api/v1/access/hit`, `GET /api/v1/access/count/:key`
- `PUT` / `DELETE` / `GET /api/v1/reactions` (`target_key`, `actor_id`, `value`)
- `GET /api/v1/reaction-images/:id`
- portfolio loader slug read (`loadPortfolioProject`, `loadPortfolioAdjacent`)
- emoji catalog slug read (`getCatalogEntry`)

Payload families: tautology, comment tail, UNION, stacked statement,
backslash quote, LIKE wildcard, plus whitespace-free variants that
survive the access-counter validators and inputs the validators reject
(over-length, embedded space, control character).

### Operational contract

This gate changes no runtime contract: the auth / API-key boundary,
the Cloudflare bindings (`DB`, `MEDIA`, `ASSETS`), and the Tool
Registry dependency are all untouched. (One production statement was
reshaped for the gate — `listPortfolioProjectsImpl` now passes its SQL
to `prepare()` inline instead of through a `const sql` local. The
statement text is byte-identical; only where it is written changed, so
the allowlist entry above is enforced rather than dead.)

A new D1 surface is covered by adding it to the runtime suite. An
existing one is covered by the static gate **only if it is written as
the literal argument of `prepare()` / `exec()` / `batch()`**: a
statement written inline fails the gate on its own commit, while a
statement assembled in a variable is not scanned at all and must be
caught by the runtime suite (or by review). The inventory above names
the variable-built statements that exist today — keep it current when
one is added.

## HTTPS 強制と HSTS (Issue #446)

### ルール

**HTTPS で届いたリクエストに対する Worker のレスポンスだけが**、
意図した `Strict-Transport-Security` を返す。値は **`max-age` 単独**で、
`includeSubDomains` / `preload` は付けない。

| 経路 | HSTS | 根拠 |
| --- | --- | --- |
| SSR ドキュメント（`/` `/contact` など） | 付与 | `src/server.ts` の `applyTransportSecurityPolicy`（dispatch の外側） |
| 外部境界 `/api/v1/*` | 付与 | 同上（Hono パスにも同一ポリシーが乗る） |
| リダイレクト（`/admin` の 307 → `/admin/login` など） | 付与 | body / content-type が無くても同じ分岐を通る |
| `http://` で届いたリクエスト | **付与しない** | RFC 6797 §7.2 は非 secure 受信の HSTS を無視すると規定。付与しても無意味で、「HTTPS が設定済み」という誤解を生むだけ |
| Cloudflare Static Assets（`/assets/*` など） | **付与しない** | asset server のレスポンスであり Worker は header を付けられない（`_headers` の責務。Issue #291 と同じ制約） |

Static Assets .Named response が HSTS を持たないことは
**到達経路の穴ではない**。HSTS は host 単位で、一度でも secure 応答で
受け取るとその origin に対して固定され、ドキュメント応答がそれを
設定する。origin 全体で普遍に効かせるコントロールは Cloudflare
zone 設定（SSL/TLS → Edge Certificates → HSTS）であり、これは
operator 所有で**リポジトリからは観測できない**（後述「観測していないもの」）。

### 意図した値

```
Strict-Transport-Security: max-age=31536000
```

- 31536000 s = 365 日。ブラウザの preload 申請に必要な 2 年
  （63072000 s）にせず、zone の全ホストに対する長期コミットメントを
  避けるため 1 年で止める。
- 値は `src/server.ts` の `HSTS_DIRECTIVE` 1 箇所だけが所有する。
  他の場所（テスト・`_headers`・生成スクリプト）に書くと
  `scripts/check-hsts-policy.mjs` が exit 1 になる。

### 検証（4 層）

| Layer | 何を証明するか | Where |
| --- | --- | --- |
| 実行時スイート | HTTPS での SSR / 外部境界 / リダイレクトが正確に意図した値を 1 つだけ持つこと、http では 0 個であること、値に `includeSubDomains` / `preload` が無いこと | `test/integration/hsts-transport-security.test.ts`（workerd pool） |
| 静的 gate | 宣言が 1 箇所だけであること、`max-age` が許可域（1 日〜2 年）であること、未知 directive が無いこと、`includeSubDomains` / `preload` が無いこと、コード全体のリテラルが canonical と一致すること | `scripts/check-hsts-policy.mjs`（fixture は `scripts/check-hsts-policy.test.mjs`） |
| E2E（local） | `pnpm preview`（`http://127.0.0.1:3000`）の応答に HSTS が無いこと。plaintext 配信を「HTTPS 化済み」に見せない | `e2e/smoke.spec.ts` |
| E2E（production、read-only） | canonical origin の**各 surface**（`/` と `/api/v1/health`）がそれぞれ host-scoped な値であること | `e2e/prod-smoke.spec.ts`（手動 `workflow_dispatch` / `pnpm run e2e:prod`） |

静的 gate 単体の実行:

```bash
node scripts/check-hsts-policy.mjs
```

gate は Cookie の `Max-Age` と Cache-Control の `max-age` を
HSTS と見間違えないよう、token 名ではなく**文脈**（`_headers` の
`Strict-Transport-Security:` 行、または `max-age` を含む文字列リテラル）で
判定する。対象は単一引用符・二重引用符・**テンプレートリテラル**の
3 種すべて（`` c.header(HSTS_HEADER, `max-age=…; includeSubDomains`) ``
のような拡張も走査対象）。コメントは走査前に空白で埋めるため、
doc comment の markdown（`` `max-age=0` ``）を宣言と誤読しない。
`max-age` の一部が Cache-Control / Set-Cookie の token を伴う文字列
（`public, max-age=31536000, immutable` など）は他ヘッダーの値と
みなして対象外にする。RFC 6797 が定義しない token を含むリテラル
（`max-age=31536000; includeSubDomains; report-uri=x`）や、実行時に
組み立てられるため比較できないリテラル（`max-age=${seconds}`）は
「読み飛ばす」のではなく**違反として報告する**。fixture ファイル
（`*.test.*` / `*.spec.*`）は違反を意図的に植えるため対象外で、
実行時スイートと canonical 値の不一致は
`test/integration/hsts-transport-security.test.ts` が落とす。

production smoke は **deploy 後**の観測専用である。HSTS を返す Worker
が本番に載る前に `pnpm run e2e:prod` を走らせると
「Worker policy is not live」で失敗するのが正しい挙動であり、
deploy 前のベースライン取得には
[`docs/runbook/issue-139-rotation.md`](runbook/issue-139-rotation.md)
の transition フェーズ
（`pnpm run e2e:prod:transition`、この検査を skip する）を使う。

### includeSubDomains / preload を付ける条件

両方とも **コード変更ではなく owner 決定**であり、下列を先に満たすまで
不可（gate が機械的に落とす）。

1. **サブドメインごとの HTTPS 到達性の監査**が本ドキュメントに
   記録されていること。zone には現在 `rebuildup.dev` 以外にも
   `media.rebuildup.dev`（R2 custom domain。`wrangler.production.jsonc`
   の `MEDIA_PUBLIC_BASE_URL`）が存在する。HTTPS 応答できない
   サブドメインが 1 つでもあれば、そのホストは `max-age` の間だけ
   到達不能になる。
2. **zone 設定側で HSTS を有効化**していること。zone の
   Edge Certificates → HSTS が Worker ヘッダーと二重にならないか
   確認する（両方が付く場合、ブラウザはカンマ区切り directives として
   解釈する。Worker は「既にヘッダーがある応答には付けない」ガードを
   持つが、zone 側は Worker から制御できない）。
3. `preload` はさらにブラウザ preload list への申請が prerequisite で、
   取り下げに月単位を要する。申請しない。

段階的な ramp（値を変更する場合は必ず gate とテストも同時に更新する）:

| 段階 | 値 | 条件 |
| --- | --- | --- |
| 1（現状） | `max-age=31536000` | HTTPS 到達性を local workerd で確認済み |
| 2 | `max-age=63072000` | 運用実績に基づいて長期化の可否を判断 |
| 3 | + `includeSubDomains` | サブドメイン監査（上記 1）が記録されていること |
| 4 | + `preload` | preload 申請の判断（上記 3） |

### 観測していないもの / 捏造していないもの

- **Cloudflare zone 設定**（Always Use HTTPS、Edge Certificates →
  HSTS、Minimum TLS Version 等）は dashboard 側の状態であり、
  Wrangler 設定ファイルには現れない。本 Issue はこれを変更せず、
  本番を触って観測もしない。production で実測するのは
  `e2e/prod-smoke.spec.ts` の read-only GET のみ。
- **本番の TLS チェーン / リダイレクトの実測値**は本 PR の証跡に
  含まれない（本番を破壊的操作に触れないという受け入れ条件のため）。
- **サブドメインの HTTPS 対応状況**は未監査。したがって
  `includeSubDomains` は付けない。
- 新規の HTTPS 強制機構（リダイレクト Worker、redirect rule、
  新しい endpoint）は追加していない。

### 運用契約

本 Issue で変更するのは**レスポンス header 1 つ**の付与のみ。
認証（Better Auth / API key）、rate limit、Cloudflare binding
（`DB` / `MEDIA` / `ASSETS`）、Tool Registry 依存、外部 HTTP 契約、
キャッシュポリシー（Issue #291）はいずれも不変。`_headers` には
一切変更を加えていない（Static Assets は本ポリシーの対象外という
判断であり、意図的な据え置き）。

## Test scope: local workerd vs real Cloudflare

`@cloudflare/vitest-plugin` runs SELF tests inside a local workerd
pool with **Miniflare-simulated** D1 / R2 / KV bindings. This proves:

- The Worker entry dispatches the request correctly.
- Hono handlers see the binding through `c.env.<binding>`.
- The D1 / R2 client API surface (`prepare`, `first`, `head`, …)
  behaves as documented.

It does **not** prove that real Cloudflare D1 / R2 resources
exist or are reachable. Real-resource smoke requires:

1. Real D1 `database_id` and real R2 `bucket_name` declared in
   `wrangler.jsonc`.
2. Production deploy via Cloudflare Workers Builds (canonical
   path — uses the `build_token_uuid` binding registered in
   Cloudflare project settings, NOT `CLOUDFLARE_API_TOKEN`). For
   local-diagnostic deploys the operator may instead use
   `pnpm deploy` with `wrangler login` (OAuth) or an explicit
   `CLOUDFLARE_API_TOKEN` env var; see
   [`docs/security/cloudflare-api-token-inventory.md`](security/cloudflare-api-token-inventory.md)
   for the consumer / non-consumer map.
3. A `curl` smoke against the deployed Worker URL: `/`,
   `/api/v1/health`, `/api/v1/db/ping`, `/api/v1/media/ping`.

This real-resource smoke is part of the 0.1.0 release cut (#009
in `docs/release.md`), not the per-binding local SELF tests (#006
/ #007). Until #009 lands, "D1 / R2 binding works" means **"the
binding API is reachable in the local workerd pool"**, not
**"the production database is online"**.

## Session lifecycle (sign-in / sign-out)

Better Auth (`src/cloudflare/auth/better-auth.ts`, ADR-0009) owns the
session; the admin gates that consume it live in
`src/admin/auth/load.ts` and the `/admin/*` route loaders. The
behavioural contract is pinned by
`test/integration/session-logout.test.ts` (Issue #439):

| Property                                                          | How it is proven                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A sign-in session authorizes `/admin` and `/api/v1/auth/get-session` | positive case: the issued cookie resolves the user (with role) and the dashboard renders 200 |
| The same cookie is refused after sign-out                         | negative case: `get-session` resolves no user, `/admin` and `/admin/keys` 307 to `/admin/login`, and the D1 `session` row is deleted |
| Sign-out clears the browser cookie jar                            | `Set-Cookie` re-issues `better-auth.session_token` **and** `better-auth.session_data` with `Max-Age=0` |
| A client-supplied cookie is never promoted by sign-in            | fixation case: an attacker-planted value resolves to no session before *and* after login; the server issues its own token |
| A rejected sign-out does not invalidate the session               | an `Origin` mismatch is refused (4xx) and the session row survives |
| Replaying a dead cookie is a no-op                                | a second sign-out neither errors nor resurrects a session                          |

Two notes on reading that table. The redirect is pinned as **307**
(TanStack Start `redirect()`) and the **exact** path is asserted, so a
role denial (bounced back to `/admin`) can never be mistaken for a
session denial (`/admin/login`). And the cookie names are the test
pool's un-prefixed form: under `https://` — production, where
`BETTER_AUTH_URL=https://rebuildup.dev` is pinned by ADR-0014 — Better
Auth prefixes both with `__Secure-`, so the production names are
`__Secure-better-auth.session_token` / `__Secure-better-auth.session_data`.
The local pool (no `baseURL`) exercises the un-prefixed form; the
prefix is a transport attribute, not a contract change.

Run it locally:

```bash
pnpm exec vitest run test/integration/session-logout.test.ts
```

Every request goes through the local workerd pool, because sign-in and
sign-out write and delete D1 rows; running this against production
would mutate the operator's database and could invalidate the live
admin session. Fixture identities are local (`.test.local` addresses,
throwaway password) and cookie values are never printed — they are
never used as an operand of an assertion at all (vitest echoes both
operands of a failed `expect`), only cookie names, attributes, and
non-printing identity comparisons are asserted on.

Known residual (open owner decision, Issue #439): `session.cookieCache`
is enabled with `maxAge: 5 * 60`, so a party that captured BOTH
`better-auth.session_token` and `better-auth.session_data` *before* the
logout can replay the pair until the cache cookie expires — the cache
answers without consulting D1. A real browser is not exposed (the
sign-out response clears the pair), but the window is a real deviation
from "logout invalidates the session immediately", and closing it means
re-tuning the auth policy ADR-0009 owns. Until an owner decision is
taken, the window is **documented, not closed**.

The suite watches it as one `it.fails` case that asserts the *desired*
outcome ("a pair captured before sign-out is refused afterwards") and
therefore fails today. Because `/api/v1/auth/get-session` has no 401
path — an unknown or deleted session answers 200 with a `null` body —
"refused" is asserted as "resolves to no user" plus the `/admin`
redirect, never as a status code. The case fires on either remedy:
disabling the cache means no `session_data` cookie is issued at all, so
there is no pair to replay; shrinking it means the pair expires instead
of outliving the logout. Either way `it.fails` reports the unexpected
pass and the case is converted to a plain `it`. (Disabling the cache
also requires re-tuning the "sign-out clears the browser jar" case,
which by construction requires a cache cookie to clear.)

A redacted transcript of the observed responses is kept at
[`docs/verification/security/session-logout-e2e.webp`](verification/security/session-logout-e2e.webp).

## Inventory at 0.1.0

| Package                     | Pinned version | Notes                                 |
| --------------------------- | -------------- | ------------------------------------- |
| `wrangler`                  | `^4.131.0`     | Cloudflare Workers toolchain          |
| `@cloudflare/vite-plugin`   | `^1.0.0`       | Vite <-> Workers bundling             |
| `@cloudflare/vitest-plugin` | `^1.0.0`       | Worker test pool (local Miniflare)    |
| `@tanstack/react-start`     | `^1.168.52`    | Framework                             |
| `@tanstack/react-router`    | `^1.168.52`    | Router                                |
| `hono`                      | `^4.13.7`      | External HTTP boundary                |
| `@pandacss/dev`             | `^1.12.1`      | Styling                               |
| `@biomejs/biome`            | `^1.9.4`       | Format + lint                         |
| `actionlint`                | latest         | Workflow YAML lint (CI step)          |
| `storybook`                 | `^8.6.18`      | Design-system preview (dev only)      |
| `@playwright/test`          | `^1.63.0`      | E2E suite (chromium)                  |
| `vite`                      | `^7.1.0`       | Bundler                               |
| `vitest`                    | `~4.1.0`       | Test runner                           |
| `react` / `react-dom`       | `^19.2.0`      | UI runtime                            |
| `typescript`                | `^5.9.0`       | Language                              |

## Automated checks

- Secret scanning: enabled as an asynchronous CI job (see
  `quality/profile.yaml#security_gates.secret_scanning`).
- Dependency advisory gate: enabled (Issue #470, see
  `quality/profile.yaml#security_gates.dependency_review`). The
  `Dependency advisory audit` step of the `validate` job checks the
  committed lockfile with `pnpm audit --json` and evaluates it against
  the reviewed declaration in `quality/dependency-advisory-gate.json`:
  `critical` / `high` are the declared blocking severities, an approved
  exception is a record — keyed by `(advisoryId, package)`, because one
  advisory commonly spans several packages — carrying a reason, an
  approver, a tracking issue and an expiry date, and advisory data that
  cannot be read fails closed (exit `3`) instead of being reported as
  "0 vulnerabilities". A usage mistake or a malformed declaration is
  exit `2`, never a security verdict. The gate runs in CI rather than in
  `validate:fast` because it needs the registry advisory endpoint; the
  decision logic is in `scripts/check-dependency-advisories.mjs` and the
  same verdict is reproducible with `pnpm run dep-audit:check`. It ships
  with `enforcement: audit` and no approved exceptions, so outstanding
  findings are recorded rather than blocking; moving to `block` is an
  owner decision. Runbook:
  [`docs/runbook/dependency-advisories.md`](runbook/dependency-advisories.md).
- Code scanning (SAST): deferred.
- Container scanning: not applicable (no `Containerfile` at 0.1.0).
- Workflow YAML lint runs through `pnpm run lint:ci` inside the
  `validate` job (actionlint 1.7.12, downloaded by
  `scripts/lint-ci.mjs`). Biome does not lint `.yml`.
- Redirect-target matrix (Issue #454) is regenerated from the shipped
  guard by `pnpm run security:redirect:report`; the committed image and
  its reading guide are in
  [`docs/verification/security/`](verification/security/).

## Dependency install lifecycle scripts

`pnpm install` can execute third-party code before any repository
test exists. pnpm 12 is default-deny for that: only the packages
listed as `true` in `pnpm-workspace.yaml#allowBuilds` (or in
`#permissions`, which supersedes it) run their `preinstall` /
`install` / `postinstall` hooks.

That list is audited, not remembered:

- `quality/install-scripts.json` records, per package, whether the
  build is actually needed and why. `default_decision` is `block`;
  a record without a `justification` is rejected.
- `pnpm run install:scripts:check` (part of `validate:fast`) fails
  when an installed package can execute code at install time with no
  reviewed record, when the policy decision and pnpm's execution
  allow-list disagree in either direction, when a grant survives only
  in the legacy `onlyBuiltDependencies` list, or when an installed
  manifest grows an undocumented hook. "Can execute" includes an
  implicit `node-gyp rebuild` for a package that ships `binding.gyp`
  and the `prepare` of a git-hosted dependency. It warns when an
  allow-list entry buys no build, and on stale records.
- The audit is **status-only**: it reads package manifests plus those
  two policy files and prints package names, versions, hook names and
  policy text. No secret value (`.dev.vars`, Infisical, Worker
  secret) is read or printed, and nothing in the runtime / deploy
  path is touched.

Operator procedure (what each failure means, how to remediate, and
the recorded high-risk entry) lives in
[`docs/runbook/install-script-audit.md`](runbook/install-script-audit.md).
Tool-side / upstream changes are deliberately out of scope for the
audit itself (Issue #474): the gate records the risk and names the
removal condition instead of patching a dependency.

## Browser binaries (Playwright)

`pnpm run e2e` runs against `pnpm dev` (locally) or a deployed Worker
URL via `PLAYWRIGHT_BASE_URL`. The Chromium browser binary used by the
E2E suite is downloaded on demand:

- Locally: `pnpm run e2e:install` (`playwright install --with-deps
  chromium`). The `--with-deps` flag uses `sudo apt-get install` on
  Linux to add the system shared libraries Chromium needs
  (`libnspr4.so`, etc.) — operators should review this command before
  invoking it. The sandbox where development happens has no `sudo`,
  so `e2e:install` fails there; on CI runners `sudo` is available.
- On CI: the `Install Playwright Chromium` step in
  `.github/workflows/ci.yml` runs `pnpm exec playwright install
  --with-deps chromium`. The resulting `playwright-report/` artefact
  is uploaded via `actions/upload-artifact@v4` with a 7-day retention
  for triage; it contains the same HTML / traces that the local run
  would emit and must not include credentials or secrets.

Playwright is pinned in `package.json#devDependencies` and the
browser version is locked by `@playwright/test`'s `browsers` manifest
(see `pnpm exec playwright --version`). Bumping Playwright requires
running `pnpm run e2e:install` once after the lockfile update so the
new browser binary is available.
