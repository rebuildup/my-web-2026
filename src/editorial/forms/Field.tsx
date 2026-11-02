import type { InputHTMLAttributes, ReactNode } from 'react';
import { type RecipeVariantProps, css, cva } from '../../../styled-system/css';
import { MaterialSymbol } from '../primitives/MaterialSymbol';
import { CLOSE_PATH } from '../primitives/material-symbol-paths';
import {
	describeByTarget,
	fieldIdSet,
	hasError,
	invalidAttribute,
	presentMessage,
} from './contract';

/**
 * Form field primitives (Issue #404).
 *
 * One rule, three elements
 * ------------------------
 * A field is label + control + description + error, and the four have
 * to agree about ids for any of it to reach a screen-reader user:
 *
 *   - `<label for>` names the control, so the accessible name is the
 *     visible label (WCAG 2.2 1.3.1 / 3.3.2, and 4.1.2 for the markup).
 *   - The description is referenced by `aria-describedby` and is
 *     announced AFTER the name, so 「Email」 is followed by what the
 *     field accepts.
 *   - The error is referenced by the same `aria-describedby` AND sets
 *     `aria-invalid`, so a refused value is not identical to an
 *     accepted one (3.3.1 / 4.1.3 status messages).
 *   - The error is NOT a live region. It appears together with the
 *     form-level `ErrorSummary`, which owns the single announcement;
 *     a per-field live region would read the same sentence twice on
 *     every submit.
 *
 * Ids come from `contract.ts#fieldIdSet`, so a description or error
 * that is not rendered can never leave a dangling `aria-describedby`
 * reference behind — the failure mode that makes a form LOOK
 * described to a sighted reviewer and read as silence to everyone
 * else.
 *
 * Styling note: the error state is carried by an icon marker, a heavier
 * border, the sentence itself and `aria-invalid` — never by colour
 * alone (WCAG 2.2 1.4.1). The border colour uses `accent.negative`,
 * the audited status foreground token. The marker is a Material Symbols
 * glyph (Issue #823), not a typed `×`: a sign that carries meaning is
 * drawn, never a character in the text layer.
 */

/** Props the contract owns: a caller must not be able to break them. */
type OwnedAttributes =
	| 'id'
	| 'className'
	| 'style'
	| 'aria-describedby'
	| 'aria-invalid'
	| 'aria-errormessage';

/**
 * The association attributes a control carries inside `FieldFrame`.
 *
 * Both are derived, never hand-written, so a control rendered by a
 * third party inside a `FieldFrame` obeys the same contract as the
 * ones this module ships.
 */
export interface FieldControlProps {
	id: string;
	'aria-describedby'?: string;
	'aria-invalid'?: 'true';
}

export interface FieldFrameProps {
	/** The field name; also the control id and the summary link target. */
	name: string;
	/** Visible label text. Placeholder-only labelling is not a variant. */
	label: string;
	/** Help text announced with the control. Omitted when absent. */
	description?: ReactNode;
	/** The error sentence. Its presence IS the error state. */
	error?: string | null;
	/**
	 * Marks the label as required in text as well as in markup
	 * (`<input required>`). The marker is `aria-hidden` so the
	 * requirement is not announced twice — `required` already exposes
	 * it on the control.
	 */
	required?: boolean;
	/** Renders the control with the association attributes. */
	control: (props: FieldControlProps) => ReactNode;
}

/**
 * The presentational half of a field: label, description, the control
 * slot, and the error sentence.
 *
 * Reading order is label → description → control → error, which is the
 * order the platform reads the same content in, so the visual and the
 * audible order are the same order.
 */
export function FieldFrame({
	name,
	label,
	description,
	error,
	required,
	control,
}: FieldFrameProps) {
	const ids = fieldIdSet(name);
	const descriptionText = presentMessage(description);
	const invalid = invalidAttribute(error);
	const describedBy = describeByTarget(ids, { description, error });
	const controlProps: FieldControlProps = {
		id: ids.controlId,
		...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
		...(invalid === undefined ? {} : { 'aria-invalid': invalid }),
	};
	return (
		<div className={fieldClassName}>
			<label htmlFor={ids.controlId} className={labelClassName}>
				<span>{label}</span>
				{required ? (
					<span className={requiredClassName} aria-hidden="true">
						必須
					</span>
				) : null}
			</label>
			{descriptionText !== null ? (
				<p id={ids.descriptionId} className={descriptionClassName}>
					{descriptionText}
				</p>
			) : null}
			{control(controlProps)}
			{hasError(error) ? (
				<p id={ids.errorId} className={errorClassName} data-testid={`${name}-error`}>
					<MaterialSymbol className={errorMarkerClassName} d={CLOSE_PATH} size={14} />
					{error}
				</p>
			) : null}
		</div>
	);
}

export interface TextFieldProps
	extends Omit<InputHTMLAttributes<HTMLInputElement>, OwnedAttributes> {
	/**
	 * The form key, and — because `fieldIdSet(name)` derives every id
	 * from it — the control id, the summary link target and the
	 * description / error ids. One name, one identity.
	 */
	name: string;
	label: string;
	description?: ReactNode;
	error?: string | null;
}

/**
 * Text-like input with its label, description and error wired.
 *
 * `autoComplete` is left to the caller on purpose: it is a WCAG 2.2
 * 1.3.5 (Identify Input Purpose) hook whose value depends on whether
 * the field is signing in or creating an account, so this module
 * supplies no default it could get wrong.
 */
export function TextField({ name, label, description, error, required, ...rest }: TextFieldProps) {
	return (
		<FieldFrame
			name={name}
			label={label}
			description={description}
			error={error}
			required={required}
			control={(association) => (
				<input
					{...rest}
					name={name}
					required={required}
					className={inputClassName({ invalid: hasError(error) })}
					{...association}
				/>
			)}
		/>
	);
}

export interface FileFieldProps
	extends Omit<
		InputHTMLAttributes<HTMLInputElement>,
		OwnedAttributes | 'type' | 'value' | 'defaultValue' | 'onChange'
	> {
	name: string;
	label: string;
	description?: ReactNode;
	error?: string | null;
}

/**
 * File input with its label, description and error wired.
 *
 * `accept` is a filter hint, not a constraint (WCAG 2.2 3.3.1): the
 * server-side policy is authoritative, so the description states what
 * is accepted and the error states why a file was refused.
 */
export function FileField({
	name,
	label,
	description,
	error,
	required,
	accept,
	...rest
}: FileFieldProps) {
	return (
		<FieldFrame
			name={name}
			label={label}
			description={description}
			error={error}
			required={required}
			control={(association) => (
				<input
					{...rest}
					name={name}
					type="file"
					accept={accept}
					required={required}
					className={inputClassName({ invalid: hasError(error) })}
					{...association}
				/>
			)}
		/>
	);
}

const fieldClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	minWidth: '0',
});

const labelClassName = css({
	display: 'flex',
	alignItems: 'baseline',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.default',
});

const requiredClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

const descriptionClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
});

const errorClassName = css({
	display: 'flex',
	gap: '2',
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'accent.negative',
	// The one place the shipped colour layer carries meaning, so it
	// also carries weight: colour alone is not a signal
	// (WCAG 2.2 1.4.1).
	fontWeight: '600',
});

const errorMarkerClassName = css({
	// The marker is a drawn glyph (Issue #823), so it carries no font
	// metrics any more — only the flex behaviour and the colour it
	// inherits from the error sentence.
	flexShrink: '0',
});

const inputRecipe = cva({
	base: {
		fontFamily: 'sans',
		fontSize: 'md',
		paddingInline: '3',
		paddingBlock: '2',
		width: '100%',
		minWidth: '0',
		border: '1px solid {colors.border.subtle}',
		borderRadius: '4',
		background: 'bg.surface',
		color: 'text.default',
	},
	variants: {
		invalid: {
			true: {
				// A heavier border so the state is legible next to the
				// sentence below the control, not only as a hue shift.
				borderColor: 'accent.negative',
				borderWidth: '2px',
			},
			false: {},
		},
	},
	defaultVariants: {
		invalid: false,
	},
});

type InputVariants = NonNullable<RecipeVariantProps<typeof inputRecipe>>;

const inputClassName = (props: InputVariants) => inputRecipe(props);
