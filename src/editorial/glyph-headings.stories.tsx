import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../styled-system/css';
import {
	GLYPH_HEADING_FIXTURES,
	type GlyphHeadingSample,
	glyphSampleCodePoints,
} from '../i18n/glyphs.fixture';
import { describeUnicode } from '../i18n/unicode';

/**
 * Storybook preview for the Issue #432 heading-glyph fixture.
 *
 * What this shows
 * ---------------
 * The fr / de / pt / ru heading samples from `src/i18n/glyphs.fixture.ts`
 * rendered with the **shipped** type stack: an `<h3>` (which
 * `src/styles.css` gives the `heading` family through
 * `:where(h1, h2, h3)`) for a `heading`-tier sample, body text for a
 * `body`-tier one, and the mono family for the code-point strip under
 * each row.
 *
 * The fixture lives in `src/i18n/` because it is text POLICY data
 * (which code points, which claims, which normalization form); the
 * rendering lives here because `editorial` owns the visual language.
 * Neither half owns the other: the fixture declares a `tier`, not a
 * font, so a change to the tokens moves this preview without touching
 * a single fixture row.
 *
 * Why it is a fixture, not copy
 * -----------------------------
 * Every string is verification copy written to exercise a character
 * class. None of it is approved site copy, none of it is a translation
 * of anything the platform owner publishes, and none of it is the
 * output of a proofreading tool — `docs/domain/i18n.md` §5 draws the
 * line between copy quality (the editor's job, not measured here) and
 * typography (the font stack's job, measured here). The measured
 * artefact is `docs/verification/i18n/diacritic-cyrillic-font.webp`,
 * captured by `scripts/capture-glyph-coverage.mjs`.
 *
 * Locale is opt-in per row
 * ------------------------
 * Each sample declares its own BCP-47 `lang`, and it is applied to the
 * element that renders it. Nothing here negotiates a locale from the
 * visitor, and no row inherits one from another
 * (`docs/domain/i18n.md` §6).
 *
 * This file is a preview only: nothing under `src/editorial/` ships
 * these strings, and no route renders them.
 */

const GUARD_KIND_LABEL = {
	character: 'character',
	number: 'number',
	negation: 'negation',
	permission: 'permission',
} as const;

function CodePointStrip({ sample }: { sample: GlyphHeadingSample }) {
	const facts = describeUnicode(sample.heading);
	const claimed = new Set(sample.probe);
	return (
		<ul
			className={css({
				display: 'flex',
				flexWrap: 'wrap',
				gap: '2',
				listStyle: 'none',
				margin: '0',
				padding: '0',
			})}
		>
			{facts.nonAscii.map((fact) => (
				<li
					key={`${fact.hex}-${fact.index}`}
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						lineHeight: '1.4',
						color: claimed.has(fact.hex) ? 'text.default' : 'text.muted',
						borderBottom: claimed.has(fact.hex) ? '1px solid' : '1px dashed',
						borderColor: claimed.has(fact.hex) ? 'border.default' : 'border.muted',
						paddingBottom: '1px',
					})}
					title={fact.label}
				>
					{fact.hex}
				</li>
			))}
		</ul>
	);
}

function SampleRow({ sample }: { sample: GlyphHeadingSample }) {
	const isHeading = sample.tier === 'heading';
	return (
		<li
			data-glyph-sample={sample.id}
			data-glyph-lang={sample.lang}
			data-glyph-tier={sample.tier}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				paddingBottom: '6',
				borderBottom: '1px solid',
				borderColor: 'border.subtle',
			})}
		>
			<span
				className={css({
					fontFamily: 'mono',
					fontSize: 'xs',
					letterSpacing: '0.06em',
					textTransform: 'uppercase',
					color: 'text.muted',
				})}
			>
				{sample.id} · {sample.focus} · {sample.tier} · lang={sample.lang} · form={sample.form}
			</span>
			{isHeading ? (
				<h3
					lang={sample.lang}
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: '2xl',
						lineHeight: '1.3',
						fontWeight: '700',
						color: 'text.default',
					})}
				>
					{sample.heading}
				</h3>
			) : (
				<p
					lang={sample.lang}
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'md',
						lineHeight: '1.7',
						color: 'text.default',
					})}
				>
					{sample.heading}
				</p>
			)}
			<CodePointStrip sample={sample} />
			<ul
				className={css({
					display: 'flex',
					flexWrap: 'wrap',
					gap: '3',
					listStyle: 'none',
					margin: '0',
					padding: '0',
					fontFamily: 'mono',
					fontSize: 'xs',
					color: 'text.muted',
				})}
			>
				{sample.guards.map((guard) => (
					<li key={guard.id}>
						<span className={css({ color: 'text.default' })}>{GUARD_KIND_LABEL[guard.kind]}</span>:{' '}
						{guard.token}
					</li>
				))}
			</ul>
			<p
				className={css({
					margin: '0',
					fontFamily: 'sans',
					fontSize: 'xs',
					lineHeight: '1.6',
					color: 'text.muted',
					maxWidth: '80ch',
				})}
			>
				{sample.note}
			</p>
		</li>
	);
}

function GlyphHeadings() {
	return (
		<div
			className={css({
				padding: { base: '6', lg: '10' },
				display: 'flex',
				flexDirection: 'column',
				gap: '10',
				maxWidth: '1180px',
				marginInline: 'auto',
			})}
		>
			<header className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.muted',
						letterSpacing: '0.08em',
						textTransform: 'uppercase',
					})}
				>
					Issue #432 — diacritics / combining marks / Cyrillic in headings
				</span>
				<h2
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: '3xl',
						fontWeight: '700',
						lineHeight: '1.25',
						color: 'text.default',
					})}
				>
					Four locales, one shipped font stack
				</h2>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: '1.7',
						color: 'text.muted',
						maxWidth: '80ch',
					})}
				>
					Synthetic fixture copy: every string exists to exercise a character class, and none of it
					is approved site copy or a proofreading result. Each row carries its own <code>lang</code>
					, and the code-point strip below each heading lists the non-ASCII code points it renders —
					underlined where the fixture declares the code point as under test, dashed where it is
					incidental. The measured version (font fallback, missing glyphs, clipboard round trip) is{' '}
					<code>docs/verification/i18n/diacritic-cyrillic-font.webp</code>.
				</p>
			</header>

			{GLYPH_HEADING_FIXTURES.map((fixture) => (
				<section
					key={fixture.locale}
					data-glyph-locale={fixture.locale}
					className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
				>
					<h3
						lang={fixture.lang}
						className={css({
							margin: '0',
							fontFamily: 'heading',
							fontSize: 'xl',
							fontWeight: '700',
							color: 'text.default',
						})}
					>
						{fixture.locale} · {fixture.lang}
					</h3>
					<ul
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '1',
							listStyle: 'none',
							margin: '0',
							padding: '0',
							fontFamily: 'mono',
							fontSize: 'xs',
							color: 'text.muted',
						})}
					>
						{fixture.typography.map((note) => (
							<li key={note.id}>
								<span className={css({ color: 'text.default' })}>{note.claim}</span>
								<br />
								{note.note}
							</li>
						))}
					</ul>
					<ul
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '6',
							listStyle: 'none',
							margin: '0',
							padding: '0',
						})}
					>
						{fixture.samples.map((sample) => (
							<SampleRow key={sample.id} sample={sample} />
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

const meta = {
	title: 'editorial/Glyph headings',
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component:
					'fr / de / pt / ru 見出しの合字・結合記号・キリル文字 fixture（Issue #432）。数据的実体は `src/i18n/glyphs.fixture.ts`、描画は出荷済み token を使う。',
			},
		},
	},
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	render: () => <GlyphHeadings />,
};
