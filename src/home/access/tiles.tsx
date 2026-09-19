import { css } from '../../../styled-system/css';
import type { HomeCounterData } from './load';

export interface CounterTileProps {
	data: HomeCounterData;
}

/**
 * Access counter tile — `04 — Access counter` home section.
 *
 * Renders the page-view counter the home consumes from
 * `/api/v1/access/count/:key` (Ticket F, branch 38). Single tile
 * matching the StatusTiles layout: a wide spread with a heading
 * cluster (eyebrow + value) and a small body paragraph.
 *
 * Disabled state (no consumer API key) renders the same layout with
 * a muted value placeholder so the section does not disappear.
 */
export function CounterTile({ data }: CounterTileProps) {
	const formattedCount = new Intl.NumberFormat('en-US').format(data.count);
	const lastHitLabel = formatLastHit(data.last_hit);
	return (
		<section
			aria-labelledby="access-counter-heading"
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: '4/12 8/12' },
				gap: { base: '4', md: '6' },
				paddingBlock: { base: '8', md: '12' },
			})}
		>
			<div>
				<p
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
						letterSpacing: '0.08em',
						textTransform: 'uppercase',
						margin: '0',
					})}
				>
					04 — Access counter
				</p>
				<h2
					id="access-counter-heading"
					className={css({
						fontFamily: 'sans',
						fontSize: 'xl',
						color: 'text.default',
						margin: '0',
					})}
				>
					{data.enabled ? (
						<>
							<span
								className={css({
									fontFamily: 'mono',
									fontSize: '4xl',
									color: 'text.default',
								})}
							>
								{formattedCount}
							</span>
							<span
								className={css({
									marginInlineStart: '3',
									fontFamily: 'mono',
									fontSize: 'sm',
									color: 'text.muted',
									letterSpacing: '0.04em',
									textTransform: 'uppercase',
								})}
							>
								hits / {data.key}
							</span>
						</>
					) : (
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'lg',
								color: 'text.muted',
							})}
						>
							counter disabled — consumer API key not configured (run
							scripts/bootstrap-home-api-key.mjs)
						</span>
					)}
				</h2>
			</div>
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
				})}
			>
				<p
					className={css({
						fontFamily: 'sans',
						fontSize: 'md',
						color: 'text.default',
						margin: '0',
					})}
				>
					ページビューカウンタです。各リクエストは短時間ウィンドウ内で重複加算されません。 A
					page-view counter; per-request dedup keeps the value honest within a short window.
				</p>
				{data.enabled && data.last_hit !== null ? (
					<p
						className={css({
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
							margin: '0',
						})}
					>
						last hit: {lastHitLabel}
					</p>
				) : null}
			</div>
		</section>
	);
}

function formatLastHit(lastHit: number | null): string {
	if (lastHit === null) return '—';
	const ms = Date.now() - lastHit;
	if (ms < 60_000) return 'just now';
	if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)} min ago`;
	if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))} h ago`;
	return `${Math.floor(ms / (24 * 60 * 60_000))} d ago`;
}
