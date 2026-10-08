# release-assets/portfolio/0.6.1

Repo-controlled immutable release assets for the **0.6.1 portfolio publication** (Issue #78 Path A — 3 candidates: MultiSlicer / aulymo-v01 / aulymo-v02).

## Why this directory exists

The production publication driver (`scripts/publish-portfolio-production.mjs`)
needs durable, content-addressable media to upload to R2. Two requirements
make live fetching unacceptable:

1. **No external dependency at production run time** — `.reference/my-web-2025`
   clones and YouTube live downloads are not part of the production
   execution surface. If the YouTube `maxresdefault` URL changes or the
   legacy DB clone is missing, the publication flip must not fail.
2. **Content integrity must be verifiable** — every R2 object the
   driver uploads must match a known SHA-256 hash. This catches silent
   upstream changes and accidental local edits.

By committing the assets to the repository with a manifest, the driver
can:

- Verify each asset's SHA-256 against the manifest before upload.
- Upload without re-fetching.
- Fail closed if the hash mismatches.

## Layout

```text
release-assets/portfolio/0.6.1/
├── README.md
├── manifest.json
├── multislicer/
│   └── 20250503_multi.jpg     # 417,357 bytes — SHA-256 e2ca4128…
├── aulymo-v01/
│   └── aulymo-v01-maxres.jpg  #  42,128 bytes — SHA-256 b0ce1b59…
└── aulymo-v02/
    └── aulymo-v02-maxres.jpg  #  78,087 bytes — SHA-256 549a176d…
```

## Manifest contract

`manifest.json` is the single source of truth for:

- which candidate IDs are eligible for publication (exactly the 3 above)
- R2 destination keys
- content type / byte size / SHA-256 / dimensions
- source provenance (legacy BLOB / YouTube maxresdefault URL etc.)

Adding a new candidate requires:

1. **Add the candidate ID to the code allowlist first**: append it to
   `ALLOWED_CANDIDATE_IDS` in `scripts/publish-portfolio-production.mjs`
   (module-level `Set`, near the top of the file). `validateManifest`
   rejects any `manifest.assets[i].candidate_id` outside this set, so
   **no validation step below can pass until the ID is in
   `ALLOWED_CANDIDATE_IDS`**.
2. Drop the asset file under `<candidate>/<​filename>`.
3. Append an entry to `manifest.json#assets`.
4. Re-run the driver's `--operation=verify --execute --environment=local`
   against the candidate's local D1 + local R2.
5. Re-run `--operation=prepare --dry-run --environment=local` to confirm
   dry-run path.

The driver enforces two allowlists: `ALLOWED_CANDIDATE_IDS` (code,
checked by `validateManifest`) and the ids present in
`manifest.json#assets`. A candidate id missing from either is rejected.

## Source provenance (per asset)

| asset | kind | source |
|---|---|---|
| `multislicer/20250503_multi.jpg` | legacy_blob | my-web-2025 SQLite `media` table BLOB; original filename suggests 2025-05-03 capture date |
| `aulymo-v01/aulymo-v01-maxres.jpg` | youtube_maxresdefault | YouTube video `SewXH0Bbm-c` (2024-12-13, project-owned) |
| `aulymo-v02/aulymo-v02-maxres.jpg` | youtube_maxresdefault | YouTube video `EbtybmiN5pM` (2024-12-20, project-owned) |

YouTube maxresdefault URLs are stable for the lifetime of the video, but
the canonical copy lives in this repository. Production execution never
re-downloads.

## What this directory is NOT

- Not a release artifact tracker (no tag-based download URLs).
- Not a content authoring space (no source files, only finalized media).
- Not a publication gate (operator approval is recorded in the
  per-candidate packet comment on Issue #78).

## See also

- `scripts/publish-portfolio-production.mjs` — the driver that consumes
  this directory.
- `release-assets/portfolio/0.6.1/manifest.json` — the structured
  contract.
- Issue #78 (publication decision), Issue #120 (local seed precursor),
  Issue #123 (this driver).
