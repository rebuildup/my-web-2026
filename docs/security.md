# Security

> my-web-2026 security policy and current controls.

## Reporting vulnerabilities

- Open a GitHub Issue tagged `security`, target a release.
- Implement the fix in a normal ticket branch
  (`<issue-number>`) or a patch release branch.
- Run `pnpm run validate:release`.
- Land via the canonical release PR flow.

For urgent / out-of-band reports (live site exploitation, credential
leaks), contact the maintainer directly via the channel listed in
`CODEOWNERS` / repository Settings → Code security before opening a
public Issue. If you find a leaked credential, assume it is
compromised: revoke and rotate immediately. Do not wait for the
patch release.

## CSRF

TanStack Start's **default CSRF middleware** is the canonical
mutation-protection mechanism for server functions. It is enabled by
default because `src/start.ts` is intentionally absent — adding a
custom `startInstance` override would disable the default
middleware, so do not add one without an ADR.

External boundary handlers under `src/http/**` are not protected by
the default CSRF middleware; they are responsible for their own
authentication and origin checks per ADR-0002.

## Inventory at 0.1.0

| Package                     | Pinned version | Notes                                 |
| --------------------------- | -------------- | ------------------------------------- |
| `wrangler`                  | `^4.131.0`     | Cloudflare Workers toolchain          |
| `@cloudflare/vite-plugin`   | `^1.0.0`       | Vite <-> Workers bundling             |
| `@cloudflare/vitest-plugin` | `^1.0.0`       | Worker test pool (workerd)            |
| `@tanstack/react-start`     | `^1.168.52`    | Framework                             |
| `@tanstack/react-router`    | `^1.168.52`    | Router                                |
| `hono`                      | `^4.13.7`      | External HTTP boundary                |
| `@pandacss/dev`             | `^1.12.1`      | Styling                               |
| `@biomejs/biome`            | `^1.9.4`       | Format + lint                         |
| `vite`                      | `^7.1.0`       | Bundler                               |
| `vitest`                    | `~4.1.0`       | Test runner                           |
| `react` / `react-dom`       | `^19.2.0`      | UI runtime                            |
| `typescript`                | `^5.9.0`       | Language                              |

## Automated checks

- Secret scanning: enabled as an asynchronous CI job (see
  `quality/profile.yaml#security_gates.secret_scanning`).
- Dependency review: deferred to a post-0.1.0 ticket.
- Code scanning (SAST): deferred.
- Container scanning: not applicable (no `Containerfile` at 0.1.0).
