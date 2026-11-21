import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import {
	bodySansSmLoose,
	listStackGap3,
	noteSansXsBody,
	vStackGap1,
	vStackGap3Plain,
} from '../../editorial/primitives/shared-styles';
import type { HandleMapEntry } from './HandleMap.preview';

/**
 * HandleMap — the name / handle legend component (Issue #524).
 *
 * What this component is
 * ----------------------
 * A small independent display component that explains the
 * correspondence between the owner's name and handle: every published
 * name (`samuido`, `361do`, `rebuildup`, `yusuke-kim.com`, the
 * channel-specific handles, the real name) points at a different
 * ASPECT of the same person and the same activity — never a different
 * person or a different organization (docs/personal/domain.md §1,
 * narrative invariant 1).
 *
 * The link rule is part of the component contract, not a styling
 * choice: an entry whose `links` list is empty renders its name as
 * text with `noLinkReason`, never as an invented `<a>`. The data side
 * (`HandleMap.preview.ts`) only carries URLs that a committed record
 * publishes, and `scripts/check-handle-map-preview-parity.test.mjs`
 * fails when that stops being true.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * It owns no facts. The entries arrive as props; this file decides
 * only how a name, an aspect, a description and a link list are drawn.
 * It is not mounted on any route — the issue scopes it as a standalone
 * component whose display position is undecided, so the Storybook
 * story is the whole surface.
 */

const legendClassName = css(vStackGap3Plain);

const entryListClassName = css(listStackGap3);

const entryClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	padding: '4',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
});

const entryHeaderClassName = css(vStackGap1);

const entryNameClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '700',
	lineHeight: '1.3',
	letterSpacing: '-0.01em',
	color: 'text.default',
	overflowWrap: 'anywhere',
});

const entryDescriptionClassName = css(bodySansSmLoose);

const linkListClassName = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexWrap: 'wrap',
	gap: '2',
});

// Direction B keeps text achromatic: a link earns its affordance from
// an underline at rest, not from a hue (`text.accent` IS ink).
const linkClassName = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	lineHeight: '1.5',
	color: 'text.default',
	textDecoration: 'underline',
	textUnderlineOffset: '0.2em',
	overflowWrap: 'anywhere',
	_hover: { color: 'text.muted' },
});

const noLinkClassName = css(noteSansXsBody);

function HandleMapEntryCard({ entry }: { entry: HandleMapEntry }) {
	return (
		<li className={entryClassName} data-handle-map-entry={entry.id}>
			<div className={entryHeaderClassName}>
				<h3 className={entryNameClassName}>{entry.name}</h3>
				<Badge tone="neutral">{entry.aspect}</Badge>
			</div>
			<p className={entryDescriptionClassName}>{entry.description}</p>
			{entry.links.length === 0 ? (
				<p className={noLinkClassName}>
					公開リンクなし — {entry.noLinkReason ?? '公開 URL の記録が無い。'}
				</p>
			) : (
				<ul className={linkListClassName}>
					{entry.links.map((link) => (
						<li key={link.url}>
							<a
								className={linkClassName}
								href={link.url}
								target="_blank"
								rel="noreferrer noopener"
							>
								{link.label}
							</a>
						</li>
					))}
				</ul>
			)}
		</li>
	);
}

/**
 * The legend itself: one card per published name.
 *
 * `heading` / `lead` are supplied by the caller so the same component
 * can sit under a document heading or inside a page section without
 * owning the surrounding chrome.
 */
export function HandleMap({
	entries,
	heading,
	lead,
}: {
	entries: readonly HandleMapEntry[];
	heading: string;
	lead: string;
}) {
	return (
		<section className={legendClassName} aria-label={heading} data-handle-map>
			<div className={entryHeaderClassName}>
				<h2 className={entryNameClassName}>{heading}</h2>
				<p className={entryDescriptionClassName}>{lead}</p>
			</div>
			<ul className={entryListClassName}>
				{entries.map((entry) => (
					<HandleMapEntryCard entry={entry} key={entry.id} />
				))}
			</ul>
		</section>
	);
}
