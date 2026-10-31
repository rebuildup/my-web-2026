# Tools Integration Runbook (Issue #80)

This runbook covers day-to-day operator work for the Tool Registry
contract. Issue #80 ships the contract; Issue #81 ships the first
pilot (ProtoType). Anything that has to wait for #81 lives in §8.

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

Issue #465 replaced the last-but-two bullet and added the embed
policy pass: for every embeddable entry the verifier now runs
`evaluateToolEmbedPolicy()` from
[`src/tools/embed-policy.ts`](../../src/tools/embed-policy.ts) — the
same function the `/tools/<slug>` route runs per request. That covers
the sandbox token classes, `referrer_policy`, the frame origin, and
the optional `host_message` origin contract. The rules are defined
once; this gate and the route cannot drift apart.

Run it before committing any change to `manifest.json`. CI runs it as
part of `pnpm run validate:fast`. It proves the manifest pin matches
the **recorded gitlink**; §6 covers the remaining provenance (the
fetched source, the checked-out commit, the collected artefact).

To produce the human-readable audit used by the Issue #465 PR
screenshot:

```bash
pnpm run tools:embed-policy:report -- --out=.tmp/tool-iframe-sandbox.html
```

It renders every manifest entry with its sandbox / referrer /
message verdict, plus the hostile-message fixture matrix (what the
host guard does with each injected event). The report is generated
into `.tmp/` and is never committed.

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
4. Refuses to build when the checkout has uncommitted changes **or
   untracked files** (Issue #473) — HEAD still equals the pin in that
   case, so step 3 passes while the bytes on disk are not the pinned
   commit's bytes. `git status --porcelain` is read in its default mode,
   which still honours the Tool repository's own `.gitignore`, so the
   `node_modules/` and `dist/` this orchestrator itself fills do not
   trip the refusal.
5. Runs `build.command` inside `external/<slug>/`.
6. Mirrors the build output to `dist/client/tools/<slug>/`.
7. Asserts the collected artefact contains `index.html`.
8. Records `dist/tool-provenance/<slug>.json` so the artefact can be
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
- **Do not** add a sandbox token without checking
  [`docs/tools/embed-policy.md`](embed-policy.md). `allow-same-origin`
  and the navigation / escape / storage tokens are rejected by
  `pnpm run tools:check`, and a capability token without `iframe.allow`
  + `iframe.sandbox_rationale` is rejected too. If the check refuses
  your entry, the rule is doing its job — do not work around it in the
  manifest.
- **Do not** declare `delivery.host_message` for a Tool that does not
  need it. With no declaration the host attaches no message listener at
  all, which is the safest default; declaring one opens an
  origin-exact, type-allowlisted channel that has to be reviewed.

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
| `source.canonical_repo`  | **every** configured `remote.origin.url` | `CHECKOUT_ORIGIN_MISMATCH`     |
| pinned commit (no ref)   | `.gitmodules` `branch` / `submodule.<name>.branch` (whole effective config, scope reported) | `BRANCH_TRACKED` |
| fetch source             | `submodule.<name>.url`, `url.*.insteadOf` (whole effective config, scope reported) | `LOCAL_URL_OVERRIDE` / `URL_INSTEADOF_REWRITE` |
| path ownership           | one `.gitmodules` submodule name per path | `GITMODULES_DUPLICATE_PATH` |
| `dist/tool-provenance/<slug>.json` | pin + live checkout    | `ARTIFACT_PIN_MISMATCH` / `ARTIFACT_SOURCE_MISMATCH` / `ARTIFACT_STAMP_INVALID` |

The gate is **offline and status-only**: it runs `git ls-tree`,
`git rev-parse`, `git config` and `git status` against the local
repository, performs **no network fetch**, reads **no environment
variable** and **no secret file**, and prints only a finding code, a
subject, a message and a remedy. That is why it is safe to paste its
output into a PR and why it can run in `validate:fast`.

Some of the facts it reads come from the *ambient* git config rather
than from the repository — `url.*.insteadOf`, a `submodule.<name>.url`,
a checkout's `remote.origin` — and those can carry an access token.
Any URL in a finding or in a report row is therefore printed with its
userinfo / query / fragment replaced by `***`; the checks still run on
the full string. A credential pasted into a *path* segment (the
`https://github.com/owner/ghp_…@repo.git` shape) is never echoed: URL
syntax errors and malformed path segments are reported with fixed text,
not with the offending value.

The same rule covers the *hostname*, which the redaction rules above
cannot reach (they all key on an `@`). A url that does **not** satisfy
the URL policy — a non-github host, a credentialed userinfo, an ssh
transport, a ref or query — is therefore reported with fixed text in
both findings and report rows: the row prints `(not echoed: not a
credential-free https://github.com repository url)` and the finding
names the class (`url host must be github.com …`, `url embeds
credentials …`) instead of the value. That is what closes the
`https://ghp_TOKEN.example.com/org/repo.git` shape, where the token sits
inside the host. The same applies to `dist/tool-provenance/<slug>.json`:
an unusable stamp is reported by field name and expected format only
(`records pinned_sha as a string (44 character(s)), not a 40-char commit
SHA`), never by value, because a hand-edited stamp is exactly where a
pasted token ends up.

One residual stays, on purpose visible: the base of a `url.*.insteadOf`
rewrite is a *prefix*, not a url, so the policy classifier does not
apply to it. It is printed with the `***` rules above together with its
scope and key name. A rewrite base that hides a credential in its own
hostname is therefore not masked — which is tolerable because any
rewrite at all is already an error (`URL_INSTEADOF_REWRITE`) whose
remedy names the key to `git config --unset`.

Every URL it reads is checked against the URL policy on its **raw**
value, and identity is compared on the normalised value. The two
checks are not redundant: `https://user:TOKEN@github.com/<owner>/<repo>.git`
normalises to the declared `owner/repo`, so an identity-only
comparison accepts it while it is still a fetch URL with a credential
in it. For the same reason the gate reads **all** values of
`remote.origin.url`, not just the one `git config --get` returns: a
fetch uses the first value, and a checkout that lists a foreign URL
first and the canonical URL last would otherwise pass.

`url.*.insteadOf` is read from the whole **effective** config
(`git config --list --show-scope --includes`), i.e. system, global,
local, per-worktree (`config.worktree`, used by any checkout that
enables `extensions.worktreeConfig`) and command scope, with
`include` / `includeIf` expanded. Enumerating `--local` / `--global` /
`--system` alone would miss a rewrite parked in an included file or in
a per-worktree config, either of which can change what an HTTPS fetch
actually resolves to. `git config --get-all remote.origin.url` and
`git status --porcelain` (default `normal` mode, so a Tool's own
`.gitignore` still applies) are read the same way — no `--no-includes`,
no "last value only".

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

This repository is (correctly) never in a drifted state, so the
abnormal observation has to be produced somewhere. `scripts/make-provenance-fixture.mjs`
builds a **synthetic** host repository with git plumbing only — one
healthy Tool, one checkout that moved past its pin, one Tool whose
`.gitmodules` tracks a branch, one inventory-only entry — and runs the
real gate over it with `--root=`. No network, no real Tool repository,
no credential; `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` are neutralised
and the commit dates are fixed, so every SHA below is reproducible
byte for byte. The block is a verbatim capture of that command's
output, not an illustration:

```console
$ node scripts/make-provenance-fixture.mjs .tmp/supply-chain-fixture
[check-submodule-provenance] 2 error(s), 0 warning(s), 2 note(s):
  [error] CHECKOUT_SHA_MISMATCH external/other-gadget: other-gadget: the checked-out source is d9312a0381c3cc86daa3d7ff3ccaa40726173006 but the pin is 8e67461601b77746bf753a6aaacf42c3cd399c30; the bytes a build would use are not the bytes the manifest describes
      remedy: git -C external/other-gadget checkout 8e67461601b77746bf753a6aaacf42c3cd399c30 (or bump source.pinned_sha to the reviewed commit), then re-run the gate
  [info] ARTIFACT_PIN_MISSING external/other-gadget: other-gadget: no build provenance stamp at dist/tool-provenance/other-gadget.json (nothing built yet, or the output was cleaned)
      remedy: pnpm run build records the stamp; nothing to fix before a build has run
  [error] BRANCH_TRACKED external/third-tool: third-tool: .gitmodules pins "external/third-tool" to the mutable ref "main"; submodule update --remote would replace the pinned commit with a branch tip
      remedy: delete the `branch` key from .gitmodules; record the upstream branch in source.branch for documentation only
  [info] ARTIFACT_PIN_MISSING external/third-tool: third-tool: no build provenance stamp at dist/tool-provenance/third-tool.json (nothing built yet, or the output was cleaned)
      remedy: pnpm run build records the stamp; nothing to fix before a build has run
[check-submodule-provenance] 3 submodule(s) inspected: 1 pass, 0 warn, 2 fail (1 inventory-only). Result: FAIL
```

The command exits 1 — the fixture is drifted on purpose, and the
wrapper propagates the gate's status in both modes (with a report
argument too), so a `Result: FAIL` is never observed as a successful
run. `external/other-gadget` is the headline case
(§6 table row 2: the checkout moved past the pin), `external/third-tool`
is the branch-tip case, and the two `ARTIFACT_PIN_MISSING` notes mean
those two Tools have no build stamp yet — `info`, not a failure. The
same fixture rendered as HTML is the committed screenshot (below);
add a second argument to reproduce it:

```console
$ node scripts/make-provenance-fixture.mjs .tmp/supply-chain-fixture .tmp/supply-chain-fixture/provenance.html
```

Every finding the gate can raise, and what to do about it:

| finding                      | cause                                              | repair                                                             |
| ---------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `CHECKOUT_SHA_MISMATCH`      | `git -C external/<slug> checkout <other>` — the gitlink and manifest still name the reviewed commit | `git -C external/<slug> checkout $(jq -r … pinned_sha)`, or bump the pin (§5) and commit both files together |
| `GITLINK_SHA_MISMATCH`       | the gitlink moved but the manifest did not (or vice versa) | commit the reviewed commit as the gitlink **and** record that same SHA in `src/tools/manifest.json` |
| `GITLINK_MISSING`            | the path is declared as a submodule but the committed tree has no gitlink for it | `git submodule add` the path, then commit the gitlink together with the manifest entry |
| `PINNED_SHA_INVALID`         | `source.pinned_sha` is not a 40-char lowercase hex commit SHA | record the exact SHA the Tool repo reported for the reviewed change |
| `URL_MISMATCH`               | `.gitmodules` points at a fork / typo / re-host    | make `.gitmodules` and `source.canonical_repo` name the same reviewed repository |
| `URL_UNSAFE`                 | a fetch url that is ssh / http / credentialed / ref-qualified / non-github — including a `remote.origin.url` or `submodule.<name>.url` that points at the declared repository but embeds a credential | use `https://github.com/<owner>/<repo>.git`, no credentials, no `#ref`, no query; for a checkout origin, `git -C external/<slug> config --unset-all remote.origin.url` then re-add it |
| `BRANCH_TRACKED`             | `.gitmodules` `branch = …` or `submodule.<name>.branch`, so `git submodule update --remote` would resolve to a mutable tip (ADR-0006 §4) | delete the key (`git config --unset submodule.<name>.branch`) |
| `LOCAL_URL_OVERRIDE`         | a local `submodule.<name>.url` redirect            | `git config --unset submodule.<name>.url`, then `git submodule sync` |
| `URL_UNSAFE` (local url)     | `submodule.<name>.url` carries a credential, ssh transport, ref or query — the raw value is checked, not only its normalised owner/repo | `git config --unset submodule.<name>.url`, then `git submodule sync` |
| `URL_INSTEADOF_REWRITE`      | a git `url.<x>.insteadOf` rewrite can redirect the fetch | remove the rewrite for this repository and re-run the gate (see the scope note below) |
| `CHECKOUT_ORIGIN_MISMATCH`   | a configured `remote.origin.url` is not the declared repository. **Every** value is checked, because a fetch uses the first one and `git config --get` reports only the last | `git -C external/<slug> remote set-url origin <canonical_repo>`; drop the extra values first with `git -C external/<slug> config --unset-all remote.origin.url` |
| `CHECKOUT_MISSING` (warn)    | `git submodule update --init` was not run           | `git submodule update --init --recursive`; `--require-checkout` turns the warning into an error |
| `CHECKOUT_SHA_UNREADABLE`    | the checkout is initialised but HEAD is not a readable 40-char commit SHA (e.g. a fresh repository with no commit) | `git -C external/<slug> status`, then re-run `git submodule update --init` |
| `CHECKOUT_STATUS_UNREADABLE` | the checkout is initialised but `git status --porcelain` exited non-zero (corrupt index, permissions, broken worktree), so the gate cannot tell whether it is clean — HEAD is still readable, so a SHA check alone would pass | `git -C external/<slug> status` to see the underlying error; repair the checkout (e.g. `rm .git/index && git reset`) or re-run `git submodule update --init --recursive`. `scripts/build-tools.mjs` also refuses to build in this state (§3 step 4) |
| `CHECKOUT_DIRTY` (warn)      | tracked files were edited in place **or** an untracked file was dropped into the checkout (a `public/` asset, an auto-detected config file); HEAD still equals the pin, so the bytes are not the pinned commit's bytes (ADR-0006 §4: the pin is a *verified commit*) | `git -C external/<slug> status --porcelain` lists it; discard the edit or delete the file, fix the Tool in its own repo, re-checkout the pin. `scripts/build-tools.mjs` refuses to build in this state too (§3 step 4), so it cannot reach production. Ignored paths (the Tool's `.gitignore`, e.g. `node_modules/`, `dist/`) do not count |
| `ARTIFACT_PIN_MISMATCH`      | `dist/` still holds an artefact built from the previous pin | `pnpm run build` (the stamp is rewritten from the current pin)     |
| `ARTIFACT_SOURCE_MISMATCH`   | the stamp names a different checkout commit or a different source repository than the manifest declares | `pnpm run build` (the stamp is rewritten from the current checkout) |
| `ARTIFACT_STAMP_INVALID`     | a stamp exists but records no usable provenance: truncated JSON (an interrupted write), `{}`, an older `schema`, or a blank commit SHA | `pnpm run build` rewrites the stamp; delete `dist/tool-provenance/<slug>.json` if the Tool is no longer served |
| `ARTIFACT_PIN_MISSING` (info) | nothing has been built yet, or `dist/` was cleaned | nothing — before the first build this is the expected state (§6.1) |
| `DECLARED_DELIVERY_UNFETCHABLE` | a manifest entry declares a `submodule_path` (or is served) but `.gitmodules` has no entry to fetch from | add the `[submodule]` entry, or keep the entry inventory-only until it is integrated |
| `SUBMODULE_UNDECLARED`       | `.gitmodules` fetches a submodule the registry does not own | add the manifest entry (§4) or drop the submodule                |
| `GITMODULES_DUPLICATE_PATH`  | two different `[submodule "<name>"]` sections claim the same `path`; git cannot fetch both and the applicable `submodule.<name>.*` config is ambiguous | keep a single section for that path |
| `INVENTORY_ONLY` (info, row marker) | an entry with no gitlink, no `.gitmodules` entry and no checkout — its recorded SHA is documentation, not a verified pin | nothing; flip `delivery.kind` when the Tool is actually integrated |
| `GIT_UNAVAILABLE` (warn)     | the gate was run outside a git checkout, so no pin could be compared with a committed tree | run it from a git checkout of the repository |

The same effective-config read (`git config --list --show-scope
--includes`) supplies `submodule.<name>.url` and `.branch`, so a
per-worktree value (`config.worktree`, behind
`extensions.worktreeConfig`) is inspected with the scope it came from
and the last value for a key wins exactly as it does for
`git config --get`. Reading only `--local` would inspect the value
that the worktree level is overriding.

`URL_INSTEADOF_REWRITE` reads the whole **effective** git config —
`git config --list --show-scope --includes`, so system, global, local,
per-worktree (`config.worktree`, behind `extensions.worktreeConfig`)
and command scope, with `include` / `includeIf` expanded — and reports
**any** rewrite it finds, whether or not its prefix can affect a URL
this repository fetches. (A per-scope `git config --get-regexp` does
*not* expand includes and never reads `config.worktree`, so a rewrite
parked there would change where a fetch resolves while the gate
stayed silent.) That is deliberate fail-closed
behaviour, but it does mean a benign corporate mirror rewrite (say
`url."git@github.com:".insteadOf = https://github.com/`) makes
`validate:fast` fail on a host that never touches a Tool submodule.
Whether to narrow the rule to rewrites whose prefix matches a
`.gitmodules` url or a manifest `canonical_repo`, or to allow an
explicit list, is an open owner decision; until then, treat the finding
as "this host has a fetch rewrite, confirm it is irrelevant or scope
it out with `git config --global --unset` in CI".

The `dist/tool-provenance/<slug>.json` stamp is written **outside**
`dist/client/`: everything under `dist/client` is uploaded as a public
Static Asset, and this record is operator-facing evidence, not part of
the Tool's bundle. It carries no timestamp, so two builds of the same
commit produce identical bytes.

What the stamp proves is that the artefact was collected from a
checkout at the recorded commit. It is **not** a hash of the artefact
bytes: nothing binds `dist/tool-provenance/<slug>.json` to the content
of `dist/client/tools/<slug>/app/`. A bare `vite build` empties
`dist/client` (Vite clears its `outDir`) and leaves the stamp in place,
so the gate can report PASS while the served artefact is gone — run
`pnpm run build`, which re-mirrors and re-stamps. A stamp left behind
by a Tool that is no longer `same_origin_static` is ignored by the gate
and is never pruned from `dist/`; delete it by hand.

A compact visual of both observations is committed at
[`docs/verification/supply-chain/submodule-provenance.webp`](../verification/supply-chain/submodule-provenance.webp)
(rendered from the synthetic fixture above, so it is publishable).
The image is a rendering of the same status-only report the gate prints;
the repair procedure above is the authoritative part.

## 7. Artefact license & dependency inventory (Issue #466)

§6 proves *where the bytes came from*. It says nothing about *whether
those bytes may be published*: `license` is a string an operator typed,
so a Tool whose pinned commit ships AGPL-3.0 — or no license file at all
— passed every gate carrying the same MIT claim as one that ships the
MIT text; and because the Tools build from their own lockfile inside
`external/<slug>/`, no file in this repository recorded which dependency
set produced `/tools/<slug>/app/`. Issue #466 makes both visible and
gates them.

```bash
pnpm run tools:artifact:check                     # the gate (validate:fast, and the build)
pnpm run tools:artifact:check:observed            # the same gate, but the artefact must exist (validate:integration)
pnpm run tools:artifact:update                    # regenerate the reviewed record, then re-run
node scripts/check-tool-artifact-inventory.mjs --report=markdown
node scripts/check-tool-artifact-inventory.mjs --report=html --report-out=.tmp/tool-artifact-inventory.html
```

The two check scripts differ in one thing. `tools:artifact:check` runs
in `validate:fast`, which is offline and read-only: it can read the
reviewed record, but it cannot see the bytes a build would serve, so
the outbound-host rule is **unobserved** rather than satisfied.
`tools:artifact:check:observed` runs in `validate:integration`, after
`build:production`, and treats the observation itself as a
precondition: a shipped Tool whose artefact was never produced is
`ARTEFACT_NOT_OBSERVED`, not a pass. "Unobserved" is not "observed
and clean" (Issue #733, V-2).

What it proves, per Tool:

| fact                | compared against                                                         | finding on drift                                              |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `license`           | the SPDX identifier in the pinned checkout's license file (`LICENSE*`, `LICENCE*`, `COPYING*`) and `package.json#license` | `LICENSE_EVIDENCE_MISSING` / `LICENSE_UNDECLARED` / `LICENSE_UNRECOGNISED` / `LICENSE_MISMATCH` / `LICENSE_FIELD_MISMATCH` |
| dependency set      | the sha256 of the lockfile the declared package manager consumes, plus the `package.json#dependencies` names | `LOCKFILE_MISSING` / `DEPENDENCY_DRIFT`                        |
| the review itself  | the commit `quality/tool-artifact-inventory.json` was written for        | `REVIEW_RECORD_MISSING` / `REVIEWED_PIN_MISMATCH` / `LICENSE_EVIDENCE_CHANGED` |
| outbound references | the host set observed in the collected artefact                          | `OUTBOUND_UNDECLARED` / `OUTBOUND_RECORD_STALE`                |

Severity is the contract, and it is the reason the gate exists:

- `same_origin_static` — this repository builds and serves the bytes —
  is an **error**. `scripts/build-tools.mjs` step 1c evaluates the same
  `src/tools/artifact-inventory.ts` rules this gate reports, so a Tool the
  gate blocks is never published: `pnpm run build` refuses it. Step 6
  evaluates the outbound rule again after collection, because a clean
  checkout has no `dist/client/tools/<slug>/app` for step 1c to scan.
- any other delivery kind is a **warn** (a hold) when bytes exist to
  inspect, and **info** when the entry is inventory-only. The 13 entries
  with no submodule are reported once, by count, so an unreviewed
  inventory never renders like a reviewed one. A shipped entry without a
  checkout is counted as a failure, never as inventory-only.

Two comparisons are deliberately independent of the digest they ship
with. The runtime dependency set is compared even when the lockfile
sha256 is unchanged (editing `package.json#dependencies` does not move
the lockfile in every package manager), and `reviewed.pinned_sha` is
compared for inventory-only entries too (their pin is still a reviewed
claim, reported at `info` severity).

License detection resolves families whose canonical texts embed one
another: BSD-3-Clause contains the BSD-2-Clause grant, AGPL-3.0 §13
names the GNU GPL, and GPL-3.0 §13 names the AGPL. The title line picks
the family, so a `GPL-3.0-only` claim is not verified by AGPL text and a
`BSD-2-Clause` claim is not verified by BSD-3 text. The outbound scan
covers `ws:` / `wss:` and protocol-relative `//host/path` references in
addition to `http(s):`.

Like §6 the gate is **offline and status-only**: no network fetch, no
environment variable, no secret file, no binding. Licence evidence is
read from the pinned checkout and digested; artefact URLs are reduced
with `new URL()` and printed as `hostname`, so a userinfo or port inside a
bundled URL can never reach a report that gets pasted into a PR.

### 7.1 Bumping a submodule: the reviewed record

Evidence is only evidence *about a commit*. A pin bump that changes the
license file or rewrites the lockfile is a new, unreviewed claim, so it
is a finding until the record is regenerated and the regenerated diff is
reviewed **in the same PR as the bump**:

```bash
git submodule update --init --recursive
pnpm run tools:artifact:update
git diff quality/tool-artifact-inventory.json   # this diff IS the review
```

Regenerate once more after a build (`pnpm run build`) so `outbound.hosts`
describes the bytes that actually ship.

Regeneration is **not** a bypass: the record absorbs drift, not a false
claim. A Tool whose license file contradicts the manifest keeps failing
`LICENSE_MISMATCH` however many times the record is rewritten —
`scripts/check-tool-artifact-inventory.test.mjs` asserts exactly that.

### 7.2 Abnormal observation and repair

This repository is (correctly) never in a drifted state, so the failure
modes have to be produced somewhere. `scripts/make-tool-artifact-fixture.mjs`
builds a synthetic host repository from git plumbing and hand-written
files — five Tools, one per rule, no network, no real Tool repository, no
credential, fixed commit dates — and the real gate runs over it with
`--root=`. The block below is a verbatim capture of that command:

```console
$ node scripts/make-tool-artifact-fixture.mjs .tmp/tool-artifact-fixture
$ node scripts/check-tool-artifact-inventory.mjs --root=.tmp/tool-artifact-fixture
[check-tool-artifact-inventory] 3 error(s), 1 warning(s), 0 note(s):
  [error] DEPENDENCY_DRIFT drifted-widget: pnpm-lock.yaml no longer matches the reviewed digest (runtime dependencies added: right-pad; removed: none)
      remedy: re-run `pnpm run tools:artifact:update` and review the dependency change in the PR that changed it
  [error] LICENSE_MISMATCH relicensed-widget: the manifest declares "MIT" but LICENSE grants AGPL-3.0-only
      remedy: correct `license` in src/tools/manifest.json, or re-license the Tool repository before the next pin
  [error] LICENSE_EVIDENCE_MISSING unlicensed-widget: the manifest declares license "MIT" but the pinned checkout carries none of LICENSE, LICENSE.md, LICENSE.txt, LICENCE, LICENCE.md, LICENCE.txt, COPYING, COPYING.md, COPYING.txt
      remedy: add the license file to the Tool repository, or correct `license` in src/tools/manifest.json if the claim is wrong
  [warn] OUTBOUND_UNDECLARED drifted-widget: the collected artefact references host(s) absent from the reviewed set: example.com, metrics.example.org
      remedy: review the references (a live request and a bundled library documentation link are indistinguishable to a static scan), then re-run `pnpm run tools:artifact:update`
  [info] INVENTORY_ONLY 1 manifest entr(y/ies) have no checked-out source in this tree; their `license` field is unreviewed documentation, not evidence, and nothing is published from them
[check-tool-artifact-inventory] 5 tool(s) inspected: 4 shipped, 1 pass, 0 warn, 3 fail, 1 inventory-only. Result: FAIL
```

Repair order, cheapest first:

1. `LICENSE_MISMATCH` / `LICENSE_EVIDENCE_MISSING` — correct the claim or
   the Tool repository. A Tool whose license is not MIT cannot be
   embedded under ADR-0006 §3; fix the claim before the next pin.
2. `DEPENDENCY_DRIFT` / `REVIEWED_PIN_MISMATCH` — run
   `pnpm run tools:artifact:update` and read the diff. If the lockfile
   changed for a reason you did not expect, stop there.
3. `OUTBOUND_UNDECLARED` — open the artefact and look at what the new
   host is. A static scan cannot tell a live request from a bundled
   library's documentation link, which is why this one is a hold and not
   a build failure; the committed record is what makes it reviewable.

The same report rendered in a browser is committed at
[`docs/verification/security/tool-artifact-inventory.webp`](../verification/security/tool-artifact-inventory.webp),
regenerated by `pnpm run verify:tool-artifact-inventory-screenshot`. The
script exits non-zero unless the gate actually failed, so the image can
never drift into a picture of a green run, and it refuses to commit a
page whose credential-shaped fixture URL survived redaction.

## 8. Open Issue #81

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

## 9. Troubleshooting

| symptom                                              | likely cause                                                         | fix                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `check-tools-manifest` reports "submodule missing"   | `git submodule update --init` not run                                | run `git submodule update --init --recursive`                                                        |
| `check-tools-manifest` reports "SHA mismatch"        | `external/<slug>/` is checked out at a different SHA than the manifest | `git -C external/<slug> checkout <pinned_sha>` and re-commit the gitlink                            |
| `build-tools` reports "package manager unavailable" | the Tool's chosen package manager is not on `$PATH` in CI             | install it (e.g. add `bun` to the build step) or change the Tool to use `pnpm`                      |
| `build-tools` reports "no index.html in artifact"    | the Tool's `build.output_dir` is not the directory containing `index.html` | fix the manifest's `build.output_dir` to point at the actual output root                            |
| `check-architecture` reports "parent must not import Tool source" | a parent source file imports `external/<slug>/src/...`     | remove the import; route through the collected artefact under `dist/client/tools/<slug>/`            |
| `check-submodule-provenance` reports `CHECKOUT_SHA_MISMATCH`   | `external/<slug>/` is checked out at a commit other than the pin   | `git -C external/<slug> checkout <pinned_sha>`, or bump the pin and commit both files together (§6.2) |
| `build-tools` reports "license / dependency evidence unverified" | the Tool's license was never read, or the reviewed record is stale (§7) | `pnpm run tools:artifact:update`, review the record diff, and fix any `LICENSE_*` finding before building (§7.1) |
| `tools:artifact:check` reports `DEPENDENCY_DRIFT` | the Tool's lockfile changed since the record was written | review the lockfile diff in the Tool repository, then regenerate the record in the same PR (§7.2) |

## 10. Related artefacts

- [`docs/tools/embed-policy.md`](embed-policy.md) — the iframe sandbox /
  referrer policy / `postMessage` origin contract (Issue #465).
- `docs/tools/inventory.md` — durable inventory of all 14 known Tools,
  with classification reasoning.
- `src/tools/manifest.json` — the registry.
- `src/tools/manifest.schema.json` — JSON Schema (draft-07) for the
  registry.
- `src/tools/embed-policy.ts` + `.test.ts` — the embed policy and its
  contract tests.
- `scripts/check-tools-manifest.mjs` + `.test.mjs` — verifier.
- `scripts/check-submodule-provenance.mjs` + `.test.mjs` —
  supply-chain provenance gate (§6).
- `scripts/check-tool-artifact-inventory.mjs` + `.test.mjs` —
  licence / dependency / outbound inventory gate (§7).
- `src/tools/artifact-inventory.ts` + `.test.ts` — the policy the gate,
  the build refusal and the fixture all evaluate.
- `scripts/make-tool-artifact-fixture.mjs` — synthetic host repository
  behind the §7.2 abnormal observation and the report image.
- `quality/tool-artifact-inventory.json` — the reviewed record (§7.1).
- `docs/verification/security/tool-artifact-inventory.webp` —
  rendered inventory report (failure modes), §7.2.
- `scripts/make-provenance-fixture.mjs` — synthetic host repository
  behind the §6.2 abnormal observation and the report image.
- `docs/verification/supply-chain/submodule-provenance.webp` —
  rendered provenance report (normal + drift), §6.2.
- `scripts/tools-embed-policy-report.mjs` — verification report used
  for the Issue #465 screenshot.
- `scripts/build-tools.mjs` + `.test.mjs` — build orchestrator.
- `docs/adr/ADR-0006-tools-submodule-policy.md` — the ADR this
  runbook operationalises.
