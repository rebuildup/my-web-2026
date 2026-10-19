/**
 * Form-field association contract (Issue #404).
 *
 * Why this module exists
 * ----------------------
 * A form field is only usable by a screen-reader user when three
 * separate facts line up, and every form in this repository had been
 * wiring them by hand and getting a different subset right:
 *
 *   1. the LABEL points at the control (`<label for>` / `id`),
 *   2. the DESCRIPTION is announced with the control
 *      (`aria-describedby`),
 *   3. the ERROR is both announced with the control (`aria-describedby`
 *      + `aria-invalid`) and announced ONCE when it appears
 *      (a form-level summary).
 *
 * Hand-wiring those per form is how a form ends up describing an
 * element id that does not exist — `aria-describedby="x-error"` with
 * no `x-error` in the document is announced as silence, which reads to
 * a screen-reader user as "no help text", the same as a form with no
 * help text at all. This module is the single place that decides which
 * ids exist and which of them a control references, so an absent
 * message can never leave a dangling reference behind.
 *
 * It is deliberately free of React rendering: the rules are pure
 * string work, so they are testable without a renderer, and both the
 * field components and the tests read the same decision.
 */

import type { ReactNode } from 'react';

/** Suffix of the element that carries a field's help text. */
export const FIELD_DESCRIPTION_SUFFIX = '-description';

/** Suffix of the element that carries a field's error text. */
export const FIELD_ERROR_SUFFIX = '-error';

/**
 * The three ids one field owns.
 *
 * `controlId` is the field's stable identity: it is the `<label for>`
 * target, the summary link target (`#<controlId>`), and the input's
 * `id`. The other two are only rendered when the corresponding
 * message is non-empty.
 */
export interface FieldIdSet {
	controlId: string;
	descriptionId: string;
	errorId: string;
}

/**
 * The ids a field named `name` owns.
 *
 * The name doubles as the form control's `name` attribute, so a caller
 * never has to keep two identifiers in sync: `name="email"` always
 * yields `id="email"`, `email-description` and `email-error`.
 *
 * @throws when the name is empty — an empty `name` would produce
 * `id="-error"`, which is a legal-but-unaddressable id that a label
 * can never usefully reference.
 */
export function fieldIdSet(name: string): FieldIdSet {
	if (name.length === 0) {
		throw new Error('fieldIdSet: a form field needs a non-empty name');
	}
	return {
		controlId: name,
		descriptionId: `${name}${FIELD_DESCRIPTION_SUFFIX}`,
		errorId: `${name}${FIELD_ERROR_SUFFIX}`,
	};
}

/** The message-bearing inputs a control may reference. */
export interface FieldMessages {
	description?: ReactNode | null;
	error?: string | null;
}

/**
 * Normalise a caller-supplied message.
 *
 * Whitespace-only text is treated as absent: a description that renders
 * as an empty box is not an answer to "what does this field want?", and
 * keeping it would leave the control pointing at a description the
 * reader hears nothing from.
 */
export function presentMessage(message: ReactNode | null | undefined): ReactNode | null {
	if (message === null || message === undefined) return null;
	if (typeof message === 'string') return message.trim().length > 0 ? message : null;
	return message;
}

/** Whether a description will actually be rendered. */
export function hasDescription(description: ReactNode | null | undefined): boolean {
	return presentMessage(description) !== null;
}

/** Whether an error will actually be rendered. */
export function hasError(error: string | null | undefined): boolean {
	return typeof error === 'string' && error.trim().length > 0;
}

/**
 * The `aria-describedby` value a control carries, or `undefined` when
 * it references nothing.
 *
 * Order is description then error, which is reading order: what the
 * field wants, then why this value was refused. Only ids that are
 * actually rendered are listed — that is the whole point of routing
 * this decision through the contract instead of writing the attribute
 * inline.
 */
export function describeByTarget(ids: FieldIdSet, messages: FieldMessages): string | undefined {
	const parts: string[] = [];
	if (hasDescription(messages.description)) parts.push(ids.descriptionId);
	if (hasError(messages.error)) parts.push(ids.errorId);
	return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * The `aria-invalid` value for a control, or `undefined` when the
 * control is not in an error state.
 *
 * Omitting the attribute (rather than writing `aria-invalid="false"`)
 * is the equivalent, shorter, and keeps the shipped markup free of
 * attributes that announce nothing.
 */
export function invalidAttribute(error: string | null | undefined): 'true' | undefined {
	return hasError(error) ? 'true' : undefined;
}
