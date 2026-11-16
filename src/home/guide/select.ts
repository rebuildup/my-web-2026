/**
 * Guide selection — which ledger entries the home guide publishes
 * today (Issue #929).
 *
 * Pure functions of `(ledger, today)`: no clock, no fetch, no
 * environment. `today` is a `YYYY-MM-DD` string supplied by the
 * caller so the same input renders identically in a test, a story
 * and a request.
 *
 * Promotion semantics
 * -------------------
 * A promotion is an EMPHASIS, never a gate: inside its window the
 * entry is marked `featured` (the UI may raise it), outside the
 * window the entry keeps its permanent position. An invalid window
 * (end before start, malformed date) promotes NOTHING — fail closed,
 * because a typo must not silently pin a page forever.
 */

import { isValidIsoDate } from '../current/derive';
import type { GuideEntry } from './ledger';

/** The published shape of one guide row. */
export interface GuideRow {
	readonly entry: GuideEntry;
	/** True while the entry's promotion window covers `today`. */
	readonly featured: boolean;
}

/**
 * Whether `today` falls inside the promotion window, inclusive.
 * Malformed dates fail closed (never featured).
 */
export function isPromotionActive(
	promotion: { readonly startsOn: string; readonly endsOn: string } | undefined,
	today: string,
): boolean {
	if (!promotion) return false;
	if (!isValidIsoDate(today)) return false;
	if (!isValidIsoDate(promotion.startsOn) || !isValidIsoDate(promotion.endsOn)) return false;
	if (promotion.endsOn < promotion.startsOn) return false;
	return promotion.startsOn <= today && today <= promotion.endsOn;
}

/**
 * The guide rows for `today`, in ledger order.
 *
 * When several promotions overlap, the highest `priority` wins the
 * single featured slot; ties keep ledger order (first wins). At most
 * ONE row is featured — the section has one emphasis position, and
 * two pinned entries would cancel each other out visually.
 */
export function selectGuideRows(
	ledger: readonly GuideEntry[],
	today: string,
): readonly GuideRow[] {
	const active = ledger
		.map((entry, index) => ({ entry, index, priority: entry.promotion?.priority ?? 0 }))
		.filter(({ entry }) => isPromotionActive(entry.promotion, today));
	const winner = active.length
		? active.reduce((best, row) =>
				row.priority > best.priority ||
				(row.priority === best.priority && row.index < best.index)
					? row
					: best,
			)
		: null;
	return ledger.map((entry) => ({
		entry,
		featured: winner !== null && winner.entry === entry,
	}));
}

/**
 * Whether an href is a publishable site-internal path.
 * Same fail-closed rule as `isPublishableHref` in `current/source.ts`,
 * restated locally so the ledger module stays dependency-light: `/…`
 * but never `//…`, and never a backslash (browser-normalised to a
 * protocol-relative URL).
 */
export function isInternalGuideHref(href: string): boolean {
	const value = href.trim();
	if (value.includes('\\')) return false;
	if (!value.startsWith('/')) return false;
	return !value.startsWith('//');
}

/** Whether an href is a publishable external base URL. */
export function isExternalGuideHref(href: string): boolean {
	return href.trim().startsWith('https://');
}
