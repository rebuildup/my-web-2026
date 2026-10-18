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
| `ignoreDependencies: postcss` | Consumed by the Panda PostCSS plugin chain; provided transitively. |
| `ignoreDependencies: @storybook/react` | Provided via `@storybook/react-vite` / Storybook 8 addons; imported by stories. |
| `ignoreExportsUsedInFile: true` | Exports referenced within their own module are not "unused". |

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

Absorbed so far (each line is an addition the diff shows, never a removal):

| Finding | Origin |
| --- | --- |
| `types src/http/webhooks/signature.ts WebhookSignedMaterial` | #463 (webhook signature adapter) landed on `release-0-6-3`; the type is documented vocabulary for the not-yet-mounted `/webhooks/*` route, so it is #463's debt, not this gate's. |
| `exports scripts/publication-surface.mjs TOOL_SHIPPED_SUBPATHS` | #505 (publication surface snapshot) landed on `release-0-6-3`; the constant documents what a Tool checkout ships but has no consumer yet, so it is #505's debt, not this gate's. |
| `exports src/portfolio/markdown.xss-fixtures.ts acceptedMarkdownFixtures` | #451 (portfolio markdown XSS boundary) landed on `release-0-6-3`; absorbed on arrival, then resolved by #451's own follow-up (the corpus moved to `test/fixtures/` and the accessor gained a consumer). Listed here so the removal in the baseline diff is not read as a silent shrink. |
| `files scripts/render-session-cookie-report.mjs` | #438 (session cookie contract) landed on `release-0-6-3`; a one-off verification report script, so it is #438's debt, not this gate's. |

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
