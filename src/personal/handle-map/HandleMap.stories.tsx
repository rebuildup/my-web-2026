import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { HandleMap } from './HandleMap';
import {
	HANDLE_MAP_DOCUMENT,
	HANDLE_MAP_ENTRIES,
	HANDLE_MAP_LEGEND,
	HANDLE_MAP_SECTIONS,
	type HandleMapEntry,
} from './HandleMap.preview';

/**
 * Preview of the name / handle legend (Issue #524).
 *
 * What this surface is
 * --------------------
 * A small independent display component that explains the
 * correspondence between the owner's name and handle: `samuido`,
 * `361do`, `rebuildup`, `yusuke-kim.com` and the channel-specific
 * handles (`361do_sleep` / `361do_design`) are all the SAME person —
 * each name points at a different aspect (real-name identity,
 * umbrella creator identity, stylized / distribution identity,
 * development-facing identity, personal domain, per-channel social
 * handle). The issue scopes it as a standalone component whose display
 * position is undecided, so this Storybook story is the whole surface:
 * no route mounts it.
 *
 * Why the data lives in a separate module
 * ---------------------------------------
 * `HandleMap.preview.ts` holds the CONTENT; `HandleMap.tsx` holds the
 * drawing of the legend; this file holds the page chrome around them.
 * That split is what lets
 * `scripts/check-handle-map-preview-parity.test.mjs` import the data
 * directly and prove that the document
 * (`docs/personal/handle-map.md`), the preview data and the committed
 * records (`docs/personal/domain.md`, `docs/personal/owner.md`,
 * `src/about/data.ts`, `src/about/links.ts`) still agree — including
 * the rule that a name with no published URL is never rendered as a
 * link.
 *
 * What the screen deliberately does NOT do
 * -----------------------------------------
 * It invents nothing: every description is a restatement of
 * `docs/personal/domain.md` §1 / `docs/personal/owner.md`, and every
 * `href` is a URL a committed record already publishes. Names whose
 * accounts are not published as links stay text — the component has no
 * code path that fabricates one.
 */

const pageClassName = css({
	fontFamily: 'sans',
	background: 'bg.canvas',
	color: 'text.default',
	padding: { base: '6', md: '10' },
});

const contentClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '10',
});

const headerClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	borderBottomWidth: '1px',
	borderBottomStyle: 'solid',
	borderBottomColor: 'border.subtle',
	paddingBottom: '6',
});

const titleClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: '3xl',
	fontWeight: '700',
	lineHeight: '1.2',
	letterSpacing: '-0.02em',
	color: 'text.default',
});

const metaListClassName = css({
	margin: '0',
	padding: '0',
	display: 'flex',
	flexWrap: 'wrap',
	gap: '3',
	listStyle: 'none',
});

const metaItemClassName = css({
	fontFamily: 'sans',
	fontSize: 'xs',
	lineHeight: '1.7',
	color: 'text.muted',
});

const sectionClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
});

const sectionTitleClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.3',
	color: 'text.default',
});

const listClassName = css({
	margin: '0',
	paddingInlineStart: '5',
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.8',
	color: 'text.default',
});

/** One document section after the legend: heading + bullets. */
function NoteSection({ heading, bullets }: { heading: string; bullets: readonly string[] }) {
	return (
		<section className={sectionClassName} aria-label={heading}>
			<h2 className={sectionTitleClassName}>{heading}</h2>
			<ul className={listClassName} data-notes-list>
				{bullets.map((bullet) => (
					<li key={bullet}>{bullet}</li>
				))}
			</ul>
		</section>
	);
}

/**
 * The whole preview on one screen: document header, the legend
 * component, then the rule / source / verification / open sections.
 *
 * `entries` is a prop so the "empty" story can prove the legend shell
 * does not depend on any entry being present.
 */
export function HandleMapPreview({ entries }: { entries: readonly HandleMapEntry[] }) {
	return (
		<main className={pageClassName} data-testid="handle-map-preview">
			<Container>
				<div className={contentClassName}>
					<header className={headerClassName}>
						<h1 className={titleClassName}>{HANDLE_MAP_DOCUMENT.title}</h1>
						<ul className={metaListClassName}>
							<li>
								<Badge tone="neutral">{HANDLE_MAP_DOCUMENT.status}</Badge>
							</li>
							<li className={metaItemClassName}>{HANDLE_MAP_DOCUMENT.source}</li>
							<li className={metaItemClassName}>{HANDLE_MAP_DOCUMENT.verification}</li>
							<li className={metaItemClassName}>{HANDLE_MAP_DOCUMENT.preview}</li>
						</ul>
					</header>
					<HandleMap
						entries={entries}
						heading={HANDLE_MAP_LEGEND.heading}
						lead={HANDLE_MAP_LEGEND.lead}
					/>
					{/* The document writes each entry as `名前:` / `側面:` /
					    `説明:` / `公開リンク:` bullet lines; the component
					    renders the same facts as cards. Both forms come
					    from `handleMapEntryBullets`, so the parity test
					    sees one source of truth and the screen does not
					    print every fact twice. */}
					{HANDLE_MAP_SECTIONS.map((section) => (
						<NoteSection
							key={section.heading}
							heading={section.heading}
							bullets={section.bullets}
						/>
					))}
				</div>
			</Container>
		</main>
	);
}

const meta = {
	title: 'Preview / Handle map',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The whole legend: document header, entries, rules, sources, open items. */
export const Default: Story = {
	render: () => <HandleMapPreview entries={HANDLE_MAP_ENTRIES} />,
};

/** The legend alone at the narrowest supported width (320 px). */
export const Narrow: Story = {
	render: () => (
		<div
			className={css({
				width: '320px',
				margin: '0 auto',
				borderWidth: '1px',
				borderStyle: 'dashed',
				borderColor: 'border.subtle',
			})}
		>
			<HandleMapPreview entries={HANDLE_MAP_ENTRIES} />
		</div>
	),
};

/**
 * The empty state: the document shell with no legend entry.
 *
 * It proves the shell does not depend on an entry being present —
 * what a "no published names yet" state would render.
 */
export const Empty: Story = {
	render: () => <HandleMapPreview entries={[]} />,
};
