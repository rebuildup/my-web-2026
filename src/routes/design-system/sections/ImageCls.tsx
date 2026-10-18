import type { ReactNode } from 'react';
import { css } from '../../../../styled-system/css';
import { PortfolioMediaFigure } from '../../../portfolio/components/PortfolioMedia';
import type { PortfolioMedia as PortfolioMediaData } from '../../../portfolio/schema';

/**
 * ImageCls — `07 — Image / CLS regression fixture` (Issue #486).
 *
 * This section exists so the image-layout contract can be MEASURED
 * instead of described. `e2e/image-cls.spec.ts` drives it in
 * Chromium and `scripts/image-cls-report.mjs` renders the evidence
 * PNG from the same page.
 *
 * Why a fixture and not `/portfolio`
 * ---------------------------------
 * A real portfolio page cannot show an image locally:
 * `composeMediaUrl` (`src/portfolio/media.ts`) returns `null` until an
 * operator binds the R2 public custom domain, and
 * `MEDIA_PUBLIC_BASE_URL` is a production-only var by design
 * (`wrangler.production.jsonc`). Every local render therefore takes
 * the placeholder branch, which proves nothing about the `<img>`.
 *
 * The fixture calls the PRODUCTION component
 * (`PortfolioMediaFigure`) with fixture rows whose `url` points at
 * committed raster files under `public/fixtures/`. The element under
 * test is the shipped element; only the data is fixed. That is what
 * lets the ticket finish now instead of waiting for the media
 * delivery surface to be wired — the Issue explicitly asks for a
 * representative fixture rather than for a blocked production page.
 *
 * Cells (each carries `data-cls-fixture` for the spec):
 *
 *   - `eager-cover`      the LCP-ish case: in the first viewport,
 *                        `loading="eager"`, 16:9 intrinsic size.
 *   - `lazy-cover`       the CLS subject: pushed below the fold by a
 *                        viewport-height spacer so `loading="lazy"`
 *                        genuinely defers, then scrolled into view.
 *   - `placeholder`      `url: null` — the frame the composition
 *                        reserves when no asset is addressable.
 *   - `unknown-size`     `width`/`height` null — the degradation
 *                        path for rows the ingest never measured,
 *                        plus the trailing `data-cls-sentinel` that
 *                        the lazy figure would push if its box were
 *                        not reserved.
 *
 * The fixture rows deliberately bypass `composeMediaUrl`: they carry
 * a site-relative URL, which is what a local deployment can serve.
 */

const FIXTURE_BASE = '/fixtures';

function fixtureMedia(
	overrides: Partial<PortfolioMediaData> & Pick<PortfolioMediaData, 'id'>,
): PortfolioMediaData {
	return {
		r2Key: `fixtures/${overrides.id}.png`,
		contentType: 'image/png',
		width: null,
		height: null,
		alt: 'CLS fixture image',
		caption: null,
		isCover: true,
		displayOrder: 0,
		url: null,
		...overrides,
	};
}

export function ImageCls() {
	return (
		<div className={css({ display: 'flex', flexDirection: 'column', gap: '10' })}>
			<p
				className={css({
					margin: '0',
					fontFamily: 'sans',
					fontSize: 'md',
					color: 'text.muted',
					lineHeight: '1.6',
				})}
			>
				Issue #486 の計測対象。実運用の <code>PortfolioMediaFigure</code> を固定データで描画し、
				下の 4 セルが「予約済みの枠」を保つかを E2E で実測する。
			</p>
			<div
				className={css({
					display: 'grid',
					gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
					gap: '8',
				})}
			>
				<Cell
					id="eager-cover"
					label="eager / 1600×900 / first viewport"
					note="LCP 相当。寸法が予約されているので読み込み前後で枠の高さが変わらない。"
				>
					<PortfolioMediaFigure
						media={fixtureMedia({
							id: 'cls-cover-1600x900',
							url: `${FIXTURE_BASE}/cls-cover-1600x900.png`,
							width: 1600,
							height: 900,
							alt: 'CLS fixture — eager cover (1600×900)',
						})}
						loading="eager"
					/>
				</Cell>
				<Cell id="placeholder" label="placeholder / url: null" note="配信 URL が無い時の枠。">
					<PortfolioMediaFigure
						media={fixtureMedia({
							id: 'cls-placeholder-1600x900',
							width: 1600,
							height: 900,
							alt: 'CLS fixture — placeholder frame (1600×900)',
						})}
					/>
				</Cell>
			</div>

			{/*
			 * Viewport-height spacer. Without it the lazy cover is close
			 * enough to the fold that Chromium's lazy-loading distance
			 * threshold (current Chromium: 1250px on fast connections)
			 * may fetch it during the initial navigation, and the test
			 * would silently measure the eager path instead.
			 */}
			<div
				aria-hidden="true"
				data-cls-spacer="lazy-offset"
				className={css({
					height: '220vh',
					borderBlock: '1px dashed {colors.border.subtle}',
					backgroundImage:
						'repeating-linear-gradient(45deg, {colors.bg.subtle} 0 12px, transparent 12px 24px)',
				})}
			/>

			<div
				data-cls-region="lazy-region"
				className={css({ display: 'flex', flexDirection: 'column', gap: '8' })}
			>
				<Cell
					id="lazy-cover"
					label="lazy / 1280×720 / scrolled into view"
					note="CLS の被験体。スクロールで読み込みが起き、枠の高さが維持されること（＝ layout-shift 0）が実測される。"
				>
					<PortfolioMediaFigure
						media={fixtureMedia({
							id: 'cls-inline-1280x720',
							url: `${FIXTURE_BASE}/cls-inline-1280x720.png`,
							width: 1280,
							height: 720,
							alt: 'CLS fixture — lazy cover (1280×720)',
						})}
						loading="lazy"
					/>
				</Cell>

				{/*
				 * Trailing sentinel. A layout shift is only reported when
				 * rendered content MOVES, so a figure that grows at the
				 * bottom of the document scores 0 no matter how broken its
				 * box is. This element is the content the lazy figure
				 * pushes, which is what makes the measurement real (and
				 * what makes the pre-#486 rendering measurable at all).
				 */}
				<p
					data-cls-sentinel="below-lazy-cover"
					className={css({
						margin: '0',
						padding: '5',
						border: '1px solid {colors.border.subtle}',
						borderRadius: '6px',
						backgroundColor: 'bg.subtle',
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
						letterSpacing: '0.04em',
					})}
				>
					sentinel — この行の y 座標が読み込み前後で動かないこと
				</p>
			</div>

			<Cell
				id="unknown-size"
				label="unknown size / width: null"
				note="寸法未計測の row。予約枠を作れないので distortion せずに unchecked へ退避する。"
			>
				<PortfolioMediaFigure
					media={fixtureMedia({
						id: 'cls-unknown-size',
						url: `${FIXTURE_BASE}/cls-inline-1280x720.png`,
						alt: 'CLS fixture — unknown intrinsic size',
					})}
				/>
			</Cell>
		</div>
	);
}

function Cell({
	id,
	label,
	note,
	children,
}: {
	id: string;
	label: string;
	note: string;
	children: ReactNode;
}) {
	return (
		<figure
			data-cls-fixture={id}
			className={css({
				margin: '0',
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				padding: '5',
				border: '1px solid {colors.border.subtle}',
				borderRadius: '6px',
				backgroundColor: 'bg.surface',
			})}
		>
			<figcaption
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
				})}
			>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
						color: 'text.accent',
					})}
				>
					{label}
				</span>
				<span
					className={css({
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
						lineHeight: '1.6',
					})}
				>
					{note}
				</span>
			</figcaption>
			{children}
		</figure>
	);
}
