# Tools Integration Runbook (Issue #80)

This runbook covers day-to-day operator work for the Tool Registry
contract. Issue #80 ships the contract; Issue #81 ships the first
pilot (ProtoType). Anything that has to wait for #81 lives in §6.

## 1. Read the registry

The single source of truth for which Tools exist, where they live,
and how they are integrated is `src/tools/manifest.json`. Each entry
has three sections:

```jsonc
{
  "slug": "prototype",
  "source": { /* canonical_repo, submodule_path, pinned_sha, branch */ },
  "build":  { /* package_manager, command, output_dir */ },
  "delivery": { /* kind, artifact_path / external_url / disabled_reason */ },
  "classification": "same_origin_static",
  "license": "MIT"
}
```

Valid `delivery.kind` values:

| kind                  | meaning                                                    | public?              |
| --------------------- | ---------------------------------------------------------- | -------------------- |
| `same_origin_static`  | served from the parent's Static Assets under `/tools/<slug>/` | yes (after #81) |
| `external_exception`  | reachable only via an external URL                        | yes, via iframe      |
| `host_disabled`       | inventory-only; not currently served                      | no                   |

At the end of Issue #80 every entry is `host_disabled`. Issue #81
flips ProtoType to `same_origin_static`.

## 2. Verify the registry

```bash
pnpm exec node scripts/check-tools-manifest.mjs
```

The verifier asserts:

- Manifest parses as JSON.
- Every slug matches `^[a-z0-9][a-z0-9-]{0,127}$`.
- Every `source.pinned_sha` is a 40-char lowercase hex SHA.
- Every `source.submodule_path` matches `^external/<slug>$`.
- Slugs, submodule paths, and canonical repos are unique across
  entries.
- For `same_origin_static` entries, the actual gitlink SHA equals
  `source.pinned_sha` (mechanical SHA match).
- For `same_origin_static` entries, the iframe sandbox does **not**
  contain the dangerous `allow-scripts allow-same-origin` combination
  without an explicit override.
- `classification=needs_tool_side_fix` + `delivery.kind=same_origin_static`
  is a contradiction and is reported as a violation.

Run it before committing any change to `manifest.json`. CI runs it as
part of `pnpm run validate:fast`. It proves the manifest pin matches
the **recorded gitlink**; §6 covers the remaining provenance (the
fetched source, the checked-out commit, the collected artefact).

## 3. Run the build orchestrator

```bash
pnpm exec node scripts/build-tools.mjs                # all same_origin_static tools
pnpm exec node scripts/build-tools.mjs --tool=prototype # single tool
pnpm exec node scripts/build-tools.mjs --dry-run       # plan only
```

The orchestrator:

1. Reads the manifest.
2. For each `same_origin_static` entry, verifies the gitlink SHA.
3. Verifies the **checked-out** commit equals the pin and refuses to
   build otherwise (Issue #473) — a `git -C external/<slug> checkout`
   leaves the gitlink untouched, so step 2 alone cannot see it.
4. Runs `build.command` inside `external/<slug>/`.
5. Mirrors the build output to `dist/client/tools/<slug>/`.
6. Asserts the collected artefact contains `index.html`.
7. Records `dist/tool-provenance/<slug>.json` so the artefact can be
   traced back to the commit it was built from (§6).

At the end of #80 there are no `same_origin_static` entries, so the
orchestrator exits 0 with "nothing to build". That is the expected
steady state until #81 flips the pilot.

## 4. Add a new Tool

Issue #80 already inventoried all 14 known Tools. Adding a new Tool
is a normal PR with:

1. A new entry in `src/tools/manifest.json`. Start with
   `delivery.kind = host_disabled` and a clear `disabled_reason`.
2. A submodule at `external/<slug>/` if and only if the Tool has
   flipped to `same_origin_static` or `external_exception`. Until
   then, the entry is inventory-only — there is no submodule, no
   gitlink, and `pinned_sha` is documented as "not yet pinned".
3. A note in `docs/tools/inventory.md` describing the Tool.

Forbidden shortcuts (re-stated because they keep being re-attempted):

- **Do not** import Tool source from `parent/src/**`. The Tool is a
  standalone repo. The contract is the build artefact, not the
  source.
- **Do not** import a Tool's `package.json` or `external/<slug>/dist/`
  directly. The artefact lives under `dist/client/tools/<slug>/`
  after the orchestrator runs.
- **Do not** use `external_url` to ship a Tool via an external
  domain unless the runtime genuinely requires it
  (`getUserMedia` for `mic-level` is the only current case).
  `external_exception` is an exception, not a default.
- **Do not** ship an unverified Tool-side fix in the parent repo.
  Open a PR in the Tool's own repo, merge it there, then bump
  `source.pinned_sha` here.

## 5. Bump a submodule

```bash
# 1. Update the submodule to the new SHA in the Tool's repo
git -C external/<slug> fetch origin
git -C external/<slug> checkout <new-sha>

# 2. Update the manifest
$EDITOR src/tools/manifest.json
# change source.pinned_sha to <new-sha>
# update delivery.disabled_reason / delivery.kind if the Tool-side fix landed

# 3. Verify
pnpm exec node scripts/check-tools-manifest.mjs
pnpm run tools:provenance:check   # manifest pin / gitlink / checkout agreement (§6)

# 4. If delivery.kind === "same_origin_static", run the build
pnpm exec node scripts/build-tools.mjs --tool=<slug>

# 5. Commit
git add .gitmodules external/<slug> src/tools/manifest.json
git commit -m "tools(<slug>): bump to <short-sha>"
```

The PR description should link to the Tool-side PR that produced the
new SHA and quote the integration test result.

## 6. Supply-chain provenance (Issue #473)

`scripts/check-tools-manifest.mjs` (§2) proves the manifest pin
matches the **recorded gitlink**. That is a manifest/gitlink
agreement check; it says nothing about where the bytes came from.
`scripts/check-submodule-provenance.mjs` closes the rest:

```bash
pnpm run tools:provenance:check                    # the gate (validate:fast)
pnpm run tools:provenance:check -- --require-checkout
node scripts/check-submodule-provenance.mjs --report=markdown
node scripts/check-submodule-provenance.mjs --report=html --report-out=.tmp/provenance.html
```

What it proves, per fetched submodule:

| fact                     | compared against                        | finding on drift                 |
| ------------------------ | --------------------------------------- | -------------------------------- |
| `source.pinned_sha`      | the gitlink in the committed tree        | `GITLINK_SHA_MISMATCH`           |
| `source.pinned_sha`      | `git -C external/<slug> rev-parse HEAD`  | `CHECKOUT_SHA_MISMATCH`          |
| `source.canonical_repo`  | `.gitmodules` `url`                     | `URL_MISMATCH` / `URL_UNSAFE`    |
| `source.canonical_repo`  | the checkout's `remote.origin`          | `CHECKOUT_ORIGIN_MISMATCH`       |
| pinned commit (no ref)   | `.gitmodules` `branch` / `submodule.<name>.branch` | `BRANCH_TRACKED`      |
| fetch source             | `submodule.<name>.url`, `url.*.insteadOf` | `LOCAL_URL_OVERRIDE` / `URL_INSTEADOF_REWRITE` |
| `dist/tool-provenance/<slug>.json` | pin + live checkout    | `ARTIFACT_PIN_MISMATCH` / `ARTIFACT_SOURCE_MISMATCH` |

The gate is **offline and status-only**: it runs `git ls-tree`,
`git rev-parse`, `git config` and `git status` against the local
repository, performs **no network fetch**, reads **no environment
variable** and **no secret file**, and prints only a finding code, a
subject, a message and a remedy. That is why it is safe to paste its
output into a PR and why it can run in `validate:fast`.

An entry with no gitlink, no `.gitmodules` entry and no checkout is
**inventory-only** (`delivery.kind` is `host_disabled` /
`external_exception`, §4 step 2). Its recorded `pinned_sha` is
documentation, so the gate reports it as `INFO`, never as a verified
pin.

### 6.1 Normal observation

```console
$ pnpm run tools:provenance:check
[check-submodule-provenance] 0 error(s), 0 warning(s), 2 note(s):
  [info] ARTIFACT_PIN_MISSING external/prototype: prototype: no build provenance stamp at dist/tool-provenance/prototype.json (nothing built yet, or the output was cleaned)
      remedy: pnpm run build records the stamp; nothing to fix before a build has run
  [info] ARTIFACT_PIN_MISSING external/readmark: readmark: no build provenance stamp at dist/tool-provenance/readmark.json (nothing built yet, or the output was cleaned)
      remedy: pnpm run build records the stamp; nothing to fix before a build has run
[check-submodule-provenance] 2 submodule(s) inspected: 2 pass, 0 warn, 0 fail (13 inventory-only). Result: PASS
```

`ARTIFACT_PIN_MISSING` before the first `pnpm run build` is expected
and is `info`, not a warning: there is no artefact yet. After a build
the stamp exists and the finding disappears.

### 6.2 Abnormal observation and repair

```console
$ pnpm run tools:provenance:check
[check-submodule-provenance] 1 error(s), 0 warning(s), 1 note(s):
  [error] CHECKOUT_SHA_MISMATCH external/prototype: prototype: the checked-out source is 1f0c…c31 but the pin is 335e…5c7; the bytes a build would use are not the bytes the manifest describes
      remedy: git -C external/prototype checkout 335e…5c7 (or bump source.pinned_sha to the reviewed commit), then re-run the gate
[check-submodule-provenance] 1 submodule(s) inspected: 0 pass, 1 warn, 1 fail (13 inventory-only). Result: FAIL
```

| finding                      | cause                                              | repair                                                             |
| ---------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `CHECKOUT_SHA_MISMATCH`      | `git -C external/<slug> checkout <other>` — the gitlink and manifest still name the reviewed commit | `git -C external/<slug> checkout $(jq -r … pinned_sha)`, or bump the pin (§5) and commit both files together |
| `GITLINK_SHA_MISMATCH`       | the gitlink moved but the manifest did not (or vice versa) | commit the reviewed commit as the gitlink **and** record that same SHA in `src/tools/manifest.json` |
| `URL_MISMATCH`               | `.gitmodules` points at a fork / typo / re-host    | make `.gitmodules` and `source.canonical_repo` name the same reviewed repository |
| `URL_UNSAFE`                 | ssh / http / credentialed / ref-qualified / non-github url | use `https://github.com/<owner>/<repo>.git`, no credentials, no `#ref`, no query |
| `BRANCH_TRACKED`             | `.gitmodules` `branch = …` or `submodule.<name>.branch`, so `git submodule update --remote` would resolve to a mutable tip (ADR-0006 §4) | delete the key (`git config --unset submodule.<name>.branch`) |
| `LOCAL_URL_OVERRIDE`         | a local `submodule.<name>.url` redirect            | `git config --unset submodule.<name>.url`, then `git submodule sync` |
| `URL_INSTEADOF_REWRITE`      | a git `url.<x>.insteadOf` rewrite can redirect the fetch | remove the rewrite for this repository and re-run the gate        |
| `CHECKOUT_ORIGIN_MISMATCH`   | the checkout's `remote.origin` is not the declared repository | `git -C external/<slug> remote set-url origin <canonical_repo>`  |
| `CHECKOUT_MISSING` (warn)    | `git submodule update --init` was not run           | `git submodule update --init --recursive`; `--require-checkout` turns the warning into an error |
| `CHECKOUT_DIRTY` (warn)      | tracked files were edited in place (ADR-0006 §2 forbids this) | discard the edit, fix the Tool in its own repo, re-checkout the pin |
| `ARTIFACT_PIN_MISMATCH`      | `dist/` still holds an artefact built from the previous pin | `pnpm run build` (the stamp is rewritten from the current pin)     |
| `SUBMODULE_UNDECLARED`       | `.gitmodules` fetches a submodule the registry does not own | add the manifest entry (§4) or drop the submodule                |

The `dist/tool-provenance/<slug>.json` stamp is written **outside**
`dist/client/`: everything under `dist/client` is uploaded as a public
Static Asset, and this record is operator-facing evidence, not part of
the Tool's bundle. It carries no timestamp, so two builds of the same
commit produce identical bytes.

A compact visual of both observations is committed at
[`docs/verification/supply-chain/submodule-provenance.webp`](../verification/supply-chain/submodule-provenance.webp)
(rendered from a synthetic fixture repository, so it is publishable).
The image is a rendering of the same status-only report the gate prints;
the repair procedure above is the authoritative part.

## 7. Open Issue #81

Issue #81 brings the first Tool — ProtoType — through the contract
into production. The work #81 owns that #80 cannot:

- Add the `external/prototype` submodule at `pinned_sha`.
- Flip the manifest entry from `host_disabled` to `same_origin_static`.
- Add the `/tools/prototype` route in `src/routes/tools/prototype.tsx`
  (or wherever the host's iframe mount lives — the brief leaves that
  to #81).
- Configure the iframe sandbox (default `allow-scripts` is fine for
  the pilot; revisit only if a Tool genuinely needs more).
- Add the Playwright E2E coverage required by the host's smoke test
  contract.
- Document the iframe height / viewport / refresh behaviour in the
  route file.
- Reclassify the remaining 13 Tools based on the pilot learnings —
  especially the "12 Next.js component libraries" finding from the
  inventory, which determines whether future Tools land as
  `host_disabled` or trigger a follow-up Tool-repo PR.

#81 must NOT change the contract established by #80 — if a contract
change is required, that is a separate ADR-0006 revision ticket.

## 8. Troubleshooting

| symptom                                              | likely cause                                                         | fix                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `check-tools-manifest` reports "submodule missing"   | `git submodule update --init` not run                                | run `git submodule update --init --recursive`                                                        |
| `check-tools-manifest` reports "SHA mismatch"        | `external/<slug>/` is checked out at a different SHA than the manifest | `git -C external/<slug> checkout <pinned_sha>` and re-commit the gitlink                            |
| `build-tools` reports "package manager unavailable" | the Tool's chosen package manager is not on `$PATH` in CI             | install it (e.g. add `bun` to the build step) or change the Tool to use `pnpm`                      |
| `build-tools` reports "no index.html in artifact"    | the Tool's `build.output_dir` is not the directory containing `index.html` | fix the manifest's `build.output_dir` to point at the actual output root                            |
| `check-architecture` reports "parent must not import Tool source" | a parent source file imports `external/<slug>/src/...`     | remove the import; route through the collected artefact under `dist/client/tools/<slug>/`            |
| `check-submodule-provenance` reports `CHECKOUT_SHA_MISMATCH`   | `external/<slug>/` is checked out at a commit other than the pin   | `git -C external/<slug> checkout <pinned_sha>`, or bump the pin and commit both files together (§6.2) |

## 9. Related artefacts

- `docs/tools/inventory.md` — durable inventory of all 14 known Tools,
  with classification reasoning.
- `src/tools/manifest.json` — the registry.
- `src/tools/manifest.schema.json` — JSON Schema (draft-07) for the
  registry.
- `scripts/check-tools-manifest.mjs` + `.test.mjs` — verifier.
- `scripts/check-submodule-provenance.mjs` + `.test.mjs` —
  supply-chain provenance gate (§6).
- `docs/verification/supply-chain/submodule-provenance.webp` —
  rendered provenance report (normal + drift), §6.2.
- `scripts/build-tools.mjs` + `.test.mjs` — build orchestrator.
- `docs/adr/ADR-0006-tools-submodule-policy.md` — the ADR this
  runbook operationalises.
