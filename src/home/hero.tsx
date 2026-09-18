import { Container } from '../editorial/primitives/Container';
import { css } from '../../styled-system/css';
import { PACKAGE_VERSION } from './version';

/**
 * Hero — top section of the home page.
 *
 * Carries the single `<h1>` on the page and identifies the person
 * behind the platform before describing the migration state. The
 * public transition link to the 2025 edition is primary; source is
 * available as a secondary action.
 *
 * From Issue #31 the inner column is split into an asymmetric
 * 2-column composition at `lg` and wider: a lead column carrying
 * the heading / body / actions and a quiet metadata rail on the
 * right. Below `lg` the two columns stack into the original single
 * flow so the measure stays within the 60–70 character window.
 *
 * The metadata rail is rendered as raw text without a border, a
 * background fill, or any padding — proximity alone groups the
 * three lines, matching the editorial-spread pattern that the rest
 * of the page (and the reference site) follows.
 */
export function Hero() {
	return (
		<section
			aria-labelledby="hero-title"
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<div
					className={css({
						display: 'grid',
						gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 7fr) minmax(0, 3fr)' },
						columnGap: { base: '0', lg: '12' },
						rowGap: { base: '12', lg: '0' },
						alignItems: 'start',
					})}
				>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '8',
							maxWidth: '640px',
						})}
					>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
							})}
						>
							my-web-2026 · v{PACKAGE_VERSION} — 2026 Preview
						</span>
						<h1
							id="hero-title"
							lang="ja"
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: { base: '2xl', lg: '3xl' },
								fontWeight: '700',
								lineHeight: { base: '1.2', lg: '1.1' },
								color: 'text.default',
								letterSpacing: '-0.02em',
							})}
						>
							木村友亮 / samuido
						</h1>
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
							2025 edition は引き続き yusuke-kim.com で公開中です。この 2026 edition は移行途中の
							public preview です。
						</p>
						<div
							className={css({
								display: 'flex',
								flexWrap: 'wrap',
								gap: '3',
							})}
						>
							<a
								href="https://yusuke-kim.com"
								rel="noopener noreferrer"
								target="_blank"
								lang="en"
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
									_hover: { backgroundColor: 'colors.brand.600' },
									_focusVisible: {
										outline: '2px solid {colors.border.focus}',
										outlineOffset: '2px',
									},
								})}
							>
								2025 edition を見る
							</a>
							<a
								href="https://github.com/rebuildup/my-web-2026"
								rel="noopener noreferrer"
								target="_blank"
								lang="en"
								className={css({
									display: 'inline-flex',
									alignItems: 'center',
									gap: '2',
									paddingInline: '4',
									height: '10',
									borderRadius: 'md',
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
								GitHub でソースを見る →
							</a>
						</div>
					</div>
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
				</div>
			</Container>
		</section>
	);
}
