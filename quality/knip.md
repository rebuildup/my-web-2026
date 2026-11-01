# knip — unused dependency / export / file detection (Issue #531)

`knip` detects unused dependencies, unused exports and unused files. The
gate is a **diff gate**, not an absolute gate: existing findings are kept
in a versioned baseline, and only *new* findings fail `validate:fast`.

## Entry points

| Command | Purpose |
| --- | --- |
| `pnpm run knip:check` | Diff-gate against `quality/knip-baseline.json`. Fails on new findings. Part of `validate:fast`. |
| `pnpm run knip:update` | Rewrite the baseline. Run only after the underlying cause is fixed; the PR diff must show which findings disappeared. |

## False-green policy

- Do **not** hand-edit `quality/knip-baseline.json` to silence findings.
- Do **not** bulk-remove the baselined findings in an unrelated PR — the
  cleanup is a separate ticket.
- Every *structural* exception (legitimate dynamic reference) must live
  in `knip.json` as an explicit, reviewable entrypoint/ignore, not in
  the baseline.

## Structural exceptions in `knip.json` and their root causes

| Entry | Root cause |
| --- | --- |
| `postcss.config.mjs` (entry) | Loaded implicitly by Vite/Panda's PostCSS pipeline; not imported anywhere. |
| `scripts/_no-wrangler-hook.mjs` (entry) | Loaded via `node --import` by `scripts/check-wrangler-independence.mjs` (string reference, not an import). |
| `scripts/_no-wrangler-resolver.mjs` (entry) | Referenced by `_no-wrangler-hook.mjs` through `import.meta.resolve` string. |
| `scripts/run-deploy-inner.mjs` (entry) | Spawned as a child process by `scripts/deploy-with-secrets.mjs`. |
| `src/cloudflare/workers-stub.ts` (entry) | Client-bundle alias target resolved by string in `vite.config.ts`. |
| `ignoreDependencies: cloudflare` | Ambient virtual module emitted by `cf workers types`; not an npm package. |
| `ignoreDependencies: postcss` | knip attributes the Panda plugin's implicit `postcss` external to `panda.config.ts` as an `unlisted` finding. No first-party source imports the package — `'@pandacss/dev/postcss'` in `postcss.config.mjs` is a plugin *name*, not an import — so the entry records a toolchain-internal resolution, not a missing dependency declaration. |
| `ignoreDependencies: @storybook/react` | Imported by `.storybook/preview.ts` and by every `src/**/*.stories.tsx`, but it is **not** a declared dependency (only `@storybook/react-vite` is). The entry records a real packaging gap, not a structural false reference; declaring it belongs to a dependency-decision ticket, not to this gate. |
| `ignoreExportsUsedInFile: true` | Exports referenced within their own module are not "unused". |

## What the gate reads

`GATED_KEYS` in `scripts/check-knip.mjs` is every category of knip's
`ISSUE_TYPES` except `cycles`. The namespace categories (`nsExports`,
`nsTypes`) are included so an unconsumed `export * as ns from './x'` fails
the gate instead of being dropped on the floor. `cycles` is deliberately
excluded: it is an opt-in dependency-graph analysis, so enabling it would
change the gate from "is anything unused" to "is anything cyclical", which
is a different contract with a different owner.

The gate also fails closed when knip itself does not complete: a non-zero
exit status (bad config, unreadable workspace) or unparsable JSON is an
error even when the output would otherwise be a well-formed, smaller issue
list.

## Baseline

`quality/knip-baseline.json` holds the pre-existing findings at the time
knip was introduced (unused barrels under `src/*/index.ts`, one-off
maintenance scripts under `scripts/`, `gifenc` / `wrangler` devDeps,
unused public re-exports). They are tracked debt for a separate cleanup
ticket and MUST NOT be re-baselined silently.

The baseline is **fail-closed for this repository**: if
`quality/knip-baseline.json` is missing or unparsable, `pnpm run knip:check`
exits non-zero instead of degrading into "every finding is new".

Absorbing the trunk is part of the same rule. When `release-*` lands other
tickets that ship their own unused exports / one-off scripts, `knip:check`
reports them as *new* until the baseline is regenerated. Run
`pnpm run knip:update` in the same PR as that merge and let the diff show
exactly which findings were absorbed; never edit the baseline by hand and
never fix another ticket's debt from here.

### The ceiling (Issue #733)

The baseline is **recorded debt**, and debt that can grow without limit is
not a debt but a budget nobody decided. `quality/knip-baseline.json`
therefore carries two fields beyond the findings themselves:

| Field | Meaning |
| --- | --- |
| `ceiling` | The maximum number of baselined findings the repository tolerates. |
| `ceiling_rationale` | Why that number is that number. A human sentence, never generated from the findings. |

`pnpm run knip:update` **reads** the ceiling and never raises it: an update
may shrink the recorded debt, but growing it is refused, and the error
names the remedy — raise the ceiling in `quality/knip-baseline.json` by
hand, with a new stated reason. `pnpm run knip:check` refuses a baseline
whose recorded findings exceed its ceiling, and refuses one that has no
ceiling or no stated reason at all, so the debt cannot become unbounded by
editing the file either.

The ceiling is currently **141** — the debt as it stood when Issue #733
introduced the rule. Lowering it is welcome; raising it is a decision.

Absorbed so far (each line is an addition the diff shows, never a removal):

| Finding | Origin |
| --- | --- |
| `types src/http/webhooks/signature.ts WebhookSignedMaterial` | #463 (webhook signature adapter) landed on `release-0-6-3`; the type is documented vocabulary for the not-yet-mounted `/webhooks/*` route, so it is #463's debt, not this gate's. |
| `exports scripts/publication-surface.mjs TOOL_SHIPPED_SUBPATHS` | #505 (publication surface snapshot) landed on `release-0-6-3`; the constant documents what a Tool checkout ships but has no consumer yet, so it is #505's debt, not this gate's. |
| `exports src/portfolio/markdown.xss-fixtures.ts acceptedMarkdownFixtures` | #451 (portfolio markdown XSS boundary) landed on `release-0-6-3`; absorbed on arrival, then resolved by #451's own follow-up (the corpus moved to `test/fixtures/` and the accessor gained a consumer). Listed here so the removal in the baseline diff is not read as a silent shrink. |
| `files scripts/render-session-cookie-report.mjs` | #438 (session cookie contract) landed on `release-0-6-3`; a one-off verification report script, so it is #438's debt, not this gate's. |
| `files src/external-api/index.ts` | #499 (external-read obligation) landed on `release-0-6-3`; the barrel is the obligation's documented public surface, but no route/UI consumer imports it yet, so it is #499's debt, not this gate's. It is a real finding, not a legitimate dynamic reference, so it stays in the baseline instead of being suppressed through `knip.json`. |
| `files src/i18n/index.ts` | #433 (i18n leaf) landed on `release-0-6-3`; callers import the leaf modules directly, so the barrel itself has no consumer yet. That is #433's public-surface decision, not this gate's, so it is absorbed rather than suppressed. |
| 17 `exports` / `types` from `src/editorial/error-states/index.ts` | #501 (error-state surfaces) landed on `release-0-6-3`; `src/router.tsx` consumes `NotFoundState` / `ServiceUnavailableState` through the barrel, which makes the other re-exports (definitions, labels, dependency metadata, prop types) unconsumed. This is #501's public surface, not this gate's, so it is absorbed into the baseline rather than suppressed through `knip.json`. |
| `exports src/http/errors.ts resolveRequestId` | #457 (boundary 5xx redaction) landed on `release-0-6-3`; the accessor records the request id on the redacted response, and no caller reads the field back yet, so it is #457's debt, not this gate's. |
| `exports src/http/security-headers.ts X_CONTENT_TYPE_OPTIONS`, `REFERRER_POLICY`, `PERMISSIONS_POLICY` | #449 (security headers) landed on `release-0-6-3`; the header-name constants document the shipped header set and are consumed by `src/server.ts` / `src/tools/registry.ts` only through the resolved header map, while the check script declares its own literals. They are #449's public surface, not this gate's. |
| `files scripts/log-redaction-report.mjs` | #467 (log redaction) landed on `release-0-6-3`; a one-off verification report script, so it is #467's debt, not this gate's. |
| `files scripts/make-provenance-fixture.mjs` | #473 (submodule provenance) landed on `release-0-6-3`; a fixture generator for the provenance check, so it is #473's debt, not this gate's. |
| `files scripts/markdown-format-report.mjs` | #435 (Markdown format contract) landed on `release-0-6-3`; a one-off verification report script, so it is #435's debt, not this gate's. |
| `types src/cloudflare/media-visibility.ts MediaKeyReason` | #459 (R2 visibility boundary) landed on `release-0-6-3`; the union documents the reasons a media key is refused, and no caller/narrowing consumer reads it back yet, so it is #459's debt, not this gate's. |
| 15 `exports` / `types` from `src/editorial/forms/index.ts` | #404 (accessible form-field contract) landed on `release-0-7-0`; the barrel publishes the field-id / description / error-summary vocabulary that `src/admin/**` forms consume through the route tree, and knip sees no importer of the barrel itself, so the re-exports (and their prop types) read as unconsumed. This is #404's public surface, not this gate's, so it is absorbed into the baseline rather than suppressed through `knip.json`. |
| 3 `exports` from `scripts/_seo-status-contract.mjs` | #419 (exhaustive HTTP status contract) landed on `release-0-7-0`; the surface-to-status expectation table, the robots states and the id index are documented vocabulary that `scripts/check-seo-status-contract.mjs` reads through its own copy of the contract, so the module exports read as unconsumed. This is #419's debt, not this gate's. |
| 13 `exports` / `types` from `src/editorial/social-card/**` | #421 (Open Graph / Twitter card contract) landed on `release-0-7-0`; the routes consume `composeSocialCard` from the barrel, which leaves the card vocabulary (`SocialCard*`, `FallbackCard`, `CARD_TYPES`, `CANONICAL_ORIGIN`) unconsumed today. This is #421's public surface, not this gate's, so it is absorbed rather than suppressed through `knip.json`. |
| `exports src/editorial/reduced-motion.ts REDUCED_MOTION_PROP` | #403 (reduced-motion contract) landed on the #403 branch; the constant publishes the prop name that `scripts/check-reduced-motion.mjs` resolves from the contract source (it judges a motion surface against `usePrefersReducedMotion()` **or** against this name), while `src/home/access/tiles.tsx` spells the same name as the JSX attribute. The gate is a static source scan and cannot import it, so the export reads as unconsumed to knip. This is #403's contract surface, not this gate's, so it is absorbed rather than suppressed through `knip.json`. |

## Fixtures

`scripts/check-knip.test.mjs` builds a synthetic project in an OS temp dir that
declares an unused dependency and an unused export and asserts
`scripts/check-knip.mjs --root <fixture>` exits non-zero (and exits zero
once both findings are removed). This is the CI failure proof required
by Issue #531.

Further cases drive the diff itself, which is the path that actually runs
in CI: a finding recorded in the fixture's `quality/knip-baseline.json`
does not fail the gate, an unbaselined one does, and a baseline entry whose
finding disappeared is reported as resolved (as a `::warning::`
annotation, so a shrinking baseline is visible in the GitHub Actions
annotations instead of only in the raw log). A `--root` fixture with no
baseline file at all means "no debt recorded yet" and is the only case in
which the baseline is optional.
