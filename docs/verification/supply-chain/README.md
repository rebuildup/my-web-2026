# Actions pin / permission verification (Issue #472)

`actions-pin-check.png` is the screenshot the Issue asks for: the
GitHub Actions supply-chain audit **as it is measured**, not as it is
described.

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

`actions-pin-check-fixture-fail.png` is the abnormal section alone,
for the PR body and quick linking.

## Nothing secret is involved

The audit is static and offline: it reads workflow YAML and
`quality/actions-pins.json`, and prints action names, SHAs,
permission scopes and rule ids. No environment is queried, no
credential is read, no network or production host is contacted. The
fixture's `run:` lines are `echo`s of the forbidden commands, never
the commands, and it lives outside `.github/workflows/` so GitHub
Actions never reads it. `audit.json` next to the PNGs is the
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
the PNGs. It also self-checks that the rendered page actually
contains both verdicts, so a blank screenshot cannot be committed.
Commit the regenerated images in the same change as any workflow,
pin-manifest or gate-rule edit. It is a documentation tool and never
runs inside `validate:*`.