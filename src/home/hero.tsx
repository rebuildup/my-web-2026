import { css } from '../../styled-system/css';
import { Container } from '../editorial/primitives/Container';
import { SiteMark } from './mark';
import { PACKAGE_VERSION } from './version';

/**
 * Hero — top section of the home page.
 *
 * Carries the single `<h1>` on the page and identifies the platform
 * before describing the migration state (Issue #287 — the h1 is the
 * site identity motif, not a personal name). In-site destinations
 * (About, Portfolio) are the primary actions; source is available as
 * a secondary action.
 *
 * Issue #287 — composition mirrors the body sections' spread
 * `SectionHeading`: the same `minmax(0, 4fr) / minmax(0, 8fr)` grid,
 * with the h1 in the left 4/12 **title span** — the exact grid
 * position where the section titles below sit, sharing their x-axis
 * and column width. The right 8/12 column starts with the
 * description. The eyebrow line above the mark is the mono caption
 * at base and the metadata rail at `lg` (they carry the same
 * version metadata, so one breakpoint shows one of them — the rail
 * was already hidden below `lg` for the same duplication reason).
 *
 * Type and spacing jump at golden ratio:
 * - The h1 renders the `SiteMark` identity motif (Issue #287) at
 *   64px (`16`) base / 96px (`24`) height at `lg` — it replaces the
 *   `3xl/4xl` name at the same hierarchy step, sized on the
 *   canonical spacing tokens. The accessible name ("my-web-2026")
 *   sits inside the h1 as visually-hidden text.
 * - eyebrow ↔ h1 (8px, token `2` — same tight cluster the section
 *   titles use), h1 ↔ lead body (40px, carried by the grid
 *   `rowGap` below `lg`; cross-column above it, tops aligned like
 *   the spread sections), lead ↔ secondary (0, continuous prose),
 *   secondary ↔ CTAs (token `6`).
 * - Hero padding is `24/32` (96/128px) — the page-entry beat.
 */
export function Hero() {
	return (
		<section
			aria-labelledby="hero-title"
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
					})}
				>
					<header
						className={css({
							display: 'flex',
							flexDirection: 'column',
							minWidth: '0',
						})}
					>
						<span
							className={css({
								display: { base: 'block', lg: 'none' },
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
							})}
						>
							my-web-2026 · v{PACKAGE_VERSION} — 2026 Preview
						</span>
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
							<span lang="en">edition</span>
							<span lang="en">my-web-2026 · 2026 Preview</span>
							<span lang="en">v{PACKAGE_VERSION} · MIT</span>
						</aside>
						<h1
							id="hero-title"
							lang="en"
							className={css({
								margin: '0',
								marginBlockStart: '2',
								display: 'flex',
							})}
						>
							<SiteMark className={css({ height: { base: '16', lg: '24' }, width: 'auto' })} />
							<span className={css({ srOnly: true })}>my-web-2026</span>
						</h1>
					</header>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
							minWidth: '0',
						})}
					>
						<p
							lang="ja"
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: 'lg',
								lineHeight: '1.6',
								color: 'text.default',
							})}
						>
							開発・制作・活動をまとめる次の Personal Web Platform を構築しています。Portfolio /
							content / activity を段階的に移行中です。
						</p>
						<p
							lang="ja"
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: 'md',
								lineHeight: '1.6',
								color: 'text.muted',
							})}
						>
							この 2026 edition は移行途中の public preview
							です。コンテンツは段階的に公開していきます。
						</p>
						<div
							className={css({
								display: 'flex',
								flexWrap: 'wrap',
								gap: '4',
								marginBlockStart: '6',
							})}
						>
							<a
								href="/about"
								className={css({
									display: 'inline-flex',
									alignItems: 'center',
									gap: '2',
									paddingInline: '4',
									height: '10',
									borderRadius: 'md',
									backgroundColor: 'bg.accent',
									color: 'text.inverse',
									fontFamily: 'sans',
									fontSize: 'md',
									fontWeight: '600',
									textDecoration: 'none',
									transition: 'background-color 120ms ease',
									_hover: { backgroundColor: 'accent.interactive' },
									_focusVisible: {
										outline: '2px solid {colors.border.focus}',
										outlineOffset: '2px',
									},
								})}
							>
								About me / 自己紹介 →
							</a>
							<a
								href="/portfolio"
								className={css({
									display: 'inline-flex',
									alignItems: 'center',
									gap: '2',
									paddingInline: '4',
									height: '10',
									borderRadius: 'md',
									backgroundColor: 'bg.surface',
									color: 'text.default',
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: 'border.subtle',
									fontFamily: 'sans',
									fontSize: 'md',
									fontWeight: '600',
									textDecoration: 'none',
									transition: 'background-color 120ms ease',
									_hover: { borderColor: 'border.strong' },
									_focusVisible: {
										outline: '2px solid {colors.border.focus}',
										outlineOffset: '2px',
									},
								})}
							>
								<span lang="en">Portfolio</span> を見る
							</a>
							<a
								href="https://github.com/rebuildup/my-web-2026"
								rel="noopener noreferrer"
								target="_blank"
								className={css({
									display: 'inline-flex',
									alignItems: 'center',
									gap: '2',
									color: 'text.accent',
									fontFamily: 'sans',
									fontSize: 'md',
									fontWeight: '600',
									textDecoration: 'none',
									transition: 'color 120ms ease',
									_hover: { textDecoration: 'underline' },
									_focusVisible: {
										outline: '2px solid {colors.border.focus}',
										outlineOffset: '2px',
									},
								})}
							>
								<span lang="en">GitHub</span> でソースを見る →
							</a>
						</div>
					</div>
				</div>
			</Container>
		</section>
	);
}
