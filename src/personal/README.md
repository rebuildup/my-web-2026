# `src/personal` — the personal-document preview owner (Issue #709)

This directory is an **obligation**, not a classifier folder. It was
born because a set of document Issues needed a place to hold the
*structured display data* and the *standalone preview* of the personal
documents — the philosophy, the making motivation, the brand naming
record, the influence notes — and no existing owner could hold them
without breaking its own contract.

- `src/editorial/**` owns the **shipped editorial visual language**.
  A brand-naming record is not a visual language.
- `src/routes/**` owns the **route contract**. A preview is not a
  route, and a file placed there without a route declaration fails the
  publication gate (`E005 undeclared-route-file`).

The documents themselves are Markdown under `docs/**` (internal
documentation, Japanese). This owner holds only **what a preview
renders**: the data, and the component that renders it.

## The five questions (AGENTS.md §3)

1. **Obligation** — what work does it own?
   The structured display data of the personal documents, and the
   standalone preview that renders it (a Storybook story that can be
   drawn without a page, without a route and without a binding).

2. **Change reason** — what decision or contract makes it change?
   A change to the *shape of a personal document's content* — a new
   taxonomy, a new field, a new classification rule. The document's
   prose is reviewed in `docs/**`; the preview changes only when the
   structure the preview shows changes.

3. **Authority** — what has final decision authority over that change?
   The repository owner. The owner decides what may be shown publicly
   and what stays an internal note; this owner never decides that on
   its own. A preview renders what the owner has already approved as
   structure, and never invents a classification.

4. **Dependency direction** — who may know this contract?
   `personal -> editorial` only. The owner composes `editorial`
   display primitives and imports **no** route, no binding, no peer
   obligation (`home`, `portfolio`, `about`, `http`, `cloudflare`) and
   no other owner. `scripts/check-architecture.mjs` enforces that
   direction.

5. **Lifecycle** — what is it born and removed with?
   Born with Issue #709, which introduces the owner together with its
   first consumer. It is removed if the personal-document preview
   contract moves to an owner that already exists, or if the documents
   it previews are withdrawn.

## What lives here

```text
src/personal/<topic>/
  <Topic>.preview.ts    # the structured content the preview renders
  <Topic>.stories.tsx   # the Storybook story that renders it
```

A preview is a **demo surface**, not a published page. It is excluded
from the public-Japanese-copy gate for the same reason
`**/*.stories.tsx` is: the copy it shows is a fixture, not a sentence
the site publishes. The published wording of a document lives in
`docs/**`, where the owner's review happens.
