/**
 * Module resolution hook that makes `wrangler` genuinely unresolvable.
 *
 * Loaded via `node --import ./scripts/_no-wrangler-hook.mjs`. Any
 * specifier that names wrangler fails to resolve, exactly as it would
 * after the dependency is removed from `package.json`.
 *
 * The point is to make the test a real load test rather than a grep.
 * A declaration like
 *
 *     const WRANGLER_BIN = join(dirname(require.resolve('wrangler/package.json')), …)
 *
 * is not a Wrangler *call* — it resolves at module load, before any
 * argument parsing and before any write gate. Grepping for invocations
 * misses it entirely; importing under this hook does not.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// `import.meta.resolve` already yields a file:// URL; wrapping it again
// would produce a `file:///…/file:///…` specifier that fails to resolve.
register(
	import.meta.resolve('./_no-wrangler-resolver.mjs'),
	pathToFileURL(`${import.meta.dirname}/`),
);
