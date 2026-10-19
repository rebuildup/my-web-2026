/**
 * Editorial form primitives (Issue #404).
 *
 * One import surface for the form-field contract and the components
 * that implement it. The obligation stays `editorial`: these are the
 * shipped visual + association language for a form, in the same way
 * `primitives/` is the shipped language for containers and headings,
 * and every consumer (`admin/`, `routes/`, …) reaches them through
 * this boundary rather than through `http/` or a peer obligation.
 */

export {
	describeByTarget,
	fieldIdSet,
	hasDescription,
	hasError,
	invalidAttribute,
	presentMessage,
	type FieldIdSet,
	type FieldMessages,
} from './contract';
export { ErrorSummary, type ErrorSummaryProps, type FormErrorEntry } from './ErrorSummary';
export {
	FieldFrame,
	FileField,
	TextField,
	type FieldControlProps,
	type FieldFrameProps,
	type FileFieldProps,
	type TextFieldProps,
} from './Field';
