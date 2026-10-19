# Security verification artefacts

Screenshots the Issues require, regenerated from measurements rather
than hand-written. Each artefact is regenerable from a
repository-controlled command, so a reviewer can reproduce it instead
of trusting the image.

| Artefact | Issue | Regenerate |
| --- | --- | --- |
| [`frame-ancestors-test.webp`](frame-ancestors-test.webp) | #448 | `pnpm run verify:frame-ancestors-screenshot` |
| [`csp-report.webp`](csp-report.webp) | #447 | `pnpm run verify:csp-report-only-screenshot` |
| [`ssrf-url-adapter.webp`](ssrf-url-adapter.webp) | #453 | `pnpm run security:ssrf:report` |
| [`hsts-response.webp`](hsts-response.webp) | #446 | `pnpm run verify:hsts-screenshot` |
| [`redirect-validation.webp`](redirect-validation.webp) | #454 | `pnpm run security:redirect:report` |
| [`headers-browser.webp`](headers-browser.webp) | #449 | `node scripts/security-header-report.mjs` |
| [`markdown-xss-fixture.webp`](markdown-xss-fixture.webp) | #451 | capture generator is **not** in the repository — see [`## markdown-xss-fixture.webp`](#markdown-xss-fixturewebp); the same properties are asserted on every push by `pnpm exec vitest run test/integration/markdown-xss-ssr.test.ts` and by `pnpm run e2e` |
| [`webhook-signature-fixture.webp`](webhook-signature-fixture.webp) | #463 | `pnpm run webhook:fixture:report` |
| [`error-redaction-page.webp`](error-redaction-page.webp) | #457 | `pnpm run capture:error-redaction-report` |
| [`log-redaction-test.webp`](log-redaction-test.webp) | #467 | HTML: `node scripts/log-redaction-report.mjs` — see [`## log-redaction-test.webp`](#log-redaction-testwebp) |
| [`reactions-rate-limit.webp`](reactions-rate-limit.webp) | #456 | `pnpm run verification:write-rate-limit` |
| [`tool-artifact-inventory.webp`](tool-artifact-inventory.webp) | #466 | `pnpm run verify:tool-artifact-inventory-screenshot` |
| [`release-gate-missing-check.webp`](release-gate-missing-check.webp) | #508 | `pnpm run verify:release-gate-screenshot` |
| [`asvs-coverage-matrix.webp`](asvs-coverage-matrix.webp) | #507 | `pnpm run verify:asvs-coverage-screenshot` |
| [`asvs-coverage-probes.webp`](asvs-coverage-probes.webp) | #507 | `pnpm run verify:asvs-coverage-screenshot` |
| [`security-txt-browser.webp`](security-txt-browser.webp) | #468 | `pnpm run verify:security-txt-screenshot` |
| [`r2-restore-proof.webp`](r2-restore-proof.webp) | #462 | `pnpm run r2:restore:proof:report` |

## `r2-restore-proof.webp` (Issue #462)

公開画像が `MEDIA` から 1 件消えたときの復旧手順を、**credential 不要・本番非接触**
の fixture proof で実行した結果。`quality/fixtures/r2-media-restore/` の 7 記録ケース
（復旧成功 / 冪等 / private namespace 拒否 / source 不在 / manifest 不一致 /
write 欠損 / 判別不能）を `src/cloudflare/media-restore.ts` に通し、
宣言どおりに振る舞ったかを判定する。実行先は process 内の Map で、
Cloudflare への read / write コードパスは存在しない。

判定を左右するのは「成功したか」だけでなく **「write しなかったか」** である。
`bucketAfter=absent` を宣言した 3 ケース（private 拒否 / source 不在 /
manifest 不一致）は、書いた瞬間に逸脱として落ちる。

status-only 契約どおり、画像には object key・key 断片・namespace・
source path・credential を写していない（生成側が実行前に同じ leak guard を通し、
1 件でも検出すると非ゼロ終了する）。手順と失敗時挙動は
[`docs/runbook/r2-media-restore.md`](../../runbook/r2-media-restore.md)、
実 R2 binding での検証は
`pnpm exec vitest run test/integration/r2-media-restore.test.ts`。

Regenerate:

```bash
pnpm run r2:restore:proof          # fixture proof（status-only）
pnpm run r2:restore:proof:report   # -> .tmp/r2-restore-proof.html（この画像の生成元）
```
| [`threat-model-diagram.webp`](threat-model-diagram.webp) | #479 | `pnpm run verify:threat-model-screenshot` |

## `asvs-coverage-matrix.webp` (Issue #507)

OWASP ASVS 5.0.0 からこの platform が実際に公開している surface に該当する
項目だけを選んだ coverage ledger。ASVS certification ではない（manifest の
`standard.certification` は `false` 固定で、`true` にすると gate が error になる）。

4 状態（`pass` / `fail` / `not run`（未検証）/ `N/A`）を区別して表示し、
`not run` と `N/A` は pass 件数に入れない。適用対象なのに証跡が無い項目は
「未検証」として、未来の手作業（`follow_up`）ごと一覧される。宣言した
test / doc / gate が repository に無ければ `not run` ではなく `fail` になる。

下半分は false-green probe。`quality/fixtures/asvs-coverage/` の 4 fixture
（`pass` / `missing-evidence` / `missing-follow-up` / `unregistered-gate`）を
同じ評価関数で走らせ、不正な主張が fail に落ちることを見せる。probe と実行手順は
[`asvs-coverage-probes.webp`](asvs-coverage-probes.webp)（同じコマンドが生成）に分けた。
画像は証拠であってテストの代用ではない。判定は `pnpm run asvs:check` の終了コードと
`node --test scripts/check-asvs-coverage.test.mjs` が担保する。

Regenerate:

```bash
pnpm run asvs:check             # 判定（exit 0 / 1）
pnpm run asvs:report            # .tmp/asvs-coverage-report.html
pnpm run verify:asvs-coverage-screenshot # WebP at the path above
```

Issue は `asvs-coverage-matrix.png` と書いているが、同ディレクトリの他 artefact と同じく
WebP で納める（Playwright は WebP を書けないため、`sharp` でメモリ上の capture を
再エンコードし、途中 PNG は作らない）。テキストが対象なので `nearLossless` を優先し、
300 KB 予算に収まる最高 quality を選ぶ。読む手順と「対象外 / 将来の手作業」の
一覧は [`docs/verification/security/asvs-coverage.md`](asvs-coverage.md)。

## `threat-model-diagram.webp` (Issue #479)

The per-capability threat model ledger
([`docs/verification/security/threat-model.md`](threat-model.md))
as one reviewable page: the SVG trust boundary diagram of the capability
the Issue asks for (the external HTTP boundary — columns are the trust
zones, boxes are nodes, arrows are declared boundaries labelled with the
controls on them), that feature unit's threats in full (STRIDE, scenario,
asset, mitigation and its state) with its review questions, a compact
roster of the other seven feature units, the false-green probe, and the
observation / repair table for each way the gate can fail.

The rows are the shipped code's own verdicts: the diagram geometry, the
threat statuses and the four probe verdicts are all produced by
`scripts/check-threat-model.mjs`, the same module
`node --test scripts/check-threat-model.test.mjs` asserts on. Every
claim is resolved against the working tree — an asset names a path that
exists or a binding *name*, a mitigation names a file that exists — so a
picture of an attack surface the repository does not contain cannot be
produced. The run refuses to render at all while the ledger has an error,
so the page can never show a green verdict over a failing tree.

The committed manifest `quality/threat-model.json` stays the complete
record: the page is the review view of it, not a copy. The per-threat
scenarios of the seven roster capabilities live in the manifest, and the
roster carries their STRIDE category, asset and verdict.

The Issue names `threat-model-diagram.png`; the artefact ships as WebP
for the same reason as the files above — Playwright cannot write WebP, so
the generator re-encodes the in-memory capture with `sharp` (width ≤
1600 px), writes no intermediate PNG, and refuses any non-`.webp` target.

Nothing secret is in the picture: the ledger records assets by name and
source, the gate shape-scans every manifest string and never prints the
value it refused, and the generator re-reads its own markup to confirm the
probe credential did not reach the page. The renderer is a text scan —
no Worker, no binding, no network call.

Regenerate:

```bash
pnpm run threat:model:check             # the verdict (exit 0 / 1)
pnpm run threat:model:report            # .tmp/threat-model-report.html
pnpm run verify:threat-model-screenshot # WebP at the path above
```

## `release-gate-missing-check.webp` (Issue #508)

The release report and the commands the release really runs, as one
reviewable page: every inspection the project ships gets one row, and the
row is resolved against the transitive `pnpm run` closure of
`validate:fast` / `validate:integration` / `validate:release` plus the CI
`validate` job. The page carries four distinct statuses — `pass` /
`fail` / `not run` / `N/A` — and the last two are never counted as a
pass: an inspection that did not run is reported as an inspection that
did not run.

The lower half is the false-green probe: the same pure evaluator runs on
`quality/fixtures/release-gate/pass.json` (a complete release) and on
`missing-required-check.json`, the same world with one required
inspection removed from the chain. The second verdict is FAIL, which is
the Issue's first acceptance condition. The image is evidence, not the
test — `node --test scripts/check-release-gate-coverage.test.mjs` asserts
the verdicts and reads the same fixtures.

Regenerate:

```bash
pnpm run release:gate:check             # the verdict (exit 0 / 1)
pnpm run release:gate:report            # .tmp/release-gate-report.html
pnpm run verify:release-gate-screenshot # WebP at the path above
```

The Issue names `release-gate-missing-check.png`; the artefact ships as
WebP for the same reason as `redirect-validation.webp` below —
Playwright cannot write WebP, so the generator re-encodes the in-memory
capture with `sharp` (width ≤ 1600 px, quality 74) and never writes an
intermediate PNG. Reading guide:
[`docs/verification/security/release-gate-coverage.md`](release-gate-coverage.md).

## `webhook-signature-fixture.webp`

The inbound-webhook verification contract table (Issue #463): every
local fixture — signature, freshness window, replay claim — with its
declared and observed verdict. The rows are produced by
`scripts/webhook-signature-fixture-report.mjs` running the **same**
`src/http/webhooks/fixtures.ts` builder the Vitest contract test
asserts on, so the picture cannot disagree with the suite; the script
exits non-zero if any fixture deviates. No key material is rendered.
`/webhooks/*` still has no mounted handler — the report documents an
adapter, not a published entry point. Reading guide:
[`docs/security/webhook-signature-verification.md`](../../security/webhook-signature-verification.md).

## `error-redaction-page.webp` (Issue #457)

Proof that the external HTTP boundary answers failures with
`{ error, message, request_id }` only — no stack, SQL, table name,
secret name, or binding name — while accepted and rejected requests
keep their documented shapes, and that a failing public server
function renders `portfolio_unavailable (ref)` instead of the D1
message. The last rows are real SSR renders of `/portfolio`,
`/about`, and `/`.

Regenerate:

```bash
pnpm run capture:error-redaction-report
# or: node scripts/capture-error-redaction-report.mjs
```

The command runs `test/integration/error-redaction.test.ts` in the
local workerd pool, reads the responses that suite captured, renders
them as a static report in `.tmp/`, and screenshots it with the
Playwright chromium already installed for the E2E suite.

The committed artefact is WebP (width ≤ 1600 px, quality 80), not
PNG: Playwright cannot write WebP, so the script re-encodes the
screenshot buffer with the `sharp` devDependency and never writes an
intermediate PNG. The report is a text-heavy page, so q80 keeps the
bodies and the leak verdicts legible at a fraction of the PNG size,
and the repository does not carry a lossless raster for an artefact
that is regenerated on demand.

Reading the page:

| Badge | Meaning |
| --- | --- |
| 成功 (accepted) | Valid input; the documented public contract is returned unchanged. |
| 拒否 (rejected) | Input the caller got wrong; a stable error code (and at most a repo-authored validator reason) is returned. |
| 失敗・秘匿 (failed) | An internal error occurred; the body carries only the code, a safe message, and the correlation id. The last rows are SSR renders: `/portfolio` and `/about` show `portfolio_unavailable (ref)` and nothing else, and `/` still renders with a degraded reactions widget. |

Nothing secret is captured: the suite authenticates with a literal
stub key through the documented DI seam
(`src/http/api-keys/middleware.ts#withVerifyApiKey`) and never reads
an env var, a `.dev.vars`, or a Worker secret.

The Issue names `error-redaction-page.png`; the artefact ships as WebP
in the same directory, for the same reason as `redirect-validation.webp`
below — Playwright cannot write WebP, so the generator re-encodes the
screenshot buffer with `sharp` and never commits an intermediate PNG.

## `frame-ancestors-test.webp`

The inbound embed policy (Issue #448) exercised over the surfaces that
exist today: public documents, the Tool shell and its artefact, the
Admin redirect and child routes, the Account boundary, the
lookalike paths that must not inherit a denial, and the committed
public static HTML under `public/` (`/share/procon2026/`), which
Static Assets answer before the Worker runs.

The Issue names `frame-ancestors-test.png`; the artefact ships as WebP
in the same directory, because the capture is a dense text table where
PNG costs several times the bytes for no visual gain.
`scripts/make-frame-ancestors-report.mjs` runs the workerd suite with
Vitest's JSON reporter, runs the static gate over `public/_headers` and
over four deliberately broken fixtures, renders both into one report,
and encodes it as WebP in memory (Playwright cannot emit WebP, so the
PNG bytes are captured into a Buffer and re-encoded with `sharp`, width
≤ 1600, quality 80). It refuses to write anything that is not WebP.

The four fixtures are the *rejected* direction the Issue asks to be
reproducible: a Tool artefact rule switched to `'none'`, one opened to
`*`, an `/admin*` rule in `_headers`, and a `public/` HTML document
left with no rule at all (the Tool-only rule set evaluated against the
real `public/` scan — what the review found before the `/share/*` rule
was added). Each is rejected by
`scripts/check-frame-ancestors-policy.mjs`, so the table shows what
"denied" means without reading the source. Nothing secret is in the
picture: the suite runs against the local workerd pool's dummy bindings
and the gate reads two static files and the `public/` tree.

## `csp-report.webp` (Issue #447)

The CSP Report-Only observation (Issue #447) as two measured layers:
the `Content-Security-Policy-Report-Only` value on real Worker
responses in the local workerd pool, and a Chromium probe against a
loopback document carrying that exact header. The browser table shows
the positive case (same-origin image, no event) and the negative case
(unlisted origin, one `img-src` event with `disposition: report`, not a
block).

The Issue names `csp-report.png`; the artefact ships as WebP in the same
directory, following the repository screenshot rule (width ≤ 1600,
quality 80). `scripts/make-csp-report-only-report.mjs` runs the
integration suite with Vitest's console output enabled, reads its
`CSP_REPORT_ONLY_MEASUREMENT` marker, starts a loopback-only HTTP server,
probes it with the Playwright Chromium already installed for the E2E
suite, and re-encodes the screenshot in memory with `sharp`. No
production request, credential, or D1/R2 mutation is involved. The
matching browser contract is `e2e/csp-report-only.spec.ts`.

Regenerate with:

```bash
pnpm run verify:csp-report-only-screenshot
```

## `log-redaction-test.webp`

The redaction verification report (Issue #467): every fabricated sample
rendered through the shipped `src/logging/redact.ts`, with before / after
columns and the generator's own canary self-check.

The Issue names `log-redaction-test.png`; the artefact ships as WebP in
the same directory, following the same repository rule as the artefacts
above (screenshot = WebP at quality 80, width ≤ 1600; the intermediate
PNG stays in `.tmp/` and is never committed). Accepting that substitution
— or amending the Issue requirement — is an open owner decision recorded
in the PR body. The report HTML is the capture source; it is generated
into `.tmp/` by `node scripts/log-redaction-report.mjs`, which exits
non-zero without writing a page when a canary survives or a sample is
unguarded.

## `ssrf-url-adapter.webp`

The outbound URL policy and fetch adapter (Issue #453) exercised over a
matrix of 38 destinations — 3 fetched, 35 refused.

1. **Rows are the shipped code's own verdicts.**
   `scripts/capture-ssrf-url-adapter-report.mjs` imports
   `fetchExternalUrl` (`src/http/outbound-fetch.ts`) and
   `classifyOutboundUrl` (`src/http/outbound.ts`) and records what they
   return for each input. The "結果 / code" column is the adapter's
   `result.code`, and "理由" is its `result.reason`.
2. **Every row declares the outcome it is evidence for.** Each case in
   the matrix carries an `expectCode`, and the run fails before writing
   anything when a measurement contradicts it. A label is prose; without
   that check the two drift apart silently and the image reads as proof
   of a rule nothing exercised. A second guard refuses the run when a
   row that is evidence about a policy rule instead measured a *transport*
   outcome (`fetch_failed`, `http_error`) — which means the matrix asked
   for something the policy allowed, not that the policy refused it.
3. **Nothing leaves the machine.** The transport is a local table keyed by
   URL. A refused URL is never requested, so it is never resolved or
   connected to; the script's own footer line reports how many transport
   calls happened. The only process that opens anything is the Playwright
   Chromium that renders the local HTML.
4. **The artefact is WebP, not PNG.** The Issue names a `.png` path; the
   committed file is the same report as `ssrf-url-adapter.webp`
   (1500 px wide, ~270 KiB) instead of a ~1.2 MiB full-page PNG. The
   generator writes `outFile` from its argument if a PNG is ever wanted.

Regenerate with:

```bash
pnpm run verify:frame-ancestors-screenshot
node scripts/capture-ssrf-url-adapter-report.mjs
```

The frame-ancestors policy table, the enforcement halves, and the
unscanned inventory are in
[`docs/security.md`](../../security.md#csp-frame-ancestors).

Add `--html .tmp/report.html` to dump the markup the image renders. The
run fails if a measurement contradicts its row's declared outcome, if a
refusal code is not one the report knows how to render, if a policy row
measured a transport outcome, if a row looks like it carries a
credential, or if the rendered page overflows horizontally (a clipped
column would make the image misleading).

The same rules are asserted against the Worker runtime in
`src/http/outbound.test.ts` and `src/http/outbound-fetch.test.ts`; this
report exists so the matrix can be *read*, not only trusted. The
interpretation of each row is in
[`docs/security/outbound-fetch.md`](../../security/outbound-fetch.md).

## `hsts-response.webp`

The HSTS delivery policy (Issue #446) as the runtime actually applies it:
the workerd test pool result plus the static gate verdict.

The Issue names `hsts-response.png`; the artefact ships as WebP in the
same directory. `scripts/make-hsts-verification-report.mjs` runs the
suite with Vitest's JSON reporter, renders a static HTML report, and
captures it in Chromium. Playwright cannot encode WebP, so the capture
stays in a Buffer and `sharp` writes WebP at quality 80; no intermediate
PNG reaches the disk, and the script refuses to write any non-`.webp`
target.

1. **The policy shown is the shipped policy.** The generator reads the
   directive from `src/server.ts` through the same function the static
   gate uses (`readCanonicalDirective`), so the report cannot advertise a
   value the runtime does not serve.
2. **PASS means an exact match.** Each row asserts the observed header
   equals the restated literal exactly, over HTTPS *and* over plaintext,
   across the SSR document, the external boundary and the auth redirect.
   A test whose title no longer exists renders as `MISSING` rather than
   disappearing, so a rename cannot quietly delete a row.
3. **Nothing secret is in the picture.** The bindings are the test-only
   dummies from `vitest.config.ts`, `/api/v1/health` touches no binding,
   and the generator makes no network call — no cookie value, no token,
   no production D1/R2.

Regenerate with:

```bash
pnpm run verify:hsts-screenshot
```

The interpretation of each row is in
[`docs/security.md`](../../security.md#https-強制と-hsts-issue-446).

## `redirect-validation.webp`

The open-redirect guard (Issue #454) exercised over a matrix of
`returnTo` / `callbackURL` values.

The Issue names `redirect-validation.png`; the artefact ships as WebP
in the same directory. The capture is a dense text table, so PNG cost
~390 KB for no visual gain while WebP at `quality: 80` is ~155 KB.
`scripts/redirect-validation-report.mjs` captures a temporary PNG into
`.tmp/`, converts it with `sharp` (width ≤ 1600, quality ladder
80 → 72 → 64 → 56 until the result is under 300 KB), deletes the
temporary file, and refuses to write anything that is not WebP.

1. **Rows are real responses.** `scripts/redirect-validation-report.mjs`
   sends a real `Request` per row through the shipped
   `redirectTargetGuard` middleware (`src/http/security/redirect-guard.ts`)
   mounted on `/api/v1/auth/*`, and records the status and body it gets
   back. The "guard verdict" column is `classifyRedirectTarget`'s own
   decision for the same value.
2. **The last column is the login screen.** It shows what
   `/admin/login?returnTo=` resolves to under the route's own policy
   (`allowedPrefixes: ['/admin']`, no trusted origins) — which is why an
   absolute URL is accepted by the boundary and refused by the page.
3. **Nothing secret is in the picture.** `evil.example` appears as a
   string; the script fetches nothing off-origin, sends no credential,
   and only renders local HTML in Chromium.

Regenerate with:

```bash
pnpm run security:redirect:report
```

Add `--html .tmp/report.html` to dump the markup the image renders. The
script exits non-zero if any response is neither `200` nor a
`400 invalid_redirect_target`, if the image would exceed 300 KB at
quality 80, or if the rendered page overflows horizontally (a clipped
column would make the image misleading).

The same matrix is asserted against the real Worker entry and the real
Better Auth handler by `src/http/security/redirect-guard.test.ts`; this
report exists so the matrix can be *read*, not only trusted. The
interpretation of each row is in
[`docs/security/open-redirect.md`](../../security/open-redirect.md).

## `headers-browser.webp`

The screenshot Issue #449 asks for: the
`nosniff` / `Referrer-Policy` / `Permissions-Policy` policy as it is
actually observed, not as it is described. It is stored as a
moderately compressed WebP (width ≤ 1600, quality 80) rather than a
PNG so the verification artefact stays small; the content is
unchanged.

### What is in the image

1. **Worker responses** — measured by
   `test/integration/security-headers.test.ts` running the real Worker in
   the local workerd pool (`SELF.fetch`), over the host page, a 404, the
   external boundary (success + `notFound`), the admin redirect, the admin
   login, and the three Tool shell routes.
2. **Static Assets responses** — measured against the local `pnpm
   preview` Worker (a `curl -D -` dump captured into
   `.tmp/security-headers/static-headers.json`), or, when that capture
   is not supplied, resolved from the shipped `public/_headers` rules by
   `scripts/check-security-headers.mjs` — the same parser the CI gate
   uses. The report labels which of the two it used.
3. **Browser enforcement** — Chromium with a fake capture device asking
   `getUserMedia()` for the microphone on: a host-baseline document, the
   Tool document that carries the `mic-level` grant, and the same grant
   document inside a Tool iframe under both sandbox shapes. This is what
   separates "the header says so" from "the browser agrees".

Nothing secret is involved: the probe server binds `127.0.0.1`, the
policy values are public constants in
`src/http/security-headers.json`, and the capture device is Chromium's
fake one.

### Regenerating

```bash
node scripts/security-header-report.mjs            # Worker + rules + browser
node scripts/security-header-report.mjs \
  --static-measurements=.tmp/security-headers/static-headers.json
```

The second form additionally reports the Static Assets rows as measured
from a running preview (see `docs/security/security-headers.md` §4 for
how to start one and capture the dump). The script re-runs the workerd
measurement, re-resolves the `_headers` rules, re-runs the browser
probes and overwrites the WebP. Commit the regenerated image in the same
change as any policy or manifest-grant edit.

The browser section separates the two gates Chromium actually applies:
the container document's own `Permissions-Policy` is the ceiling for its
frame, and a frame sandboxed without `allow-same-origin` has an opaque
origin that no header can give a capture device back. Both readings, and
the residual they leave, are in
[`docs/security/security-headers.md`](../../security/security-headers.md).
## `markdown-xss-fixture.webp`

Evidence for the Portfolio article input boundary (Issue #451), captured
from the **LOCAL** Worker so that the payloads can be shown as they are
written in the corpus, without an attacker-controlled origin anywhere
in the picture.

- **Issue:** #451 (Markdown / Notion-derived HTML XSS boundary).
- **What it shows:** the article route (`GET /portfolio/<slug>`)
  rendering a `portfolio_project` row whose `motivation_md` is the
  shared attack corpus from `test/fixtures/markdown-xss-fixtures.ts`.
- **How to read it:**
  - Rows labelled *(accepted / text | markdown-link)* are normal
    article copy: bold, italic, an internal link and an external link.
    They must still render as real elements — a sanitiser that deleted
    everything would also "pass" by rendering nothing.
  - Rows labelled *(blocked / raw-html)* show payloads such as
    `<script>`, `<img onerror>`, `<svg onload>` and `<iframe>` as
    **visible escaped text** (`&lt;script&gt;`), never as markup.
  - Rows labelled *(blocked / markdown-link)* show the visible refusal
    marker: the link text followed by `— blocked link (<reason>)`, with
    the refused target kept in `data-blocked-href`. The marker is a
    `<span>`, not an anchor: there is nothing to click. The reason is
    one of the five values in `BLOCKED_HREF_REASONS`
    (`src/portfolio/markdown.lexer.ts`) — this corpus produces
    `scheme-not-allowed` (which covers `data:` and `vbscript:` too),
    `encoded-scheme` (character reference, e.g. `javascript&#58;…`) and
    `control-character` (TAB inside the scheme).
- **What it does NOT contain:** no credentials, no `.dev.vars` values,
  no internal hostnames. Every destination in the corpus is
  `example.com` / `example.invalid` (reserved for documentation by
  RFC 2606 / RFC 6761), and each payload only assigns to
  `window.__xssFired`, which the capture asserted to be `undefined`.

### Regenerating

The capture generator is **not committed to this repository**, so this
artefact cannot be regenerated from the tree alone. To rebuild it:

1. Seed the local D1 with the fixture row from the shared corpus:
   `markdownXssFixtureRowValues()` in
   `test/fixtures/markdown-xss-fixtures.ts` (write it into the local
   `.tmp/d1state` binding with `scripts/_d1.mjs`; never into a remote
   binding).
2. Start the local Worker (`pnpm run dev`, or `pnpm preview` after
   `pnpm run build` when a built client is required).
3. Open `/portfolio/<fixture slug>` in the local chromium, assert
   `window.__xssFired === undefined`, and capture the full page to
   `.tmp/`.
4. Convert to WebP with the repo's `sharp` devDependency (width
   ≤ 1600, `quality: 80`, budget 300 KB) and write it back to
   `docs/verification/security/markdown-xss-fixture.webp`.

The automated equivalent of steps 1–3 runs on every push and does not
need the generator: `test/integration/markdown-xss-ssr.test.ts`
asserts the same properties over the served `<article>` region through
`SELF.fetch`, and `e2e/portfolio-markdown-xss.spec.ts` (part of
`pnpm run e2e`) asserts them in a real browser.

### Format note

The Issue asked for `markdown-xss-fixture.png`. The committed file is
`markdown-xss-fixture.webp` instead: same pixels, ~10x smaller, so the
repository does not carry a large binary. The PNG intermediate is
written to `.tmp/` and is not committed.

## `tool-artifact-inventory.webp` (Issue #466)

The Tool artefact license / dependency / outbound inventory gate's own
HTML report, rendered in a browser, for the synthetic host repository
`scripts/make-tool-artifact-fixture.mjs` builds: one Tool whose license
file contradicts the manifest, one with no license file at all, one whose
lockfile drifted since it was reviewed, and one whose collected artefact
references a host outside the reviewed set — next to the healthy entry
that passes. The picture has to come from a fixture because this
repository is (correctly) never in a drifted state.

Reading guide: [`docs/tools/runbook.md` §7](../../tools/runbook.md). The
script exits non-zero unless the gate really failed, and re-reads the
rendered page to confirm the fixture's credential-shaped URL did not
survive redaction, so the committed image cannot become the place where a
credential-shaped string is published.
