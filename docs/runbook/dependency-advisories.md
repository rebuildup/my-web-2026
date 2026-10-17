# Dependency advisory runbook

> Lockfile advisory gate for `my-web-2026` (Issue #470). Canonical
> operator reference for the `pnpm audit`-based CI gate. Cross-linked
> from [`AGENTS.md §4`](../../AGENTS.md),
> [`quality/profile.yaml`](../../quality/profile.yaml) and
> [`docs/security.md`](../security.md).
>
> **Scope.** This runbook answers four operator questions:
>
> 1. *Which severities stop the build, and which are only recorded?*
> 2. *How does an approved exception work, and when does it expire?*
> 3. *What does each failure mean, and how is it repaired?*
> 4. *How do I reproduce a verdict without touching the registry?*

The mechanical contract lives in
`scripts/_dependency-advisories.mjs` (decision),
`scripts/check-dependency-advisories.mjs` (acquisition + exit code)
and `scripts/render-dependency-audit-report.mjs` (inspection report).
This file explains what those scripts print.

## 1. What the gate covers

| Source                                        | What it contributes                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm-lock.yaml`                               | the resolved `name@version` set that is checked, indirectly, through the advisory endpoint                 |
| `quality/dependency-advisory-gate.json`        | the reviewed policy: enforcement mode, blocking severities, reported severities, exception ledger, expiries |
| `pnpm audit --json`                            | the advisory document: advisory id, package, severity, vulnerable/patched ranges, dependency paths          |

Nothing else is an input. In particular the gate never reads
`node_modules`, a deployment configuration, `.dev.vars`, Infisical or a
Worker secret value (see [§7](#7-secret-posture)).

`pnpm audit` exits `1` whenever advisories exist. That exit code is
**not** this gate's failure signal — it is data. The gate decides from
the parsed document, and treats anything that is not an advisory
document as *unavailable data* rather than as "no advisories".

## 2. Commands

```bash
pnpm run dep-audit:check                 # the gate (registry)
pnpm run dep-audit:report                # the gate + .tmp/dependency-audit-report.html
pnpm run dep-audit:check -- --enforce    # same data, decided as `block`
pnpm run dep-audit:check -- --format json
pnpm run dep-audit:check -- --input <file|->     # fixture / captured document
pnpm run dep-audit:check -- --now 2026-10-18     # pin the expiry evaluation date
```

### Exit codes

| Code | Meaning                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------- |
| `0`  | pass, **or** blocking findings recorded while the declaration says `enforcement: audit`                 |
| `1`  | blocking advisories outstanding under `enforcement: block`                                             |
| `2`  | usage error or a broken/undeclared gate declaration                                                    |
| `3`  | **advisory data unavailable — fail closed**                                                             |

`3` is the contract that matters most. A registry outage, a rate limit,
an error document or an unparsable response produces `DATA UNAVAILABLE`
with every count rendered as `unknown`; there is no code path from
unreadable data to a pass, and the output never contains a zero-finding
claim. That is why the CI step is not `continue-on-error`.

## 3. The declaration

[`quality/dependency-advisory-gate.json`](../../quality/dependency-advisory-gate.json):

```json
{
  "enforcement": "audit",
  "blockingSeverities": ["critical", "high"],
  "reportedSeverities": ["moderate", "low", "info"],
  "dataUnavailable": "fail",
  "exceptions": []
}
```

- `blockingSeverities` / `reportedSeverities` — the severity policy. A
  severity has exactly one meaning; listing it in both is rejected. An
  empty `blockingSeverities` is rejected.
- `enforcement` — `block` stops the build on a blocking finding; `audit`
  records it and exits `0`. It never changes what counts as blocking.
- `dataUnavailable` — only `fail` is accepted. A policy that tolerates
  unreadable data would reintroduce the false green this gate exists to
  prevent.
- Unknown keys are rejected, so a typo cannot silently empty the
  blocking set.

### Exceptions

One exception is one reviewed record, and it expires:

```json
{
  "advisoryId": "GHSA-xxxx-xxxx-xxxx",
  "package": "some-package",
  "severity": "critical",
  "reason": "why the risk is accepted for now, in one sentence",
  "approvedBy": "who accepted it",
  "trackingIssue": 470,
  "expiresOn": "2027-01-31"
}
```

Behaviour:

| Case                                    | Verdict                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------ |
| record covers the advisory, unexpired   | `approved exceptions in force`; it stops blocking, and stays visible      |
| `expiresOn` is today                    | still covered (`daysRemaining: 0`)                                        |
| `expiresOn` is in the past              | **blocking again**; also listed under `expired exceptions`               |
| record matches no advisory in the data  | listed under `exception records with no matching advisory`, remove it    |
| `package`/`severity` contradict the advisory | the declaration is rejected (exit `2`)                             |
| duplicated `advisoryId`                 | the declaration is rejected (exit `2`)                                   |

## 4. Normal observation

A healthy run of the committed declaration, with no findings:

```console
$ pnpm run dep-audit:check -- --input scripts/fixtures/dependency-advisories/clean.json --enforce
dependency advisory gate: PASS
  source:              advisory document from scripts/fixtures/dependency-advisories/clean.json
  gate declaration:    quality/dependency-advisory-gate.json
  evaluated on:        2026-10-18
  blocking severities: critical, high
  enforcement:         block
  advisories reported: 0
  by severity:          (none)
  blocking after exceptions: 0
```

A healthy run with an approved exception keeps the acceptance record in
the output — the pass is never silent:

```console
$ node scripts/check-dependency-advisories.mjs \
    --input scripts/fixtures/dependency-advisories/blocking.json \
    --gate scripts/fixtures/dependency-advisories/gate-with-exception.json \
    --now 2026-10-18 --enforce
dependency advisory gate: FAIL          # the unexcepted high finding still blocks
  blocking after exceptions: 1
approved exceptions in force (1):
  - [critical] GHSA-fixt-fixt-fixt fixture-runtime — approved by … until 2027-01-31 (105 day(s) left)
      reason: …
      tracking: 470
```

![dependency advisory gate — blocking verdict, fixture data](../verification/supply-chain/dependency-audit-report.webp)

The committed screenshot is the *fixture* verdict (public-safe dummy
advisories, `example.invalid` URLs), so the artifact can be committed
without leaking anything about the real dependency tree. The real run
is reproducible with the same command and no `--input`.

The passing state, with the approved-exception record the gate keeps in
its output:

![dependency advisory gate — passing verdict with an approved exception](../verification/supply-chain/dependency-audit-report-excepted.webp)

Both images are WebP (quality 80, width 1180, 53–69 KiB) rendered from
the HTML report the gate writes, not hand-made; the PNG capture stays in
`.tmp/` and is not committed.

## 5. Abnormal observation and repair

| Observation                                                | Cause                                                     | Repair                                                                                                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dependency advisory gate: FAIL`, exit `1`                  | a `critical`/`high` advisory is in the lockfile            | upgrade or pin the package (`pnpm why <pkg>`), or open an exception record ([§3](#exceptions)) if the risk is knowingly accepted                                       |
| `expired exceptions treated as blocking`                    | a record outlived its `expiresOn`                         | remediate, or renew the record with a new date **and** a fresh approval — never extend it silently                                                                            |
| `exception records with no matching advisory`               | the advisory was fixed or renamed                         | delete the record; a stale exception is not a free pass                                                                                                                      |
| `dependency advisory gate: DATA UNAVAILABLE`, exit `3`      | registry unreachable, rate-limited, error document, or an unparsable response | re-run; if it persists the CI runner or the local network is blocking the advisory endpoint. **Never** add `--ignore-registry-errors`: that flag converts an outage into an empty advisory set |
| `gate declaration …` error, exit `2`                        | unreadable/invalid declaration or bad CLI usage           | fix the declaration against [§3](#the-declaration); `pnpm exec biome check quality/dependency-advisory-gate.json` covers formatting                              |
| severity reported as unknown                                | the registry added a severity this gate does not know      | add it to the declaration explicitly, in review; the gate refuses to guess a ranking for it                                                                                  |

Reproduction recipes that need no registry access (fixtures are
synthetic; ids and URLs are `example.invalid`):

```bash
node scripts/check-dependency-advisories.mjs \
  --input scripts/fixtures/dependency-advisories/blocking.json \
  --gate  scripts/fixtures/dependency-advisories/gate-with-exception.json \
  --now 2026-10-18 --enforce                              # exit 1
node scripts/check-dependency-advisories.mjs \
  --input scripts/fixtures/dependency-advisories/blocking.json \
  --gate  scripts/fixtures/dependency-advisories/gate-with-expired-exception.json \
  --now 2026-10-18 --enforce                              # exit 1, expired
node scripts/check-dependency-advisories.mjs \
  --input scripts/fixtures/dependency-advisories/registry-error.json \
  --now 2026-10-18                                        # exit 3, unknown
node scripts/check-dependency-advisories.mjs \
  --input scripts/fixtures/dependency-advisories/clean.json --enforce   # exit 0
```

## 6. Escalation: `audit` → `block`

The declaration ships with `"enforcement": "audit"` while the lockfile
still carries blocking advisories. `audit` records them on every run
and still fails closed on unreadable data; it does **not** make the tree
clean, and the CI log says so on every run.

To escalate, either

1. **Remediate.** Upgrade the direct dependencies that pull the
   vulnerable versions (`pnpm why <pkg>`), refresh the lockfile, and let
   the gate report the result; or
2. **Approve an exception** with a reason, an approver, a tracking issue
   and an `expiresOn` date that is close enough to force a review; or
3. **Narrow the policy** by editing `blockingSeverities` in review — a
   reviewable one-line diff, not a code change.

Once either path leaves zero blocking findings, flip
`"enforcement": "block"` in the declaration and the CI step starts
failing on any new `critical`/`high` advisory. Nothing else in the
workflow changes; `pnpm run dep-audit:check -- --enforce` previews the
exact verdict without editing the reviewed file.

## 7. Secret posture

AGENTS.md §4 forbids listing real secret values. This gate has no code
path that could do it:

- Inputs are the advisory document (package names, versions, advisory
  ids, public URLs) and the reviewed declaration. Both are committed
  files or registry metadata.
- The inherited environment is used only to locate `pnpm` on `PATH`; no
  value from it is printed, and the HTML report renders the same
  verdict fields as the text output.
- No Infisical command, no Wrangler secret subcommand, no `.dev.vars`
  read, no remote D1/R2 mutation, no deployment.

`scripts/check-dependency-advisories.test.mjs` asserts this
structurally: the gate runs with secret-shaped variables present in its
environment and none of them may appear in stdout, stderr or the report.

## 8. Evidence

| Evidence                                               | Where                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| CI run                                                 | `validate` job → `Dependency advisory audit` step of every CI run        |
| HTML inspection report                                 | artifact `dependency-advisory-report-<sha>` (90 day retention)           |
| Committed fixture verdict screenshot                    | [`docs/verification/supply-chain/dependency-audit-report.webp`](../verification/supply-chain/dependency-audit-report.webp) |
| Passing-with-exception screenshot                      | [`docs/verification/supply-chain/dependency-audit-report-excepted.webp`](../verification/supply-chain/dependency-audit-report-excepted.webp) |
| Unit / CLI / render tests                              | `pnpm test` (`scripts/_dependency-advisories.test.mjs`, `scripts/check-dependency-advisories.test.mjs`, `scripts/render-dependency-audit-report.test.mjs`) |

This gate is a dependency check only. It does not change the runtime
secret SoT (Infisical, ADR-0015), the production delivery path
(Cloudflare Workers Builds), or the release-merge human gate — see
[`docs/release.md`](../release.md).
