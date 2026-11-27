# Automated screenshot review spec

Canonical spec for automated UI screenshot review harnesses such as
dotfiles `agent review run --spec-file`. Validated against the
my-web-2026 L-C review corpus (dotfiles#226): 14/14 documented defects
detected by all tested models; verdict calibration is the weak point,
so the verdict rules below are deliberate.

Review this website UI screenshot and report concrete visual defects and
design weaknesses that a reviewer would act on.

Look for:

- Layout structure problems: empty or dead regions that break the
  composition, unbalanced columns, content that does not use the space
  purposefully.
- Repetition/monotony: lists or sections where every item has an
  identical shape and the page reads as a flat undifferentiated stack.
- Alignment and axis problems: elements that do not share the page's
  left/right key lines or grid.
- Readability: wrapping that breaks tables or rows, cramped or oversized
  type, poor hierarchy.
- Occlusion/overlap: fixed or floating elements covering content.
- Local container clipping: primary commands, code snippets, or essential
  labels cut off inside narrow scrollable/overflow-clipped containers
  (especially on mobile viewports) even when the page itself has no
  horizontal overflow.
- Misleading or unquantified visual encodings: proportional-looking bars
  or charts drawn for items without numeric values, or bar/chart lengths
  that visibly contradict their labeled scale or range.
- Inconsistent styling or spacing that looks unintentional.
- Specification mismatches: visible violations of an explicit
  requirement stated in this spec or of clearly established UI
  conventions on the same page.

Rules:

- Report only what is visibly present in the image. Do not assume hidden
  state, hover behavior, or content below the fold.
- Decorative whitespace that is clearly intentional (e.g. reserved space
  for an overlay) is not a defect.
- Designed placeholder/empty states are not defects.
- Uniform vertical padding inside a section is a stylistic choice, not a
  defect. A dead region is a defect only when content is confined to part
  of the container while a sibling region is entirely unused.
- Fixed or floating UI chrome captured in the screenshot (consent
  banners, helper widgets, companion elements) is evaluated only for
  whether it obstructs content. Its presence alone is not a defect.
- A browser broken-image icon or other media placeholder may be a
  capture-environment artifact rather than a page defect. Report it as
  minor or info unless it clearly breaks the layout, and say that it may
  be an artifact.
- Rank findings by severity: critical (broken/unusable), major (clearly
  harms the page), minor (polish), info (observations).
- Prefix each finding's description with its class:
  `[defect]` for a concrete observable problem,
  `[spec-mismatch]` for a violation of an explicit requirement or
  established convention,
  `[suggestion]` for a subjective design improvement that is not a
  defect.

Verdict rules:

- `approve` when no critical or major defect is present. Minor and info
  findings alone do not block approval.
- `request-changes` only when at least one critical or major concrete
  defect is present.
- `reject` only when the image is unusable for review (blank, wrong
  page, unreadable).
- `approve` covers only the reviewed scope: the images and spec supplied
  for this run. It is not whole-product quality assurance and not human
  acceptance.
