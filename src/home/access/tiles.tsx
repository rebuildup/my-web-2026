import { css } from '../../../styled-system/css';
import type { HomeCounterData } from './load';
// Digit WebPs are pre-rasterised 7-segment LCD glyphs. The render
// path is `currentColor` in the SVG → sharp rasterises that as black
// (#000) since librsvg has no CSS context, and `text.default` is
// `#0b1020` (effectively black with a blue tint). The visual matches
// in the enabled path; the disabled path renders `—` as text instead
// of digits so the color mismatch never shows.
import digit0Url from './digits/0.webp?url';
import digit1Url from './digits/1.webp?url';
import digit2Url from './digits/2.webp?url';
import digit3Url from './digits/3.webp?url';
import digit4Url from './digits/4.webp?url';
import digit5Url from './digits/5.webp?url';
import digit6Url from './digits/6.webp?url';
import digit7Url from './digits/7.webp?url';
import digit8Url from './digits/8.webp?url';
import digit9Url from './digits/9.webp?url';

export interface CounterTileProps {
	data: HomeCounterData;
}

/**
 * Lookup table from digit character (string) to its WebP URL.
 * Numeric chars `0`–`9` are the only valid inputs; the formatter
 * upstream (`Intl.NumberFormat('en-US')`) only emits those plus
 * the group separator `,`, so we never have to render anything
 * else here.
 */
const DIGIT_URLS: Readonly<Record<string, string>> = {
	'0': digit0Url,
	'1': digit1Url,
	'2': digit2Url,
	'3': digit3Url,
	'4': digit4Url,
	'5': digit5Url,
	'6': digit6Url,
	'7': digit7Url,
	'8': digit8Url,
	'9': digit9Url,
};

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
 * The count is rendered as a sequence of pre-rasterised 7-segment
 * digit WebPs (one `<img>` per digit) rather than as text. The
 * image-swap mechanic is what gives the tile its mechanical-counter
 * feel — see `scripts/generate-counter-digits.mjs` for the rasteriser
 * and `src/home/access/digits/` for the committed output. Each
 * digit slides up into place on mount with a per-digit stagger, so
 * the count "rolls up" to its value when the tile first appears.
 *
 * Disabled state (no consumer API key) renders the same tile with a
 * muted `—` placeholder (text, not images) so the section does not
 * disappear but the digit machinery stays out of the way.
 */
export function CounterTile({ data }: CounterTileProps) {
	const formattedCount = new Intl.NumberFormat('en-US').format(data.count);
	const lastHitLabel = formatRelative(data.last_hit);
	const periodLabel = formatPeriod(data.first_hit);
	const deltaLabel = formatDelta(data);
	const enabled = data.enabled;
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
				{enabled ? (
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
				{enabled ? (
					<DigitStrip count={formattedCount} />
				) : (
					<span
						aria-label="counter disabled"
						className={css({
							fontFamily: 'mono',
							fontSize: { base: '4xl', lg: '6xl' },
							fontWeight: '700',
							lineHeight: '1',
							letterSpacing: '-0.04em',
							color: 'text.muted',
						})}
					>
						—
					</span>
				)}
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
					})}
				>
					{enabled ? 'page views' : 'counter disabled'}
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
				{enabled && deltaLabel ? (
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
				{enabled && data.last_hit !== null ? (
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
				{!enabled ? (
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
 * Render a pre-formatted count string (e.g. `"1,234"`) as a
 * sequence of digit images. Group separators (commas) are rendered
 * as small text glyphs between the digit clusters — keeping them
 * as text rather than image keeps the bundle small and lets the
 * editor-style locale formatting continue to apply.
 *
 * Each digit slides up from below with a per-index stagger
 * (`--digit-stagger`) and fades in (`counterDigitRoll`). The keyframe
 * is defined globally in `src/styles.css`. Visitors with
 * `prefers-reduced-motion` see no motion.
 */
function DigitStrip({ count }: { count: string }) {
	const chars = [...count];
	return (
		<div
			role="img"
			aria-label={`${count} page views`}
			className={css({
				display: 'inline-flex',
				alignItems: 'baseline',
				gap: '1',
				color: 'text.default',
			})}
		>
			{chars.map((char, index) => {
				if (char >= '0' && char <= '9') {
					return (
						<img
							key={`${index}-${char}`}
							src={DIGIT_URLS[char]}
							alt=""
							draggable="false"
							width={48}
							height={72}
							className={css({
								display: 'inline-block',
								height: { base: '4xl', lg: '6xl' },
								width: 'auto',
								verticalAlign: 'baseline',
								// Per-digit stagger: each digit enters ~80ms after
								// the previous one. The first digit starts at 0 so
								// the whole strip finishes inside ~720ms for a
								// 7-digit number (comfortably under the SSR→paint
								// first-render window). prefers-reduced-motion
								// skips the animation entirely.
								animationName: 'counterDigitRoll',
								animationDuration: '320ms',
								animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
								animationFillMode: 'both',
								animationDelay: `calc(var(--counter-stagger, 0ms) + ${index * 80}ms)`,
							})}
							style={
								{
									// Allow the parent to override the per-digit
									// stagger (used by stories so the "roll-up"
									// animation can be slowed down or disabled
									// for snapshot diffing).
									'--counter-stagger': '0ms',
								} as Record<string, string>
							}
						/>
					);
				}
				// Group separator (`,`) or any non-digit glyph: render
				// as small text so the formatting stays locale-correct
				// without baking 26 more images.
				return (
					<span
						key={`${index}-${char}`}
						aria-hidden="true"
						className={css({
							fontFamily: 'mono',
							fontSize: { base: '4xl', lg: '6xl' },
							fontWeight: '700',
							lineHeight: '1',
							letterSpacing: '-0.04em',
							color: 'text.default',
						})}
					>
						{char}
					</span>
				);
			})}
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
 * when `first_hit` is null (i.e. no hits have been recorded yet) so the
 * parent can omit the span.
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
