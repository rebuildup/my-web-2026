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
 * resolved pairs as props and renders them.
 *
 * Since Issue #764 the ink on a colour field is itself a token
 * (`mono.ink.onColour`), so the client no longer CHOOSES an ink. The
 * client bundle keeps the *contrast arithmetic* only as verification:
 * the section prints the measured ratio next to the token it painted,
 * so a token that drifted away from its field would show a number
 * below the minimum instead of silently looking fine.
 *
 * The rendered HTML is unchanged by this split: the same hex values
 * reach the same elements in the same order.
 *
 * The resolution keeps the Issue #290 audit rule — a semantic token
 * that declares no `_dark` binding, or an unknown path, throws here
 * rather than rendering an empty swatch.
 */

export type DesignSystemFamilyId = 'design' | 'code' | 'writing';

/** One raw palette step of a classification family. */
export interface DesignSystemRampStep {
	/** The palette step name, e.g. `500`. */
	step: string;
	/** The resolved hex for that step. */
	hex: string;
}

export interface DesignSystemFamilyToken {
	/** `design` / `code` / `writing` — the classification id. */
	id: DesignSystemFamilyId;
	/** The semantic token path the non-text identifier mark paints. */
	token: string;
	/** The resolved light value of the semantic mark token. */
	lightHex: string;
	/** The resolved dark value of the semantic mark token. */
	darkHex: string;
	/**
	 * The vivid FIELD value — the resolved `accent.field.<id>` token
	 * (Issue #764, approved 2026-11-04).
	 *
	 * `accent.category.*` binds the 700 step in the light appearance
	 * because a small mark on the ground has to clear 3 : 1, and the 500
	 * / 600 steps of the cyan and yellow families do not. A colour field
	 * that is large enough to be its own surface has the opposite
	 * problem: the 700 step is dark and muddy across a wide area.
	 * `accent.field.*` is the approved token for that case — the family's
	 * 500 step with a monochrome ink placed on it
	 * (`mono.ink.onColour`). The contrast of that pairing is measured by
	 * `scripts/check-a11y-contrast.mjs`, not by this file.
	 */
	fieldHex: string;
	/** The semantic token path the field paints (`accent.field.<id>`). */
	fieldToken: string;
	/** The family's raw ramp, low → high, so the ladder is legible. */
	ramp: DesignSystemRampStep[];
}

/**
 * One role of the monochrome layer (Issue #764, direction B), resolved
 * for both appearances. The section renders the ladder so the ground a
 * colour field sits on is visible rather than implied.
 */
export interface DesignSystemMonoRole {
	/** The semantic path, e.g. `mono.surface.ground`. */
	path: string;
	/** The role's Japanese label. */
	label: string;
	/** Which family of role this is — a surface, a line, or an ink. */
	group: 'surface' | 'line' | 'ink';
	/** The resolved light value. */
	lightHex: string;
	/** The resolved dark value. */
	darkHex: string;
}

export interface DesignSystemTokenPair {
	/** The semantic path, e.g. `accent.category.design`. */
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
	/** The monochrome layer, in role order. */
	monoRoles: DesignSystemMonoRole[];
	/**
	 * The monochrome ink PLACED ON a colour field (Issue #764). A
	 * coloured surface never chooses its ink per render: it uses
	 * `mono.ink.onColour`. The value is resolved on the server so the
	 * section paints the token's value, not a hand-written hex.
	 */
	onColourHex: string;
	/** The counterpart for a deep field (`mono.ink.onColourInverse`). */
	onColourInverseHex: string;
}

/**
 * The monochrome roles the section shows, in the order the comparison
 * harness used (surfaces → lines → ink). `label` is the Japanese role
 * name from `docs/verification/design/direction-comparison-0-8-1.md` §3.
 */
const MONO_ROLES = [
	{ path: 'mono.surface.ground', label: 'ページ地', group: 'surface' },
	{ path: 'mono.surface.sunken', label: '沈んだ面', group: 'surface' },
	{ path: 'mono.surface.raised', label: '上がった面', group: 'surface' },
	{ path: 'mono.surface.control', label: '押せる面', group: 'surface' },
	{ path: 'mono.surface.inverse', label: '反転地', group: 'surface' },
	{ path: 'mono.surface.disabled', label: '無効な面', group: 'surface' },
	{ path: 'mono.line.hairline', label: 'hairline 罫線', group: 'line' },
	{ path: 'mono.line.rule', label: '強い罫線', group: 'line' },
	{ path: 'mono.ink.text', label: '本文', group: 'ink' },
	{ path: 'mono.ink.secondary', label: '副次文字', group: 'ink' },
	{ path: 'mono.ink.muted', label: '補助文字', group: 'ink' },
	{ path: 'mono.ink.disabled', label: '無効な文字', group: 'ink' },
	{ path: 'mono.ink.inverse', label: '反転文字', group: 'ink' },
	{ path: 'mono.ink.onColour', label: '色面に載る墨', group: 'ink' },
] as const;

/**
 * The three classification families that are shown AS COLOUR (Issue
 * #812). `tool` keeps its token — it is in the ledger — but it is not
 * a colour field.
 */
const FAMILY_PATHS = [
	{
		id: 'design',
		token: 'accent.category.design',
		field: 'accent.field.design',
		palette: 'design',
	},
	{ id: 'code', token: 'accent.category.code', field: 'accent.field.code', palette: 'code' },
	{
		id: 'writing',
		token: 'accent.category.writing',
		field: 'accent.field.writing',
		palette: 'writing',
	},
] as const;

/**
 * The raw steps the ramp row shows for every family, low → high. They
 * are the five steps the palette actually declares for each
 * classification family, so the row is the whole family rather than a
 * selection from it.
 */
const RAMP_STEPS = ['50', '300', '500', '600', '700'] as const;

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
	// Monochrome layer (mono.*) — Issue #764, direction B.
	'mono.surface.ground',
	'mono.surface.sunken',
	'mono.surface.raised',
	'mono.surface.control',
	'mono.surface.inverse',
	'mono.surface.disabled',
	'mono.line.hairline',
	'mono.line.rule',
	'mono.ink.text',
	'mono.ink.secondary',
	'mono.ink.muted',
	'mono.ink.disabled',
	'mono.ink.inverse',
	'mono.ink.onColour',
	'mono.ink.onColourInverse',
	// Accent features (accent.*)
	'accent.surface',
	'accent.interactive',
	// Category accents (accent.category.*)
	'accent.category.design',
	'accent.category.code',
	'accent.category.writing',
	'accent.category.tool',
	// Classification fields (accent.field.*) — Issue #764, approved
	// 2026-11-04.
	'accent.field.design',
	'accent.field.code',
	'accent.field.writing',
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

/**
 * Resolve a raw palette reference to its hex.
 *
 * The reference may be any depth: `design.500` for the family ramps,
 * `mono.light.ground` for the monochrome layer. It walks
 * `rawTokens.colors` segment by segment and throws on an unknown path
 * or on a node that is not a leaf (`{ value }`), so a typo is a failure
 * here rather than an empty swatch in the DOM.
 */
function resolveHex(ref: string): string {
	let node: unknown = rawTokens.colors;
	for (const segment of ref.split('.')) {
		if (!node || typeof node !== 'object' || !(segment in node)) {
			throw new Error(`Unknown raw color reference: ${ref}`);
		}
		node = (node as Record<string, unknown>)[segment];
	}
	const value = (node as { value?: unknown }).value;
	if (typeof value !== 'string') {
		throw new Error(`Raw color reference does not resolve to a hex value: ${ref}`);
	}
	return value;
}

function resolvePair(path: string): { lightHex: string; darkHex: string } {
	const { lightRef, darkRef } = resolveSemanticRefs(path);
	return { lightHex: resolveHex(lightRef), darkHex: resolveHex(darkRef) };
}

function resolveRamp(family: 'design' | 'code' | 'writing'): DesignSystemRampStep[] {
	return RAMP_STEPS.map((step) => ({ step, hex: resolveHex(`${family}.${step}`) }));
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
			fieldHex: resolvePair(family.field).lightHex,
			fieldToken: family.field,
			ramp: resolveRamp(family.palette),
		})),
		ledger: LEDGER_PATHS.map((path) => ({ path, ...resolvePair(path) })),
		monoRoles: MONO_ROLES.map((role) => ({ ...role, ...resolvePair(role.path) })),
		// A colour field keeps the same step in both appearances, so the
		// ink placed on it does too: `onColour` resolves to #101012 in
		// light and #0a0a0c in dark, and the light value is the one the
		// field is painted against in either appearance.
		onColourHex: resolvePair('mono.ink.onColour').lightHex,
		onColourInverseHex: resolvePair('mono.ink.onColourInverse').lightHex,
	}),
);
