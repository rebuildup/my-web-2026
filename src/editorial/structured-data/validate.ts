import {
	CANONICAL_ORIGIN,
	KNOWN_STRUCTURED_DATA_TYPES,
	PERSON_UNAPPROVED_PROPERTIES,
} from './contract';
import { type JsonLdNode, SCHEMA_ORG_CONTEXT } from './types';

/**
 * Structured-data validator (Issue #422).
 *
 * ## What this validates — and what it deliberately does not
 *
 * This validator answers exactly one question: **does the document
 * obey the contract this repository declares?** It checks the
 * `@context`, the closed set of `@type` values, the required
 * properties per type, URL absoluteness and origin, date precision
 * and format, `@id` resolvability, and the list of Person
 * properties that must not be emitted without a record behind them.
 *
 * It does **not** answer "will Google show a rich result for this".
 * That is a different system with a different input (the rendered
 * page, Google's own type list, freshness and quality rules) and a
 * different failure mode (no error at all — just no enhancement).
 * Conflating the two is how a site ends up claiming eligibility it
 * never tested, so `StructuredDataValidation.richResults` always
 * reports `evaluated: false` with the reason attached, and the
 * report renders that verdict instead of hiding it.
 *
 * ## Precision over recall (why this is not a generic JSON-LD checker)
 *
 * Every rule below exists because the corresponding mistake was
 * plausible for this repository's own data. Each has a negative
 * control in `validate.test.ts`, so the validator cannot pass by
 * accepting everything.
 *
 * Cross-references:
 *   - `contract.json` — canonical origin, known types, withheld facts
 *   - `docs/personal/domain.md` §15 — what must not be inferred
 *   - `docs/personal/knowledge-model.md` — date precision semantics
 */

/** A single validation error. `code` is stable; `message` is prose. */
export interface StructuredDataFinding {
	readonly code: string;
	readonly type: string | null;
	/** Location inside the document, e.g. `Person.sameAs[1]`. */
	readonly pointer: string;
	readonly message: string;
}

/**
 * The Rich Results verdict. Permanently `evaluated: false` — this
 * module has no access to Google's validator and no authority to
 * speak for it.
 */
export interface RichResultsVerdict {
	readonly evaluated: false;
	readonly reason: string;
	readonly reference: string;
}

/** Result of validating one document (an array of JSON-LD nodes). */
export interface StructuredDataValidation {
	readonly valid: boolean;
	readonly findings: readonly StructuredDataFinding[];
	readonly richResults: RichResultsVerdict;
}

/** Caller-supplied policy for checks that need approved values. */
export interface StructuredDataPolicy {
	/**
	 * The `sameAs` URLs the repository has approved. Any `sameAs`
	 * entry outside this list is an error: an identity URL is a
	 * personal fact, and inventing one is exactly the failure this
	 * Issue exists to catch.
	 */
	readonly approvedSameAs?: readonly string[];
}

const RESERVED_KEYS = new Set(['@context', '@type', '@id']);

const ISO_YEAR = /^\d{4}$/;
const ISO_YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Validate every JSON-LD node extracted from one rendered document.
 *
 * `nodes` is the parsed content of all
 * `<script type="application/ld+json">` tags on the page, in
 * document order.
 */
export function validateStructuredData(
	nodes: readonly unknown[],
	policy: StructuredDataPolicy = {},
): StructuredDataValidation {
	const findings: StructuredDataFinding[] = [];

	if (!Array.isArray(nodes)) {
		findings.push(finding('document-not-array', null, '$', 'expected an array of JSON-LD nodes'));
		return result(findings);
	}

	// Pass 1 — identifiers a bare reference is allowed to point at.
	// A reference resolves when SOME node in the same document both
	// declares the `@id` and is itself typed; an untyped `{"@id"}`
	// pointing nowhere is a dangling reference.
	const definedIds = new Set<string>();
	for (const node of nodes) {
		if (!isRecord(node)) continue;
		const id = node['@id'];
		if (typeof id === 'string' && typeof node['@type'] === 'string') definedIds.add(id);
	}

	nodes.forEach((node, index) => {
		validateNode(node, `$[${index}]`, definedIds, policy, findings);
	});

	return result(findings);
}

function validateNode(
	node: unknown,
	pointer: string,
	definedIds: ReadonlySet<string>,
	policy: StructuredDataPolicy,
	findings: StructuredDataFinding[],
): void {
	if (!isRecord(node)) {
		findings.push(finding('node-not-object', null, pointer, 'JSON-LD node must be an object'));
		return;
	}

	const type = node['@type'];
	const typeLabel = typeof type === 'string' ? type : null;

	if (node['@context'] !== SCHEMA_ORG_CONTEXT) {
		findings.push(
			finding(
				'context',
				typeLabel,
				`${pointer}.@context`,
				`@context must be the exact string "${SCHEMA_ORG_CONTEXT}"`,
			),
		);
	}

	if (typeof type !== 'string') {
		findings.push(finding('missing-type', null, `${pointer}.@type`, '@type must be a string'));
	} else if (!KNOWN_STRUCTURED_DATA_TYPES.includes(type)) {
		findings.push(
			finding(
				'unknown-type',
				type,
				`${pointer}.@type`,
				`@type "${type}" is not declared in contract.json#knownTypes — an undeclared type is a silent gap, not a pass`,
			),
		);
	}

	if ('@id' in node) {
		const id = node['@id'];
		if (typeof id !== 'string' || !isAbsoluteHttpsUrl(id)) {
			findings.push(
				finding('invalid-id', typeLabel, `${pointer}.@id`, '@id must be an absolute https URL'),
			);
		}
	}

	for (const [key, value] of Object.entries(node)) {
		if (key.startsWith('@') && !RESERVED_KEYS.has(key)) {
			findings.push(
				finding('reserved-property', typeLabel, `${pointer}.${key}`, 'unknown reserved key'),
			);
		}
		if (typeof value === 'string' && value.trim() === '') {
			findings.push(
				finding('empty-value', typeLabel, `${pointer}.${key}`, 'value must not be empty'),
			);
		}
	}

	validateReferences(node, pointer, definedIds, findings);

	switch (type) {
		case 'Person':
			validatePerson(node, pointer, policy, findings);
			break;
		case 'CreativeWork':
			validateCreativeWork(node, pointer, findings);
			break;
		case 'BreadcrumbList':
			validateBreadcrumbList(node, pointer, findings);
			break;
		default:
			break;
	}
}

function validatePerson(
	node: JsonLdNode,
	pointer: string,
	policy: StructuredDataPolicy,
	findings: StructuredDataFinding[],
): void {
	for (const key of PERSON_UNAPPROVED_PROPERTIES.map((entry) => entry.property)) {
		if (key in node) {
			const reason = PERSON_UNAPPROVED_PROPERTIES.find((entry) => entry.property === key)?.reason;
			findings.push(
				finding(
					'unapproved-property',
					'Person',
					`${pointer}.${key}`,
					`Person.${key} has no verified record behind it and must not be emitted — ${reason ?? 'see contract.json#person.unapprovedProperties'}`,
				),
			);
		}
	}

	requireNonEmptyString(node, 'name', 'Person', pointer, findings);
	requireCanonicalUrl(node, 'url', 'Person', pointer, findings);

	const sameAs = node.sameAs;
	if (!Array.isArray(sameAs) || sameAs.length === 0) {
		findings.push(
			finding(
				'missing-required',
				'Person',
				`${pointer}.sameAs`,
				'Person.sameAs must list at least one approved external profile URL',
			),
		);
		return;
	}

	const approved = policy.approvedSameAs;
	sameAs.forEach((value, index) => {
		const at = `${pointer}.sameAs[${index}]`;
		if (typeof value !== 'string' || !isAbsoluteHttpsUrl(value)) {
			findings.push(
				finding('invalid-url', 'Person', at, 'sameAs entries must be absolute https URLs'),
			);
			return;
		}
		if (approved && !approved.includes(value)) {
			findings.push(
				finding(
					'unapproved-same-as',
					'Person',
					at,
					`${value} is not an approved external handle — identity URLs are personal facts and may not be invented`,
				),
			);
		}
	});

	if ('alternateName' in node) {
		const value = node.alternateName;
		const ok =
			(typeof value === 'string' && value.trim() !== '') ||
			(Array.isArray(value) &&
				value.length > 0 &&
				value.every((entry) => typeof entry === 'string' && entry.trim() !== ''));
		if (!ok) {
			findings.push(
				finding(
					'invalid-value',
					'Person',
					`${pointer}.alternateName`,
					'alternateName must be a non-empty string or a non-empty array of strings',
				),
			);
		}
	}
}

function validateCreativeWork(
	node: JsonLdNode,
	pointer: string,
	findings: StructuredDataFinding[],
): void {
	requireNonEmptyString(node, 'name', 'CreativeWork', pointer, findings);
	requireNonEmptyString(node, 'description', 'CreativeWork', pointer, findings);
	requireCanonicalUrl(node, 'url', 'CreativeWork', pointer, findings);

	const url = node.url;
	if (typeof url === 'string' && isAbsoluteHttpsUrl(url)) {
		if (!url.startsWith(`${CANONICAL_ORIGIN}/portfolio/`)) {
			findings.push(
				finding(
					'off-canonical-origin',
					'CreativeWork',
					`${pointer}.url`,
					`a CreativeWork url must live under ${CANONICAL_ORIGIN}/portfolio/, saw ${url}`,
				),
			);
		}
	}

	const author = node.author;
	if (!isRecord(author)) {
		findings.push(
			finding(
				'missing-required',
				'CreativeWork',
				`${pointer}.author`,
				'CreativeWork.author must be an inline Person node, not a bare reference',
			),
		);
	} else {
		if (author['@type'] !== 'Person') {
			findings.push(
				finding(
					'invalid-value',
					'CreativeWork',
					`${pointer}.author.@type`,
					`author must be typed "Person", saw ${JSON.stringify(author['@type'])}`,
				),
			);
		}
		if (!isNonEmptyString(author.name)) {
			findings.push(
				finding(
					'missing-required',
					'CreativeWork',
					`${pointer}.author.name`,
					'author.name must be a non-empty string',
				),
			);
		}
		const authorUrl = author.url;
		if (typeof authorUrl !== 'string' || !isAbsoluteHttpsUrl(authorUrl)) {
			findings.push(
				finding(
					'invalid-url',
					'CreativeWork',
					`${pointer}.author.url`,
					'author.url must be an absolute https URL',
				),
			);
		} else if (!authorUrl.startsWith(CANONICAL_ORIGIN)) {
			findings.push(
				finding(
					'off-canonical-origin',
					'CreativeWork',
					`${pointer}.author.url`,
					`author.url must live on the canonical origin, saw ${authorUrl}`,
				),
			);
		}
	}

	for (const key of ['dateCreated', 'dateModified'] as const) {
		if (!(key in node)) continue;
		const value = node[key];
		if (typeof value !== 'string' || !isSchemaDate(value)) {
			findings.push(
				finding(
					'invalid-date',
					'CreativeWork',
					`${pointer}.${key}`,
					`${key} must be a real calendar date at a precision the source actually records (YYYY, YYYY-MM, YYYY-MM-DD or UTC date-time), saw ${JSON.stringify(value)}`,
				),
			);
		}
	}

	if ('image' in node) {
		const image = node.image;
		if (typeof image !== 'string' || !isAbsoluteHttpsUrl(image)) {
			findings.push(
				finding(
					'invalid-url',
					'CreativeWork',
					`${pointer}.image`,
					'image must be an absolute https URL',
				),
			);
		}
	}
}

function validateBreadcrumbList(
	node: JsonLdNode,
	pointer: string,
	findings: StructuredDataFinding[],
): void {
	const items = node.itemListElement;
	if (!Array.isArray(items) || items.length === 0) {
		findings.push(
			finding(
				'missing-required',
				'BreadcrumbList',
				`${pointer}.itemListElement`,
				'BreadcrumbList.itemListElement must be a non-empty array',
			),
		);
		return;
	}

	items.forEach((item, index) => {
		const at = `${pointer}.itemListElement[${index}]`;
		if (!isRecord(item)) {
			findings.push(finding('node-not-object', 'BreadcrumbList', at, 'item must be an object'));
			return;
		}
		if (item['@type'] !== 'ListItem') {
			findings.push(
				finding('invalid-value', 'BreadcrumbList', `${at}.@type`, 'item @type must be "ListItem"'),
			);
		}
		// Positions are 1-based and must be sequential — an off-by-one
		// breadcrumb is still parseable by consumers, so nothing else
		// would catch it.
		if (item.position !== index + 1) {
			findings.push(
				finding(
					'invalid-value',
					'BreadcrumbList',
					`${at}.position`,
					`position must be ${index + 1} (1-based, sequential), saw ${JSON.stringify(item.position)}`,
				),
			);
		}
		if (!isNonEmptyString(item.name)) {
			findings.push(
				finding(
					'missing-required',
					'BreadcrumbList',
					`${at}.name`,
					'item name must be a non-empty string',
				),
			);
		}
		const target = item.item;
		if (typeof target !== 'string' || !isAbsoluteHttpsUrl(target)) {
			findings.push(
				finding(
					'invalid-url',
					'BreadcrumbList',
					`${at}.item`,
					'item url must be an absolute https URL',
				),
			);
		} else if (!target.startsWith(CANONICAL_ORIGIN)) {
			findings.push(
				finding(
					'off-canonical-origin',
					'BreadcrumbList',
					`${at}.item`,
					`breadcrumb item must live on the canonical origin, saw ${target}`,
				),
			);
		}
	});
}

/**
 * Walk the node and reject `{"@id"}` references that no typed node
 * in the same document declares.
 */
function validateReferences(
	node: JsonLdNode,
	pointer: string,
	definedIds: ReadonlySet<string>,
	findings: StructuredDataFinding[],
): void {
	for (const [key, value] of Object.entries(node)) {
		const at = `${pointer}.${key}`;
		if (Array.isArray(value)) {
			value.forEach((entry, index) => {
				if (isRecord(entry)) validateReferences(entry, `${at}[${index}]`, definedIds, findings);
			});
			continue;
		}
		if (!isRecord(value)) continue;
		if (typeof value['@id'] === 'string' && typeof value['@type'] !== 'string') {
			if (!definedIds.has(value['@id'])) {
				findings.push(
					finding(
						'dangling-reference',
						null,
						`${at}.@id`,
						`${value['@id']} is referenced but no node in this document declares it`,
					),
				);
			}
		}
		validateReferences(value, at, definedIds, findings);
	}
}

function requireNonEmptyString(
	node: JsonLdNode,
	key: string,
	type: string,
	pointer: string,
	findings: StructuredDataFinding[],
): void {
	if (!isNonEmptyString(node[key])) {
		findings.push(
			finding(
				'missing-required',
				type,
				`${pointer}.${key}`,
				`${type}.${key} must be a non-empty string`,
			),
		);
	}
}

function requireCanonicalUrl(
	node: JsonLdNode,
	key: string,
	type: string,
	pointer: string,
	findings: StructuredDataFinding[],
): void {
	const value = node[key];
	if (typeof value !== 'string' || !isAbsoluteHttpsUrl(value)) {
		findings.push(
			finding(
				'invalid-url',
				type,
				`${pointer}.${key}`,
				`${type}.${key} must be an absolute https URL`,
			),
		);
		return;
	}
	if (!value.startsWith(CANONICAL_ORIGIN)) {
		findings.push(
			finding(
				'off-canonical-origin',
				type,
				`${pointer}.${key}`,
				`${type}.${key} must live on the canonical origin ${CANONICAL_ORIGIN}, saw ${value}`,
			),
		);
	}
}

/**
 * Accept only date strings that (a) match a schema.org date lexical
 * form and (b) name a day that actually exists. `2026-02-31` parses
 * in JavaScript by rolling over to March, so a format-only check
 * would let an impossible date through.
 */
export function isSchemaDate(value: string): boolean {
	if (
		!ISO_YEAR.test(value) &&
		!ISO_YEAR_MONTH.test(value) &&
		!ISO_DATE.test(value) &&
		!ISO_DATE_TIME.test(value)
	) {
		return false;
	}
	if (ISO_YEAR.test(value)) return Number(value) > 0;
	const normalized =
		value.length === 7 ? `${value}-01` : value.length === 10 ? `${value}T00:00:00.000Z` : value;
	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) return false;
	return parsed.toISOString().slice(0, 10) === normalized.slice(0, 10);
}

function isAbsoluteHttpsUrl(value: string): boolean {
	if (!value.startsWith('https://')) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.hostname.length > 0;
	} catch {
		return false;
	}
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is JsonLdNode {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finding(
	code: string,
	type: string | null,
	pointer: string,
	message: string,
): StructuredDataFinding {
	return { code, type, pointer, message };
}

function result(findings: readonly StructuredDataFinding[]): StructuredDataValidation {
	return {
		valid: findings.length === 0,
		findings,
		richResults: {
			evaluated: false,
			reason:
				'schema validity と Rich Results 対応は別系統。Google の対応種別判定・表示要件・品質ルールはこの validator の対象外であり、本リポジトリは Rich Results 対応ことを主張しない。',
			reference:
				'https://developers.google.com/search/docs/appearance/structured-data/search-gallery',
		},
	};
}
