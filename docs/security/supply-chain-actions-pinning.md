# GitHub Actions — pinned SHAs, least-privilege tokens, and the update procedure

> What CI is allowed to run, with which token, and with access to
> which secret. Read this before editing `.github/workflows/*.yml`,
> `quality/actions-pins.json`, or the `ci:pins:check` command.
> Source-controlled by Issue #472.

## 1. Scope and authority

A workflow is code that runs with this repository's token on every
push and every pull request. Two facts make it a supply-chain surface
rather than ordinary configuration:

1. `uses: actions/checkout@v4` resolves **at run time**. Whoever can
   publish `v4` decides what code executes here — today and tomorrow,
   with no commit in this repository recording the change.
2. `GITHUB_TOKEN` is minted per job from the workflow's `permissions`.
   Its default in a repository whose default is permissive is
   `contents: write`: a compromised action could push to `main`.

So the audit fixed both, and made both checkable rather than
reviewable-by-eye:

| Question | Answer | Enforced by |
| --- | --- | --- |
| Which action code runs? | a reviewed 40-char commit SHA, listed in `quality/actions-pins.json` | `PIN_*` |
| What can the job token do? | `contents: read`, nothing else | `PERM_*` |
| Can CI reach a secret value? | no — Infisical is the SoT, Workers Builds is the deploy path | `SECRET_*` |
| Can CI deploy production or publish a Release? | no — both stay human / Cloudflare-owned | `AUTHZ_*` |

**The gate fails closed.** YAML has compact forms (`on: [push,
pull_request_target]`, `permissions: {contents: write}`,
`${{ secrets['NAME'] }}`) and forms a line scanner cannot resolve
(a YAML alias). A shape this gate cannot read is a finding
(`PERMISSIONS_UNPARSED`, `AUTHZ_TRIGGER_UNPARSED`), never an
inherited default: `status: PASS` means the gate *read* the workflow
and found nothing, not that it failed to look. What remains outside
the gate is listed in §9.

`pnpm run ci:pins:check` is part of `validate:fast`
(`quality/profile.yaml#gates.fast.components`), so every local
`validate:fast` and every CI `validate` run sees it. It is offline,
read-only, and prints only status data — action names, SHAs,
permission scopes, rule ids. It never reads a secret and never
contacts a network service.

`actionlint` remains the YAML syntax gate (`pnpm run lint:ci`);
`ci:pins:check` is the semantic supply-chain gate. They answer
different questions, so both run.

## 2. The audit: before and after

Both workflows were on floating tags before this Issue. 13 `uses:`
lines, 6 distinct actions, 0 permissions findings.

| Workflow | Job | Action | Before | After (SHA) | Upstream |
| --- | --- | --- | --- | --- | --- |
| `ci.yml` | `validate` | `actions/checkout` | `@v4` | `11d5960a3267…` | v4.4.0 |
| `ci.yml` | `validate` | `actions/setup-node` | `@v4` | `49933ea5288c…` | v4.4.0 |
| `ci.yml` | `validate` | `pnpm/action-setup` | `@v4` | `fc06bc1257f3…` | v4.4.0 |
| `ci.yml` | `validate` | `oven-sh/setup-bun` | `@v2` | `0c5077e51419…` | v2.2.0 |
| `ci.yml` | `validate` | `actions/cache` | `@v4` | `0057852bfaa8…` | v4.3.0 |
| `ci.yml` | `validate` | `actions/upload-artifact` ×2 | `@v4` | `ea165f8d65b6…` | v4.6.2 |
| `prod-smoke.yml` | `prod-smoke` | `actions/checkout` | `@v4` | `11d5960a3267…` | v4.4.0 |
| `prod-smoke.yml` | `prod-smoke` | `actions/setup-node` | `@v4` | `49933ea5288c…` | v4.4.0 |
| `prod-smoke.yml` | `prod-smoke` | `pnpm/action-setup` | `@v4` | `fc06bc1257f3…` | v4.4.0 |
| `prod-smoke.yml` | `prod-smoke` | `actions/cache` | `@v4` | `0057852bfaa8…` | v4.3.0 |
| `prod-smoke.yml` | `prod-smoke` | `actions/upload-artifact` | `@v4` | `ea165f8d65b6…` | v4.6.2 |

Each SHA is the **latest release inside the major the workflow
already used**, so the pin changes the mutability, not the behaviour.
Moving to a new major (`actions/checkout@v5`, `upload-artifact@v5`)
is a separate decision with its own review — see §5.

Effective `GITHUB_TOKEN` permissions, both jobs: `contents=read`.
The audit found no permission defect, so this Issue changed no
permission. The gate now keeps it that way.

### 2.1 One audit finding that shaped the update procedure

`pnpm/action-setup` v4.4.0 is an **annotated tag**:

```console
$ git ls-remote https://github.com/pnpm/action-setup refs/tags/v4.4.0 'refs/tags/v4.4.0^{}'
a15d269cd4658e1107c09f1fabf4cbd7bd1f308a	refs/tags/v4.4.0
fc06bc1257f339d1d5d8b3a19a8cae5388b55320	refs/tags/v4.4.0^{}
```

The first line is the tag *object*; the second is the commit it
points at. Pinning the object SHA would work today but reads as an
unrelated hash in review and breaks the moment the tag is replaced.
The procedure in §5 therefore always takes the peeled `^{}` ref.

## 3. Rules

| Rule | Fires when | Repair |
| --- | --- | --- |
| `PIN_NOT_SHA` | `uses:` points at a tag, branch, or short SHA (or a `docker://` image without a `sha256:` digest) | §5 |
| `PIN_MISSING_REF_COMMENT` | pinned SHA with no `# <ref>` comment | add the comment |
| `PIN_REF_COMMENT_MISMATCH` | comment and manifest `ref` disagree | fix the drift |
| `PIN_UNKNOWN_ACTION` | action is not in the manifest | add the manifest entry |
| `PIN_SHA_MISMATCH` | workflow SHA ≠ manifest SHA | re-run §5 for that action |
| `PIN_UNUSED_MANIFEST_ENTRY` | manifest pins an action no workflow uses | delete the entry, or add the workflow |
| `PERMISSIONS_MISSING` | workflow or job resolves no explicit `permissions:` | add the read-only block |
| `PERMISSIONS_UNPARSED` | a `permissions:` value is a shape the gate cannot resolve (a YAML alias, a folded scalar) | write the scopes out, or use `read-all` / `write-all` / `{}` |
| `PERMISSIONS_WRITE` | a `write` scope without a manifest allow-list entry | drop the scope, or justify it in the manifest |
| `PERMISSIONS_WRITE_ALL` | `write-all` anywhere | enumerate the scopes instead |
| `SECRET_REFERENCE` | `secrets.X` or `secrets['X']` where the manifest approves no `X` | drop it, or justify it in the manifest |
| `SECRET_VALUE_ACCESS` | a value-listing command reaches a real environment (the AGENTS.md §4 anti-pattern list) | use the dedicated status-only script, or move the work out of CI |
| `AUTHZ_UNTRUSTED_TRIGGER` | `pull_request_target` / `workflow_run` / `issue_comment`, in the block, scalar or flow-sequence form | use `pull_request`, or add an exception with a reason |
| `AUTHZ_TRIGGER_UNPARSED` | the `on:` value is a shape the gate cannot resolve (an alias), so which events run the workflow is unproved | write the event names out, or add an exception with a reason |
| `AUTHZ_PRODUCTION_DEPLOY` | `wrangler deploy` / `cf deploy` / `deploy:production` without `--dry-run` | keep the dry-run; production deploy is Cloudflare Workers Builds |
| `AUTHZ_RELEASE_PUBLISH` | `gh release create/upload/edit/delete` in a workflow | the release merge stays a human gate (AGENTS.md §6) |

An exception is data, not a code change: add it to
`quality/actions-pins.json#exceptions` with `rule`, `target`,
`reason` and `review_issue`. Waived findings are still printed in CI
output (`waived: …`) so an exception is visible where the check runs.

## 4. The pin manifest

`quality/actions-pins.json` is the SoT for "which upstream release did
we review":

```jsonc
"pnpm/action-setup": {
  "sha": "fc06bc1257f339d1d5d8b3a19a8cae5388b55320",
  "ref": "v4.4.0",
  "repository": "https://github.com/pnpm/action-setup",
  "reviewed_on": "2026-10-18",
  "review_issue": 472,
  "note": "v4.4.0 is an annotated tag: …"   // optional
}
```

The workflow comment, the manifest `sha` and the manifest `ref` must
all agree, so a pin cannot rot quietly: renaming the action, moving
the SHA, or forgetting the comment each fail the gate.

## 5. Update procedure

Reproducible, five steps, no secret involved.

```bash
# 1. Resolve the upstream tag to a COMMIT sha (peeled ref — see §2.1).
git ls-remote https://github.com/<owner>/<repo> \
  refs/tags/<tag> 'refs/tags/<tag>^{}'

# 2. Cross-check the commit sha against the GitHub API (an independent
#    source). NOTE: /git/ref returns the TAG OBJECT for an annotated tag
#    (`type: "tag"` — see §2.1), not the commit, so peel it:
gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq '.object.type, .object.sha'
#    if type == "tag":
gh api repos/<owner>/<repo>/git/tags/<object-sha> --jq '.object.type, .object.sha'
#    the peeled sha must be type "commit" and must equal step 1:
gh api repos/<owner>/<repo>/commits/<sha> --jq '.sha'

# 3. Update BOTH sides in the same commit: the manifest entry
#    (sha / ref / reviewed_on / review_issue) and every `uses:` line
#    in every workflow, including the `# <ref>` comment.
$EDITOR quality/actions-pins.json .github/workflows/*.yml

# 4. Prove it locally — offline, seconds, read-only.
pnpm run ci:pins:check

# 5. Full gate, then the usual PR review (release PR merge remains a
#    human gate).
pnpm run validate:integration
```

Review checklist for the PR:

- Does the upstream release note contain a breaking change? A **major**
  bump (e.g. `upload-artifact@v4` → `v5`) needs its own Issue: it can
  change artifact semantics, runner requirements or OIDC behaviour,
  and it is not a pin update.
- Is `ref` the tag the SHA was peeled from, spelled the way upstream
  spells it (with or without the `v`)?
- Did any step's behaviour change? If yes, say so in the PR body —
  a SHA pin is not a no-op when the release itself changed.

## 6. Normal observation (正常)

The gate is green when the report ends with:

```console
$ pnpm run ci:pins:check
…
findings: 0

status: PASS (workflows 2, jobs 2, pins 13, waivers 0)
```

Two things must be true at once: `findings: 0`, and every job row
under "effective GITHUB_TOKEN permissions" reads `contents=read`.
A `PASS` with a `waivers` count above zero is a pass *with* an
accepted exception and should be read as such.

The same output appears in the `validate` job log of any CI run, and
as a screenshot in
[`docs/verification/supply-chain/`](../verification/supply-chain/README.md)
(`actions-pin-check.webp`, ≤1600 px, <300 KB).

## 7. Abnormal observation (異常)

The gate must be seen failing, or it is decoration. The committed
fixture `quality/fixtures/actions-pinning/legacy-actions.yml` is a
workflow that never had its refs pinned; it lives outside
`.github/workflows/`, is never executed, and its `run:` lines are
`echo`s of the forbidden commands rather than the commands.

```bash
pnpm run ci:pins:check \
  --manifest=quality/fixtures/actions-pinning/manifest.json \
  --workflows-dir=quality/fixtures/actions-pinning
# exit 1, 12 findings across 9 rules
```

`scripts/check-workflow-pinning.test.mjs` asserts that exact rule
set, so the screenshot and this section cannot drift apart silently.
The rendered failure is
[`actions-pin-check-fixture-fail.webp`](../verification/supply-chain/actions-pin-check-fixture-fail.webp).

## 8. Repair procedure (修復手順)

| Observed | Cause | Repair |
| --- | --- | --- |
| `PIN_NOT_SHA` on a line someone just wrote | a tag was pasted from an upstream README | §5, steps 1–4 |
| `PIN_SHA_MISMATCH` | the manifest was updated and a workflow was missed (or the reverse) | grep the repo for the action name, update every `uses:` |
| `PIN_UNKNOWN_ACTION` | a new action was added without a manifest entry | add the entry with `sha` / `ref` / `repository` / review Issue |
| `PIN_MISSING_REF_COMMENT` | a SHA was pasted from an audit log | add `# <upstream tag>`; recover the tag with §5 step 1 |
| `PIN_UNUSED_MANIFEST_ENTRY` | an action was removed from a workflow | delete the manifest entry |
| `PERMISSIONS_*` | a step needs a token scope | prefer not granting it; if unavoidable, add a justified `permissions.allow_writes` entry naming the scope and why |
| `PERMISSIONS_UNPARSED` | the block was written in a shape the gate cannot read (e.g. `permissions: *token`) | write the scopes out in the block form the gate models, or add a justified exception |
| `SECRET_VALUE_ACCESS` | someone moved a secret script into CI | run it locally through the dedicated status-only script (AGENTS.md §4); a CI step that can read a value is a new credential path |
| `SECRET_REFERENCE` | a workflow started using a repository secret | remove it; runtime values belong to Infisical + Workers Builds |
| `AUTHZ_PRODUCTION_DEPLOY` | deploy added to CI | revert to `--dry-run`; production is delivered by Cloudflare Workers Builds |
| `AUTHZ_RELEASE_PUBLISH` | release automation added | remove; AGENTS.md §6 makes merge, tag and Release publish a human gate |
| `AUTHZ_TRIGGER_UNPARSED` | `on:` was written through an alias (`on: *events`) | name the events out, or add a justified exception |

Every repair is a normal ticket PR against the release branch. None of
them touches a secret value, so none of them needs the value-listing
authorisation.

## 9. Known constraints

- **The gate is a structural scan, not a YAML parse.** It reads
  `uses:`, `permissions:`, `on:` and `run:` shapes; actionlint owns
  syntax. Where a shape exists but the scanner cannot read it, the gate
  fails closed (`PERMISSIONS_UNPARSED`, `AUTHZ_TRIGGER_UNPARSED`) or
  reports the value as unproved (`PIN_NOT_SHA` for an unresolvable
  `uses:`). What no line-level scan can prove is narrower and is named
  here rather than assumed:
  - a secret reached through a *computed* expression, e.g.
    `secrets[format('{0}', name)]` — the literal name is not in the
    text, so the `secrets.allow_references` allow-list cannot be
    checked; catch it in review, and keep the allow-list empty by
    default so an unapproved name has nothing to hide behind;
  - the upstream *content* of a pinned SHA (see the next bullet).
  Both gates are required, and neither replaces reading the diff.
- **`AUTHZ_UNTRUSTED_TRIGGER` reads the event name, not its reach.**
  It reports `pull_request_target` / `workflow_run` / `issue_comment`
  wherever they appear under `on:`. Whether a given event reaches
  untrusted code depends on what the job then runs, which the
  `PIN_*` and `PERM_*` rules are there to constrain.
- **Upstream authenticity is not verified at runtime.** The pin proves
  *which* commit was reviewed, not that the commit is free of
  malicious post-install code. Verifying release signatures is a
  separate, heavier control and is not part of this Issue.
- **The pin is frozen to a review date.** Nothing here schedules an
  upstream update: `quality/actions-pins.json#reviewed_on` is a
  record, and §5 is the procedure. An automated Dependabot-style
  updater would have to rewrite SHAs in both files and is deliberately
  out of scope until it can do so without a human reading the diff.
- **`PERMISSIONS_WRITE` is all-or-nothing per scope.** The allow-list
  is keyed by scope, not by workflow, so an allow-listed scope stays
  allow-listed in every job that asks for it.