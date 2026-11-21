import type { StackFactRef, StackFactRow, StackItem, StackSection, StackVersionRef } from './stack';

/**
 * Pure version-resolution for the `/stack` page (Issue #381).
 *
 * This module holds NO imports of repository files: the caller
 * (`load.ts`) injects the already-read sources — the parsed
 * `quality/profile.yaml` `stack:` map, the `package.json` spec
 * lookup, and the `packageManager` field — so the resolution rules
 * are unit-testable without a Worker or a Vite `?raw` import.
 *
 * The contract (see `stack.ts`): a reference that resolves to
 * nothing becomes `undetermined`, never a guessed value.
 */

/** Resolved version state for one item. */
export interface StackVersionView {
	readonly state: 'resolved' | 'none' | 'undetermined';
	/** The display label when `state` is `resolved`; otherwise `null`. */
	readonly label: string | null;
}

/** An item with its version resolved — what the page renders. */
export interface StackItemView extends Omit<StackItem, 'version' | 'facts'> {
	readonly version: StackVersionView;
	/**
	 * Resolved fact-table rows (Issue #382). Present only when the
	 * item declared `facts` AND the source produced rows; absent
	 * means "nothing truthful to show" — the page renders no table.
	 */
	readonly settings?: readonly StackFactRow[];
}

/** A section with resolved items. */
export interface StackSectionView extends Omit<StackSection, 'items'> {
	readonly items: readonly StackItemView[];
}

export interface StackPageData {
	readonly sections: readonly StackSectionView[];
}

/** The repository sources the resolution reads. */
export interface StackFactSources {
	/** `quality/profile.yaml` `stack:` map (see `profile-stack.ts`). */
	readonly profileStack: Readonly<Record<string, string>>;
	/** `package.json` spec lookup: dependencies first, then devDependencies. */
	readonly npmSpec: (name: string) => string | null;
	/** `package.json#packageManager`, e.g. `pnpm@12.3.4`. */
	readonly packageManager: string | null;
	/**
	 * `biome.json` settings rows already extracted by
	 * `biome-facts.ts` (Issue #382); `undefined`/`null` when the file
	 * yielded nothing reportable — the `biomeJson` fact then resolves
	 * to no table.
	 */
	readonly biomeSettings?: readonly StackFactRow[] | null;
}

/**
 * Reduce a declared `name@range` value to its version part.
 * `tanstack-start@1.168.x` → `1.168.x`,
 * `'@cloudflare/vitest-plugin@1.1.x'` → `1.1.x`. The LAST `@`
 * separates name from range, which is also correct for scoped
 * package names.
 */
export function versionPart(declared: string): string {
	const at = declared.lastIndexOf('@');
	return at === -1 ? declared : declared.slice(at + 1);
}

/** Resolve one item's version reference against the injected sources. */
export function resolveVersion(ref: StackVersionRef, sources: StackFactSources): StackVersionView {
	switch (ref.kind) {
		case 'none':
			return { state: 'none', label: null };
		case 'undetermined':
			return { state: 'undetermined', label: null };
		case 'packageManager':
			return sources.packageManager
				? { state: 'resolved', label: versionPart(sources.packageManager) }
				: { state: 'undetermined', label: null };
		case 'npm': {
			const spec = sources.npmSpec(ref.name);
			return spec === null
				? { state: 'undetermined', label: null }
				: { state: 'resolved', label: spec };
		}
		case 'profile': {
			const declared = sources.profileStack[ref.key];
			return declared === undefined
				? { state: 'undetermined', label: null }
				: { state: 'resolved', label: versionPart(declared) };
		}
	}
}

/**
 * Resolve one item's fact reference against the injected sources.
 * Same fail-closed contract as {@link resolveVersion}: a source that
 * produced nothing yields `undefined`, and the page omits the table.
 */
export function resolveFacts(
	ref: StackFactRef,
	sources: StackFactSources,
): readonly StackFactRow[] | undefined {
	switch (ref.kind) {
		case 'biomeJson':
			return sources.biomeSettings ?? undefined;
	}
}

function resolveItem(item: StackItem, sources: StackFactSources): StackItemView {
	const { version: ref, facts: factRef, ...rest } = item;
	const settings = factRef === undefined ? undefined : resolveFacts(factRef, sources);
	return {
		...rest,
		version: resolveVersion(ref, sources),
		...(settings === undefined ? {} : { settings }),
	};
}

function resolveSection(section: StackSection, sources: StackFactSources): StackSectionView {
	const { items, ...rest } = section;
	return { ...rest, items: items.map((item) => resolveItem(item, sources)) };
}

/** Resolve every section's items — the loader's whole job. */
export function resolveStackSections(
	sections: readonly StackSection[],
	sources: StackFactSources,
): StackPageData {
	return { sections: sections.map((section) => resolveSection(section, sources)) };
}
