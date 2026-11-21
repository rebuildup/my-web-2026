import { css } from '../../../styled-system/css';
import { Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { Grid } from '../../editorial/primitives/Grid';
import { Panel } from '../../editorial/primitives/Panel';

/**
 * PortfolioCaseStudy — the case-study element of Issue #519.
 *
 * What this element is for
 * ------------------------
 * A portfolio page shows WHAT was made; a case study shows HOW the
 * decision was reached — the goal, the options that were weighed, the
 * decision that was taken, and what was verified afterwards. The
 * owner's direction (Miro「意味のあるものを作る」「成長」) asks for
 * exactly this reading, and it must NOT collapse into a generic
 * retrospective: a retrospective narrates what happened, while this
 * element keeps three kinds of statement visibly apart:
 *
 *   - `confirmed`         — 確定事実: recorded, measured or shipped
 *                           facts. The repository can point at them.
 *   - `period-estimate`   — 当時の推測: what was believed or estimated
 *                           AT THE TIME. It was honest then and it is
 *                           not an outcome now.
 *   - `current-evaluation`— 現在の評価: the assessment as of the
 *                           publication date. It decays.
 *
 * Why the classes are labelled, not coloured
 * ------------------------------------------
 * Direction B is a monochrome system (Issue #764 / #887): status and
 * category carry no hue, they are read from a silhouette, a word and
 * the ink the surrounding text already uses. The three claim classes
 * follow the same rule — each one has a distinct mark SHAPE (disc /
 * triangle / open ring), a JA + EN word, and the legend above the
 * entries spells out what each word means. A reader who cannot see
 * the shape still reads the word; a reader in forced colours still
 * reads the word.
 *
 * Honesty contract
 * ----------------
 * The component renders ONLY what the caller supplies. It has no
 * default content, no filler sentence and no "results" it invents:
 * a section with no entries is omitted entirely, and a case study
 * whose sections are all empty renders nothing. "失敗 / 保留" is
 * expressed by the fixture's own text under `current-evaluation` or
 * `period-estimate`, never by the component guessing — hiding an
 * unverified claim behind a confident label is the failure this
 * element exists to prevent.
 *
 * Data ownership
 * --------------
 * This component is presentation only. The case-study CONTENT for a
 * real project is authored data (a fixture today — see
 * `src/portfolio/fixtures/case-study.ts`); wiring it into the D1
 * project model is a separate decision that needs a schema change and
 * owner-approved copy, so this Issue ships the element, its fixture
 * and its Storybook surface on their own (acceptance: 単独
 * fixture / Storybook / 文書 preview で完成する 1 Issue / 1 PR).
 */

/** The three epistemic classes a case-study statement can carry. */
export type PortfolioCaseStudyClaimClass = 'confirmed' | 'period-estimate' | 'current-evaluation';

export interface PortfolioCaseStudyEntry {
	readonly claimClass: PortfolioCaseStudyClaimClass;
	/** The statement itself. Plain text — no markup is interpreted. */
	readonly text: string;
}

export interface PortfolioCaseStudySection {
	readonly id: string;
	/** Bilingual section heading, e.g. `目的 / Goal`. */
	readonly heading: string;
	readonly entries: readonly PortfolioCaseStudyEntry[];
}

export interface PortfolioCaseStudyProps {
	/** The work the case study describes (its published title). */
	readonly title: string;
	/** Optional period line, e.g. the project's `periodLabel`. */
	readonly periodLabel?: string | null;
	/** Optional one-sentence framing shown under the title. */
	readonly summary?: string | null;
	readonly sections: readonly PortfolioCaseStudySection[];
}

/**
 * The mark vocabulary. One element per class, `aria-hidden`, painted
 * in `currentColor` — the same contract `StateMark` owns for status
 * and category (Issue #411), applied here to epistemic class because
 * the shipped `StateMarkKind` union is a closed status/category
 * vocabulary and these three classes are neither.
 *
 *   - confirmed          → filled disc  ("this is a fact")
 *   - period-estimate    → solid triangle ("this was a belief then")
 *   - current-evaluation → open ring   ("this is an assessment now")
 */
const CLAIM_CLASS_MARK_STYLE: Readonly<
	Record<PortfolioCaseStudyClaimClass, { clipPath?: string; borderRadius?: string }>
> = {
	confirmed: { borderRadius: '9999px' },
	'period-estimate': { clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' },
	// A single clip-path polygon cannot punch a hole, so the ring is
	// drawn as a bordered disc instead: an outline around nothing
	// reads as "enclosing but not filled" — an assessment surrounds
	// the work without being part of it.
	'current-evaluation': { borderRadius: '9999px' },
};

const CLAIM_CLASS_LABEL: Readonly<
	Record<PortfolioCaseStudyClaimClass, { ja: string; en: string; description: string }>
> = {
	confirmed: {
		ja: '確定事実',
		en: 'Confirmed',
		description: '記録・実測・公開物で確認できる事実。',
	},
	'period-estimate': {
		ja: '当時の推測',
		en: 'Period estimate',
		description: '制作当時の見積もりや推定。実績ではない。',
	},
	'current-evaluation': {
		ja: '現在の評価',
		en: 'Current evaluation',
		description: '公開時点の評価。時間とともに変わりうる。',
	},
};

const CLAIM_CLASS_ORDER: readonly PortfolioCaseStudyClaimClass[] = [
	'confirmed',
	'period-estimate',
	'current-evaluation',
];

function ClaimClassMark({ claimClass }: { claimClass: PortfolioCaseStudyClaimClass }) {
	const isRing = claimClass === 'current-evaluation';
	const shape = CLAIM_CLASS_MARK_STYLE[claimClass];
	return (
		<span
			aria-hidden="true"
			data-claim-class-mark={claimClass}
			className={css({
				display: 'inline-block',
				flexShrink: '0',
				inlineSize: '2',
				blockSize: '2',
				backgroundColor: isRing ? 'transparent' : 'currentColor',
			})}
			style={{
				clipPath: shape.clipPath,
				borderRadius: shape.borderRadius,
				...(isRing ? { border: '1.5px solid currentColor', boxSizing: 'border-box' } : {}),
			}}
		/>
	);
}

const rootClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '8',
	maxWidth: '720px',
});

const titleClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.2',
	letterSpacing: '-0.02em',
	color: 'text.default',
});

const metaClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const summaryClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'text.muted',
});

const legendLabelClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const legendNameClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.default',
});

const legendDescriptionClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	lineHeight: '1.6',
	color: 'text.muted',
});

const sectionHeadingClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '700',
	lineHeight: '1.3',
	color: 'text.default',
});

const entryClassName = css({
	display: 'flex',
	flexDirection: { base: 'column', sm: 'row' },
	gap: { base: '1', sm: '3' },
	alignItems: { sm: 'baseline' },
});

const entryLabelClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '2',
	flexShrink: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const entryTextClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.7',
	color: 'text.default',
	minWidth: '0',
});

export function PortfolioCaseStudy({
	title,
	periodLabel,
	summary,
	sections,
}: PortfolioCaseStudyProps) {
	const visibleSections = sections.filter((section) => section.entries.length > 0);
	// Nothing to say → render nothing. A case-study frame around zero
	// statements would read as "this work had no decisions", which is
	// a claim the data does not make.
	if (visibleSections.length === 0) return null;

	return (
		<article className={rootClassName} data-portfolio-case-study="">
			<Stack as="header" gap="2">
				<h2 className={titleClassName}>{title}</h2>
				{periodLabel ? <p className={metaClassName}>{periodLabel}</p> : null}
				{summary ? <p className={summaryClassName}>{summary}</p> : null}
			</Stack>

			<Stack gap="2">
				<p className={legendLabelClassName}>読み方 / How to read</p>
				<Grid as="ul" columns={5} gap="3" className={listResetClassName}>
					{CLAIM_CLASS_ORDER.map((claimClass) => {
						const label = CLAIM_CLASS_LABEL[claimClass];
						return (
							<Panel as="li" key={claimClass} variant="subtle" padding="4" radius="lg">
								<span className={legendNameClassName}>
									<ClaimClassMark claimClass={claimClass} />
									{label.ja}
									<span lang="en" className={css({ fontWeight: '400' })}>
										/ {label.en}
									</span>
								</span>
								<p className={legendDescriptionClassName}>{label.description}</p>
							</Panel>
						);
					})}
				</Grid>
			</Stack>

			{visibleSections.map((section) => (
				<Stack as="section" key={section.id} gap="3" aria-labelledby={`case-study-${section.id}`}>
					<h3 id={`case-study-${section.id}`} className={sectionHeadingClassName}>
						{section.heading}
					</h3>
					<Stack as="ul" gap="3" className={listResetClassName}>
						{section.entries.map((entry, index) => (
							<li
								// Entries have no stable id of their own; the
								// section id + position is stable because the
								// fixture is authored data, not a live feed.
								key={`${section.id}-${index}`}
								className={entryClassName}
								data-claim-class={entry.claimClass}
							>
								<span className={entryLabelClassName}>
									<ClaimClassMark claimClass={entry.claimClass} />
									{CLAIM_CLASS_LABEL[entry.claimClass].ja}
									<span lang="en">/ {CLAIM_CLASS_LABEL[entry.claimClass].en}</span>
								</span>
								<p className={entryTextClassName}>{entry.text}</p>
							</li>
						))}
					</Stack>
				</Stack>
			))}
		</article>
	);
}
