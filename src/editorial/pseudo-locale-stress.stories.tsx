import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../styled-system/css';
import {
	DEFAULT_EXPANSION_RATIO,
	PSEUDO_LOCALE_ID,
	PSEUDO_LOCALE_LIMITS,
	PSEUDO_SURFACE_SAMPLE_IDS,
	type PseudoSample,
	auditPseudoSamples,
	pseudoExpandedText,
	pseudoSampleById,
} from '../i18n/pseudo-locale';

/**
 * Storybook preview for the Issue #429 pseudo-localisation fixture.
 *
 * What this shows
 * ---------------
 * The stress table from `src/i18n/pseudo-locale.ts` rendered with the
 * **shipped** type stack, in two views:
 *
 *   1. **UI surfaces at 320 px** — a badge, a heading, a paragraph and
 *      a button-sized box, each shown at the source string and again at
 *      the 1.5x pseudo-expansion, side by side inside the narrowest
 *      viewport the platform supports. That pairing is the Issue's
 *      actual question: not "is the text longer" but "does the surface
 *      still work when it is".
 *   2. **The audit row** — what the expander did (ratio, longest word,
 *      protected tokens) and what the bidi audit found, printed from
 *      the same functions `src/i18n/pseudo-locale.test.ts` asserts on,
 *      so the preview cannot drift from the CI verdict.
 *
 * The frames are drawn with the shipped BREAKING rules too, not with a
 * preview-only one: this Storybook loads `src/styles.css`, and the
 * heading carries only `text-wrap: balance`. A row that overflows here
 * overflows in the product, which is the point — a preview that added
 * `overflow-wrap: anywhere` would have certified a rule the product
 * does not ship.
 *
 * The fixture lives in `src/i18n/` because it is text POLICY data (which
 * strings, which expansion, which claims); the rendering lives here
 * because `editorial` owns the visual language. Neither half owns the
 * other: the fixture declares text, not a font.
 *
 * What this is NOT
 * ----------------
 * Not an RTL preview, and not a translation preview. Direction is set
 * on the box (`dir`) only so the reviewer can see whether a mixed run
 * breaks; mirroring, an RTL locale entry and RTL copy are undecided
 * owner decisions, listed verbatim from `PSEUDO_LOCALE_LIMITS` at the
 * bottom of this page. No row here is approved copy and none of it may
 * be published.
 *
 * The measured artefact is `docs/verification/i18n/pseudo-locale-stress.webp`,
 * captured by `scripts/capture-pseudo-locale-stress.mjs`.
 */

/** The narrowest supported viewport (the 320 px pass the fixture claims). */
const NARROW_FRAME = { width: '320px' };

function ratio(a: number, b: number): string {
	return b === 0 ? '—' : `${(a / b).toFixed(2)}x`;
}

function Frame({
	sample,
	expanded,
	label,
}: {
	sample: PseudoSample;
	expanded: boolean;
	label: string;
}) {
	const text = expanded ? pseudoExpandedText(sample) : sample.text;
	return (
		<div
			data-pseudo-frame={label}
			data-pseudo-lang={sample.lang}
			dir={sample.direction}
			lang={sample.lang}
			style={NARROW_FRAME}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				padding: '4',
				border: '1px solid',
				borderColor: 'border.subtle',
				borderRadius: 'lg',
				bg: 'bg.canvas',
				// An RTL box also gets `text-align: start`, the
				// logical-direction behaviour a real RTL surface would
				// rely on. That is a preview of the *container*, not an
				// RTL support claim.
				textAlign: 'start',
			})}
		>
			<span
				className={css({
					fontFamily: 'mono',
					fontSize: 'xs',
					letterSpacing: '0.08em',
					textTransform: 'uppercase',
					color: 'text.muted',
				})}
			>
				{label} · {expanded ? `${DEFAULT_EXPANSION_RATIO}x` : 'source'} · {[...text].length} cp
			</span>
			<span
				className={css({
					display: 'inline-flex',
					alignItems: 'center',
					alignSelf: 'start',
					h: '6',
					px: '2',
					borderRadius: 'full',
					bg: 'bg.subtle',
					color: 'text.muted',
					fontFamily: 'sans',
					fontSize: 'xs',
					fontWeight: '600',
				})}
			>
				{sample.subject}
			</span>
			<h3
				lang={sample.lang}
				className={css({
					margin: '0',
					fontFamily: 'heading',
					fontSize: 'lg',
					lineHeight: '1.3',
					fontWeight: '700',
					color: 'text.default',
					// Only what the shipped language actually declares for
					// a heading: `text-wrap: balance` from
					// `src/editorial/primitives/SectionHeading.tsx`, on
					// top of the site-wide base rule in `src/styles.css`
					// (`word-break: normal` → `auto-phrase`). Nothing here
					// grants a break opportunity the product does not
					// have — a surface that needs freer breaking adds its
					// own local rule, which is the contract
					// `src/editorial/layout-system.md` §3.4 documents.
					// `de-compound` therefore overflows here, exactly as it
					// does in the product; whether a long heading should
					// break anywhere is an open `src/editorial/` decision
					// (see §6 of the verification report).
					textWrap: 'balance',
				})}
			>
				{text}
			</h3>
			<span
				className={css({
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: 'center',
					h: '10',
					px: '4',
					borderRadius: 'md',
					bg: 'bg.accent',
					color: 'text.inverse',
					fontFamily: 'sans',
					fontSize: 'sm',
					fontWeight: '600',
					textAlign: 'center',
				})}
			>
				{sample.meaningTokens?.[0] ?? 'Publish status'}
			</span>
		</div>
	);
}

function SurfaceRow({ sample }: { sample: PseudoSample }) {
	const row = auditPseudoSamples([sample]).samples[0];
	return (
		<li
			data-pseudo-surface={sample.id}
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
				{sample.id} · lang={sample.lang} · {sample.direction} ·{' '}
				{ratio(row.expandedCodePoints, row.sourceCodePoints)} · longest word{' '}
				{row.expandedLongestWord} cp · {row.ok ? 'audit ok' : 'AUDIT FAILED'}
			</span>
			<div
				className={css({
					display: 'flex',
					flexWrap: 'wrap',
					gap: '6',
				})}
			>
				<Frame sample={sample} expanded={false} label="before" />
				<Frame sample={sample} expanded label="after" />
			</div>
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

function AuditTable() {
	const report = auditPseudoSamples();
	return (
		<table
			className={css({
				width: '100%',
				borderCollapse: 'collapse',
				fontFamily: 'mono',
				fontSize: 'xs',
			})}
		>
			{/*
			 * Issue #407: the caption names the table (SC 1.3.1 /
			 * SC 2.4.6). The a11y table gate checks the property, so a
			 * hand-rolled table that already carries one is left alone —
			 * this one was the only table in `src/**` that did not.
			 */}
			<caption
				className={css({
					captionSide: 'top',
					textAlign: 'start',
					fontFamily: 'mono',
					fontSize: 'xs',
					letterSpacing: '0.06em',
					textTransform: 'uppercase',
					color: 'text.muted',
					paddingBlockEnd: '2',
				})}
			>
				pseudo-locale sample audit
			</caption>
			<thead>
				<tr>
					{[
						'row',
						'src cp',
						'out cp',
						'ratio',
						'protected',
						'word',
						'bidi isolates',
						'verdict',
					].map((heading) => (
						<th
							key={heading}
							scope="col"
							className={css({
								textAlign: 'start',
								padding: '2',
								borderBottom: '1px solid',
								borderColor: 'border.strong',
								color: 'text.muted',
								fontWeight: '600',
							})}
						>
							{heading}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{report.samples.map((row) => (
					<tr key={row.id} data-pseudo-audit={row.id}>
						<td
							className={css({
								padding: '2',
								borderBottom: '1px solid',
								borderColor: 'border.subtle',
							})}
						>
							{row.id}
						</td>
						<td
							className={css({
								padding: '2',
								borderBottom: '1px solid',
								borderColor: 'border.subtle',
							})}
						>
							{row.sourceCodePoints}
						</td>
						<td
							className={css({
								padding: '2',
								borderBottom: '1px solid',
								borderColor: 'border.subtle',
							})}
						>
							{row.expandedCodePoints}
						</td>
						<td
							className={css({
								padding: '2',
								borderBottom: '1px solid',
								borderColor: 'border.subtle',
							})}
						>
							{row.ratio.toFixed(3)}
						</td>
						<td
							className={css({
								padding: '2',
								borderBottom: '1px solid',
								borderColor: 'border.subtle',
							})}
						>
							{row.protectedCodePoints}
						</td>
						<td
							className={css({
								padding: '2',
								borderBottom: '1px solid',
								borderColor: 'border.subtle',
							})}
						>
							{row.expandedLongestWord}
						</td>
						<td
							className={css({
								padding: '2',
								borderBottom: '1px solid',
								borderColor: 'border.subtle',
							})}
						>
							{row.bidi.isolates.lri} / {row.bidi.isolates.pdi}
						</td>
						<td
							className={css({
								padding: '2',
								borderBottom: '1px solid',
								borderColor: 'border.subtle',
								color: row.ok ? 'text.default' : 'accent.negative',
							})}
						>
							{row.ok ? 'ok' : row.findings.join('; ')}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function PseudoLocaleStress() {
	const surfaces = PSEUDO_SURFACE_SAMPLE_IDS.map((id) => pseudoSampleById(id));

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
					Issue #429 — pseudo-localisation stress ({PSEUDO_LOCALE_ID})
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
					1.5x expansion, long compounds, combining marks, digits and bidi
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
					Fixture copy only: every string exists to stress a character class, none of it is approved
					site copy, and none of it may be published. The expander is mechanical and reversible — it
					inserts combining marks and a width-bearing filler and rewrites nothing — so the
					negations, permission words, numbers and paths a row declares stay readable verbatim
					inside the grown string. RTL rows wrap their embedded Latin and digit runs in UAX #9
					isolates; that is tolerance, not RTL support.
				</p>
			</header>

			<section className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
				<h3
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: 'xl',
						fontWeight: '700',
						color: 'text.default',
					})}
				>
					UI surfaces at 320 px, before and after expansion
				</h3>
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
					{surfaces.map((sample) => (
						<SurfaceRow key={sample.id} sample={sample} />
					))}
				</ul>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'xs',
						lineHeight: '1.7',
						color: 'text.muted',
						maxWidth: '90ch',
					})}
				>
					These frames carry only what the shipped language declares: the base breaking rule of
					<code> src/styles.css</code> (<code>word-break: normal</code> then{' '}
					<code>auto-phrase</code>, <code>text-wrap: pretty</code>) and the heading rule of{' '}
					<code>src/editorial/primitives/SectionHeading.tsx</code> (<code>text-wrap: balance</code>
					). No preview-only break rule is applied, so <code>de-compound</code> — 68 code points
					with no break opportunity, 108 after the expansion — overflows its 320 px frame here
					exactly as it does in the product. Measured numbers live in the committed capture (
					<code>docs/verification/i18n/pseudo-locale-stress.webp</code>); whether a long heading
					should be allowed to break anywhere is an open <code>src/editorial/</code> decision.
				</p>
			</section>

			<section className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
				<h3
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: 'xl',
						fontWeight: '700',
						color: 'text.default',
					})}
				>
					Audit table — the same verdict the CI fixture asserts
				</h3>
				<AuditTable />
			</section>

			<section className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
				<h3
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: 'xl',
						fontWeight: '700',
						color: 'text.default',
					})}
				>
					What this fixture does not establish
				</h3>
				<ul
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '2',
						margin: '0',
						paddingInlineStart: '6',
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: '1.7',
						color: 'text.muted',
						maxWidth: '90ch',
					})}
				>
					{PSEUDO_LOCALE_LIMITS.map((limit) => (
						<li key={limit}>{limit}</li>
					))}
				</ul>
			</section>
		</div>
	);
}

const meta = {
	title: 'editorial/Pseudo locale stress',
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component:
					'疑似ローカライズ（1.5 倍膨張）の stress fixture（Issue #429）。数据的実体は `src/i18n/pseudo-locale.ts`、描画は出荷済み token を使う。RTL 正式対応ではなく「壊れないこと」だけを確かめる。',
			},
		},
	},
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	render: () => <PseudoLocaleStress />,
};
