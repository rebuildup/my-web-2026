import { describe, expect, it } from 'vitest';
import {
	PERSON_UNAPPROVED_PROPERTIES,
	buildPersonNode,
	validateStructuredData,
} from '../editorial/structured-data';
import { ABOUT_DATA } from './data';
import { personFactsFromAbout } from './structured-data';

/**
 * The real `/about` snapshot, projected and validated (Issue #422).
 *
 * This is the assertion the Issue asks for: the JSON-LD carries no
 * award, no education and no credential. The school name IS a real,
 * published fact — it is rendered by `<AboutPage />` from
 * `identity.role` — but a display string is not a record with a
 * period, so it stays out of the machine-readable graph.
 */

const facts = personFactsFromAbout(ABOUT_DATA);
const node = buildPersonNode(facts);

describe('/about → Person', () => {
	it('builds a node from the approved snapshot', () => {
		expect(node).not.toBeNull();
		expect(node?.['@type']).toBe('Person');
		expect(node?.name).toBe(ABOUT_DATA.identity.name);
		expect(node?.url).toBe('https://rebuildup.dev/about');
	});

	it('uses the approved handles as sameAs, verbatim', () => {
		expect(node?.sameAs).toEqual(ABOUT_DATA.externalHandles.map((handle) => handle.href));
	});

	it('validates clean against the approved handle list', () => {
		const validation = validateStructuredData([node], {
			approvedSameAs: ABOUT_DATA.externalHandles.map((handle) => handle.href),
		});
		expect(validation.findings).toEqual([]);
		expect(validation.valid).toBe(true);
	});

	it('emits none of the withheld properties', () => {
		for (const { property } of PERSON_UNAPPROVED_PROPERTIES) {
			expect(node).not.toHaveProperty(property);
		}
	});

	it('does not leak the display-only role string (school / grade) into the graph', () => {
		// `identity.role` carries 宇部高専 + 学年. It is rendered on the
		// page, and it is deliberately absent here: `jobTitle` /
		// `affiliation` would convert that sentence into a structured
		// employment / education claim.
		const serialised = JSON.stringify(node);
		expect(ABOUT_DATA.identity.role).toContain('宇部高専');
		expect(serialised).not.toContain('宇部高専');
		expect(serialised).not.toContain('本科4年');
	});
});
