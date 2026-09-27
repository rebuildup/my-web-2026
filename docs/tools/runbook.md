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
part of `pnpm run validate:fast`.

## 3. Run the build orchestrator

```bash
pnpm exec node scripts/build-tools.mjs                # all same_origin_static tools
pnpm exec node scripts/build-tools.mjs --tool=prototype # single tool
pnpm exec node scripts/build-tools.mjs --dry-run       # plan only
```

The orchestrator:

1. Reads the manifest.
2. For each `same_origin_static` entry, verifies the gitlink SHA.
3. Runs `build.command` inside `external/<slug>/`.
4. Mirrors the build output to `dist/client/tools/<slug>/`.
5. Asserts the collected artefact contains `index.html`.

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

# 4. If delivery.kind === "same_origin_static", run the build
pnpm exec node scripts/build-tools.mjs --tool=<slug>

# 5. Commit
git add .gitmodules external/<slug> src/tools/manifest.json
git commit -m "tools(<slug>): bump to <short-sha>"
```

The PR description should link to the Tool-side PR that produced the
new SHA and quote the integration test result.

## 6. Open Issue #81

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

## 7. Troubleshooting

| symptom                                              | likely cause                                                         | fix                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `check-tools-manifest` reports "submodule missing"   | `git submodule update --init` not run                                | run `git submodule update --init --recursive`                                                        |
| `check-tools-manifest` reports "SHA mismatch"        | `external/<slug>/` is checked out at a different SHA than the manifest | `git -C external/<slug> checkout <pinned_sha>` and re-commit the gitlink                            |
| `build-tools` reports "package manager unavailable" | the Tool's chosen package manager is not on `$PATH` in CI             | install it (e.g. add `bun` to the build step) or change the Tool to use `pnpm`                      |
| `build-tools` reports "no index.html in artifact"    | the Tool's `build.output_dir` is not the directory containing `index.html` | fix the manifest's `build.output_dir` to point at the actual output root                            |
| `check-architecture` reports "parent must not import Tool source" | a parent source file imports `external/<slug>/src/...`     | remove the import; route through the collected artefact under `dist/client/tools/<slug>/`            |

## 8. Related artefacts

- `docs/tools/inventory.md` — durable inventory of all 14 known Tools,
  with classification reasoning.
- `src/tools/manifest.json` — the registry.
- `src/tools/manifest.schema.json` — JSON Schema (draft-07) for the
  registry.
- `scripts/check-tools-manifest.mjs` + `.test.mjs` — verifier.
- `scripts/build-tools.mjs` + `.test.mjs` — build orchestrator.
- `docs/adr/ADR-0006-tools-submodule-policy.md` — the ADR this
  runbook operationalises.
