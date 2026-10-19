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

1. **Shipped workflows — normal observation.** All 29 `uses:` lines of
   `.github/workflows/ci.yml`, `compat.yml`, `viewport.yml` and
   `prod-smoke.yml` with their upstream ref and full 40-char commit SHA,
   plus the effective
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
`scripts/check-workflow-pinning.test.mjs` (51 tests, including the
exact rule set the fixture produces), and the interpretation of each
rule is in
[`docs/security/supply-chain-actions-pinning.md`](../../security/supply-chain-actions-pinning.md).

## Regenerating

```bash
pnpm run ci:pins:report
```

The script re-runs both audits, re-renders the report and overwrites
the WebP files (Chromium PNG in memory → `sharp` resize to 1240 px →
WebP quality 80). It self-checks that the rendered page contains both
verdict lines, so a blank screenshot cannot be committed, and fails if
either image exceeds the 1240 px / 300 KB budget. Commit the
regenerated images in the same change as any workflow, pin-manifest or
gate-rule edit. It is a documentation tool and never runs inside
`validate:*`.

# Artifact attestation verification (Issue #476)

`artifact-sha-attestation.webp` は GitHub Actions が production mode で
build した Build Output に対する attestation gate を**実際に動作させた
状態**で撮影したものである（Cloudflare Workers Builds が deploy する
artifact は対象外）。fixture の Build Output
に対する正常系（artifact digest / source commit / lockfile / version が
一致し、署名は `unsigned`）と、6 つの異常系（artifact 改ざん、source
commit 不一致、release tag の commit 不一致、release tag の version
不一致、lockfile drift、存在しない署名の表示）を同じ画像に収める。

> **Format note.** Issue #476 は `artifact-sha-attestation.png` を指定する。
> commit するのは同じ画像の **WebP**（幅 ≤1440 px、quality 80、<300 KB）で、
> PNG はメモリ上にしか作らず commit しない。

`artifact-attestation-summary.json` は同じ実行の status-only 要約である。
画像は証明ではない。判定は `scripts/check-artifact-attestation.test.mjs` が
assertion し、schema・正常/異常の観測・修復手順は
[`docs/security/supply-chain-artifact-attestation.md`](../../security/supply-chain-artifact-attestation.md)
に記録している。

fixture は `.tmp/` に生成され、production credential・Cloudflare API・
secret 値のいずれも読まない。release tag の 2 観測は、`--release-tag`
が tag の commit と tag 名の version の両方を manifest と照合して
初めて FAIL になることの証跡である。再生成:

```bash
pnpm run artifact:attestation:report
```
