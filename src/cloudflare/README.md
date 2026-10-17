# Cloudflare obligation

This directory owns Cloudflare-specific runtime behavior that has an
independent change reason from any page or capability.

- `health.ts` probes D1 / R2 and exposes only a public-safe status.
- `media-visibility.ts` owns which R2 keys may be served from the
  public delivery surface (Issue #459). The `MEDIA` bucket is served
  by a public R2 custom domain, so a key that exists is a key anyone
  can fetch; this module is the single rule every delivery path
  consults, plus the gated delivery adapter and the enumeration-safe
  listing walk. See `docs/security/r2-media-visibility.md`.
- Home may consume that status, but Home does not own binding behavior.
- New Cloudflare helpers belong here only when they are governed by the
  Cloudflare runtime contract rather than by one feature.
