/**
 * Resolver half of `_no-wrangler-hook.mjs`.
 *
 * Throws for any specifier that names wrangler, so a module-load
 * dependency on the removed package fails loudly instead of silently
 * working while the dependency is still installed.
 */

/** Bare `wrangler`, a deep import into it, and its config files. */
const FORBIDDEN = [
	/^wrangler(\/.*)?$/,
	/^.*[/\\]wrangler[/\\]package\.json$/,
	/^.*[/\\]wrangler\.production?\.jsonc$/,
];

export function resolve(specifier, context, nextResolve) {
	for (const pattern of FORBIDDEN) {
		if (pattern.test(specifier)) {
			const error = new Error(
				`refusing to resolve ${JSON.stringify(specifier)}: this repository must load with Wrangler absent`,
			);
			error.code = 'ERR_WRANGLER_RESOLUTION_FORBIDDEN';
			throw error;
		}
	}
	return nextResolve(specifier, context);
}
