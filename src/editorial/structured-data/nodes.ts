import { NODE_ID_FRAGMENTS } from './contract';
import {
	type CreativeWorkFacts,
	type CreativeWorkNode,
	type PersonFacts,
	type PersonNode,
	type PersonReferenceNode,
	SCHEMA_ORG_CONTEXT,
} from './types';

/**
 * JSON-LD node builders (Issue #422).
 *
 * Both builders are pure projections of already-approved facts. They
 * never fetch, never infer, and never widen precision: whatever the
 * caller hands over is what the node says.
 *
 * **Fail-closed**: a builder returns `null` only when the node would
 * be meaningless (no name / no URL). It never substitutes a
 * placeholder, so a caller that gets `null` has a fact problem to
 * fix rather than a broken document to ship.
 *
 * **Withheld properties are not here on purpose.** `award`,
 * `education`, `alumniOf`, `hasCredential`, `jobTitle`,
 * `affiliation` and `knowsAbout` exist only in
 * `contract.json#person.unapprovedProperties`; the validator treats
 * their presence as an error. See the reasons recorded there.
 */

/** Build the `Person` node, or `null` when the identity is unusable. */
export function buildPersonNode(facts: PersonFacts): PersonNode | null {
	const name = facts.name.trim();
	const url = facts.url.trim();
	if (name === '' || url === '') return null;

	const node: PersonNode = {
		'@context': SCHEMA_ORG_CONTEXT,
		'@type': 'Person',
		'@id': `${url}#${NODE_ID_FRAGMENTS.Person}`,
		name,
		url,
		sameAs: dedupe(facts.sameAs.map((href) => href.trim()).filter((href) => href !== '')),
	};

	const alternateName = dedupe(
		(facts.alternateName ?? []).map((value) => value.trim()).filter((value) => value !== ''),
	);
	if (alternateName.length > 0) node.alternateName = alternateName;

	const description = facts.description?.trim() ?? '';
	if (description !== '') node.description = description;

	return node;
}

/** Compact nested author node — the person reference a work points at. */
export function buildPersonReference(facts: PersonFacts): PersonReferenceNode | null {
	const name = facts.name.trim();
	const url = facts.url.trim();
	if (name === '' || url === '') return null;
	return {
		'@type': 'Person',
		'@id': `${url}#${NODE_ID_FRAGMENTS.Person}`,
		name,
		url,
	};
}

/**
 * Build the `CreativeWork` node, or `null` when the work is
 * unusable. The author is embedded inline (not referenced by a bare
 * `@id`) so the document resolves every identifier it declares.
 */
export function buildCreativeWorkNode(
	facts: CreativeWorkFacts,
	author: PersonFacts,
): CreativeWorkNode | null {
	const name = facts.name.trim();
	const description = facts.description.trim();
	const url = facts.url.trim();
	const authorNode = buildPersonReference(author);
	if (name === '' || description === '' || url === '' || authorNode === null) return null;

	const node: CreativeWorkNode = {
		'@context': SCHEMA_ORG_CONTEXT,
		'@type': 'CreativeWork',
		'@id': `${url}#${NODE_ID_FRAGMENTS.CreativeWork}`,
		name,
		description,
		url,
		author: authorNode,
	};

	if (facts.dateCreated) node.dateCreated = facts.dateCreated;
	if (facts.dateModified) node.dateModified = facts.dateModified;

	const image = facts.imageUrl?.trim() ?? '';
	if (image !== '') node.image = image;

	return node;
}

function dedupe(values: readonly string[]): string[] {
	return [...new Set(values)];
}
