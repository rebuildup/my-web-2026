/**
 * Canonical Cloudflare resource identity (Issue #247, D1 slice).
 *
 * One source of truth, shared by `cloudflare.config.ts`, the D1
 * driver, and diagnostics. Previously every script rediscovered this
 * state on its own — some by parsing config files, some by shelling
 * out — and D1 was addressed by *name* or *binding* in several
 * places.
 *
 * This module deliberately exposes no functions that discover values
 * by regexing a config file. The values are declared here and
 * imported; `cloudflare.config.ts` binds to the same constants.
 * Identity must be greppable and reviewable, not inferred.
 *
 * Non-secret: every value here is visible in the public repository.
 */

export const ACCOUNT_ID = 'c6ab6651a5d4d6d0d07686bbd3c3d56f';
export const WORKER_NAME = 'my-web-2026';

/**
 * D1 is addressed by ID everywhere in this repository. `cf d1 ...`
 * REQUIRES the id and rejects names and binding names, so a name can
 * never silently stand in for the production database.
 */
export const D1_DATABASE_ID = 'd761ddb7-8179-48dd-855f-c8b7b2924bad';
/** Display name only. NEVER a valid argument to a cf D1 command. */
export const D1_DATABASE_NAME = 'my-web-2026';

export const R2_BUCKET_NAME = 'my-web-2026';

/** Canonical migration directory. */
export const MIGRATIONS_DIR = 'migrations';

/**
 * The single local persistence location (Issue #247, foundation slice).
 *
 * This is the whole Worker's local state — D1 AND R2 — not a D1-only
 * directory. The Vite dev server's `persistState` and every `cf ... --local`
 * command point here, so a local row or object written by a script is
 * visible in BOTH directions: script -> Worker and Worker -> script.
 * No script may invent its own `--persist-to`.
 *
 * Renamed from `LOCAL_D1_STATE_DIR` when the R2 adapter adopted the
 * same path; the old name understated what it holds.
 */
// The DIRECTORY name is historical — it predates the R2 adapter, which
// adopted the same path. Renaming it would silently discard every
// developer's local D1 rows, and nothing about a `.tmp/` path warrants
// that churn; the constant name is what carries the meaning.
export const LOCAL_STATE_DIR = '.tmp/d1state';
