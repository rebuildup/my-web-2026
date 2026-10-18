/**
 * Privacy projection vocabulary + leak detector (Issue #511).
 *
 * Why this exists
 * ---------------
 * `docs/personal/knowledge-model.md` separates **truth authority**
 * from **publication authority**: a fact can be true for the owner
 * and still be unpublishable. The location / activity / calendar
 * slice is exactly that case — the owner's current place and the
 * private half of a schedule are `private` by default, so they must
 * not reach a public surface. When publication is private the surface
 * still has to say something (the public alternative display); it
 * must not fall back to leaking the private record.
 *
 * The three public surfaces the owner-approved rule applies to are
 * the ones that exist today:
 *
 *   1. public SSR HTML (including the loader payload TanStack Start
 *      serialises into the document),
 *   2. `/api/v1/*` JSON bodies,
 *   3. the GA4 analytics payload.
 *
 * This module is **test-owned**: it is the vocabulary the contract
 * suite is written against, not production behaviour. Nothing under
 * `src/**` imports it, so no architecture edge is created
 * (AGENTS.md §3 — the obligation graph is unchanged).
 *
 * Non-vacuity
 * -----------
 * A leak assertion over "the site does not have a location feature
 * yet" would pass for any detector, including a broken one. The
 * fixtures below therefore exist in pairs:
 *
 *   - `PRIVATE_OWNER_RECORD` — the owner-unapproved record, the
 *     shape a future feature must never forward. The detector MUST
 *     flag it (the 不正常 / failing fixture).
 *   - `PUBLIC_FALLBACK_PROJECTION` — what the same surface shows
 *     when the record is private: a coarse public statement and no
 *     coordinates. The detector MUST NOT flag it (the 正常 fixture),
 *     and the statement must stay non-empty so "private" never
 *     degrades into "blank".
 *
 * A detector change that weakens either half fails this file.
 */

/** Which detector rule fired. */
export type PrivacyLeakRule =
	/** A JSON object key, or a `"key":` pair inside embedded JSON text. */
	| 'field-key'
	/** An HTML attribute name (`data-latitude`, `data-longitude`, ...). */
	| 'attribute'
	/** A latitude/longitude-shaped number pair. */
	| 'coordinate-pair'
	/** A `geo:<lat>,<lng>` URI. */
	| 'geo-uri';

export interface PrivacyLeak {
	rule: PrivacyLeakRule;
	/** JSON pointer-ish path for structured payloads; a character offset for text. */
	at: string;
	/** The offending fragment only. Never a whole payload. */
	detail: string;
}

/**
 * Field names that describe a *position*. Owner-unapproved by
 * default: a coarse "which city" answer is a publication decision,
 * not something a payload shape gets to decide by accident.
 */
const POSITION_TOKENS: readonly string[] = [
	'latitude',
	'lat',
	'longitude',
	'lng',
	'lon',
	'coordinates',
	'coords',
	'geolocation',
	'geoposition',
	'gps',
	'accuracy',
	'altitude',
];

/**
 * Field names that describe a *place the owner goes* or the
 * private half of a schedule. Same publication rule as above.
 */
const PLACE_TOKENS: readonly string[] = ['venue', 'location', 'address', 'placename'];

/**
 * Field names that describe the private half of an activity /
 * calendar entry: the event's own name and its schedule window.
 * A public "Activity" projection is a timeline of shipped work, not
 * an appointment book.
 */
const SCHEDULE_TOKENS: readonly string[] = ['event', 'appointment', 'calendar', 'schedule'];

/**
 * Whole names (separators removed, lowercased) that are private on
 * their own. `eventTitle` normalises to `eventtitle`; token matching
 * alone would split it into `event` + `title` and miss it.
 */
const PRIVATE_NAMES: ReadonlySet<string> = new Set([
	'latitude',
	'longitude',
	'lat',
	'lng',
	'lon',
	'coordinates',
	'coords',
	'geolocation',
	'geoposition',
	'gps',
	'accuracy',
	'altitude',
	'bearing',
	'heading',
	'venue',
	'location',
	'locationname',
	'placename',
	'streetaddress',
	'address',
	'eventtitle',
	'eventname',
	'privateevent',
	'calendarevent',
	'calendartitle',
	'calendarid',
	'scheduletitle',
	'scheduleentry',
	'appointment',
	'appointmentat',
	'startsat',
	'endsat',
]);

/**
 * Individual tokens that are private wherever they appear, so a
 * namespaced field (`data-latitude`, `userLatitude`,
 * `current_venue`) is caught without a whole-name match.
 *
 * The list is fail-closed on purpose: `locationLabel` is flagged even
 * though a coarse label could in principle be published, because the
 * decision to publish a place belongs to the owner (publication
 * authority in `docs/personal/knowledge-model.md`), not to a field
 * name. A false negative republishes a real position; a false
 * positive is a field a future implementation renames deliberately.
 */
export const PRIVATE_FIELD_TOKENS: ReadonlySet<string> = new Set([
	...POSITION_TOKENS,
	...PLACE_TOKENS,
	...SCHEDULE_TOKENS,
	...PRIVATE_NAMES,
]);

/**
 * Splits a field name into lowercase alphanumeric tokens.
 *
 * `data-latitude` -> `['data', 'latitude']`, `userLatitude` ->
 * `['user', 'latitude']`, `flat` -> `['flat']`. Splitting before
 * matching is what keeps `flat` (or `longitude` inside a longer
 * word such as `alongitude`) from being read as a coordinate field:
 * only a real token match is a leak.
 */
export function tokenizeFieldName(name: string): string[] {
	return name
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.filter((token) => token.length > 0)
		.map((token) => token.toLowerCase());
}

/** Removes separators and lowercases, so `event-Title` -> `eventtitle`. */
export function normaliseFieldName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when the field name itself is private, or any of its tokens is. */
export function isPrivateFieldName(name: string): boolean {
	if (PRIVATE_NAMES.has(normaliseFieldName(name))) return true;
	return tokenizeFieldName(name).some((token) => PRIVATE_FIELD_TOKENS.has(token));
}

/**
 * The owner-unapproved record: a real-time position plus a private
 * calendar entry. This is the 不正常 fixture — the detector must
 * flag it wherever it appears.
 *
 * The values are synthetic and local to this file: pattern-shaped
 * numbers (`12.3456` / `-98.7654`) that geocode nowhere meaningful,
 * and a venue that is not a real place. A fixture in a *privacy*
 * contract must not itself carry an approximation of where the owner
 * is — that would put the record this suite forbids onto the public
 * surface (the repository) in the name of testing for it.
 */
export const PRIVATE_OWNER_RECORD = {
	visibility: 'private' as const,
	location: {
		latitude: 12.3456,
		longitude: -98.7654,
		/** The GeoJSON / `geo:` shape: one string carrying both halves. */
		coordinates: '12.3456, -98.7654',
		accuracy: 12.5,
		capturedAt: '2026-10-18T09:12:00+09:00',
	},
	events: [
		{
			eventTitle: 'Pivot 406 private review',
			venue: 'Fixture Venue (架空の会場 / not a real place)',
			startsAt: '2026-10-18T13:00:00+09:00',
			endsAt: '2026-10-18T14:30:00+09:00',
		},
	],
} as const;

/**
 * The public alternative display for the same surface (正常
 * fixture): the capability exists and says what it is, with no
 * coordinates, no venue, and no schedule window.
 *
 * This mirrors what the home page already renders for the planned
 * `activity` capability (`planned` badge + one-line summary), which
 * is the shipped form of "private, and still a working surface".
 */
export const PUBLIC_FALLBACK_PROJECTION = {
	capability: 'activity',
	status: 'planned' as const,
	statementJa: '最近のコミット・リリース・出荷した仕事を 1 本のタイムラインに。',
	statementEn: 'Recent commits, releases, and shipped work in one timeline.',
	/** A `planned` capability exposes no deep link to an unpublished surface. */
	href: null,
} as const;

/**
 * A latitude / longitude shaped pair in free text.
 *
 * Three or more decimals, because that is the precision a real
 * position carries and ordinary content (versions, ratios, prices)
 * does not. Range is validated by the caller: `133.42` alone is a
 * longitude, and the pair order decides which is which.
 */
const COORDINATE_PAIR = /(?<![\w.])-?\d{1,3}\.\d{3,}\s*[,、]\s*-?\d{1,3}\.\d{3,}(?![\w.])/g;
const GEO_URI = /geo:(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/g;
/**
 * `"latitude":` / `"eventTitle":` — JSON keys inside serialised
 * payloads.
 *
 * Known limitation (precision over recall, documented rather than
 * fixed): the rule requires a **quoted** key. An unquoted JS literal
 * * (`{latitude:12.3456,longitude:-98.7654}`) inside a `<script>` is
 * therefore invisible to this rule; only the coordinate-pair rule
 * would still catch it, and only if it carries 3+ decimals. Today
 * TanStack Start serialises JSON, so the JSON shape is what arrives
 * on the public surface — but a future serialiser that emits an
 * object literal would silently narrow rule 1. Treat a change of
 * serialiser as a change to this rule.
 */
const SERIALISED_KEY = /"([^"\\]{1,64})"\s*:/g;
/** `<div ...>` — a tag and its attribute block. */
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
/** `name="value"` inside a tag block. */
const ATTRIBUTE = /([a-zA-Z_:][a-zA-Z0-9:_.-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
/**
 * `<style>` bodies are dropped before the free-text rules run.
 *
 * The shipped Panda CSS is inlined into every SSR document and it
 * carries numeric pairs of its own (`cubic-bezier(0.175, 0.885,
 * 0.32, 1.5)`) that look exactly like a coordinate pair. A style
 * sheet is build output, not owner data; scanning it would make the
 * detector cry wolf on every page.
 */
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style>/gi;

/**
 * Attribute values that can legitimately carry a link or a machine
 * readable payload. `class`, `style` and `id` are deliberately not
 * scanned: they are presentational, and the class list is the
 * loudest false-positive source in this document shape.
 */
const SCANNED_VALUE_ATTRIBUTES: ReadonlySet<string> = new Set([
	'href',
	'src',
	'content',
	'value',
	'itemprop',
	'poster',
]);

/**
 * A leak found inside a coordinate-shaped pair, or `null` when the
 * pair is not a position (two long decimals that are neither a
 * latitude nor a longitude in either order).
 */
function coordinateLeak(match: string, offset: number): PrivacyLeak | null {
	const [first, second] = match.split(/[,、]/).map((part) => Number.parseFloat(part.trim()));
	if (Number.isNaN(first) || Number.isNaN(second)) return null;
	// Either order is a position pair; the leak is reported without
	// claiming which half is which, because a `lng, lat` payload is
	// just as much of a leak as a `lat, lng` one.
	const shaped =
		(Math.abs(first) <= 90 && Math.abs(second) <= 180) ||
		(Math.abs(second) <= 90 && Math.abs(first) <= 180);
	return shaped ? { rule: 'coordinate-pair', at: `offset ${offset}`, detail: match } : null;
}

/**
 * Scans raw text (SSR HTML, an inline analytics script, a serialised
 * loader payload) for owner-unapproved data.
 *
 * Independent rules, because a leak only has to trip one:
 *
 *   - serialised JSON keys (`"latitude":`) anywhere in the text,
 *   - HTML attribute NAMES (`data-latitude="…"`),
 *   - link-ish attribute VALUES (`href="geo:33.9,131.4"`),
 *   - coordinate pairs and `geo:` URIs in the remaining text.
 *
 * Precision over recall is deliberate for attribute names: the
 * detector reads real tag structure instead of scanning for
 * space-delimited words, so a Panda class token like `ff_heading`
 * cannot masquerade as a `heading` field.
 */
export function findTextLeaks(text: string): PrivacyLeak[] {
	const leaks: PrivacyLeak[] = [];
	const withoutStyles = text.replace(STYLE_BLOCK, '');

	for (const match of withoutStyles.matchAll(SERIALISED_KEY)) {
		const key = match[1];
		if (isPrivateFieldName(key)) {
			leaks.push({
				rule: 'field-key',
				at: `serialised key "${key}"`,
				detail: `"${key}":`,
			});
		}
	}

	for (const match of withoutStyles.matchAll(COORDINATE_PAIR)) {
		const leak = coordinateLeak(match[0], match.index ?? 0);
		if (leak) leaks.push(leak);
	}

	for (const match of withoutStyles.matchAll(GEO_URI)) {
		leaks.push({ rule: 'geo-uri', at: `offset ${match.index ?? 0}`, detail: match[0] });
	}

	for (const tag of withoutStyles.matchAll(TAG)) {
		const tagName = tag[1];
		for (const attribute of tag[2].matchAll(ATTRIBUTE)) {
			const name = attribute[1];
			if (isPrivateFieldName(name)) {
				leaks.push({ rule: 'attribute', at: `<${tagName} ${name}>`, detail: name });
				continue;
			}
			const lowerName = name.toLowerCase();
			if (!SCANNED_VALUE_ATTRIBUTES.has(lowerName) && !lowerName.startsWith('data-')) {
				continue;
			}
			const value = attribute[2].replace(/^["']|["']$/g, '');
			for (const leak of findValueLeaks(value)) {
				leaks.push({ ...leak, at: `<${tagName} ${name}> (${leak.at})` });
			}
		}
	}

	return leaks;
}

/**
 * The value-shaped rules only: a coordinate pair or a `geo:` URI.
 *
 * Split out so an attribute value can be scanned without re-running
 * the key rules over a presentational class list.
 */
export function findValueLeaks(value: string): PrivacyLeak[] {
	const leaks: PrivacyLeak[] = [];
	for (const match of value.matchAll(COORDINATE_PAIR)) {
		const leak = coordinateLeak(match[0], match.index ?? 0);
		if (leak) leaks.push(leak);
	}
	for (const match of value.matchAll(GEO_URI)) {
		leaks.push({ rule: 'geo-uri', at: `offset ${match.index ?? 0}`, detail: match[0] });
	}
	return leaks;
}

/**
 * Scans a parsed JSON payload for owner-unapproved data.
 *
 * Object keys are matched by token, and every string / number leaf
 * is additionally scanned with the free-text rules so a position
 * hidden inside a serialised blob is caught too.
 */
export function findJsonLeaks(value: unknown, path = '$'): PrivacyLeak[] {
	const leaks: PrivacyLeak[] = [];

	if (value === null || value === undefined) return leaks;

	if (Array.isArray(value)) {
		value.forEach((entry, index) => {
			leaks.push(...findJsonLeaks(entry, `${path}[${index}]`));
		});
		return leaks;
	}

	if (typeof value === 'object') {
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (isPrivateFieldName(key)) {
				leaks.push({ rule: 'field-key', at: `${path}.${key}`, detail: key });
			}
			leaks.push(...findJsonLeaks(entry, `${path}.${key}`));
		}
		return leaks;
	}

	if (typeof value === 'string' || typeof value === 'number') {
		const text = String(value);
		for (const leak of findValueLeaks(text)) {
			leaks.push({ ...leak, at: `${path} (${leak.at})` });
		}
	}

	return leaks;
}

/**
 * One-line summary for an assertion message. Leaks, if any, are the
 * whole reason a contract failed — printing the surface payload
 * alongside them would republish it into CI logs.
 */
export function formatLeaks(leaks: readonly PrivacyLeak[]): string {
	if (leaks.length === 0) return 'no owner-unapproved data found';
	return leaks.map((leak) => `${leak.rule} @ ${leak.at}: ${leak.detail}`).join('; ');
}
