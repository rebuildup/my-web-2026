/**
 * Client-side zod configuration for a CSP-safe runtime (Issue #447).
 *
 * zod 4 compiles object-schema fast paths with `new Function` and probes
 * `Function("")` at first parse. Both are reported by
 * `Content-Security-Policy-Report-Only` as `script-src` violations
 * (`blockedURI: eval`), even though the probe's throw is swallowed.
 * Adding `'unsafe-eval'` to the policy would hide that debt and make a
 * later enforcing CSP materially weaker, so the shipped client asks zod
 * for its non-JIT parser instead. Validation semantics are unchanged;
 * only the code-generation fast path is disabled.
 *
 * This module is imported FIRST by `src/client.tsx`, before the router
 * and route modules, so the global config is in place before any schema
 * parses during hydration. It is a browser-only entrypoint companion:
 * the Worker never imports it, and the Workerd runtime already skips
 * the eval probe for Cloudflare user agents.
 */
import { z } from 'zod';

z.config({ jitless: true });
