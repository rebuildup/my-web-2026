import { Container } from '../../../design-system/components/Container';
import { css } from '../../../../styled-system/css';
import { PACKAGE_VERSION } from './version';

/**
 * Hero — top section of the home page.
 *
 * Carries the single `<h1>` on the page and the prose-only mission
 * statement. No motion, no decoration. The CTA below the prose is
 * the only interactive element; it points to the canonical source
 * repository.
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
						v{PACKAGE_VERSION} — Personal Web Platform
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
						Cloudflare Workers 上の個人 Web Platform。Portfolio / content / activity を 1
						つずつ組み立てる。
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
						A personal platform on Cloudflare Workers. Portfolio, content, and activity — built
						piece by piece.
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
							GitHub でソースを見る
						</a>
						<a
							href="/api/v1/health"
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
							API ヘルスチェック
						</a>
					</div>
				</div>
			</Container>
		</section>
	);
}
