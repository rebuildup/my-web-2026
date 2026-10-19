import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../styled-system/css';
import { findLanguageDocument } from '../i18n/language-of-parts';
import { LanguageOfParts, LanguageOfPartsCriteria } from './language-of-parts';
import { Container } from './primitives/Container';

/**
 * Language-of-parts gallery (Issue #409).
 *
 * The verification surface for WCAG 2.2 SC 3.1.2 (Language of Parts,
 * level A): it renders the shipped `LanguageOfParts` in every state
 * this Issue is about — 正常 / 空 / 失敗 / 縮小表示 — so a reviewer can
 * see which run carries a `lang`, which run deliberately does not, and
 * why each refusal was refused.
 *
 * The gallery is a fixture, not a page: no route mounts it, because
 * the placement of a mixed-language article is not decided. It is what
 * `scripts/capture-language-of-parts.mjs` screenshots for
 * `docs/verification/a11y/mixed-language-content.webp` — the capture
 * imports THIS module, so the image cannot drift from the component.
 *
 * Each panel states the success criterion it exists for and separates
 * what a machine decided (the attributes, the verdicts — asserted in
 * `language-of-parts.test.tsx` and by
 * `scripts/check-language-of-parts.mjs`) from what only a person can
 * judge (whether a screen reader actually changed voice), which the
 * closing panel prints as a table.
 */

const meta = {
	title: 'Editorial/LanguageOfParts',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<typeof LanguageOfParts>;

export default meta;
type Story = StoryObj<typeof meta>;

const panelClassName = css({
	borderTop: '1px solid {colors.border.subtle}',
	paddingBlock: { base: '10', lg: '12' },
});

const stateClassName = css({
	margin: 0,
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.06em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const criterionClassName = css({
	margin: 0,
	marginBlockStart: '2',
	maxWidth: '760px',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.muted',
});

function Panel({
	state,
	criterion,
	children,
}: {
	state: string;
	criterion: string;
	children: React.ReactNode;
}) {
	return (
		<section className={panelClassName}>
			<Container>
				<p className={stateClassName}>{state}</p>
				<p className={criterionClassName}>{criterion}</p>
				{children}
			</Container>
		</section>
	);
}

/**
 * `Gallery` — the state stack `scripts/capture-language-of-parts.mjs`
 * renders. A missing fixture document fails the capture rather than
 * producing a shorter image that still looks plausible.
 */
export function Gallery() {
	const normal = findLanguageDocument('article');
	const empty = findLanguageDocument('plain');
	const failure = findLanguageDocument('refusals');
	if (!normal || !empty || !failure) {
		throw new Error('language-of-parts fixture documents are missing');
	}
	return (
		<div data-testid="a11y-mixed-language-gallery" data-surface="mixed-language-gallery">
			<Panel
				state="01 正常 — mixed-language body"
				criterion="WCAG 2.2 3.1.2 (A): the English quotation and the Korean sentence carry lang; the code identifier and the single English word do not. Machine-checked: the attributes on the rendered document and the verdict of every part."
			>
				<LanguageOfParts document={normal} />
			</Panel>
			<Panel
				state="02 空 — no foreign run"
				criterion="WCAG 2.2 3.1.2 (A) / anti-mechanical half: a Japanese-only body emits zero lang attributes. Zero is the expected value — a gate that tagged every Latin word would fail this row."
			>
				<LanguageOfParts document={empty} />
			</Panel>
			<Panel
				state="03 失敗 — refused parts"
				criterion="WCAG 2.2 3.1.2 (A): an unverifiable tag (eng-US), a tag equal to the document language, and an empty run are all refused, and the reason stays observable in data-lang-verdict rather than being dropped."
			>
				<LanguageOfParts document={failure} showVerdicts />
			</Panel>
			<Panel
				state="04 縮小表示 — 320 px column"
				criterion="WCAG 2.2 1.4.10 (AA) / 1.4.4: the same mixed-language body in a narrow column, so a reviewer can look at reflow. NOT a conformance claim — reflow is judged by a person, not by this gate."
			>
				<LanguageOfParts document={normal} compact />
			</Panel>
			<Panel
				state="機械検査と人間の評価"
				criterion="The rows marked machine are decided by a gate; the rows marked human are open and are reported as open, never as satisfied."
			>
				<LanguageOfPartsCriteria />
			</Panel>
		</div>
	);
}

export const MixedLanguage = {
	render: () => <Gallery />,
} satisfies Story;
