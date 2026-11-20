import { css, cx } from '../../../styled-system/css';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { CATEGORY_SILHOUETTE_CLIP_PATH } from '../../editorial/primitives/StateMark';
import { VisitTrail } from './VisitTrail';
import type { GuideCategory, GuideEntry } from './ledger';
import { GUIDE_LEDGER } from './ledger';
import type { GuideRow } from './select';
import { selectGuideRows } from './select';

/**
 * Site guide — the "現在地マップ" section of the home page
 * (Issue #930, reworked for Issue #968, Epic #928).
 *
 * What it is
 * ----------
 * A wayfinding map, not a list: site facilities are stations on one
 * route line. Each node carries TWO meaning channels so colour is
 * never the only carrier (the same rule Issue #411 applied to the
 * portfolio card): the fill is the facility's content class
 * (`accent.category.*` — the semantic accent the editorial system
 * uses for classification) and the silhouette is that class's shape —
 * the SAME clip-paths `StateMark` draws for the category kinds
 * (diamond / square / stacked bars / chevron), imported from
 * `CATEGORY_SILHOUETTE_CLIP_PATH` so the guide and the portfolio card
 * can never drift into two vocabularies. A facility with no content
 * class gets a neutral capsule; explicitly chosen external bases sit
 * on a separate dashed spur as hollow rings — the spur visibly runs
 * THROUGH them, which is exactly what "this destination leaves the
 * site" means.
 *
 * Design rules (from the Epic + Issue #968)
 * ------------------------------------------
 *   - Meaningful structure only: the route line, the node shape and
 *     the hollow external marker carry the "current location" motif;
 *     there are no decorative routes, connectors or ambient
 *     animation.
 *   - Semantic colour as AREAS (Issue #968 owner directive
 *     2026-11-19): each station's content cell is a flat colour
 *     FIELD, not a white card with a coloured mark. A facility whose
 *     class has an approved field step (`design` / `code` /
 *     `writing`) sits on `accent.field.<class>` and reads through
 *     `mono.ink.onColour`; `tool` keeps its mark-only treatment
 *     (sunken panel + `accent.category.tool` node) because the
 *     canonical system deliberately approves no field step for it;
 *     a classless facility sits on `mono.surface.sunken`; the
 *     off-site spur sits on `mono.surface.inverse` so "this
 *     destination leaves the site" is a large-area statement, not
 *     only a dashed line. Colour still never carries meaning alone:
 *     every panel also shows its title and summary, shape and text
 *     survive greyscale, and the legend names every mark.
 *   - The route line and node keep their jobs: the node fill stays
 *     `accent.category.<class>` (the MARK step, 3:1 on the ground)
 *     with the shared `StateMark` silhouette, drawn in the rail
 *     OUTSIDE the panel so mark and field never merge into one
 *     blob.
 *   - No-JS safe: expansion is a native `<details>`/`<summary>`, so
 *     the whole guide works with scripting disabled and every link is
 *     reachable by keyboard and screen reader without extra ARIA.
 *   - Promotion emphasis is a badge, not a reorder: the featured
 *     facility keeps its authored position.
 *   - Colour stays inside the editorial system: the page ground
 *     stays monochrome; the only hues are the approved
 *     classification fields, and every ink on a field is a
 *     `mono.ink.*` token — identical to the rest of the page.
 */

/** The map grid: the site route on the left, the external spur on the right. */
const guideMapClassName = /*#__PURE__*/ css({
	display: 'grid',
	gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 1.6fr) minmax(0, 1fr)' },
	columnGap: { lg: '10' },
	rowGap: '8',
	alignItems: 'start',
});

const routeListClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexDirection: 'column',
	margin: '0',
	padding: '0',
	listStyle: 'none',
});

/**
 * One station row: a rail cell (the route line + the node) beside the
 * content cell. The rail stretches the full row height so adjacent
 * stations' line segments join into one continuous route.
 */
const stationClassName = /*#__PURE__*/ css({
	display: 'grid',
	gridTemplateColumns: '2rem minmax(0, 1fr)',
	columnGap: '3',
	paddingBlock: '5',
	'&:first-child': { paddingBlockStart: '0' },
	'&:last-child': { paddingBlockEnd: '0' },
});

/** The rail cell: position context for the line and the node. */
const railClassName = /*#__PURE__*/ css({
	position: 'relative',
	alignSelf: 'stretch',
});

/**
 * The route line, drawn as a zero-width element whose inline-start
 * border paints the 2 px segment. `top`/`bottom`/`height` variants
 * trim the segment so the line starts at the first node and ends at
 * the last node instead of overshooting the map.
 */
const lineBase = {
	position: 'absolute',
	insetInlineStart: 'calc(50% - 1px)',
	width: '0',
	borderInlineStartWidth: '2px',
	borderInlineStartColor: 'border.subtle',
} as const;

const lineFullClassName = /*#__PURE__*/ css({
	...lineBase,
	top: '0',
	bottom: '0',
	borderInlineStartStyle: 'solid',
});

const lineFromNodeClassName = /*#__PURE__*/ css({
	...lineBase,
	top: '2rem',
	bottom: '0',
	borderInlineStartStyle: 'solid',
});

const lineToNodeClassName = /*#__PURE__*/ css({
	...lineBase,
	top: '0',
	height: '2rem',
	borderInlineStartStyle: 'solid',
});

const lineFullExternalClassName = /*#__PURE__*/ css({
	...lineBase,
	top: '0',
	bottom: '0',
	borderInlineStartStyle: 'dashed',
});

const lineFromNodeExternalClassName = /*#__PURE__*/ css({
	...lineBase,
	top: '2rem',
	bottom: '0',
	borderInlineStartStyle: 'dashed',
});

const lineToNodeExternalClassName = /*#__PURE__*/ css({
	...lineBase,
	top: '0',
	height: '2rem',
	borderInlineStartStyle: 'dashed',
});

/**
 * Station nodes. Each variant is a COMPLETE class (position + size +
 * silhouette + fill) so no two css() declarations ever fight over
 * the same property — Panda atomic classes do not guarantee override
 * order, so composition-by-conflict is not an option here.
 *
 * Silhouette vocabulary — the SAME shapes `StateMark` draws for the
 * category family (diamond / square / stacked bars / chevron), applied
 * through `CATEGORY_SILHOUETTE_CLIP_PATH` as an inline `clipPath`:
 *   design   → diamond   (StateMark clip polygon)
 *   code     → square    (no clip — the element's own box)
 *   writing  → stacked bars (StateMark clip polygon)
 *   tool     → chevron   (StateMark clip polygon)
 *   neutral  → capsule   (a facility with no content class)
 *   external → hollow ring on the dashed spur (off this map)
 */
const nodePosition = {
	position: 'absolute',
	top: '1.7rem',
	insetInlineStart: '50%',
	transform: 'translateX(-50%)',
} as const;

const nodeBox = {
	width: '10px',
	height: '10px',
} as const;

const nodeDesignClassName = /*#__PURE__*/ css({
	...nodePosition,
	...nodeBox,
	backgroundColor: 'accent.category.design',
});

const nodeCodeClassName = /*#__PURE__*/ css({
	...nodePosition,
	...nodeBox,
	backgroundColor: 'accent.category.code',
});

const nodeWritingClassName = /*#__PURE__*/ css({
	...nodePosition,
	...nodeBox,
	backgroundColor: 'accent.category.writing',
});

const nodeToolClassName = /*#__PURE__*/ css({
	...nodePosition,
	...nodeBox,
	backgroundColor: 'accent.category.tool',
});

const nodeNeutralClassName = /*#__PURE__*/ css({
	...nodePosition,
	marginBlockStart: '3px',
	width: '12px',
	height: '5px',
	borderRadius: '999px',
	backgroundColor: 'border.strong',
});

const nodeExternalClassName = /*#__PURE__*/ css({
	...nodePosition,
	...nodeBox,
	borderRadius: '50%',
	borderWidth: '2px',
	borderStyle: 'solid',
	borderColor: 'text.muted',
	backgroundColor: 'transparent',
});

const NODE_CLASSNAMES: Record<GuideCategory, string> = {
	design: nodeDesignClassName,
	code: nodeCodeClassName,
	writing: nodeWritingClassName,
	tool: nodeToolClassName,
};

/**
 * The node's class plus its silhouette. The clip-path is inline for
 * the same reason `StateMark` sets its own inline: the polygons are
 * silhouette geometry owned by the primitive's contract, not design
 * tokens. `null` (the code square) needs no clip at all.
 */
function nodeFor(
	entry: GuideEntry,
	external: boolean,
): { className: string; clipPath: string | undefined } {
	if (external) return { className: nodeExternalClassName, clipPath: undefined };
	if (entry.category !== undefined) {
		return {
			className: NODE_CLASSNAMES[entry.category],
			clipPath: CATEGORY_SILHOUETTE_CLIP_PATH[entry.category] ?? undefined,
		};
	}
	return { className: nodeNeutralClassName, clipPath: undefined };
}

const facilityLinkClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'baseline',
	gap: '3',
	fontFamily: 'sans',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.3',
	letterSpacing: '-0.015em',
	color: 'text.default',
	textDecoration: 'none',
	_hover: { color: 'accent.interactive' },
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

const summaryClassName = /*#__PURE__*/ css({
	margin: '0',
	marginBlockStart: '1',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'text.muted',
	textWrap: 'pretty',
});

const featuredBadgeClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	paddingInline: '2',
	paddingBlock: '1',
	borderRadius: 'sm',
	backgroundColor: 'bg.accent',
	color: 'text.inverse',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '700',
	letterSpacing: '0.02em',
});

const childrenClassName = /*#__PURE__*/ css({
	margin: '0',
	marginBlockStart: '2',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
});

const detailsClassName = /*#__PURE__*/ css({
	margin: '0',
});

const summaryToggleClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
	padding: '1',
	marginInlineStart: '-1',
	borderRadius: 'sm',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.muted',
	cursor: 'pointer',
	_hover: { color: 'text.default' },
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
	// The disclosure triangle is the user agent's; we only hint the
	// expanded state through the marker's rotation-free text cue.
	'&::marker': { color: 'text.muted' },
});

const childLinkClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	paddingInlineStart: '5',
	paddingBlock: '2',
	textDecoration: 'none',
	borderInlineStartWidth: '2px',
	borderInlineStartStyle: 'solid',
	borderInlineStartColor: 'border.subtle',
	_hover: { borderInlineStartColor: 'border.strong' },
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

const childLabelClassName = /*#__PURE__*/ css({
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '600',
	color: 'text.default',
});

const externalMarkClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
	color: 'text.muted',
});

const externalGroupClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
});

const externalHeadingClassName = /*#__PURE__*/ css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '700',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

/**
 * Station field panels (Issue #968 owner directive 2026-11-19).
 *
 * The content cell of every station IS the colour area: a flat field
 * that carries the facility's classification as a large surface, not
 * a white card with a coloured mark. Three skins cover every case:
 *
 *   field   — `accent.field.<class>` for the three classes the
 *             canonical system approves a field step for; ink is
 *             `mono.ink.onColour` (the token made for exactly this).
 *   sunken  — `mono.surface.sunken` for `tool` (no approved field
 *             step — its class still shows through the mark) and
 *             for classless facilities; the ORIGINAL text/border
 *             classes are reused unchanged.
 *   inverse — `mono.surface.inverse` for the off-site spur, so
 *             "leaves the site" is a large-area statement in BOTH
 *             appearances (the panel inverts with the theme and
 *             `mono.ink.inverse` always contrasts it).
 *
 * Every panel class is COMPLETE (fill + edge + geometry) for the
 * same reason the node classes are: Panda atomic classes do not
 * guarantee override order, so variants never share a property.
 */
const panelBase = {
	paddingBlock: '4',
	paddingInline: '5',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'mono.line.hairline',
} as const;

const fieldDesignPanelClassName = /*#__PURE__*/ css({
	...panelBase,
	backgroundColor: 'accent.field.design',
});

const fieldCodePanelClassName = /*#__PURE__*/ css({
	...panelBase,
	backgroundColor: 'accent.field.code',
});

const fieldWritingPanelClassName = /*#__PURE__*/ css({
	...panelBase,
	backgroundColor: 'accent.field.writing',
});

const sunkenPanelClassName = /*#__PURE__*/ css({
	...panelBase,
	backgroundColor: 'mono.surface.sunken',
});

const inversePanelClassName = /*#__PURE__*/ css({
	...panelBase,
	backgroundColor: 'mono.surface.inverse',
});

type PanelSkin = 'field' | 'sunken' | 'inverse';

const FIELD_PANELS: Partial<Record<GuideCategory, string>> = {
	design: fieldDesignPanelClassName,
	code: fieldCodePanelClassName,
	writing: fieldWritingPanelClassName,
};

/**
 * Which panel a station paints. `tool` deliberately falls through
 * to `sunken`: the canonical system approves field steps for three
 * classes only, and `tool.500` cannot carry the 4.5:1 text ratio
 * `mono.ink.onColour` demands — its classification still shows
 * through the mark, the legend and the summary text.
 */
function panelFor(
	entry: GuideEntry,
	external: boolean,
): { panelClassName: string; skin: PanelSkin } {
	if (external) return { panelClassName: inversePanelClassName, skin: 'inverse' };
	const fieldPanel = entry.category ? FIELD_PANELS[entry.category] : undefined;
	if (fieldPanel) return { panelClassName: fieldPanel, skin: 'field' };
	return { panelClassName: sunkenPanelClassName, skin: 'sunken' };
}

/**
 * The `field` skin's text classes: every ink is `mono.ink.onColour`,
 * links carry a permanent underline (direction B: a link is marked
 * by its underline, and on a colour field the underline is also the
 * affordance that survives greyscale), and focus rings use the same
 * ink so the indicator always contrasts its own panel.
 */
const fieldLinkClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'baseline',
	gap: '3',
	fontFamily: 'sans',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.3',
	letterSpacing: '-0.015em',
	color: 'mono.ink.onColour',
	textDecoration: 'underline',
	textUnderlineOffset: '3px',
	_hover: { textDecorationThickness: '2px' },
	_focusVisible: {
		outline: '2px solid {colors.mono.ink.onColour}',
		outlineOffset: '2px',
	},
});

const fieldSummaryClassName = /*#__PURE__*/ css({
	margin: '0',
	marginBlockStart: '1',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'mono.ink.onColour',
	textWrap: 'pretty',
});

const fieldToggleClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
	padding: '1',
	marginInlineStart: '-1',
	borderRadius: 'sm',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'mono.ink.onColour',
	cursor: 'pointer',
	_hover: { opacity: '0.75' },
	_focusVisible: {
		outline: '2px solid {colors.mono.ink.onColour}',
		outlineOffset: '2px',
	},
	'&::marker': { color: 'mono.ink.onColour' },
});

const fieldChildLinkClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	paddingInlineStart: '5',
	paddingBlock: '2',
	textDecoration: 'none',
	borderInlineStartWidth: '2px',
	borderInlineStartStyle: 'solid',
	borderInlineStartColor: 'mono.ink.onColour',
	_hover: { opacity: '0.75' },
	_focusVisible: {
		outline: '2px solid {colors.mono.ink.onColour}',
		outlineOffset: '2px',
	},
});

const fieldChildLabelClassName = /*#__PURE__*/ css({
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '600',
	color: 'mono.ink.onColour',
});

const fieldExternalMarkClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
	color: 'mono.ink.onColour',
});

/** The inverse panel's badge: `bg.accent` would vanish into the panel. */
const inverseBadgeClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	paddingInline: '2',
	paddingBlock: '1',
	borderRadius: 'sm',
	backgroundColor: 'mono.surface.ground',
	color: 'mono.ink.text',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '700',
	letterSpacing: '0.02em',
});

/**
 * The `inverse` skin mirrors `field` with `mono.ink.inverse`: the
 * off-site spur's ink always contrasts its own (inverting) panel.
 */
const inverseLinkClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'baseline',
	gap: '3',
	fontFamily: 'sans',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.3',
	letterSpacing: '-0.015em',
	color: 'mono.ink.inverse',
	textDecoration: 'underline',
	textUnderlineOffset: '3px',
	_hover: { textDecorationThickness: '2px' },
	_focusVisible: {
		outline: '2px solid {colors.mono.ink.inverse}',
		outlineOffset: '2px',
	},
});

const inverseSummaryClassName = /*#__PURE__*/ css({
	margin: '0',
	marginBlockStart: '1',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'mono.ink.inverse',
	textWrap: 'pretty',
});

const inverseToggleClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
	padding: '1',
	marginInlineStart: '-1',
	borderRadius: 'sm',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'mono.ink.inverse',
	cursor: 'pointer',
	_hover: { opacity: '0.75' },
	_focusVisible: {
		outline: '2px solid {colors.mono.ink.inverse}',
		outlineOffset: '2px',
	},
	'&::marker': { color: 'mono.ink.inverse' },
});

const inverseChildLinkClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	paddingInlineStart: '5',
	paddingBlock: '2',
	textDecoration: 'none',
	borderInlineStartWidth: '2px',
	borderInlineStartStyle: 'solid',
	borderInlineStartColor: 'mono.ink.inverse',
	_hover: { opacity: '0.75' },
	_focusVisible: {
		outline: '2px solid {colors.mono.ink.inverse}',
		outlineOffset: '2px',
	},
});

const inverseChildLabelClassName = /*#__PURE__*/ css({
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '600',
	color: 'mono.ink.inverse',
});

const inverseExternalMarkClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
	color: 'mono.ink.inverse',
});

/**
 * The legend under the site route: every shape/colour pair the route
 * uses, so the node is never the only carrier of meaning — a reader
 * can always look the mark up. The external spur needs no legend
 * entry: its group heading and hollow ring already say "off-site".
 */
const legendClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'center',
	gap: 'x3',
	margin: '0',
	padding: '0',
	listStyle: 'none',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
	letterSpacing: '0.02em',
	color: 'text.muted',
});

const legendItemClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
});

const legendDotBase = {
	width: '8px',
	height: '8px',
	flexShrink: '0',
} as const;

const legendDotDesignClassName = /*#__PURE__*/ css({
	...legendDotBase,
	transform: 'rotate(45deg)',
	borderRadius: '1px',
	backgroundColor: 'accent.category.design',
});

const legendDotCodeClassName = /*#__PURE__*/ css({
	...legendDotBase,
	borderRadius: '1px',
	backgroundColor: 'accent.category.code',
});

const legendDotWritingClassName = /*#__PURE__*/ css({
	...legendDotBase,
	borderRadius: '50%',
	backgroundColor: 'accent.category.writing',
});

const legendDotToolClassName = /*#__PURE__*/ css({
	...legendDotBase,
	clipPath: 'polygon(50% 0, 100% 100%, 0 100%)',
	backgroundColor: 'accent.category.tool',
});

const legendDotNeutralClassName = /*#__PURE__*/ css({
	width: '10px',
	height: '4px',
	flexShrink: '0',
	borderRadius: '999px',
	backgroundColor: 'border.strong',
});

const CATEGORY_LEGEND: readonly { className: string; label: string }[] = [
	{ className: legendDotDesignClassName, label: 'Design' },
	{ className: legendDotCodeClassName, label: 'Code' },
	{ className: legendDotWritingClassName, label: 'Writing' },
	{ className: legendDotToolClassName, label: 'Tool' },
	{ className: legendDotNeutralClassName, label: '窓口' },
];

/** Which trimmed line segment a station needs, by position in its list. */
function lineClassNameFor(
	position: { index: number; count: number },
	external: boolean,
): string | null {
	const { index, count } = position;
	if (index === 0 && index === count - 1) return null;
	if (external) {
		if (index === 0) return lineFromNodeExternalClassName;
		if (index === count - 1) return lineToNodeExternalClassName;
		return lineFullExternalClassName;
	}
	if (index === 0) return lineFromNodeClassName;
	if (index === count - 1) return lineToNodeClassName;
	return lineFullClassName;
}

function StationRow({
	row,
	index,
	count,
	external,
}: {
	row: GuideRow;
	index: number;
	count: number;
	external: boolean;
}) {
	const { entry, featured } = row;
	const lineClassName = lineClassNameFor({ index, count }, external);
	const node = nodeFor(entry, external);
	const { panelClassName, skin } = panelFor(entry, external);
	const linkClassName =
		skin === 'field'
			? fieldLinkClassName
			: skin === 'inverse'
				? inverseLinkClassName
				: facilityLinkClassName;
	const stationSummaryClassName =
		skin === 'field'
			? fieldSummaryClassName
			: skin === 'inverse'
				? inverseSummaryClassName
				: summaryClassName;
	const toggleClassName =
		skin === 'field'
			? fieldToggleClassName
			: skin === 'inverse'
				? inverseToggleClassName
				: summaryToggleClassName;
	const stationChildLinkClassName =
		skin === 'field'
			? fieldChildLinkClassName
			: skin === 'inverse'
				? inverseChildLinkClassName
				: childLinkClassName;
	const childLabelSkinClassName =
		skin === 'field'
			? fieldChildLabelClassName
			: skin === 'inverse'
				? inverseChildLabelClassName
				: childLabelClassName;
	const stationExternalMarkClassName =
		skin === 'field'
			? fieldExternalMarkClassName
			: skin === 'inverse'
				? inverseExternalMarkClassName
				: externalMarkClassName;
	const badgeClassName = skin === 'inverse' ? inverseBadgeClassName : featuredBadgeClassName;
	return (
		<li className={stationClassName}>
			<span className={railClassName} aria-hidden="true">
				{lineClassName ? <span className={lineClassName} /> : null}
				<span
					className={node.className}
					style={node.clipPath ? { clipPath: node.clipPath } : undefined}
				/>
			</span>
			<div className={panelClassName}>
				<div
					className={css({
						display: 'flex',
						flexWrap: 'wrap',
						alignItems: 'baseline',
						gap: '3',
					})}
				>
					<a href={entry.href} className={linkClassName}>
						<span>{entry.titleJa}</span>
					</a>
					{featured ? <span className={badgeClassName}>注目</span> : null}
					{external ? <span className={stationExternalMarkClassName}>外部 ↗</span> : null}
				</div>
				<p className={stationSummaryClassName}>{entry.summaryJa}</p>
				{entry.children && entry.children.length > 0 ? (
					<details className={detailsClassName}>
						<summary className={toggleClassName}>下の階層を見る ({entry.children.length})</summary>
						<ul className={childrenClassName}>
							{entry.children.map((child) => (
								<li key={child.id}>
									<a href={child.href} className={stationChildLinkClassName}>
										<span className={childLabelSkinClassName}>{child.labelJa}</span>
										<span className={stationSummaryClassName}>{child.summaryJa}</span>
									</a>
								</li>
							))}
						</ul>
					</details>
				) : null}
			</div>
		</li>
	);
}

export interface GuideSectionProps {
	/** Base date (`YYYY-MM-DD`) promotion windows are evaluated against. */
	readonly today: string;
}

/**
 * The guide section. `today` comes from the same `observedAt` the
 * status tiles use, so a promotion boundary and the page's "now" can
 * never disagree.
 */
export function GuideSection({ today }: GuideSectionProps) {
	const rows = selectGuideRows(GUIDE_LEDGER, today);
	const siteRows = rows.filter(({ entry }) => entry.kind === 'site');
	const externalRows = rows.filter(({ entry }) => entry.kind === 'external');
	return (
		<PageSection labelledBy="site-guide-heading">
			{/* Issue #1110 — the guide is a two-column map surface, so it
				    takes the `default` heading and the full measure: inside the
				    spread variant's 8/12 column the station panels were ~360px
				    wide and every summary wrapped into a tall block. */}
			<SectionHeading
				id="site-guide-heading"
				eyebrow="Site guide"
				title="サイト内案内"
				titleEn="Site guide"
				description="このサイトに何があり、どう辿るか。駅の路線図のように、施設は同じ路線上の停車駅です。各駅の色面はその施設の内容分類を示し、点線の別線はサイトの外へ出る拠点です。"
			/>
			<div className={guideMapClassName}>
				<div>
					<ol className={routeListClassName} aria-label="サイト内の施設">
						{siteRows.map(({ entry, featured }, index) => (
							<StationRow
								key={entry.id}
								row={{ entry, featured }}
								index={index}
								count={siteRows.length}
								external={false}
							/>
						))}
					</ol>
					<ul className={cx(legendClassName, css({ marginBlockStart: '6' }))}>
						{CATEGORY_LEGEND.map(({ className, label }) => (
							<li key={label} className={legendItemClassName}>
								<span className={className} aria-hidden="true" />
								{label}
							</li>
						))}
					</ul>
				</div>
				{externalRows.length > 0 ? (
					<div className={externalGroupClassName}>
						<h3 className={externalHeadingClassName}>サイト外の拠点</h3>
						<ol className={routeListClassName} aria-label="サイト外の拠点">
							{externalRows.map(({ entry, featured }, index) => (
								<StationRow
									key={entry.id}
									row={{ entry, featured }}
									index={index}
									count={externalRows.length}
									external
								/>
							))}
						</ol>
					</div>
				) : null}
			</div>
			{/* Issue #936 — the visitor's own recently-visited
				    destinations. Renders nothing on SSR, first visit
				    or blocked storage; the guide above is complete
				    without it. */}
			<div className={css({ marginBlockStart: '8' })}>
				<VisitTrail />
			</div>
		</PageSection>
	);
}
