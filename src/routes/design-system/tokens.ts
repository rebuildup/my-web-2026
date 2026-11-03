import { createServerFn } from '@tanstack/react-start';
import { CONTENT_SIGNAL_FAMILIES, type ContentSignalFamily } from '../../editorial/content-signal';
import { semanticTokens } from '../../editorial/semantic-tokens';
import { rawTokens } from '../../editorial/tokens';

/**
 * Server-side token resolution for the `/design-system` colour section
 * (Issue #812, reshaped for Issue #764 direction B).
 *
 * Why this module exists
 * ----------------------
 * The colour section renders REAL hex values — the light / dark pair
 * of every role, and the content-hue families. Resolving a semantic
 * path to its hex means walking the semantic layer
 * (`semantic-tokens.ts`) into the raw palette (`tokens.ts`), and doing
 * that in the browser means shipping BOTH objects — the whole raw
 * palette plus the whole semantic layer — in the `/design-system`
 * route chunk.
 *
 * So the resolution lives on the server. The route loader calls the
 * server function; the section receives resolved pairs as props and
 * renders them. The client bundle keeps no palette and no raw token
 * object.
 *
 * The rendered HTML is unchanged by this split: the same hex values
 * reach the same elements.
 *
 * The resolution keeps the Issue #290 audit rule — a semantic token
 * that declares no `_dark` binding, or an unknown path, throws here
 * rather than rendering an empty swatch.
 */

export interface DesignSystemRoleToken {
	/** The semantic path, e.g. `surface.raised`. */
	path: string;
	/** What the role decides, in one line. */
	purpose: string;
	/** The resolved light value. */
	lightHex: string;
	/** The resolved dark value. */
	darkHex: string;
}

export interface DesignSystemContentFamily {
	/** The hue family id, e.g. `rose`. */
	id: ContentSignalFamily;
	/** The semantic path, e.g. `signal.content.rose`. */
	token: string;
	/** The resolved light value (text step, 700). */
	lightHex: string;
	/** The resolved dark value (text step, 300). */
	darkHex: string;
}

export interface DesignSystemTokenData {
	/**
	 * The monochrome roles, in reading order: the surface ladder, the
	 * text tiers, then the borders. These are what direction B calls
	 * the eleven monochrome roles (two text tiers are collapsed into
	 * `text.muted`, as documented in `semantic-tokens.ts`).
	 */
	monochrome: DesignSystemRoleToken[];
	/** The operation hue and the three status signals. */
	signals: DesignSystemRoleToken[];
	/** The content-derived hue families, in stable assignment order. */
	content: DesignSystemContentFamily[];
}

/**
 * Every monochrome role. Order is editorial, not alphabetic: the
 * surface ladder first (ground → recessed → raised → pressable →
 * inverse → feature), then text, then borders.
 */
const MONOCHROME_ROLES = [
	{ path: 'surface.canvas', purpose: 'ページの地。面の基準になる。' },
	{ path: 'surface.sunken', purpose: '地より一段沈んだ面。表の見出し・引用。' },
	{ path: 'surface.raised', purpose: '地より一段上がった面。カード・パネル。' },
	{ path: 'surface.control', purpose: '押せる面。境界線の代わりに塗りで示す。' },
	{ path: 'surface.inverse', purpose: '反転地。墨の面と白い文字が一組。' },
	{ path: 'surface.feature', purpose: 'わずかに色を帯びた注目面。大きな彩色にはしない。' },
	{ path: 'text.default', purpose: '本文。' },
	{ path: 'text.muted', purpose: '副次・補助の文字。' },
	{ path: 'text.disabled', purpose: '無効の文字。状態の外にある。' },
	{ path: 'text.inverse', purpose: '反転地に載る文字。' },
	{ path: 'text.accent', purpose: 'リンクの文字。暗所では明るくなる。' },
	{ path: 'border.divider', purpose: '構造の罫線。表の行など、意味がある場合だけ。' },
	{ path: 'border.strong', purpose: '強い罫線。非テキスト境界の 3:1 を満たす。' },
	{ path: 'border.focus', purpose: 'キーボードのフォーカス輪。' },
] as const;

/**
 * The signal roles that are not content-derived: one operation hue
 * and its pressed state, then the three status signals.
 */
const SIGNAL_ROLES = [
	{ path: 'signal.action', purpose: '操作の色。1 画面に 1 系統だけ。' },
	{ path: 'signal.actionActive', purpose: '操作の押下。action の一段濃い面。' },
	{ path: 'signal.positive', purpose: '状態: 正常。語と形を必ず併用する。' },
	{ path: 'signal.negative', purpose: '状態: 異常。語と形を必ず併用する。' },
	{ path: 'signal.warning', purpose: '状態: 注意。語と形を必ず併用する。' },
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
		monochrome: MONOCHROME_ROLES.map((role) => ({ ...role, ...resolvePair(role.path) })),
		signals: SIGNAL_ROLES.map((role) => ({ ...role, ...resolvePair(role.path) })),
		content: CONTENT_SIGNAL_FAMILIES.map((family) => {
			const token = `signal.content.${family}`;
			return { id: family, token, ...resolvePair(token) };
		}),
	}),
);
