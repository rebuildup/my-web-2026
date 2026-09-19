import { css } from '../../../styled-system/css';
import type { HomeCounterData } from './load';

export interface CounterTileProps {
	data: HomeCounterData;
}

/**
 * Access counter tile — Dashboard KPI shape (branch 43).
 *
 * Renders the page-view counter the home consumes from
 * `/api/v1/access/count/:key` (Ticket F, branch 38). Per the
 * layout-system §5.2 (Dashboard / Data) family rules: importance →
 * area mapping. The count is the primary importance, so it gets the
 * dominant visual weight (display-large mono type). Delta and period
 * are secondary metadata stacked below; the last-hit timestamp is
 * tertiary context. The tile is a single full-width surface (no 4/8
 * split — that was the previous Marketing-family spread).
 *
 * Disabled state (no consumer API key) renders the same tile with a
 * muted placeholder so the section does not disappear.
 */
export function CounterTile({ data }: CounterTileProps) {
	const formattedCount = new Intl.NumberFormat('en-US').format(data.count);
	const lastHitLabel = formatRelative(data.last_hit);
	const periodLabel = formatPeriod(data.first_hit);
	const deltaLabel = formatDelta(data);
	return (
		<div
			data-testid="home-access-counter-tile"
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '4',
				padding: '6',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.subtle',
				borderRadius: 'lg',
				backgroundColor: 'bg.canvas',
			})}
		>
			<div
				className={css({
					display: 'flex',
					alignItems: 'baseline',
					justifyContent: 'space-between',
					gap: '4',
					flexWrap: 'wrap',
				})}
			>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.muted',
						letterSpacing: '0.06em',
						textTransform: 'uppercase',
					})}
				>
					04 / KPI · {data.key}
				</span>
				{data.enabled ? (
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'xs',
							color: 'text.muted',
						})}
					>
						{periodLabel}
					</span>
				) : null}
			</div>
			<div
				className={css({
					display: 'flex',
					alignItems: 'baseline',
					gap: '4',
					flexWrap: 'wrap',
				})}
			>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: { base: '4xl', lg: '6xl' },
						fontWeight: '700',
						lineHeight: '1',
						letterSpacing: '-0.04em',
						color: data.enabled ? 'text.default' : 'text.muted',
					})}
				>
					{data.enabled ? formattedCount : '—'}
				</span>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
					})}
				>
					{data.enabled ? 'page views' : 'counter disabled'}
				</span>
			</div>
			<div
				className={css({
					display: 'flex',
					alignItems: 'baseline',
					gap: '6',
					flexWrap: 'wrap',
				})}
			>
				{data.enabled && deltaLabel ? (
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						{deltaLabel}
					</span>
				) : null}
				{data.enabled && data.last_hit !== null ? (
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						last hit: {lastHitLabel}
					</span>
				) : null}
				{!data.enabled ? (
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						consumer API key not configured (run scripts/bootstrap-home-api-key.mjs)
					</span>
				) : null}
			</div>
		</div>
	);
}

/**
 * Format a Unix-ms timestamp as a relative time string ("just now",
 * "5 min ago", "3 h ago", "12 d ago"). Returns "—" when the input is
 * `null`. Used for the "last hit" tertiary metadata.
 */
function formatRelative(lastHit: number | null): string {
	if (lastHit === null) return '—';
	const ms = Date.now() - lastHit;
	if (ms < 60_000) return 'just now';
	if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)} min ago`;
	if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))} h ago`;
	return `${Math.floor(ms / (24 * 60 * 60_000))} d ago`;
}

/**
 * Format the "since {first_hit}" period label. Returns an empty string
 * when `first_hit` is null (i.e. no hits have been recorded yet) so
 * the parent can omit the span.
 */
function formatPeriod(firstHit: number | null): string {
	if (firstHit === null) return '';
	const date = new Date(firstHit);
	if (Number.isNaN(date.getTime())) return '';
	const iso = date.toISOString().slice(0, 10);
	return `since ${iso}`;
}

/**
 * Build the "delta since last hit" label. The reactions API dedupes
 * hits within a short window, so the delta semantics are:
 *
 *   - count == 0  → no hits yet; no delta to show
 *   - count == 1  → one hit recorded; show "+1 today"
 *   - count > 1   → show "+N total" (the counter has no per-period
 *                   rollup in 0.3.0; the period is conveyed by the
 *                   "since {first_hit}" label above)
 *
 * Returns an empty string when no delta is meaningful so the parent
 * can omit the span.
 */
function formatDelta(data: HomeCounterData): string {
	if (!data.enabled) return '';
	if (data.count <= 0) return '';
	if (data.count === 1) return '+1 since launch';
	return `+${new Intl.NumberFormat('en-US').format(data.count)} since launch`;
}
