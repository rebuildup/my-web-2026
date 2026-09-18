import { Container } from '../../../design-system/components/Container';
import { css } from '../../../../styled-system/css';
import { PACKAGE_VERSION } from './version';

/**
 * Hero — top section of the home page.
 *
 * Carries the single `<h1>` on the page and identifies the person
 * behind the platform before describing the migration state. The
 * public transition link to the 2025 edition is primary; source is
 * available as a secondary action.
 */
export function Hero() {
	return (
		<section
			aria-labelledby="hero-title"
			className={css({
				paddingBlock: { base: '12', md: '12' },
				paddingBlockEnd: { base: '12', md: '12' },
			})}
		>
			<Container>
				<div
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '6',
						maxWidth: '720px',
					})}
				>
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						木村友亮 / samuido · v{PACKAGE_VERSION} — 2026 Preview
					</span>
					<h1
						id="hero-title"
						className={css({
							margin: '0',
							fontFamily: 'sans',
							fontSize: '2xl',
							fontWeight: '700',
							lineHeight: '1.1',
							color: 'text.default',
							letterSpacing: '-0.02em',
						})}
					>
						my-web-2026
					</h1>
					<p
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
						className={css({
							margin: '0',
							fontFamily: 'sans',
							fontSize: 'md',
							lineHeight: '1.6',
							color: 'text.muted',
						})}
					>
						2025 edition は引き続き yusuke-kim.com で公開中です。この 2026 edition は
						移行途中の public preview です。
					</p>
					<div
						className={css({
							display: 'flex',
							flexWrap: 'wrap',
							gap: '3',
							marginBlockStart: '2',
						})}
					>
						<a
							href="https://yusuke-kim.com"
							rel="noopener noreferrer"
							target="_blank"
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
							className={css({
								display: 'inline-flex',
								alignItems: 'center',
								gap: '2',
								paddingInline: '4',
								height: '10',
								borderRadius: 'md',
								backgroundColor: 'bg.surface',
								color: 'text.default',
								border: '1px solid',
								borderColor: 'border.subtle',
								fontFamily: 'sans',
								fontSize: 'md',
								fontWeight: '600',
								textDecoration: 'none',
								transition: 'background-color 120ms ease',
								_hover: { backgroundColor: 'bg.subtle' },
								_focusVisible: {
									outline: '2px solid {colors.border.focus}',
									outlineOffset: '2px',
								},
							})}
						>
							GitHub でソースを見る
						</a>
					</div>
				</div>
			</Container>
		</section>
	);
}
