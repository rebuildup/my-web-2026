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

The Worker serves two mutation layers, and **each layer owns a
different CSRF check**. `src/server.ts` dispatches by path prefix
*before* the TanStack Start handler runs, so anything under the
external boundary prefixes never reaches the framework middleware —
which is why the two cannot be one mechanism.

| Layer                            | Owner                                         | Applies to                                      |
| -------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| TanStack Start server functions  | **framework default** CSRF middleware          | `/_serverFn/*` (`handlerType === 'serverFn'`)   |
| Hono external boundary           | `csrfGuard` (`src/http/middleware/csrf.ts`)   | `/api/v1/*` unsafe methods                      |
| `/api/v1/auth/*`                 | Better Auth (`trustedOrigins` + form CSRF)     | cookie-carrying writes                          |

### TanStack Start layer (default middleware)

`createStartHandler` installs
`createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })`
**only while no custom `startInstance` exists**. `src/start.ts` is
intentionally absent: adding one would replace the default middleware
with whatever that file declares and leave every server-function
mutation unprotected, with no production warning. AGENTS.md §2
requires an ADR before that happens.

### Hono boundary layer (`csrfGuard`)

ADR-0002 §1/§2 split the Worker into two layers, so the external
boundary never reaches the framework middleware and therefore owes its
write methods their own origin check (that obligation is inferred
from the split, not quoted from the ADR; whether it deserves its own
ADR is an open owner decision). `csrfGuard` implements it for unsafe
methods (`POST` / `PUT` / `PATCH` / `DELETE`) under `/api/v1/*`:

1. Safe methods are **never** checked — the boundary exposes no
   state-changing `GET`.
2. `Sec-Fetch-Site` present → must be `same-origin`.
3. Else `Origin` present → must equal the request origin
   (`Origin: null` is never same-origin).
4. Else `Referer` present → must be same-origin, with a delimiter
   check so `https://host.evil.example` cannot pass.
5. Else → **rejected**. Fail-closed, matching the framework default
   (`allowRequestsWithoutOriginCheck: false`).

A refusal is `403` with a stable body and no caller-supplied value in
it:

```json
{ "error": "csrf_rejected", "reason": "cross_site_fetch_metadata" }
```

`reason` is one of `cross_site_fetch_metadata`, `origin_mismatch`,
`referer_mismatch`, `origin_check_missing`. It names the header that
failed, never its value.

The guard is mounted in `src/http/hono.ts` after the local mock gate
and the request-id middleware, and before every router — so a refused
cross-site write never reaches authentication, rate limiting, or D1.

**No credential-based exemption.** The boundary's writes use
`Authorization: Bearer <api key>`, which a browser cannot attach
cross-site by itself. Exempting bearer requests anyway would make the
guard untestable for the requests that matter, so first-party callers
declare their origin instead: the Home self-calls
(`src/home/{access,reactions}/load.ts`) send
`Origin: <the origin they are calling>`.

**Consequence for scripted API calls.** A non-browser client hitting a
write endpoint directly must send the header itself:

```bash
curl -s -X POST https://rebuildup.dev/api/v1/access/hit \
  -H 'Authorization: Bearer …' \
  -H 'Origin: https://rebuildup.dev' \
  -H 'Content-Type: application/json' -d '{…}'
```

Reads (`GET` / `HEAD` / `OPTIONS`) are unaffected. The local
`LOCAL_API_MODE=mock` gate answers before the guard, so the mock smoke
commands in [`docs/development.md`](development.md) keep working; the
mock has no D1 / R2 side effects.

**Consequence for the repository's own suites.** The same signal
applies in-process: a workerd integration suite that writes through the
real boundary must declare the origin in its shared request headers,
otherwise it measures the guard instead of what it was written to prove.
The suites that write today do exactly that —
`test/integration/d1-parameter-binding.test.ts` (`http://localhost`, the
origin Hono's `app.request()` resolves a relative path against),
`test/integration/admin-authorization.test.ts` and
`test/integration/api-key-scope.test.ts` (`https://example.com`, the
pool's Worker origin). The guard's refusal behaviour is asserted
separately in `test/integration/csrf-contract.test.ts`.

### What breaks the contract, and what catches it

| Break                                                | Caught by                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Adding `src/start.ts` / a custom `startInstance`      | `pnpm run csrf:contract:check` (`validate:fast`), integration test |
| Turning on `skipCSRFCheck` / `disableCSRFCheck` / `disableOriginCheck` / `disableCsrfMiddlewareWarning` | `pnpm run csrf:contract:check` |
| Removing or unmounting `csrfGuard`                    | `pnpm run csrf:contract:check`, workerd integration test       |
| Moving the guard mount below `route()` (Hono dispatches in registration order) | `pnpm run csrf:contract:check` (order rule) |
| Changing the rejection code / behaviour               | `src/http/middleware/csrf.test.ts`, `test/integration/csrf-contract.test.ts` |
| A write endpoint answering on `GET`                   | `test/integration/csrf-contract.test.ts` (D1 before/after read on `GET /api/v1/reactions`) |

Where the assertions live:

- `src/http/middleware/csrf.test.ts` — decision matrix (unit).
- `test/integration/csrf-contract.test.ts` — end-to-end through the
  real Worker in the local workerd pool: a cross-site write with a
  **valid** API key is refused and leaves no D1 row; a same-origin
  write is accepted; cross-site reads stay readable and write nothing.
  The "GET writes nothing" evidence is a D1 before/after read on
  `GET /api/v1/reactions` only — the boundary's other reads
  (`/api/v1/access/count/:key`, `/api/v1/reaction-images/:id`,
  `/api/v1/db/ping`, `/api/v1/media/ping`) are asserted reachable but
  have no side-effect assertion, so widening that claim is future work
  rather than something this record overstates.
- `e2e/csrf.spec.ts` — the same positive/negative cases over HTTP
  against the built preview server, including the `/_serverFn/*`
  endpoint (the workerd pool does not wire that URL, see below).
- `scripts/check-csrf-contract.mjs` — the structural gate; its own
  tests are `scripts/check-csrf-contract.test.mjs`.

Why the `/_serverFn/*` half is not asserted in the workerd pool:
`TSS_SERVER_FN_BASE` is injected by the Vite plugin's `define`, which
the vitest worker bundle does not apply, so `createStartHandler` skips
its server-function branch and the router answers 404. Probing it
there would test the harness rather than the contract.

See also: [`ADR-0002`](adr/ADR-0002-architecture-boundary.md) (the
two-layer split), [`ADR-0010`](adr/ADR-0010-abuse-protection-rate-limit.md)
(the write-path rate limit that still applies after the guard).

## Login enumeration and credential brute force

`POST /api/v1/auth/sign-in/email` is the only unauthenticated
credential endpoint on the boundary. Two properties are pinned and
asserted in `test/integration/auth-login-hardening.test.ts`:

- A wrong password on an **existing** account and an attempt on a
  **non-existent** account return byte-identical responses (status,
  body, header set), so the endpoint is not an existence oracle.
- Failed logins are throttled **per client IP** — 3 attempts per 10
  seconds, then `429` with `X-Retry-After`. The throttle is evaluated
  before the password is checked, so it leaks nothing either, and it is
  scoped to one client so it cannot be used as a lockout.

The budget and the client-IP source are stated explicitly in
`src/cloudflare/auth/better-auth.ts` rather than inherited from Better
Auth's `NODE_ENV` / `x-forwarded-for` defaults, because neither default
holds for this deployment. Full contract, evidence, and known limits:
[`docs/security/login-enumeration-rate-limit.md`](security/login-enumeration-rate-limit.md).
## OAuth / OIDC callback: state and redirect (Issue #444)

The shipped auth config (`src/cloudflare/auth/better-auth.ts`) registers
the `admin()` and `apiKey()` plugins and **no social provider**. The
OAuth machinery therefore ships unconfigured: `/api/v1/auth/callback/:id`
and `/api/v1/auth/sign-in/social` are reachable, but no provider round
trip can complete, so **no callback can mint a session** on this
deployment. What an attacker controls is everything in front of that
stop, and that is what the contract test pins.

Contract: [`src/http/auth/oauth-callback.test.ts`](../src/http/auth/oauth-callback.test.ts).

An untrusted redirect target crosses two gates before a session could
exist: the project-owned
[`redirectTargetGuard`](../src/http/security/redirect-guard.ts) mounted
in front of the handler (Issue #454), and then Better Auth's own origin
check. Which gate answers is part of the contract, so both are pinned.

| Gate                                   | Rejection signal                                                  |
| -------------------------------------- | ----------------------------------------------------------------- |
| `state` missing                         | redirect to `<base>/error?error=state_not_found`                 |
| `state` unknown / tampered / replayed   | redirect to `<base>/error?error=state_mismatch`                  |
| `state` cookie absent, for another id, or with a forged signature | same (`state_security_mismatch` is reported as `state_mismatch`) |
| `state` payload expired                 | `state_mismatch`                                                  |
| valid `state`, provider not configured   | `oauth_provider_not_found` — the *next* gate, i.e. state passed   |
| redirect target in query or body that is not an internal path | `400` + `invalid_redirect_target { param, reason, source }`, and no `Location` |
| `Origin` / `Referer` from another site   | `403` + `INVALID_ORIGIN`                                          |
| cookie-bearing request with no origin    | `403` + `MISSING_OR_NULL_ORIGIN`                                  |

Three properties are asserted beyond the status codes, because any one
of them alone would still leave a redirect open:

1. Every callback `Location` stays on the base URL Better Auth resolved
   for that request. The suite runs without `BETTER_AUTH_URL` (see
   "Test scope" below), so Better Auth infers the base URL from the
   request origin — the assertion is *weaker* than production, where the
   base URL is pinned by the binding (ADR-0014), never stronger.
2. A guard rejection carries **no** `Location` header at all, and its
   body names the field, the reason and the source without echoing the
   value. A `callbackURL` injected on the callback request therefore
   cannot become the redirect target. The *success*-path redirect target
   is not observed on this deployment (there is no provider to reach
   it), so it is not claimed here.
3. No rejection path sets a session cookie or leaves a `session` row.

Each guard is paired with a positive control, so the suite cannot pass
by rejecting everything: a correctly bound `state` reaches the provider
gate instead of the state gate, and a *relative* `callbackURL` passes
both redirect gates instead of being refused.

One deviation is deliberate and recorded in the test: the pool omits
`BETTER_AUTH_URL`, so the guard's trusted-origin list is empty there and
**every** absolute URL is refused — including this origin's own
(`400`, reason `external_origin`). With the production binding that
value is trusted and downgraded to its path. The suite pins the
fail-closed direction, not the pinned-origin production configuration.

Scope note: the callback rejections above all take Better Auth's default
`${baseURL}/error` branch. A flow started with a validated
`errorCallbackURL` redirects to that trusted origin instead — a branch
this suite does not observe, because the fixture never writes `errorURL`
into the signed state. The chain is still defended at the entry point,
where an off-origin `errorCallbackURL` is refused.

Fixtures are local only: rows in the workerd test pool's D1 plus a cookie
signed with the dummy `BETTER_AUTH_SECRETS` binding that
`vitest.config.ts` declares. No production secret is read, logged, or
asserted, and no test contacts a real IdP. Response capture from the
local run:
[`verification/security/oauth-negative-tests.webp`](verification/security/oauth-negative-tests.webp).

## Response security headers

`X-Content-Type-Options: nosniff`, `Referrer-Policy` and
`Permissions-Policy` are emitted on every response. The contract, the
per-Tool permission grant, and how to verify both delivery surfaces
(Worker responses and Cloudflare Static Assets) are documented in
[`docs/security/security-headers.md`](security/security-headers.md).
The gate is `node scripts/check-security-headers.mjs`
(`pnpm run security:headers:check`, part of `validate:fast`).

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

## Inbound webhooks

`/webhooks/*` is dispatched to the external boundary but **no handler
is mounted** — a signed delivery answers `404 {"error":"not_found"}`.
The verification adapter for a future sender (GitHub, or a CMS later)
— HMAC signature, freshness window, delivery-id replay
de-duplication — exists as a reviewed contract with local fixtures and
tests, and ships without an entry point on purpose. Contract, failure
behaviour, and the promotion checklist that must be satisfied before a
route exists:
[`docs/security/webhook-signature-verification.md`](security/webhook-signature-verification.md).

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
のような拡張も走査対象）。RFC 6797 の directive 名は大文字小文字を
区別しないため、`MAX-AGE=…` も同じ候補として読み、canonical との比較も
case-insensitive に行う（Set-Cookie の `Max-Age` は属性の正確な綴りで
単独のときだけ Cookie として除外する）。`+` で連結されたリテラルは
**1 つの式として畳み込む**ため、`'max-age=31536000' + '; includeSubDomains'`
は拡張として落ちる。連結の相手がリテラルでない場合
（`SUFFIX + 'max-age=…'`、`HSTS_DIRECTIVE + '; …'`）は実行値が
静的には不明なので「composed at runtime」として報告する。
コメントは走査前に空白で埋めるため、
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

## Step-up re-authentication

A live admin session (30-day `session.expiresIn`, ADR-0009 §8) is the
right precondition for *reading* the admin surface, but not for
*granting standing authority*: an API key issued at `/admin/keys`
outlives the session that created it. So that one operation asks the
operator to re-confenticate their password first (step-up), with a
five-minute window keyed on the server-resolved session id.

Implementation, the states it distinguishes (`required` / `confirmed`
/ `expired` / `rejected`), why the grant lives in D1 rather than in a
signed cookie, and why the refusals the UI branches on travel as
returned outcomes rather than thrown errors (TanStack Start's
`ShallowErrorPlugin` drops an `Error` subclass's own properties on the
wire) are recorded in
[`security/step-up-authentication.md`](security/step-up-authentication.md).
Verification runs in the local workerd pool; no production account or
credential is used.

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
- Supply-chain SBOM: CycloneDX 1.6, generated from `pnpm-lock.yaml`,
  `package.json`, `pnpm-workspace.yaml` and `src/tools/manifest.json`
  by `pnpm run sbom:build`, verified against the live lockfile by
  `pnpm run sbom:check` inside `validate:fast`. The generator reads no
  environment credential, no `.dev.vars` file, no Infisical export and
  no Worker secret value; the gate rejects a document that contains a
  declared runtime-secret *name* or a credential-shaped value. CI
  retains the document as the `sbom-<sha>` workflow artifact, and the
  release attachment step is human-gated. See
  [`docs/runbook/sbom.md`](runbook/sbom.md).
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

## Error redaction (Issue #457)

The external HTTP boundary (`src/http/**`) and the public
server-function surfaces must never answer a client with an internal
error. "Internal" means: a stack trace or source location, a
SQL / D1 / R2 message, a table or column name, a binding name, a
secret or secret binding name, or the text of a caught exception.

### Boundary 5xx contract

`src/http/errors.ts` owns the only redaction path for 5xx responses.
Every body is exactly:

```json
{
  "error": "internal_error" | "service_unavailable",
  "message": "<repo-authored sentence>",
  "request_id": "<correlation id>"
}
```

The caught error is handed to `console.error` and to nothing else.

| Concern | Contract |
| --- | --- |
| Correlation | `request_id` is byte-identical to the `X-Request-Id` response header, and to the id in the internal log line. A client-supplied `X-Request-Id` is reused when it matches `^[A-Za-z0-9._:-]{1,128}$` — the trace-id alphabets in real use (hex, UUID, W3C `traceparent`, dotted service ids) — so a reporter can be traced; anything else (empty, too long, spaces, control characters) is replaced by a freshly minted 128-bit hex id. The charset is not cosmetic: since #457 the id is published in the **body** too, so an unconstrained echo would let any client string ride inside a documented contract field. |
| Ops probes | `/api/v1/health`, `/api/v1/db/ping` (200) and `/api/v1/media/ping` (404 `key_not_found`) keep their documented bodies, including the `binding` field. Only the **failure** branch changed: the old `{"status":"binding_error","binding":"d1"\|"r2"}` 503 is now the redacted body above. The request path already identifies which probe failed, so no operational signal is lost. |
| Minting outside `/api/v1/*` | `resolveRequestId` mints an id when the request-id middleware did not run — that is, the `/webhooks`, `/oauth`, and `/integrations` prefixes. None of those prefixes has a handler yet, so the branch is currently unreachable in production; it exists so that a future handler on those prefixes is correct by default rather than by remembering. |
| Auth | 401 / 403 bodies are unchanged (`missing_authorization`, `invalid_api_key`, `missing_scope`). They carry no server state, and the correlation id is still available through the `X-Request-Id` header. |
| 4xx bodies | Router-owned rejection bodies may echo a **repo-authored** validator message (a closed set: `kind must be one of: emoji, image`). They never echo an error object, a table name, or a stack. |

Open question (deliberately not decided here): whether the `binding`
field in the **200 / 404** probe bodies counts as internal
information. The failure branch no longer publishes it and the success
branch still does; this record states that fact rather than claiming
the binding is hidden.

### Server-function surfaces

TanStack Start serialises a thrown handler error into the
`/_serverFn/*` payload through `ShallowErrorPlugin`, which copies the
**message**. A raw D1 failure would therefore render
`D1_ERROR: no such table: …` on a public page.

Two rules cover the public server functions, and which one applies is
a property of the surface:

| Surface | Rule |
| --- | --- |
| `src/portfolio/public.ts` (`project` / `adjacent` / `list`) and `src/about/public.ts` (`about`) | The read **is** the page. A failure throws through `withPublicErrorBoundary` (`src/portfolio/public-errors.ts`): the internal error is logged once with a short `ref`, and the thrown error carries `portfolio_unavailable (ref=…)` — 16 hex chars — instead. `/about` uses the same boundary because its `experience` subset is composed from the same public portfolio rows, so it failed through the same mechanism. |
| `src/home/reactions/load.ts` (the `/` widget) | The read is an **input** to a widget on a page that must render regardless. Both legs are best-effort: the `reaction_emoji_catalog` read and the upstream `fetch` degrade to an empty catalog / empty aggregate list and log the internal error, so a storage or transport outage costs the widget its content rather than the home page its error screen. The sibling home loaders already worked this way (`getHomeCounter`, `getHomeSystemStatus`, `probeCloudflareHealth`); #457 brought `getHomeReactions` in line. |

### Verification

- Unit: `src/http/errors.test.ts`,
  `src/portfolio/public-errors.test.ts`, and the degradation cases in
  `src/home/reactions/load.test.ts`.
- Local worker: `test/integration/error-redaction.test.ts` drives the
  real boundary (real middleware, real rate-limit binding, real D1)
  for accepted, rejected, and failed requests — including a real D1
  failure produced by dropping the `reactions` table, and injected
  D1 / R2 binding failures for the 503 branch. The same suite
  asserts the three rendered public screens through the real SSR
  pipeline: `/portfolio` and `/about` answer 500 with
  `portfolio_unavailable (ref=…)` and no D1 marker anywhere in the
  HTML, and `/` still answers 200 with a degraded reactions widget
  when `reaction_emoji_catalog` is absent.
- Screenshot:
  [`docs/verification/security/error-redaction-page.webp`](verification/security/error-redaction-page.webp),
  regenerated with `node scripts/capture-error-redaction-report.mjs`
  (or `pnpm run capture:error-redaction-report`). The page renders the
  responses the Worker actually produced; it contains no credential.
  The committed artefact is WebP (width ≤ 1600 px, quality 80) rather
  than PNG: Playwright cannot write WebP, so the capture script
  re-encodes the screenshot buffer with the `sharp` devDependency and
  never writes the intermediate PNG.

## Search index boundary (robots.txt is not access control)

`GET /robots.txt` and `GET /sitemap.xml` are served by
`src/http/seo/` (Issue #420: TanStack Start 1.168 cannot answer a
non-HTML document from a route file, so they are external-boundary
routes). What is a **contract** is `scripts/_index-boundary.mjs`: it
classifies every route in the generated route tree as crawlable /
indexable / `noindex`, and `pnpm run index:boundary:check` (part of
`validate:fast`) fails when the served documents contradict it.
Inspect the per-route intent with `pnpm run index:boundary:report`.

There is deliberately **no committed `public/robots.txt`**: Cloudflare
Static Assets answers a matching asset BEFORE the Worker runs
(`assets.run_worker_first` is unset), so a file in `public/` would
silently shadow the route instead of documenting it.

The boundary has exactly two halves, and they are not interchangeable:

- **Crawl control** — `Disallow` in `robots.txt` keeps a URL out of
  the crawl. The served policy declares none today, and in particular
  none for `/admin`: the admin subtree is de-indexed by its own
  `noindex` meta, which is only readable at fetch time, so blocking
  the crawl would leave the URLs "indexed, though blocked by
  robots.txt". The gate rejects that combination (`noindex-blocked`)
  rather than trusting this paragraph. Crawl budget for the machine
  boundaries (`/api/v1`, `/webhooks`, `/oauth`, `/integrations`,
  `/_serverFn`) is the SEO owner's call — they answer 401/404 rather
  than serving a document, so the contract neither demands nor forbids
  a rule for them.
- **Index control** — `<meta name="robots" content="noindex, nofollow">`
  is what actually removes a URL from the index. It is declared by the
  page itself (`src/routes/admin.tsx` for the whole admin subtree, and
  the Tool shell routes), which is why those pages stay crawlable: a
  page a crawler cannot fetch cannot deliver its own noindex, and
  Google then reports the URL as "Indexed, though blocked by
  robots.txt".

Neither half is authentication. `robots.txt` is a public document
served to anonymous clients — `curl`, a browser, or a scraper ignores
it — so the admin surface stays protected by `requireAdmin()`
(`src/admin/auth/require-admin.ts`) and `/api/v1/*` by the API-key
middleware. `test/integration/index-boundary.test.ts` proves the two
are independent: a `Googlebot` User-Agent gets no privilege on
`/admin` or `/admin/keys`, and the API boundary still answers `401`.

The gate fails loudly rather than silently on: a site-wide
`Disallow: /`, a raw-prefix `Disallow` that would shadow a sibling
public route, an `indexable` route that a rule blocks, a route
de-indexed by its own `noindex` meta that is also kept out of the
crawl (`noindex-blocked` — the combination this paragraph describes),
a crawl-blocked route that lost its rule, a `noindex` meta on a public
route, a sitemap entry whose route does not exist (or vice versa), a
sitemap URL that disagrees with the page's own `canonical`, a sitemap
rendered off the canonical origin, a `Sitemap:` directive that is not
the canonical one, and any new route that has no declared index intent.
The meta and canonical checks strip comments before matching, so a
declaration that only survives in a comment — or that splits
`name: 'robots'` and `content: 'noindex'` across two entries — does
not count.

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
