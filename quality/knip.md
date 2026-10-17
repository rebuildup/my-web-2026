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

## Fixtures

`scripts/check-knip.test.mjs` builds a synthetic project in an OS temp dir that
declares an unused dependency and an unused export and asserts
`scripts/check-knip.mjs --root <fixture>` exits non-zero (and exits zero
once both findings are removed). This is the CI failure proof required
by Issue #531.