# Verification — operations

Screenshots and reproduction steps that back an operational claim in a
pull request. An image alone is not evidence: every entry records the
command, the fixture it renders and the expected result, so a reviewer
can re-run it.

| Artefact | Issue | What it proves |
| --- | --- | --- |
| `status-incident-context.webp`, `status-incident-context-mobile.webp` | #502 | the shipped status section in the two states Issue #502 adds: a service that was NOT observed (no entry in the snapshot) reads differently from a service whose read FAILED, and the known-incident block renders the committed list — with the explicit "no incidents recorded" state and the public tracker link |
| `error-state-gallery.webp` | #501 | the three shipped failure surfaces (404 / 503 / dependency failure) with the props the router wires |
| `api-timeout-fallback.webp` | earlier issue | the API timeout fallback surface |
| `prod-smoke-results.webp` | release | the production smoke result board |

## `status-incident-context.webp` (Issue #502)

The committed screenshot of
`docs/verification/ops/status-incident-context.png` with the `.webp`
extension — this repository ships verification images as WebP, never
PNG (see `docs/verification/web/README.md`).

- Path: `docs/verification/ops/status-incident-context.webp`
  (desktop 1440×900) and
  `docs/verification/ops/status-incident-context-mobile.webp`
  (mobile 390×844)
- Generator: `scripts/capture-status-incident-context.mjs`
- Story: `src/home/status/tiles.stories.tsx` → the `IncidentContext`
  story, imported by the generated harness itself (the capture cannot
  photograph a copy of the component)

### What the image shows

Two panels of the SAME shipped section (`StatusTiles`), each rendered
with fixture props only:

| | top panel | bottom panel |
| --- | --- | --- |
| condition | published surface | verification-only sample |
| `r2` (no entry in the snapshot) | `not observed` | `not observed` |
| `d1` | `degraded` | `unreachable` |
| known incidents | "記録された障害はありません" + the public tracker link | one SAMPLE record (title / date / summary / link) |
| silhouette | broken ring | broken ring vs. cross |

The sample record is **not** a published incident: the published list
(`src/home/status/incidents.ts`) is empty, and the bottom panel exists
only to prove the record shape renders. The capture labels it as such
in the frame, so the image cannot be mistaken for a published incident
log.

### What it proves, and what it does not

The image is SUPPORTING EVIDENCE. The authority is the test:

```bash
pnpm exec vitest run src/home/status src/editorial/primitives
```

- `src/home/status/tiles.test.tsx` asserts the four health states are
  four different words and four different silhouettes, that a missing
  reading renders `not observed` (never `unreachable`), and that the
  incident block renders the empty state, a published record and the
  withheld state.
- `src/home/status/incidents.test.ts` asserts the reference rule: only
  an issue of the canonical public repository or a public route of this
  site may be linked, everything else is withheld, and the published
  list starts empty.
- `src/editorial/primitives/StateMark.test.tsx` asserts the four
  status silhouettes resolve to four different geometries.

### Fail-closed list

The capture refuses to run rather than write a meaningless artefact:

- a committed output path that is not `.webp` (or that leaves the
  repository) is refused;
- the harness must render the gallery marker
  (`data-testid="status-incident-context"`); without it the capture
  would photograph an empty page and still write a plausible-looking
  image, so the run fails instead;
- a capture over the 300 kB artefact budget fails;
- the intermediate PNG is written under `.tmp/` (gitignored) and
  deleted; no PNG is ever committed;
- the capture needs NO Infisical, NO D1 and NO R2 — the gallery renders
  fixture props offline, so the artefact cannot depend on a binding;
- the script prints status only (path, size, viewport). No secret
  value, no URL of a private resource, no environment variable is
  printed.

### Regenerate

```bash
pnpm run verify:status-incident-screenshot
# equivalent: node scripts/capture-status-incident-context.mjs
```

The run writes `.tmp/status-incident-context/report.json` (gitignored):
the source SHA, the story it rendered, both viewports, the encode
policy and the byte size of each artefact. Chromium screenshots are
not byte-reproducible across processes, so the report records the
conditions instead of claiming a deterministic artefact.
