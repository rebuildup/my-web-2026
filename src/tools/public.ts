import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { evaluateToolEmbedPolicy, toEmbedSubject } from './embed-policy';
import type { EmbedViolation, ToolHostMessageDeclaration } from './embed-policy';
import { evaluateEmbedPrivacy, toPrivacySubject } from './embed-privacy';
import type { EmbedPrivacyViolation } from './embed-privacy';
import { getPublicTool, getTool, listAllTools, resolveToolEntryHtml } from './registry';
import type { PublicToolSummary } from './registry';

/**
 * TanStack Start server-function surface for the Tool Registry —
 * PUBLIC ONLY (Issue #1005/#1009).
 *
 * The manifest (`src/tools/manifest.json`) is operator data: repo
 * paths, pinned SHAs, build commands, `notes` provenance and
 * `delivery.privacy.basis` all name internals a visitor cannot act
 * on. `src/tools/registry.ts` value-imports it, so ANY client-reachable
 * module that value-imports the registry ships the whole manifest in
 * the public JS bundle — the same defect class Issue #836 fixed for
 * `$_TSR` loader payloads, one layer down. Every public read of the
 * registry therefore goes through a `createServerFn` boundary here:
 * the handler (and its exclusive imports) never reach the client
 * bundle, exactly like `src/portfolio/public.ts` keeps the Notion
 * snapshot server-side.
 *
 * Payload contract — the loader boundary is drawn on the DATA, not
 * on the JSX (the rule `tools.$slug.tsx` already states for
 * `host_disabled`):
 *
 *   - `/tools` index entries carry `slug` / `display_name` /
 *     `description_ja` only.
 *   - `/tools/<slug>` states carry the fields that state renders:
 *     `embeddable` gets the RESOLVED frame `src` plus the optional
 *     host-message contract (iframe attributes are already flattened
 *     into `PublicToolSummary`); `blocked` gets identity + violation
 *     codes; `disabled` gets identity + `description_ja`.
 *   - `source`, `build`, `notes`, `classification`, `license`,
 *     `delivery.privacy.basis` and every other manifest field stay
 *     server-side.
 */

/** The only manifest fields a `/tools` card may serialize. */
export interface ToolIndexEntry {
	readonly slug: string;
	readonly display_name: string;
	readonly description_ja: string;
}

/** The only manifest fields a `blocked` page may serialize. */
export interface BlockedToolView {
	readonly slug: string;
	readonly display_name: string;
}

/** The only manifest fields an `embeddable` page may serialize. */
export interface EmbeddableToolView {
	readonly slug: string;
	readonly display_name: string;
	readonly src: string;
	readonly host_message?: ToolHostMessageDeclaration;
}

/** The only manifest fields a `host_disabled` page may serialize. */
export interface DisabledToolView {
	readonly slug: string;
	readonly display_name: string;
	readonly description_ja: string;
}

export type ToolPageData =
	| {
			readonly state: 'embeddable';
			readonly tool: EmbeddableToolView;
			readonly public: PublicToolSummary;
	  }
	| {
			readonly state: 'blocked';
			readonly tool: BlockedToolView;
			readonly violations: readonly EmbedViolation[];
			readonly privacyViolations: readonly EmbedPrivacyViolation[];
	  }
	| {
			readonly state: 'disabled';
			readonly tool: DisabledToolView;
	  }
	| { readonly state: 'missing' };

const SlugParamSchema = z.object({ slug: z.string().min(1).max(256) });

function toIndexEntry(tool: {
	readonly slug: string;
	readonly display_name: string;
	readonly description_ja: string;
}): ToolIndexEntry {
	return {
		slug: tool.slug,
		display_name: tool.display_name,
		description_ja: tool.description_ja,
	};
}

/**
 * The `/tools` index split: embeddable-kind entries under `available`,
 * `host_disabled` entries under `planned`. The kind decision stays
 * server-side; the client receives only card fields.
 */
export const listToolIndexEntries = createServerFn({ method: 'GET' }).handler(() => {
	const all = listAllTools();
	const bySlug = (a: { slug: string }, b: { slug: string }) => a.slug.localeCompare(b.slug);
	return {
		available: all
			.filter((tool) => tool.delivery.kind !== 'host_disabled')
			.sort(bySlug)
			.map(toIndexEntry),
		planned: all
			.filter((tool) => tool.delivery.kind === 'host_disabled')
			.sort(bySlug)
			.map(toIndexEntry),
	};
});

/**
 * The `/tools/<slug>` state machine, moved behind the server boundary
 * wholesale: slug tolerance, embed-policy evaluation, the third-party
 * contact contract, the public-summary lookup and every view
 * projection. `missing` covers both "no such slug" and "a delivery
 * kind the route does not serve" — the route maps it to `notFound()`.
 */
export const loadToolPage = createServerFn({ method: 'GET' })
	.validator(SlugParamSchema)
	.handler(({ data }): ToolPageData => {
		// Display-case tolerance lives here now: the manifest schema is
		// lowercase-only, so this is purely a URL-input concession —
		// the canonical slug remains lowercase (ADR-0017 §6.4).
		const slug = data.slug.toLowerCase();
		const tool = getTool(slug);
		if (!tool) return { state: 'missing' };

		const violations = evaluateToolEmbedPolicy(toEmbedSubject(tool.slug, tool.delivery));
		const privacy = evaluateEmbedPrivacy(toPrivacySubject(tool.slug, tool.delivery));
		const publicTool = getPublicTool(slug);
		if (violations.length > 0 || privacy.violations.length > 0) {
			return {
				state: 'blocked',
				tool: { slug: tool.slug, display_name: tool.display_name },
				violations,
				privacyViolations: privacy.violations,
			};
		}
		if (publicTool) {
			return {
				state: 'embeddable',
				tool: {
					slug: tool.slug,
					display_name: tool.display_name,
					src: resolveToolEntryHtml(tool),
					host_message:
						tool.delivery.kind === 'host_disabled' ? undefined : tool.delivery.host_message,
				},
				public: publicTool,
			};
		}
		if (tool.delivery.kind === 'host_disabled') {
			return {
				state: 'disabled',
				tool: {
					slug: tool.slug,
					display_name: tool.display_name,
					description_ja: tool.description_ja,
				},
			};
		}
		return { state: 'missing' };
	});
