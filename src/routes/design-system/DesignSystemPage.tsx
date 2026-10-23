import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { CjkLineBreak } from './sections/CjkLineBreak';
import { ColorSwatches } from './sections/ColorSwatches';
import { ImageCls } from './sections/ImageCls';
import { InteractiveStates } from './sections/InteractiveStates';
import { ReactionPicker } from './sections/ReactionPicker';
import { SpacingRuler } from './sections/SpacingRuler';
import { StatusAccents } from './sections/StatusAccents';
import { SurfaceTreatments } from './sections/SurfaceTreatments';
import { TableCode } from './sections/TableCode';
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
 *                          token, rendered as its `base` / `_dark` pair on
 *                          the matching `bg.canvas` appearance, so both
 *                          appearances are visible at a glance.
 *   - 02 Typography        size scale + heading / body / mono families.
 *   - 03 Spacing ruler      page-level beat scale.
 *   - 04 Surface treatments three card-style tiles using primitives.
 *   - 05 Interactive states default / hover / focus / pressed on `<a>` + `<button>`.
 *                            It also carries the Issue #394 keyboard
 *                            fixture: the shipped reaction picker
 *                            dialog, so its focus trap and its Escape
 *                            hand-back can be measured in a deployment
 *                            without a home consumer API key.
 *   - 06 Status / category  positive / negative / warning badges + four
 *                            content-category left-border treatments.
 *   - 07 Image / CLS         Issue #486 measurement fixture: the real
 *                            `PortfolioMediaFigure` rendered with
 *                            fixture rows (eager / lazy / placeholder /
 *                            unknown size) so the reserved-box contract
 *                            is measured in a browser instead of
 *                            asserted in prose. See
 *                            `docs/verification/perf/README.md`.
 *   - 08 CJK line-break      ja / zh-Hans / zh-Hant / ko headings and body
 *                            in three opt-in levels, so 禁則処理 and 折り返し
 *                            can be read at narrow widths (Issue #431).
 *   - 09 Table / code        the Issue #407 readability fixture: caption,
 *                            scoped header cells, a keyboard-reachable
 *                            scroll box, in the normal / empty / failure /
 *                            compact states.
 *
 * Section 07 is the only one that composes an obligation other than
 * editorial: it imports the portfolio media component, which is the
 * production element the CLS regression lives in. The import is
 * deliberate and allowed — `routes -> portfolio` is a registered
 * dependency direction (AGENTS.md §3).
 *
 * The interactive section does the same for the home obligation: it
 * imports the shipped reaction picker dialog, the production element
 * the keyboard regression lives in. `routes -> home` is a registered
 * dependency direction (AGENTS.md §3) as well.
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
				<ImageSection />
				<CjkSection />
				<TableCodeSection />
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
					description="bg.* / text.* / border.* と accent.* (surface / interactive / positive / negative / warning / category.*) の token を、それぞれの base / _dark 値を light / dark の canvas に並べます。ページ自体は prefers-color-scheme に従って切り替わります。"
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
					<ReactionPicker />
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

function ImageSection() {
	return (
		<section aria-labelledby="design-system-image" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="design-system-image"
					eyebrow="07 — Image"
					title="画像 / CLS fixture"
					description="Issue #486 の計測面。実運用の PortfolioMediaFigure を固定データで描画し、width/height・loading=lazy・placeholder の枠予約を E2E で実測する（e2e/image-cls.spec.ts、証跡は docs/verification/perf/images-cls-fixture.webp）。"
					variant="spread"
				>
					<ImageCls />
				</SectionHeading>
			</Container>
		</section>
	);
}

/**
 * 08 — CJK line-break (Issue #431).
 *
 * The only section whose content is a *fixture* rather than a token
 * demonstration, and it says so in its description: the text is
 * verification copy, rendered with the shipped `SectionHeading`
 * recipes so the browser's 禁則処理 can be read on the same page a
 * designer already uses for typography.
 */
function CjkSection() {
	return (
		<section aria-labelledby="design-system-cjk" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="design-system-cjk"
					eyebrow="08 — CJK line-break"
					title="禁則処理 / Line breaking"
					description="ja / zh-Hans / zh-Hant / ko の見出しと本文を 3 段階の opt-in（出荷状態 → lang のみ → lang + CJK タイポグラフィ）で並べます。表示用の検証文言であり、公開コピーの推敲ではありません。幅を狭くして禁則と折り返しの実挙動を確認してください。"
					variant="spread"
				>
					<CjkLineBreak />
				</SectionHeading>
			</Container>
		</section>
	);
}

function TableCodeSection() {
	return (
		<section aria-labelledby="design-system-table-code" className={sectionStyle}>
			<Container>
				<SectionHeading
					id="design-system-table-code"
					eyebrow="09 — table & code"
					title="表とコードブロックの読みやすさ"
					description="Issue #407 の fixture です。caption と scope 付きヘッダーセルで表構造を伝え、横スクロールはコンポーネント内部に閉じ込め、スクロール領域はキーボードから到達できます。正常 / 空 / 失敗 / 縮小表示の 4 状態をそのまま再現します。"
					variant="spread"
				>
					<TableCode />
				</SectionHeading>
			</Container>
		</section>
	);
}
