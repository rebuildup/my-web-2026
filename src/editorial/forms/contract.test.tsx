import { describe, expect, it } from 'vitest';
import {
	FIELD_DESCRIPTION_SUFFIX,
	FIELD_ERROR_SUFFIX,
	describeByTarget,
	fieldIdSet,
	hasDescription,
	hasError,
	invalidAttribute,
	presentMessage,
} from './contract';

/**
 * The field-association contract (Issue #404).
 *
 * The defect this module exists to prevent is subtle and was present
 * in every hand-wired form: a control whose `aria-describedby` names an
 * element the document does not contain. A sighted reviewer sees a
 * field with help text next to it and calls the form accessible; a
 * screen-reader user hears the label, focuses the field, and hears
 * nothing — which is indistinguishable from a form with no help text at
 * all. Every rule below is therefore about ids that EXIST, not ids
 * that were written down.
 */
describe('fieldIdSet', () => {
	it('derives control, description and error ids from one name', () => {
		expect(fieldIdSet('email')).toEqual({
			controlId: 'email',
			descriptionId: `email${FIELD_DESCRIPTION_SUFFIX}`,
			errorId: `email${FIELD_ERROR_SUFFIX}`,
		});
	});

	it('refuses an empty name instead of producing addressable-looking junk', () => {
		// `id="-error"` is a legal DOM id that a label can never
		// usefully reference and a summary link can never jump to.
		expect(() => fieldIdSet('')).toThrow(/non-empty name/);
	});

	it('keeps distinct fields on distinct ids', () => {
		const names = ['email', 'password', 'name', 'image'];
		const ids = names.flatMap((name) => Object.values(fieldIdSet(name)));
		expect(new Set(ids).size).toBe(names.length * 3);
	});
});

describe('presentMessage', () => {
	it('treats absent messages as absent', () => {
		expect(presentMessage(null)).toBeNull();
		expect(presentMessage(undefined)).toBeNull();
	});

	it('treats whitespace-only text as absent', () => {
		// A description that renders as an empty box is not an answer to
		// 「この入力には何を入れるのか」, and keeping it would leave the
		// control pointing at an element with nothing in it.
		expect(presentMessage('   ')).toBeNull();
		expect(presentMessage('\n\t')).toBeNull();
	});

	it('keeps real text and non-string nodes', () => {
		expect(presentMessage('  hint  ')).toBe('  hint  ');
		const node = <strong>hint</strong>;
		expect(presentMessage(node)).toBe(node);
	});

	it('reports presence for the two message kinds', () => {
		expect(hasDescription('hint')).toBe(true);
		expect(hasDescription('   ')).toBe(false);
		expect(hasDescription(undefined)).toBe(false);
		expect(hasError('refused')).toBe(true);
		expect(hasError('  ')).toBe(false);
		expect(hasError(null)).toBe(false);
	});
});

describe('describeByTarget', () => {
	const ids = fieldIdSet('email');

	it('returns nothing when the field has no messages', () => {
		expect(describeByTarget(ids, {})).toBeUndefined();
		expect(describeByTarget(ids, { description: null, error: null })).toBeUndefined();
	});

	it('references the description only when there is one', () => {
		expect(describeByTarget(ids, { description: 'hint' })).toBe('email-description');
		expect(describeByTarget(ids, { description: '  ' })).toBeUndefined();
	});

	it('references the error only when there is one', () => {
		expect(describeByTarget(ids, { error: 'refused' })).toBe('email-error');
		expect(describeByTarget(ids, { error: '' })).toBeUndefined();
	});

	it('orders description before error — reading order, not insertion order', () => {
		// 「Email」→ 何を入れるのか → なぜ拒否されたか. A caller that
		// passes the error first still gets the announced order a person
		// reads it in.
		expect(describeByTarget(ids, { error: 'refused', description: 'hint' })).toBe(
			'email-description email-error',
		);
	});
});

describe('invalidAttribute', () => {
	it('is present only while an error sentence exists', () => {
		expect(invalidAttribute('refused')).toBe('true');
		expect(invalidAttribute('')).toBeUndefined();
		expect(invalidAttribute('   ')).toBeUndefined();
		expect(invalidAttribute(null)).toBeUndefined();
		expect(invalidAttribute(undefined)).toBeUndefined();
	});
});
