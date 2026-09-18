# ADR-0005: Editorial visual language foundation (Panda CSS)

- Status: Accepted (revised 2026-09-19)
- Date: 2026-09-11
- Extends: ADR-0001
- Superseded by: None

## Context

Panda CSS is the selected styling system. 0.1.0 originally placed raw tokens,
semantic tokens, and recipe seeds under a generic `src/design-system/`
category.

Once the 0.2.0 Home surface existed, the actual ownership became clearer:
those tokens and primitives express the current **editorial visual language**.
Calling them a global design system implied a shared obligation before a
second visual language or consumer existed.

ADR-0008 establishes that shared boundaries are discovered from observed
invariants and change pressure rather than created speculatively.

## Decision

### 1. Panda CSS remains the styling infrastructure

`@pandacss/dev` 1.12.x remains the styling dependency. Panda codegen and
PostCSS wiring do not change.

### 2. The current visual language owns its tokens

The shipped editorial language owns:

- `src/editorial/tokens.ts`
- `src/editorial/semantic-tokens.ts`
- `src/editorial/primitives/`

`panda.config.ts` consumes these files directly.

### 3. `editorial/` is not a generic component library

A primitive belongs in `editorial/` because its design rule is governed by
the editorial language, not because it is React UI.

A future product or dashboard visual language remains independent by default.
Duplication is evidence of a possible shared obligation, not proof of one.
Sharing requires the same governing invariant, authority, lifecycle, and
expected evolution to be observed.

### 4. Storybook follows ownership

Stories stay next to the source they describe. The current visual preview is
under `src/editorial/**`; Home composition stories remain under
`src/home/**`.

Storybook remains dev-only, and `pnpm run build-storybook` remains part of
`validate:integration`.

### 5. Tool repositories remain independent

External Tool repositories do not import host visual-language source. Each
Tool may choose its own styling stack; parent integration happens through its
build/manifest contract.

## Consequences

### Positive

- Path states which visual language owns a rule rather than labelling it generically as UI.
- A future visual language can evolve without premature shared primitives.
- Panda token/codegen behavior remains unchanged.

### Negative / Trade-offs

- Similar primitives may temporarily exist in multiple visual languages.
- A later genuinely shared visual obligation may require promotion and moves.
- Uniform directory shape is intentionally not guaranteed.

## Re-evaluation triggers

- A second visual language is implemented.
- Two visual owners repeatedly change for the same governing invariant.
- A host primitive must be consumed by an external Tool.
- Panda CSS no longer fits the required styling/runtime contract.
