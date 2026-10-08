import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { ColorSwatches } from './sections/ColorSwatches';
import { InteractiveStates } from './sections/InteractiveStates';
import { SpacingRuler } from './sections/SpacingRuler';
import { StatusAccents } from './sections/StatusAccents';
import { SurfaceTreatments } from './sections/SurfaceTreatments';
import { Typography } from './sections/Typography';

/**
 * DesignSystemPage — `/design-system` route surface (presentation only).
 *
 * Cross-references `src/editorial/colors.md` so the showcase reads
 * as a verifiable companion to the editorial color guide. Both the
 * guide and this page consume the same semantic token layer; the
 * guide documents the contract, this page demonstrates it.
 *
 * Reading order:
 *   - Hero          (page title + intro)
 *   - 01 Color swatches    every `accent.*` + `bg.*` + `text.*` + `border.*`
 *                          token, rendered against both a light surface
 *                          (`bg.canvas`) and a dark surface (`bg.inverse`)
 *                          so the light/dark pair is visible at a glance.
 *   - 02 Typography        size scale + heading / body / mono families.
 *   - 03 Spacing ruler      page-level beat scale.
 *   - 04 Surface treatments three card-style tiles using primitives.
 *   - 05 Interactive states default / hover / focus / pressed on `<a>` + `<button>`.
 *   - 06 Status / category  positive / negative / warning badges + four
 *                            content-category left-border treatments.
 *
 * Each section uses `SectionHeading` with the same editorial spread
 * (4/12 heading cluster + 8/12 body) the home / about / portfolio
 * surfaces share, so the page sits on the same coordinate system as
 * the rest of the public site.
 *
 * The page never references raw palette tokens or hard-codes
 * accent hex values — every color is sourced through the semantic
 * layer so the showcase stays accurate when the palette evolves.
 */
export function DesignSystemPage() {
	return (
		<>
			<Hero />
			<main id="design-system-main">
				<ColorSection />
				<TypographySection />
				<SpacingSection />
				<SurfaceSection />
				<InteractiveSection />
				<StatusSection />
			</main>
		</>
	);
}

const sectionStyle = css({
	// Issue #300: canonical body-section beat (layout-system.md §3.3).
	// Was {12, 16} — a rhythm only /design-system used.
	paddingBlock: { base: '16', lg: '24' },
	borderTop: '1px solid {colors.border.subtle}',
});

function Hero() {
	return (
		<section
			aria-labelledby="design-system-hero-title"
			className={css({
				paddingBlock: { base: '16', lg: '32' },
			})}
		>
			<Container>
				<div
					className={css({
						display: 'grid',
						gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 4fr) minmax(0, 8fr)' },
						columnGap: { base: '0', lg: '10' },
						rowGap: { base: '10', lg: '0' },
						alignItems: 'start',
					})}
				>
					<aside
						aria-hidden="true"
						className={css({
							display: { base: 'none', lg: 'flex' },
							flexDirection: 'column',
							gap: '1',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
							lineHeight: '1.6',
						})}
					>
						<span lang="en">design system</span>
						<span lang="en">samuido · editorial</span>
						<span lang="en">color → typography → spacing → surface → states → status</span>
					</aside>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
							minWidth: '0',
						})}
					>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
							})}
						>
							/design-system · editorial showcase
						</span>
						<h1
							id="design-system-hero-title"
							className={css({
								margin: '0',
								marginBlockStart: '2',
								fontFamily: 'heading',
								fontSize: { base: '3xl', lg: '4xl' },
								fontWeight: '700',
								lineHeight: { base: '1.15', lg: '1.05' },
								color: 'text.default',
								letterSpacing: '-0.03em',
							})}
						>
							Design System
						</h1>
						<p
							className={css({
								margin: '0',
								marginBlockStart: '4',
								fontFamily: 'sans',
								fontSize: 'lg',
								lineHeight: '1.6',
								color: 'text.default',
							})}
						>
							src/editorial/ の semantic token / primitive を type 層から読み直せる showcase。
						</p>
						<p
							className={css({
								margin: '0',
								marginBlockStart: '4',
								fontFamily: 'sans',
								fontSize: 'md',
								lineHeight: '1.6',
								color: 'text.muted',
							})}
						>
							すべての color / typography / spacing は editorial visual language の contract
							を通ってレンダリングされます。
							<a
								href="https://github.com/rebuildup/my-web-2026/blob/main/src/editorial/colors.md"
								className={css({
									color: 'text.accent',
									textDecoration: 'underline',
									marginInlineStart: '1',
									_focusVisible: {
										outline: '2px solid {colors.border.focus}',
										outlineOffset: '2px',
									},
								})}
							>
								colors.md
							</a>{' '}
							が正本、 このページは視覚的な検証用 mirror。
						</p>
					</div>
				</div>
			</Container>
		</section>
	);
}

function ColorSection() {
	return (
		<section aria-labelledby="design-system-color" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="design-system-color"
					eyebrow="01 — Color"
					title="色 / Semantic tokens"
					description="bg.* / text.* / border.* と accent.* (surface / interactive / positive / negative / warning / category.*) の token を light + dark の surface に並べます。"
					variant="spread"
				>
					<ColorSwatches />
				</SectionHeading>
			</Container>
		</section>
	);
}

function TypographySection() {
	return (
		<section aria-labelledby="design-system-typography" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="design-system-typography"
					eyebrow="02 — Typography"
					title="組版 / Type scale"
					description="heading (Zen Kaku Gothic New) / body (Noto Sans JP) / mono (JetBrains Mono) を text.xs〜text.2xl の scale で並べます。"
					variant="spread"
				>
					<Typography />
				</SectionHeading>
			</Container>
		</section>
	);
}

function SpacingSection() {
	return (
		<section aria-labelledby="design-system-spacing" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="design-system-spacing"
					eyebrow="03 — Spacing"
					title="余白 / Whitespace scale"
					description="editorial の余白は ≈1.618x で段階を刻みます。 小 cluster (4/8) → cluster separator (24) → page-level beat (96/128)。"
					variant="spread"
				>
					<SpacingRuler />
				</SectionHeading>
			</Container>
		</section>
	);
}

function SurfaceSection() {
	return (
		<section aria-labelledby="design-system-surface" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="design-system-surface"
					eyebrow="04 — Surface"
					title="面 / Surface treatments"
					description="bg.canvas / bg.surface / accent.surface の三段を、既存 primitive で組み立てたカード・タイルで示します。"
					variant="spread"
				>
					<SurfaceTreatments />
				</SectionHeading>
			</Container>
		</section>
	);
}

function InteractiveSection() {
	return (
		<section aria-labelledby="design-system-states" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="design-system-states"
					eyebrow="05 — Interactive"
					title="状態 / Default · Hover · Focus · Pressed"
					description="primary / secondary / link / button の四系統で、 default / hover / pressed / focus の状態差を semantic token だけで読みます。"
					variant="spread"
				>
					<InteractiveStates />
				</SectionHeading>
			</Container>
		</section>
	);
}

function StatusSection() {
	return (
		<section aria-labelledby="design-system-status" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="design-system-status"
					eyebrow="06 — Status"
					title="識別子 / Status & category accents"
					description="positive / negative / warning の status badge、 と design / code / writing / tool の content category を left-border で識別。"
					variant="spread"
				>
					<StatusAccents />
				</SectionHeading>
			</Container>
		</section>
	);
}
