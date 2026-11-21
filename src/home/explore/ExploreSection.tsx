import { css, cx } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Cluster, Stack } from '../../editorial/primitives/Flow';
import { Grid } from '../../editorial/primitives/Grid';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { PageSection } from '../../editorial/primitives/PageSection';
import { Panel, type PanelVariant } from '../../editorial/primitives/Panel';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { TextLink } from '../../editorial/primitives/TextLink';
import { cardTitleClassName } from '../../editorial/primitives/card-title';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import { CAPABILITIES } from '../capabilities/registry';
import { VisitTrail } from '../guide/VisitTrail';
import type { GuideCategory, GuideEntry } from '../guide/ledger';
import { GUIDE_LEDGER } from '../guide/ledger';
import { selectGuideRows } from '../guide/select';

/**
 * Explore — the merged "where can I go" section of the home page
 * (Issue #1108 second pass, Epic #1104).
 *
 * What changed and why
 * --------------------
 * This section replaces TWO former sections — the Issue #930 site
 * guide (a vertical transit-map of eight stations) and the Issue #168
 * capabilities grid — because they answered the same visitor question
 * ("what exists here and how do I reach it") with the same
 * destinations. Portfolio, Tools and Activity literally appeared in
 * both. The route-line presentation also spent a full column on
 * decoration: every station was a full-width coloured panel stacked
 * vertically, so the page read as an endless list of colour blocks
 * rather than an index of destinations.
 *
 * The composition now matches the question: a GRID of classified
 * panels, one per destination, ordered by the ledger's authored
 * reading order. The classification survives — a facility's content
 * class still picks its `Panel` surface (`field.design` / `field.code`
 * / `field.writing`, the same approved field steps the station
 * panels used) — but the meaning is carried by the card's title and
 * summary text, so colour is never the only channel. `tool` keeps
 * the mark-only treatment (no approved field step), classless
 * facilities sit on `subtle`, and the explicitly external base sits
 * on `inverse` so "this destination leaves the site" stays a
 * large-area statement inside its own card.
 *
 * Capabilities merge in honestly: the ledger owns site destinations;
 * the capabilities registry owns lifecycle status. A capability with
 * no published surface (`planned`) is NOT a destination — v12/v13
 * review showed a full-size muted card reading as a dead-end peer of
 * the live cards, so planned capabilities leave the grid and render
 * as one quiet line under it. Live capabilities are already ledger
 * destinations, so no second link is invented for them.
 *
 * The promotion window still works: `selectGuideRows` marks at most
 * one featured entry and the card carries the `注目` badge — emphasis,
 * never reordering.
 */

/** Category → the small printed label that keeps classification off colour alone. */
const CATEGORY_LABELS: Record<GuideCategory, string> = {
	design: 'Design',
	code: 'Code',
	writing: 'Writing',
	tool: 'Tool',
};

/**
 * Category → Panel surface. `tool` deliberately resolves to `subtle`:
 * the canonical system approves field steps for three classes only
 * (`src/editorial/colors.md`), and `tool.500` cannot carry the ink
 * ratio `mono.ink.onColour` demands — its classification still shows
 * through the printed label.
 */
const CATEGORY_VARIANTS: Record<GuideCategory, PanelVariant> = {
	design: 'field.design',
	code: 'field.code',
	writing: 'field.writing',
	tool: 'subtle',
};

interface ExploreDestination {
	readonly id: string;
	readonly titleJa: string;
	readonly summaryJa: string;
	/** Internal path or absolute `https://` URL; absent = no surface yet. */
	readonly href?: string;
	readonly external: boolean;
	readonly variant: PanelVariant;
	/** Small printed classification label (never colour alone). */
	readonly classLabel: string;
	readonly featured: boolean;
}

function destinationFor(entry: GuideEntry, featured: boolean): ExploreDestination {
	const external = entry.kind === 'external';
	return {
		id: entry.id,
		titleJa: entry.titleJa,
		summaryJa: entry.summaryJa,
		href: entry.href,
		external,
		variant: external ? 'inverse' : entry.category ? CATEGORY_VARIANTS[entry.category] : 'subtle',
		classLabel: external ? 'External' : entry.category ? CATEGORY_LABELS[entry.category] : 'Site',
		featured,
	};
}

/**
 * Capabilities with no ledger destination and no published surface.
 * `content` is the only `planned` capability today; the filter keeps
 * the merge honest if the registry grows — a live capability that is
 * NOT a ledger entry is a composition bug the contract test catches,
 * not something this function papers over.
 */
function plannedCapabilities() {
	return CAPABILITIES.filter((capability) => capability.status === 'planned');
}

const cardListClassName = /*#__PURE__*/ css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
});

const classLabelClassName = /*#__PURE__*/ css({
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '700',
	letterSpacing: '0.08em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const cardSummaryClassName = /*#__PURE__*/ css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
	textWrap: 'pretty',
});

const plannedClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '2',
	margin: '0',
	marginBlockStart: '8',
	paddingBlockStart: '6',
	borderBlockStartWidth: '1px',
	borderBlockStartStyle: 'solid',
	borderBlockStartColor: 'border.subtle',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'text.muted',
});

const cardLinkClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
});

function ExploreCard({ destination }: { readonly destination: ExploreDestination }) {
	return (
		<Panel variant={destination.variant} padding="6" radius="md" as="li">
			<Stack gap="2">
				<Cluster gap="2">
					<span className={classLabelClassName}>{destination.classLabel}</span>
					{destination.featured ? <Badge tone="accent">注目</Badge> : null}
				</Cluster>
				<h3 className={cardTitleClassName}>
					{destination.href ? (
						<TextLink
							href={destination.href}
							className={cx(cardTitleClassName, cardLinkClassName)}
							{...(destination.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
						>
							{destination.titleJa}
							<MaterialSymbol d={ARROW_FORWARD_PATH} size={16} />
						</TextLink>
					) : (
						destination.titleJa
					)}
				</h3>
				<p className={cardSummaryClassName}>{destination.summaryJa}</p>
			</Stack>
		</Panel>
	);
}

/** Hard bound on the destination grid (C-8); see `ExploreSection`. */
const EXPLORE_DESTINATION_LIMIT = 12;

export interface ExploreSectionProps {
	/** Base date (`YYYY-MM-DD`) promotion windows are evaluated against. */
	readonly today: string;
}

/**
 * The merged guide + capabilities section. `today` comes from the same
 * `observedAt` the status tiles use, so a promotion boundary and the
 * page's "now" can never disagree.
 */
export function ExploreSection({ today }: ExploreSectionProps) {
	const rows = selectGuideRows(GUIDE_LEDGER, today);
	// The ledger is the authored curation; the slice is the hard bound
	// the C-8 contract asks every public enumeration to declare. If the
	// ledger outgrows the grid, the overflow belongs on a dedicated
	// index route, not in a taller home page.
	const destinations: readonly ExploreDestination[] = rows
		.map(({ entry, featured }) => destinationFor(entry, featured))
		.slice(0, EXPLORE_DESTINATION_LIMIT);
	const planned = plannedCapabilities();
	return (
		<PageSection labelledBy="site-guide-heading">
			<SectionHeading
				id="site-guide-heading"
				eyebrow="00 — Explore"
				title="サイト案内"
				titleEn="Site guide"
				description="このサイトの行き先を、内容の分類ごとの面で並べています。各カードの色面はその行き先の内容分類を示し、点線の別線はサイトの外へ出る拠点です。"
			/>
			<Grid columns={3} gap="6" as="ul" className={cardListClassName}>
				{destinations.map((destination) => (
					<ExploreCard key={destination.id} destination={destination} />
				))}
			</Grid>
			{planned.length > 0 ? (
				<p className={plannedClassName} data-testid="explore-planned">
					<Badge tone="neutral">planned</Badge>{' '}
					{planned
						.map(
							(capability) =>
								`${capability.label} — ${capability.labelJa}: ${capability.summaryJa}`,
						)
						.join(' / ')}
				</p>
			) : null}
			{/* Issue #936 — the visitor's own recently-visited
			    destinations. Renders nothing on SSR, first visit
			    or blocked storage; the grid above is complete
			    without it. Every card `href` resolves to the
			    destination's own index route. */}
			<div className={css({ marginBlockStart: '8' })}>
				<VisitTrail />
			</div>
		</PageSection>
	);
}
