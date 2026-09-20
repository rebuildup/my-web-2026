import { css } from '../../../styled-system/css';
import type { HomeCounterData } from './load';
// Digit WebPs are pre-rasterised mono glyphs (see
// `scripts/generate-counter-digits.mjs` and `src/home/digits/`).
// The bake colour is `#0b1020` so the rasterised glyph matches
// `text.default` in `src/editorial/tokens.ts` exactly. The
// disabled path renders `—` as text instead of digits, so colour
// consistency between the two paths is not relied on.
import digit0Url from '../digits/0.webp?url';
import digit1Url from '../digits/1.webp?url';
import digit2Url from '../digits/2.webp?url';
import digit3Url from '../digits/3.webp?url';
import digit4Url from '../digits/4.webp?url';
import digit5Url from '../digits/5.webp?url';
import digit6Url from '../digits/6.webp?url';
import digit7Url from '../digits/7.webp?url';
import digit8Url from '../digits/8.webp?url';
import digit9Url from '../digits/9.webp?url';

export interface CounterTileProps {
	data: HomeCounterData;
}

/**
 * Lookup table from digit character (string) to its WebP URL.
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
 * Number of digit slots the odometer-style counter renders. The
 * display is always exactly this wide; smaller counts are left-
 * padded with zeros (`0 → "0000000"`, `1234 → "0001234"`). Counts
 * that exceed this width render as their natural decimal expansion
 * (no truncation, no scientific notation — the layout grows).
 *
 * Why 7: an odometer with 7 digits covers up to 9,999,999 page
 * views, which is plenty for the current personal-site scale; mechanical
 * counters traditionally come in 6- or 7-digit sizes and 7 looks
 * right next to the editorial typography. Override via a future
 * ADR if a different count is needed.
 */
const DIGIT_SLOTS = 7;

/**
 * CounterTile — KPI row for the access counter section.
 *
 * Renders the page-view counter the home consumes from
 * `/api/v1/access/count/:key` (Ticket F, branch 38). Per the
 * layout-system §5.2 (Dashboard / Data) family rules: importance →
 * area mapping. The count is the primary importance, so it gets the
 * dominant visual weight (display-large mono type). Delta and period
 * are secondary metadata stacked below; the last-hit timestamp is
 * tertiary context.
 *
 * Section shape: this component renders the KPI rows directly —
 * no card wrapper, no border, no internal padding. The home's
 * shared `<SectionHeading variant="spread">` in `composer.tsx`
 * places the content in the 8/12 right column on the same grid as
 * the Capabilities and Status sections; a card wrapper would
 * duplicate the visual frame those sections don't have. The row
 * `gap` is `10` (40 px) — same inter-row beat as StatusTiles
 * (also a Dashboard / Data family section).
 *
 * The count is rendered as a fixed-width sequence of pre-rasterised
 * mono digit WebPs — one `<img>` per slot — padded with leading
 * zeros. The "image swap" mechanic is what gives the section its
 * mechanical-counter feel: every digit is a frozen bitmap, so each
 * slot looks identical when stable and updates by image replacement
 * when the count changes. See `scripts/generate-counter-digits.mjs`
 * for the rasteriser and `src/home/digits/` for the committed
 * output. Each digit slides up into place on mount with a per-digit
 * stagger, so the count "rolls up" to its value when the section
 * first appears.
 *
 * Disabled state (no consumer API key) renders the same rows with a
 * muted `—` placeholder (text, not images) so the section does not
 * disappear but the digit machinery stays out of the way.
 */
export function CounterTile({ data }: CounterTileProps) {
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
				gap: '10',
				minWidth: '0',
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
					<DigitStrip count={data.count} />
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
 * Format `count` into the fixed-width digit strip.
 *
 *   - `count <= 9_999_999` → pad to `DIGIT_SLOTS` with leading zeros
 *     (`0 → "0000000"`, `1234 → "0001234"`).
 *   - `count > 9_999_999` → render the natural decimal expansion
 *     without padding; the strip expands to fit.
 *
 * The result is a string of digit characters; the caller maps each
 * character to its WebP via `DIGIT_URLS`.
 */
function padCount(count: number): string {
	const raw = count.toString();
	if (raw.length >= DIGIT_SLOTS) return raw;
	return raw.padStart(DIGIT_SLOTS, '0');
}

/**
 * Render the page-view count as a fixed-width sequence of digit
 * images. `count` is the raw integer (not a pre-formatted string),
 * so the formatter can decide how to pad it without locale
 * complications (commas would break the fixed-width odometer look).
 *
 * Each digit slides up from below with a per-index stagger
 * (`counterDigitRoll`). The keyframe is defined in
 * `panda.config.ts`; the reduced-motion override sits in
 * `src/styles.css`.
 */
function DigitStrip({ count }: { count: number }) {
	const digits = padCount(count);
	return (
		<div
			role="img"
			aria-label={`${count.toLocaleString('en-US')} page views`}
			className={css({
				display: 'inline-flex',
				alignItems: 'baseline',
				gap: '1',
				color: 'text.default',
			})}
		>
			{[...digits].map((char, index) => (
				<img
					key={`${index}-${char}`}
					src={DIGIT_URLS[char]}
					alt=""
					draggable="false"
					className={css({
						display: 'inline-block',
						// Literal pixel heights. We deliberately avoid the
						// `4xl` / `6xl` tokens here because Panda's `height`
						// reads from `sizes` (where `--sizes-6xl = 72rem`,
						// i.e. ~1152 px) rather than `fontSizes` (where
						// `--font-sizes-6xl = 3.75rem`, i.e. 60 px). The
						// token names overlap but the resolutions differ.
						height: { base: '48px', lg: '56px' },
						width: 'auto',
						verticalAlign: 'baseline',
						// Per-digit stagger: each digit enters ~80ms after
						// the previous one. The first digit starts at 0 so
						// the whole strip finishes inside ~560ms for the
						// default 7-digit display. prefers-reduced-motion
						// skips the animation entirely.
						animationName: 'counterDigitRoll',
						animationDuration: '320ms',
						animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
						animationFillMode: 'both',
						animationDelay: `calc(var(--counter-stagger, 0ms) + ${index * 80}ms)`,
					})}
					style={{ '--counter-stagger': '0ms' } as Record<string, string>}
				/>
			))}
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
 *                   rollup; the period is conveyed by the
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
