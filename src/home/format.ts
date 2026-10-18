/**
 * Home locale format adapter (Issue #430).
 *
 * What this owns
 * --------------
 * The *formatting* of instants, counts, and relative spans on the
 * home surface: which locale decides the order of the date parts,
 * which time zone the clock is read in, how digits are grouped,
 * and which unit wording a relative span gets. It owns **formatting
 * only** — every caller still passes the raw `number` / ISO string
 * it already had, and the adapter returns a display string. It never
 * rewrites, rounds, re-units, or re-scales a value.
 *
 * Why it lives under `src/home/`
 * ------------------------------
 * It is a *feature-local* adapter, not a platform-wide i18n layer.
 * `src/home/brief.md` still records full i18n as deferred, and
 * AGENTS.md §3 forbids promoting a local implementation into a
 * cross-cutting abstraction before a second obligation needs it
 * (`portfolio`, `admin`, `about` each render their own quantities).
 * When a second obligation grows the same contract, this module is
 * the promotion candidate and it moves then — not before.
 *
 * Why opt-in
 * ----------
 * The locale is a per-feature opt-in, never a global switch. The
 * default is `'en'` + `'UTC'`, which is what the home page shipped
 * before this adapter existed, so a surface that passes nothing keeps
 * the previous output. Auto-negotiation (`Accept-Language`, URL
 * prefix, cookie) is deliberately **not** implemented here: choosing
 * the locale source is a product decision, and guessing one would
 * publish an unconfirmed default to every visitor.
 *
 * Locale surface (`HOME_LOCALES`)
 * -------------------------------
 * `en` / `ja` / `ko` only. A fourth locale is a one-line addition to
 * `HOME_LOCALES` — it is not a framework, so there is no message
 * catalogue, no plural-cascade table, and no runtime negotiation to
 * extend.
 *
 * Copy vs. format
 * ---------------
 * This module formats values. It does not translate prose. The home
 * page carries bilingual Japanese / English copy with English mono
 * metadata ("page views", "last hit:", "since"), and choosing the
 * wording for a `ja` or `ko` reader is an editorial decision with no
 * source in the repository yet. Until those strings are approved,
 * the surrounding labels stay English and only the value they wrap
 * is localised.
 *
 * Hydration contract
 * ------------------
 * Both server and client must format with the same `locale` **and**
 * the same `timeZone`. The default is `'UTC'` because the status
 * snapshot is an instant shared by every visitor of one SSR
 * response; rendering it in each visitor's local zone would make the
 * server HTML and the hydrated HTML disagree. A visitor-local
 * rendering therefore has to be a deliberate post-mount upgrade
 * (an effect that swaps in a local-zone adapter), not a default.
 *
 * Units
 * -----
 * The only unit-bearing quantities the home currently shows are the
 * relative spans on the access counter (minute / hour / day), which
 * `Intl.RelativeTimeFormat` words per locale ("5 minutes ago" /
 * "5 分前" / "5분 전"). CLDR `Intl.NumberFormat` unit style
 * (`style: 'unit'`) is intentionally not wrapped: no home surface
 * renders a quantity whose unit is a CLDR unit, and an unused
 * adapter method is an unverified promise. `home/format.stories.tsx`
 * shows what such a unit would look like in each locale so the next
 * surface that needs one starts from rendered evidence.
 *
 * Typography / writing-quality differences (observed, CLDR)
 * --------------------------------------------------------
 * The same instant and the same relative span render differently per
 * locale, and not only in wording:
 *
 *   - `ja` separates the number from the unit with a space
 *     ("5 分前"); `ko` writes the unit tight against the number
 *     ("5분 전") and puts the space in the word order instead. The
 *     exact space code point is ICU data — U+0020 today, U+3000 in
 *     older CLDR — so nothing downstream may depend on it.
 *   - `ko` carries a day period ("오전 9:00") where `ja` is 24-hour
 *     ("9:00") and `en` is 12-hour ("9:00 AM"). The adapter does not
 *     pin `hourCycle`: the locale's own convention is the point.
 *   - Date order flips: `en` "Jan 5, 2026", `ja` "2026/01/05",
 *     `ko` "2026. 1. 5.".
 *   - Digit grouping does **not** differ today: `en` / `ja` / `ko`
 *     all use Western digits and `,` grouping ("1,234,567"). That is
 *     the recorded observation, not an assumption — see
 *     `format.test.ts`.
 */

/** Locales the home surface can render. */
export const HOME_LOCALES = ['en', 'ja', 'ko'] as const;

export type HomeLocale = (typeof HOME_LOCALES)[number];

/** Locale used when a caller opts out of passing one. */
export const HOME_FORMAT_DEFAULT_LOCALE: HomeLocale = 'en';

/** Time zone used when a caller opts out of passing one (see hydration contract). */
export const HOME_FORMAT_DEFAULT_TIME_ZONE = 'UTC';

/**
 * Anything the home can be handed as "an instant": an ISO string from
 * a server loader, a Unix-ms timestamp from the counter API, or a
 * `Date`.
 */
export type HomeInstant = string | number | Date;

export interface HomeFormatOptions {
	/** Opt-in locale. Defaults to {@link HOME_FORMAT_DEFAULT_LOCALE}. */
	locale?: HomeLocale;
	/** IANA time zone the clock is read in. Defaults to `'UTC'`. */
	timeZone?: string;
	/** Injectable clock for relative formatting; defaults to `Date.now`. */
	now?: () => number;
}

export interface HomeFormat {
	readonly locale: HomeLocale;
	readonly timeZone: string;
	/** Digit grouping for a count. The value itself is unchanged. */
	formatCount(value: number): string;
	/** Date only, in the adapter's time zone. */
	formatDate(value: HomeInstant): string;
	/** Date + time, in the adapter's time zone, without the zone label. */
	formatDateTime(value: HomeInstant): string;
	/** Time-zone label for the instant (`UTC`, `JST`, `GMT+9`, …). */
	formatTimeZone(value: HomeInstant): string;
	/** Date + time + zone label — the form a snapshot timestamp ships as. */
	formatInstant(value: HomeInstant): string;
	/** Relative span from `now()`, or `—` when there is no instant. */
	formatRelative(value: number | null): string;
}

/**
 * `Intl` objects are cached per locale (+ time zone) instead of per
 * render. Constructing a formatter on every render is the classic
 * `Intl` performance footgun, and the key space is bounded by the
 * locales and zones the home actually renders, so nothing here needs
 * an eviction policy.
 *
 * The composite cache key joins locale and time zone with `|`.
 * Neither a BCP-47 locale tag nor an IANA zone name can contain
 * `|`, so the key is unambiguous — and it stays plain ASCII so the
 * source file never carries a control character.
 */
const countFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function countFormatter(locale: HomeLocale): Intl.NumberFormat {
	const cached = countFormatters.get(locale);
	if (cached) return cached;
	const formatter = new Intl.NumberFormat(locale);
	countFormatters.set(locale, formatter);
	return formatter;
}

function dateFormatter(locale: HomeLocale, timeZone: string): Intl.DateTimeFormat {
	const key = `${locale}|${timeZone}`;
	const cached = dateFormatters.get(key);
	if (cached) return cached;
	const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone });
	dateFormatters.set(key, formatter);
	return formatter;
}

function dateTimeFormatter(locale: HomeLocale, timeZone: string): Intl.DateTimeFormat {
	const key = `${locale}|${timeZone}`;
	const cached = dateTimeFormatters.get(key);
	if (cached) return cached;
	// `dateStyle` / `timeStyle` carry the per-locale hour cycle and
	// day-period wording (ko writes 오전/오후, ja writes 24-hour,
	// en writes AM/PM), so the adapter must not pin `hourCycle`.
	const formatter = new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone,
	});
	dateTimeFormatters.set(key, formatter);
	return formatter;
}

function zoneFormatter(locale: HomeLocale, timeZone: string): Intl.DateTimeFormat {
	const key = `${locale}|${timeZone}`;
	const cached = zoneFormatters.get(key);
	if (cached) return cached;
	// `timeZoneName` cannot be combined with `dateStyle` / `timeStyle`,
	// so the label is read out of `formatToParts` separately.
	const formatter = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' });
	zoneFormatters.set(key, formatter);
	return formatter;
}

function relativeFormatter(locale: HomeLocale): Intl.RelativeTimeFormat {
	const cached = relativeFormatters.get(locale);
	if (cached) return cached;
	// `numeric: 'always'` keeps the span exact: `numeric: 'auto'`
	// renders `-1 day` as "yesterday" / "어제", which trades a
	// measured span for a calendar word.
	const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
	relativeFormatters.set(locale, formatter);
	return formatter;
}

function nowRelativeFormatter(locale: HomeLocale): Intl.RelativeTimeFormat {
	const key = `${locale}|now`;
	const cached = relativeFormatters.get(key);
	if (cached) return cached;
	// Only the sub-minute case uses `auto`, and only because
	// "0 seconds ago" in every locale is a worse sentence than the
	// word for "now" ("now" / "今" / "지금").
	const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
	relativeFormatters.set(key, formatter);
	return formatter;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Em dash: the home's existing "no value" placeholder, in every locale. */
const EMPTY = '—';

/**
 * Resolve an input to epoch milliseconds, or `null` when it is not a
 * usable instant. Unparsable input is never silently coerced to
 * "now" — that would report a fresh observation for a broken value.
 */
function toEpochMs(value: HomeInstant): number | null {
	const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
	return Number.isNaN(ms) ? null : ms;
}

/**
 * Read the time-zone label out of `formatToParts`. `timeZoneName`
 * cannot be combined with `dateStyle` / `timeStyle`, so the label is
 * its own `Intl` call; the IANA id is the fallback when a locale
 * carries no short name for the zone.
 */
function zoneLabel(locale: HomeLocale, timeZone: string, ms: number): string {
	const label = zoneFormatter(locale, timeZone)
		.formatToParts(ms)
		.find((part) => part.type === 'timeZoneName')?.value;
	return label ?? timeZone;
}

/**
 * Create a format adapter for one locale / time zone pair.
 *
 * The returned object is cheap to build (all `Intl` work is cached
 * per locale), so callers construct it during render from their props
 * rather than threading a module-level singleton.
 */
export function createHomeFormat(options: HomeFormatOptions = {}): HomeFormat {
	const locale = options.locale ?? HOME_FORMAT_DEFAULT_LOCALE;
	const timeZone = options.timeZone ?? HOME_FORMAT_DEFAULT_TIME_ZONE;
	const now = options.now ?? Date.now;

	return {
		locale,
		timeZone,
		formatCount(value: number): string {
			// Non-finite input is passed through untouched: a counter
			// value of `NaN` is a data bug, and re-formatting it as
			// "NaN" through Intl would hide where it came from.
			if (!Number.isFinite(value)) return String(value);
			return countFormatter(locale).format(value);
		},
		formatDate(value: HomeInstant): string {
			const ms = toEpochMs(value);
			if (ms === null) return typeof value === 'string' ? value : EMPTY;
			return dateFormatter(locale, timeZone).format(ms);
		},
		formatDateTime(value: HomeInstant): string {
			const ms = toEpochMs(value);
			if (ms === null) return typeof value === 'string' ? value : EMPTY;
			return dateTimeFormatter(locale, timeZone).format(ms);
		},
		formatTimeZone(value: HomeInstant): string {
			const ms = toEpochMs(value);
			if (ms === null) return timeZone;
			return zoneLabel(locale, timeZone, ms);
		},
		formatInstant(value: HomeInstant): string {
			const ms = toEpochMs(value);
			if (ms === null) return typeof value === 'string' ? value : EMPTY;
			return `${dateTimeFormatter(locale, timeZone).format(ms)} ${zoneLabel(locale, timeZone, ms)}`;
		},
		formatRelative(value: number | null): string {
			if (value === null || !Number.isFinite(value)) return EMPTY;
			const elapsed = now() - value;
			// A timestamp ahead of the injected clock is reported as a
			// future span ("in 5 minutes"). The pre-adapter string
			// builder collapsed every future instant into "just now"
			// because each threshold was an upper bound, which hid a
			// counter that reads ahead of the client clock.
			const sign = elapsed >= 0 ? -1 : 1;
			const magnitude = Math.abs(elapsed);
			const rtf = relativeFormatter(locale);
			if (magnitude < MINUTE_MS) return nowRelativeFormatter(locale).format(0, 'second');
			if (magnitude < HOUR_MS) {
				return rtf.format(sign * Math.floor(magnitude / MINUTE_MS), 'minute');
			}
			if (magnitude < DAY_MS) return rtf.format(sign * Math.floor(magnitude / HOUR_MS), 'hour');
			return rtf.format(sign * Math.floor(magnitude / DAY_MS), 'day');
		},
	};
}
