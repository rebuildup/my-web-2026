# Actions pin / permission verification (Issue #472)

`actions-pin-check.webp` is the screenshot the Issue asks for: the
GitHub Actions supply-chain audit **as it is measured**, not as it is
described.

> **Format note.** Issue #472 names `actions-pin-check.png`. The
> committed artefact is the same image as **WebP** (≤1600 px wide,
> quality 80, <300 KB), produced by `scripts/workflow-pin-report.mjs`;
> the lossless PNG render is kept in memory and never committed, so a
> text-heavy verification image does not add ~1 MB per run to the
> repository. Everything a reviewer needs is visible in the WebP at
> 100% zoom, and the audit data itself is committed next to it as
> `audit.json`.

## What is in the image

The image is rendered from `scripts/check-workflow-pinning.mjs` — the
same function `pnpm run ci:pins:check` runs inside `validate:fast` —
so the picture cannot claim a pin the gate would reject.

1. **Shipped workflows — normal observation.** All 12 `uses:` lines of
   `.github/workflows/ci.yml` and `prod-smoke.yml` with their upstream
   ref and full 40-char commit SHA, plus the effective
   `GITHUB_TOKEN` permissions each job resolves to
   (`contents=read`, inherited from the workflow-level block).
   `findings: 0` / `status: PASS`.
2. **Committed abnormal fixture — the gate failing.** The same audit
   pointed at `quality/fixtures/actions-pinning/`, a workflow that was
   never pinned: floating tags, a digest-less container image, a
   missing ref comment, `write-all`, two write scopes, an untrusted
   trigger, a value-listing command, an unapproved secret reference, a
   production deploy and a Release publish. `findings: 12` /
   `status: FAIL`.
3. The bottom of the image carries the reproduce commands and the
   repair table location
   ([`docs/security/supply-chain-actions-pinning.md`](../../security/supply-chain-actions-pinning.md)).

`actions-pin-check-fixture-fail.webp` is the abnormal section alone,
for the PR body and quick linking.

## Nothing secret is involved

The audit is static and offline: it reads workflow YAML and
`quality/actions-pins.json`, and prints action names, SHAs,
permission scopes and rule ids. No environment is queried, no
credential is read, no network or production host is contacted. The
fixture's `run:` lines are `echo`s of the forbidden commands, never
the commands, and it lives outside `.github/workflows/` so GitHub
Actions never reads it. `audit.json` next to the images is the
status-only summary of the same run.

An image is not the proof: the gate's behaviour is asserted in
`scripts/check-workflow-pinning.test.mjs` (37 tests, including the
exact rule set the fixture produces), and the interpretation of each
rule is in
[`docs/security/supply-chain-actions-pinning.md`](../../security/supply-chain-actions-pinning.md).

## Regenerating

```bash
pnpm run ci:pins:report
```

The script re-runs both audits, re-renders the report and overwrites
the WebP files (Chromium PNG in memory → `sharp` resize to 1600 px →
WebP quality 80). It self-checks that the rendered page contains both
verdict lines, so a blank screenshot cannot be committed, and fails if
either image exceeds the 1600 px / 300 KB budget. Commit the
regenerated images in the same change as any workflow, pin-manifest or
gate-rule edit. It is a documentation tool and never runs inside
`validate:*`.