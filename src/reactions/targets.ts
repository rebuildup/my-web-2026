/**
 * Reaction target registry — the opt-in allowlist of pages that may
 * host the emoji reactions widget.
 *
 * Each target key is an opaque string registered here. The home page
 * uses `'home-page'` (legacy constant kept for backward compatibility).
 * Other pages opt in by adding their key to this registry and using
 * the same key when calling the reactions server functions.
 *
 * The registry is the single source of truth for:
 * - Validation: the HTTP boundary and server functions reject
 *   reactions for unregistered targets.
 * - Privacy: the data lifecycle entries cover all targets uniformly.
 * - UI: a page that wants reactions imports its key from here.
 *
 * Do NOT derive target keys from URLs at runtime — that would allow
 * fabricated targets. The key is a configuration decision, not a
 * derivation.
 */

export interface ReactionTarget {
	/** Opaque key used in the `reactions.target_key` column. */
	key: string;
	/** Human-readable label for admin/diagnostics. */
	label: string;
	/** Whether this target is currently active. Inactive targets
	 *  reject reads and writes at the API boundary. */
	enabled: boolean;
}

/** Registry of all known reaction targets. */
export const REACTION_TARGETS: readonly ReactionTarget[] = [
	{
		key: 'home-page',
		label: 'Home page',
		enabled: true,
	},
	{
		key: 'portfolio-list',
		label: 'Portfolio list',
		enabled: true,
	},
	{
		key: 'about-page',
		label: 'About page',
		enabled: true,
	},
	{
		key: 'contact-page',
		label: 'Contact page',
		enabled: true,
	},
	{
		key: 'projects-dotfiles',
		label: 'dotfiles introduction',
		enabled: true,
	},
	{
		key: 'tools-index',
		label: 'Tools index',
		enabled: true,
	},
] as const;

/** Fast lookup by key. */
export const REACTION_TARGETS_BY_KEY: ReadonlyMap<string, ReactionTarget> = new Map(
	REACTION_TARGETS.map((t) => [t.key, t]),
);

/**
 * Check whether a target key is registered and enabled.
 * Used by the HTTP boundary and server functions for validation.
 */
export function isValidReactionTarget(key: string): boolean {
	const target = REACTION_TARGETS_BY_KEY.get(key);
	return target?.enabled ?? false;
}

/**
 * Get the target metadata for a registered key.
 * Returns `null` for unknown or disabled keys.
 */
export function getReactionTarget(key: string): ReactionTarget | null {
	const target = REACTION_TARGETS_BY_KEY.get(key);
	if (target === undefined || !target.enabled) return null;
	return target;
}

/**
 * Get all enabled target keys. Used for diagnostics and admin surfaces.
 */
export function getEnabledReactionTargetKeys(): readonly string[] {
	return REACTION_TARGETS.filter((t) => t.enabled).map((t) => t.key);
}

/** Legacy constant for backward compatibility with existing home code. */
export const HOME_REACTIONS_TARGET = 'home-page';
