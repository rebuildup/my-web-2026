# Development data source — verification (Issue #377)

The two artefacts below photograph the development data-source
indicator of the home page, in the two states the issue names. They
are the visible half of the contract; the enforcement half lives in
the suites named at the end.

## The artefacts

| File | State | How it was captured |
| --- | --- | --- |
| `mock-source.png` / `mock-source.webp` | `Mock data` — the boundary answers from canned fixtures | `pnpm dev:mock`, live dev server |
| `production-readonly-source.png` / `production-readonly-source.webp` | `Production-readonly mode` — every write refused | `pnpm dev:read-only-guard`, live dev server |

Both were captured with
`node scripts/capture-dev-data-source.mjs --mode=<mode>`. The script
starts the dev server with the same command an operator uses, reads
the rendered indicator, and REFUSES to write an artefact whose
source or write policy does not match the expected state.

## Why the production-readonly shot was taken with local bindings

`pnpm dev:production-data` points the bindings at the production
resources, which requires a Cloudflare remote session (a temporary
edge-preview session for the account). The development environment's
API token cannot create that session — the edge-preview API answers
`403` for it — so the remote mode could not be exercised in the
capture environment.

The capture therefore uses `pnpm dev:read-only-guard`: the write
policy is the production one (every write is refused, with the stable
code `production_readonly_write_refused`), and the bindings stay
local, so the numbers behind the indicator are local ones. The
indicator states this on its face — "the bindings stayed local (the
remote session was not established)" — so the artefact does not claim
more than it shows.

Photographing the remote mode is an operator action: authenticate with
`wrangler login`, or grant the development token the permission the
edge-preview API requires, then run
`node scripts/capture-dev-data-source.mjs --mode=production-data`
once the remote mode is reachable.

## Format

Issue #377 names PNG paths; this repository commits its verification
screenshots as WebP (Issue #495 and later). Both are written, so the
issue's paths exist and the repository convention is kept.

## What enforces the contract

- `test/integration/dev-data-source.test.ts` — the write refusal on
  the external boundary, the reads that keep working, the admin
  guard, and the agreement between the configuration's vocabulary and
  the runtime's.
- `src/cloudflare/data-source.test.ts` — the mode resolution, the
  fail-closed behaviour on an unrecognised value, and the write
  policy.
- `docs/runbook/development-data-source.md` — the operator contract.
