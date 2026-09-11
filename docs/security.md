# Security

> Security maintenance workflow for my-web-2026. Operational detail
> lives in [`skills/security-maintenance/SKILL.md`](../skills/security-maintenance/SKILL.md).

## Reporting a vulnerability

- Critical issues: contact the repository owner out-of-band. Do not
  file a public GitHub Issue.
- Non-critical issues: open a GitHub Issue with the `security`
  label. Keep exploit specifics minimal until triage confirms the
  report.

## Triage workflow

1. Detect from one of:
   - Official Cloudflare, TanStack, Hono, Panda, Vite, Wrangler
     advisory feed.
   - `npm audit` output.
   - GitHub Security Advisories.
   - Manual review.
2. Triage: package + version + reachability + exposure + required
   privilege + impact.
3. Prioritise (P0–P3) per
   [`skills/security-maintenance/SKILL.md`](../skills/security-maintenance/SKILL.md).
4. Open a GitHub Issue tagged `security`, target a release.
5. Implement the fix in a normal ticket branch
   (`<issue-number>`) or a patch release branch.
6. Run `pnpm run validate:release`.
7. Land via the canonical release PR flow.

## Inventory at 0.1.0

| Package                     | Pinned version | Notes                        |
| --------------------------- | -------------- | ---------------------------- |
| `wrangler`                  | `^4.131.0`     | Cloudflare Workers toolchain |
| `@cloudflare/vite-plugin`   | `^1.0.0`       | Vite <-> Workers bundling    |
| `@cloudflare/vitest-plugin` | `^1.0.0`       | Worker smoke (deferred)      |
| `@tanstack/react-start`     | `^1.168.52`    | Framework                    |
| `@tanstack/react-router`    | `^1.168.52`    | Framework                    |
| `hono`                      | `^4.13.7`      | External HTTP boundary       |
| `@pandacss/dev`             | `^1.12.1`      | Styling                      |
| `vite`                      | `^7.1.0`       | Bundler                      |
| `vitest`                    | `~4.1.0`       | Test runner                  |
| `react` / `react-dom`       | `^19.2.0`      | UI runtime                   |
| `typescript`                | `^5.9.0`       | Language                     |

## Automated checks

- Secret scanning: enabled as an asynchronous CI job (see
  `quality/profile.yaml#security_gates.secret_scanning`).
- Dependency review: deferred to a post-0.1.0 ticket.
- Code scanning (SAST): deferred.
- Container scanning: not applicable (no `Containerfile` at 0.1.0).
- SBOM: deferred.

When enabled checks surface a finding, the finding is triaged as
above; it is not auto-rejected merely because it appeared.

## Sensitive disclosures

Out-of-band contact is preferred for:

- Credential leaks in CI secrets or `.dev.vars`.
- Live site exploitation that is observable today.
- Coordinated disclosure windows.

If you find a leaked credential, assume it is compromised. Revoke
and rotate immediately. Do not wait for the patch release.
