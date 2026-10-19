import { css } from '../../../styled-system/css';
import { COUNTER_ROLL_MOTION, usePrefersReducedMotion } from '../../editorial/reduced-motion';
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
import type { HomeFormat, HomeLocale } from '../format';
import { createHomeFormat } from '../format';
import type { HomeCounterData } from './load';

export interface CounterTileProps {
	data: HomeCounterData;
	/**
	 * Opt-in locale for the instant / count formatting (Issue #430).
	 * Defaults to `'en'`, which is what this section shipped before
	 * the adapter existed.
	 */
	locale?: HomeLocale;
	/**
	 * Injectable clock for the relative "last hit" label. Defaults to
	 * `Date.now`; previews and tests pass a fixed clock so the
	 * rendered instant is deterministic.
	 */
	now?: () => number;
	/**
	 * Force the reduced-motion answer instead of asking the OS
	 * (Issue #403). Production passes nothing and the live
	 * `prefers-reduced-motion` preference decides; the Storybook
	 * fixture and the unit tests pass an explicit boolean so one
	 * document can show both modes on one machine.
	 */
	reducedMotion?: boolean;
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
 * first appears — subject to the lazy-fetch caveat in "Loading mode"
 * below.
 *
 * Loading mode (Issue #487): the strip is `loading="lazy"` +
 * `decoding="async"`. The tile is the FIFTH section of `/`, so the
 * strip sits far below the fold on every viewport this site ships,
 * while the UA default for an `<img>` without `loading` is `eager` —
 * i.e. "decode as soon as the HTML parses", with nothing to say when
 * the visitor can actually see it. The production build inlines the
 * digit WebPs (0.2–0.9 KB each, under Vite's `assetsInlineLimit`) as
 * `data:` URIs, so on the shipped document the attribute governs
 * *decode scheduling*, not the wire; on any build that keeps them as
 * real assets — the dev SSR document, which
 * `e2e/lazy-media.spec.ts` also measures — it defers seven requests.
 * Seven images is a small number, but the contract it broke is the
 * important one — "an image on this surface is decoded before the
 * visitor can see it" — and `test/integration/lazy-media-contract.test.ts`
 * now fails if any `<img>` on home stops declaring its mode. The
 * `role="img"` parent carries the real number as an accessible label,
 * so nothing assistive-tech depends on the bitmaps arriving early.
 *
 * One consequence worth knowing: the roll-up keyframe is a mount-time
 * animation (delays 0–480 ms), so a strip that is still below the fold
 * when it mounts finishes rolling before its (lazy) pixels exist, and
 * the digits settle into place instead of rolling when the visitor
 * scrolls down. Re-triggering the roll on intersection is product
 * behaviour, not part of this ticket's "one element" fix — it is
 * recorded as an open decision in
 * `docs/verification/perf/README.md`.
 *
 * Disabled state (no consumer API key) renders the same rows with a
 * muted `—` placeholder (text, not images) so the section does not
 * disappear but the digit machinery stays out of the way.
 *
 * Locale (Issue #430): the period date, the relative "last hit"
 * span, and the grouped count are rendered through the home format
 * adapter, so the same instant reads per locale. The surrounding
 * metadata copy ("page views", "last hit:", "since") stays English
 * until an approved translation exists; only the value is localised.
 *
 * Reduced motion (Issue #403): the roll-up is decoration over a
 * value, so the visitor's OS preference decides whether it is
 * created at all. With motion reduced, `DigitStrip` emits no
 * `animation-name` and renders exactly the resting frame — the same
 * seven slots, the same glyphs, the same `aria-label` — so nothing
 * about the count is lost by turning the movement off. The count is
 * never carried by the animation: the `role="img"` label is the
 * accessible source and the digits are its visual echo.
 */
export function CounterTile({ data, locale, now, reducedMotion }: CounterTileProps) {
	const systemPrefersReducedMotion = usePrefersReducedMotion();
	const reduceMotion = reducedMotion ?? systemPrefersReducedMotion;
	const format = createHomeFormat({ locale, now });
	const lastHitLabel = format.formatRelative(data.last_hit);
	const periodLabel = formatPeriod(data.first_hit, format);
	const deltaLabel = formatDelta(data, format);
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
					<DigitStrip count={data.count} format={format} reducedMotion={reduceMotion} />
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
 * `panda.config.ts`; the reduced-motion opt-out has two layers — the
 * render-time branch below (no `animation-name` is emitted at all,
 * see `src/editorial/reduced-motion.ts`) and the `data-motion` scoped
 * override in `src/styles.css` for the case where the markup was
 * produced without a client preference read (an SSR document replayed
 * from cache, a Storybook build that pinned the prop).
 *
 * `data-motion={COUNTER_ROLL_MOTION}` is the hook the stylesheet
 * pairs with this element (`MOTION_HOOK_ATTRIBUTE` in
 * `src/editorial/reduced-motion.ts` is the attribute's one owner; JSX
 * writes the name literally, the value comes from the constant).
 */
function DigitStrip({
	count,
	format,
	reducedMotion,
}: {
	count: number;
	format: HomeFormat;
	reducedMotion: boolean;
}) {
	const digits = padCount(count);
	return (
		<div
			role="img"
			aria-label={`${format.formatCount(count)} page views`}
			data-motion={COUNTER_ROLL_MOTION}
			// The applied motion state as a DOM fact, not a test hook: the
			// reduced-motion capture script reads it next to
			// `getComputedStyle(...).animationName` in a real browser, and a
			// reviewer can check the same pairing by hand. Same idea as the
			// `data-state` grid on `/design-system`.
			data-motion-state={reducedMotion ? 'reduced' : 'animated'}
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
					// Issue #487 — see "Loading mode" in the module
					// docstring. `loading` is stated explicitly rather
					// than left to the UA default so the lazy contract
					// is assertable from the rendered markup.
					loading="lazy"
					decoding="async"
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
						// The whole "movement" contract, and the only place this
						// component can animate. With motion reduced the spread
						// contributes NOTHING, so the document carries no
						// `animation-name` at all rather than an animation the
						// stylesheet has to neutralise — the resting frame IS the
						// reduced-motion frame.
						//
						// The declarations stay LITERAL here on purpose. Panda
						// extracts the utility classes by reading this object at
						// build time; moving them into a helper function emits
						// classes that no stylesheet rule matches, and the roll-up
						// silently stops animating (caught by the Issue #403 capture,
						// which reads `getComputedStyle(...).animationName`).
						//
						// Per-digit stagger: each digit enters ~80ms after the
						// previous one, the first at 0, so a 7-slot strip finishes
						// inside ~560ms.
						...(reducedMotion
							? {}
							: {
									animationName: 'counterDigitRoll',
									animationDuration: '320ms',
									animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
									animationFillMode: 'both',
									animationDelay: `calc(var(--counter-stagger, 0ms) + ${index * 80}ms)`,
								}),
					})}
					style={{ '--counter-stagger': '0ms' } as Record<string, string>}
				/>
			))}
		</div>
	);
}

/**
 * Format the "since {first_hit}" period label. Returns an empty string
 * when `firstHit` is null (i.e. no hits have been recorded yet) so the
 * parent can omit the span.
 *
 * The date itself is rendered by the format adapter, so the same
 * instant reads as the locale's own date ("Jan 5, 2026" / "2026/01/05"
 * / "2026. 1. 5.") instead of a machine ISO slice.
 */
function formatPeriod(firstHit: number | null, format: HomeFormat): string {
	if (firstHit === null) return '';
	return `since ${format.formatDate(firstHit)}`;
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
 *
 * The count is grouped by the format adapter (presentation only — the
 * stored value is untouched).
 */
function formatDelta(data: HomeCounterData, format: HomeFormat): string {
	if (!data.enabled) return '';
	if (data.count <= 0) return '';
	if (data.count === 1) return '+1 since launch';
	return `+${format.formatCount(data.count)} since launch`;
}
