import { createServerFn } from '@tanstack/react-start';
import biomeJson from '../../../biome.json?raw';
import packageJson from '../../../package.json';
import profileYaml from '../../../quality/profile.yaml?raw';
import { extractBiomeSettings } from './biome-facts';
import { parseProfileStack } from './profile-stack';
import { type StackPageData, resolveStackSections } from './resolve';
import { STACK_SECTIONS } from './stack';

/**
 * `/stack` loader (Issue #381).
 *
 * The article data (`stack.ts`) is committed copy; the VERSIONS are
 * not. This module reads the live repository sources and resolves
 * every item's version reference through `resolve.ts`, on the
 * server, so the page can never display a version literal that
 * drifted from `package.json` / `quality/profile.yaml`:
 *
 *   - `profile:<key>` reads the `stack:` block of
 *     `quality/profile.yaml` (`?raw` import — the file is the
 *     declared contract, parsed by `profile-stack.ts`);
 *   - `npm:<name>` reads the declared spec in `package.json`
 *     (`dependencies` first, then `devDependencies`);
 *   - `packageManager` reads `package.json#packageManager`.
 *
 * A reference that resolves to nothing becomes `undetermined` and
 * the page renders 「未確定」 — the loader never substitutes a
 * guessed value.
 *
 * Everything that touches a repository file lives INSIDE the
 * handler: the TanStack Start compiler keeps handler code
 * server-side, so `package.json` and the `?raw` profile text never
 * reach the client bundle — the browser receives only the resolved
 * `StackPageData`.
 */
export const getStackPageData = createServerFn({ method: 'GET' }).handler(
	async (): Promise<StackPageData> => {
		const dependencies = packageJson.dependencies as Record<string, string> | undefined;
		const devDependencies = packageJson.devDependencies as Record<string, string> | undefined;
		const npmSpec = (name: string): string | null =>
			dependencies?.[name] ?? devDependencies?.[name] ?? null;

		return resolveStackSections(STACK_SECTIONS, {
			profileStack: parseProfileStack(profileYaml),
			npmSpec,
			packageManager:
				typeof packageJson.packageManager === 'string' ? packageJson.packageManager : null,
			// Issue #382: the Biome settings table is read from the
			// committed `biome.json` itself (`?raw`, parsed by
			// `biome-facts.ts`), so the page can never show a stale
			// hand-copied value. `null` → the item renders no table.
			biomeSettings: extractBiomeSettings(biomeJson) ?? undefined,
		});
	},
);
