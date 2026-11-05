/**
 * Derived values for the current-projects section (Issue #316).
 *
 * What is derived here, and why that matters
 * ------------------------------------------
 * A duration ("1 か月") and a relative day ("今日") are computed from a
 * stored date and a base date. They change when the calendar moves even
 * though the record did not, so they are NOT data changes: the motion
 * contract (`MOTION-DESIGN-current-location.md` §0) forbids animating
 * them, and the change-signature in `use-changed-projects.ts` excludes
 * them. Keeping the arithmetic in one small module is what makes that
 * exclusion reviewable.
 *
 * Everything is UTC and `YYYY-MM-DD`
 * ----------------------------------
 * A date in this section is a calendar day the owner wrote down, not an
 * instant. Parsing it as UTC midnight makes "days between" independent of
 * the visitor's time zone, so two readers on either side of the date line
 * see the same "3 日前" for the same record.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * Parse a `YYYY-MM-DD` string into a UTC date.
 *
 * Returns `null` for anything that is not a real calendar day: a wrong
 * shape, a month outside 1–12, or a day the month does not have
 * (`2026-02-30`). `new Date('2026-02-30')` silently rolls over to March,
 * which would turn a typo into a plausible-looking date, so the rollover
 * is detected and refused.
 */
export function parseIsoDate(value: string): Date | null {
	const match = ISO_DATE.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return date;
}

/** Whether `value` is a real calendar day in `YYYY-MM-DD` form. */
export function isValidIsoDate(value: string): boolean {
	return parseIsoDate(value) !== null;
}

/**
 * Whole days from `from` to `to`. Negative when `to` precedes `from`,
 * `NaN` when either date is not valid.
 */
export function daysBetween(from: string, to: string): number {
	const start = parseIsoDate(from);
	const end = parseIsoDate(to);
	if (!start || !end) return Number.NaN;
	return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

/**
 * Compare two `YYYY-MM-DD` strings: negative when `a` is earlier, positive
 * when later, `0` when equal or unparseable-and-equal.
 */
export function compareIsoDates(a: string, b: string): number {
	// `daysBetween(b, a)` is `a - b`, i.e. negative when `a` is the earlier
	// day — the sign this function documents. (`daysBetween(a, b)` would
	// answer the opposite question.)
	const difference = daysBetween(b, a);
	if (Number.isNaN(difference)) return a < b ? -1 : a > b ? 1 : 0;
	if (difference < 0) return -1;
	return difference > 0 ? 1 : 0;
}

/**
 * Whole calendar months from `from` to `to`, rounded down.
 *
 * Calendar months, not 30-day blocks: `2026-09-11 → 2026-11-01` is one
 * month and some days, and "1 か月" is what a reader would say. A day
 * earlier than the start day does not complete the month
 * (`2026-01-31 → 2026-02-28` is 0 months, not 1).
 */
function wholeMonths(from: Date, to: Date): number {
	let months =
		(to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
	if (to.getUTCDate() < from.getUTCDate()) months -= 1;
	return months;
}

/**
 * How long a project has been going, as a reader would say it.
 *
 * `当日` / `N 日` / `N か月` / `N 年 M か月`. Returns `null` when either
 * date is unusable or the duration would be negative — the caller then
 * omits the duration rather than printing a wrong one.
 */
export function formatDuration(from: string, today: string): string | null {
	const start = parseIsoDate(from);
	const end = parseIsoDate(today);
	if (!start || !end) return null;
	const days = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
	if (days < 0) return null;
	if (days === 0) return '当日';
	const months = wholeMonths(start, end);
	if (months < 1) return `${days} 日`;
	if (months < 12) return `${months} か月`;
	const years = Math.floor(months / 12);
	const rest = months % 12;
	return rest === 0 ? `${years} 年` : `${years} 年 ${rest} か月`;
}

/**
 * How long ago a day was, as a reader would say it.
 *
 * `今日` / `昨日` / `N 日前`. Returns `null` for a future or unusable
 * date; the caller then shows the absolute date alone. There is no
 * "N 週間前" / "N か月前" tier on purpose: the absolute date is always
 * printed next to this value, so the relative form only has to help the
 * reader see "this is today" or "this is not today".
 */
export function formatRelativeDay(value: string, today: string): string | null {
	const days = daysBetween(value, today);
	if (!Number.isFinite(days) || days < 0) return null;
	if (days === 0) return '今日';
	if (days === 1) return '昨日';
	return `${days} 日前`;
}

/**
 * Group the integer part with commas (`2424` → `2,424`).
 *
 * Hand-rolled rather than `Intl.NumberFormat` because the grouping is
 * part of the published wording and must not change with the runtime's
 * locale data — the same record has to read the same in the Worker, in a
 * test and in a preview.
 */
export function formatCount(value: number): string {
	if (!Number.isFinite(value)) return '';
	const rounded = Math.trunc(value);
	const sign = rounded < 0 ? '-' : '';
	return `${sign}${Math.abs(rounded)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
