# Cloudflare obligation

This directory owns Cloudflare-specific runtime behavior that has an
independent change reason from any page or capability.

- `health.ts` probes D1 / R2 and exposes only a public-safe status.
- Home may consume that status, but Home does not own binding behavior.
- New Cloudflare helpers belong here only when they are governed by the
  Cloudflare runtime contract rather than by one feature.
