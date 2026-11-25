# Selected Work showcase v20–v27 review convergence (2026-11-25)

Continuation of `docs/verification/github-profile/v9/` (dock removal,
alpha dissolve/materialize, roster content). This round iterated on the
post-structural polish findings until the agy design review reached
APPROVE on both layout/motion (pre-compression PNGs, v26) and the final
encoded `showcase.webp` (v27, "ship-ready").

## What changed in the builder (`scripts/build-github-profile-showcase.mjs`)

- `progActIndex()`: protagonist (z-top + accent border) flips to the
  incoming hero 0.8 s before each act boundary — before the two hero
  paths cross mid-glide. Replaces the earlier size-based crossover
  which kept the larger outgoing card on top too long (v19/v20).
- `VACANT_ORDER = [0,1,3,0,1]`: the empty corner rotates through all
  four sub slots while BL stays filled every act; Act 4's vacancy moved
  off BR where it paired with a near-black TR sub.
- Sub inner-edge vignette (`subVignette`): dark plateau gradient on the
  edges where the protagonist overlaps the sub, so clipped headlines
  read as depth instead of mid-word slices. Two traps found and fixed:
  - sharp `composite()` REPLACES earlier composites — the vignette must
    be the first op inside the single ops array (v21–v24 builds silently
    dropped it).
  - The incoming hero is still slot-mapped as a sub during the hand-off
    window, so `p.slug !== protagonistSlug` excludes it (v25 regression).
- Accent frame: 3 px `rgba(140,188,246,0.78)` stroke + wider dark
  keyline for contrast on bright cards at ~350 px.
- Encode: `quality` 70→80, `-m 6`, `-kmin 8 -kmax 12` (a keyframe lands
  inside every 1 s transition), sub alpha render floor 0.08,
  `aulymo-v02` grade 1.6→1.8.
- `-near_lossless` was tested and rejected: the flag is accepted but
  the encode did not finish in a practical window on a loaded machine.

## Review trail

| Round | Artifact | Verdict |
|---|---|---|
| v20 | webp frames | request-changes (sub text, z-order, ghosting, border) |
| v21 | webp frames | request-changes (vignette ineffective, z-order PASS) |
| v22 | webp frames | request-changes (majors cleared, minors remain) |
| v23 | webp frames | request-changes (vignette sides/bands wrong) |
| v24 | webp frames | request-changes (vignette still dropped) |
| v25 | webp frames | request-changes (vignette live; hero regression) |
| v26 | PNG frames | **APPROVE** (layout/motion) |
| v27 | encoded webp | **APPROVE — ship-ready** |

Only the v26/v27 JSONs are committed here; earlier round JSONs remain in
`.tmp/showcase-review-v*/` on the build machine.

## Accepted residual polish (documented, non-blocking)

- Sub-role clips with centred text (FoldLayers "Stop scrolling"/"Free
  on", "No new workf") still slice mid-word at the hero seam — fix is a
  content choice (text-free clip offsets for sub roles), not structure.
- Act 2 BR / Act 5 TL subs are very dark at ~350 px; a brighter clip
  offset or slightly higher dim floor would help perceived balance.
- ~0.5 s beat at t≈21.75 where all four corners are briefly empty during
  the Act 4→5 hand-off (Act 1→2 materialises subs ~0.25 s earlier).
- Transient WebP dark-region residuals at t≈5.50/21.75 flush within
  0.5–1.0 s via kmax12 keyframes; subtle at README scale.

## Files

- `agy-review-v26-layout-672d7b09.json` — pre-compression layout/motion
  review (verdict: approve)
- `agy-review-v27-encoded-e1f60a6b.json` — final encoded asset review
  (verdict: approve, "ship-ready")
- `t16_75.png`, `t21_75.png`, `t22_75.png` — representative encoded
  frames (Act 4 mid, Act 4→5 hand-off, Act 5 settled)
