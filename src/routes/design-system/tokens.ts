import { createServerFn } from '@tanstack/react-start';
import { semanticTokens } from '../../editorial/semantic-tokens';
import { rawTokens } from '../../editorial/tokens';

/**
 * Server-side token resolution for the `/design-system` colour section
 * (Issue #812).
 *
 * Why this module exists
 * ----------------------
 * The colour section renders REAL hex values — the light / dark pair of
 * every semantic token, and the classification colours the colour
 * fields are painted with. Resolving a semantic path to its hex means
 * walking the semantic layer (`semantic-tokens.ts`) into the raw
 * palette (`tokens.ts`), and doing that in the browser meant shipping
 * BOTH objects — the whole raw palette plus the whole semantic layer —
 * in the `/design-system` route chunk (≈ 3.7 KB minified).
 *
 * That payload is not the section's content: the section shows 24
 * resolved hex pairs. Issue #812's colour section grew the route chunk
 * past its bundle budget, and the palette was the largest single item
 * in the delta even though it was already there before this Issue.
 *
 * So the resolution moved to the server. This module owns the
 * resolution; the route loader calls it; the section receives the
 * resolved pairs as props and renders them. The client bundle keeps
 * the *contrast arithmetic* (`pickInk` and its luminance helpers),
 * because the ink on a colour field is a rendering decision, not data.
 *
 * The rendered HTML is unchanged by this split: the same hex values
 * reach the same elements in the same order.
 *
 * The resolution keeps the Issue #290 audit rule — a semantic token
 * that declares no `_dark` binding, or an unknown path, throws here
 * rather than rendering an empty swatch.
 */

export type DesignSystemFamilyId = 'design' | 'code' | 'writing';

export interface DesignSystemFamilyToken {
	/** `design` / `code` / `writing` — the classification id. */
	id: DesignSystemFamilyId;
	/** The semantic token path the colour field paints. */
	token: string;
	/** The resolved light value. */
	lightHex: string;
	/** The resolved dark value (rendered as an inset). */
	darkHex: string;
}

export interface DesignSystemTokenPair {
	/** The semantic path, e.g. `accent.positive`. */
	path: string;
	/** The resolved light value. */
	lightHex: string;
	/** The resolved dark value. */
	darkHex: string;
}

export interface DesignSystemTokenData {
	/** The three classification colour fields, in editorial order. */
	families: DesignSystemFamilyToken[];
	/** The token ledger: every semantic token, in editorial order. */
	ledger: DesignSystemTokenPair[];
	/**
	 * The two inks a colour field may carry, in light-appearance
	 * values: the body ink (`text.default`) and the surface ink
	 * (`bg.surface`). The section measures them against each field
	 * and picks the one with the higher contrast.
	 */
	inkCandidates: [string, string];
}

/**
 * The three classification families that are shown AS COLOUR (Issue
 * #812). `tool` keeps its token — it is in the ledger — but it is not
 * a colour field.
 */
const FAMILY_PATHS = [
	{ id: 'design', token: 'accent.category.design' },
	{ id: 'code', token: 'accent.category.code' },
	{ id: 'writing', token: 'accent.category.writing' },
] as const;

/**
 * Every semantic token the ledger lists. The order is editorial, not
 * alphabetic — surface tokens first, then status, then category — and
 * it mirrors the table in `src/editorial/colors.md`.
 */
const LEDGER_PATHS = [
	// Page surfaces (bg.*)
	'bg.canvas',
	'bg.surface',
	'bg.subtle',
	'bg.accent',
	'bg.inverse',
	// Text (text.*)
	'text.default',
	'text.muted',
	'text.accent',
	'text.inverse',
	// Borders (border.*)
	'border.subtle',
	'border.strong',
	'border.focus',
	// Accent features (accent.*)
	'accent.surface',
	'accent.interactive',
	'accent.positive',
	'accent.negative',
	'accent.warning',
	// Category accents (accent.category.*)
	'accent.category.design',
	'accent.category.code',
	'accent.category.writing',
	'accent.category.tool',
] as const;

type SemanticLeaf = {
	value?: string | { base?: string; _dark?: string };
};

function rawRefFromSemanticValue(value: string): string {
	const match = /^\{colors\.([^}]+)\}$/.exec(value);
	if (!match) {
		throw new Error(`Unsupported semantic color reference: ${value}`);
	}
	return match[1];
}

/**
 * Resolve a semantic path to its raw palette reference in each
 * appearance. Both bindings are mandatory: Issue #290's audit rule is
 * that every semantic token carries a meaningful `_dark` value, and
 * this function is where that rule is enforced for the showcase.
 */
function resolveSemanticRefs(path: string): { lightRef: string; darkRef: string } {
	let node: unknown = semanticTokens.colors;
	for (const segment of path.split('.')) {
		if (!node || typeof node !== 'object' || !(segment in node)) {
			throw new Error(`Unknown semantic color token: ${path}`);
		}
		node = (node as Record<string, unknown>)[segment];
	}

	const value = (node as SemanticLeaf).value;
	if (!value || typeof value === 'string') {
		throw new Error(`Semantic color token must declare { base, _dark }: ${path}`);
	}
	if (!value.base || !value._dark) {
		throw new Error(`Semantic color token has no _dark binding: ${path}`);
	}

	return {
		lightRef: rawRefFromSemanticValue(value.base),
		darkRef: rawRefFromSemanticValue(value._dark),
	};
}

function resolveHex(ref: string): string {
	const [family, step] = ref.split('.');
	const palette = rawTokens.colors[family as keyof typeof rawTokens.colors] as
		| Record<string, { value: string }>
		| undefined;
	return palette?.[step as string]?.value ?? '';
}

function resolvePair(path: string): { lightHex: string; darkHex: string } {
	const { lightRef, darkRef } = resolveSemanticRefs(path);
	return { lightHex: resolveHex(lightRef), darkHex: resolveHex(darkRef) };
}

/**
 * Resolve every hex the colour section renders.
 *
 * A plain server function: the values are static (they come from the
 * committed token layer), so the work is trivial — but it keeps the
 * palette out of the browser bundle, which is what the `/design-system`
 * bundle budget measures.
 */
export const getDesignSystemTokenData = createServerFn({ method: 'GET' }).handler(
	(): DesignSystemTokenData => ({
		families: FAMILY_PATHS.map((family) => ({
			id: family.id,
			token: family.token,
			...resolvePair(family.token),
		})),
		ledger: LEDGER_PATHS.map((path) => ({ path, ...resolvePair(path) })),
		inkCandidates: [resolvePair('text.default').lightHex, resolvePair('bg.surface').lightHex],
	}),
);
