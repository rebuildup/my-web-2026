# SBOM runbook

> Supply-chain Software Bill of Materials for my-web-2026 (Issue #471).
> One format only: **CycloneDX 1.6 JSON**. The runbook is the
> operational half of the ticket: what the document is, how to read it,
> what a healthy run looks like, what each failure means, and how to
> repair it. The mechanical contract lives in
> `scripts/generate-sbom.mjs` / `scripts/check-sbom.mjs`; this file
> explains the failures those scripts can print.

## 1. What the SBOM covers

| Source (tracked, committed)                | What it contributes                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm-lock.yaml`                           | every resolved npm `name@version`, its SHA-512 integrity, the dependency graph, and the pnpm bootstrap artifacts |
| `package.json`                             | the root application component and the repository license                        |
| `pnpm-workspace.yaml`                      | which dependencies are **patched** (`pnpm patchedDependencies`)                   |
| `src/tools/manifest.json`                  | the external Tool artifacts: slug, pinned commit SHA, declared license, canonical repo |
| `node_modules/.pnpm/*/package.json`        | license evidence, read verbatim from the installed packages                      |

The document is written to
`release-assets/supply-chain/<package.json#version>/sbom.cdx.json`,
which is **gitignored** (see `.gitignore`). That is deliberate: the
artifact must be verifiable against the real lockfile at every moment,
and the strongest way to do that is to regenerate it and compare, not
to trust a committed blob that could be edited by hand.

Facts that CycloneDX 1.6 has no field for — the dependency group, the
license-resolution split, the patch flag, and an upstream deprecation
notice — are carried as namespaced `my-web-2026:*` properties instead.
CycloneDX 1.6 sets `additionalProperties: false` on `component`, so
inventing a plausible-looking field would invalidate the whole
document for every schema-conformant consumer.

## 2. Commands

```bash
pnpm run sbom:build    # write release-assets/supply-chain/<version>/sbom.cdx.json
pnpm run sbom:check    # generate in memory, then fail closed on any drift (in validate:fast)
pnpm run sbom:check -- --bom=<path>            # check one specific document
pnpm run sbom:report   # render .tmp/sbom-report.html for human review / PR screenshots
```

Reproducible builds: `SOURCE_DATE_EPOCH=<unix seconds> pnpm run sbom:build`
pins `metadata.timestamp` and derives `serialNumber` from a digest of the
document body, so two builds of the same inventory are byte-identical.
Without it the timestamp is the build time and the serial number is
random, which is why `sbom:check` compares documents with
`serialNumber` and `metadata.timestamp` removed.

## 3. Secret posture (read this before adding an input)

AGENTS.md section 4 forbids listing real secret values. The SBOM path
is designed so that question never arises:

- The generator reads **only** the four tracked files above, plus
  `node_modules/.pnpm/*/package.json`. There is no code path to
  `process.env` credential, `.dev.vars`, Infisical, a Wrangler secret
  subcommand, or a deployment-config read.
- The document records the SHA-256 of every tracked input in
  `metadata.properties#my-web-2026:source-digests`. `scripts/check-sbom.mjs`
  recomputes those digests from the files on disk and compares the
  **values**, not just the keys, so a hand-written or stale provenance
  record fails closed and a reader can verify the provenance without
  trusting the generator.
- The gate additionally rejects the document if it contains **any**
  runtime secret *name* in the repository's secret contract
  (`scripts/_cloudflare-contract.mjs` — the single module that
  `cloudflare.config.ts` also derives the Worker's binding names from;
  audit-only names are included), or if it contains a
  credential-shaped value (PEM private key, AWS key id, GitHub / Slack
  / OpenAI-style token, JWT, inline `api_key` / `secret` / `token` /
  `password` assignment).

If a future change needs a new input, it must be a **tracked,
value-free** file. Adding an environment read to this path would
invalidate the "no secret" property and must not be done without an
ADR.

## 4. Normal observation

A healthy local run prints one line and exits 0:

```text
[check-sbom] OK: 774 components match pnpm-lock.yaml (version 0.6.3), no secret content found; release-assets/supply-chain/0.6.3/sbom.cdx.json not staged (expected before a release cut).
```

Read it as three independent facts:

1. **774 components** — every resolved package in the lockfile, plus the
   Tool Registry artifacts, deduplicated by `name@version`.
2. **`match pnpm-lock.yaml`** — set equality in both directions, and every
   declared SHA-512 equals the lockfile integrity for that package.
3. **`no secret content found`** — the provenance record is present and the
   denylist scan is clean.

The trailing clause is about the staged release artifact. Before a
release cut it reads `not staged (expected before a release cut)`; after
`pnpm run sbom:build` it reads `matches a fresh generation`.

CI behaves identically: `pnpm run sbom:check` runs inside `validate:fast`
(which `validate:integration` includes), then the `Build SBOM` step
materialises the document and the `Upload SBOM` step retains it as the
`sbom-<sha>` workflow artifact.

For a human-readable view:

```bash
pnpm run sbom:report && open .tmp/sbom-report.html
```

The report shows the build identity, the inventory counts, the scope and
license distribution, every direct dependency with its pinned version and
digest prefix, every Tool artifact with its pinned commit SHA, and the
three-way license split described in §5.

## 5. Reading the license fields honestly

Three states appear in `licenses[].license.name` plus the
`my-web-2026:license-resolution` property:

| `license-resolution` | meaning                                                                 | rendered license |
| -------------------- | ----------------------------------------------------------------------- | ---------------- |
| `declared`           | upstream ships a `license` string, read verbatim from the installed package | that string      |
| `undeclared`         | the package ships no `license` field at all                              | `NOASSERTION`    |
| `not-installed`      | a platform-specific optional binary that is not installed on the machine generating the SBOM (a Windows shim while running on darwin-arm64) | `NOASSERTION`    |

The third case is **not** a license finding — it is a statement about
where the SBOM was generated, and it covers the large majority of the
`NOASSERTION` entries (209 of 211 on a darwin-arm64 run, against 2
genuinely `undeclared` packages). It is not the majority of the
inventory as a whole: on the same run 548 of 759 npm components are
`declared`. Do not "fix" it by asserting a license. A genuinely
license-less package is worth raising as its own ticket.

The counts are platform-dependent by construction — a Linux CI runner
installs a different optional-dependency set than a macOS laptop — so
quote the split from `pnpm run sbom:report`, which reads the numbers
out of the document that is actually attached to the release.

No SPDX identifier list is vendored into this repository, so the
verbatim upstream string is carried rather than a guessed identifier.
That is a deliberate accuracy trade-off: a wrong SPDX id is worse than an
unclassified one.

## 6. Abnormal observation — what each failure means

All failures print `[check-sbom] FAIL: …`, a bullet per violated rule, and
the same remedy line. The categories, with the real cause behind them:

| Message shape                                        | What it means                                                            | Usual real cause                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `resolved by pnpm-lock.yaml but missing from the SBOM` | a dependency was added/removed and the SBOM was not regenerated         | `pnpm-lock.yaml` changed without a fresh `pnpm run sbom:build`                  |
| `present in the SBOM but absent from pnpm-lock.yaml`  | the document describes software that is no longer resolved                | hand-edited SBOM, or a stale artifact from a previous sprint                   |
| `SHA-512 does not match the lockfile integrity`        | the recorded digest is not the one the lockfile pins                     | tampered / stale artifact, or an integrity algorithm change in a pnpm upgrade  |
| `purl disagrees with name/version` / `bom-ref must equal purl` | the component's identity fields disagree                        | partial hand edit                                                            |
| `duplicate component`                                 | the same `name@version` appears twice                                    | peer-resolution variants were not deduplicated                                 |
| `dependsOn points at an unknown component`             | the dependency graph references something the inventory does not list    | generator bug — report it, do not patch the document                           |
| `tool "<slug>": pinned SHA mismatch`                   | the Tool Registry pin moved without an SBOM rebuild                      | a `src/tools/manifest.json` pin bump; expected on Tool pin-bump PRs            |
| `tool "<slug>": declared in src/tools/manifest.json but missing` | a Tool was added to the manifest                           | new Tool registration                                                        |
| `runtime-secret-name: …`                              | a runtime secret **name** appears in the document                | the secret SoT was bypassed for this artifact — treat as a security event       |
| `secret-value-shape: …`                               | credential-shaped content is present                                     | same — treat as a security event                                               |
| `missing input digest for <file>`                     | the provenance record is incomplete, so the document cannot be audited   | a generator regression or a hand-edited document                               |
| `recorded digest for <file> does not match the file on disk` | the provenance record disagrees with the tracked file          | a hand-edited or stale provenance record                                       |
| `component-shape: "<key>" is not a CycloneDX 1.6 component property` | the document would be rejected by a schema-conformant consumer | a field that reads like it belongs but does not exist in the format (`additionalProperties` is `false`) |
| `component-shape: required CycloneDX 1.6 property "type"/"name" is missing` | the component is structurally incomplete | a partial hand edit or a generator regression                                   |
| `pnpm-lock.yaml uses an unsupported construct`         | pnpm wrote YAML outside the supported subset                            | pnpm format change; teach the parser, do **not** relax the parse                |
| `<path> differs from a freshly generated SBOM`        | the staged release artifact is stale                                    | rerun `pnpm run sbom:build` at release time                                    |

The `component-shape` rows come from
`CYCLONEDX_COMPONENT_PROPERTIES` in `scripts/check-sbom.mjs`, which
mirrors `definitions.component` of the published CycloneDX 1.6 schema
(whose `additionalProperties` is `false`). It exists because a document
can be perfectly consistent with the lockfile and still be invalid
CycloneDX — the gate has to catch the format as well as the inventory.
Vendoring the full published JSON Schema instead of this hand-mirrored
list is **still an open decision** (see §8); nothing in this repository
claims schema conformance beyond what the gate can prove.

The last two deserve emphasis because they are the failure modes a
generator is most likely to hide: a partial YAML parse produces a
plausible-looking but incomplete SBOM, and a hand-edited document
produces a plausible-looking but unprovable one. Both fail closed here
on purpose.

## 7. Repair procedure

**Ordinary dependency or Tool change** (the normal case):

```bash
pnpm install                      # updates pnpm-lock.yaml
pnpm run sbom:check               # proves the inventory still describes reality
pnpm run sbom:build               # refresh the staged artifact (only needed at release cut)
pnpm run sbom:report              # optional: refresh the human-readable report
```

Nothing to hand-edit, ever. The gate's own remedy line says the same
thing; if you find yourself editing `sbom.cdx.json` by hand, stop and
regenerate instead.

**Release cut**: after `package.json#version` is set, run
`pnpm run sbom:build` so
`release-assets/supply-chain/<version>/sbom.cdx.json` exists, then
`pnpm run sbom:check` — its trailing clause flips to
`matches a fresh generation`. Attaching the document to the GitHub
Release is part of release publication and therefore **human-gated**
(AGENTS.md section 6 / `skills/github-delivery/SKILL.md#release-pr-merge-human-gate-canonical-rule`);
agents prepare it and stop.

> **The staged comparison is machine-sensitive.** License evidence is
> read from `node_modules/.pnpm/*/package.json`, so an artifact built on
> darwin-arm64 does not record the same `not-installed` set as one built
> on the Linux CI runner. `sbom:check` then reports
> `<path> differs from a freshly generated SBOM` on a lockfile-identical
> document. Regenerate on the machine that will run the gate (or delete
> the staged file and let CI's `Build SBOM` step produce it) — do not
> hand-edit it to make the comparison pass.

**Secret-shaped failure**: do not investigate by printing values. Confirm
only which rule fired and which tracked file introduced the content,
using the same status-only discipline the Infisical scripts use
(`scripts/check-cf-secrets.mjs` and friends). If a real credential ever
reaches this path, revoke and rotate it per `docs/security.md` before
anything else.

**Unsupported YAML after a pnpm upgrade**: the parser accepts multi-
document block mappings, block sequences, flow mappings/sequences and
scalars — nothing else. Extend `scripts/generate-sbom.mjs` and its
tests. Weakening the check to make the gate green would defeat the only
property this ticket buys.

## 8. Open decisions

Recorded here so the next reader does not mistake an unresolved
policy question for a settled fact:

- **Full CycloneDX 1.6 JSON Schema validation.** The gate mirrors the
  `component` property list by hand rather than vendoring the published
  schema, because the schema file (or an `ajv` dependency) would sit
  inside the very dependency surface this ticket audits. Whether to
  vendor it, and under which pin, is an owner decision.
- **The staged-artifact comparison inside `validate:fast`.** It is
  cheap and read-only, but license enrichment makes it
  machine-dependent (see §7). Whether the staged branch belongs in
  `validate:integration` or behind a flag is also an owner decision.

## 9. Scope boundary

This runbook covers generation, verification and release attachment. It
does **not** add vulnerability scanning, dependency review or license
*policy* enforcement (for example an allow/deny list of licenses).
Those are separate obligations with their own change authority and
their own runbooks: dependency review shipped as its own reviewed
declaration-driven gate (`quality/profile.yaml#security_gates.dependency_review`,
`docs/runbook/dependency-advisories.md`) and license policy has no
implementation yet; see `skills/security-maintenance/SKILL.md` for how
a future ticket would scope them.